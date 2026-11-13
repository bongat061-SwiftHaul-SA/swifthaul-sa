const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');

const customerHtml = read('public/customer.html');
const customerAuth = read('public/auth.js');
const picker = read('public/location-picker.js');
const autocomplete = read('public/address-autocomplete.js');
const customerLogic = read('public/customer.js');
const driverMap = read('apps/driver/public/map.html');

const mapLib = customerHtml.indexOf('maplibre-gl@5.6.2/dist/maplibre-gl.js');
const plusCodeLib = customerHtml.indexOf('openlocationcode/1.0.5/openlocationcode.min.js');
const pickerScript = customerHtml.indexOf('src="location-picker.js');
assert(mapLib >= 0 && plusCodeLib > mapLib && pickerScript > plusCodeLib,
  'Customer page must load MapLibre and Open Location Code before its pin picker');

assert.match(customerAuth, /const field = name => form.elements.namedItem\(name\);[\s\S]*?const email = field\('email'\)[\s\S]*?email\.closest\('label'\)\.hidden = reset \|\| pinLogin/,
  'Customer PIN quick sign-in must hide the email field using the safe named-control lookup');
assert.match(customerAuth, /rememberedCustomerEmail\(\)[\s\S]*email: pinAccountEmail/,
  'Customer PIN quick sign-in must use the remembered account on this device');
assert.match(customerAuth, /For your first sign-in on this device, use your email and password/,
  'A new device must direct the customer to password sign-in before PIN setup');

assert.match(customerAuth, /if \(!data\.session\)[\s\S]*Check your email to confirm it, then sign in/,
  'Email signup must explain confirmation before the authenticated workspace opens');
assert.match(customerAuth, /authScreen\.hidden = true; workspace\.hidden = false;/,
  'A validated customer account must reveal the workspace');
assert.match(customerAuth, /dispatchEvent\(new CustomEvent\('account-ready'/,
  'Customer auth must announce successful account validation');

assert.match(picker, /new MutationObserver/,
  'The customer pin map must wait for the hidden authenticated workspace to open');
assert.match(picker, /new ResizeObserver/,
  'The map must resize after the authenticated workspace becomes visible');
assert.match(picker, /map\.on\('click',[\s\S]*saveLocation\(activeField,event\.lngLat\.lat,event\.lngLat\.lng/,
  'Tapping the map must save the selected pickup/drop-off pin');
assert.match(picker, /marker\.on\('dragend'/,
  'The selected pin marker must remain draggable');
assert.match(picker, /latitude:lat,longitude:lng,plus_code:plusCode,geohash:geohash\(lat,lng\)/,
  'Pin selection must save coordinates, Plus Code and Geohash');
assert.match(picker, /style\.load',[\s\S]*placeMarker\(key,state\[key\]\.lat,state\[key\]\.lng\)/,
  'Pins selected while map tiles load must be restored after the map style loads');
assert.match(autocomplete, /window\.swiftHaulShowAddressOnMap\?\.\(input,lat,lng\)/,
  'Choosing an address suggestion must position the map pin');
assert.match(customerLogic, /pickup_latitude:data\.pickup_latitude[\s\S]*dropoff_longitude:data\.dropoff_longitude/,
  'Booking submission must send the confirmed pickup and drop-off coordinates');

assert.match(driverMap, /openlocationcode\/1\.0\.5\/openlocationcode\.min\.js/,
  'Driver map must load the Plus Code library');
assert.match(driverMap, /map\.on\('click',event=>placePin\(activePin,/,
  'Driver map taps must place a pin');
assert.match(driverMap, /OpenLocationCode\?\.encode/,
  'Driver map must show a Plus Code for the selected pin');

process.stdout.write('Customer signup-to-pin and Driver map pin static checks passed.\\n');
