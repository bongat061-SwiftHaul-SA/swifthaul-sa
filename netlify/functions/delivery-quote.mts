import {getUser} from '@netlify/identity';
import {getDatabase} from '@netlify/database';
import {createHash,randomUUID} from 'node:crypto';
import {getDeliveryRoute,calculateDeliveryFare,calculateLoad,validText,RouteError} from '../lib/delivery.mts';
export default async (req: Request) => {
  const headers = {'Cache-Control':'no-store'};
  const respond = (body: unknown,status=200) => Response.json(body,{status,headers});
  if (req.method !== 'POST') return Response.json({error:'Method not allowed'},{status:405,headers:{...headers,Allow:'POST'}});
  if (req.headers.get('origin') !== new URL(req.url).origin) return respond({error:'Invalid request origin'},403);
  const user = await getUser();
  if (!user) return respond({error:'Sign in to calculate a delivery quote.'},401);
  let body;
  try {const text=await req.text();if (text.length>4096) return respond({error:'Request too large'},413);body=JSON.parse(text);} catch {return respond({error:'Enter valid delivery details.'},400);}
  if (!body || !validText(body.pickup) || !validText(body.dropoff)) return respond({error:'Enter pickup and drop-off addresses and the packed load details.'},400);
  let route,price,band,load,distanceFee;
  try {calculateLoad(body.parcel);route=await getDeliveryRoute(body.pickup.trim(),body.dropoff.trim());({price,band,load,distanceFee}=calculateDeliveryFare(body.parcel,route.distance));}
  catch(error) {return respond({error:error instanceof RouteError?error.message:'Unable to calculate the route.'},error instanceof RouteError?error.status:502);}
  try {
    const owner=createHash('sha256').update(`identity:${user.id}`).digest('hex');
    const id=randomUUID();const db=getDatabase();
    const [deleted]=await db.sql`SELECT owner_hash FROM customer_deletions WHERE owner_hash=${owner}`;
    if(deleted) return respond({error:"This profile is being deleted."},403);
    const [quote]=await db.sql`INSERT INTO delivery_quotes (id,owner_hash,pickup,dropoff,vehicle,distance_meters,price_band,price,route,load,distance_fee) VALUES (${id},${owner},${body.pickup.trim()},${body.dropoff.trim()},${load.vehicle},${route.distance},${band},${price},${JSON.stringify(route)}::jsonb,${JSON.stringify(load)}::jsonb,${distanceFee}) RETURNING id, expires_at`;
    return respond({quote:{id:quote.id,expires_at:quote.expires_at,price,band,vehicle:load.vehicle,route,load,distanceFee}});
  } catch {return respond({error:'Quotes are temporarily unavailable. Please try again.'},503);}
};
export const config={path:'/api/delivery-quote'};
