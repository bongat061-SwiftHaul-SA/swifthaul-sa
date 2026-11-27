alter table public.investor_profiles
  add column if not exists investment_committed_zar numeric(16,2) not null default 0 check (investment_committed_zar >= 0),
  add column if not exists investment_received_zar numeric(16,2) not null default 0 check (investment_received_zar >= 0),
  add column if not exists share_register_reference text,
  add column if not exists share_issue_date date;
comment on column public.investor_profiles.investment_committed_zar is 'Investment commitment recorded by Company Admin; not proof of funds received.';
comment on column public.investor_profiles.investment_received_zar is 'Funds actually received and verified by Company Admin; separate from commitments.';
comment on column public.investor_profiles.shares_owned is 'Shares legally issued and recorded in the company share register.';
comment on column public.investor_profiles.share_register_reference is 'Reference to the supporting company share-register entry.';
comment on column public.investor_profiles.share_issue_date is 'Date the shares were legally issued.';