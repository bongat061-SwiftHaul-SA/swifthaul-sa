-- Permit the simplified single-picker driver upload flow.
-- Applicants upload documents together; Admin remains responsible for identifying,
-- classifying and approving each document.
alter table public.driver_document_upload_batches
  drop constraint if exists driver_document_upload_batches_document_group_check;

alter table public.driver_document_upload_batches
  add constraint driver_document_upload_batches_document_group_check
  check (document_group in ('identity_personal','licence_prdp','vehicle_insurance','residential_address','general'));

comment on column public.driver_document_upload_batches.document_group is
  'Applicant-selected upload grouping. General is the single-picker default; administrators assign and approve the actual document type.';
