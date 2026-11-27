import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status:number, body:Record<string,unknown>) =>
  new Response(JSON.stringify(body), {status, headers});
const clean = (v:unknown, max:number) => String(v ?? "").trim().slice(0,max);
const validEmail = (v:string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

Deno.serve(async (req:Request) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers});
  if (!["GET","POST"].includes(req.method)) return reply(405,{error:"method_not_allowed"});
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401,{error:"missing_bearer_token"});
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return reply(500,{error:"server_configuration_error"});
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await auth.auth.getUser(token);
  if(authError||!authData.user) return reply(401,{error:"invalid_or_expired_session"});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:admin,error:adminError}=await db.from("user_profiles").select("role,account_status").eq("id",authData.user.id).maybeSingle();
  if(adminError) return reply(500,{error:"administrator_check_failed"});
  if(!admin||admin.role!=="admin"||admin.account_status!=="active") return reply(403,{error:"administrator_access_required"});

  try {
    if(req.method==="GET"){
      const [profiles,metrics,updates]=await Promise.all([
        db.from("investor_profiles").select("id,user_id,display_name,shares_owned,ownership_percentage,investment_amount_zar,investment_committed_zar,investment_received_zar,share_register_reference,share_issue_date,share_class,status,created_at,updated_at").order("created_at",{ascending:false}),
        db.from("investor_company_metrics").select("*").order("display_order").order("created_at",{ascending:false}),
        db.from("investor_updates").select("*").order("created_at",{ascending:false})
      ]);
      if(profiles.error||metrics.error||updates.error) throw new Error("investor_data_read_failed");
      const enrichedProfiles=await Promise.all((profiles.data||[]).map(async (profile)=>{const {data:userData}=await db.auth.admin.getUserById(profile.user_id);return {...profile,email:userData?.user?.email||""};}));
      return reply(200,{profiles:enrichedProfiles,metrics:metrics.data,updates:updates.data});
    }
    const body=await req.json().catch(()=>null);
    if(!body||typeof body!=="object") return reply(400,{error:"invalid_json"});
    const action=clean(body.action,40);
    if(action==="publish_profile_only"){
      const email=clean(body.email,254).toLowerCase(), name=clean(body.display_name,160);
      if(!validEmail(email)||name.length<2) return reply(400,{error:"Enter a valid investor name and email address."});
      let userId="";
      let page=1;
      while(!userId){
        const {data:list,error:listError}=await db.auth.admin.listUsers({page,perPage:1000});
        if(listError) return reply(500,{error:"Could not check whether this email already has a SwiftHaul account."});
        const match=list.users.find((user)=>String(user.email||"").toLowerCase()===email);
        if(match){userId=match.id;break;}
        if(list.users.length<1000) break;
        page++;
        if(page>10) return reply(503,{error:"Too many accounts to safely check this email. Please contact support."});
      }
      let createdAuthUser=false;
      if(!userId){
        // Create an account with an unshared random credential. The investor must set their own password via recovery email.
        const temporarySecret=crypto.randomUUID()+"-"+crypto.randomUUID();
        const {data,error}=await db.auth.admin.createUser({email,password:temporarySecret,email_confirm:true,user_metadata:{app_type:"investor",full_name:name,investor_activation_pending:true}});
        if(error||!data.user){
          console.error("Investor account provision failed",error?.message);
          return reply(400,{error:"The investor profile could not be created. Check the email address and try again."});
        }
        userId=data.user.id;createdAuthUser=true;
      }
      const {data:existingProfile,error:profileReadError}=await db.from("investor_profiles").select("id").eq("user_id",userId).maybeSingle();
      if(profileReadError) return reply(500,{error:"Could not check the investor access record."});
      if(existingProfile) return reply(409,{error:"This account already has an investor profile. Find it in the share register below."});
      const {error:insertError}=await db.from("investor_profiles").insert({user_id:userId,display_name:name,shares_owned:0,ownership_percentage:0,investment_amount_zar:0,status:"active"});
      if(insertError){
        console.error("Investor profile create failed",insertError.message);
        if(createdAuthUser) await db.auth.admin.deleteUser(userId);
        return reply(500,{error:"The investor account exists, but its profile could not be published. Please refresh and try again."});
      }
      return reply(201,{ok:true,profile_published:true,email_sent:false,created_auth_user:createdAuthUser});
    }
    if(action==="invite"){
      const email=clean(body.email,254).toLowerCase(), name=clean(body.display_name,160);
      if(!validEmail(email)||name.length<2) return reply(400,{error:"Enter a valid investor name and email address."});

      // Reuse an existing Auth account instead of trying to invite the same email twice.
      // Investor access is granted only by creating the separate investor_profiles record.
      let existingUser:null|{id:string;email?:string|null}=null;
      let page=1;
      while(!existingUser){
        const {data:list,error:listError}=await db.auth.admin.listUsers({page,perPage:1000});
        if(listError) return reply(500,{error:"Could not check whether this email already has a SwiftHaul account."});
        existingUser=list.users.find((user)=>String(user.email||"").toLowerCase()===email) ?? null;
        if(existingUser||list.users.length<1000) break;
        page++;
        if(page>10) return reply(503,{error:"Too many accounts to safely check this email. Please contact support."});
      }

      let userId=existingUser?.id ?? "";
      let invitationEmailSent=false;
      if(!existingUser){
        const {data,error}=await db.auth.admin.inviteUserByEmail(email,{data:{app_type:"investor",full_name:name}});
        if(error||!data.user){
          const message=String(error?.message||"");
          if(/already.*(registered|exists)|email.*exists/i.test(message)){
            // A concurrent signup may have happened after the initial lookup. Re-read once.
            const {data:list}=await db.auth.admin.listUsers({page:1,perPage:1000});
            const match=list?.users.find((user)=>String(user.email||"").toLowerCase()===email);
            if(!match) return reply(409,{error:"This email already has a SwiftHaul account. Ask the account holder to use their existing login, or contact support."});
            userId=match.id;
          }else{
            console.error("Investor invitation email failed",message);
            return reply(400,{error:"The invitation email could not be sent. Check the email address and Supabase email delivery settings, then try again."});
          }
        }else{
          userId=data.user.id;
          invitationEmailSent=true;
        }
      }

      const {data:existingProfile,error:profileReadError}=await db.from("investor_profiles").select("id").eq("user_id",userId).maybeSingle();
      if(profileReadError) return reply(500,{error:"Could not check the investor access record."});
      if(existingProfile) return reply(409,{error:"This account already has an investor profile. Find it in the share register below."});

      const {error:insertError}=await db.from("investor_profiles").insert({user_id:userId,display_name:name,shares_owned:0,ownership_percentage:0,investment_amount_zar:0,status:"active"});
      if(insertError){
        console.error("Investor profile create failed",insertError.message);
        return reply(500,{error:"The account was found, but its investor profile could not be created. Please refresh and try again."});
      }
      return reply(201,{ok:true,invited:invitationEmailSent,linked_existing_account:!invitationEmailSent});
    }
    if(action==="create_profile"){
      const email=clean(body.email,254).toLowerCase(), name=clean(body.display_name,160);
      if(!validEmail(email)||name.length<2) return reply(400,{error:"Enter a valid investor name and email address."});

      // Publish the investor's private portal record without sending any email.
      // A random, undisclosed password prevents password-based access until the
      // investor uses the portal's Forgot password flow to set their own password.
      let userId="", linkedExistingAccount=false;
      let page=1, existingUser:null|{id:string;email?:string|null}=null;
      while(!existingUser){
        const {data:list,error:listError}=await db.auth.admin.listUsers({page,perPage:1000});
        if(listError) return reply(500,{error:"Could not check whether this email already has a SwiftHaul account."});
        existingUser=list.users.find((user)=>String(user.email||"").toLowerCase()===email) ?? null;
        if(existingUser||list.users.length<1000) break;
        page++;
        if(page>10) return reply(503,{error:"Too many accounts to safely check this email. Please contact support."});
      }
      if(existingUser){
        userId=existingUser.id;
        linkedExistingAccount=true;
      }else{
        const bytes=new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const randomPassword=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")+"aA1!";
        const {data:created,error:createError}=await db.auth.admin.createUser({
          email,password:randomPassword,email_confirm:false,
          user_metadata:{app_type:"investor",full_name:name}
        });
        if(createError||!created.user){
          console.error("Investor account creation failed",createError?.message);
          return reply(400,{error:"The investor profile could not be created. Check the email address and try again."});
        }
        userId=created.user.id;
      }
      const {data:existingProfile,error:profileReadError}=await db.from("investor_profiles").select("id").eq("user_id",userId).maybeSingle();
      if(profileReadError) return reply(500,{error:"Could not check the investor access record."});
      if(existingProfile) return reply(409,{error:"This account already has an investor profile. Find it in the share register below."});
      const {error:insertError}=await db.from("investor_profiles").insert({
        user_id:userId,display_name:name,shares_owned:0,ownership_percentage:0,
        investment_amount_zar:0,investment_committed_zar:0,investment_received_zar:0,status:"active"
      });
      if(insertError){
        console.error("Investor profile create failed",insertError.message);
        if(!linkedExistingAccount) await db.auth.admin.deleteUser(userId);
        return reply(500,{error:"The account was created, but its investor profile could not be saved. Please retry or contact support."});
      }
      return reply(201,{ok:true,email_sent:false,linked_existing_account:linkedExistingAccount});
    }
    if(action==="save_profile"){
      const userId=clean(body.user_id,64);
      const name=clean(body.display_name,160);
      const shares=Number(body.shares_owned);
      const ownership=Number(body.ownership_percentage);
      const amount=Number(body.investment_amount_zar);
      const committed=Number(body.investment_committed_zar ?? 0);
      const received=Number(body.investment_received_zar ?? 0);
      const registerRef=clean(body.share_register_reference,120);
      const issueDate=clean(body.share_issue_date,10);
      const status=clean(body.status,16);
      const shareClass=clean(body.share_class,80);
      const validIssueDate=!issueDate||/^\d{4}-\d{2}-\d{2}$/.test(issueDate);
      if(!userId||name.length<2||![shares,ownership,amount,committed,received].every(Number.isFinite)||shares<0||ownership<0||ownership>100||amount<0||committed<0||received<0||received>committed||!validIssueDate||!["active","suspended","closed"].includes(status)) return reply(400,{error:"invalid_investor_profile"});
      const {data:saved,error}=await db.from("investor_profiles").update({display_name:name,shares_owned:shares,ownership_percentage:ownership,investment_amount_zar:amount,investment_committed_zar:committed,investment_received_zar:received,share_register_reference:registerRef||null,share_issue_date:issueDate||null,share_class:shareClass||null,status,updated_at:new Date().toISOString()}).eq("user_id",userId).select("id").maybeSingle();
      if(error) return reply(500,{error:"investor_profile_save_failed"});
      if(!saved) return reply(404,{error:"investor_profile_not_found"});
      return reply(200,{ok:true});
    }
    if(action==="save_metric"){
      const key=clean(body.metric_key,80), label=clean(body.metric_label,100), value=Number(body.metric_value), format=clean(body.value_format,16), period=clean(body.period_label,80), order=Number(body.display_order)||100;
      if(!key||!label||!Number.isFinite(value)||!["number","currency","percent"].includes(format)) return reply(400,{error:"invalid_metric"});
      const row={metric_key:key,metric_label:label,metric_value:value,value_format:format,period_label:period||null,display_order:order,is_published:false,published_at:null};
      const {error}=await db.from("investor_company_metrics").insert(row);
      if(error) return reply(500,{error:"metric_save_failed"});
      return reply(201,{ok:true,draft:true});
    }
    if(action==="publish_metric"||action==="hide_metric"){
      const id=clean(body.id,64); if(!id) return reply(400,{error:"metric_id_required"});
      const published=action==="publish_metric";
      const {error}=await db.from("investor_company_metrics").update({is_published:published,published_at:published?new Date().toISOString():null}).eq("id",id);
      if(error) return reply(500,{error:"metric_publish_failed"});
      return reply(200,{ok:true});
    }
    if(action==="save_update"){
      const title=clean(body.title,180), content=clean(body.body,12000), category=clean(body.category,24);
      if(title.length<3||!content||!["company","financial","operations","shareholder","notice"].includes(category)) return reply(400,{error:"invalid_update"});
      const {error}=await db.from("investor_updates").insert({title,body:content,category,is_published:false,published_at:null});
      if(error) return reply(500,{error:"update_save_failed"});
      return reply(201,{ok:true,draft:true});
    }
    if(action==="publish_update"||action==="hide_update"){
      const id=clean(body.id,64); if(!id) return reply(400,{error:"update_id_required"});
      const published=action==="publish_update";
      const {error}=await db.from("investor_updates").update({is_published:published,published_at:published?new Date().toISOString():null}).eq("id",id);
      if(error) return reply(500,{error:"update_publish_failed"});
      return reply(200,{ok:true});
    }
    return reply(400,{error:"unknown_action"});
  } catch(error) {
    console.error("Investor admin operation failed",error instanceof Error?error.message:error);
    return reply(503,{error:"investor_admin_unavailable"});
  }
});