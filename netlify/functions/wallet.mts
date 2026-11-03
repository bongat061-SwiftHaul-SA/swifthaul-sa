import {getUser} from '@netlify/identity';
import {getDatabase} from '@netlify/database';
import {randomUUID} from 'node:crypto';
import {transaction,account,lockFinancial,ownerHash,cents,withdrawalFee,ledger,reward,nextBusinessDay} from '../lib/wallet.mts';
import {paymentReady,paystack} from '../lib/paystack.mts';
import {RouteError} from '../lib/delivery.mts';
export default async(req:Request)=>{
 const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'Invalid request origin'},403);
 const user=await getUser();if(!user)return reply({error:'Sign in to use your wallet.'},401);
 const owner=ownerHash(user.id),db=getDatabase();
 try{
  await transaction(tx=>account(tx,owner,typeof user.appMetadata?.signup_referral==='string'?user.appMetadata.signup_referral:undefined));
  if(req.method==='GET'){
   if(new URL(req.url).searchParams.has('banks')){if(!paymentReady())return reply({banks:[]});const banks=await paystack('/bank?country=south%20africa&currency=ZAR');return reply({banks:banks.map((bank:{name:string,code:string})=>({name:bank.name,code:bank.code}))});}
   const [wallet]=await db.sql`SELECT referral_code,refund_cents::text,promo_cents::text,promo_debt_cents::text FROM wallet_accounts WHERE owner_hash=${owner}`;
   const entries=await db.sql`SELECT id,refund_delta::text,promo_delta::text,promo_debt_delta::text,description,created_at FROM wallet_ledger WHERE owner_hash=${owner} ORDER BY created_at DESC LIMIT 100`;
   const loans=await db.sql`SELECT id,waybill,amount_cents::text,due_at,paid_at FROM wallet_loans WHERE owner_hash=${owner} ORDER BY created_at DESC LIMIT 100`;
   const withdrawals=await db.sql`SELECT reference,gross_cents::text,fee_cents::text,net_cents::text,speed,state,created_at FROM wallet_withdrawals WHERE owner_hash=${owner} ORDER BY created_at DESC LIMIT 100`;
   const [eligibility]=await db.sql`SELECT (SELECT COUNT(*)::int FROM customer_bookings WHERE owner_hash=${owner} AND completed_at IS NOT NULL) AS completed,(SELECT COALESCE(SUM(amount_cents),0)::text FROM wallet_loans WHERE owner_hash=${owner} AND paid_at IS NULL) AS outstanding,(SELECT COUNT(*)::int FROM wallet_loans WHERE owner_hash=${owner} AND paid_at IS NULL AND due_at<NOW()) AS overdue`;
   return reply({wallet,entries,loans,withdrawals,eligibility:{...eligibility,verified:!!user.confirmedAt,limit_cents:50000},provider_ready:paymentReady()});
  }
  let body;try{const raw=await req.text();if(raw.length>8192)return reply({error:'Request too large'},413);body=JSON.parse(raw);}catch{return reply({error:'Invalid wallet request'},400);}
  if(!body||typeof body.action!=='string')return reply({error:'Choose a wallet action.'},400);
  if(body.action==='withdraw'){
   if(!paymentReady())throw new RouteError('Withdrawals are not configured yet.',503);
   const gross=cents(body.amount),fee=withdrawalFee(gross,body.speed);
   if(typeof body.request_id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.request_id)||typeof body.bank_code!=='string'||!/^\d{2,12}$/.test(body.bank_code))throw new RouteError('Choose a bank and retry the withdrawal.',400);
   const reference='shw-'+body.request_id;
   const [existing]=await db.sql`SELECT reference,state FROM wallet_withdrawals WHERE reference=${reference} AND owner_hash=${owner}`;
   if(existing)return reply({withdrawal:existing});
   const [bank]=await db.sql`SELECT account_holder,account_number FROM customer_profiles WHERE owner_hash=${owner}`;
   if(!bank?.account_holder||!bank.account_number)throw new RouteError('Save your banking details in Settings before withdrawing.',400);
   const recipient=await paystack('/transferrecipient',{type:'basa',name:bank.account_holder,account_number:bank.account_number,bank_code:body.bank_code,currency:'ZAR'});
   const withdrawal=await transaction(async tx=>{
    const wallet=await lockFinancial(tx,owner);
    const prior=(await tx.query('SELECT reference,state FROM wallet_withdrawals WHERE reference=$1 AND owner_hash=$2',[reference,owner])).rows[0];if(prior)return prior;
    if(Number(wallet.refund_cents)<gross)throw new RouteError('Only your available refund balance can be withdrawn.',409);
    await ledger(tx,owner,'reserve:'+reference,-gross,0,'Withdrawal reserved · '+reference);
    return(await tx.query('INSERT INTO wallet_withdrawals(reference,owner_hash,gross_cents,fee_cents,net_cents,speed,recipient_code,available_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING reference,state',[reference,owner,gross,fee,gross-fee,body.speed,recipient.recipient_code,body.speed==='instant'?new Date().toISOString():nextBusinessDay()])).rows[0];
   });return reply({withdrawal},201);
  }
  const checkout=body.action==='checkout'||body.action==='repay';
  if(checkout&&!paymentReady())throw new RouteError('Online payments are not configured yet.',503);
  if(!['checkout','repay','wallet-pay','pay-later'].includes(body.action))throw new RouteError('Unknown wallet action.',400);
  if((body.action==='repay'&&typeof body.loan_id!=='string')||(body.action!=='repay'&&typeof body.waybill!=='string'))throw new RouteError('Choose a booking or repayment.',400);
  const result=await transaction(async tx=>{
   const wallet=await lockFinancial(tx,owner);
   if(body.action==='repay'){
    const loan=(await tx.query('SELECT * FROM wallet_loans WHERE id=$1 AND owner_hash=$2 FOR UPDATE',[body.loan_id,owner])).rows[0];
    if(!loan||loan.paid_at)throw new RouteError('This repayment is unavailable or already paid.',409);
    const prior=(await tx.query("SELECT * FROM wallet_payments WHERE loan_id=$1 AND state='created'",[loan.id])).rows[0];
    if(prior)return prior;
    return(await tx.query('INSERT INTO wallet_payments(reference,owner_hash,loan_id,amount_cents) VALUES($1,$2,$3,$4) RETURNING *',['shp-'+randomUUID(),owner,loan.id,loan.amount_cents])).rows[0];
   }
   const order=(await tx.query('SELECT * FROM customer_bookings WHERE waybill=$1 AND owner_hash=$2 FOR UPDATE',[body.waybill,owner])).rows[0];
   if(!order||order.refunded_at)throw new RouteError('Booking unavailable.',404);
   if(order.paid_at)return {paid:true};
   if(order.payment_source==='pay_later')throw new RouteError('Use the repayment button for this pay-later balance.',409);
   const total=cents(order.price);
   const pending=(await tx.query("SELECT * FROM wallet_payments WHERE waybill=$1 AND state='created'",[order.waybill])).rows[0];
   if(pending){if(body.action==='checkout')return pending;throw new RouteError('A card checkout is pending for this booking. Complete it before changing payment method.',409);}
   if(body.action==='checkout')return(await tx.query('INSERT INTO wallet_payments(reference,owner_hash,waybill,amount_cents) VALUES($1,$2,$3,$4) RETURNING *',['shp-'+randomUUID(),owner,order.waybill,total])).rows[0];
   if(body.action==='wallet-pay'){
    if(Number(wallet.refund_cents)+Number(wallet.promo_cents)<total)throw new RouteError('Your wallet balance does not cover this fare.',409);
    const promo=Math.min(total,Number(wallet.promo_cents)),refund=total-promo;
    await ledger(tx,owner,'pay:'+order.waybill,-refund,-promo,'Delivery paid from wallet · '+order.waybill);
    await tx.query("UPDATE customer_bookings SET counter_offer_status=CASE WHEN counter_offer_status='pending' THEN 'declined' ELSE counter_offer_status END,paid_at=NOW(),payment_source='wallet',wallet_refund_used=$2,wallet_promo_used=$3 WHERE waybill=$1",[order.waybill,refund,promo]);
    await reward(tx,order.waybill);return {paid:true};
   }
   if(!paymentReady())throw new RouteError('Pay later is unavailable until online repayment is configured.',503);
   if(!user.confirmedAt)throw new RouteError('Verify your account before using pay later.',403);
   const completed=(await tx.query('SELECT COUNT(*)::int AS n FROM customer_bookings WHERE owner_hash=$1 AND completed_at IS NOT NULL',[owner])).rows[0].n;
   const loans=(await tx.query('SELECT COALESCE(SUM(amount_cents),0)::text AS total,COUNT(*) FILTER(WHERE due_at<NOW())::int AS overdue FROM wallet_loans WHERE owner_hash=$1 AND paid_at IS NULL',[owner])).rows[0];
   if(completed<3||loans.overdue||total>50000||Number(loans.total)+total>50000)throw new RouteError('Pay later requires 3 completed deliveries, no overdue balance, and total borrowing of R500 or less.',409);
   await tx.query('INSERT INTO wallet_loans(id,owner_hash,waybill,amount_cents) VALUES($1,$2,$3,$4)',[randomUUID(),owner,order.waybill,total]);
   await tx.query("UPDATE customer_bookings SET counter_offer_status=CASE WHEN counter_offer_status='pending' THEN 'declined' ELSE counter_offer_status END,payment_source='pay_later' WHERE waybill=$1",[order.waybill]);return {pay_later:true};
  });
  if(checkout&&result.reference){
   if(result.checkout_url)return reply({checkout_url:result.checkout_url});
   const data=await paystack('/transaction/initialize',{email:user.email,amount:Number(result.amount_cents),currency:'ZAR',reference:result.reference,callback_url:new URL('/?payment=return#wallet',req.url).href});
   const url=new URL(data.authorization_url);if(url.protocol!=='https:'||url.hostname!=='checkout.paystack.com')throw new RouteError('Unexpected checkout address.',502);
   await db.sql`UPDATE wallet_payments SET checkout_url=${url.href} WHERE reference=${result.reference} AND owner_hash=${owner}`;
   return reply({checkout_url:url.href});
  }
  return reply(result);
 }catch(error){return reply({error:error instanceof RouteError?error.message:'Wallet services are temporarily unavailable. Please retry.'},error instanceof RouteError?error.status:503);}
};
export const config={path:'/api/wallet'};
