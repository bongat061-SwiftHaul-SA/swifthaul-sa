import { NextRequest,NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { taxDocuments } from "@/db/schema";
export const runtime="nodejs";
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer /,"");if(!token)return NextResponse.json({error:"Sign in required."},{status:401});
 try{const {id}=await params;const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||"";const anon=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||"";const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";if(!key)return NextResponse.json({error:"Storage is not configured."},{status:503});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:{user},error}=await auth.auth.getUser(token);if(error||!user)return NextResponse.json({error:"Session expired."},{status:401});
 const svc=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const {data:profile}=await svc.from("user_profiles").select("role,account_status").eq("id",user.id).maybeSingle();if(!profile||profile.account_status!=="active")return NextResponse.json({error:"Active account required."},{status:403});
 const [doc]=await db.select().from(taxDocuments).where(eq(taxDocuments.id,id)).limit(1);if(!doc?.storageKey)return NextResponse.json({error:"Document is not available."},{status:404});
 let allowed=profile.role==="admin"||(profile.role==="driver"&&doc.driverId===user.id);
 if(profile.role==="fleet_owner"&&doc.fleetId){const {data}=await svc.from("fleets").select("id").eq("owner_user_id",user.id).eq("id",doc.fleetId).maybeSingle();allowed=Boolean(data);}
 if(!allowed)return NextResponse.json({error:"You do not have access to this document."},{status:403});
 const {data,error:storageError}=await svc.storage.from("swift-haul-tax-documents").createSignedUrl(doc.storageKey,60);if(storageError||!data?.signedUrl)return NextResponse.json({error:"Could not create a secure download link."},{status:503});
 return NextResponse.redirect(data.signedUrl);
 }catch(e){console.error("Tax document download failed",e);return NextResponse.json({error:"Download failed."},{status:500});}
}
