const section=document.getElementById('wallet');
const status=document.getElementById('wallet-status');
const content=document.getElementById('wallet-content');
let version=0,active=false,requestId=crypto.randomUUID();
const rand=value=>'R'+(Number(value)/100).toFixed(2);
const date=value=>new Date(value).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'});
function clear(){version++;active=false;content.hidden=true;document.getElementById('wallet-entries').replaceChildren();document.getElementById('wallet-loans').replaceChildren();document.getElementById('wallet-withdrawals').replaceChildren();document.getElementById('referral-code').textContent='';document.getElementById('withdraw-form').reset();document.getElementById('withdraw-form').elements.bank_code.replaceChildren();document.getElementById('withdraw-fee').textContent='';status.textContent='';for(const id of ['refund-balance','promo-balance','pay-later-summary','wallet-provider-note','promo-adjustment'])document.getElementById(id).textContent='';requestId=crypto.randomUUID();}
async function api(body,query=''){
 if(!active||document.body.dataset.guestPreview==='true')throw new Error('Sign in to access your wallet.');
 if(body||query)throw new Error('Wallet payments and payouts are being migrated to PayFast.');
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
 const e=data.eligibility;document.getElementById('pay-later-summary').textContent=`${e.completed} completed deliveries · ${e.verified?'Verified account':'Account verification required'} · Outstanding ${rand(e.outstanding)} / R500.00 · ${e.overdue} overdue balance(s). Repayment is due within 7 days. Eligibility is checked again at payment.`;
 const entries=document.getElementById('wallet-entries');entries.replaceChildren();if(!data.entries.length)entry(entries,'No wallet transactions yet.');
 for(const row of data.entries){entry(entries,`${date(row.created_at)} · ${row.description} · Refund ${rand(row.refund_delta)} · Promotional ${rand(row.promo_delta)}${Number(row.promo_debt_delta)?' · Promotional adjustment '+rand(row.promo_debt_delta):''}`);}
 const loans=document.getElementById('wallet-loans');loans.replaceChildren();
 for(const loan of data.loans){const p=entry(loans,`${loan.waybill} · ${rand(loan.amount_cents)} · ${loan.paid_at?'Repaid':'Due '+date(loan.due_at)}`);if(!loan.paid_at){const note=document.createElement('small');note.textContent='Online repayment is temporarily unavailable while PayFast repayment is being migrated.';p.append(note);}}
 if(!data.loans.length)entry(loans,'No pay-later balances.');
 const withdrawals=document.getElementById('wallet-withdrawals');withdrawals.replaceChildren();for(const row of data.withdrawals)entry(withdrawals,`${date(row.created_at)} · ${row.speed} · ${row.state} · ${rand(row.gross_cents)} less ${rand(row.fee_cents)} fee = ${rand(row.net_cents)}`);if(!data.withdrawals.length)entry(withdrawals,'No withdrawals yet.');
 document.querySelector('#withdraw-form [type=submit]').disabled=!data.provider_ready||Number(data.wallet.refund_cents)<=0;
 document.getElementById('wallet-provider-note').textContent=data.actions_ready?'Wallet payments and payouts are available.':'Wallet balances and history are available. PayFast loan repayments and bank payouts are not enabled yet; existing balances remain unchanged.';
 status.textContent='';
 for(const field of document.querySelectorAll('#withdraw-form input,#withdraw-form select,#withdraw-form button'))field.disabled=true;
 }catch(error){if(current===version)status.textContent=error.message;}
}
async function perform(body,button){
 if(!active)return;const current=version;if(button)button.disabled=true;status.textContent='Processing…';
 try{const result=await api(body);if(current!==version)return;
  if(result.checkout_url){const url=new URL(result.checkout_url);if(url.protocol!=='https:'||url.hostname!=='checkout.paystack.com')throw new Error('Invalid payment address.');window.location.assign(url.href);return;}
  if(body.action==='withdraw')requestId=crypto.randomUUID();
  await load();status.textContent=result.withdrawal?'Withdrawal reserved. Track its confirmed status below.':result.pay_later?'Pay later activated. Repayment is due in 7 days.':'Wallet payment saved.';document.dispatchEvent(new Event('wallet-updated'));
 }catch(error){if(current===version)status.textContent=error.message;}finally{if(button)button.disabled=false;}
}
document.getElementById('refresh-wallet').addEventListener('click',()=>{load();if(active)document.dispatchEvent(new Event('wallet-updated'));});
document.getElementById('copy-referral').addEventListener('click',async()=>{try{const code=document.getElementById('referral-code').textContent;if(!code)return;const url=new URL('/',location.href);url.searchParams.set('ref',code);await navigator.clipboard.writeText(url.href);status.textContent='Referral link copied.';}catch{status.textContent='Copy the referral code shown above and share it with a new customer.';}});
document.getElementById('withdraw-form').addEventListener('input',()=>{requestId=crypto.randomUUID();const form=document.getElementById('withdraw-form'),gross=Math.round(Number(form.elements.amount.value)*100),fee=form.elements.speed.value==='instant'?Math.round(gross*.025)+500:200;document.getElementById('withdraw-fee').textContent=gross>fee?`Fee ${rand(fee)} · You receive ${rand(gross-fee)}.`:'Enter an amount greater than the processing fee.';});
document.getElementById('withdraw-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;perform({action:'withdraw',request_id:requestId,amount:form.elements.amount.value,speed:form.elements.speed.value,bank_code:form.elements.bank_code.value},form.querySelector('[type=submit]'));});
document.addEventListener('wallet-payment',event=>{section.scrollIntoView({behavior:'smooth'});perform(event.detail);});
document.addEventListener('account-ready',()=>{active=true;load();});
document.addEventListener('account-cleared',clear);
document.addEventListener('guest-preview',()=>{clear();status.textContent='Guest preview: sign in to see wallet balances, rewards and repayment options.';});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&active)load();});
