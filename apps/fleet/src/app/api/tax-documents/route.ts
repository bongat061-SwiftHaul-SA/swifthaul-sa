import { NextRequest,NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { desc,eq,inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { taxDocuments } from "@/db/schema";
export const runtime="nodejs";export const dynamic="force-dynamic";
function admin(){const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Server credentials unavailable");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
export async function GET(req:NextRequest){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer /,"");if(!token)return NextResponse.json({error:"Sign in required."},{status:401});
 try{const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||"";const anon=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||"";const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:{user},error}=await auth.auth.getUser(token);if(error||!user)return NextResponse.json({error:"Session expired."},{status:401});
 const svc=admin();const {data:profile}=await svc.from("user_profiles").select("role,account_status").eq("id",user.id).maybeSingle();if(!profile||profile.account_status!=="active")return NextResponse.json({error:"Active account required."},{status:403});
 let docs;
 if(profile.role==="admin"){docs=await db.select().from(taxDocuments).orderBy(desc(taxDocuments.issuedAt)).limit(500);}
 else if(profile.role==="driver"){docs=await db.select().from(taxDocuments).where(eq(taxDocuments.driverId,user.id)).orderBy(desc(taxDocuments.issuedAt)).limit(250);}
 else if(profile.role==="fleet_owner"){const {data:fleets}=await svc.from("fleets").select("id").eq("owner_user_id",user.id);const ids=(fleets||[]).map(f=>f.id);docs=ids.length?await db.select().from(taxDocuments).where(inArray(taxDocuments.fleetId,ids)).orderBy(desc(taxDocuments.issuedAt)).limit(250):[];}
 else return NextResponse.json({error:"Tax document access is not available for this account role."},{status:403});
 return NextResponse.json({documents:docs});
 }catch(e){console.error("Tax document list failed",e);return NextResponse.json({error:"Could not load tax documents."},{status:500});}
}
