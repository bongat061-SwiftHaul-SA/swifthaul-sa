(() => {
  if(document.body.dataset.app!=="company")return;
  const panel=document.getElementById("insurance-claims-admin");if(!panel)return;
  const status=document.getElementById("insurance-claims-admin-status"),list=document.getElementById("insurance-claims-admin-list");
  let active=false,isAdmin=false,epoch=0;
  async function invoke(method,body){
    const client=window.swiftHaulSupabase;if(!client)throw new Error("Secure account connection is unavailable.");
    const {data,error}=await client.functions.invoke("driver-insurance-claims",{method,...(body?{body}:{})});
    if(error||data?.error)throw new Error(data?.error||error.message||"Claims request failed.");return data;
  }
  function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
  function button(label,fn){const b=el("button",label);b.type="button";b.addEventListener("click",()=>fn(b));return b;}
  async function act(claim,action,fields,b){
    b.disabled=true;try{await invoke("POST",{claim_id:claim.id,action,...fields});status.textContent="Claim record updated.";await load();}
    catch(e){status.textContent=e.message||"Claim update failed.";}finally{b.disabled=false;}
  }
  function render(c){
    const card=el("article");card.className="order";
    card.append(el("h3",c.waybill+" · "+c.status.replaceAll("_"," ")));
    card.append(el("p","Driver: "+c.driver_user_id+" · Incident: "+new Date(c.incident_at).toLocaleString("en-ZA")+" · "+c.incident_type));
    card.append(el("p","Requested daily benefit: "+c.requested_days+" day(s) · R"+(Number(c.requested_benefit_cents)/100).toFixed(2)+" (maximum 5 days / R5,000)"));
    card.append(el("p","Route compliance: "+c.route_compliance+(c.route_review_note?" · "+c.route_review_note:"")));
    card.append(el("p","Incident: "+c.description));
    const trace=c.route_trace||[];
    card.append(el("p","GPS evidence: "+trace.length+" point(s) within 30 minutes either side of incident. Review the complete trip and check for unexplained stops or route diversions."));
    if(trace.length){
      const details=el("details"),summary=el("summary","View GPS route evidence");details.append(summary);
      trace.forEach(p=>details.append(el("p",new Date(p.recorded_at).toLocaleTimeString("en-ZA")+" · "+Number(p.latitude).toFixed(6)+", "+Number(p.longitude).toFixed(6)+" · ±"+Math.round(p.accuracy_m||0)+"m")));
      card.append(details);
    }
    for(const doc of c.documents||[]){if(doc.signed_url){const a=el("a","Open secure evidence · "+doc.original_name);a.href=doc.signed_url;a.target="_blank";a.rel="noopener noreferrer";card.append(a);}}
    if(c.route_compliance==="pending"){
      card.append(button("Confirm route compliant",b=>{
        const note=window.prompt("Confirm no unexplained stops or diversions from the authorised route. Enter review notes:");
        if(note&&note.trim().length>=10)act(c,"route_review",{route_compliance:"compliant",route_review_note:note},b);
        else status.textContent="A route-review note of at least 10 characters is required.";
      }));
      card.append(button("Flag route stop / diversion",b=>{
        const note=window.prompt("Describe the unexplained stop or route diversion:");
        if(note&&note.trim().length>=10)act(c,"route_review",{route_compliance:"breach",route_review_note:note},b);
        else status.textContent="A route-review note of at least 10 characters is required.";
      }));
    }
    if(c.route_compliance==="compliant"&&["submitted","under_review"].includes(c.status)){
      card.append(button("Record insurer approval",b=>{
        const insurer=window.prompt("Insurer name:");if(!insurer)return;
        const ref=window.prompt("Insurer claim reference:");if(!ref)return;
        const days=Number(window.prompt("Approved daily benefit days (1–5):","5"));
        const note=window.prompt("Insurer decision note:");
        if(!Number.isInteger(days)||days<1||days>5||!note||note.trim().length<10){status.textContent="Enter 1–5 days and a decision note of at least 10 characters.";return;}
        act(c,"insurer_decision",{decision:"approve",insurer_name:insurer,insurer_claim_reference:ref,approved_days:days,insurer_decision_note:note},b);
      }));
    }
    if(c.status!=="declined"&&c.status!=="paid"&&c.status!=="insurer_approved"){
      card.append(button("Record insurer decline",b=>{
        const insurer=window.prompt("Insurer name:");if(!insurer)return;
        const ref=window.prompt("Insurer claim reference:");if(!ref)return;
        const note=window.prompt("Insurer decline reason:");
        if(!note||note.trim().length<10){status.textContent="An insurer decision note is required.";return;}
        act(c,"insurer_decision",{decision:"decline",insurer_name:insurer,insurer_claim_reference:ref,insurer_decision_note:note},b);
      }));
    }
    if(c.status==="insurer_approved"){
      card.append(el("p","Insurer-approved benefit: R"+(Number(c.approved_benefit_cents)/100).toFixed(2)+" for "+c.approved_days+" day(s)."));
      card.append(button("Record payment",b=>{
        const ref=window.prompt("Payment / settlement reference:");
        if(ref&&ref.trim().length>=3)act(c,"mark_paid",{payment_reference:ref},b);
      }));
    }
    list.append(card);
  }
  async function load(){
    if(!active||!isAdmin)return;const n=++epoch;status.textContent="Loading insurance claims…";
    try{const d=await invoke("GET");if(n!==epoch)return;list.replaceChildren();(d.claims||[]).forEach(render);
      status.textContent=d.claims?.length?"Loaded "+d.claims.length+" claim(s). Route evidence and insurer decisions require manual review.":"No insurance claims have been submitted.";
    }catch(e){if(n===epoch)status.textContent=e.message||"Could not load claims.";}
  }
  document.getElementById("insurance-claims-admin-refresh").addEventListener("click",load);
  document.addEventListener("account-ready",e=>{active=true;isAdmin=e.detail.role==="admin";if(isAdmin)load();else status.textContent="Administrator access required.";});
  document.addEventListener("account-cleared",()=>{active=false;isAdmin=false;epoch++;list.replaceChildren();status.textContent="Sign in as an administrator to review claims.";});
})();
