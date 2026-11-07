import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
const DAY=86400000, DAILY_CENTS=100000, MAX_DAYS=5, MAX_FILE=10*1024*1024;
const allowedTypes=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
  const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return reply(401,{error:"missing_bearer_token"});
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await auth.auth.getUser(token);
  if(authError||!authData.user)return reply(401,{error:"invalid_or_expired_session"});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const actorId=authData.user.id;
  const {data:profile,error:profileError}=await db.from("user_profiles").select("role,account_status").eq("id",actorId).maybeSingle();
  if(profileError)return reply(500,{error:"profile_lookup_failed"});
  if(!profile||profile.account_status!=="active"||!["driver","admin"].includes(profile.role))
    return reply(403,{error:"active_driver_or_admin_required"});
  const isAdmin=profile.role==="admin";

  async function documents(claimId:string){
    const {data,error}=await db.from("driver_insurance_claim_documents").select("id,original_name,content_type,file_size_bytes,created_at,storage_path")
      .eq("claim_id",claimId).order("created_at",{ascending:true});
    if(error)throw new Error("claim_documents_lookup_failed");
    const result=[];
    for(const doc of data??[]){
      const {data:signed,error:signedError}=await db.storage.from("driver-insurance-claims").createSignedUrl(doc.storage_path,300);
      result.push({id:doc.id,original_name:doc.original_name,content_type:doc.content_type,file_size_bytes:doc.file_size_bytes,created_at:doc.created_at,signed_url:signedError?null:signed?.signedUrl??null});
    }
    return result;
  }
  if(req.method==="GET"){
    const claimId=new URL(req.url).searchParams.get("claim_id");
    let query=db.from("driver_insurance_claims").select("id,driver_user_id,waybill,incident_at,incident_type,description,requested_days,requested_benefit_cents,approved_days,approved_benefit_cents,status,route_compliance,route_review_note,insurer_name,insurer_claim_reference,insurer_decision_note,payment_reference,created_at,updated_at")
      .order("created_at",{ascending:false}).limit(100);
    if(!isAdmin)query=query.eq("driver_user_id",actorId);
    if(claimId)query=query.eq("id",claimId);
    const {data:claims,error}=await query;
    if(error)return reply(500,{error:"claims_lookup_failed"});
    const results=[];
    for(const claim of claims??[]){
      const docs=await documents(claim.id);
      let trace:Record<string,unknown>[]=[];
      let trip:Record<string,unknown>|null=null;
      if(isAdmin){
        const {data:booking,error:bookingError}=await db.from("customer_bookings")
          .select("pickup,dropoff,quote_id,status,accepted_at,picked_up_at,in_transit_at,completed_at")
          .eq("waybill",claim.waybill).maybeSingle();
        if(bookingError)return reply(500,{error:"claim_dispatch_details_lookup_failed"});
        let plannedRoute:unknown=null;
        if(booking?.quote_id){
          const {data:quote,error:quoteError}=await db.from("delivery_quotes").select("route").eq("id",booking.quote_id).maybeSingle();
          if(quoteError)return reply(500,{error:"claim_planned_route_lookup_failed"});
          plannedRoute=quote?.route??null;
        }
        trip=booking?{pickup:booking.pickup,dropoff:booking.dropoff,status:booking.status,
          accepted_at:booking.accepted_at,picked_up_at:booking.picked_up_at,in_transit_at:booking.in_transit_at,
          completed_at:booking.completed_at,planned_route:plannedRoute}:null;
        const {data:events,error:eventError}=await db.from("driver_insurance_trip_location_events")
          .select("latitude,longitude,accuracy_m,recorded_at").eq("waybill",claim.waybill)
          .eq("driver_user_id",claim.driver_user_id)
          .gte("recorded_at",new Date(Date.parse(claim.incident_at)-30*60000).toISOString())
          .lte("recorded_at",new Date(Date.parse(claim.incident_at)+30*60000).toISOString())
          .order("recorded_at",{ascending:true}).limit(500);
        if(eventError)return reply(500,{error:"route_evidence_lookup_failed"});
        trace=events??[];
      }
      results.push({...claim,documents:docs, ...(isAdmin?{route_trace:trace,trip}: {})});
    }
    return reply(200,{claims:results,daily_benefit_cents:DAILY_CENTS,max_days_per_claim:MAX_DAYS,max_benefit_cents:DAILY_CENTS*MAX_DAYS});
  }

  const contentType=req.headers.get("content-type")??"";
  let body:Record<string,unknown>={},files:File[]=[];
  if(contentType.includes("multipart/form-data")){
    const form=await req.formData();
    for(const key of ["action","waybill","incident_at","incident_type","description","requested_days","claim_id","route_compliance","route_review_note","approved_days","insurer_name","insurer_claim_reference","insurer_decision_note","payment_reference"])
      {const value=form.get(key);if(typeof value==="string")body[key]=value;}
    files=form.getAll("evidence").filter((v):v is File=>v instanceof File);
  }else{
    try{const raw=await req.text();if(raw.length>12000)return reply(413,{error:"request_too_large"});body=JSON.parse(raw);}
    catch{return reply(400,{error:"invalid_json"});}
  }

  if(!isAdmin&&body.action!=="submit")return reply(403,{error:"driver_claim_submission_only"});
  if(body.action==="submit"){
    const waybill=typeof body.waybill==="string"?body.waybill.trim():"";
    const incidentAt=typeof body.incident_at==="string"?Date.parse(body.incident_at):NaN;
    const type=String(body.incident_type??"");
    const description=typeof body.description==="string"?body.description.trim():"";
    const days=Number(body.requested_days);
    if(!waybill||waybill.length>100||!Number.isFinite(incidentAt)||incidentAt>Date.now()||!["vehicle_accident","driver_injury","third_party_injury","vehicle_damage","other"].includes(type)||description.length<30||description.length>4000||!Number.isInteger(days)||days<1||days>MAX_DAYS)
      return reply(400,{error:"invalid_claim_details_maximum_five_days"});
    if(files.length>5||files.some(f=>f.size>MAX_FILE||!allowedTypes.has(f.type)))
      return reply(400,{error:"evidence_files_must_be_pdf_or_image_up_to_10mb_each_max_five"});
    const {data:booking,error:bookingError}=await db.from("customer_bookings")
      .select("waybill,driver_user_id,status,accepted_at,picked_up_at,in_transit_at,completed_at,refunded_at")
      .eq("waybill",waybill).maybeSingle();
    if(bookingError)return reply(500,{error:"dispatch_lookup_failed"});
    if(!booking||booking.driver_user_id!==actorId||booking.refunded_at)return reply(403,{error:"claim_requires_your_assigned_dispatch"});
    const acceptedAt=booking.accepted_at?Date.parse(booking.accepted_at):NaN;
    const completedAt=booking.completed_at?Date.parse(booking.completed_at):Infinity;
    if(!Number.isFinite(acceptedAt)||incidentAt<acceptedAt||incidentAt>completedAt||
      !["accepted","picked_up","in_transit","delivered"].includes(booking.status))
      return reply(409,{error:"incident_must_occur_during_accepted_assigned_trip"});
    const {data:policy,error:policyError}=await db.from("driver_insurance_policies")
      .select("id,status,coverage_starts_at,coverage_ends_at")
      .eq("driver_user_id",actorId).eq("status","active").maybeSingle();
    if(policyError)return reply(500,{error:"insurance_policy_lookup_failed"});
    if(!policy||Date.parse(policy.coverage_starts_at)>incidentAt||Date.parse(policy.coverage_ends_at)<=incidentAt)
      return reply(409,{error:"no_active_insurer_policy_at_incident_time"});
    const {data:membership,error:membershipError}=await db.from("driver_memberships")
      .select("id,plan,starts_at,ends_at,provider_payment_id")
      .eq("driver_user_id",actorId).not("provider_payment_id","is",null)
      .lte("starts_at",new Date(incidentAt).toISOString()).gt("ends_at",new Date(incidentAt).toISOString())
      .order("starts_at",{ascending:false}).limit(1).maybeSingle();
    if(membershipError)return reply(500,{error:"membership_lookup_failed"});
    if(!membership)return reply(409,{error:"premium_membership_not_active_at_incident"});
    if(membership.plan==="monthly"){
      const previousWindow=new Date(Date.parse(membership.starts_at)-7*DAY).toISOString();
      const {data:previous,error:previousError}=await db.from("driver_memberships").select("id")
        .eq("driver_user_id",actorId).eq("plan","monthly").not("provider_payment_id","is",null)
        .lt("ends_at",membership.starts_at).gte("ends_at",previousWindow).limit(1).maybeSingle();
      if(previousError)return reply(500,{error:"membership_history_lookup_failed"});
      if(!previous)return reply(409,{error:"second_consecutive_monthly_payment_required_at_incident"});
    }
    const {data:nearby,error:nearbyError}=await db.from("driver_insurance_trip_location_events")
      .select("recorded_at").eq("waybill",waybill).eq("driver_user_id",actorId)
      .gte("recorded_at",new Date(incidentAt-2*60000).toISOString())
      .lte("recorded_at",new Date(incidentAt+2*60000).toISOString())
      .order("recorded_at",{ascending:true}).limit(1).maybeSingle();
    if(nearbyError)return reply(500,{error:"gps_evidence_lookup_failed"});
    if(!nearby)return reply(409,{error:"gps_route_evidence_missing_near_incident"});
    const {data:claim,error:claimError}=await db.from("driver_insurance_claims").insert({
      driver_user_id:actorId,policy_id:policy.id,waybill,incident_at:new Date(incidentAt).toISOString(),
      incident_type:type,description,requested_days:days,status:"submitted",route_compliance:"pending",
    }).select("id,waybill,incident_at,requested_days,requested_benefit_cents,status,route_compliance").single();
    if(claimError)return reply(claimError.code==="23505"?409:500,{error:claimError.code==="23505"?"claim_already_submitted":"claim_create_failed"});
    const uploaded=[];
    for(const file of files){
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120)||"evidence";
      const path=actorId+"/"+claim.id+"/"+crypto.randomUUID()+"-"+safeName;
      const {error:uploadError}=await db.storage.from("driver-insurance-claims").upload(path,file,{contentType:file.type,upsert:false});
      if(uploadError){console.error("Claim evidence upload failed",uploadError.message);continue;}
      const {error:docError}=await db.from("driver_insurance_claim_documents").insert({
        claim_id:claim.id,driver_user_id:actorId,storage_path:path,original_name:file.name.slice(0,180),
        content_type:file.type,file_size_bytes:file.size,
      });
      if(docError){await db.storage.from("driver-insurance-claims").remove([path]);console.error("Claim document record failed",docError.message);continue;}
      uploaded.push(file.name);
    }
    return reply(201,{success:true,claim,evidence_uploaded:uploaded.length,evidence_failed:files.length-uploaded.length,
      notice:"Claim submitted for insurer and route-compliance review. Submission is not approval or a promise of payment."});
  }

  if(!isAdmin)return reply(403,{error:"administrator_access_required"});
  const claimId=typeof body.claim_id==="string"?body.claim_id:"";
  if(!/^[0-9a-f-]{36}$/i.test(claimId))return reply(400,{error:"invalid_claim_id"});
  const {data:claim,error:claimError}=await db.from("driver_insurance_claims").select("*").eq("id",claimId).maybeSingle();
  if(claimError)return reply(500,{error:"claim_lookup_failed"});
  if(!claim)return reply(404,{error:"claim_not_found"});
  const now=new Date().toISOString();
  if(body.action==="route_review"){
    const compliance=String(body.route_compliance??"");
    if(!["compliant","breach"].includes(compliance))return reply(400,{error:"route_review_must_be_compliant_or_breach"});
    const note=typeof body.route_review_note==="string"?body.route_review_note.trim().slice(0,1000):"";
    if(note.length<10)return reply(400,{error:"route_review_note_required"});
    const {error}=await db.from("driver_insurance_claims").update({
      route_compliance:compliance,route_review_note:note,status:"under_review",reviewed_by:actorId,reviewed_at:now,updated_at:now,
    }).eq("id",claimId);
    if(error)return reply(500,{error:"route_review_save_failed"});
    return reply(200,{success:true,route_compliance:compliance});
  }
  if(body.action==="insurer_decision"){
    const decision=String(body.decision??"");
    const note=typeof body.insurer_decision_note==="string"?body.insurer_decision_note.trim().slice(0,1000):"";
    const insurer=typeof body.insurer_name==="string"?body.insurer_name.trim().slice(0,160):"";
    const reference=typeof body.insurer_claim_reference==="string"?body.insurer_claim_reference.trim().slice(0,120):"";
    if(!["approve","decline"].includes(decision)||note.length<10||insurer.length<2||reference.length<3)
      return reply(400,{error:"insurer_decision_details_required"});
    if(decision==="approve"){
      const days=Number(body.approved_days);
      if(claim.route_compliance!=="compliant")return reply(409,{error:"route_compliance_must_be_confirmed_before_approval"});
      if(!Number.isInteger(days)||days<1||days>MAX_DAYS)return reply(400,{error:"approved_days_must_be_one_to_five"});
      const amount=days*DAILY_CENTS;
      const {error}=await db.from("driver_insurance_claims").update({
        status:"insurer_approved",approved_days:days,approved_benefit_cents:amount,insurer_name:insurer,
        insurer_claim_reference:reference,insurer_decision_note:note,reviewed_by:actorId,reviewed_at:now,updated_at:now,
      }).eq("id",claimId);
      if(error)return reply(500,{error:"insurer_decision_save_failed"});
      return reply(200,{success:true,status:"insurer_approved",approved_days:days,approved_benefit_cents:amount});
    }
    const {error}=await db.from("driver_insurance_claims").update({
      status:"declined",insurer_name:insurer,insurer_claim_reference:reference,insurer_decision_note:note,
      reviewed_by:actorId,reviewed_at:now,updated_at:now,
    }).eq("id",claimId);
    if(error)return reply(500,{error:"insurer_decision_save_failed"});
    return reply(200,{success:true,status:"declined"});
  }
  if(body.action==="mark_paid"){
    const payment=typeof body.payment_reference==="string"?body.payment_reference.trim().slice(0,120):"";
    if(claim.status!=="insurer_approved"||payment.length<3)return reply(409,{error:"insurer_approved_claim_and_payment_reference_required"});
    const {error}=await db.from("driver_insurance_claims").update({status:"paid",payment_reference:payment,updated_at:now}).eq("id",claimId);
    if(error)return reply(500,{error:"claim_payment_record_failed"});
    return reply(200,{success:true,status:"paid"});
  }
  return reply(400,{error:"unknown_claim_action"});
});
