const fs=require('node:fs');const assert=require('node:assert/strict');
const driver=fs.readFileSync('apps/driver/public/account-settings.js','utf8');
const customer=fs.readFileSync('public/settings.js','utf8');
const driverEdge=fs.readFileSync('supabase/functions/driver-settings/index.ts','utf8');
const customerEdge=fs.readFileSync('supabase/functions/customer-settings/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20261111123000_driver_account_self_service.sql','utf8');
for(const source of [driver,customer]){assert.match(source,/updateUser\(\{email:/);assert.match(source,/updateUser\(\{password:/);}
assert.match(driver,/driver-settings/);assert.match(driver,/blob\.size>2\*1024\*1024/);assert.match(driver,/Upload \/ replace picture/);assert.match(driver,/Submit deletion request/);
assert.match(customer,/updateUser\(\{email:/);assert.match(customer,/signInWithPassword\(\{email:data\.user\.email,password:f\.elements\.current_password\.value\}\)/);assert.match(customer,/blob\.size>2\*1024\*1024/);assert.match(customer,/Profile picture uploaded/);
assert.match(driverEdge,/auth\.getUser\(token\)/);assert.match(driverEdge,/driver-profile-photos/);assert.match(driverEdge,/account_deletion_requests/);
assert.match(customerEdge,/account_deletion_requests/);
assert.match(migration,/unique\(user_id, app_type, status\)/);
process.stdout.write('Customer and Driver account self-service checks passed.\\n');
