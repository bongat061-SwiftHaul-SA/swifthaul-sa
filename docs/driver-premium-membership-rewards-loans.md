# Premium driver membership, rewards and micro-loans

## Pricing and membership
- Monthly: R250 (25,000 cents).
- Annual: R1,800 prepaid for 12 months (180,000 cents); automatic renewal defaults off.
- Only a verified provider payment may activate a membership. A pending row is not an active subscription.
- One active membership per driver. Membership periods and payment revenue are stored separately from delivery earnings.
- Premium delivery priority is first access to eligible customer offers, not guaranteed allocation. Dispatch must retain eligibility, distance/vehicle suitability, availability and fair rotation rules.

## Premium rewards policy
- Fuel rebate: R15 per completed delivery while membership is active at completion time, subject to R450 maximum per calendar month.
- Milestone bonus: R500 once per calendar month when an active premium driver completes at least 10 deliveries in that calendar month.
- Availability bonuses are supported as a separate reward-ledger event. A bonus amount and qualifying availability window must be approved before automated awards are enabled.
- Fuel rebates and bonuses are distinct liabilities and must not be merged into the 75% base delivery earning.
- Fuel rebates reduce the Swift Haul base share for that delivery; milestone bonuses are funded from accumulated, verified premium subscription revenue.

## Micro-loan / cash advance rules
- Gate: driver account age at least 45 days and at least 15 lifetime successful deliveries.
- Dynamic cap: 25% of gross driver earnings in the rolling 14-day window, limited to R1,500.
- Repayment deduction: 15% of base driver earnings per completed delivery, recorded as a separate repayment event.
- The database settings default `micro_loans_enabled=false`; applications/loans carry a compliance hold.
- No loan is approved, offered, or disbursed until South African National Credit Act / NCR applicability, registration, affordability, disclosures, interest/fees, collections and consumer-protection requirements have been reviewed and signed off by qualified counsel/compliance.

## Database foundation applied
The migration creates private service-role-only tables for membership periods, subscription revenue, rewards, loan applications, loan balances and configurable financial policy. RLS is enabled and direct anon/authenticated table grants are revoked. The helper `driver_premium_active` checks a currently active membership period.

## Not yet activated
This migration is a schema foundation, not a complete payment or reward rollout. PayFast recurring/one-off membership checkout and verified membership payment activation, first-choice dispatch ranking, fuel-rebate and monthly bonus award triggers, availability bonus workflow, loan qualification/application endpoint, 15% repayment trigger, and admin financial reporting remain to be implemented and tested. No membership payment, reward or loan has been created by this migration.
