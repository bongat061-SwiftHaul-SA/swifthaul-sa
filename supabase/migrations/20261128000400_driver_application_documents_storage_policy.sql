drop policy if exists "Drivers can upload their own application documents" on storage.objects;
create policy "Drivers can upload their own application documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'driver-application-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
