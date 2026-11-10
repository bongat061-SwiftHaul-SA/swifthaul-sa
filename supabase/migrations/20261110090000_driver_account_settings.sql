insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-profile-photos', 'driver-profile-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

create policy "Drivers can read their own profile photos"
on storage.objects for select to authenticated
using (bucket_id = 'driver-profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Drivers can upload their own profile photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'driver-profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Drivers can update their own profile photos"
on storage.objects for update to authenticated
using (bucket_id = 'driver-profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'driver-profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Drivers can delete their own profile photos"
on storage.objects for delete to authenticated
using (bucket_id = 'driver-profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
