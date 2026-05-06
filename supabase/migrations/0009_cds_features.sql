-- v0.5 P3 Phase A — store per-CDS Pfam annotations per region as JSONB.
--
-- Element shape:
--   {
--     "locus_tag": "BGC_0001_CDS_005",
--     "start": 6043, "end": 7382, "strand": 1,
--     "length_aa": 446,
--     "product": "hypothetical protein",
--     "function_class": "core_biosynthetic",
--     "pfam_domains": [
--       { "name": "AMP-binding", "accession": "PF00501.32",
--         "e_value": 2.1e-89, "bitscore": 296.7,
--         "env_start": 23, "env_end": 432 },
--       ...
--     ]
--   }

alter table regions add column if not exists cds_features jsonb;
