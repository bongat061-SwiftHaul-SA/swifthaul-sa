-- Secure driver onboarding drafts with a server-managed Vault key.
create table if not exists public.driver_onboarding_drafts (
  driver_user_id uuid primary key references auth.users(id) on delete cascade,
  draft_payload_encrypted text not null,
  updated_at timestamptz not null default now()
);

alter table public.driver_onboarding_drafts enable row level security;
revoke all on table public.driver_onboarding_drafts from anon, authenticated;
grant select, insert, update, delete on table public.driver_onboarding_drafts to service_role;

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'driver_onboarding_drafts_key'
  ) then
    perform vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'),
      'driver_onboarding_drafts_key',
      'Server-side encryption key for SwiftHaul driver onboarding drafts',
      null
    );
  end if;
end;
$$;

create or replace function public.encrypt_driver_pii(p_plaintext text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_plaintext is null then
    raise exception 'plaintext_required';
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'driver_onboarding_drafts_key'
  limit 1;

  if v_key is null then
    raise exception 'driver_draft_encryption_key_unavailable';
  end if;

  return pg_catalog.encode(
    extensions.pgp_sym_encrypt(
      p_plaintext,
      v_key,
      'cipher-algo=aes256,compress-algo=0'
    ),
    'base64'
  );
end;
$$;

create or replace function public.decrypt_driver_pii(p_ciphertext text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_ciphertext is null then
    raise exception 'ciphertext_required';
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'driver_onboarding_drafts_key'
  limit 1;

  if v_key is null then
    raise exception 'driver_draft_encryption_key_unavailable';
  end if;

  return extensions.pgp_sym_decrypt(
    pg_catalog.decode(p_ciphertext, 'base64'),
    v_key
  );
end;
$$;

revoke all on function public.encrypt_driver_pii(text) from public, anon, authenticated;
revoke all on function public.decrypt_driver_pii(text) from public, anon, authenticated;
grant execute on function public.encrypt_driver_pii(text) to service_role;
grant execute on function public.decrypt_driver_pii(text) to service_role;
