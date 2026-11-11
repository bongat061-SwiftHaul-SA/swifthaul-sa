-- Ensure the private Customer profile-photo bucket exists in staging.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('customer-photos','customer-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
