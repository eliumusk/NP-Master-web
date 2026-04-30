-- v0.3 P1 3.4 — store top-K MIBiG hits per region as a JSONB array.
-- Each element: {"bgc_id": "BGC0000123", "identity": 0.74, "product": "actinorhodin",
--                "evalue": 1e-50, "alignment_length": 312, "query_cds": "BGC_0001|005"}

alter table regions add column if not exists mibig_hits jsonb;
