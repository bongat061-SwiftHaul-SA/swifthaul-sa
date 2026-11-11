(() => {
  const root=document.querySelector('body[data-app="company"] #workspace .page');
  if(!root)return;
  const panel=document.createElement('section');
  panel.id='notification-audit';panel.className='panel';panel.hidden=true;
  panel.innerHTML='<h2>Notification audit</h2><p class="subtle">Review WhatsApp and SMS lifecycle messages, delivery receipts, and automatic fallback attempts.</p><div class="notification-toolbar"><label for="notification-filter">Status</label><select id="notification-filter"><option value="">All messages</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="read">Read</option><option value="failed">Failed</option></select><button type="button" id="notification-refresh">Refresh audit</button></div><p id="notification-status" role="status" aria-live="polite">Sign in as a Company Admin to view notification records.</p><div id="notification-list" class="notification-list"></div>';
  root.append(panel);
  const status=panel.querySelector('#notification-status'),list=panel.querySelector('#notification-list'),filter=panel.querySelector('#notification-filter');
  let active=false,request=0;
  const client=()=>window.swiftHaulSupabase;
  async function invoke(body){
    const supabase=client();if(!supabase)throw new Error('Secure administrator connection is unavailable.');
    const {data,error}=await supabase.functions.invoke('notification-dispatch',{body});
    if(error)throw new Error(data?.error||error.message||'Notification service request failed.');
    if(data?.error)throw new Error(data.error);
    return data||{};
  }
  async function load(){
    if(!active)return;
    const seq=++request;status.textContent='Loading notification audit…';
    try{
      const data=await invoke({action:'list',status:filter.value});if(seq!==request)return;
      list.replaceChildren();
      const rows=data.notifications||[];
      if(!rows.length){status.textContent='No notification records match this filter.';return;}
      rows.forEach(render);status.textContent=rows.length+' recent notification record(s).';
    }catch(error){if(seq===request)status.textContent=error.message;}
  }
  function render(row){
    const card=document.createElement('article');card.className='notification-row';
    const heading=document.createElement('div');heading.className='notification-row-heading';
    const title=document.createElement('strong');title.textContent=row.event_type.replaceAll('_',' ');
    const badge=document.createElement('span');badge.className='notification-status status-'+row.status;badge.textContent=row.status;
    heading.append(title,badge);
    const detail=document.createElement('p');detail.textContent=[row.recipient_type,row.recipient_phone,row.channel.toUpperCase(),row.provider||'provider pending',new Date(row.created_at).toLocaleString()].join(' · ');
    const fallback=document.createElement('p');fallback.className='notification-fallback';fallback.textContent=row.fallback_triggered?'SMS fallback triggered':'WhatsApp primary channel';
    const error=document.createElement('p');error.className='subtle';error.textContent=row.last_error||'';
    card.append(heading,detail,fallback,error);
    if(row.status==='failed'){
      const retry=document.createElement('button');retry.type='button';retry.textContent='Resend message';retry.addEventListener('click',async()=>{
        retry.disabled=true;retry.textContent='Resending…';
        try{await invoke({action:'retry',id:row.id});await load();}
        catch(e){status.textContent=e.message;retry.disabled=false;retry.textContent='Resend message';}
      });card.append(retry);
    }
    list.append(card);
  }
  panel.querySelector('#notification-refresh').addEventListener('click',load);
  filter.addEventListener('change',load);
  document.addEventListener('account-ready',event=>{active=event.detail?.role==='admin'||event.detail?.role==='company_admin';if(active)load();else status.textContent='Only Company Admin accounts can view notification audit records.';});
  document.addEventListener('account-cleared',()=>{active=false;request++;list.replaceChildren();status.textContent='';});
  window.swiftHaulNotificationAudit={load};
})();