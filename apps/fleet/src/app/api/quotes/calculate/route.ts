import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { vehicleTariffs, surgeRules, tariffSettings, tariffQuotes } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type VehicleType = "motorbike" | "hatchback_sedan" | "bakkie_van" | "truck";
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validTypes: VehicleType[] = ["motorbike","hatchback_sedan","bakkie_van","truck"];

function isRuleActive(rule: typeof surgeRules.$inferSelect, now: Date) {
  if (!rule.isActive) return false;
  if (rule.ruleType !== "scheduled_peak") return true;
  if (!rule.startTimeSast || !rule.endTimeSast) return false;
  const parts = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const day = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[part("weekday")];
  const time = Number(part("hour")) * 60 + Number(part("minute"));
  const toMinutes = (v: string) => { const [h,m] = v.slice(0,5).split(":").map(Number); return h*60+m; };
  const start = toMinutes(rule.startTimeSast), end = toMinutes(rule.endTimeSast);
  const dayAllowed = (rule.daysOfWeek || []).includes(day);
  const timeAllowed = start <= end ? time >= start && time < end : time >= start || time < end;
  return dayAllowed && timeAllowed;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const vehicleType = body.vehicle_type as VehicleType;
    const distanceKm = Number(body.distance_km);
    const extraStops = Number(body.extra_stops || 0);
    if (!validTypes.includes(vehicleType) || !Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isInteger(extraStops) || extraStops < 0 || extraStops > 20) {
      return NextResponse.json({ error: "Provide a valid vehicle type, positive distance and 0–20 extra stops." }, { status: 400 });
    }
    const [tariff] = await db.select().from(vehicleTariffs).where(and(eq(vehicleTariffs.vehicleType, vehicleType), eq(vehicleTariffs.isActive, true))).limit(1);
    if (!tariff) return NextResponse.json({ error: "This vehicle tariff is not active yet. Ask an administrator to configure it." }, { status: 409 });
    const [settings] = await db.select().from(tariffSettings).orderBy(desc(tariffSettings.updatedAt)).limit(1);
    const rules = await db.select().from(surgeRules);
    const fuelPercent = Number(settings?.fuelSurchargePercent || 0);
    const globalCap = Number(settings?.maxGlobalSurgeCap || 1.5);
    const active = rules.filter((rule) => isRuleActive(rule, new Date()));
    const selected = active.sort((a,b) => Math.min(Number(b.multiplier),Number(b.maxMultiplierCap),globalCap)-Math.min(Number(a.multiplier),Number(a.maxMultiplierCap),globalCap))[0];
    const surgeMultiplier = selected ? Math.min(Number(selected.multiplier), Number(selected.maxMultiplierCap), globalCap) : 1;
    const included = Number(tariff.includedKm);
    const tierBoundary = Number(tariff.tier1MaxKm);
    const tier1Km = Math.max(0, Math.min(distanceKm, tierBoundary) - included);
    const tier2Km = Math.max(0, distanceKm - tierBoundary);
    const base = Number(tariff.baseFareZar);
    const tier1 = tier1Km * Number(tariff.tier1RatePerKmZar);
    const tier2 = tier2Km * Number(tariff.tier2RatePerKmZar);
    const stopFees = extraStops * Number(tariff.extraStopFeeZar);
    const beforeMinimum = base + tier1 + tier2 + stopFees;
    const minimumAdjustment = Math.max(0, Number(tariff.minimumFareZar) - beforeMinimum);
    const fareBeforeSurge = Math.max(Number(tariff.minimumFareZar), beforeMinimum);
    const surgeAmount = fareBeforeSurge * (surgeMultiplier - 1);
    const fuelAmount = (fareBeforeSurge + surgeAmount) * fuelPercent / 100;
    const gross = money(fareBeforeSurge + surgeAmount + fuelAmount);
    const commission = money(gross * Number(tariff.platformCommissionPercent) / 100);
    const driverNet = money(gross - commission);
    const validity = Math.min(60, Math.max(1, Number(settings?.quoteValidityMinutes || 10)));
    const expiresAt = new Date(Date.now() + validity * 60_000);
    const breakdown = { base_fare_zar: money(base), included_km: included, tier1_km: money(tier1Km), tier1_charge_zar: money(tier1), tier2_km: money(tier2Km), tier2_charge_zar: money(tier2), extra_stops: extraStops, extra_stop_fees_zar: money(stopFees), minimum_fare_adjustment_zar: money(minimumAdjustment), fare_before_surge_zar: money(fareBeforeSurge), surge_rule: selected?.name || null, surge_multiplier: surgeMultiplier, surge_charge_zar: money(surgeAmount), fuel_surcharge_percent: fuelPercent, fuel_surcharge_zar: money(fuelAmount), platform_commission_percent: Number(tariff.platformCommissionPercent), gross_fare_zar: gross, platform_commission_zar: commission, driver_net_payout_zar: driverNet };
    const [quote] = await db.insert(tariffQuotes).values({ vehicleType, distanceKm: String(distanceKm), extraStops, grossFareZar: String(gross), platformCommissionZar: String(commission), driverNetPayoutZar: String(driverNet), surgeMultiplier: String(surgeMultiplier), fuelSurchargePercent: String(fuelPercent), fareBreakdown: breakdown, tariffSnapshot: tariff, expiresAt }).returning({ id: tariffQuotes.id, expiresAt: tariffQuotes.expiresAt });
    return NextResponse.json({ quote_id: quote.id, expires_at: quote.expiresAt, validity_minutes: validity, ...breakdown });
  } catch (error) {
    console.error("Quote calculation failed", error);
    return NextResponse.json({ error: "Unable to calculate a quote at this time." }, { status: 500 });
  }
}
