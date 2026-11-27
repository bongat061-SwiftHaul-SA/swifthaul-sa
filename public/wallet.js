const section=document.getElementById('wallet');
const status=document.getElementById('wallet-status');
const content=document.getElementById('wallet-content');
let version=0,active=false;
const rand=value=>'R'+(Number(value)/100).toFixed(2);
const date=value=>new Date(value).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'});
function clear(){version++;active=false;content.hidden=true;document.getElementById('wallet-entries').replaceChildren();document.getElementById('wallet-loans').replaceChildren();document.getElementById('wallet-withdrawals').replaceChildren();document.getElementById('referral-code').textContent='';status.textContent='';for(const id of ['refund-balance','promo-balance','pay-later-summary','wallet-provider-note','promo-adjustment'])document.getElementById(id).textContent='';}
async function api(body,query=''){
 if(!active||document.body.dataset.guestPreview==='true')throw new Error('Sign in to access your wallet.');
 if(body||query)throw new Error('This wallet action is not available yet.');
 const client=window.swiftHaulSupabase;if(!client)throw new Error('Customer sign-in connection is unavailable.');
 const {data,error}=await client.functions.invoke('wallet-operations',{body:{action:'summary'}});
 if(error||!data||data.error)throw new Error(data?.error||error?.message||'Wallet unavailable. Retry.');
 return data;
}
function entry(container,text){const p=document.createElement('p');p.textContent=text;container.append(p);return p;}
async function load(){
 if(!active)return;const current=++version;status.textContent='Loading wallet…';
 try{
 const data=await api();if(current!==version)return;content.hidden=false;
 document.getElementById('refund-balance').textContent=rand(data.wallet.refund_cents);
 document.getElementById('promo-balance').textContent=rand(data.wallet.promo_cents);
 document.getElementById('referral-code').textContent=data.wallet.referral_code;
 document.getElementById('promo-adjustment').textContent=Number(data.wallet.promo_debt_cents)>0?'Future promotional credits first offset '+rand(data.wallet.promo_debt_cents)+' reversed after refunds.':'';
 const e=data.eligibility;document.getElementById('pay-later-summary').textContent='Pay-later borrowing and online repayments are paused. Existing outstanding balance: '+rand(e.outstanding)+' · '+e.overdue+' overdue balance(s). Contact SwiftHaul Admin to reconcile an existing balance.';
 const entries=document.getElementById('wallet-entries');entries.replaceChildren();if(!data.entries.length)entry(entries,'No wallet transactions yet.');
 for(const row of data.entries){entry(entries,`${date(row.created_at)} · ${row.description} · Refund ${rand(row.refund_delta)} · Promotional ${rand(row.promo_delta)}${Number(row.promo_debt_delta)?' · Promotional adjustment '+rand(row.promo_debt_delta):''}`);}
 const loans=document.getElementById('wallet-loans');loans.replaceChildren();
 for(const loan of data.loans){const p=entry(loans,`${loan.waybill} · ${rand(loan.amount_cents)} · ${loan.paid_at?'Repaid':'Due '+date(loan.due_at)}`);if(!loan.paid_at){const note=document.createElement('small');note.textContent='Online repayment is temporarily unavailable. Contact SwiftHaul Admin to reconcile this balance.';p.append(' ',note);}}
 if(!data.loans.length)entry(loans,'No pay-later balances.');
 const withdrawals=document.getElementById('wallet-withdrawals');withdrawals.replaceChildren();for(const row of data.withdrawals)entry(withdrawals,`${date(row.created_at)} · ${row.speed} · ${row.state} · ${rand(row.gross_cents)} less ${rand(row.fee_cents)} fee = ${rand(row.net_cents)}`);if(!data.withdrawals.length)entry(withdrawals,'No withdrawals yet.');
 document.getElementById('withdraw-form').hidden=true;
 document.getElementById('wallet-provider-note').textContent='Wallet balances and history are read-only for now. Older wallet records are still being reconciled; online repayments, wallet-funded bookings and withdrawals are paused. Contact SwiftHaul Admin before relying on an older balance.';
 status.textContent='';
 for(const field of document.querySelectorAll('#withdraw-form input,#withdraw-form select,#withdraw-form button'))field.disabled=true;
 }catch(error){if(current===version)status.textContent=error.message;}
}
document.addEventListener('account-ready',()=>{active=true;load();});
document.addEventListener('account-cleared',clear);
document.addEventListener('guest-preview',()=>{clear();status.textContent='Guest preview: sign in to see wallet balances, rewards and repayment options.';});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&active)load();});
