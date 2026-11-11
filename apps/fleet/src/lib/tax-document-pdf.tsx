import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles=StyleSheet.create({
 page:{padding:38,fontSize:9,color:"#1d252d",fontFamily:"Helvetica"},
 header:{flexDirection:"row",justifyContent:"space-between",borderBottomWidth:2,borderBottomColor:"#27323c",paddingBottom:14,marginBottom:18},
 brand:{fontSize:19,fontWeight:"bold",letterSpacing:1,color:"#151b21"},
 title:{fontSize:16,fontWeight:"bold",textAlign:"right",color:"#1d252d"},
 muted:{fontSize:8,color:"#687481",marginTop:4},
 section:{marginBottom:14},
 row:{flexDirection:"row",justifyContent:"space-between",paddingVertical:5,borderBottomWidth:.5,borderBottomColor:"#d8dee4"},
 rowLabel:{color:"#52606d"},
 strong:{fontWeight:"bold"},
 heading:{fontSize:10,fontWeight:"bold",marginBottom:7,color:"#25313b"},
 two:{flexDirection:"row",gap:20},
 half:{width:"50%"},
 tableHead:{flexDirection:"row",backgroundColor:"#edf1f4",padding:7,fontWeight:"bold"},
 tableRow:{flexDirection:"row",padding:7,borderBottomWidth:.5,borderBottomColor:"#d8dee4"},
 colDesc:{width:"62%"},colQty:{width:"12%",textAlign:"right"},colAmount:{width:"26%",textAlign:"right"},
 total:{marginTop:10,padding:10,backgroundColor:"#edf1f4"},
 footer:{position:"absolute",bottom:22,left:38,right:38,fontSize:7,color:"#687481",borderTopWidth:.5,borderTopColor:"#d8dee4",paddingTop:7}
});
const money=(v:any)=>"R "+Number(v||0).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2});
const line=(label:string,value:any)=><View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text>{money(value)}</Text></View>;
export type TaxPdfData={title:string,documentNumber:string,issuedAt:string,supplier:any,recipient:any,order:any,lines:{label:string,quantity?:string,amount:number}[],subtotal:number,vat:number,vatRate:number,total:number,metadata?:any};
export function TaxDocumentPdf({data}:{data:TaxPdfData}){
 return <Document title={data.title+" "+data.documentNumber} author="SwiftHaul SA">
  <Page size="A4" style={styles.page}>
   <View style={styles.header}><View><Text style={styles.brand}>SWIFTHAUL SA</Text><Text style={styles.muted}>Logistics · Delivery services · South Africa</Text></View><View><Text style={styles.title}>{data.title}</Text><Text style={styles.muted}>{data.documentNumber}</Text><Text style={styles.muted}>Issued: {new Date(data.issuedAt).toLocaleDateString("en-ZA",{timeZone:"Africa/Johannesburg"})}</Text></View></View>
   <View style={[styles.two,styles.section]}><View style={styles.half}><Text style={styles.heading}>SUPPLIER</Text><Text>{data.supplier?.legalEntityName||"SwiftHaul SA"}</Text><Text>{data.supplier?.registeredAddress||"Registered address not configured"}</Text>{data.supplier?.cipcRegNumber&&<Text>CIPC: {data.supplier.cipcRegNumber}</Text>}{data.supplier?.isVatRegistered&&<Text>VAT No: {data.supplier.vatNumber}</Text>}</View><View style={styles.half}><Text style={styles.heading}>BILLED TO</Text><Text>{data.recipient?.name||"Customer"}</Text><Text>{data.recipient?.address||"Address not supplied"}</Text>{data.recipient?.vatNumber&&<Text>VAT No: {data.recipient.vatNumber}</Text>}</View></View>
   {data.order&&<View style={styles.section}><Text style={styles.heading}>DELIVERY DETAILS</Text><View style={styles.row}><Text style={styles.rowLabel}>Waybill / Tracking</Text><Text>{data.order.waybill||data.order.tracking_code||"—"}</Text></View><View style={styles.row}><Text style={styles.rowLabel}>Route</Text><Text>{data.order.pickup||"Pickup"} → {data.order.dropoff||"Drop-off"}</Text></View><View style={styles.row}><Text style={styles.rowLabel}>Distance / vehicle</Text><Text>{data.order.distance_km||"—"} km · {data.order.vehicle||"—"}</Text></View></View>}
   <View style={styles.section}><Text style={styles.heading}>SERVICE BREAKDOWN</Text><View style={styles.tableHead}><Text style={styles.colDesc}>Description</Text><Text style={styles.colQty}>Qty</Text><Text style={styles.colAmount}>Amount</Text></View>{data.lines.map((l,i)=><View style={styles.tableRow} key={i}><Text style={styles.colDesc}>{l.label}</Text><Text style={styles.colQty}>{l.quantity||"1"}</Text><Text style={styles.colAmount}>{money(l.amount)}</Text></View>)}</View>
   <View style={styles.section}><Text style={styles.heading}>AMOUNT SUMMARY</Text>{line("Subtotal (Excl. VAT)",data.subtotal)}{line(data.supplier?.isVatRegistered?"VAT @ "+data.vatRate+"%":"VAT (not charged)",data.vat)}<View style={styles.total}><View style={styles.row}><Text style={styles.strong}>TOTAL {data.metadata?.paid?"PAID":"INCL. VAT"} (ZAR)</Text><Text style={styles.strong}>{money(data.total)}</Text></View></View></View>
   {data.metadata?.note&&<Text style={styles.muted}>{data.metadata.note}</Text>}
   <Text style={styles.footer}>SwiftHaul SA · This document is generated electronically. Keep this document with your accounting records. {data.supplier?.isVatRegistered?"VAT is charged at the rate shown above.":"SwiftHaul is not represented as VAT-registered on this document."}</Text>
  </Page>
 </Document>;
}
