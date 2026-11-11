import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { tariffQuotes } from "@/db/schema";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const { quote_id } = await request.json();
    if (typeof quote_id !== "string") return NextResponse.json({ valid: false, error: "A quote_id is required." }, { status: 400 });
    const now = new Date();
    const [quote] = await db.update(tariffQuotes).set({ status: "consumed", consumedAt: now }).where(and(eq(tariffQuotes.id, quote_id), eq(tariffQuotes.status, "quoted"), gt(tariffQuotes.expiresAt, now))).returning();
    if (!quote) return NextResponse.json({ valid: false, error: "This quote has expired or has already been used. Please request a new quote." }, { status: 409 });
    return NextResponse.json({ valid: true, quote_id: quote.id, gross_fare_zar: Number(quote.grossFareZar), platform_commission_zar: Number(quote.platformCommissionZar), driver_net_payout_zar: Number(quote.driverNetPayoutZar), tariff_snapshot: quote.tariffSnapshot });
  } catch {
    return NextResponse.json({ valid: false, error: "Quote validation failed." }, { status: 400 });
  }
}
