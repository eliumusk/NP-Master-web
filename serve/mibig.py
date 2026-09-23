"""MIBiG nearest-neighbor lookup via DIAMOND blastp.

One-time setup (run once when MIBiG is updated):
    python -m serve.mibig setup \
        --gbk-dir /data/syh/NP-Master-web/data/mibig/mibig_gbk_4.0 \
        --out-dir /data/syh/NP-Master-web/data/mibig

To regenerate only the cluster-level product meta (mibig_clusters.json)
without rebuilding the DIAMOND index:
    python -m serve.mibig clusters \
        --gbk-dir /data/syh/NP-Master-web/data/mibig/mibig_gbk_4.0 \
        --out-json /data/syh/NP-Master-web/data/mibig/mibig_clusters.json

At job time:
    from serve.mibig import search_regions_against_mibig
    hits_by_region = search_regions_against_mibig(regions_gbk, dmnd_db, top_k=3)

Output is a list per region of dicts: {bgc_id, similarity, identity,
genes_matched, genes_total, evalue, product, cluster_product, query_cds}.

`similarity` is cluster-level: Σ(best protein identity per matched query CDS)
divided by the region's CDS count. `identity` is only the best single-protein
identity and must NOT be shown as cluster similarity — homologous enzymes
routinely reach 50-80% pairwise identity between unrelated clusters.
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


# Matches "angolamycin biosynthesis gene cluster" style cluster annotations.
_CLUSTER_RE = re.compile(r"^(.{1,60}?)\s+biosynth(?:esis|etic)\s+gene\s+cluster\b", re.IGNORECASE)
# Compound names never contain these; their presence means the capture bled
# into neighbouring prose (e.g. "EMBL:X58833.1 S.coelicolor 6 actVA region ...").
_CLUSTER_BAD_CHARS = re.compile(r"[.:;,]")


def _cluster_product_from_record(rec, organism: str) -> str:
    """Cluster-level compound name from misc_feature notes, else DEFINITION."""
    for feat in rec.features:
        if feat.type != "misc_feature":
            continue
        for note in feat.qualifiers.get("note", []):
            m = _CLUSTER_RE.match(str(note).strip())
            if m and not _CLUSTER_BAD_CHARS.search(m.group(1)):
                return m.group(1).strip()
    definition = (rec.description or "").strip()
    if organism and definition.lower().startswith(organism.lower()):
        definition = definition[len(organism):].strip()
    m = _CLUSTER_RE.match(definition)
    if m and not _CLUSTER_BAD_CHARS.search(m.group(1)):
        return m.group(1).strip()
    return ""


def _load_mibig_json_meta(json_dir: Path) -> dict[str, dict]:
    """Read MIBiG 4.0 per-entry JSONs: {bgc_id: {product, organism, classes}}."""
    meta: dict[str, dict] = {}
    for js in sorted(Path(json_dir).glob("BGC*.json")):
        try:
            d = json.loads(js.read_text())
        except Exception as e:
            log.warning("json parse failed %s: %s", js.name, e)
            continue
        compounds = [str(c.get("name") or "").strip() for c in d.get("compounds") or []]
        compounds = [c for c in compounds if c]
        classes: list[str] = []
        for cls in (d.get("biosynthesis") or {}).get("classes") or []:
            name = str((cls or {}).get("class") or "").strip()
            if name and name not in classes:
                classes.append(name)
        meta[js.stem] = {
            "product": ", ".join(compounds),
            "organism": str((d.get("taxonomy") or {}).get("name") or ""),
            "classes": classes,
        }
    return meta


def extract_cluster_meta(gbk_dir: Path, out_json: Path,
                         mibig_json_dir: Path | None = None) -> int:
    """One-time: per MIBiG BGC, extract cluster-level compound + organism.

    Authoritative source is the MIBiG JSON dump (compounds list); the GenBank
    misc_feature/DEFINITION parse is the fallback for entries without JSON
    (many early GBKs have no usable cluster note).
    Output: {bgc_id: {"product": str, "organism": str, "classes": [str]}}.
    """
    from Bio import SeqIO

    json_meta = _load_mibig_json_meta(mibig_json_dir) if mibig_json_dir else {}
    meta: dict[str, dict] = {}
    for gbk in sorted(Path(gbk_dir).rglob("*.gbk")):
        bgc_id = gbk.stem
        organism = ""
        gbk_product = ""
        try:
            rec = next(SeqIO.parse(gbk, "genbank"), None)
        except Exception as e:
            log.warning("parse failed %s: %s", gbk.name, e)
            continue
        if rec is not None:
            organism = (rec.annotations or {}).get("organism", "") or ""
            gbk_product = _cluster_product_from_record(rec, organism)
        jm = json_meta.get(bgc_id) or {}
        meta[bgc_id] = {
            "product": jm.get("product") or gbk_product,
            "organism": jm.get("organism") or organism,
            "classes": jm.get("classes") or [],
        }
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(meta))
    n_named = sum(1 for v in meta.values() if v["product"])
    log.info("mibig: cluster meta for %d BGCs (%d with compound name) → %s",
             len(meta), n_named, out_json)
    return len(meta)


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
                                  threads: int = 8,
                                  cluster_meta_json: Path | None = None) -> dict[str, list[dict]]:
    """Run blastp, return {region_name: [hit_dict, ...]} (up to top_k per region).

    Strategy: extract all region CDS as queries, blastp against the MIBiG db,
    then aggregate per (region, MIBiG bgc_id) into a cluster-level
    gene-content similarity and take the top_k bgc_ids per region (see
    `_aggregate_blast_hits`).

    Each hit carries `product` (protein-level annotation of the single best
    matching MIBiG CDS) and, when the cluster-meta sidecar exists,
    `cluster_product` (compound name of the whole MIBiG cluster, e.g.
    "actinorhodin") — the latter is what the UI should surface.
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
           "-k", str(max(top_k * 4, 50)),  # wide net: gene-content scoring needs hits across bgcs
           "--evalue", "1e-5",             # significant hits only
           "--more-sensitive",
           "-p", str(threads),
           "--quiet"]
    log.info("diamond blastp: %d queries against %s", n_queries, dmnd_db.name)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"diamond blastp failed:\n{proc.stderr[-2000:]}")

    meta = json.loads(meta_json.read_text())
    if cluster_meta_json is None:
        cluster_meta_json = meta_json.with_name("mibig_clusters.json")
    cluster_meta: dict[str, dict] = {}
    if cluster_meta_json.exists():
        try:
            cluster_meta = json.loads(cluster_meta_json.read_text())
        except Exception as e:
            log.warning("mibig: cluster meta unreadable (%s); continuing without", e)

    with open(blast_out) as fh:
        return _aggregate_blast_hits(fh, meta, cluster_meta,
                                     _count_query_cds_by_region(query_faa), top_k)


def _count_query_cds_by_region(query_faa: Path) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    with open(query_faa) as fh:
        for line in fh:
            if line.startswith(">"):
                counts[line[1:].split("|")[0].strip()] += 1
    return counts


def _aggregate_blast_hits(hit_lines, meta: dict[str, dict],
                          cluster_meta: dict[str, dict],
                          region_cds_counts: dict[str, int],
                          top_k: int) -> dict[str, list[dict]]:
    """Cluster-level aggregation of DIAMOND tabular hits.

    Per (region, MIBiG bgc_id) keep the best hit per query CDS, then score the
    pair by gene content:

        similarity = Σ(best identity per matched query CDS) / n_region_CDS

    This is intentionally not the max single-protein identity (that number is
    kept in `identity` for reference): a cluster that only shares one
    homologous enzyme must score low even if that enzyme is highly conserved.
    """
    # per[region][bgc_id][query_cds] = (identity, evalue, alignment_length)
    per: dict[str, dict[str, dict[str, tuple[float, float, int]]]] = defaultdict(lambda: defaultdict(dict))
    bgc_info: dict[str, dict] = {}
    for line in hit_lines:
        cols = line.rstrip("\n").split("\t")
        if len(cols) < 8:
            continue
        qseq, sseq, pident, evalue, length = cols[:5]
        region = qseq.split("|")[0]
        sub = meta.get(sseq, {})
        bgc_id = sub.get("bgc_id") or sseq.split("|")[0]
        try:
            identity = float(pident) / 100.0
            evalue_f = float(evalue)
            length_i = int(length)
        except ValueError:
            continue
        prev = per[region][bgc_id].get(qseq)
        if prev is None or identity > prev[0]:
            per[region][bgc_id][qseq] = (identity, evalue_f, length_i)
        if bgc_id not in bgc_info:
            bgc_info[bgc_id] = {
                "product": sub.get("product") or "",
                "cluster_product": (cluster_meta.get(bgc_id) or {}).get("product") or "",
            }

    out: dict[str, list[dict]] = {}
    for region, bgc_map in per.items():
        n_cds = region_cds_counts.get(region, 0)
        if n_cds == 0:
            continue
        ranked: list[dict] = []
        for bgc_id, cds_hits in bgc_map.items():
            best_cds, (best_ident, best_eval, best_len) = max(
                cds_hits.items(), key=lambda kv: kv[1][0])
            similarity = sum(v[0] for v in cds_hits.values()) / n_cds
            info = bgc_info.get(bgc_id, {})
            ranked.append({
                "bgc_id": bgc_id,
                "similarity": round(similarity, 4),
                "identity": round(best_ident, 4),
                "genes_matched": len(cds_hits),
                "genes_total": n_cds,
                "evalue": best_eval,
                "alignment_length": best_len,
                "product": info.get("product", ""),
                "cluster_product": info.get("cluster_product", ""),
                "query_cds": best_cds,
            })
        ranked.sort(key=lambda h: (h["similarity"], h["identity"]), reverse=True)
        out[region] = ranked[:top_k]
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
    p_setup.add_argument("--mibig-json-dir", type=Path, default=None,
                         help="MIBiG 4.0 per-entry JSON dump dir (authoritative compounds)")
    p_clusters = sub.add_parser("clusters", help="regenerate cluster-level product meta only")
    p_clusters.add_argument("--gbk-dir", type=Path, required=True)
    p_clusters.add_argument("--out-json", type=Path, required=True)
    p_clusters.add_argument("--mibig-json-dir", type=Path, default=None,
                            help="MIBiG 4.0 per-entry JSON dump dir (authoritative compounds)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    if args.cmd == "setup":
        out_dir = args.out_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        faa = out_dir / "mibig_proteins.faa"
        meta = out_dir / "mibig_meta.json"
        dmnd = out_dir / "mibig.dmnd"
        clusters = out_dir / "mibig_clusters.json"
        n = extract_mibig_proteins(args.gbk_dir, faa, meta)
        print(f"extracted {n} proteins → {faa}")
        extract_cluster_meta(args.gbk_dir, clusters, mibig_json_dir=args.mibig_json_dir)
        print(f"cluster meta → {clusters}")
        build_diamond_db(faa, dmnd, args.diamond_bin, args.threads)
        print(f"built {dmnd}")
        return 0
    if args.cmd == "clusters":
        n = extract_cluster_meta(args.gbk_dir, args.out_json, mibig_json_dir=args.mibig_json_dir)
        print(f"cluster meta for {n} BGCs → {args.out_json}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
