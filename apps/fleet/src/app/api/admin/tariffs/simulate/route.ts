import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { surgeRules } from "@/db/schema";
import { requireCompanyAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const roundMoney = (n:number) => Math.round((n + Number.EPSILON) * 100) / 100;

function activeAt(rule:any, now:Date) {
  if (!rule.isActive) return false;
  if (rule.ruleType !== "scheduled_peak") return true;
  if (!rule.startTimeSast || !rule.endTimeSast) return false;
  const parts = new Intl.DateTimeFormat("en-ZA",{timeZone:"Africa/Johannesburg",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const part=(type:string)=>parts.find(p=>p.type===type)?.value||"";
  const day=({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6} as Record<string,number>)[part("weekday")]??-1;
  const minutes=Number(part("hour"))*60+Number(part("minute"));
  const mins=(v:string)=>{const [h,m]=v.slice(0,5).split(":").map(Number);return h*60+m;};
  const start=mins(rule.startTimeSast),end=mins(rule.endTimeSast);
  const dayOK=(rule.daysOfWeek||[]).includes(day);
  return dayOK&&(start<=end?minutes>=start&&minutes<end:minutes>=start||minutes<end);
}

export async function POST(request:NextRequest) {
  const auth=await requireCompanyAdmin(request);
  if(auth.response)return auth.response;
  try {
    const body=await request.json();
    const t=body.vehicle_tariff||{};
    const type=String(t.vehicleType||"");
    const allowed=["motorbike","bakkie","truck"];
    const distance=Number(body.distance_km),stops=Number(body.extra_stops||0);
    const fields=["baseFareZar","includedKm","tier1MaxKm","tier1RatePerKmZar","tier2RatePerKmZar","minimumFareZar","extraStopFeeZar","platformCommissionPercent"];
    const v:Record<string,number>={};
    for(const key of fields)v[key]=Number(t[key]);
    if(!allowed.includes(type)||!Number.isFinite(distance)||distance<=0||!Number.isInteger(stops)||stops<0||stops>20||fields.some(k=>!Number.isFinite(v[k])||v[k]<0)||v.tier1MaxKm<v.includedKm||v.platformCommissionPercent>100) {
      return NextResponse.json({error:"Invalid draft tariff, distance or extra-stop count."},{status:400});
    }
    const fuel=Number(body.fuel_surcharge_percent||0),globalCap=Number(body.max_global_surge_cap||1.5);
    if(!Number.isFinite(fuel)||fuel<0||fuel>100||!Number.isFinite(globalCap)||globalCap<1||globalCap>1.5)return NextResponse.json({error:"Fuel surcharge or surge cap is outside the allowed range."},{status:400});
    const rules=await db.select().from(surgeRules);
    const now=new Date();
    const active=rules.filter(r=>activeAt(r,now));
    const selected=active.sort((a,b)=>Math.min(Number(b.multiplier),Number(b.maxMultiplierCap),globalCap)-Math.min(Number(a.multiplier),Number(a.maxMultiplierCap),globalCap))[0];
    const surge=Math.max(1,selected?Math.min(Number(selected.multiplier),Number(selected.maxMultiplierCap),globalCap):1);
    const tier1Km=Math.max(0,Math.min(distance,v.tier1MaxKm)-v.includedKm);
    const tier2Km=Math.max(0,distance-v.tier1MaxKm);
    const tier1=tier1Km*v.tier1RatePerKmZar,tier2=tier2Km*v.tier2RatePerKmZar,stopFees=stops*v.extraStopFeeZar;
    const beforeMinimum=v.baseFareZar+tier1+tier2+stopFees;
    const minimumAdjustment=Math.max(0,v.minimumFareZar-beforeMinimum);
    const beforeSurge=Math.max(v.minimumFareZar,beforeMinimum);
    const surgeCharge=beforeSurge*(surge-1),fuelCharge=(beforeSurge+surgeCharge)*fuel/100;
    const gross=roundMoney(beforeSurge+surgeCharge+fuelCharge);
    const commission=roundMoney(gross*v.platformCommissionPercent/100);
    return NextResponse.json({preview_only:true,vehicle_type:type,distance_km:distance,extra_stops:stops,base_fare_zar:roundMoney(v.baseFareZar),included_km:v.includedKm,tier1_km:roundMoney(tier1Km),tier1_charge_zar:roundMoney(tier1),tier2_km:roundMoney(tier2Km),tier2_charge_zar:roundMoney(tier2),extra_stop_fees_zar:roundMoney(stopFees),minimum_fare_adjustment_zar:roundMoney(minimumAdjustment),fare_before_surge_zar:roundMoney(beforeSurge),surge_rule:selected?.name||null,surge_multiplier:surge,surge_charge_zar:roundMoney(surgeCharge),fuel_surcharge_percent:fuel,fuel_surcharge_zar:roundMoney(fuelCharge),platform_commission_percent:v.platformCommissionPercent,gross_fare_zar:gross,platform_commission_zar:commission,driver_net_payout_zar:roundMoney(gross-commission)});
  } catch(error) {
    console.error("Tariff draft simulation failed",error);
    return NextResponse.json({error:"Unable to simulate the draft tariff."},{status:500});
  }
}
