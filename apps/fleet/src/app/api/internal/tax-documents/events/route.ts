import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@supabase/supabase-js";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tariffSettings, taxDocuments } from "@/db/schema";
import { TaxDocumentPdf, type TaxPdfData } from "@/lib/tax-document-pdf";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const bucket="swift-haul-tax-documents";
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
function verify(raw:string,signature:string,secret:string){const expected=createHmac("sha256",secret).update(raw).digest();let supplied:Buffer;try{supplied=Buffer.from(signature,"hex")}catch{return false;}return supplied.length===expected.length&&timingSafeEqual(expected,supplied);}
function supabaseAdmin(){const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Supabase server credentials are not configured.");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
async function companySettings(){const [s]=await db.select().from(tariffSettings).orderBy(desc(tariffSettings.updatedAt)).limit(1);return s||null;}
async function savePdf(doc:any,data:TaxPdfData){
 const buffer=await renderToBuffer(React.createElement(TaxDocumentPdf,{data}) as any);
 const {error}=await supabaseAdmin().storage.from(bucket).upload(doc.documentNumber+".pdf",buffer,{contentType:"application/pdf",upsert:true});
 if(error)throw new Error("Private PDF upload failed: "+error.message);
 await db.update(taxDocuments).set({storageKey:doc.documentNumber+".pdf"}).where(eq(taxDocuments.id,doc.id));
}
async function senderDocument(waybill:string,reference:string,forceInvoice=false){
 const dbs=supabaseAdmin();
 const [existing]=await db.select().from(taxDocuments).where(eq(taxDocuments.sourceReference,(forceInvoice?"invoice-request:":"charge:")+reference)).limit(1);
 if(existing?.storageKey)return existing;
 const {data:b,error}=await dbs.from("customer_bookings").select("*").eq("waybill",waybill).maybeSingle();
 if(error||!b||!b.paid_at)throw new Error("Paid booking could not be verified for invoice generation.");
 const company=await companySettings(),total=money(Number(b.price||0));
 const fullDetails=Boolean(b.billing_company_name&&b.billing_address);
 const fullRequired=total>5000;
 const registered=Boolean(company?.isVatRegistered);
 if(forceInvoice&&(!registered||!fullDetails))throw new Error("A full SARS tax invoice requires confirmed VAT registration and recipient company name and address.");
 const docType=forceInvoice?"sender_tax_invoice":registered&&(!fullRequired||fullDetails)?"sender_tax_invoice":"sender_receipt";
 const rate=registered?Number(company?.vatRatePercent||15.5):0;
 const vat=rate?money(total*rate/(100+rate)):0,subtotal=money(total-vat);
 const {data:q}=b.quote_id?await dbs.from("tariff_quotes").select("fare_breakdown").eq("id",b.quote_id).maybeSingle():{data:null};
 const br=q?.fare_breakdown||{};
 const lines=[{label:"Delivery base fare",amount:Number(br.base_fare_zar||total)},...(Number(br.tier1_charge_zar||0)>0?[{label:"Distance · Tier 1",amount:Number(br.tier1_charge_zar)}]:[]),...(Number(br.tier2_charge_zar||0)>0?[{label:"Distance · Tier 2",amount:Number(br.tier2_charge_zar)}]:[]),...(Number(br.fuel_surcharge_zar||0)>0?[{label:"Fuel surcharge",amount:Number(br.fuel_surcharge_zar)}]:[]),...(Number(br.surge_charge_zar||0)>0?[{label:"Surge pricing · "+Number(br.surge_multiplier||1).toFixed(2)+"x",amount:Number(br.surge_charge_zar)}]:[]),...(Number(br.extra_stop_fees_zar||0)>0?[{label:"Additional stops",amount:Number(br.extra_stop_fees_zar)}]:[]),...(Number(br.minimum_fare_adjustment_zar||0)>0?[{label:"Minimum fare adjustment",amount:Number(br.minimum_fare_adjustment_zar)}]:[])];
 if(lines.reduce((n,l)=>n+l.amount,0)===0)lines.push({label:"Delivery service",amount:total});
 const issuedAt=new Date();
 let doc=existing;
 if(!doc){[doc]=await db.insert(taxDocuments).values({documentNumber:"",sourceReference:(forceInvoice?"invoice-request:":"charge:")+reference,documentType:docType,orderId:waybill,subtotalExclVatZar:String(subtotal),vatAmountZar:String(vat),totalInclVatZar:String(total),metadata:{paid:true,full_invoice_required:fullRequired,missing_billing_details:fullRequired&&!fullDetails,vat_registered:registered}}).onConflictDoNothing().returning();}
 if(!doc){const [prior]=await db.select().from(taxDocuments).where(eq(taxDocuments.sourceReference,(forceInvoice?"invoice-request:":"charge:")+reference)).limit(1);if(prior?.storageKey)return prior;throw new Error("Tax document insert conflict.");}
 const data:TaxPdfData={title:docType==="sender_tax_invoice"?"TAX INVOICE":registered?"PAYMENT RECEIPT · FULL TAX DETAILS REQUIRED":"INVOICE / RECEIPT",documentNumber:doc.documentNumber,issuedAt:issuedAt.toISOString(),supplier:company,recipient:{name:b.billing_company_name||"Customer",address:b.billing_address||"",vatNumber:b.billing_vat_number||""},order:{waybill,tracking_code:b.tracking_code,pickup:b.pickup,dropoff:b.dropoff,vehicle:b.vehicle,distance_km:b.distance_meters?Number(b.distance_meters)/1000:null},lines,subtotal,vat,vatRate:rate,total,metadata:{paid:true,note:fullRequired&&!fullDetails?"A full tax invoice requires the recipient company name and address, plus VAT number where the recipient is a VAT vendor. Submit billing details to request the full tax invoice.":undefined}};
 await savePdf(doc,data);return doc;
}
async function payoutDocument(reference:string){
 const dbs=supabaseAdmin();
 const [prior]=await db.select().from(taxDocuments).where(eq(taxDocuments.sourceReference,"transfer:"+reference)).limit(1);
 if(prior?.storageKey)return prior;
 const company=await companySettings();
 const {data:p,error}=await dbs.from("driver_payouts").select("*").eq("reference",reference).maybeSingle();
 if(error)throw new Error("Payout lookup failed.");
 if(p){
  const [{data:profile},{data:contract}]=await Promise.all([
   dbs.from("user_profiles").select("full_name").eq("id",p.driver_id).maybeSingle(),
   dbs.from("fleet_driver_contracts").select("fleet_id,fleet_percentage,driver_percentage,payout_model").eq("driver_id",p.driver_id).eq("is_active",true).maybeSingle()
  ]);
  const net=money(Number(p.amount_zar||0));
  let gross=money(net/0.75);
  if(p.payout_period_start&&p.payout_period_end){
   const {data:orders}=await dbs.from("customer_bookings").select("price").eq("driver_user_id",p.driver_id).gte("completed_at",p.payout_period_start).lte("completed_at",p.payout_period_end+"T23:59:59.999Z");
   const calculated=(orders||[]).reduce((sum:any,o:any)=>sum+Number(o.price||0),0);
   if(calculated>0)gross=money(calculated);
  }
  const commission=money(gross*0.25),driverShare=money(gross*0.75),fleetDeduction=money(Math.max(0,driverShare-net));
  const rate=company?.isVatRegistered?Number(company?.vatRatePercent||15.5):0;
  const commissionVat=rate?money(commission*rate/(100+rate)):0;
  const commissionEx=money(commission-commissionVat);
  let doc=prior;
  if(!doc){[doc]=await db.insert(taxDocuments).values({documentNumber:"",sourceReference:"transfer:"+reference,documentType:"driver_remittance",driverId:p.driver_id,fleetId:contract?.fleet_id||null,totalInclVatZar:String(net),metadata:{settlement_reference:reference,gross_delivery_fares_zar:gross,platform_commission_zar:commission,platform_commission_excl_vat_zar:commissionEx,platform_commission_vat_zar:commissionVat,fleet_split_deduction_zar:fleetDeduction,net_eft_payout_zar:net,paid:true}}).onConflictDoNothing().returning();}
  if(!doc){const [d]=await db.select().from(taxDocuments).where(eq(taxDocuments.sourceReference,"transfer:"+reference)).limit(1);if(d?.storageKey)return d;throw new Error("Remittance document insert conflict.");}
  const data:TaxPdfData={title:"DRIVER REMITTANCE STATEMENT",documentNumber:doc.documentNumber,issuedAt:new Date().toISOString(),supplier:company,recipient:{name:profile?.full_name||"Driver"},order:{waybill:"Payout "+reference},lines:[{label:"Gross delivery fares",amount:gross},{label:"SwiftHaul platform commission · excl. VAT",amount:-commissionEx},{label:"VAT included in platform commission · "+rate+"%",amount:-commissionVat},{label:"Fleet split deduction",amount:-fleetDeduction}],subtotal:net,vat:0,vatRate:rate,total:net,metadata:{paid:true,note:"Paystack settlement reference: "+reference}};
  await savePdf(doc,data);return doc;
 }
 const {data:fleetPay,error:fleetError}=await dbs.from("fleet_payout_transfers").select("*").eq("reference",reference).maybeSingle();
 if(fleetError||!fleetPay)throw new Error("Completed driver or fleet payout reference was not found.");
 let doc=prior;
 if(!doc){[doc]=await db.insert(taxDocuments).values({documentNumber:"",sourceReference:"transfer:"+reference,documentType:"fleet_statement",fleetId:fleetPay.fleet_id||null,totalInclVatZar:String(Number(fleetPay.amount_cents||0)/100),metadata:{settlement_reference:reference,net_eft_payout_zar:Number(fleetPay.amount_cents||0)/100,paid:true}}).onConflictDoNothing().returning();}
 if(!doc){const [d]=await db.select().from(taxDocuments).where(eq(taxDocuments.sourceReference,"transfer:"+reference)).limit(1);if(d?.storageKey)return d;throw new Error("Fleet statement insert conflict.");}
 const {data:booking}=await dbs.from("customer_bookings").select("price,driver_user_id").eq("waybill",fleetPay.waybill).maybeSingle();
 const gross=money(Number(booking?.price||0)),commission=money(gross*0.25),net=money(Number(fleetPay.amount_cents||0)/100);
 const rate=company?.isVatRegistered?Number(company.vatRatePercent||15.5):0,commissionVat=rate?money(commission*rate/(100+rate)):0,commissionEx=money(commission-commissionVat);
 const {data:contract}=booking?.driver_user_id?await dbs.from("fleet_driver_contracts").select("fleet_percentage,driver_percentage").eq("fleet_id",fleetPay.fleet_id).eq("driver_id",booking.driver_user_id).eq("is_active",true).maybeSingle():{data:null};
 const fleetShare=contract?.fleet_percentage?money(gross*0.75*Number(contract.fleet_percentage)/100):net;
 const driverShare=money(Math.max(0,gross*0.75-fleetShare));
 const fleetLines=gross>0?[{label:"Gross delivery fare",amount:gross},{label:"SwiftHaul platform commission · excl. VAT",amount:-commissionEx},{label:"VAT included in platform commission · "+rate+"%",amount:-commissionVat},{label:"Driver share after fleet split",amount:-driverShare}]:[{label:"Fleet EFT payout",amount:net}];
 const data:TaxPdfData={title:"FLEET REMITTANCE STATEMENT",documentNumber:doc.documentNumber,issuedAt:new Date().toISOString(),supplier:company,recipient:{name:"SwiftHaul fleet partner"},order:{waybill:fleetPay.waybill},lines:fleetLines,subtotal:net,vat:0,vatRate:rate,total:net,metadata:{paid:true,note:"Paystack settlement reference: "+reference}};
 await savePdf(doc,data);return doc;
}
export async function POST(request:NextRequest){
 const secret=process.env.TAX_DOCUMENT_WEBHOOK_SECRET;
 if(!secret)return NextResponse.json({error:"Tax document webhook secret is not configured."},{status:503});
 const raw=await request.text();
 if(!verify(raw,request.headers.get("x-tax-doc-signature")||"",secret))return NextResponse.json({error:"Invalid webhook signature."},{status:401});
 try{const body=JSON.parse(raw);let doc;
  if(body.event==="charge.success"&&typeof body.waybill==="string"&&typeof body.reference==="string")doc=await senderDocument(body.waybill,body.reference);
  else if(body.event==="sender.invoice.requested"&&typeof body.waybill==="string")doc=await senderDocument(body.waybill,body.waybill,true);
  else if(body.event==="transfer.success"&&typeof body.reference==="string")doc=await payoutDocument(body.reference);
  else return NextResponse.json({ignored:true});
  return NextResponse.json({ok:true,document_id:doc.id,document_number:doc.documentNumber});
 }catch(error){console.error("Tax document generation failed",error);return NextResponse.json({error:error instanceof Error?error.message:"Tax document generation failed."},{status:500});}
}
