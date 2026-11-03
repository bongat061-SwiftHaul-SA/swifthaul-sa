import {transaction} from '../lib/wallet.mts';
import {RouteError} from '../lib/delivery.mts';
import {getUser, admin} from '@netlify/identity';
import {getDatabase} from '@netlify/database';
import {getStore} from '@netlify/blobs';
import {createHash} from 'node:crypto';
export default async (req: Request) => {
  const headers={'Cache-Control':'no-store'};
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
  if (!['GET','PUT','POST','DELETE'].includes(req.method)) return reply({error:'Method not allowed'},405);
  if (req.method!=='GET' && req.headers.get('origin')!==new URL(req.url).origin) return reply({error:'Invalid request origin'},403);
  const user=await getUser(); if (!user) return reply({error:'Sign in to manage your profile.'},401);
  const owner=createHash('sha256').update(`identity:${user.id}`).digest('hex');
  try {
    const db=getDatabase();
    const store=getStore({name:'customer-photos',consistency:'strong'});
    const [deleted]=await db.sql`SELECT owner_hash FROM customer_deletions WHERE owner_hash=${owner}`;
    if(deleted && req.method==='GET' && !new URL(req.url).searchParams.has('photo')) return reply({deletion_pending:true});
    if (deleted && req.method!=='DELETE') return reply({error:'This profile is being deleted.'},403);
    const photo=new URL(req.url).searchParams.has('photo');
    if (req.method==='GET' && photo) {
      const blob=await store.get(owner,{type:'blob'});
      if (!blob) return new Response(null,{status:404,headers});
      return new Response(blob,{headers:{...headers,'Content-Type':'image/jpeg','X-Content-Type-Options':'nosniff'}});
    }
    if (req.method==='POST' && photo) {
      if (req.headers.get('content-type')!=='image/jpeg') return reply({error:'Upload a JPEG photo.'},400);
      if (Number(req.headers.get('content-length'))>2*1024*1024) return reply({error:'Photo must be smaller than 2 MB.'},413);
      const bytes=await req.arrayBuffer(); const data=new Uint8Array(bytes);
      if (bytes.byteLength>2*1024*1024 || data.length<4 || data[0]!==255 || data[1]!==216 || data[2]!==255 || data[data.length-2]!==255 || data[data.length-1]!==217) return reply({error:'Upload a valid JPEG smaller than 2 MB.'},400);
      await store.set(owner,bytes);return reply({saved:true});
    }
    if (req.method==='GET') {
      const [profile]=await db.sql`SELECT full_name,phone,details,bank_name,account_holder,branch_code,RIGHT(account_number,4) AS bank_last_four FROM customer_profiles WHERE owner_hash=${owner}`;
      return reply({profile:profile || {}});
    }
    let body;try {const text=await req.text();if(text.length>12000) return reply({error:'Request too large'},413);body=JSON.parse(text);}catch{return reply({error:'Invalid profile data'},400);}
    if (req.method==='DELETE') {
      if (body?.confirmation!=='DELETE') return reply({error:'Type DELETE to confirm.'},400);
      await transaction(async tx=>{
        await tx.query('SELECT pg_advisory_xact_lock(713805)');
        const {rows:[financial]}=await tx.query(`SELECT (SELECT COUNT(*) FROM wallet_accounts WHERE owner_hash=$1 AND (refund_cents>0 OR promo_cents>0 OR promo_debt_cents>0))+(SELECT COUNT(*) FROM wallet_loans WHERE owner_hash=$1 AND paid_at IS NULL)+(SELECT COUNT(*) FROM wallet_payments WHERE owner_hash=$1 AND state='created')+(SELECT COUNT(*) FROM wallet_withdrawals WHERE owner_hash=$1 AND state IN ('queued','processing')) AS unsettled`,[owner]);
        if(Number(financial.unsettled)>0)throw new RouteError('Settle wallet balances, repayments, pending payments and withdrawals before deleting this profile.',409);
        await tx.query('INSERT INTO customer_deletions(owner_hash) VALUES($1) ON CONFLICT DO NOTHING',[owner]);
      });
      await db.sql`DELETE FROM customer_bookings WHERE owner_hash=${owner}`;
      await db.sql`DELETE FROM delivery_quotes WHERE owner_hash=${owner}`;
      await db.sql`DELETE FROM customer_profiles WHERE owner_hash=${owner}`;
      await store.delete(owner);
      await admin.deleteUser(user.id);
      return reply({deleted:true});
    }
    if (req.method!=='PUT') return reply({error:'Method not allowed'},405);
    const limits={full_name:120,phone:40,details:2000,bank_name:120,account_holder:120,account_number:30,branch_code:12};
    if (!body || Object.entries(limits).some(([key,max])=>typeof body[key]!=='string'||body[key].length>max)) return reply({error:'Check your profile fields and their lengths.'},400);
    if (body.account_number && !/^\d{5,30}$/.test(body.account_number) || body.branch_code && !/^\d{3,12}$/.test(body.branch_code)) return reply({error:'Use digits for account number and branch code.'},400);
    const banking=[body.bank_name,body.account_holder,body.account_number,body.branch_code];
    if(body.replace_bank && banking.some((value:string)=>value.trim()) && !banking.every((value:string)=>value.trim())) return reply({error:'Complete all banking fields, or leave all empty to remove banking details.'},400);
    if (typeof body.replace_bank!=='boolean') return reply({error:'Choose whether to replace banking details.'},400);
    await db.sql`INSERT INTO customer_profiles(owner_hash,full_name,phone,details,bank_name,account_holder,account_number,branch_code)
      VALUES (${owner},${body.full_name.trim()},${body.phone.trim()},${body.details.trim()},${body.replace_bank?body.bank_name.trim():''},${body.replace_bank?body.account_holder.trim():''},${body.replace_bank?body.account_number:''},${body.replace_bank?body.branch_code:''})
      ON CONFLICT(owner_hash) DO UPDATE SET full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,details=EXCLUDED.details,
      bank_name=CASE WHEN ${body.replace_bank} THEN EXCLUDED.bank_name ELSE customer_profiles.bank_name END,
      account_holder=CASE WHEN ${body.replace_bank} THEN EXCLUDED.account_holder ELSE customer_profiles.account_holder END,
      account_number=CASE WHEN ${body.replace_bank} THEN EXCLUDED.account_number ELSE customer_profiles.account_number END,
      branch_code=CASE WHEN ${body.replace_bank} THEN EXCLUDED.branch_code ELSE customer_profiles.branch_code END,updated_at=NOW()`;
    return reply({saved:true});
  } catch(error) {return reply({error:error instanceof RouteError?error.message:'Unable to complete this profile action. Please retry.'},error instanceof RouteError?error.status:503);}
};
export const config={path:'/api/customer-profile'};
