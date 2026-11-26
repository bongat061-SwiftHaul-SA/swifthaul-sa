const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');

const customer = read('public/customer.js');
const customerHtml = read('public/customer.html');
const walletHtml = read('public/wallet.html');
const walletJs = read('public/wallet.js');
const portal = read('supabase/functions/customer-portal/index.ts');
const initialize = read('supabase/functions/paystack-payment-initialize/index.ts');
const webhook = read('supabase/functions/paystack-webhook/index.ts');
const earningsMigration = read('supabase/migrations/20261127000100_credit_driver_share_only_after_payment.sql');

for (const [name, source] of [['Customer JavaScript', customer], ['Customer page', customerHtml], ['Wallet page', walletHtml], ['Wallet JavaScript', walletJs]]) {
  assert.doesNotMatch(source, /PayFast|payfast|EFT payment instructions|EFT instructions|payfast-wallet-checkout/, name + ' must not expose the retired PayFast/EFT checkout path.');
}
for (const [name, source] of [['Customer page', customerHtml], ['Wallet page', walletHtml]]) {
  assert.match(source, /value="card"[^>]*>Pay online by card · Paystack/, name + ' must offer Paystack card payment.');
  assert.match(source, /value="cash"/, name + ' must retain the cash option.');
  assert.doesNotMatch(source, /wallet-payment-option|value="wallet"/, name + ' must not offer wallet-funded booking.');
}
assert.match(customer, /functions\.invoke\('paystack-payment-initialize'/, 'Customer card checkout must be initialized server-side.');
assert.match(customer, /namedItem\(key\)\?\.value/, 'Legacy load preview must tolerate fields removed by the current cargo estimator.');
assert.match(customer, /order\.payment_method!=='cash'&&order\.counter_offer_status!=='pending'/, 'Paystack action must not appear for cash bookings or unresolved counter-offers.');
assert.match(customer, /payment_method==='dispatch' && !counterSelected/, 'Admin review selection must be reserved for counter-offer bookings.');
assert.match(portal, /const method = body\.payment_method \?\? "card"/, 'New bookings must default to Paystack card payment.');
assert.match(portal, /method !== "cash" && method !== "dispatch" && method !== "card"/, 'Booking API must reject wallet-funded bookings.');
assert.match(portal, /method === "dispatch" && offer === null/, 'Booking API must reject dispatch/admin-review bookings without a counter-offer.');
assert.doesNotMatch(portal, /create_wallet_funded_booking/, 'Customer booking API must not call the paused wallet-funding RPC.');
assert.match(initialize, /secret\.startsWith\("sk_test_"/, 'Staging Paystack initialization must reject live secret keys.');
assert.match(initialize, /const ownerHash=u\.user\.id/, 'Paystack initialization must use the same Supabase Auth UUID stored by customer-portal.');
assert.doesNotMatch(initialize, /identity:/, 'Paystack initialization must not hash the owner ID differently from customer-portal.');
assert.match(webhook, /x-paystack-signature/, 'Paystack webhook must validate the provider signature.');
assert.match(webhook, /apply_paystack_payment/, 'Paystack webhook must apply only verified payments.');
assert.match(walletJs, /withdraw-form'\)\.hidden=true/, 'Customer withdrawals must remain hidden while unsupported.');
assert.match(walletJs, /wallet balances and history are read-only/i, 'Wallet must clearly communicate read-only status.');
assert.match(earningsMigration, /new\.paid_at is null/, 'Driver earnings must not be credited before payment is confirmed.');
assert.match(earningsMigration, /after update of status, paid_at/, 'Earnings trigger must run when either delivery or payment is confirmed.');
assert.match(earningsMigration, /old\.paid_at is null/, 'The trigger must support cash paid after delivery.');
console.log('Customer payment and wallet safety checks passed.');
