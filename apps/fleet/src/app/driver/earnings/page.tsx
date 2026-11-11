import TaxDocumentsPanel from "@/components/tax-documents-panel";
export const metadata={title:"Driver earnings & tax documents | SwiftHaul"};
export default function DriverEarnings(){return <><header><div><p className="eyebrow">DRIVER WORKSPACE</p><h1>Earnings & remittances</h1><p className="muted">Review your completed payout records and annual tax summaries.</p></div></header><TaxDocumentsPanel/></>}
