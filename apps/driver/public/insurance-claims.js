(() => {
  if(document.body.dataset.app!=="driver")return;
  const panel=document.getElementById("insurance-claims");
  if(!panel)return;
  const form=document.getElementById("insurance-claim-form");
  const status=document.getElementById("insurance-claim-status");
  const list=document.getElementById("insurance-claim-list");
  let active=false;
  const client=()=>window.swiftHaulSupabase;
  async function load(){
    if(!active||!client())return;
    status.textContent="Loading your insurance claims…";
    try{
      const {data,error}=await client().functions.invoke("driver-insurance-claims",{method:"GET"});
      if(error||data?.error)throw new Error(data?.error||error.message);
      list.replaceChildren();
      if(!data.claims?.length){status.textContent="No insurance claims submitted.";return;}
      for(const claim of data.claims){
        const card=document.createElement("article");card.className="order";
        const title=document.createElement("h3");title.textContent=claim.waybill+" · "+claim.status.replaceAll("_"," ");
        const detail=document.createElement("p");detail.textContent=new Date(claim.incident_at).toLocaleString("en-ZA")+" · "+claim.incident_type.replaceAll("_"," ");
        const amount=document.createElement("p");amount.textContent="Requested: R"+(Number(claim.requested_benefit_cents)/100).toFixed(2)+" · "+claim.requested_days+" day(s), maximum 5";
        const route=document.createElement("p");route.textContent="Route compliance: "+claim.route_compliance.replaceAll("_"," ");
        card.append(title,detail,amount,route);
        for(const doc of claim.documents||[]){
          if(doc.signed_url){const a=document.createElement("a");a.href=doc.signed_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="View "+doc.original_name;card.append(a);}
        }
        list.append(card);
      }
      status.textContent="Loaded "+data.claims.length+" claim(s). Claims remain subject to insurer and route-compliance review.";
    }catch(error){status.textContent=error.message||"Could not load claims.";}
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!active||!client()){status.textContent="Sign in to submit an insurance claim.";return;}
    const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
    status.textContent="Submitting claim and securely uploading evidence…";
    try{
      const fd=new FormData(form);
      fd.set("action","submit");
      const {data,error}=await client().functions.invoke("driver-insurance-claims",{body:fd});
      if(error||data?.error)throw new Error(data?.error||error.message);
      status.textContent=data.notice+" Evidence uploaded: "+data.evidence_uploaded+".";
      form.reset();await load();
    }catch(error){status.textContent=error.message||"Claim submission failed.";}
    finally{submit.disabled=false;}
  });
  document.getElementById("insurance-claim-refresh").addEventListener("click",load);
  document.addEventListener("account-ready",()=>{active=true;load();});
  const clear=()=>{active=false;list.replaceChildren();status.textContent="Sign in to submit or view insurance claims.";};
  document.addEventListener("account-cleared",clear);document.addEventListener("guest-preview",clear);
})();
