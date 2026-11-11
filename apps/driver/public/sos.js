(() => {
 if(document.body.dataset.app!=="driver")return;
 const style=document.createElement("style");style.textContent=`
 .sh-sos-trigger{position:fixed;z-index:1200;top:14px;right:16px;background:#c92332;color:white;border:1px solid #ff6974;border-radius:999px;padding:11px 18px;font-weight:900;letter-spacing:.08em;box-shadow:0 8px 28px #0009;cursor:pointer}
 .sh-sos-overlay{position:fixed;inset:0;z-index:1300;background:#050609eF;display:grid;place-items:center;padding:18px}
 .sh-sos-modal{width:min(480px,100%);background:#15191f;border:1px solid #6d3037;border-radius:20px;padding:24px;color:#f7f8fa;box-shadow:0 25px 90px #000b}
 .sh-sos-modal h2{margin:0 0 8px;font-size:24px}.sh-sos-modal p{color:#c2c9d1}.sh-sos-hold{width:100%;padding:19px;background:#a91e2b;color:white;border:2px solid #ff7b85;border-radius:14px;font-weight:900;font-size:16px;touch-action:none}.sh-sos-range{width:100%;accent-color:#f04452}.sh-sos-emergency{display:flex;gap:10px;margin:16px 0}.sh-sos-emergency a{flex:1;text-align:center;background:#272e37;color:white;border:1px solid #424b57;border-radius:10px;padding:12px;text-decoration:none;font-weight:800}.sh-sos-close{background:transparent;color:#cbd2da;border:1px solid #414954;border-radius:9px;padding:10px 14px}.sh-sos-status{min-height:24px;font-size:13px;color:#ffd2d5}`;
 document.head.append(style);
 const button=document.createElement("button");button.className="sh-sos-trigger";button.type="button";button.textContent="SOS · EMERGENCY";button.setAttribute("aria-label","Open emergency SOS controls");document.body.append(button);
 let overlay=null,holdTimer=null,holdStart=0,triggered=false;
 const trigger=async()=>{
  if(triggered)return;triggered=true;
  const status=overlay.querySelector(".sh-sos-status"),hold=overlay.querySelector(".sh-sos-hold"),range=overlay.querySelector(".sh-sos-range");
  hold.disabled=true;range.disabled=true;status.textContent="Getting your current GPS location…";
  if(!navigator.geolocation){status.textContent="GPS is unavailable on this device. Call emergency services directly.";hold.disabled=false;range.disabled=false;triggered=false;return;}
  navigator.geolocation.getCurrentPosition(async pos=>{
   status.textContent="Sending emergency alert…";
   try{
    const client=window.swiftHaulSupabase;if(!client)throw new Error("Secure connection unavailable");
    const activeOrder=document.querySelector("#dispatches .order[data-delivery-status=\"accepted\"],#dispatches .order[data-delivery-status=\"picked_up\"],#dispatches .order[data-delivery-status=\"in_transit\"]")?.dataset.waybill||null;
    const {data,error}=await client.functions.invoke("driver-sos",{body:{lat:pos.coords.latitude,lng:pos.coords.longitude,order_id:activeOrder}});
    if(error||!data?.success)throw new Error(data?.error||error?.message||"SOS request failed");
    status.textContent="SOS logged. Incident "+data.incident.id+". Notifications: "+(data.notifications||[]).filter(x=>x.queued).length+" queued. Call emergency services if you need immediate help.";
    hold.textContent="SOS ACTIVATED";button.textContent="SOS ACTIVE";
   }catch(error){status.textContent="Could not send SOS: "+error.message+". Call emergency services directly.";hold.disabled=false;range.disabled=false;triggered=false;}
  },error=>{status.textContent="Could not obtain GPS ("+error.message+"). SOS not sent. Call emergency services directly.";hold.disabled=false;range.disabled=false;triggered=false;},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 };
 const close=()=>{if(holdTimer)clearInterval(holdTimer);holdTimer=null;overlay?.remove();overlay=null;if(!triggered)button.textContent="SOS · EMERGENCY";};
 button.addEventListener("click",()=>{
  if(overlay)return;
  overlay=document.createElement("div");overlay.className="sh-sos-overlay";overlay.innerHTML=`<section class="sh-sos-modal" role="dialog" aria-modal="true" aria-labelledby="sh-sos-title"><p class="eyebrow">SWIFTHAUL DRIVER SAFETY</p><h2 id="sh-sos-title">Emergency assistance</h2><p>Use SOS only when you need urgent help. Hold the button for 3 seconds or slide the control fully to activate.</p><button class="sh-sos-hold" type="button">HOLD 3 SECONDS TO TRIGGER</button><p>Or slide to trigger</p><input class="sh-sos-range" type="range" min="0" max="100" value="0" aria-label="Slide fully to trigger SOS"><div class="sh-sos-emergency"><a href="tel:10111">SAPS · 10111</a><a href="tel:10177">Ambulance · 10177</a></div><p class="sh-sos-status" role="status" aria-live="polite"></p><button class="sh-sos-close" type="button">Close</button></section>`;
  document.body.append(overlay);
  const hold=overlay.querySelector(".sh-sos-hold"),range=overlay.querySelector(".sh-sos-range");
  const start=()=>{if(holdTimer||triggered)return;holdStart=Date.now();hold.textContent="KEEP HOLDING · 3";holdTimer=setInterval(()=>{const left=Math.max(0,3-Math.floor((Date.now()-holdStart)/1000));hold.textContent=left?"KEEP HOLDING · "+left:"ACTIVATING…";if(Date.now()-holdStart>=3000){clearInterval(holdTimer);holdTimer=null;trigger();}},100);};
  const stop=()=>{if(holdTimer)clearInterval(holdTimer);holdTimer=null;if(!triggered)hold.textContent="HOLD 3 SECONDS TO TRIGGER";};
  hold.addEventListener("pointerdown",e=>{e.preventDefault();start();});["pointerup","pointerleave","pointercancel"].forEach(e=>hold.addEventListener(e,stop));
  range.addEventListener("input",()=>{if(Number(range.value)>=100)trigger();});
  overlay.querySelector(".sh-sos-close").addEventListener("click",close);
  overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
 });
})();