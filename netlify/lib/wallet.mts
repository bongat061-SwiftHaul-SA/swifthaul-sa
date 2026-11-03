import {getDatabase} from '@netlify/database';
import {createHash,randomUUID} from 'node:crypto';
import {RouteError} from './delivery.mts';
export type Tx=Awaited<ReturnType<ReturnType<typeof getDatabase>['pool']['connect']>>;
export const ownerHash=(id:string)=>createHash('sha256').update(`identity:${id}`).digest('hex');
export const cents=(value:unknown)=>{
 if((typeof value!=='number'&&typeof value!=='string')||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))throw new RouteError('Invalid monetary amount.',400);
 const [whole,fraction='']=String(value).split('.');const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(amount<=0n||amount>BigInt(Number.MAX_SAFE_INTEGER))throw new RouteError('Invalid monetary amount.',400);
 return Number(amount);
};
export function withdrawalFee(gross:number,speed:string){if(!Number.isSafeInteger(gross)||gross<=0||!['instant','standard'].includes(speed))throw new RouteError('Choose an amount and withdrawal speed.',400);const fee=speed==='instant'?Math.round(gross*0.025)+500:200;if(gross<=fee)throw new RouteError('The withdrawal amount must exceed its processing fee.',400);return fee;}
export async function transaction<T>(fn:(tx:Tx)=>Promise<T>){const tx=await getDatabase().pool.connect();try{await tx.query('BEGIN');const value=await fn(tx);await tx.query('COMMIT');return value;}catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}}
export async function account(tx:Tx,owner:string,referral?:string){
 const deleted=await tx.query('SELECT 1 FROM customer_deletions WHERE owner_hash=$1',[owner]);if(deleted.rows.length)throw new RouteError('This profile is being deleted.',403);
 const code='SH'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
 await tx.query(`INSERT INTO wallet_accounts(owner_hash,referral_code,referred_by) VALUES($1,$2,(SELECT owner_hash FROM wallet_accounts WHERE referral_code=$3 AND owner_hash<>$1)) ON CONFLICT(owner_hash) DO NOTHING`,[owner,code,referral || null]);
 return(await tx.query('SELECT * FROM wallet_accounts WHERE owner_hash=$1 FOR UPDATE',[owner])).rows[0];
}
export async function ledger(tx:Tx,owner:string,key:string,refund:number,promo:number,description:string,debt=0){
 if(promo>0){const wallet=(await tx.query('SELECT promo_debt_cents FROM wallet_accounts WHERE owner_hash=$1 FOR UPDATE',[owner])).rows[0];const offset=Math.min(promo,Number(wallet.promo_debt_cents));promo-=offset;debt-=offset;}
 const inserted=await tx.query('INSERT INTO wallet_ledger(id,owner_hash,event_key,refund_delta,promo_delta,description,promo_debt_delta) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_key) DO NOTHING RETURNING id',[randomUUID(),owner,key,refund,promo,description,debt]);
 if(inserted.rows.length)await tx.query('UPDATE wallet_accounts SET refund_cents=refund_cents+$2,promo_cents=promo_cents+$3,promo_debt_cents=promo_debt_cents+$4 WHERE owner_hash=$1',[owner,refund,promo,debt]);
}
export async function reward(tx:Tx,waybill:string){
 const first=(await tx.query('SELECT owner_hash FROM customer_bookings WHERE waybill=$1',[waybill])).rows[0];if(!first)return;
 // Shared transaction lock prevents cross-account referral deadlocks and serializes reward qualification.
 await tx.query("SELECT pg_advisory_xact_lock(713805)");
 const wallet=await account(tx,first.owner_hash);
 const order=(await tx.query('SELECT * FROM customer_bookings WHERE waybill=$1 FOR UPDATE',[waybill])).rows[0];
 if(!order.paid_at||!order.completed_at||order.rewards_at||order.refunded_at)return;
 await tx.query('UPDATE customer_bookings SET rewards_at=NOW() WHERE waybill=$1',[waybill]);
 const count=(await tx.query(`SELECT COUNT(*)::int AS n FROM customer_bookings WHERE owner_hash=$1 AND rewards_at IS NOT NULL AND DATE_TRUNC('month',rewards_at AT TIME ZONE 'Africa/Johannesburg')=DATE_TRUNC('month',NOW() AT TIME ZONE 'Africa/Johannesburg')`,[order.owner_hash])).rows[0].n;
 const fare=cents(order.price);
 if(count>=4)await ledger(tx,order.owner_hash,'loyalty:'+waybill,0,Math.round(fare*0.2),'20% monthly loyalty credit · '+waybill);
 const previous=(await tx.query('SELECT COUNT(*)::int AS n FROM customer_bookings WHERE owner_hash=$1 AND rewards_at IS NOT NULL',[order.owner_hash])).rows[0].n;
 if(previous===1 && wallet.referred_by){
  const closed=(await tx.query('SELECT 1 FROM customer_deletions WHERE owner_hash=$1',[wallet.referred_by])).rows.length;
  const bonus=Math.round(fare*0.15);
  await ledger(tx,order.owner_hash,'referral-new:'+waybill,0,bonus,'15% first-delivery referral credit');
  if(!closed){await account(tx,wallet.referred_by);await ledger(tx,wallet.referred_by,'referral-invite:'+waybill,0,bonus,'15% successful referral credit');}
 }
}
export async function lockFinancial(tx:Tx,owner:string){await tx.query('SELECT pg_advisory_xact_lock(713805)');return account(tx,owner);}
export function nextBusinessDay(now=new Date()){const date=new Date(now);date.setUTCDate(date.getUTCDate()+1);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1);return date.toISOString();}
