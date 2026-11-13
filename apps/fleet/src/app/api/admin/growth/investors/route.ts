import {NextRequest,NextResponse} from "next/server";
import {desc} from "drizzle-orm";
import {db} from "@/db/client";
import {investorInquiries} from "@/db/schema";
import {requireCompanyAdmin} from "@/lib/admin-auth";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const auth=await requireCompanyAdmin(req);if(auth.response)return auth.response;
 try{
  const rows=await db.select().from(investorInquiries).orderBy(desc(investorInquiries.createdAt)).limit(500);
  if(req.nextUrl.searchParams.get("format")==="csv"){
   const cols=["id","full_name","email","phone","track","indicative_range_zar","message","status","created_at"];
   const q=(v:unknown)=>'"'+String(v??"").replace(/"/g,'""')+'"';
   const csv=rows.map(x=>[x.id,x.fullName,x.email,x.phone,x.track,x.indicativeRangeZar,x.message,x.status,x.createdAt.toISOString()].map(q).join(","));
   return new NextResponse([cols.join(","),...csv].join("\r\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="swifthaul-investor-leads.csv"',"Cache-Control":"no-store"}});
  }
  return NextResponse.json({leads:rows.map(x=>({...x,popiaConsented:undefined,adminNotes:undefined}))},{headers:{"Cache-Control":"no-store"}});
 }catch(error){console.error("Investor leads query failed",error);return NextResponse.json({error:"Could not load investor enquiries."},{status:500});}
}