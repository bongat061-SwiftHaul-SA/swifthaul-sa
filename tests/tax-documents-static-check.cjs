const fs=require("node:fs");const path=require("node:path");
const read=p=>fs.readFileSync(path.join(process.cwd(),p),"utf8");
const schema=read("apps/fleet/src/db/schema.ts");
const migration=read("supabase/migrations/20261112060000_sars_tax_documents.sql");
const event=read("apps/fleet/src/app/api/internal/tax-documents/events/route.ts");
const webhook=read("supabase/functions/paystack-webhook/index.ts");
const tracking=read("public/track-page.js");
const admin=read("apps/fleet/src/app/admin/tariffs/tariff-admin-client.tsx");
const quote=read("apps/fleet/src/app/api/quotes/calculate/route.ts");
const simulator=read("apps/fleet/src/app/api/admin/tariffs/simulate/route.ts");
const ledger=read("apps/fleet/src/app/api/admin/operations/invoices/route.ts");
const checks=[
 ["tax document Drizzle table",schema.includes('pgTable("tax_documents"')],
 ["company VAT profile fields",schema.includes('vatRatePercent')&&schema.includes('cipcRegNumber')&&schema.includes('registeredAddress')],
 ["unsupported Hatchback/Sedan removed",!schema.includes("hatchback_sedan")&&!admin.includes("hatchback_sedan")&&!quote.includes("hatchback_sedan")&&!simulator.includes("hatchback_sedan")],
 ["South African VAT rate default 15.5%",migration.includes("default 15.50")],
 ["private tax storage bucket",migration.includes("values ('swift-haul-tax-documents','swift-haul-tax-documents',false")],
 ["sequential tax document number trigger",migration.includes("assign_tax_document_number")],
 ["PDF generation and private storage",event.includes("renderToBuffer")&&event.includes('storage.from(bucket).upload')],
 ["idempotent webhook source reference",event.includes("sourceReference")],
 ["Paystack charge and transfer hooks",webhook.includes('event:"charge.success"')&&webhook.includes('event:"transfer.success"')],
 ["retry webhook when PDF event fails",webhook.includes("tax document generation will retry")],
 ["customer tracking invoice form",tracking.includes("Generate full tax invoice")&&tracking.includes("tracking/download")],
 ["admin monthly ZIP and CSV export",ledger.includes('format")==="zip"')&&ledger.includes('format")==="csv"')],
 ["admin tax profile",admin.includes("COMPANY TAX IDENTITY")&&admin.includes("Save company tax profile")]
];
let failed=false;for(const [name,ok]of checks){console.log((ok?"PASS":"FAIL")+" "+name);if(!ok)failed=true;}if(failed)process.exit(1);
