alter table public.driver_profiles add column if not exists bank_details_encrypted text;
update public.driver_profiles
set bank_details_encrypted=public.encrypt_driver_pii(jsonb_build_object(
 'bank_name',bank_name,'account_holder',bank_account_holder,
 'account_number_ciphertext',bank_account_encrypted,'universal_branch_code',universal_branch_code
)::text)
where bank_details_encrypted is null and (bank_name is not null or bank_account_holder is not null or bank_account_encrypted is not null);
update public.driver_profiles set bank_name=null,bank_account_holder=null,universal_branch_code=null
where bank_details_encrypted is not null;