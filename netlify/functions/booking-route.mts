import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { createHash } from 'node:crypto';

import { getDeliveryRoute, RouteError } from '../lib/delivery.mts';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method !== 'POST') return Response.json({error:'Method not allowed'}, {status:405, headers:{...headers, Allow:'POST'}});
  if (req.headers.get('origin') !== new URL(req.url).origin) return respond({error:'Invalid request origin'},403);
  const user = await getUser();
  if (!user) return respond({error:'Sign in to preview your delivery route.'},401);
  let waybill: unknown;
  try {
    const text = await req.text();
    if (text.length > 1024) return respond({error:'Request too large'},413);
    waybill = JSON.parse(text)?.waybill;
  } catch { return respond({error:'Choose a valid booking.'},400); }
  if (typeof waybill !== 'string' || !/^SH-[A-Z0-9-]{1,80}$/i.test(waybill)) return respond({error:'Choose a valid booking.'},400);

  const owner = createHash('sha256').update(`identity:${user.id}`).digest('hex');
  let order;
  try {
    const db = getDatabase();
    const [deleted]=await db.sql`SELECT owner_hash FROM customer_deletions WHERE owner_hash=${owner}`;
    if(deleted) return respond({error:"This profile is being deleted."},403);
    [order] = await db.sql`SELECT b.pickup, b.dropoff, q.route FROM customer_bookings b LEFT JOIN delivery_quotes q ON q.id = b.quote_id WHERE b.waybill = ${waybill} AND b.owner_hash = ${owner} LIMIT 1`;
  } catch { return respond({error:'Bookings are temporarily unavailable. Please try again.'},503); }
  if (!order) return respond({error:'Booking not found.'},404);

  try {
    return respond(order.route || await getDeliveryRoute(order.pickup,order.dropoff));
  } catch (error) {
    return respond({error:error instanceof RouteError ? error.message : 'Route preview unavailable.'},error instanceof RouteError ? error.status : 502);
  }
};
export const config = {path:'/api/booking-route'};
