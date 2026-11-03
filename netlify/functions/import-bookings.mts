import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { createHash } from 'node:crypto';

// Import only after an explicit action by the signed-in customer in the original browser.
export default async (req: Request) => {
  const headers = new Headers({'Cache-Control':'no-store'});
  const respond = (body: unknown, status = 200) => Response.json(body,{status,headers});
  if (req.method !== 'POST') {headers.set('Allow','POST');return respond({error:'Method not allowed'},405);}
  if (req.headers.get('origin') !== new URL(req.url).origin) return respond({error:'Invalid request origin'},403);
  const user = await getUser();
  if (!user) return respond({error:'Sign in required.'},401);
  const legacy = req.headers.get('cookie')?.match(/(?:^|;\s*)swifthaul_customer=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!legacy) return respond({imported:0});
  const oldOwner = createHash('sha256').update(legacy).digest('hex');
  const owner = createHash('sha256').update(`identity:${user.id}`).digest('hex');
  try {
    const db = getDatabase();
    const [deleted]=await db.sql`SELECT owner_hash FROM customer_deletions WHERE owner_hash=${owner}`;
    if(deleted) return respond({error:"This profile is being deleted."},403);
    const imported = await db.sql`UPDATE customer_bookings SET owner_hash = ${owner} WHERE owner_hash = ${oldOwner} RETURNING waybill`;
    headers.set('Set-Cookie',`swifthaul_customer=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`);
    return respond({imported:imported.length});
  } catch {return respond({error:'Import is temporarily unavailable. Please try again.'},503);}
};
export const config = {path:'/api/import-browser-bookings'};
