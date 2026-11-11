# SwiftHaul tax documents (staging)

## Required deployment configuration

The PDF generator runs in the Next.js Node.js runtime. It requires:

- `DATABASE_URL`: staging Postgres connection for Drizzle.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: server-side Supabase access. Never expose the service-role key as a `NEXT_PUBLIC_*` variable.
- `TAX_DOCUMENT_WEBHOOK_SECRET`: long random shared HMAC secret.
- `TAX_DOCUMENTS_API_URL`: the absolute HTTPS URL to `/api/internal/tax-documents/events` on the deployed Next.js staging app. Configure this and the same `TAX_DOCUMENT_WEBHOOK_SECRET` in Supabase Edge Function secrets for `paystack-webhook`.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser sign-in only.

The webhook now sends signed `charge.success` and `transfer.success` events to the Next.js PDF service. It returns a retryable 503 if the service is not configured or the PDF could not be stored. Set the two Edge Function secrets before accepting this as a live automated document workflow.

## Storage and access

The `swift-haul-tax-documents` bucket is private. The `tax_documents` table has RLS enabled and no direct anon/authenticated grants. Documents are retrieved through authenticated, ownership-checked API routes or a tracking-code capability route, which returns a 60-second signed URL.

## Company tax profile

Enter the confirmed legal entity name, CIPC registration number, registered address and VAT registration details in Admin → Tariffs & surge → Invoice & VAT profile. Leave VAT registration disabled until the SARS registration is confirmed. The current configurable default VAT rate is 15.5%; the rate is snapshotted into each issued document.

## Invoice rules

A full invoice is generated for a VAT-registered supplier when the supply exceeds R5,000 and the recipient business name/address details have been supplied. The tracking page can collect those details and request the full invoice. If details are missing at payment time, a payment receipt is issued and marked as awaiting full-invoice details; the receipt does not replace the required full tax invoice.

The VAT rate and invoice rules should be reviewed by SwiftHaul's accountant/tax practitioner before production. This software does not register SwiftHaul as a VAT vendor or independently validate a VAT number with SARS.

## Tax-year export

The annual export uses South Africa's 1 March to end-February tax year. Driver and fleet PDF/CSV exports are summaries of stored remittance statements. Admin monthly CSV/ZIP exports are accounting reconciliation data and are not an automatically completed SARS VAT201 return.
