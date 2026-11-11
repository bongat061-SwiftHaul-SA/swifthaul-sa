import {createClient} from "@supabase/supabase-js";
import {zipSync,strToU8} from "fflate";
import { NextRequest,NextResponse } from "next/server";
import { and,desc,gte,lt } from "drizzle-orm";
import { db } from "@/db/client";
import { taxDocuments } from "@/db/schema";
import { requireCompanyAdmin } from "@/lib/admin-auth";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const auth=await requireCompanyAdmin(req);if(auth.response)return auth.response;
 const month=req.nextUrl.searchParams.get("month");
 const from=month?new Date(month+"-01T00:00:00Z"):new Date(new Date().getUTCFullYear(),new Date().getUTCMonth(),1);
 const to=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth()+1,1));
 const docs=await db.select().from(taxDocuments).where(and(gte(taxDocuments.issuedAt,from),lt(taxDocuments.issuedAt,to))).orderBy(desc(taxDocuments.issuedAt)).limit(5000);
 const outputVat=docs.filter(d=>d.documentType==="sender_tax_invoice").reduce((sum,d)=>sum+Number(d.vatAmountZar||0),0);
 if(req.nextUrl.searchParams.get("format")==="zip"){
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||"",key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!key)return NextResponse.json({error:"Private document storage is not configured."},{status:503});
  const svc=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const files:Record<string,Uint8Array>={};
  for(const d of docs){if(!d.storageKey)continue;const {data,error}=await svc.storage.from("swift-haul-tax-documents").download(d.storageKey);if(!error&&data)files[d.documentNumber+".pdf"]=new Uint8Array(await data.arrayBuffer());}
  const csvHeader=["document_number","document_type","order_id","driver_id","fleet_id","subtotal_excl_vat_zar","vat_amount_zar","total_incl_vat_zar","issued_at","storage_key"];
  const q=(v:unknown)=>'"'+String(v??"").replace(/"/g,'""')+'"';
  const csv=[csvHeader.join(","),...docs.map(d=>[d.documentNumber,d.documentType,d.orderId,d.driverId,d.fleetId,d.subtotalExclVatZar,d.vatAmountZar,d.totalInclVatZar,d.issuedAt.toISOString(),d.storageKey].map(q).join(","))].join("\\r\\n");
  files["tax-ledger-"+month+".csv"]=strToU8(csv);
  const zipped=zipSync(files,{level:6});
  return new NextResponse(zipped,{headers:{"Content-Type":"application/zip","Content-Disposition":'attachment; filename="swifthaul-tax-ledger-'+month+'.zip"'}});
 }
 if(req.nextUrl.searchParams.get("format")==="csv"){
  const cols=["document_number","document_type","order_id","driver_id","fleet_id","subtotal_excl_vat_zar","vat_amount_zar","total_incl_vat_zar","issued_at","storage_key"];
  const quote=(v:unknown)=>'"'+String(v??"").replace(/"/g,'""')+'"';
  const csv=[cols.join(","),...docs.map(d=>[d.documentNumber,d.documentType,d.orderId,d.driverId,d.fleetId,d.subtotalExclVatZar,d.vatAmountZar,d.totalInclVatZar,d.issuedAt.toISOString(),d.storageKey].map(quote).join(","))].join("\r\n");
  return new NextResponse(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="swifthaul-tax-ledger-'+month+'.csv"'}});
 }
 return NextResponse.json({month,documents:docs,output_vat_collected_zar:Math.round(outputVat*100)/100,total_documents:docs.length});
}
