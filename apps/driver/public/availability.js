(() => {
 if(document.body.dataset.app!=="driver")return;
 const $=id=>document.getElementById(id),toggle=$("driver-online-toggle"),onlineLabel=$("driver-online-label"),state=$("availability-state"),list=$("driver-offers");
 let active=false,busy=false,timer=null,offersById=new Map();
 const money=v=>"R"+Number(v||0).toFixed(2);
 async function call(method,body){const c=window.swiftHaulSupabase;if(!c)throw Error("Secure account connection unavailable.");const {data,error}=await c.functions.invoke("dispatch-offers",{method,...(body?{body}:{})});if(error||data?.error)throw Error(data?.error||error.message||"Dispatch request failed.");return data;}
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 function complianceBanner(){const b=el("div",undefined,"driver-compliance-banner");b.append(el("strong","Online access is locked"));b.append(el("p","Your onboarding documents or background checks still need approval. You cannot receive dispatch offers yet."));const a=el("a","Review onboarding documents");a.href="?page=onboarding";a.dataset.page="onboarding";b.append(a);return b;}
 function renderOffer(o){
  const b=o.customer_bookings||{},card=el("article",undefined,"dispatch-offer-modal");card.setAttribute("role","dialog");card.setAttribute("aria-label","Incoming delivery request");
  const head=el("div",undefined,"dispatch-offer-head");head.append(el("span","NEW DELIVERY REQUEST","dispatch-offer-kicker"),el("strong","30 SEC","dispatch-offer-clock"));card.append(head);
  card.append(el("h3",b.pickup||"Pickup location","dispatch-offer-place"),el("p","PICKUP AREA","dispatch-offer-label"));
  card.append(el("h3",b.dropoff||"Drop-off location","dispatch-offer-place"),el("p","DROP-OFF AREA","dispatch-offer-label"));
  const stats=el("div",undefined,"dispatch-offer-stats");
  const km=Number(o.distance_meters??b.distance_meters??0)/1000;
  stats.append(el("div",undefined));stats.lastChild.append(el("span","DISTANCE"),el("strong",km>0?km.toFixed(1)+" km":"—"));
  const net=Number(o.net_payout_zar??Number(b.price||0)*.75);
  stats.append(el("div",undefined));stats.lastChild.append(el("span","YOUR NET PAYOUT"),el("strong",money(net)));
  card.append(stats);
  const track=el("div",undefined,"dispatch-countdown-track"),bar=el("div",undefined,"dispatch-countdown-fill");track.append(bar);card.append(track);
  const actions=el("div",undefined,"dispatch-offer-actions");
  const accept=el("button","Accept delivery","primary"),decline=el("button","Decline","quiet");accept.type=decline.type="button";
  accept.addEventListener("click",()=>respond(o.id,"accept",card));decline.addEventListener("click",()=>respond(o.id,"decline",card));
  actions.append(accept,decline);card.append(actions);
  card.dataset.expires=String(new Date(o.expires_at).getTime());card.dataset.offerId=o.id;
  card._countdown={bar,clock:head.querySelector(".dispatch-offer-clock"),expires:Date.parse(o.expires_at)};
  return card;
 }
 function tick(){const now=Date.now();list.querySelectorAll("[data-offer-id]").forEach(card=>{const x=card._countdown;if(!x)return;const left=Math.max(0,x.expires-now),seconds=Math.ceil(left/1000);x.bar.style.width=(left/30000*100)+"%";x.clock.textContent=seconds+" SEC";if(left===0){card.classList.add("is-expired");x.clock.textContent="EXPIRED";card.querySelectorAll("button").forEach(b=>b.disabled=true);}});}
 async function load(){
  if(!active||busy||document.body.dataset.guestPreview==="true")return;
  try{
   const d=await call("GET");const eligible=d.driver?.can_go_online===true;
   toggle.checked=d.driver?.is_online===true;if(onlineLabel)onlineLabel.textContent=toggle.checked?"Go Offline":"Go Online";toggle.disabled=!eligible;
   state.textContent=!eligible?"Your account is not cleared for online work.":toggle.checked?"You are ONLINE and eligible for delivery offers.":"You are OFFLINE and will not receive delivery offers.";
   list.replaceChildren();offersById.clear();
   if(!eligible)list.append(complianceBanner());
   for(const o of d.offers||[]){if(offersById.has(o.id))continue;offersById.set(o.id,true);list.append(renderOffer(o));}
   tick();
  }catch(e){state.textContent=e.message||"Unable to load availability.";}
 }
 async function respond(id,response,card){
  if(busy||Date.now()>=Number(card.dataset.expires)){card.classList.add("is-expired");return;}
  busy=true;card.querySelectorAll("button").forEach(b=>b.disabled=true);
  try{await call("POST",{action:"respond_offer",offer_id:id,response});if(response==="accept"){state.textContent="Delivery accepted. Your active trip and route are available in Dispatches.";const link=el("a","Open active trip");link.href="?page=deliveries";link.dataset.page="deliveries";list.replaceChildren(el("p","You have accepted this delivery."),link);}else{card.remove();state.textContent="Offer declined.";}}
  catch(e){state.textContent=e.message||"Unable to respond to offer.";card.querySelectorAll("button").forEach(b=>b.disabled=false);}
  finally{busy=false;await load();}
 }
 toggle.addEventListener("change",async()=>{
  if(!toggle.checked){toggle.disabled=true;try{const d=await call("POST",{action:"set_online",online:false});toggle.checked=d.is_online;state.textContent="You are OFFLINE.";}catch(e){state.textContent=e.message||"Unable to update availability.";}finally{toggle.disabled=false;}return;}
  toggle.disabled=true;
  try{const check=await call("GET");if(check.driver?.can_go_online!==true)throw Error("Your documents or background check are not approved. Review onboarding before going online.");const d=await call("POST",{action:"set_online",online:true});toggle.checked=d.is_online;if(onlineLabel)onlineLabel.textContent=toggle.checked?"Go Offline":"Go Online";state.textContent=d.is_online?"You are ONLINE. GPS and dispatch services can now be enabled for eligible work.":"You are OFFLINE.";}
  catch(e){toggle.checked=false;state.textContent=e.message||"Unable to update availability.";list.replaceChildren(complianceBanner());}
  finally{toggle.disabled=false;}
 });
 document.addEventListener("account-ready",()=>{active=true;load();if(timer)clearInterval(timer);timer=setInterval(load,5000);});
 const clear=()=>{active=false;if(timer)clearInterval(timer);timer=null;offersById.clear();toggle.checked=false;if(onlineLabel)onlineLabel.textContent="Go Online";toggle.disabled=true;list.replaceChildren();state.textContent="Sign in to manage availability.";};
 document.addEventListener("account-cleared",clear);document.addEventListener("guest-preview",clear);
 setInterval(tick,250);
})();