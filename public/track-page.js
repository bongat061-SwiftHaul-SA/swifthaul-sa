import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const params=new URLSearchParams(location.search),code=(params.get("code")||"").trim();
const status=document.getElementById("track-status"),content=document.getElementById("track-content");
if(!code){status.textContent="This tracking link is incomplete. Please use the full link shared by SwiftHaul.";status.className="track-error";}
else{
 try{
  const response=await fetch(SUPABASE_URL+"/functions/v1/order-chat",{method:"POST",headers:{apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({action:"list",tracking_code:code})});
  const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||"Tracking is unavailable.");
  const order=data.order||{};document.getElementById("track-state").textContent=String(order.status||"").replaceAll("_"," ").toUpperCase();
  document.getElementById("track-waybill").textContent="Reference "+order.waybill;
  document.getElementById("track-pickup").textContent=order.pickup||"Pickup location";
  document.getElementById("track-dropoff").textContent=order.dropoff||"Drop-off location";
  document.getElementById("track-chat").addEventListener("click",()=>window.openSwiftHaulChat({orderId:order.waybill,trackingCode:code,role:"recipient"}));
  content.hidden=false;status.textContent="Your delivery details are available.";
 }catch(e){status.textContent=e.message;status.className="track-error";}
}