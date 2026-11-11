import {NextRequest,NextResponse} from "next/server";
import {and,desc,eq,gte,inArray,sql} from "drizzle-orm";
import {db} from "@/db/client";
import {userProfiles,driverProfiles,growthMilestones} from "@/db/schema";
import {requireCompanyAdmin} from "@/lib/admin-auth";
export const runtime="nodejs";export const dynamic="force-dynamic";
const roles=["customer","driver","fleet_owner"] as const;
const dayKey=(d:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Johannesburg",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
const startSast=(day:string)=>new Date(day+"T00:00:00+02:00");
const addDays=(d:Date,n:number)=>new Date(d.getTime()+n*86400000);
const pct=(a:number,b:number)=>b?Math.round(a/b*1000)/10:0;
export async function GET(req:NextRequest){
 const auth=await requireCompanyAdmin(req);if(auth.response)return auth.response;
 try{
  const now=new Date(),today=dayKey(now),todayStart=startSast(today);
  const todayNoon=new Date(today+"T12:00:00+02:00");const weekStartDate=startSast(dayKey(addDays(todayNoon,-((todayNoon.getUTCDay()+6)%7))));
  const monthStart=startSast(today.slice(0,7)+"-01");
  const [allCounts,activeCustomers,customerToday,driverToday,combinedToday,customerWeek,driverWeek,combinedWeek,customerMonth,driverMonth,combinedMonth,milestones,recent,chartRows]=await Promise.all([
   db.select({role:userProfiles.role,n:sql<number>`count(*)::int`}).from(userProfiles).where(inArray(userProfiles.role,[...roles])).groupBy(userProfiles.role),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(eq(userProfiles.role,"customer"),eq(userProfiles.accountStatus,"active"))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(eq(userProfiles.role,"customer"),gte(userProfiles.createdAt,todayStart))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(eq(userProfiles.role,"driver"),gte(userProfiles.createdAt,todayStart))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(inArray(userProfiles.role,[...roles]),gte(userProfiles.createdAt,todayStart))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(eq(userProfiles.role,"customer"),gte(userProfiles.createdAt,weekStartDate))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(eq(userProfiles.role,"driver"),gte(userProfiles.createdAt,weekStartDate))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(inArray(userProfiles.role,[...roles]),gte(userProfiles.createdAt,weekStartDate))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(eq(userProfiles.role,"customer"),gte(userProfiles.createdAt,monthStart))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(eq(userProfiles.role,"driver"),gte(userProfiles.createdAt,monthStart))),
   db.select({n:sql<number>`count(*)::int`}).from(userProfiles).where(and(inArray(userProfiles.role,[...roles]),gte(userProfiles.createdAt,monthStart))),
   db.select().from(growthMilestones).orderBy(growthMilestones.category,growthMilestones.targetCount),
   db.select({id:userProfiles.id,fullName:userProfiles.fullName,role:userProfiles.role,city:userProfiles.city,province:userProfiles.province,accountStatus:userProfiles.accountStatus,createdAt:userProfiles.createdAt,verificationStatus:driverProfiles.verificationStatus,onboardingStatus:driverProfiles.onboardingStatus}).from(userProfiles).leftJoin(driverProfiles,eq(userProfiles.id,driverProfiles.userId)).where(inArray(userProfiles.role,["customer","driver"])).orderBy(desc(userProfiles.createdAt)).limit(100),
   db.select({role:userProfiles.role,createdAt:userProfiles.createdAt}).from(userProfiles).where(and(inArray(userProfiles.role,[...roles]),gte(userProfiles.createdAt,startSast(dayKey(addDays(now,-29))))))
  ]);
  const count=(role:string)=>Number(allCounts.find(x=>x.role===role)?.n||0);
  const customers=count("customer"),drivers=count("driver"),fleetOwners=count("fleet_owner"),combined=customers+drivers+fleetOwners;
  const active=Number(activeCustomers[0]?.n||0);
  const driverRows=await db.select({verificationStatus:driverProfiles.verificationStatus,accountStatus:userProfiles.accountStatus}).from(userProfiles).innerJoin(driverProfiles,eq(userProfiles.id,driverProfiles.userId)).where(eq(userProfiles.role,"driver"));
  const approved=driverRows.filter(x=>x.accountStatus==="active"&&["approved","verified"].includes(String(x.verificationStatus||"").toLowerCase())).length;
  const pending=drivers-approved;
  const byDay=new Map<string,{customers:number;drivers:number}>();for(let i=0;i<30;i++)byDay.set(dayKey(addDays(startSast(today),i-29)),{customers:0,drivers:0});
  for(const row of chartRows){const k=dayKey(row.createdAt);const item=byDay.get(k);if(item){if(row.role==="customer")item.customers++;else if(row.role==="driver")item.drivers++;}}
  let cBase=customers-[...byDay.values()].reduce((s,x)=>s+x.customers,0),dBase=drivers-[...byDay.values()].reduce((s,x)=>s+x.drivers,0),cumulativeC=cBase,cumulativeD=dBase;
  const next=(category:string)=>milestones.find(m=>m.category===category&&!m.isUnlocked)?.targetCount||500;
  const nextC=next("customers"),nextD=next("drivers");
  const chart=[...byDay.entries()].map(([date,v],i)=>{cumulativeC+=v.customers;cumulativeD+=v.drivers;return {date,customersDaily:v.customers,driversDaily:v.drivers,customersCumulative:cumulativeC,driversCumulative:cumulativeD,expectedCustomers:Math.round(cBase+(Math.max(0,nextC-cBase)*(i+1)/30)),expectedDrivers:Math.round(dBase+(Math.max(0,nextD-dBase)*(i+1)/30)),expectedCustomersDaily:Math.max(0,(nextC-cBase)/30),expectedDriversDaily:Math.max(0,(nextD-dBase)/30)};});
  const last7Start=startSast(dayKey(addDays(now,-6)));const last7=chartRows.filter(x=>x.createdAt>=last7Start).length,rate=Math.round(last7/7*100)/100;
  const nextCombined=milestones.find(m=>m.category==="combined_users"&&!m.isUnlocked)?.targetCount||500;
  const daysTo=rate>0?Math.ceil(Math.max(0,nextCombined-combined)/rate):null;
  const seq={customer:customers,driver:drivers};const roleRecent={customer:recent.filter(x=>x.role==="customer").sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()),driver:recent.filter(x=>x.role==="driver").sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime())};const recentRows=recent.map(row=>{const role=row.role as "customer"|"driver";const rank=roleRecent[role].findIndex(x=>x.id===row.id)+1;const number=seq[role]-roleRecent[role].length+rank;return {...row,userNumber:number,onboardingStatus:role==="customer"?row.accountStatus:(row.verificationStatus||row.onboardingStatus||"pending")};});
  const csv=req.nextUrl.searchParams.get("format")==="csv";
  if(csv){const cols=["name","role","city","province","onboarding_status","signed_up_at","user_number"];const q=(v:unknown)=>'"'+String(v??"").replace(/"/g,'""')+'"';const rows=recentRows.map(r=>[r.fullName,r.role,r.city,r.province,r.onboardingStatus,r.createdAt.toISOString(),r.userNumber].map(q).join(","));return new NextResponse([cols.join(","),...rows].join("\r\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="swifthaul-recent-signups.csv"'}});}
  const delta=(a:number,b:number)=>({today:a,week:b,month:0});
  return NextResponse.json({asOf:now.toISOString(),metrics:{customers:{total:customers,active,conversionPercent:pct(active,customers),today:Number(customerToday[0]?.n||0),week:Number(customerWeek[0]?.n||0),month:Number(customerMonth[0]?.n||0)},drivers:{total:drivers,approvedActive:approved,pendingVerification:pending,today:Number(driverToday[0]?.n||0),week:Number(driverWeek[0]?.n||0),month:Number(driverMonth[0]?.n||0)},combined:{total:combined,today:Number(combinedToday[0]?.n||0),week:Number(combinedWeek[0]?.n||0),month:Number(combinedMonth[0]?.n||0)},dailyRate:{last7Signups:last7,perDay:rate,today:Number(combinedToday[0]?.n||0),week:Number(combinedWeek[0]?.n||0),month:Number(combinedMonth[0]?.n||0),nextMilestone:nextCombined,remaining:Math.max(0,nextCombined-combined),estimatedDate:daysTo===null?null:addDays(now,daysTo).toISOString()}},milestones,chart,recent:recentRows});
 }catch(e){console.error("Admin growth dashboard failed",e);return NextResponse.json({error:"Could not load growth metrics."},{status:500});}
}
