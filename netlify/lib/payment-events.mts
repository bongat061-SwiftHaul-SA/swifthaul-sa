import {getDatabase} from '@netlify/database';
import {transaction,lockFinancial,ledger,reward} from './wallet.mts';
import {paystack} from './paystack.mts';
export async function confirmCharge(reference:string){
 const verified=await paystack('/transaction/verify/'+encodeURIComponent(reference));
 if(verified.status!=='success'||verified.currency!=='ZAR'||verified.reference!==reference)return;
 await transaction(async tx=>{
  const found=(await tx.query('SELECT owner_hash FROM wallet_payments WHERE reference=$1',[reference])).rows[0];if(!found)return;
  await lockFinancial(tx,found.owner_hash);
  const payment=(await tx.query('SELECT * FROM wallet_payments WHERE reference=$1 FOR UPDATE',[reference])).rows[0];
  if(payment.state==='success'||Number(payment.amount_cents)!==Number(verified.amount))return;
  if(payment.state!=='created')throw new Error('Payment needs reconciliation');
  if(payment.loan_id){
   const loan=(await tx.query('SELECT * FROM wallet_loans WHERE id=$1 FOR UPDATE',[payment.loan_id])).rows[0];
   if(loan.paid_at)return;
   await tx.query('UPDATE wallet_loans SET paid_at=NOW() WHERE id=$1',[loan.id]);
   await tx.query('UPDATE customer_bookings SET paid_at=NOW() WHERE waybill=$1',[loan.waybill]);
   await reward(tx,loan.waybill);
  }else{
   const order=(await tx.query('SELECT * FROM customer_bookings WHERE waybill=$1 FOR UPDATE',[payment.waybill])).rows[0];
   if(!order||order.paid_at||Math.round(Number(order.price)*100)!==Number(payment.amount_cents))throw new Error('Payment needs reconciliation');
   await tx.query("UPDATE customer_bookings SET counter_offer_status=CASE WHEN counter_offer_status='pending' THEN 'declined' ELSE counter_offer_status END,paid_at=NOW(),payment_source='paystack' WHERE waybill=$1",[payment.waybill]);
   await reward(tx,payment.waybill);
  }
  await tx.query("UPDATE wallet_payments SET state='success' WHERE reference=$1",[reference]);
 });
}
export async function confirmTransfer(reference:string){
 const verified=await paystack('/transfer/verify/'+encodeURIComponent(reference));
 if(verified.reference!==reference||verified.currency!=='ZAR'||!['success','failed','reversed'].includes(verified.status))return;
 await transaction(async tx=>{
  const first=(await tx.query('SELECT owner_hash FROM wallet_withdrawals WHERE reference=$1',[reference])).rows[0];if(!first)return;
  await lockFinancial(tx,first.owner_hash);
  const withdrawal=(await tx.query('SELECT * FROM wallet_withdrawals WHERE reference=$1 FOR UPDATE',[reference])).rows[0];
  if(Number(verified.amount)!==Number(withdrawal.net_cents))return;
  if(verified.status==='success'){
   if(withdrawal.state!=='failed')await tx.query("UPDATE wallet_withdrawals SET state='paid' WHERE reference=$1",[reference]);
  }else{
   await ledger(tx,withdrawal.owner_hash,'release:'+reference,Number(withdrawal.gross_cents),0,'Failed/reversed withdrawal returned · '+reference);
   await tx.query("UPDATE wallet_withdrawals SET state='failed' WHERE reference=$1",[reference]);
  }
 });
}
export async function processPayments(){
 const db=getDatabase();
 const payments=await db.sql`SELECT reference FROM wallet_payments WHERE state='created' AND created_at<NOW()-INTERVAL '1 minute' ORDER BY created_at LIMIT 20`;
 for(const payment of payments){try{await confirmCharge(payment.reference);}catch{/* Provider status is retried on the next run. */}}
 const withdrawals=await db.sql`SELECT reference,net_cents,recipient_code,state FROM wallet_withdrawals WHERE state IN ('queued','processing') AND available_at<=NOW() ORDER BY created_at LIMIT 20`;
 for(const row of withdrawals){try{
  if(row.state==='processing'){try{await confirmTransfer(row.reference);continue;}catch{/* A transfer not created yet is retried using its original reference. */}}
  const claimed=await db.sql`UPDATE wallet_withdrawals SET state='processing' WHERE reference=${row.reference} AND state='queued' RETURNING reference`;
  if(claimed.length || row.state==='processing'){
   // Paystack references are unique. Retries always reuse the reserved reference.
   await paystack('/transfer',{source:'balance',amount:Number(row.net_cents),currency:'ZAR',recipient:row.recipient_code,reference:row.reference,reason:'SwiftHaul customer wallet withdrawal'});
   await confirmTransfer(row.reference);
  }
 }catch{/* Keep funds reserved on uncertain provider outcomes; reconcile by the same reference. */}}
}
