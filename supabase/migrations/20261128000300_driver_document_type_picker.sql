-- Support applicant-selected document types in the single upload section.
alter table public.driver_document_upload_batches
  drop constraint if exists driver_document_upload_batches_document_group_check;
alter table public.driver_document_upload_batches
  add constraint driver_document_upload_batches_document_group_check
  check (document_group in ('identity_personal','driver_licence','prdp','vehicle_registration','vehicle_licence_disc','residential_address','vehicle_insurance','other','licence_prdp','vehicle_insurance','general'));
comment on column public.driver_document_upload_batches.document_group is
  'Applicant-selected document type for the single driver upload section. Admin remains responsible for verification and approval.';
