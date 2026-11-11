const fs=require("node:fs");const assert=require("node:assert/strict");
const migration=fs.readFileSync("supabase/migrations/20261112040000_customer_driver_growth_milestones.sql","utf8");
const schema=fs.readFileSync("apps/fleet/src/db/schema.ts","utf8");
const api=fs.readFileSync("apps/fleet/src/app/api/admin/growth/route.ts","utf8");
const page=fs.readFileSync("apps/fleet/src/app/admin/growth/page.tsx","utf8");
const dashboard=fs.readFileSync("apps/fleet/src/app/admin/dashboard/page.tsx","utf8");
assert.match(migration,/growth_milestones_category_target_unique/);assert.match(migration,/check_and_unlock_growth_milestones/);assert.match(migration,/after insert on public\.user_profiles/i);assert.match(migration,/after update of role on public\.user_profiles/i);assert.match(migration,/revoke all on public\.growth_milestones from anon,authenticated/i);
assert.match(schema,/growthMilestones=pgTable/);assert.match(api,/requireCompanyAdmin/);assert.match(api,/estimatedDate/);assert.match(api,/format.*csv/);assert.match(page,/30-day sign-up trends/);assert.match(page,/Recent sign-ups/);assert.match(page,/MILESTONE ACHIEVEMENTS/);assert.match(dashboard,/MILESTONE ACHIEVEMENTS/);
console.log("Growth milestone tracker static checks passed.");
