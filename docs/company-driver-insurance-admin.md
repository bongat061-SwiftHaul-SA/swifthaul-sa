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

## Insurance claims review and dispatch-only cover

The Company console includes an Insurance Claims page. It displays the assigned waybill, incident time, GPS points around the incident, the planned route where retained, and private evidence links. Admin must record a route-compliance decision with a written note. A route breach prevents insurer approval in the workflow.

The R1,000 daily accident benefit is capped at five days per accident claim (R5,000 maximum). The backend enforces this limit for both requested and insurer-approved days. Claim submission is restricted to the assigned driver and an incident during an accepted dispatch, either travelling to pickup or travelling from pickup to delivery. It also requires an active insurer policy and Premium eligibility at the incident time plus a GPS evidence point within two minutes of the incident.

GPS pings are recorded privately only while the driver shares location for an accepted/picked-up/in-transit dispatch. The app does not yet automatically determine whether a stop or deviation is unnecessary; admins must compare the evidence trace with the planned route and insurer-approved exceptions. Do not approve claims solely on the presence of GPS points.

Supporting evidence is stored in a private bucket. Signed download links expire after five minutes. Agree a POPIA-aligned retention period, medical-data access rules and insurer data-sharing agreement before production use.
