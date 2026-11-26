(() => {
  let button=null, status=null, busy=false;
  const supported=()=>('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);
  const standalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
  const encodeKey=value=>{
    const padding='='.repeat((4-value.length%4)%4);
    const raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  };
  const client=()=>window.swiftHaulSupabase;
  async function invoke(body){
    const api=client();
    if(!api)throw new Error('Your secure session is not ready. Please reload.');
    const {data,error}=await api.functions.invoke('push-notifications',{body});
    if(error||data?.error)throw new Error(data?.error||error?.message||'Push notification setup failed.');
    return data;
  }
  function mount(){
    if(document.body.dataset.guestPreview==='true'||!supported())return;
    const account=document.querySelector('.topbar .account');
    if(!account)return;
    if(!button){
      button=document.createElement('button');
      button.type='button';button.className='quiet push-alert-toggle';
      button.textContent='Enable alerts';
      button.style.cssText='margin-right:8px;white-space:nowrap';
      status=document.createElement('span');status.className='push-alert-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      button.addEventListener('click',enable);
      account.insertBefore(button,account.querySelector('#sign-out')||account.firstChild);
      account.append(status);
    }
    button.hidden=false;
    if(Notification.permission==='granted')button.textContent='Turn on delivery alerts';
    if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!standalone()){
      button.title='On iPhone or iPad, add SwiftHaul to your Home Screen before enabling web push.';
    }
  }
  async function enable(){
    if(busy||!button)return;
    busy=true;button.disabled=true;
    try{
      if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!standalone())
        throw new Error('On iPhone/iPad, first use Share → Add to Home Screen, then open SwiftHaul from that icon.');
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw new Error('Notifications are blocked. Allow notifications in your browser settings to continue.');
      const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      await navigator.serviceWorker.ready;
      const config=await invoke({action:'public_key'});
      const existing=await registration.pushManager.getSubscription();
      const subscription=existing||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:encodeKey(config.public_key)});
      await invoke({action:'subscribe',subscription:subscription.toJSON()});
      button.textContent='Delivery alerts enabled';
      if(status)status.textContent='You can receive delivery updates while SwiftHaul is closed, subject to device and browser settings.';
    }catch(error){
      if(status)status.textContent=error.message||'Could not enable notifications.';
      else button.title=error.message||'Could not enable notifications.';
    }finally{busy=false;button.disabled=false;}
  }
  document.addEventListener('account-ready',mount);
  document.addEventListener('account-cleared',async()=>{
    if(button){button.hidden=true;}
    try{
      const registration=await navigator.serviceWorker.getRegistration('./');
      const subscription=await registration?.pushManager?.getSubscription();
      if(subscription)await subscription.unsubscribe();
    }catch{}
  });
})();
