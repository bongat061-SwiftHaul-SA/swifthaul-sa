# Driver Premium insurance benefits

## Proposed benefit schedule

The Premium subscription includes these proposed benefits at no additional subscription charge:

- Vehicle cover: up to R30,000.
- Accidental disability cover: up to R100,000.
- Accident-related daily support: up to R1,000 per eligible day.

These are benefit limits requested for the product design. They are not a promise of insurance cover and must not be described as active cover until an insurer or authorised underwriting partner has accepted the risk, issued a policy and confirmed the cover period.

## Subscription eligibility

The driver's SwiftHaul account must have `user_profiles.account_status = 'active'` and a verified paid membership that is currently active.

- Monthly plan: the current verified monthly membership must be preceded by another verified monthly membership whose paid period ended no more than seven days before the current membership began. This is the second consecutive monthly payment month.
- Yearly plan: one verified R1,800 upfront payment qualifies for the subscription eligibility test for the active annual membership.
- A pending checkout, failed payment, expired membership, inactive account or a gap longer than seven days between monthly paid periods does not qualify.

The eligibility test is performed server-side in `driver-insurance-status`; the browser does not decide entitlement.

## Policy activation guard

The database stores insurer policy details separately in `driver_insurance_policies`. The Driver app displays the limits and eligibility status, but only displays insurance as active when all of the following are true:

1. The subscription eligibility test passes.
2. An insurer name and unique policy reference are recorded.
3. The policy status is active.
4. The policy coverage start and end dates contain the current time.

A qualifying subscription without an insurer-issued active policy is shown as **eligible — policy activation pending**, not insured.

## Items required before public launch

SwiftHaul must obtain insurer/underwriter confirmation and approved policy wording for:

- Whether the R30,000 vehicle cover is comprehensive, third-party, theft/fire, or another defined cover; which vehicle(s) are insured; excesses; valuation and claims requirements.
- Whether R100,000 disability cover applies to permanent disability, temporary disability, or both; impairment definitions; waiting periods; exclusions and evidence requirements.
- Whether R1,000 per day is income replacement, medical cash benefit or reimbursement; the maximum payable days per incident and policy year; waiting period; qualifying inability-to-work test and medical evidence.
- Accident definitions, territorial limits, premium funding, cancellation and lapse rules, claim submission deadlines, fraud controls, insurer complaint/escalation details and POPIA handling of medical/claim data.

Do not activate any policy record or advertise guaranteed cover until the insurer has approved these terms and the operational claims process.

## Deployment and testing

1. Apply `20261107220000_driver_premium_insurance_benefits.sql` in the intended Supabase environment.
2. Deploy `driver-insurance-status`.
3. Configure the insurer/policy integration and populate `driver_insurance_policies` only with confirmed policy details.
4. Test inactive accounts, first monthly payment, second consecutive monthly payment, monthly lapse over seven days, yearly upfront payment, expired membership, suspended policy and active insurer policy.
5. Confirm that no UI or API response describes a driver as insured when no active insurer policy is recorded.

No production migration, Edge Function deployment, insurer integration or policy activation is performed by this code change.
