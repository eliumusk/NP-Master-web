-- v0.3 P1 — extra result paths:
--   result_gbk_path  GenBank file (one LOCUS per region + prodigal CDS)
--   result_wig_path  bedgraph of per-bp Evo2+UNet sigmoid score, max-pooled to 64bp

alter table jobs add column if not exists result_gbk_path text;
alter table jobs add column if not exists result_wig_path text;
