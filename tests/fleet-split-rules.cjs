const assert = require("node:assert/strict");
function split(grossCents, model) {
  const platform = Math.round(grossCents * 0.25);
  const net = grossCents - platform;
  if (model.type === "percentage_split") {
    const fleet = Math.round(net * model.fleetPercentage / 100);
    return { platform, net, fleet, driver: net - fleet };
  }
  const remaining = Math.max(0, Math.round((model.weeklyTargetZar - model.collectedZar) * 100));
  const fleet = Math.min(net, remaining);
  return { platform, net, fleet, driver: net - fleet };
}
assert.deepEqual(split(10000,{type:"percentage_split",fleetPercentage:40}),{platform:2500,net:7500,fleet:3000,driver:4500});
assert.deepEqual(split(10000,{type:"weekly_rental",weeklyTargetZar:50,collectedZar:20}),{platform:2500,net:7500,fleet:3000,driver:4500});
assert.deepEqual(split(10000,{type:"weekly_rental",weeklyTargetZar:50,collectedZar:50}),{platform:2500,net:7500,fleet:0,driver:7500});
assert.deepEqual(split(10000,{type:"weekly_rental",weeklyTargetZar:50,collectedZar:0}),{platform:2500,net:7500,fleet:5000,driver:2500});
console.log("Fleet split calculations passed.");
