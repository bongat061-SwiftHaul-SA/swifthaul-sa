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
  if(order.paid_at){
   const taxCard=document.createElement("section");taxCard.className="track-card";taxCard.id="track-tax-documents";
   const taxTitle=document.createElement("h2");taxTitle.textContent="Tax invoice / payment receipt";
   const taxInfo=document.createElement("p");taxInfo.className="track-note";taxInfo.textContent="Your payment is confirmed. Download your available PDF documents below.";
   const taxList=document.createElement("div");taxList.className="track-actions";
   const apiBase=String(window.SWIFTHAUL_TAX_API_BASE_URL||"").replace(/\\/$/,"");
   const taxApi=(path)=>apiBase+path;
   const loadTaxDocs=async()=>{try{const r=await fetch(taxApi("/api/tax-documents/tracking?tracking_code="+encodeURIComponent(code)));const j=await r.json();if(!r.ok)throw new Error(j.error||"Tax documents unavailable.");taxList.replaceChildren();(j.documents||[]).filter(d=>d.storage_ready).forEach(d=>{const a=document.createElement("a");a.href=taxApi("/api/tax-documents/tracking/download?tracking_code="+encodeURIComponent(code)+"&document_id="+encodeURIComponent(d.id));a.textContent="Download "+d.document_number+" PDF";a.target="_blank";a.rel="noopener";a.className="track-link";taxList.append(a);});if(!taxList.childElementCount){const wait=document.createElement("p");wait.className="track-note";wait.textContent="Your payment receipt is being prepared. Please refresh this page shortly.";taxList.append(wait);}if(Number(j.total_zar)>5000){const form=document.createElement("div");form.className="track-billing-form";const intro=document.createElement("p");intro.className="track-note";intro.textContent="For a full SARS tax invoice on orders above R5,000, provide the recipient business details.";const company=document.createElement("input");company.placeholder="Company / legal name";company.maxLength=160;const vat=document.createElement("input");vat.placeholder="VAT number (10 digits, if registered)";vat.inputMode="numeric";vat.maxLength=10;const address=document.createElement("textarea");address.placeholder="Registered billing address";address.maxLength=500;const send=document.createElement("button");send.type="button";send.textContent="Generate full tax invoice";const result=document.createElement("p");result.className="track-note";send.addEventListener("click",async()=>{send.disabled=true;try{const response=await fetch(taxApi("/api/tax-documents/tracking"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tracking_code:code,billing_company_name:company.value,billing_vat_number:vat.value,billing_address:address.value})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Invoice request failed.");result.textContent="Tax invoice "+data.document_number+" generated.";await loadTaxDocs();}catch(e){result.textContent=e.message;}finally{send.disabled=false;}});form.append(intro,company,vat,address,send,result);taxCard.append(form);}}catch(e){taxInfo.textContent=e.message+" If this continues, contact SwiftHaul support.";}}; 
   taxCard.append(taxTitle,taxInfo,taxList);content.append(taxCard);void loadTaxDocs();
  }
  if(order.status==="delivered"){
   const card=document.createElement("section");card.className="track-card";card.id="track-rating-card";
   const heading=document.createElement("h2");heading.textContent="Rate your delivery";
   const intro=document.createElement("p");intro.className="track-note";intro.textContent="Your feedback helps SwiftHaul recognise great service and address delivery issues.";
   const stars=document.createElement("div");stars.style.display="flex";stars.style.gap="8px";stars.setAttribute("role","radiogroup");stars.setAttribute("aria-label","Choose a rating from one to five stars");
   let selected=0;const starButtons=[];
   const paint=()=>starButtons.forEach((b,i)=>{b.style.color=i<selected?"#f5c451":"#697581";b.setAttribute("aria-checked",String(i+1===selected));});
   for(let i=1;i<=5;i++){const b=document.createElement("button");b.type="button";b.textContent="★";b.style.cssText="font-size:32px;background:transparent;border:0;padding:3px;cursor:pointer";b.setAttribute("role","radio");b.setAttribute("aria-label",i+" stars");b.addEventListener("click",()=>{selected=i;paint();renderTags();});stars.append(b);starButtons.push(b);}
   const tagBox=document.createElement("div");tagBox.className="track-actions";
   const comment=document.createElement("textarea");comment.maxLength=1200;comment.placeholder="Optional comment";comment.style.cssText="width:100%;min-height:85px;background:#0d1116;color:#fff;border:1px solid #38424d;border-radius:10px;padding:12px;margin-top:12px";
   const submit=document.createElement("button");submit.type="button";submit.textContent="Submit rating";
   const feedback=document.createElement("p");feedback.className="track-note";feedback.setAttribute("role","status");
   const tagsPositive=["On time","Friendly driver","Careful handling","Great communication"],tagsIssue=["Damaged Parcel","Asked for Extra Cash","Late delivery","Poor communication","Parcel mishandled","Other"];
   const renderTags=()=>{tagBox.replaceChildren();const label=document.createElement("p");label.className="track-note";label.textContent=selected>=4?"What went well? (optional)":selected>=1?"What could be improved? (optional)": "Choose stars to add optional feedback";tagBox.append(label);if(!selected)return;(selected>=4?tagsPositive:tagsIssue).forEach(tag=>{const b=document.createElement("button");b.type="button";b.textContent=tag;b.dataset.selected="false";b.addEventListener("click",()=>{b.dataset.selected=b.dataset.selected==="true"?"false":"true";b.style.background=b.dataset.selected==="true"?"#46515d":"#1b222a";});tagBox.append(b);});};
   submit.addEventListener("click",async()=>{if(!selected){feedback.textContent="Please select a star rating.";return;}submit.disabled=true;try{const chosen=[...tagBox.querySelectorAll("button[data-selected=true]")].map(b=>b.textContent);const response=await fetch(SUPABASE_URL+"/functions/v1/order-rating",{method:"POST",headers:{apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({tracking_code:code,rater_role:"recipient",stars:selected,tags:chosen,comment:comment.value})});const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||"Rating could not be saved.");feedback.textContent="Thank you. Your rating has been saved.";card.querySelectorAll("button,textarea").forEach(el=>el.disabled=true);}catch(e){feedback.textContent=e.message;submit.disabled=false;}});
   card.append(heading,intro,stars,tagBox,comment,submit,feedback);
   const previous=await fetch(SUPABASE_URL+"/functions/v1/order-rating?tracking_code="+encodeURIComponent(code),{headers:{apikey:SUPABASE_PUBLISHABLE_KEY}}).then(r=>r.json()).catch(()=>null);
   if(previous?.ratings?.some(r=>r.rater_role==="recipient")){feedback.textContent="Thank you. You have already rated this delivery.";card.querySelectorAll("button,textarea").forEach(b=>b.disabled=true);}
   content.append(card);
  }
 }catch(e){status.textContent=e.message;status.className="track-error";}
}