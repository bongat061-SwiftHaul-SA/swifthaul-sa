# SwiftHaul SA — Production Migration Readiness

**Status:** HOLD — production migration is not approved  
**Audit date:** 2026-11-19  
**Working branch:** `feature/sa-sms-whatsapp-notifications-staging`  
**Scope:** Read-only reconciliation and preflight planning only.

## Environment snapshot

| Environment | Supabase project | Latest migration version | Ledger rows |
|---|---|---|---:|
| Staging | `tagkbropgzthsbjlhyvz` | `20261116155309` | 77 |
| Production | `jikstpnvsdjhcibtjilp` | `20261110144608` | 47 |

The staging Git branch contains 56 files in `supabase/migrations/`. The staging migration ledger contains more entries than the checked-in migration-file count. This discrepancy is a reconciliation warning, not proof that every unmatched ledger row is absent: migration versions and names differ, and migrations may have been renamed or consolidated. Map every ledger row to source before changing either environment.

## Source/history risks

The staging ledger includes driver onboarding, work eligibility, document-date enforcement, current licence checks, bank-detail encryption, secure storage/access auditing, trip checkpoints, and secure payout-bank-detail changes. Several entries do not have an obvious one-to-one filename match in the current migration directory. The ledger contains two distinct versions named `encrypt_complete_driver_bank_details`; investigate each version separately.

Never fabricate SQL from migration names, infer that a similarly named file is equivalent, replay an applied migration without reviewing idempotency/data effects, or edit the production migration ledger merely to align version numbers.

## Production driver and dispatch observations

The latest read-only audit found:
- 2 production driver profiles marked approved;
- 1 production driver currently online;
- 0 production driver-document rows;
- both recorded driver licences expire within 60 days of the audit date;
- 1 cancelled booking and 0 active assigned bookings available for a live dispatch test.

Legacy approval flags do not prove compliance with newer document and eligibility rules. Do not automatically approve or revoke drivers based only on those flags. Preserve account history and require controlled reverification against current rules.

Staging had 1 pending driver profile and 0 driver-document rows. Staging and production data are separate.

## Required gates before proposing production migration

1. **Recover original source:** Locate the original SQL for every ledger entry not directly represented in the migration directory. Confirm exact version, provenance, dependencies, and checksum where available.
2. **Build a complete matrix:** For every staging and production ledger version, record the matching repository file, applied status in each environment, and any rename/consolidation relationship. Mark unresolved mappings explicitly.
3. **Review dependency order:** Inspect table/column, function, trigger, RLS, storage-policy, and edge-function dependencies across driver onboarding, eligibility, encryption, payouts, dispatch, notifications, fleet, investor, and Paystack changes.
4. **Review data impact:** Identify backfills, constraints, uniqueness assumptions, destructive operations, PII transformations, encryption-key requirements, and rollback limits. Prepare and test backup/restore.
5. **Protect financial records:** Reconcile bookings, customer payments, driver earnings, payout requests, refunds, memberships, and bank-detail encryption. Do not initiate live payments or payouts during testing.
6. **Preserve driver accounts:** Do not auto-approve or silently rewrite approval status. Define reverification for the two existing production drivers, including licence validity and required documents.
7. **Validate in isolation:** Apply only source-reconciled migrations to a disposable staging clone or verified staging environment after backup. Test schema, RLS, storage, authentication, dispatch, payout ledger, and regression behavior.
8. **Obtain explicit approval:** Present the exact SQL/file list, expected data effects, downtime and rollback plan, and test evidence. Production remains untouched until separate explicit authorization.

## Controlled dispatch test

A production dispatch test is currently blocked because no active booking was available. Create a clearly labelled test booking only in staging, use a test driver who satisfies current onboarding and eligibility checks, and verify offer/accept/route/status transitions without real customer charges or driver payouts. Do not bypass document, licence, vehicle, online-presence, or capacity guards.

## Decision

**NO-GO for production migration.** Source/history mapping is incomplete, production has no driver-document rows, and no suitable active dispatch booking is available. Continue source recovery and staging-only validation. This audit did not change the production database, edge functions, payment configuration, or website deployment.


## 7. First-pass exact-name reconciliation (2026-11-19)

A deterministic filename comparison was run against the staging branch's 56 SQL migration files and the staging database's 77 migration-ledger rows:

- 40 ledger rows have an exact normalized name match to a checked-in migration filename.
- 37 ledger rows have no exact normalized filename match and remain **unresolved**.
- An unresolved exact-name match is not proof that source is missing. It may reflect an alternate filename, a rename, a consolidated migration, or a historical source file that is no longer in this branch.
- The comparison is by normalized migration name, not by SQL checksum or semantic equivalence. It is not sufficient to authorize migration replay.

The 37 rows requiring source recovery or explicit alternate-source mapping are:

| Staging ledger version | Ledger name |
|---|---|
| 20261106125647 | auth_driver_dispatch_pod_foundation_invoker |
| 20261106125700 | capture_driver_onboarding_invoker |
| 20261106125848 | payfast_wallet_repayments_invoker |
| 20261106130049 | award_premium_driver_delivery_rewards_invoker |
| 20261106130058 | verified_payfast_driver_membership_activation_invoker |
| 20261106130119 | serialize_premium_reward_funding_invoker |
| 20261106130146 | persistent_dispatch_routes |
| 20261106130208 | driver_earnings_and_payouts |
| 20261106130551 | add_remaining_foreign_key_indexes |
| 20261106130832 | payfast_source_and_driver_payout_balance |
| 20261106130927 | atomic_dispatch_route_operations |
| 20261106131254 | grant_auth_trigger_execute_to_auth_service |
| 20261107235704 | paystack_provider_support |
| 20261108010507 | customer_eft_proof_and_admin_verification |
| 20261108010543 | harden_customer_eft_review_and_indexes |
| 20261108010710 | use_booking_reference_for_customer_eft |
| 20261108011102 | prevent_eft_confirmation_after_other_payment |
| 20261108011608 | driver_premium_insurance_claims_and_gps |
| 20261108011813 | revoke_client_access_to_driver_insurance_tables |
| 20261108013042 | customer_nedbank_insurance_interest |
| 20261110144343 | driver_account_settings |
| 20261110192200 | enforce_card_method_for_payfast_confirmation |
| 20261110211117 | allow_card_payment_method |
| 20261111204723 | south_african_driver_onboarding |
| 20261111205043 | driver_verification_expiry_and_pii_protection |
| 20261111205135 | driver_work_eligibility_guard |
| 20261111205615 | driver_vehicle_car_class |
| 20261111205733 | enforce_driver_document_date_requirements |
| 20261111205801 | require_current_driver_profile_licence |
| 20261111205837 | encrypt_complete_driver_bank_details |
| 20261111205858 | encrypt_complete_driver_bank_details |
| 20261111210331 | driver_secure_storage_aes_gcm_and_access_audit |
| 20261111210644 | driver_trip_arrival_checkpoints |
| 20261111210914 | secure_driver_payout_bank_details |
| 20261113120733 | create_investor_inquiries |
| 20261114150030 | create_investor_portal |
| 20261114155525 | expand_investor_capital_records |

The two separate `encrypt_complete_driver_bank_details` ledger versions must remain separate records during investigation. Do not collapse or reorder them without recovering both original definitions and understanding their effects.

**Next source-recovery action:** inspect repository history and prior commits/branches for these exact migration definitions and compare candidate SQL to the applied staging schema. Record each mapping with evidence; where no original source can be recovered, mark it as a blocker and design a separately reviewed forward-fix only after schema/data inspection. Do not create guessed historical migration files.
