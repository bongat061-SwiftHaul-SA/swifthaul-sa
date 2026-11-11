import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
export const metadata:Metadata={title:"SwiftHaul Fleet Owner",description:"Fleet management and earnings portal"};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en-ZA"><body><div className="shell"><aside className="sidebar"><div className="brand">SWIFTHAUL <span>FLEET</span></div><p className="muted">OWNER WORKSPACE</p><nav><Link href="/fleet/dashboard">Overview</Link><Link href="/fleet/vehicles">Vehicles</Link><Link href="/fleet/drivers">Drivers</Link><Link href="/fleet/earnings">Earnings & splits</Link><Link href="/admin/tariffs">Tariffs & surge · Admin</Link><Link href="/admin/operations/invoices">Tax invoice ledger</Link></nav><div className="sidefoot">South Africa · ZAR</div></aside><main className="main">{children}</main></div></body></html>}