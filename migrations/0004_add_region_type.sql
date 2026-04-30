-- Add BGC type classification columns to regions.
-- Populated by serve/pipeline.py:_classify (post-decode LR head).

alter table regions add column if not exists bgc_type   text;
alter table regions add column if not exists type_score real;

create index if not exists regions_job_id_type_idx on regions (job_id, bgc_type);
