# Driver Premium insurance benefits

## Proposed benefit schedule

The Premium subscription includes these proposed benefits at no additional subscription charge:

- Vehicle cover: up to R30,000.
- Accidental disability cover: up to R100,000.
- Accident-related daily support: R1,000 per eligible day, for a maximum of five days per accident claim (R5,000 maximum).

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
2. Deploy `driver-premium`, `driver-membership-checkout`, `driver-insurance-status` and the updated `payfast-itn` function. Configure PayFast sandbox merchant credentials and `DRIVER_APP_URL`.
3. Confirm the PayFast notification URL reaches the updated `payfast-itn` endpoint; membership payments use `SH-MEMBER-PF-<membership UUID>` references and the existing verified membership activation RPC.
4. Configure the insurer/policy integration and populate `driver_insurance_policies` only with confirmed policy details.
5. Test inactive accounts, first monthly payment, second consecutive monthly payment, monthly lapse over seven days, yearly upfront payment, expired membership, suspended policy and active insurer policy.
6. Confirm that no UI or API response describes a driver as insured when no active insurer policy is recorded.

No production migration, Edge Function deployment, insurer integration or policy activation is performed by this code change.

## Dispatch-only accident cover and route compliance

Insurance applies only while the driver is actively carrying out an assigned dispatch:
- after accepting the assignment, while travelling to the customer's pickup address; or
- after collection, while travelling to the delivery address.

Being online, waiting for an offer, or travelling without an assigned dispatch is not covered. The driver must keep the app's live GPS route sharing active for the assigned trip. The server records private GPS evidence against the assigned waybill while the dispatch is in an accepted, picked-up or in-transit state. Claims are rejected at intake if the driver is not the assigned driver, the incident is outside the accepted dispatch interval, the policy or Premium eligibility was not active at the incident time, or there is no GPS point within two minutes of the reported incident.

Unnecessary stops or diversions from the authorised route are grounds for the insurer to decline a claim, subject to the final policy wording and exceptions for emergencies, road closures, traffic control, safety and other insurer-approved reasons. Company Admin must inspect the available GPS trail against the planned route and record a reasoned route-compliance decision before an insurer approval can be recorded.

**Route evidence limitation:** the current app stores timestamped GPS points and the booking's planned route data where available. It does not yet perform reliable map-matching or automatically distinguish a necessary stop (traffic, safety, road closure) from an unnecessary stop. Admin route review is therefore a manual evidence check, not an automated finding. Insurer-approved tolerance rules and an actual route geometry source are required before automatic route-compliance decisions are enabled.

## Claim handling

- Driver claims are linked to a waybill and must be reported against an accepted assigned trip.
- Up to five PDF/image evidence files are accepted, each up to 10 MB, in a private storage bucket; the driver must explicitly consent to claim-evidence processing and relevant insurer sharing. Admin links expire after five minutes.
- Requested and approved daily benefit days are capped at five per accident claim. The server calculates the maximum at R1,000 per day (R5,000 per claim).
- Admin must record route compliance before insurer approval. A route breach blocks approval in the workflow.
- An insurer claim reference and insurer decision note are required. Payment is only recorded after insurer approval and a settlement/payment reference is supplied.
- Medical and claim evidence is sensitive. Access is restricted to the driver who owns the claim and active administrators. A retention/deletion schedule and POPIA-compliant insurer processing agreement must be agreed before launch.
