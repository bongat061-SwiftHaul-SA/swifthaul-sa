import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata:Metadata={title:"SwiftHaul Fleet Owner",description:"Fleet management and earnings portal"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en-ZA"><body><div className="shell"><aside className="sidebar"><div className="brand">SWIFTHAUL <span>FLEET</span></div><p className="muted">OWNER WORKSPACE</p><nav><Link href="/fleet">Overview</Link><Link href="/fleet/vehicles">Vehicles</Link><Link href="/fleet/drivers">Drivers</Link><Link href="/fleet/earnings">Earnings & splits</Link></nav><div className="sidefoot">South Africa · ZAR</div></aside><main className="main">{children}</main></div></body></html>}