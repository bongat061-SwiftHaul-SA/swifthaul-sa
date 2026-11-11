import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { vehicleTariffs, surgeRules, tariffSettings, tariffAuditLogs } from "@/db/schema";
import { requireCompanyAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireCompanyAdmin(request);
  if (auth.response) return auth.response;
  const [vehicles, surges, settings, audit] = await Promise.all([
    db.select().from(vehicleTariffs).orderBy(vehicleTariffs.vehicleType),
    db.select().from(surgeRules).orderBy(desc(surgeRules.createdAt)),
    db.select().from(tariffSettings).orderBy(desc(tariffSettings.updatedAt)).limit(1),
    db.select().from(tariffAuditLogs).orderBy(desc(tariffAuditLogs.createdAt)).limit(30),
  ]);
  return NextResponse.json({ vehicles, surges, settings: settings[0] || null, audit });
}

export async function PUT(request: NextRequest) {
  const auth = await requireCompanyAdmin(request);
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const actor = auth.user!.id;
    if (body.kind === "vehicle") {
      const values = body.values || {};
      const allowed = ["baseFareZar","includedKm","tier1MaxKm","tier1RatePerKmZar","tier2RatePerKmZar","minimumFareZar","extraStopFeeZar","platformCommissionPercent","isActive"];
      const patch: Record<string, unknown> = {};
      for (const key of allowed) if (key in values) patch[key] = values[key];
      if (!body.id) return NextResponse.json({ error: "Vehicle tariff id is required." }, { status: 400 });
      const [previous] = await db.select().from(vehicleTariffs).where(eq(vehicleTariffs.id, body.id)).limit(1);
      if (!previous) return NextResponse.json({ error: "Vehicle tariff not found." }, { status: 404 });
      const [updated] = await db.update(vehicleTariffs).set({ ...patch, updatedAt: new Date() }).where(eq(vehicleTariffs.id, body.id)).returning();
      await db.insert(tariffAuditLogs).values({ changedBy: actor, entityType: "vehicle_tariff", entityId: previous.id, action: "update", previousValues: previous, newValues: updated });
      return NextResponse.json({ item: updated });
    }
    if (body.kind === "settings") {
      const values = body.values || {};
      const patch = { fuelSurchargePercent: values.fuelSurchargePercent, maxGlobalSurgeCap: values.maxGlobalSurgeCap, quoteValidityMinutes: 10, updatedBy: actor, updatedAt: new Date() };
      const [previous] = await db.select().from(tariffSettings).orderBy(desc(tariffSettings.updatedAt)).limit(1);
      let updated;
      if (previous) [updated] = await db.update(tariffSettings).set(patch).where(eq(tariffSettings.id, previous.id)).returning();
      else [updated] = await db.insert(tariffSettings).values(patch).returning();
      await db.insert(tariffAuditLogs).values({ changedBy: actor, entityType: "tariff_settings", entityId: updated.id, action: previous ? "update" : "insert", previousValues: previous || null, newValues: updated });
      return NextResponse.json({ item: updated });
    }
    if (body.kind === "tax_profile") {
      const v=body.values||{};
      const vat=String(v.vatNumber||"").trim();
      const rate=Number(v.vatRatePercent??15.5);
      if(vat&&!/^\\d{10}$/.test(vat))return NextResponse.json({error:"South African VAT number must contain exactly 10 digits."},{status:400});
      if(!Number.isFinite(rate)||rate<0||rate>100)return NextResponse.json({error:"VAT rate must be between 0 and 100."},{status:400});
      if(v.isVatRegistered&&(!vat||!String(v.legalEntityName||"").trim()||!String(v.registeredAddress||"").trim()))return NextResponse.json({error:"VAT registration requires a legal entity name, 10-digit VAT number and registered address."},{status:400});
      const [previous]=await db.select().from(tariffSettings).orderBy(desc(tariffSettings.updatedAt)).limit(1);
      const patch={legalEntityName:String(v.legalEntityName||"").trim()||null,c ipcRegNumber:undefined};
      const values={legalEntityName:String(v.legalEntityName||"").trim()||null,c ipcRegNumber:undefined};
      const update={legalEntityName:values.legalEntityName,c ipcRegNumber:undefined};
      return NextResponse.json({error:"Tax profile handler placeholder."},{status:501});
    }
    if (body.kind === "surge") {
      const v = body.values || {};
      const ruleValues = { name: String(v.name || "").trim(), ruleType: v.ruleType, daysOfWeek: Array.isArray(v.daysOfWeek) ? v.daysOfWeek : [0,1,2,3,4,5,6], startTimeSast: v.startTimeSast || null, endTimeSast: v.endTimeSast || null, multiplier: v.multiplier, maxMultiplierCap: v.maxMultiplierCap || 1.5, isActive: Boolean(v.isActive), updatedAt: new Date() };
      if (!ruleValues.name || !["scheduled_peak","supply_demand","weather_event"].includes(ruleValues.ruleType)) return NextResponse.json({ error: "A rule name and valid rule type are required." }, { status: 400 });
      let item;
      if (body.id) {
        const [previous] = await db.select().from(surgeRules).where(eq(surgeRules.id, body.id)).limit(1);
        if (!previous) return NextResponse.json({ error: "Surge rule not found." }, { status: 404 });
        [item] = await db.update(surgeRules).set(ruleValues).where(eq(surgeRules.id, body.id)).returning();
        await db.insert(tariffAuditLogs).values({ changedBy: actor, entityType: "surge_rule", entityId: item.id, action: "update", previousValues: previous, newValues: item });
      } else {
        [item] = await db.insert(surgeRules).values(ruleValues).returning();
        await db.insert(tariffAuditLogs).values({ changedBy: actor, entityType: "surge_rule", entityId: item.id, action: "insert", previousValues: null, newValues: item });
      }
      return NextResponse.json({ item });
    }
    return NextResponse.json({ error: "Unsupported tariff update." }, { status: 400 });
  } catch (error) {
    console.error("Tariff admin update failed", error);
    return NextResponse.json({ error: "Could not save tariff configuration. Check the values and try again." }, { status: 400 });
  }
}
