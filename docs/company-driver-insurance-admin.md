# Company Admin — Driver insurance management

The Company app adds an administrator-only insurance management section backed by the `driver-insurance-admin` Edge Function.

## Access and controls

- Only authenticated users with `user_profiles.role = 'admin'` and `account_status = 'active'` can list or change insurer policy records.
- Driver records include account status, verified active Premium membership, subscription eligibility basis, and current policy status.
- Activating cover requires an active driver account, a verified eligible Premium membership, insurer/underwriter name, unique policy reference, and valid coverage start/end timestamps.
- Activation is explicitly confirmed in the admin UI. The backend independently validates all eligibility and policy fields.
- Admins can suspend a policy, mark it expired, or reset a record to pending.
- The benefit limits are fixed server-side: R30,000 vehicle, R100,000 accidental disability and R1,000 daily accident benefit.
- The private policy table remains inaccessible to anon/authenticated roles; the Edge Function uses service-role access only after validating the administrator session and role.

## Important insurer dependency

These controls record an insurer-issued policy; they do not create insurance. Do not activate a record unless the insurer has confirmed the driver, vehicle/risk, policy wording, benefit definitions, waiting periods, exclusions, premium funding and claims process. The UI only labels cover active when both subscription eligibility and the insurer policy status/dates are valid.

## Deployment

Apply the already committed migration `20261107220000_driver_premium_insurance_benefits.sql`, deploy `driver-insurance-admin`, and publish the Company app update in a controlled environment. No migration, function deployment, merge or production publication is performed by this branch update.
