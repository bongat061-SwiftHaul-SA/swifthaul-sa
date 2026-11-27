-- Add applicant-selected upload grouping while preserving administrator document classification.
alter table public.driver_document_upload_batches
  add column if not exists document_group text not null default 'identity_personal'
  check (document_group in ('identity_personal','licence_prdp','vehicle_insurance','residential_address'));
comment on column public.driver_document_upload_batches.document_group is
  'Applicant-selected upload group; administrators still assign and approve the actual document type.';
