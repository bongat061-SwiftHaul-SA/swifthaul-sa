import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
function outputText(data:any):string{
  if(typeof data?.output_text==="string")return data.output_text;
  const out:string[]=[];for(const item of data?.output??[])for(const c of item?.content??[])if(c?.type==="output_text"&&typeof c.text==="string")out.push(c.text);
  return out.join("\n");
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({error:"Method not allowed."},405);
  try{
    const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"");
    if(!token)return reply({error:"Sign in to use the cargo estimator."},401);
    const url=Deno.env.get("SUPABASE_URL");
    let key=Deno.env.get("SUPABASE_ANON_KEY");
    if(!key){try{key=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default;}catch{}}
    if(!url||!key)return reply({error:"Customer authentication is not configured."},503);
    const sb=createClient(url,key,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:user,error:authError}=await sb.auth.getUser(token);
    if(authError||!user.user)return reply({error:"Your session has expired. Sign in again."},401);
    const apiKey=Deno.env.get("OPENAI_API_KEY");
    if(!apiKey)return reply({error:"The AI estimator is not configured yet. Please enter your load details manually."},503);
    const body=await req.json();
    const description=typeof body?.description==="string"?body.description.trim().slice(0,1200):"";
    const image=typeof body?.image_data_url==="string"?body.image_data_url:"";
    if(!description&&!image)return reply({error:"Add an item description or photo."},400);
    if(image&&(image.length>2500000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)))return reply({error:"Photo must be a compressed JPEG, PNG or WEBP under 2 MB."},413);
    const instructions='You are a cautious parcel-load estimation assistant for a South African delivery booking form. Identify visible or described items and estimate combined packed load dimensions in centimetres and a plausible total weight range in kilograms. A photo cannot reveal material density, hidden contents or exact scale weight. Never claim actual mass was measured. If no reliable size reference is visible, use broad conservative dimensions and confidence low. For multiple items, estimate a practical combined packed footprint and state assumptions. Return only valid JSON: {"items":[{"name":"string","quantity":1}],"dimensions_cm":{"length":0,"width":0,"height":0},"weight_kg_range":{"min":0,"max":0},"confidence":"low|medium|high","notes":"string"}. Use plausible bounds, no false precision.';
    const content:any[]=[{type:"input_text",text:"Customer item description: "+(description||"Not supplied.")+". Estimate the combined packed load."}];
    if(image)content.push({type:"input_image",image_url:image,detail:"high"});
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",instructions,input:[{role:"user",content}],max_output_tokens:500,store:false})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){console.error("OpenAI cargo estimator error",response.status,data?.error?.type??"unknown");return reply({error:"The estimator is temporarily unavailable. Please enter dimensions manually."},502);}
    let estimate:any;try{estimate=JSON.parse(outputText(data));}catch{return reply({error:"The estimator returned an unreadable result. Please try again."},502);}
    const d=estimate?.dimensions_cm,w=estimate?.weight_kg_range;
    const valid=Number.isFinite(d?.length)&&Number.isFinite(d?.width)&&Number.isFinite(d?.height)&&Number.isFinite(w?.min)&&Number.isFinite(w?.max)&&d.length>0&&d.width>0&&d.height>0&&w.min>=0&&w.max>=w.min&&d.length<=100000&&d.width<=100000&&d.height<=100000&&w.max<=8000;
    if(!valid)return reply({error:"Estimate is outside supported booking limits. Please enter dimensions manually."},422);
    return reply({estimate:{items:Array.isArray(estimate.items)?estimate.items.slice(0,20):[],dimensions_cm:{length:Math.round(d.length*10)/10,width:Math.round(d.width*10)/10,height:Math.round(d.height*10)/10},weight_kg_range:{min:Math.round(w.min*10)/10,max:Math.round(w.max*10)/10},confidence:["low","medium","high"].includes(estimate.confidence)?estimate.confidence:"low",notes:typeof estimate.notes==="string"?estimate.notes.slice(0,500):"",weight_is_estimate:true}});
  }catch(error){console.error("cargo-estimator failed",error instanceof Error?error.message:"unknown");return reply({error:"Could not estimate this load. Please enter the details manually."},500);}
});