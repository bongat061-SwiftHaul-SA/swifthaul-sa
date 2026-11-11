import PublicTaxTracking from "@/components/public-tax-tracking";
export const dynamic="force-dynamic";
export default async function TrackingDocumentsPage({params}:{params:Promise<{trackingCode:string}>}){const {trackingCode}=await params;return <PublicTaxTracking trackingCode={trackingCode}/>;}
