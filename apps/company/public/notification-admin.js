(() => {
  const root=document.querySelector('body[data-app="company"] #workspace .page');
  if(!root)return;
  const signupPanel=document.createElement('section');
  signupPanel.id='signup-notifications';signupPanel.className='panel';signupPanel.hidden=true;
  signupPanel.innerHTML='<h2>New sign-up activity</h2><p class="subtle">Customer registrations and driver applications appear here even when outgoing email is unavailable.</p><div class="notification-toolbar"><button type="button" id="signup-notification-refresh">Refresh sign-ups</button></div><p id="signup-notification-status" role="status" aria-live="polite">Sign in as a Company Admin to view sign-up activity.</p><div id="signup-notification-list" class="notification-list"></div>';
  root.append(signupPanel);
  const signupStatus=signupPanel.querySelector('#signup-notification-status');
  const signupList=signupPanel.querySelector('#signup-notification-list');
  let signupActive=false,signupRequest=0;
  async function loadSignups(){
    if(!signupActive)return;
    const seq=++signupRequest;signupStatus.textContent='Loading recent sign-ups…';
    try{
      const supabase=client();if(!supabase)throw new Error('Secure administrator connection is unavailable.');
      const {data,error}=await supabase.functions.invoke('signup-notifications-admin',{method:'GET'});
      if(error)throw new Error(data?.error||error.message||'Sign-up notifications could not be loaded.');
      if(data?.error)throw new Error(data.error);
      if(seq!==signupRequest)return;
      signupList.replaceChildren();
      const rows=data?.notifications||[];
      if(!rows.length){signupStatus.textContent='No customer sign-ups or driver application notifications have been recorded yet.';return;}
      rows.forEach(row=>{
        const card=document.createElement('article');card.className='notification-row';
        const heading=document.createElement('div');heading.className='notification-row-heading';
        const title=document.createElement('strong');title.textContent=row.label||'New sign-up';
        const badge=document.createElement('span');badge.className='notification-status';badge.textContent=row.type==='driver_application'?'Driver':'Customer';
        heading.append(title,badge);
        const detail=document.createElement('p');detail.textContent=[row.user_name,row.account_status,'Registered '+new Date(row.created_at).toLocaleString()].join(' · ');
        const delivery=document.createElement('p');delivery.className='notification-fallback';
        delivery.textContent='Email to user: '+(row.welcome_email_sent?'sent':'not sent')+' · Admin email: '+(row.admin_email_sent?'sent':'not sent')+(row.whatsapp_sent===null?'':' · WhatsApp: '+(row.whatsapp_sent?'sent':'not sent'));
        card.append(heading,detail,delivery);signupList.append(card);
      });
      signupStatus.textContent=rows.length+' recent sign-up event(s). Refresh to check for new activity.';
    }catch(error){if(seq===signupRequest)signupStatus.textContent=error.message;}
  }
  signupPanel.querySelector('#signup-notification-refresh').addEventListener('click',loadSignups);
  const panel=document.createElement('section');
  panel.id='notification-audit';panel.className='panel';panel.hidden=true;
  panel.innerHTML='<h2>Notification audit</h2><p class="subtle">Review WhatsApp and SMS lifecycle messages, delivery receipts, and automatic fallback attempts.</p><div class="notification-toolbar"><label for="notification-filter">Status</label><select id="notification-filter"><option value="">All messages</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="read">Read</option><option value="failed">Failed</option></select><button type="button" id="notification-refresh">Refresh audit</button><button type="button" id="notification-process-queued">Process queued alerts</button></div><p id="notification-status" role="status" aria-live="polite">Sign in as a Company Admin to view notification records.</p><div id="notification-list" class="notification-list"></div>';
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
  panel.querySelector('#notification-process-queued').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Processing…';try{const result=await invoke({action:'process_queue'});status.textContent=(result.processed||0)+' queued alert(s) processed.';await load();}catch(error){status.textContent=error.message;}finally{button.disabled=false;button.textContent='Process queued alerts';}});
  filter.addEventListener('change',load);
  document.addEventListener('account-ready',event=>{active=event.detail?.role==='admin'||event.detail?.role==='company_admin';signupActive=active;if(active){load();loadSignups();}else{status.textContent='Only Company Admin accounts can view notification audit records.';signupStatus.textContent='Only Company Admin accounts can view sign-up activity.';}});
  document.addEventListener('account-cleared',()=>{active=false;signupActive=false;request++;signupRequest++;list.replaceChildren();signupList.replaceChildren();status.textContent='';signupStatus.textContent='';});
  window.swiftHaulNotificationAudit={load};
})();