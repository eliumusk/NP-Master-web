-- Optional per-genome GFF3 annotation attachment. When set, the worker
-- downloads it from storage and the GFF3/domain-rescue enhancement path
-- activates (see serve/pipeline.py:_prepare_gff3).

alter table genomes
  add column if not exists gff3_path text;
