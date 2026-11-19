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
