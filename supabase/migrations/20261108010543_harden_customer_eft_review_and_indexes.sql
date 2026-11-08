create index if not exists customer_eft_payments_owner_idx on public.customer_eft_payments(owner_id,created_at desc);
create index if not exists customer_eft_payments_reviewed_by_idx on public.customer_eft_payments(reviewed_by) where reviewed_by is not null;

-- Replace the proof and review RPCs with the hardened definitions from this migration.
-- The live definitions are kept in the migration source so local and hosted schema remain reproducible.
