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
 if(req.nextUrl.searchParams.get("format")==="csv"){
  const cols=["document_number","document_type","order_id","driver_id","fleet_id","subtotal_excl_vat_zar","vat_amount_zar","total_incl_vat_zar","issued_at","storage_key"];
  const quote=(v:unknown)=>'"'+String(v??"").replace(/"/g,'""')+'"';
  const csv=[cols.join(","),...docs.map(d=>[d.documentNumber,d.documentType,d.orderId,d.driverId,d.fleetId,d.subtotalExclVatZar,d.vatAmountZar,d.totalInclVatZar,d.issuedAt.toISOString(),d.storageKey].map(quote).join(","))].join("\r\n");
  return new NextResponse(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="swifthaul-tax-ledger-'+month+'.csv"'}});
 }
 return NextResponse.json({month,documents:docs,output_vat_collected_zar:Math.round(outputVat*100)/100,total_documents:docs.length});
}
