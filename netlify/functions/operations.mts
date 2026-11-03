import {getDatabase} from '@netlify/database';
import {operationsUser,driverKey} from '../lib/operations-auth.mts';
import {transaction,lockFinancial,account,cents,ledger,reward} from '../lib/wallet.mts';
import {RouteError} from '../lib/delivery.mts';
export default async(req:Request)=>{
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'Invalid request origin'},403);
 try{
  const actor=await operationsUser(req),db=getDatabase();
  if(req.method==='GET'){
   const columns=actor.app==='driver'?await db.sql`SELECT waybill,pickup,dropoff,recipient,vehicle,price::text,payment_method,payment_source,paid_at,completed_at,scheduled_at,return_address,load,pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash FROM customer_bookings WHERE assigned_driver=${driverKey(actor.id)} ORDER BY created_at DESC LIMIT 100`:await db.sql`SELECT waybill,pickup,dropoff,vehicle,price::text,original_price::text,counter_offer::text,counter_offer_status,assigned_driver,paid_at,completed_at,refunded_at,payment_source,pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash FROM customer_bookings ORDER BY created_at DESC LIMIT 100`;
   return reply({orders:columns});
  }
  const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
  if(!body||typeof body.waybill!=='string'||body.waybill.length>100)return reply({error:'Choose a delivery'},400);
  const result=await transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(713805)');
   const order=(await tx.query('SELECT * FROM customer_bookings WHERE waybill=$1 FOR UPDATE',[body.waybill])).rows[0];if(!order)throw new RouteError('Delivery not found.',404);
   if(actor.app==='driver'){
    if(order.assigned_driver!==driverKey(actor.id))throw new RouteError('Delivery not found.',404);
    if(body.action!=='complete'||typeof body.pin!=='string'||!/^\d{4}$/.test(body.pin))throw new RouteError('Enter the recipient’s four-digit PIN.',400);
    if(order.refunded_at)throw new RouteError('This delivery was refunded.',409);
    if(order.pin_locked_until&&new Date(order.pin_locked_until).getTime()>Date.now())throw new RouteError('PIN entry is locked. Retry in 15 minutes.',429);
    if(order.pin!==body.pin){
     const failures=order.pin_locked_until?1:Number(order.pin_attempts)+1;
     await tx.query("UPDATE customer_bookings SET pin_attempts=$2,pin_locked_until=CASE WHEN $2>=5 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE waybill=$1",[order.waybill,failures]);
     return {error:'Incorrect recipient PIN.',status:400};
    }
    if(body.cash_collected===true){
     if(order.payment_method!=='cash'||order.distance_meters>=12000||order.payment_source==='pay_later')throw new RouteError('Cash collection is not eligible for this delivery.',409);
     const pending=(await tx.query("SELECT 1 FROM wallet_payments WHERE waybill=$1 AND state='created'",[order.waybill])).rows.length;
     if(pending)throw new RouteError('Card checkout is pending; cash confirmation is unavailable.',409);
     if(!order.paid_at)await tx.query("UPDATE customer_bookings SET counter_offer_status=CASE WHEN counter_offer_status='pending' THEN 'declined' ELSE counter_offer_status END,paid_at=NOW(),payment_source='cash' WHERE waybill=$1",[order.waybill]);
    }
    await tx.query('UPDATE customer_bookings SET completed_at=COALESCE(completed_at,NOW()),pin_attempts=0,pin_locked_until=NULL WHERE waybill=$1',[order.waybill]);
    await reward(tx,order.waybill);return {completed:true};
   }
   if(body.action==='assign'){
    if(order.completed_at||order.refunded_at)throw new RouteError('This delivery is closed.',409);
    if(typeof body.driver_id!=='string'||!/^[a-zA-Z0-9-]{6,100}$/.test(body.driver_id))throw new RouteError('Enter the driver’s account ID.',400);
    await tx.query('UPDATE customer_bookings SET assigned_driver=$2 WHERE waybill=$1',[order.waybill,driverKey(body.driver_id)]);return {assigned:true};
   }
   if(body.action==='offer-accept'||body.action==='offer-decline'){
    const pending=(await tx.query("SELECT 1 FROM wallet_payments WHERE waybill=$1 AND state='created'",[order.waybill])).rows.length;
    if(order.paid_at||order.payment_source||order.refunded_at||pending||order.counter_offer_status!=='pending')throw new RouteError('This offer is no longer available for approval.',409);
    if(body.action==='offer-accept')await tx.query("UPDATE customer_bookings SET original_price=price,price=counter_offer,counter_offer_status='accepted' WHERE waybill=$1",[order.waybill]);
    else await tx.query("UPDATE customer_bookings SET counter_offer_status='declined' WHERE waybill=$1",[order.waybill]);return {updated:true};
   }
   if(body.action==='refund'){
    if(!order.paid_at||order.refunded_at)throw new RouteError('Only a paid, unrefunded delivery can be refunded.',409);
    await lockFinancial(tx,order.owner_hash);
    const promo=Number(order.wallet_promo_used),refund=order.payment_source==='wallet'?Number(order.wallet_refund_used):cents(order.price);
    await ledger(tx,order.owner_hash,'refund:'+order.waybill,refund,promo,'Delivery refunded to wallet · '+order.waybill);
    const credits=(await tx.query('SELECT * FROM wallet_ledger WHERE event_key IN ($1,$2,$3)', ['loyalty:'+order.waybill,'referral-new:'+order.waybill,'referral-invite:'+order.waybill])).rows;
    for(const credit of credits){
     const wallet=(await tx.query('SELECT * FROM wallet_accounts WHERE owner_hash=$1 FOR UPDATE',[credit.owner_hash])).rows[0];const original=Number(credit.promo_delta)-Number(credit.promo_debt_delta);const deduction=Math.min(Number(wallet.promo_cents),original);
     await ledger(tx,credit.owner_hash,'reverse:'+credit.event_key,0,-deduction,'Promotional credit reversed after refund',original-deduction);
    }
    await tx.query('UPDATE customer_bookings SET refunded_at=NOW() WHERE waybill=$1',[order.waybill]);return {refunded:true};
   }
   throw new RouteError('Unknown company action.',400);
  });return reply(result,result.status || 200);
 }catch(error){return reply({error:error instanceof RouteError?error.message:'Unable to update deliveries. Please retry.'},error instanceof RouteError?error.status:503);}
};
export const config={path:'/api/operations'};
