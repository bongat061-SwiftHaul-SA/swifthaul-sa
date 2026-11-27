(() => {
  'use strict';
  const canvas=document.querySelector('[data-offline-game]'), ctx=canvas?.getContext('2d');
  if(!canvas||!ctx)return;
  const scoreEl=document.querySelector('[data-score]'),timeEl=document.querySelector('[data-time]'),bestEl=document.querySelector('[data-best]');
  const startBtn=document.querySelector('[data-start]'),message=document.querySelector('[data-message]');
  const lanes=[76,180,284];let lane=1,score=0,best=0,frame=0,lastSpawn=0,lastTime=0,items=[],raf=0,running=false;
  try{best=Number(localStorage.getItem('swifthaul-driver-dash-best')||0)||0}catch{}
  bestEl.textContent=String(best);
  function saveBest(){if(score<=best)return;best=score;bestEl.textContent=String(best);try{localStorage.setItem('swifthaul-driver-dash-best',String(best))}catch{}}
  function draw(){ctx.clearRect(0,0,360,480);ctx.fillStyle='#222a33';ctx.fillRect(0,0,360,480);ctx.fillStyle='#303a45';ctx.fillRect(26,0,308,480);ctx.strokeStyle='#7e8996';ctx.lineWidth=3;ctx.setLineDash([22,20]);ctx.beginPath();ctx.moveTo(128,0);ctx.lineTo(128,480);ctx.moveTo(232,0);ctx.lineTo(232,480);ctx.stroke();ctx.setLineDash([]);items.forEach(o=>{ctx.font='26px sans-serif';ctx.textAlign='center';ctx.fillText(o.type==='parcel'?'📦':'🚧',lanes[o.lane],o.y)});ctx.font='38px sans-serif';ctx.textAlign='center';ctx.fillText('🚚',lanes[lane],410);ctx.fillStyle='#f4f6f8';ctx.font='12px system-ui';ctx.fillText('SWIFTHAUL DELIVERY RUN',180,24)}
  function finish(){running=false;cancelAnimationFrame(raf);startBtn.textContent='Play again';message.textContent='Run complete! You collected '+score+' parcel points. Your best score is saved on this device.';saveBest();draw()}
  function tick(now){if(!running)return;const dt=Math.min(40,now-lastTime||16);lastTime=now;frame+=dt;if(frame-lastSpawn>650){items.push({lane:Math.floor(Math.random()*3),y:-20,type:Math.random()<.68?'parcel':'cone'});lastSpawn=frame}items.forEach(o=>o.y+=dt*.23);const hit=items.find(o=>o.y>375&&o.y<445&&o.lane===lane);if(hit){if(hit.type==='parcel'){score+=10;scoreEl.textContent=String(score);saveBest()}else message.textContent='Watch those cones!';items=items.filter(x=>x!==hit)}items=items.filter(o=>o.y<510);if(frame>=30000){finish();return}timeEl.textContent=String(Math.max(0,Math.ceil((30000-frame)/1000)));draw();raf=requestAnimationFrame(tick)}
  function start(){cancelAnimationFrame(raf);lane=1;score=0;frame=0;lastSpawn=0;lastTime=0;items=[];scoreEl.textContent='0';timeEl.textContent='30';running=true;startBtn.textContent='Restart';message.textContent='Offline mode: collect parcels and dodge cones!';raf=requestAnimationFrame(tick)}
  function move(d){if(running)lane=Math.max(0,Math.min(2,lane+d))}
  document.querySelector('[data-left]').addEventListener('click',()=>move(-1));document.querySelector('[data-right]').addEventListener('click',()=>move(1));startBtn.addEventListener('click',start);
  let sx=null;canvas.addEventListener('touchstart',e=>{sx=e.touches[0].clientX},{passive:true});canvas.addEventListener('touchend',e=>{if(sx===null)return;const dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>18)move(dx<0?-1:1);sx=null},{passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1)});
  draw();
})();