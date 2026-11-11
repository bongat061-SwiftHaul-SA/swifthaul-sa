import {NextRequest,NextResponse} from "next/server";
import {createHmac} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {desc,eq} from "drizzle-orm";
import {db} from "@/db/client";
import {taxDocuments} from "@/db/schema";
export const runtime="nodejs";export const dynamic="force-dynamic";
function admin(){const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Server credentials unavailable");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
export async function GET(req:NextRequest){
 const code=(req.nextUrl.searchParams.get("tracking_code")||"").trim();if(!code)return NextResponse.json({error:"Tracking code required."},{status:400});
 try{const svc=admin();const {data:b}=await svc.from("customer_bookings").select("waybill,paid_at,price,billing_company_name,billing_vat_number,billing_address").eq("tracking_code",code).maybeSingle();if(!b||!b.paid_at)return NextResponse.json({error:"No confirmed payment found for this tracking code."},{status:404});
 const docs=await db.select().from(taxDocuments).where(eq(taxDocuments.orderId,b.waybill)).orderBy(desc(taxDocuments.issuedAt));return NextResponse.json({paid:true,total_zar:Number(b.price||0),billing_company_name:b.billing_company_name||"",billing_vat_number:b.billing_vat_number||"",billing_address:b.billing_address||"",documents:docs.map(d=>({id:d.id,document_number:d.documentNumber,document_type:d.documentType,storage_ready:Boolean(d.storageKey),metadata:d.metadata}))});
 }catch(e){console.error("Tracking tax documents GET failed",e);return NextResponse.json({error:"Tax document information unavailable."},{status:500});}
}
export async function POST(req:NextRequest){
 try{const body=await req.json();const code=String(body.tracking_code||"").trim(),name=String(body.billing_company_name||"").trim(),vat=String(body.billing_vat_number||"").replace(/\\D/g,""),address=String(body.billing_address||"").trim();if(!code||!name||!address|| (vat&& !/^\\d{10}$/.test(vat)))return NextResponse.json({error:"Provide a tracking code, company name and billing address. VAT number must contain 10 digits when supplied."},{status:400});
 const svc=admin();const {data:b,error}=await svc.from("customer_bookings").select("waybill,paid_at,price").eq("tracking_code",code).maybeSingle();if(error||!b||!b.paid_at)return NextResponse.json({error:"Only paid deliveries can request a tax invoice."},{status:404});if(Number(b.price||0)<=5000)return NextResponse.json({error:"A full tax invoice is only required for supplies exceeding R5,000. Download the receipt or request an invoice through support."},{status:409});
 const {error:updateError}=await svc.from("customer_bookings").update({billing_company_name:name,billing_vat_number:vat||null,billing_address:address}).eq("waybill",b.waybill);if(updateError)return NextResponse.json({error:"Billing details could not be saved."},{status:500});
 const secret=process.env.TAX_DOCUMENT_WEBHOOK_SECRET;if(!secret)return NextResponse.json({error:"Invoice generation is not configured on this server."},{status:503});
 const payload=JSON.stringify({event:"sender.invoice.requested",waybill:b.waybill});const signature=createHmac("sha256",secret).update(payload).digest("hex");const origin=new URL(req.url).origin;
 const generated=await fetch(origin+"/api/internal/tax-documents/events",{method:"POST",headers:{"Content-Type":"application/json","x-tax-doc-signature":signature},body:payload});const result=await generated.json();if(!generated.ok)return NextResponse.json({error:result.error||"Tax invoice generation failed."},{status:generated.status});
 return NextResponse.json({ok:true,document_id:result.document_id,document_number:result.document_number});
 }catch(e){console.error("Tracking tax invoice request failed",e);return NextResponse.json({error:"Tax invoice request failed."},{status:500});}
}
