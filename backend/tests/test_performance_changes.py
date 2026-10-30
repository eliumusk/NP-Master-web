from pathlib import Path

from backend import pfam_batch
from backend.extended import apply_evidence_extension
from backend.pfam import annotate_regions_gbk


def test_combined_pfam_scan_feeds_core_and_flank(tmp_path: Path, monkeypatch):
    fasta = tmp_path / "input.fna"
    gbk = tmp_path / "regions.gbk"
    fasta.write_text(">contig\n" + "A" * 1000 + "\n")
    gbk.write_text("placeholder")

    monkeypatch.setattr(
        pfam_batch,
        "_extract_regions_proteins_with_meta",
        lambda *_args: {"core": {"aa_sequence": "AAAA"}},
    )
    monkeypatch.setattr(
        pfam_batch,
        "_run_prodigal",
        lambda *_args: (tmp_path / "all.faa", tmp_path / "all.fna"),
    )

    def fake_read_prodigal(path):
        if path.suffix == ".faa":
            return {
                "contig_1": {
                    "contig": "contig",
                    "start": 50,
                    "end": 80,
                    "strand": 1,
                    "sequence": "BBBB",
                }
            }
        return {}

    monkeypatch.setattr(pfam_batch, "_read_prodigal_fasta", fake_read_prodigal)
    calls = []

    def fake_scan(*, faa_path, out_tbl, **_kwargs):
        calls.append(faa_path)
        text = faa_path.read_text()
        assert ">core\n" in text
        assert ">contig_1\n" in text
        out_tbl.write_text(
            "# combined\n"
            "Terpene PF00001 10 core x x 10\n"
            "Terpene PF00001 10 contig_1 x x 10\n"
        )

    monkeypatch.setattr(pfam_batch, "scan_proteins_parallel", fake_scan)
    monkeypatch.setattr(
        pfam_batch,
        "parse_domtblout",
        lambda _path: {
            "core": [{"name": "Terpene"}],
            "contig_1": [{"name": "Terpene"}],
        },
    )

    batch = pfam_batch.prepare_pfam_batch(
        fasta_path=fasta,
        gff3_path=None,
        rows=[{"contig": "contig", "start": 100, "end": 200}],
        regions_gbk=gbk,
        results_dir=tmp_path / "results",
        pfam_db=tmp_path / "Pfam-A.hmm",
        hmmer_bin=tmp_path / "hmmscan",
        prodigal_bin=tmp_path / "prodigal",
        threads=24,
    )

    assert len(calls) == 1
    assert batch.domains_by_query["core"] == [{"name": "Terpene"}]
    assert batch.domains_by_query["contig_1"] == [{"name": "Terpene"}]
    assert " core " in batch.core_tbl.read_text()
    flank_tbl = tmp_path / "results/extended/_evidence_hmmscan/flank_candidates.domtbl"
    assert " contig_1 " in flank_tbl.read_text()
    assert batch.prodigal_context is not None


def test_precomputed_flank_domains_skip_second_scan(tmp_path: Path):
    pfam_db = tmp_path / "Pfam-A.hmm"
    hmmer_bin = tmp_path / "hmmscan"
    pfam_db.touch()
    hmmer_bin.touch()
    rows = [{
        "contig": "contig",
        "start": 100,
        "end": 200,
        "ext_start": 95,
        "ext_end": 205,
        "ext_method": "fixed_flank",
    }]
    genes = {
        "contig": [{
            "locus_tag": "gene_1",
            "start": 50,
            "end": 80,
            "sequence": "BBBB",
        }]
    }
    domains = {
        "gene_1": [{
            "name": "Terpene_synthase",
            "description": "",
            "e_value": 1e-20,
        }]
    }

    result = apply_evidence_extension(
        rows=rows,
        genes_by_contig=genes,
        contig_lens={"contig": 1000},
        flank_bp=5,
        work_dir=tmp_path / "work",
        pfam_db=pfam_db,
        hmmer_bin=hmmer_bin,
        precomputed_domains=domains,
    )

    assert result is domains
    assert rows[0]["ext_start"] == 50
    assert rows[0]["ext_method"] == "evidence"


def test_precomputed_core_domains_skip_second_scan(tmp_path: Path, monkeypatch):
    gbk = tmp_path / "regions.gbk"
    gbk.write_text("placeholder")
    monkeypatch.setattr(
        "backend.pfam._extract_regions_proteins_with_meta",
        lambda *_args: {
            "region|001": {
                "region_id": "region",
                "locus_tag": "cds_1",
                "start": 1,
                "end": 10,
                "strand": 1,
                "length_aa": 3,
                "product": "test",
                "aa_sequence": "AAA",
                "nt_sequence": "ATG",
            }
        },
    )
    monkeypatch.setattr(
        "backend.pfam.scan_proteins",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected second scan")),
    )
    domains = {
        "region|001": [{
            "name": "Terpene",
            "accession": "PF00001.1",
            "e_value": 1e-20,
            "bitscore": 50.0,
            "env_start": 1,
            "env_end": 3,
        }]
    }

    result = annotate_regions_gbk(
        regions_gbk=gbk,
        pfam_db=tmp_path / "Pfam-A.hmm",
        work_dir=tmp_path / "work",
        hmmer_bin=tmp_path / "hmmscan",
        precomputed_domains=domains,
    )

    assert result["region"][0]["pfam_domains"][0]["name"] == "Terpene"


def test_worker_overlaps_two_jobs(monkeypatch):
    import sys
    import threading
    import time
    from types import ModuleType, SimpleNamespace

    client = ModuleType("backend.client")
    client.claim_next_job = lambda *_args: None
    client.heartbeat = lambda *_args: None
    client.make_client = lambda *_args: object()
    client.update_job = lambda *_args, **_kwargs: None
    pipeline = ModuleType("backend.pipeline")
    pipeline.GpuBusyTimeout = RuntimeError
    pipeline.PipelineError = RuntimeError
    pipeline.run_job = lambda *_args: {}
    config = ModuleType("backend.config")
    config.get_settings = lambda: None
    notify = ModuleType("backend.notify")
    notify.notify_job_finished = lambda *_args, **_kwargs: None
    monkeypatch.setitem(sys.modules, "backend.client", client)
    monkeypatch.setitem(sys.modules, "backend.pipeline", pipeline)
    monkeypatch.setitem(sys.modules, "backend.config", config)
    monkeypatch.setitem(sys.modules, "backend.notify", notify)

    from backend import worker

    settings = SimpleNamespace(
        model_daemon_enabled=False,
        worker_max_jobs=2,
        poll_interval_sec=0.01,
        worker_id="test-worker",
        npmaster_repo_root=".",
        npmaster_cache_dir=".",
    )
    jobs = [{"id": "job-1"}, {"id": "job-2"}]
    lock = threading.Lock()
    active = 0
    max_active = 0
    completed = 0

    monkeypatch.setattr(worker, "get_settings", lambda: settings)
    monkeypatch.setattr(worker, "make_client", lambda _settings: object())
    monkeypatch.setattr(worker, "_install_signal_handlers", lambda: None)
    monkeypatch.setattr(worker, "claim_next_job", lambda *_args: jobs.pop(0) if jobs else None)
    monkeypatch.setattr(worker.sys, "argv", ["worker"])

    def fake_process(*_args):
        nonlocal active, max_active, completed
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.05)
        with lock:
            active -= 1
            completed += 1
            if completed == 2:
                worker._shutdown.set()

    monkeypatch.setattr(worker, "_process_one_job", fake_process)
    worker._shutdown.clear()

    assert worker.main() == 0
    assert completed == 2
    assert max_active == 2


def test_parallel_pfam_scan_uses_multiple_processes(tmp_path: Path, monkeypatch):
    from backend import pfam

    faa = tmp_path / "queries.faa"
    faa.write_text(">a\nAAAA\n>b\nBB\n>c\nCCCCCC\n>d\nDDDD\n")
    calls = []

    def fake_scan(*, out_tbl, threads, **_kwargs):
        calls.append((out_tbl, threads))
        out_tbl.write_text("# shard\nTerpene PF00001 10 query x x 10\n")
        return 1

    monkeypatch.setattr(pfam, "scan_proteins", fake_scan)
    out_tbl = tmp_path / "combined.domtbl"

    hits = pfam.scan_proteins_parallel(
        faa_path=faa,
        pfam_db=tmp_path / "Pfam-A.hmm",
        out_tbl=out_tbl,
        hmmer_bin=tmp_path / "hmmscan",
        threads=8,
        workers=2,
    )

    assert hits == 2
    assert len(calls) == 2
    assert all(threads == 4 for _, threads in calls)
    assert out_tbl.read_text().count("Terpene PF00001") == 2


def test_split_domtbl_prebackends_description_whitespace(tmp_path: Path):
    source = tmp_path / "combined.domtbl"
    output = tmp_path / "core.domtbl"
    line = "Terpene PF00001 10 query x x 10 description with  double spaces\n"
    source.write_text(line)

    pfam_batch._split_domtbl(
        source,
        [(output, {"query"}, {"query": ["query"]})],
    )

    assert output.read_text() == line
