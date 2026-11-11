import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@supabase/supabase-js";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tariffSettings, taxDocuments } from "@/db/schema";
import { TaxDocumentPdf, type TaxPdfData } from "@/lib/tax-document-pdf";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const bucket="swift-haul-tax-documents";
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
function verify(raw:string,signature:string,secret:string){const expected=createHmac("sha256",secret).update(raw).digest();let supplied:Buffer;try{supplied=Buffer.from(signature,"hex")}catch{return false;}return supplied.length===expected.length&&timingSafeEqual(expected,supplied);}
function supabaseAdmin(){const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Supabase server credentials are not configured.");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
async function persistPdf(doc:any,data:TaxPdfData,storageKey:string){
 const buffer=await renderToBuffer(React.createElement(TaxDocumentPdf,{data}) as any);
 const supabase=supabaseAdmin();
 const {error}=await supabase.storage.from(bucket).upload(storageKey,buffer,{contentType:"application/pdf",upsert:true});
 if(error)throw new Error("Private PDF upload failed: "+error.message);
 await db.update(taxDocuments).set({storageKey}).where(eq(taxDocuments.id,doc.id));
 return storageKey;
}
async function settings(){const [s]=await db.select().from(tariffSettings).orderBy(desc(tariffSettings.updatedAt)).limit(1);return s||null;}
async function createSenderInvoice(waybill:string,reference:string){
 const supabase=supabaseAdmin();
 const {data:booking,error}=await supabase.from("customer_bookings").select("*").eq("waybill",waybill).maybeSingle();
 if(error||!booking)throw new Error("Paid booking could not be found for invoice generation.");
 if(!booking.paid_at)throw new Error("Booking is not marked as paid.");
 const company=await settings();
 const gross=money(Number(booking.price||0));
 const fullDetails=Boolean(booking.billing_company_name&&booking.billing_address);
 const fullInvoiceRequired=gross>5000;
 const type=company?.isVatRegistered&&(!fullInvoiceRequired||fullDetails)?"sender_tax_invoice":"sender_receipt";
 const [existing]=await db.select().from(taxDocuments).where(and(eq(taxDocuments.orderId,waybill),eq(taxDocuments.documentType,type))).limit(1);
 if(existing?.storageKey)return existing;
 const vatRate=company?.isVatRegistered?Number(company.vatRatePercent||15.5):0;
 const vat=vatRate?money(gross*vatRate/(100+vatRate)):0;
 const subtotal=money(gross-vat);
 const {data:quote}=booking.quote_id?await supabase.from("tariff_quotes").select("fare_breakdown").eq("id",booking.quote_id).maybeSingle():{data:null};
 const breakdown=quote?.fare_breakdown||{};
 const lines=[
  {label:"Delivery base fare",amount:Number(breakdown.base_fare_zar||gross)},
  ...(Number(breakdown.tier1_charge_zar||0)>0?[{label:"Distance · Tier 1",amount:Number(breakdown.tier1_charge_zar)}]:[]),
  ...(Number(breakdown.tier2_charge_zar||0)>0?[{label:"Distance · Tier 2",amount:Number(breakdown.tier2_charge_zar)}]:[]),
  ...(Number(breakdown.fuel_surcharge_zar||0)>0?[{label:"Fuel surcharge",amount:Number(breakdown.fuel_surcharge_zar)}]:[]),
  ...(Number(breakdown.surge_charge_zar||0)>0?[{label:"Surge pricing · "+Number(breakdown.surge_multiplier||1).toFixed(2)+"x",amount:Number(breakdown.surge_charge_zar)}]:[]),
  ...(Number(breakdown.extra_stop_fees_zar||0)>0?[{label:"Additional stops",amount:Number(breakdown.extra_stop_fees_zar)}]:[])
 ];
 if(lines.length===1&&lines[0].amount!==gross)lines[0].amount=gross;
 const issuedAt=new Date();
 const [doc]=await db.insert(taxDocuments).values({documentNumber:"",documentType:type,orderId:waybill,subtotalExclVatZar:String(subtotal),vatAmountZar:String(vat),totalInclVatZar:String(gross),metadata:{source_reference:reference,paid:true,full_invoice_required:fullInvoiceRequired,missing_billing_details:fullInvoiceRequired&&!fullDetails,vat_registered:Boolean(company?.isVatRegistered)}}).returning();
 const {data:owner}=await supabase.from("user_profiles").select("full_name").eq("id",booking.owner_hash||"").maybeSingle();
 const data:TaxPdfData={title:type==="sender_tax_invoice"?"TAX INVOICE":company?.isVatRegistered?"PAYMENT RECEIPT · FULL TAX DETAILS REQUIRED":"INVOICE / RECEIPT",documentNumber:doc.documentNumber,issuedAt:issuedAt.toISOString(),supplier:company,recipient:{name:booking.billing_company_name||owner?.full_name||"SwiftHaul customer",address:booking.billing_address||"",vatNumber:booking.billing_vat_number||""},order:{waybill,tracking_code:booking.tracking_code,pickup:booking.pickup,dropoff:booking.dropoff,vehicle:booking.vehicle,distance_km:booking.distance_meters?Number(booking.distance_meters)/1000:null},lines,subtotal,vat,vatRate,total:gross,metadata:{paid:true,note:fullInvoiceRequired&&!fullDetails?"Full tax invoice details are required for this supply. Add the recipient company name, address and VAT number (if registered) to request the full tax invoice.":undefined}};
 await persistPdf(doc,data,doc.documentNumber+".pdf");
 return doc;
}
async function createDriverRemittance(reference:string){
 const supabase=supabaseAdmin();
 const {data:payout,error}=await supabase.from("driver_payouts").select("*").eq("reference",reference).maybeSingle();
 if(error||!payout) {
  const {data:fleetPay}=await supabase.from("fleet_payout_transfers").select("*").eq("reference",reference).maybeSingle();
  if(!fleetPay)throw new Error("Completed payout reference was not found.");
  const [existing]=await db.select().from(taxDocuments).where(eq(taxDocuments.documentType,"fleet_statement")).limit(0);
  const [doc]=await db.insert(taxDocuments).values({documentNumber:"",documentType:"fleet_statement",fleetId:fleetPay.fleet_id||null,totalInclVatZar:String(Number(fleetPay.amount_cents||0)/100),metadata:{source_reference:reference,settlement_reference:reference,paid:true}}).returning();
  const company=await settings();
  const data:TaxPdfData={title:"FLEET REMITTANCE STATEMENT",documentNumber:doc.documentNumber,issuedAt:new Date().toISOString(),supplier:company,recipient:{name:"SwiftHaul fleet partner"},order:{waybill:fleetPay.waybill},lines:[{label:"Fleet EFT settlement",amount:Number(fleetPay.amount_cents||0)/100}],subtotal:Number(fleetPay.amount_cents||0)/100,vat:0,vatRate:Number(company?.vatRatePercent||15.5),total:Number(fleetPay.amount_cents||0)/100,metadata:{paid:true,note:"Paystack settlement reference: "+reference}};
  await persistPdf(doc,data,doc.documentNumber+".pdf");return doc;
 }
 const [existing]=await db.select().from(taxDocuments).where(eq(taxDocuments.documentType,"driver_remittance")).limit(0);
 const [profile]=await supabase.from("user_profiles").select("full_name").eq("id",payout.driver_id).maybeSingle();
 const [driver]=await supabase.from("driver_profiles").select("fleet_id").eq("user_id",payout.driver_id).maybeSingle();
 const net=money(Number(payout.amount_zar||0));
 const gross=money(net/0.75);
 const commission=money(gross*0.25);
 const company=await settings();
 const vatRate=company?.isVatRegistered?Number(company.vatRatePercent||15.5):0;
 const commissionVat=vatRate?money(commission*vatRate/(100+vatRate)):0;
 const [doc]=await db.insert(taxDocuments).values({documentNumber:"",documentType:"driver_remittance",driverId:payout.driver_id,fleetId:driver?.fleet_id||null,totalInclVatZar:String(net),metadata:{source_reference:reference,settlement_reference:reference,gross_delivery_fares_zar:gross,platform_commission_zar:commission,platform_commission_vat_zar:commissionVat,fleet_split_deduction_zar:0,net_eft_payout_zar:net,paid:true}}).returning();
 const data:TaxPdfData={title:"DRIVER REMITTANCE STATEMENT",documentNumber:doc.documentNumber,issuedAt:new Date().toISOString(),supplier:company,recipient:{name:profile?.full_name||"Driver"},order:{waybill:"Payout "+reference},lines:[{label:"Gross delivery fares",amount:gross},{label:"SwiftHaul platform commission (incl. VAT)",amount:commission},{label:"VAT included in platform commission",amount:commissionVat},{label:"Fleet split deduction",amount:0},{label:"Net EFT payout",amount:net}],subtotal:net,vat:0,vatRate, total:net,metadata:{paid:true,note:"Paystack settlement reference: "+reference}};
 await persistPdf(doc,data,doc.documentNumber+".pdf");return doc;
}
export async function POST(request:NextRequest){
 const secret=process.env.TAX_DOCUMENT_WEBHOOK_SECRET;
 if(!secret)return NextResponse.json({error:"Tax document webhook secret is not configured."},{status:503});
 const raw=await request.text();
 if(!verify(raw,request.headers.get("x-tax-doc-signature")||"",secret))return NextResponse.json({error:"Invalid webhook signature."},{status:401});
 try{
  const body=JSON.parse(raw);
  let doc;
  if(body.event==="charge.success"&&typeof body.waybill==="string"&&typeof body.reference==="string")doc=await createSenderInvoice(body.waybill,body.reference);
  else if(body.event==="transfer.success"&&typeof body.reference==="string")doc=await createDriverRemittance(body.reference);
  else return NextResponse.json({ignored:true});
  return NextResponse.json({ok:true,document_id:doc.id,document_number:doc.documentNumber});
 }catch(error){console.error("Tax document generation failed",error);return NextResponse.json({error:error instanceof Error?error.message:"Tax document generation failed."},{status:500});}
}
