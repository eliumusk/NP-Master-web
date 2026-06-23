alter table pfam_hits
  alter column e_value type double precision using e_value::double precision,
  alter column bitscore type double precision using bitscore::double precision;
