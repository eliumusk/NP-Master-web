"""MIBiG nearest-neighbor lookup via DIAMOND blastp.

One-time setup (run once when MIBiG is updated):
    python -m serve.mibig setup \
        --gbk-dir /data/syh/NP-Master-web/data/mibig/mibig_gbk_4.0 \
        --out-dir /data/syh/NP-Master-web/data/mibig

At job time:
    from serve.mibig import search_regions_against_mibig
    hits_by_region = search_regions_against_mibig(regions_gbk, dmnd_db, top_k=3)

Output is a list per region of dicts: {bgc_id, identity, evalue, product, query_cds}.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

log = logging.getLogger(__name__)


def extract_mibig_proteins(gbk_dir: Path, out_faa: Path, out_meta: Path) -> int:
    """One-time: walk all MIBiG GenBanks, dump CDS amino-acid translations.

    FASTA header format: >BGC_ID|locus_idx
    Companion JSON file: {locus_str: {bgc_id, product_class}}.
    """
    from Bio import SeqIO

    out_faa.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, dict] = {}
    n_proteins = 0
    n_files = 0
    with open(out_faa, "w") as faa:
        for gbk in sorted(Path(gbk_dir).rglob("*.gbk")):
            bgc_id = gbk.stem
            n_files += 1
            try:
                rec = next(SeqIO.parse(gbk, "genbank"), None)
            except Exception as e:
                log.warning("parse failed %s: %s", gbk.name, e)
                continue
            if rec is None:
                continue
            # Try to derive product class from /product or /molecule_class on first feature
            product = ""
            try:
                annot = (rec.annotations or {})
                if "structured_comment" in annot:
                    sc = annot["structured_comment"]
                    if isinstance(sc, dict) and "antiSMASH-Data" in sc:
                        product = sc["antiSMASH-Data"].get("Description", "") or ""
            except Exception:
                pass
            for i, feat in enumerate(rec.features):
                if feat.type != "CDS":
                    continue
                qs = feat.qualifiers
                aa = (qs.get("translation") or [""])[0]
                if not aa or len(aa) < 30:
                    continue
                cds_product = (qs.get("product") or [""])[0]
                gene = (qs.get("gene") or [""])[0] or (qs.get("locus_tag") or [""])[0]
                locus = f"{bgc_id}|{i:03d}"
                faa.write(f">{locus}\n{aa}\n")
                meta[locus] = {
                    "bgc_id": bgc_id,
                    "gene": gene,
                    "product": cds_product or product,
                }
                n_proteins += 1
    out_meta.write_text(json.dumps(meta))
    log.info("mibig: extracted %d proteins from %d GBK files", n_proteins, n_files)
    return n_proteins


def build_diamond_db(faa: Path, dmnd: Path, diamond_bin: Path, threads: int = 8) -> None:
    cmd = [str(diamond_bin), "makedb",
           "--in", str(faa), "--db", str(dmnd), "-p", str(threads)]
    log.info("diamond makedb: %s", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"diamond makedb failed:\n{proc.stderr[-2000:]}")


def _extract_query_proteins_from_regions_gbk(regions_gbk: Path, out_faa: Path) -> int:
    """Pull all CDS translations out of the per-region GenBank we just generated.

    Headers: >regionName|cdsIdx
    """
    from Bio import SeqIO
    out_faa.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(out_faa, "w") as fout:
        for rec in SeqIO.parse(regions_gbk, "genbank"):
            for i, feat in enumerate(rec.features):
                if feat.type != "CDS":
                    continue
                aa = (feat.qualifiers.get("translation") or [""])[0]
                if not aa or len(aa) < 30:
                    continue
                fout.write(f">{rec.id}|{i:03d}\n{aa}\n")
                n += 1
    return n


def search_regions_against_mibig(*, regions_gbk: Path, dmnd_db: Path,
                                  meta_json: Path, work_dir: Path,
                                  diamond_bin: Path, top_k: int = 3,
                                  threads: int = 8) -> dict[str, list[dict]]:
    """Run blastp, return {region_name: [hit_dict, ...]} (best-per-region; up to top_k).

    Strategy: extract all region CDS as queries, blastp against MIBiG db with
    `-k <large>`, then for each region take the top_k hits across all its CDSs
    (deduplicated by MIBiG bgc_id, ordered by best identity).
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    query_faa = work_dir / "query_proteins.faa"
    blast_out = work_dir / "diamond_hits.tsv"
    n_queries = _extract_query_proteins_from_regions_gbk(regions_gbk, query_faa)
    if n_queries == 0:
        log.info("mibig.search: no query proteins (empty regions?)")
        return {}

    cmd = [str(diamond_bin), "blastp",
           "-q", str(query_faa), "-d", str(dmnd_db),
           "-o", str(blast_out),
           "--outfmt", "6", "qseqid", "sseqid", "pident", "evalue",
           "length", "qlen", "slen", "bitscore",
           "-k", str(top_k * 4),         # extra slack for cross-CDS dedup
           "--more-sensitive",
           "-p", str(threads),
           "--quiet"]
    log.info("diamond blastp: %d queries against %s", n_queries, dmnd_db.name)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"diamond blastp failed:\n{proc.stderr[-2000:]}")

    meta = json.loads(meta_json.read_text())

    # Aggregate: for each region, dedupe hits by bgc_id, keep best identity, take top_k.
    by_region: dict[str, dict[str, dict]] = defaultdict(dict)
    with open(blast_out) as fh:
        for line in fh:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 8:
                continue
            qseq, sseq, pident, evalue, length, qlen, slen, bitscore = cols[:8]
            try:
                region = qseq.split("|")[0]
            except Exception:
                continue
            sub = meta.get(sseq, {})
            bgc_id = sub.get("bgc_id") or sseq.split("|")[0]
            try:
                identity = float(pident) / 100.0
                evalue_f = float(evalue)
                length_i = int(length)
            except ValueError:
                continue
            existing = by_region[region].get(bgc_id)
            if existing and existing["identity"] >= identity:
                continue
            by_region[region][bgc_id] = {
                "bgc_id": bgc_id,
                "identity": round(identity, 4),
                "evalue": evalue_f,
                "alignment_length": length_i,
                "product": sub.get("product") or "",
                "query_cds": qseq,
            }

    out: dict[str, list[dict]] = {}
    for region, hits_dict in by_region.items():
        ranked = sorted(hits_dict.values(), key=lambda h: h["identity"], reverse=True)[:top_k]
        out[region] = ranked
    return out


# ──────────── CLI for one-time setup ────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_setup = sub.add_parser("setup", help="extract proteins + build DIAMOND index")
    p_setup.add_argument("--gbk-dir", type=Path, required=True)
    p_setup.add_argument("--out-dir", type=Path, required=True)
    p_setup.add_argument("--diamond-bin", type=Path, default=Path("/data/syh/NP-Master-web/data/diamond"))
    p_setup.add_argument("--threads", type=int, default=8)
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    if args.cmd == "setup":
        out_dir = args.out_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        faa = out_dir / "mibig_proteins.faa"
        meta = out_dir / "mibig_meta.json"
        dmnd = out_dir / "mibig.dmnd"
        n = extract_mibig_proteins(args.gbk_dir, faa, meta)
        print(f"extracted {n} proteins → {faa}")
        build_diamond_db(faa, dmnd, args.diamond_bin, args.threads)
        print(f"built {dmnd}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
