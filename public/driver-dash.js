(() => {
  'use strict';
  function boot() {
  const home = document.getElementById('customer-home');
  if (!home) return false;
  if (document.getElementById('driver-dash-launch')) return true;

  const launch = document.createElement('button');
  launch.type = 'button';
  launch.id = 'driver-dash-launch';
  launch.className = 'driver-dash-launch';
  // Keep the game discoverable after refreshes; availability only changes the hint copy.
  launch.hidden = false;
  launch.innerHTML = '<span class="driver-dash-launch-icon" aria-hidden="true">🚚</span><span><strong>Play SwiftHaul Driver Dash</strong><small>Take a quick delivery run while you wait</small></span><span aria-hidden="true">→</span>';
  const intro = home.querySelector('.customer-home-intro');
  (intro || home).append(launch);

  const overlay = document.createElement('section');
  overlay.className = 'driver-dash-overlay';
  overlay.id = 'driver-dash-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','driver-dash-title');
  overlay.innerHTML = `
    <div class="driver-dash-panel">
      <header class="driver-dash-header">
        <div><p class="driver-dash-kicker">SWIFTHAUL MINI GAME</p><h2 id="driver-dash-title">Driver Dash</h2><p>Collect parcels. Avoid traffic, cars and trees. Beat your best score.</p></div>
        <button type="button" class="driver-dash-close" aria-label="Close game">×</button>
      </header>
      <section class="driver-dash-rewards" data-dash-rewards hidden><strong>SwiftHaul Dash Rewards</strong><p data-reward-progress>Sign in to earn reward points.</p><div class="driver-dash-reward-track"><span data-reward-fill></span></div><small data-reward-best>Account best score: —</small><p data-reward-history class="driver-dash-reward-history">Your reward milestones will appear here.</p><div data-reward-wallet style="display:grid;gap:8px;margin-top:12px"></div><p class="driver-dash-reward-note">Rewards: 1,000 = R10 · 2,500 = R20 · 5,000 = R40. Admin verification required. Offline and guest games do not earn rewards.</p></section><div class="driver-dash-stats"><span>Score <strong data-dash-score>0</strong></span><span>Time <strong data-dash-time>30</strong>s</span><span>Best <strong data-dash-best>0</strong></span></div>
      <canvas class="driver-dash-canvas" width="360" height="480" aria-label="Delivery van game. Use the left and right controls to collect parcels and avoid traffic obstacles."></canvas>
      <p class="driver-dash-message" role="status" aria-live="polite">Tap Start, then steer left and right to collect parcels.</p>
      <div class="driver-dash-controls"><button type="button" data-dash-left aria-label="Steer left">←</button><button type="button" data-dash-start>Start game</button><button type="button" data-dash-right aria-label="Steer right">→</button></div>
      <p class="driver-dash-footnote">Game points can earn customer rewards, but never affect delivery prices, driver matching or driver earnings.</p>
    </div>`;
  document.body.append(overlay);
  const canvas=overlay.querySelector('canvas'), ctx=canvas.getContext('2d');
  const scoreEl=overlay.querySelector('[data-dash-score]'), timeEl=overlay.querySelector('[data-dash-time]'), bestEl=overlay.querySelector('[data-dash-best]');
  const startBtn=overlay.querySelector('[data-dash-start]'), message=overlay.querySelector('.driver-dash-message');
  const rewardsPanel=overlay.querySelector('[data-dash-rewards]'), rewardProgress=overlay.querySelector('[data-reward-progress]'), rewardFill=overlay.querySelector('[data-reward-fill]'), rewardBest=overlay.querySelector('[data-reward-best]'), rewardHistory=overlay.querySelector('[data-reward-history]'), rewardWallet=overlay.querySelector('[data-reward-wallet]');
  let rewardRoundId=null, rewardEligible=false, rewardSubmitting=false, rewardSummary=null, lifetimeRewardPoints=0, hardMode=false;
  function moneyLabel(cents){return 'R'+(Number(cents||0)/100).toFixed(0)}
  function signedInCustomer(){return document.body.dataset.authState==='authenticated'&&document.body.dataset.guestPreview!=='true'&&!!window.swiftHaulSupabase;}
  async function refreshRewards(){
    rewardsPanel.hidden=false;
    if(!signedInCustomer()){rewardProgress.textContent='Sign in to earn reward points. Guest and offline games are for fun only.';rewardFill.style.width='0%';rewardBest.textContent='Account best score: sign in to view';rewardHistory.textContent='Sign in to see approved vouchers and milestone reviews.';rewardWallet.replaceChildren();return;}
    try{const {data,error}=await window.swiftHaulSupabase.functions.invoke('customer-dash-rewards',{method:'GET'});if(error)throw error;rewardSummary=data;const s=data.summary||{};lifetimeRewardPoints=Number(s.lifetime_points||0);const pts=Number(s.cycle_points||0);rewardProgress.textContent='Cycle '+(s.cycle_number||1)+': '+pts.toLocaleString()+' / 5,000 points · Lifetime '+Number(s.lifetime_points||0).toLocaleString();rewardFill.style.width=Math.min(100,pts/50)+'%';rewardBest.textContent='Account best score: '+Number(s.best_score||0).toLocaleString()+' · All-time personal best';const pending=(data.milestones||[]).filter(m=>m.status==='pending');if(pending.length)rewardProgress.textContent+=' · '+pending.length+' milestone(s) awaiting Admin verification';rewardHistory.textContent=(data.milestones||[]).slice(0,6).map(m=>m.milestone_points.toLocaleString()+' points: '+(m.status==='forfeited'?'Forfeited after cash-out':m.status==='redeemed'?'Voucher issued · '+(m.voucher_code||'ready to use'):m.claim_status==='pending'?'Voucher request awaiting Admin':m.claim_status==='rejected'?'Voucher request declined · points returned':m.status==='approved'?'Milestone verified · request your voucher':m.status==='pending'?'Awaiting round verification':'Not approved')).join('  |  ')||'No reward milestones reached yet.';
      rewardWallet.replaceChildren();
      const balance=document.createElement('p');balance.textContent='Available points: '+Number(s.available_points||0).toLocaleString()+' · Points used: '+Number(s.points_spent||0).toLocaleString();rewardWallet.append(balance);
      const activeCashout=(data.cashouts||[]).some(c=>c.status==='pending');
      const latestRejectedCashout=(data.cashouts||[]).find(c=>c.status==='rejected');
      const cashoutPromptKey=String(s.cycle_number||1)+':'+String(latestRejectedCashout?.id||'none');
      let cashoutPromptDismissed=false;try{cashoutPromptDismissed=localStorage.getItem('swifthaul-dash-cashout-dismissed')===cashoutPromptKey;}catch{}
      if(Number(s.available_points||0)>=25000&&!activeCashout&&!cashoutPromptDismissed){
        const prompt=document.createElement('div');prompt.style.cssText='padding:12px;border:1px solid #8b929b;border-radius:12px;display:grid;gap:8px';
        const promptText=document.createElement('strong');promptText.textContent='You have reached 25,000 unused points. Keep your points or request the R150 cash-out.';prompt.append(promptText);
        const keep=document.createElement('button');keep.type='button';keep.textContent='Keep my points';keep.addEventListener('click',()=>{try{localStorage.setItem('swifthaul-dash-cashout-dismissed',cashoutPromptKey);}catch{}prompt.remove();const n=document.createElement('small');n.textContent='Your points remain available. You can request a cash-out later.';rewardWallet.append(n)});prompt.append(keep);
        const cash=document.createElement('button');cash.type='button';cash.className='primary';cash.textContent='Request R150 cash-out';cash.addEventListener('click',async()=>{cash.disabled=true;try{const {error}=await window.swiftHaulSupabase.functions.invoke('customer-dash-rewards',{body:{action:'request_cashout'}});if(error)throw error;await refreshRewards();}catch{cash.disabled=false;message.textContent='Cash-out request could not be submitted. Your points have not been deducted.';}});prompt.append(cash);rewardWallet.append(prompt);
      } else if(activeCashout){const pending=document.createElement('p');pending.textContent='R150 cash-out request submitted. Your points are held while Admin reviews it.';rewardWallet.append(pending);}
      (data.milestones||[]).filter(m=>m.status==='redeemed'&&!m.voucher_applied_booking_waybill&&m.voucher_code).forEach(m=>{
        const ready=document.createElement('div');ready.style.cssText='display:grid;gap:5px;padding:10px;border:1px solid #8b929b;border-radius:10px';
        const label=document.createElement('strong');label.textContent='Ready to use · R'+(Number(m.reward_cents||0)/100).toFixed(0)+' off a R200+ delivery';ready.append(label);
        const code=document.createElement('code');code.textContent=m.voucher_code;ready.append(code);
        const copy=document.createElement('button');copy.type='button';copy.textContent='Copy voucher code';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(m.voucher_code);copy.textContent='Copied';}catch{copy.textContent='Select and copy the code above';}});ready.append(copy);
        rewardWallet.append(ready);
      });
      (data.milestones||[]).filter(m=>m.voucher_applied_booking_waybill).forEach(m=>{const used=document.createElement('small');used.textContent='Voucher '+m.voucher_code+' applied to booking '+m.voucher_applied_booking_waybill;rewardWallet.append(used)});
      (data.milestones||[]).filter(m=>m.status==='approved'||m.claim_status==='pending'||m.claim_status==='rejected').forEach(m=>{
        const item=document.createElement('div');item.style.cssText='display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap';
        const label=document.createElement('span');label.textContent=m.milestone_points.toLocaleString()+' points · '+(m.claim_status==='pending'?'Voucher request pending Admin review':m.claim_status==='rejected'?'Voucher request declined · points returned':'Milestone verified · '+(Number(m.available_points||0)>=m.milestone_points?'':'check points balance'));item.append(label);
        if(m.claim_status!=='pending'){
          const redeem=document.createElement('button');redeem.type='button';redeem.textContent=m.claim_status==='rejected'?'Request voucher again':'Request '+moneyLabel(m.reward_cents)+' voucher';
          redeem.addEventListener('click',async()=>{if(!window.confirm('Request this single-use Dash Rewards voucher? If Admin approves, '+m.milestone_points.toLocaleString()+' points will be deducted and a '+moneyLabel(m.reward_cents)+' discount will be issued for a delivery quote of R200 or more.'))return;redeem.disabled=true;try{const {error}=await window.swiftHaulSupabase.functions.invoke('customer-dash-rewards',{body:{action:'redeem_coupon',milestone_id:m.id,terms_accepted:true,terms_version:'2026-11-28-v1'}});if(error)throw error;message.textContent='Voucher request submitted. Your points remain available until Admin approves the request.';await refreshRewards();}catch{redeem.disabled=false;message.textContent='Voucher request could not be submitted. Your points have not been deducted.';}});item.append(redeem);
        }
        rewardWallet.append(item);
      });
      (data.cashouts||[]).slice(0,3).forEach(c=>{const line=document.createElement('small');line.textContent='Cash-out · '+c.status+' · '+new Date(c.requested_at).toLocaleDateString('en-ZA');rewardWallet.append(line)});}catch{rewardProgress.textContent='Rewards need an internet connection. You can still play for fun.';rewardFill.style.width='0%';rewardBest.textContent='Account best score temporarily unavailable';rewardHistory.textContent='Reconnect to load your reward history.';}
  }
  refreshRewards();
  document.addEventListener('account-ready',refreshRewards);document.addEventListener('account-cleared',refreshRewards);
  const lanes=[76,180,284]; let lane=1, score=0, seconds=30, running=false, items=[], lastSpawn=0, frame=0, raf=0, lastTime=0;
  let best=0; try{best=Number(localStorage.getItem('swifthaul-driver-dash-best')||0)}catch{}
  bestEl.textContent=best;
  function saveBestIfNeeded(){
    if(score<=best)return;
    best=score;bestEl.textContent=String(best);
    try{localStorage.setItem('swifthaul-driver-dash-best',String(best));}catch{}
  }
  function draw(){
    ctx.clearRect(0,0,360,480);
    ctx.fillStyle='#222a33';ctx.fillRect(0,0,360,480);
    ctx.fillStyle='#303a45';ctx.fillRect(26,0,308,480);
    ctx.strokeStyle='#7e8996';ctx.lineWidth=3;ctx.setLineDash([22,20]);
    ctx.beginPath();ctx.moveTo(128,0);ctx.lineTo(128,480);ctx.moveTo(232,0);ctx.lineTo(232,480);ctx.stroke();ctx.setLineDash([]);
    items.forEach(o=>{ctx.font=o.type==='tree'?'30px sans-serif':'26px sans-serif';ctx.textAlign='center';const glyph=o.type==='parcel'?'📦':o.type==='car'?'🚗':o.type==='tree'?'🌳':'🚧';ctx.fillText(glyph,lanes[o.lane],o.y)});
    ctx.font='38px sans-serif';ctx.textAlign='center';ctx.fillText('🚚',lanes[lane],410);
    ctx.fillStyle='#f4f6f8';ctx.font='12px system-ui';ctx.fillText('SWIFTHAUL DELIVERY RUN',180,24);
  }
  async function endGame(){
    running=false;cancelAnimationFrame(raf);startBtn.textContent='Play again';
    message.textContent='Run complete! You collected '+score+' parcel points.'+(score>best?' New personal best!':'');
    saveBestIfNeeded();
    if(rewardEligible&&rewardRoundId&&!rewardSubmitting){
      rewardSubmitting=true;
      try{
        const {data,error}=await window.swiftHaulSupabase.functions.invoke('customer-dash-rewards',{body:{action:'submit_round',round_id:rewardRoundId,score}});
        if(error)throw error;
        const earned=Number(data.summary?.points_earned_this_round||score);const daily=Number(data.summary?.daily_bonus_points||0);const streak=Number(data.summary?.streak_bonus_points||0);message.textContent+=' '+earned.toLocaleString()+' reward points added to your account.'+(daily?' Includes +'+daily+' daily verified-play bonus.':'')+(streak?' Includes +'+streak+' five-day streak bonus!':'')+' Milestone vouchers still require Admin approval.';
        await refreshRewards();
      }catch{message.textContent+=' Reward points could not be submitted; this run will not count.';}
      finally{rewardSubmitting=false;rewardRoundId=null;rewardEligible=false;}
    }
    draw();
  }
  function tick(now){
    if(!running)return;
    const dt=Math.min(40,now-lastTime||16);lastTime=now;frame+=dt;
    if(frame-lastSpawn>(hardMode?500:650)){items.push({lane:Math.floor(Math.random()*3),y:-20,type:hardMode?(Math.random()<.56?'parcel':Math.random()<.37?'cone':Math.random()<.5?'car':'tree'):(Math.random()<.68?'parcel':'cone')});lastSpawn=frame}
    items.forEach(o=>o.y+=dt*(hardMode?.29:.23));
    const hit=items.find(o=>o.y>375&&o.y<445&&o.lane===lane);
    if(hit){if(hit.type==='parcel'){score+=10;scoreEl.textContent=score;saveBestIfNeeded();items=items.filter(x=>x!==hit)}else{score=Math.max(0,score-20);scoreEl.textContent=score;seconds=Math.max(0,seconds-3);timeEl.textContent=seconds;items=items.filter(x=>x!==hit);message.textContent='You hit an obstacle! −20 points and 3 seconds.'}}
    items=items.filter(o=>o.y<510);
    if(frame>=30000){endGame();return}
    timeEl.textContent=Math.max(0,Math.ceil((30000-frame)/1000));
    draw();raf=requestAnimationFrame(tick);
  }
  async function start(){cancelAnimationFrame(raf);rewardRoundId=null;rewardEligible=false;if(signedInCustomer()){if(!rewardSummary)await refreshRewards();try{const {data,error}=await window.swiftHaulSupabase.functions.invoke('customer-dash-rewards',{body:{action:'start_round'}});if(error)throw error;rewardRoundId=data.round_id;rewardEligible=true;}catch{message.textContent='Rewards connection unavailable — this run is for fun only.';}}hardMode=lifetimeRewardPoints>=15000;lane=1;score=0;seconds=30;frame=0;lastSpawn=0;lastTime=0;items=[];scoreEl.textContent='0';timeEl.textContent='30';running=true;startBtn.textContent='Restart';message.textContent=hardMode?'Challenge stage unlocked! Faster traffic, cars and trees are on the road. Collect parcels and avoid collisions.':'Collect the parcels and avoid the cones!';raf=requestAnimationFrame(tick)}
  function move(dir){if(running)lane=Math.max(0,Math.min(2,lane+dir))}
  overlay.querySelector('[data-dash-left]').addEventListener('click',()=>move(-1));
  overlay.querySelector('[data-dash-right]').addEventListener('click',()=>move(1));
  startBtn.addEventListener('click',()=>{void start()});
  function close(){running=false;cancelAnimationFrame(raf);overlay.hidden=true;document.body.classList.remove('driver-dash-open');launch.focus()}
  overlay.querySelector('.driver-dash-close').addEventListener('click',close);
  launch.addEventListener('click',()=>{overlay.hidden=false;document.body.classList.add('driver-dash-open');draw();overlay.querySelector('.driver-dash-close').focus()});
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
  document.addEventListener('keydown',e=>{if(overlay.hidden)return;if(e.key==='Escape')close();if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1)});
  let startX=null;canvas.addEventListener('touchstart',e=>{startX=e.touches[0].clientX},{passive:true});
  canvas.addEventListener('touchend',e=>{if(startX===null)return;const dx=e.changedTouches[0].clientX-startX;if(Math.abs(dx)>18)move(dx<0?-1:1);startX=null},{passive:true});
  const launchHint = launch.querySelector('small');
  window.addEventListener('swifthaul:no-drivers',()=>{launch.hidden=false;if(launchHint)launchHint.textContent='No drivers showing nearby? Play a quick delivery run while you wait.'});
  window.addEventListener('swifthaul:drivers-available',()=>{launch.hidden=false;if(launchHint)launchHint.textContent='Take a quick delivery run while you explore SwiftHaul.'});
  return true;
  }
  if (!boot()) {
    const observer = new MutationObserver(() => {
      if (boot()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();