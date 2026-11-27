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
        <div><p class="driver-dash-kicker">SWIFTHAUL MINI GAME</p><h2 id="driver-dash-title">Driver Dash</h2><p>Collect parcels. Dodge cones. Beat your best score.</p></div>
        <button type="button" class="driver-dash-close" aria-label="Close game">×</button>
      </header>
      <section class="driver-dash-rewards" data-dash-rewards hidden><strong>SwiftHaul Dash Rewards</strong><p data-reward-progress>Sign in to earn reward points.</p><div class="driver-dash-reward-track"><span data-reward-fill></span></div><small data-reward-best>Account best score: —</small><p class="driver-dash-reward-note">Rewards: 1,000 = R10 · 2,500 = R20 · 5,000 = R40. Admin verification required. Offline and guest games do not earn rewards.</p></section><div class="driver-dash-stats"><span>Score <strong data-dash-score>0</strong></span><span>Time <strong data-dash-time>30</strong>s</span><span>Best <strong data-dash-best>0</strong></span></div>
      <canvas class="driver-dash-canvas" width="360" height="480" aria-label="Delivery van game. Use the left and right controls to collect parcels and avoid cones."></canvas>
      <p class="driver-dash-message" role="status" aria-live="polite">Tap Start, then steer left and right to collect parcels.</p>
      <div class="driver-dash-controls"><button type="button" data-dash-left aria-label="Steer left">←</button><button type="button" data-dash-start>Start game</button><button type="button" data-dash-right aria-label="Steer right">→</button></div>
      <p class="driver-dash-footnote">Just for fun — game points do not affect delivery prices, driver matching or rewards.</p>
    </div>`;
  document.body.append(overlay);
  const canvas=overlay.querySelector('canvas'), ctx=canvas.getContext('2d');
  const scoreEl=overlay.querySelector('[data-dash-score]'), timeEl=overlay.querySelector('[data-dash-time]'), bestEl=overlay.querySelector('[data-dash-best]');
  const startBtn=overlay.querySelector('[data-dash-start]'), message=overlay.querySelector('.driver-dash-message');\n  const rewardsPanel=overlay.querySelector('[data-dash-rewards]'), rewardProgress=overlay.querySelector('[data-reward-progress]'), rewardFill=overlay.querySelector('[data-reward-fill]'), rewardBest=overlay.querySelector('[data-reward-best]');\n  let rewardRoundId=null, rewardEligible=false, rewardSubmitting=false, rewardSummary=null;\n  function signedInCustomer(){return document.body.dataset.authState==='authenticated'&&document.body.dataset.guestPreview!=='true'&&!!window.swiftHaulSupabase;}\n  async function refreshRewards(){\n    rewardsPanel.hidden=false;\n    if(!signedInCustomer()){rewardProgress.textContent='Sign in to earn reward points. Guest and offline games are for fun only.';rewardFill.style.width='0%';rewardBest.textContent='Account best score: sign in to view';return;}\n    try{const {data,error}=await window.swiftHaulSupabase.functions.invoke('customer-dash-rewards',{method:'GET'});if(error)throw error;rewardSummary=data;const s=data.summary||{};const pts=Number(s.cycle_points||0);rewardProgress.textContent='Cycle '+(s.cycle_number||1)+': '+pts.toLocaleString()+' / 5,000 points · Lifetime '+Number(s.lifetime_points||0).toLocaleString();rewardFill.style.width=Math.min(100,pts/50)+'%';rewardBest.textContent='Account best score: '+Number(s.best_score||0).toLocaleString()+' · All-time personal best';const pending=(data.milestones||[]).filter(m=>m.status==='pending');if(pending.length)rewardProgress.textContent+=' · '+pending.length+' milestone(s) awaiting Admin verification';}catch{rewardProgress.textContent='Rewards need an internet connection. You can still play for fun.';rewardFill.style.width='0%';rewardBest.textContent='Account best score temporarily unavailable';}\n  }\n  refreshRewards();\n  document.addEventListener('account-ready',refreshRewards);document.addEventListener('account-cleared',refreshRewards);
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
    items.forEach(o=>{ctx.font='26px sans-serif';ctx.textAlign='center';ctx.fillText(o.type==='parcel'?'📦':'🚧',lanes[o.lane],o.y)});
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
        message.textContent+=' Reward points submitted for Admin verification.';
        await refreshRewards();
      }catch{message.textContent+=' Reward points could not be submitted; this run will not count.';}
      finally{rewardSubmitting=false;rewardRoundId=null;rewardEligible=false;}
    }
    draw();
  }
  function tick(now){
    if(!running)return;
    const dt=Math.min(40,now-lastTime||16);lastTime=now;frame+=dt;
    if(frame-lastSpawn>650){items.push({lane:Math.floor(Math.random()*3),y:-20,type:Math.random()<.68?'parcel':'cone'});lastSpawn=frame}
    items.forEach(o=>o.y+=dt*.23);
    const hit=items.find(o=>o.y>375&&o.y<445&&o.lane===lane);
    if(hit){if(hit.type==='parcel'){score+=10;scoreEl.textContent=score;saveBestIfNeeded();items=items.filter(x=>x!==hit)}else{seconds=Math.max(0,seconds-3);timeEl.textContent=seconds;items=items.filter(x=>x!==hit);message.textContent='Watch those cones — 3 seconds lost!'}}
    items=items.filter(o=>o.y<510);
    if(frame>=30000){endGame();return}
    timeEl.textContent=Math.max(0,Math.ceil((30000-frame)/1000));
    draw();raf=requestAnimationFrame(tick);
  }
  async function start(){cancelAnimationFrame(raf);rewardRoundId=null;rewardEligible=false;if(signedInCustomer()){try{const {data,error}=await window.swiftHaulSupabase.functions.invoke('customer-dash-rewards',{body:{action:'start_round'}});if(error)throw error;rewardRoundId=data.round_id;rewardEligible=true;}catch{message.textContent='Rewards connection unavailable — this run is for fun only.';}}lane=1;score=0;seconds=30;frame=0;lastSpawn=0;lastTime=0;items=[];scoreEl.textContent='0';timeEl.textContent='30';running=true;startBtn.textContent='Restart';message.textContent='Collect the parcels and avoid the cones!';raf=requestAnimationFrame(tick)}
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