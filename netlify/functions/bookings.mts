import {transaction,account} from '../lib/wallet.mts';
import {validatePaymentOptions} from '../lib/payment-options.mts';
import {RouteError} from '../lib/delivery.mts';
import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { createHash, randomInt, randomUUID } from 'node:crypto';

export default async (req: Request) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (!['GET', 'POST'].includes(req.method)) {
    headers.set('Allow', 'GET, POST');
    return respond({ error: 'Method not allowed' }, 405);
  }
  if (req.method === 'POST' && req.headers.get('origin') !== new URL(req.url).origin) {
    return respond({ error: 'Invalid request origin' }, 403);
  }
  const user = await getUser();
  if (!user) return respond({ error: 'Sign in to view or create bookings.' }, 401);
  const owner = createHash('sha256').update(`identity:${user.id}`).digest('hex');
  try {
    const db = getDatabase();
    const [deleted]=await db.sql`SELECT owner_hash FROM customer_deletions WHERE owner_hash=${owner}`;
    if(deleted) return respond({error:"This profile is being deleted."},403);
    if (req.method === 'GET') {
      const orders = await db.sql`SELECT waybill, pin, pickup, dropoff, recipient, vehicle, price::text AS price, distance_meters, price_band, load, distance_fee::text AS distance_fee, scheduled_at, return_address, return_at, payment_method, counter_offer::text AS counter_offer, counter_offer_status, original_price::text AS original_price, paid_at, completed_at, payment_source, assigned_driver, refunded_at, created_at FROM customer_bookings WHERE owner_hash = ${owner} ORDER BY created_at DESC LIMIT 100`;
      return respond({ orders, canImport: /(?:^|;\s*)swifthaul_customer=[a-f0-9]{64}(?:;|$)/.test(req.headers.get('cookie') || '') });
    }
    if (Number(req.headers.get('content-length') || 0) > 8192) return respond({ error: 'Request too large' }, 413);
    let body;
    try { body = await req.json(); } catch { return respond({ error: 'Invalid booking data' }, 400); }
    if (!body || typeof body.quote_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.quote_id) || typeof body.recipient !== 'string' || !body.recipient.trim() || body.recipient.length > 500) {
      return respond({error:'Calculate a route quote and enter recipient details before booking.'},400);
    }
    await transaction(tx=>account(tx,owner,typeof user.appMetadata?.signup_referral==='string'?user.appMetadata.signup_referral:undefined));
    // Retry a consumed quote safely, including after its original expiry time.
    const [existing] = await db.sql`SELECT waybill, pin, pickup, dropoff, recipient, vehicle, price::text AS price, distance_meters, price_band, load, distance_fee::text AS distance_fee, scheduled_at, return_address, return_at, payment_method, counter_offer::text AS counter_offer, counter_offer_status, original_price::text AS original_price, paid_at, completed_at, payment_source, assigned_driver, refunded_at, created_at FROM customer_bookings WHERE quote_id = ${body.quote_id} AND owner_hash = ${owner}`;
    if (existing) return respond({order:existing});
    const [quote]=await db.sql`SELECT distance_meters FROM delivery_quotes WHERE id=${body.quote_id} AND owner_hash=${owner} AND expires_at>NOW() AND load IS NOT NULL`;
    if(!quote)return respond({error:'This quote has expired or is unavailable. Calculate the route again.'},409);
    let payment;try{payment=validatePaymentOptions(body,quote.distance_meters);}catch(error){return respond({error:error instanceof RouteError?error.message:'Invalid payment options.'},400);}
    const parseTime=(value:unknown)=> typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value)>Date.now() ? new Date(value).toISOString() : null;
    const scheduled=body.scheduled_at ? parseTime(body.scheduled_at) : null;
    const returnAddress=typeof body.return_address==='string' ? body.return_address.trim() : '';
    const returnAt=body.return_at ? parseTime(body.return_at) : null;
    if ((body.scheduled_at && !scheduled) || returnAddress.length>500 || (body.return_at && (!returnAt || !returnAddress)) || (scheduled && returnAt && Date.parse(returnAt)<Date.parse(scheduled))) return respond({error:'Use future pickup/return times, with the return after pickup, and a return address of at most 500 characters.'},400);
    const waybill = 'SH-' + randomUUID().toUpperCase();
    const pin = String(randomInt(1000, 10000));
    const [order] = await db.sql`INSERT INTO customer_bookings (waybill, owner_hash, pin, pickup, dropoff, recipient, vehicle, price, distance_meters, price_band, quote_id, load, distance_fee, scheduled_at, return_address, return_at, payment_method, counter_offer, counter_offer_status)
      SELECT ${waybill}, ${owner}, ${pin}, pickup, dropoff, ${body.recipient.trim()}, vehicle, price, distance_meters, price_band, id, load, distance_fee, ${scheduled}::timestamptz, ${returnAddress || null}, ${returnAt}::timestamptz, ${payment.method}, ${payment.offer}, ${payment.status} FROM delivery_quotes
      WHERE id = ${body.quote_id} AND owner_hash = ${owner} AND expires_at > NOW() AND load IS NOT NULL
      ON CONFLICT (quote_id) DO UPDATE SET quote_id = EXCLUDED.quote_id
      RETURNING waybill, pin, pickup, dropoff, recipient, vehicle, price::text AS price, distance_meters, price_band, load, distance_fee::text AS distance_fee, scheduled_at, return_address, return_at, payment_method, counter_offer::text AS counter_offer, counter_offer_status, original_price::text AS original_price, paid_at, completed_at, payment_source, assigned_driver, refunded_at, created_at`;
    if (!order) return respond({error:'This quote has expired or is unavailable. Calculate the route again.'},409);
    return respond({ order }, 201);
  } catch {
    return respond({ error: 'Bookings are temporarily unavailable. Please try again.' }, 503);
  }
};
export const config = { path: '/api/customer-bookings' };
