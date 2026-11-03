const form = document.getElementById('booking-form');
const message = document.getElementById('message');
const container = document.getElementById('ordersContainer');
let currentQuote = null;
let quoteRequest;
let quoteMap;
let accountEpoch = 0;
let bookingBusy = false;
const quoteStatus = document.getElementById('quote-status');
const calculateButton = document.getElementById('calculate-route');
const localTime=value=>new Date(value).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})+' SAST';
const km = value => (Number(value)/1000).toLocaleString('en-ZA',{maximumFractionDigits:6});
function updateBookButton() {
  document.getElementById('submit').disabled = !ready || bookingBusy || !currentQuote || new Date(currentQuote.expires_at).getTime() <= Date.now() || document.body.dataset.guestPreview === 'true';
}
function resetQuote() {
  quoteRequest?.abort();quoteRequest=null;currentQuote=null;
  updatePaymentOptions();
  if (quoteMap) {quoteMap.stop();quoteMap.remove();quoteMap=null;}
  document.getElementById('quote-result').hidden=true;
  document.getElementById('quote-map').hidden=true;
  document.getElementById('quote-locations').textContent='';
  document.getElementById('quote-directions').removeAttribute('href');
  document.getElementById('priceBadge').textContent='Calculate fare';
  calculateButton.disabled=document.body.dataset.guestPreview==='true';
  quoteStatus.textContent='Enter both addresses and calculate the route to get your fare.';
  updateBookButton();
}
const mass=value=>Number(value).toLocaleString('en-ZA',{maximumFractionDigits:3});
const money = value => `R${Number(value).toFixed(2)}`;
let ready = false;
let loadVersion = 0;
const report = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
form.addEventListener('input', event => {if (['pickup','dropoff','weight','length','width','height'].includes(event.target.name)) resetQuote();});
form.addEventListener('change', event => {if (['weight','length','width','height'].includes(event.target.name)) resetQuote();});
function whatsapp(order) {
  const text = `*SWIFTHAUL SA DISPATCH*\n*Order:* ${order.waybill}\n*Pickup:* ${order.pickup}\n*Drop:* ${order.dropoff}\n*Recipient & notes:* ${order.recipient}\n*Vehicle:* ${order.vehicle.toUpperCase()}${order.load?.truckClass?' ('+order.load.truckClass+')':''}${order.load?'\n*Chargeable weight:* '+mass(order.load.chargeable)+' kg\n*Distance fee:* '+money(order.distance_fee)+'\n*Weight fee:* '+money(order.load.weightFee):''}\n*Outbound fee:* ${money(order.price)}\n*Payment:* ${order.paid_at?'Confirmed via '+order.payment_source:order.payment_source==='pay_later'?'Pay later':order.payment_method==='cash'?'Cash requested (unconfirmed)':'Arrange with dispatch'}${order.counter_offer?'\n*Counteroffer:* '+money(order.counter_offer)+' · '+order.counter_offer_status:''}${order.scheduled_at?'\n*Scheduled pickup:* '+localTime(order.scheduled_at):''}${order.return_address?'\n*Return request (separate quote):* '+order.return_address:''}${order.return_at?'\n*Requested return:* '+localTime(order.return_at):''}`;
  return `https://wa.me/27615083880?text=${encodeURIComponent(text)}`;
}
function addOrder(order, prepend = false) {
  for (const existing of container.querySelectorAll('.order')) {if (existing.dataset.waybill===order.waybill) existing.remove();}
  const card = document.createElement('article'); card.className = 'order'; card.dataset.waybill=order.waybill;
  const head = document.createElement('div'); head.className = 'order-head';
  const waybill = document.createElement('span'); waybill.className = 'waybill'; waybill.textContent = order.waybill;
  const status = document.createElement('span'); status.className = 'status'; status.textContent = order.refunded_at?'REFUNDED':order.completed_at?'COMPLETED':order.assigned_driver?'ASSIGNED':'UNASSIGNED';
  head.append(waybill, status);
  const route = document.createElement('p'); route.className = 'route'; route.textContent = `${order.pickup} → ${order.dropoff}`;
  const meta = document.createElement('div'); meta.className = 'order-meta';
  const pin = document.createElement('span'); pin.textContent = `Recipient PIN: ${order.pin} · Share only after delivery`;
  const fee = document.createElement('span'); fee.textContent = `${order.vehicle.toUpperCase()} · ${money(order.price)}`;
  meta.append(pin, fee);
  if (order.distance_meters != null) {const distance=document.createElement('span');distance.textContent=`${km(order.distance_meters)} km`;meta.append(distance);}
  const paymentInfo=document.createElement('p');paymentInfo.textContent=order.paid_at?'Payment confirmed · '+order.payment_source:order.payment_source==='pay_later'?'Pay later · repayment due in 7 days':order.payment_method==='cash'?'Payment: Cash requested · payment unconfirmed':'Payment: Arrange with dispatch · payment unconfirmed';card.append(paymentInfo);
  if(order.counter_offer){const offer=document.createElement('p');offer.textContent=`Counteroffer: ${money(order.counter_offer)} · ${order.counter_offer_status}. ${order.counter_offer_status==='pending'?'Original fare '+money(order.price)+' remains until company approval.':order.counter_offer_status==='accepted'?'Accepted fare '+money(order.price)+'. Original fare '+money(order.original_price)+'.':'Original fare '+money(order.price)+'.'}`;card.append(offer);}
  if(order.load) {const weight=document.createElement('p');weight.textContent=`${order.load.truckClass || order.vehicle.toUpperCase()} · ${mass(order.load.chargeable)} chargeable kg · Distance ${money(order.distance_fee)} + weight ${money(order.load.weightFee)}`;card.append(weight);}
  if(order.scheduled_at) {const time=document.createElement('p');time.textContent='Requested pickup: '+localTime(order.scheduled_at)+' · Awaiting dispatch confirmation';card.append(time);}
  if(order.return_address) {const ret=document.createElement('p');ret.textContent='Return requested: '+order.return_address+(order.return_at?' · '+localTime(order.return_at):'')+' · Separate quote pending';card.append(ret);}
  const actions = document.createElement('div'); actions.className = 'order-actions';
  const pdf = document.createElement('button'); pdf.type = 'button'; pdf.textContent = 'Download PDF Invoice'; pdf.addEventListener('click', () => downloadPDF(order));
  const wa = document.createElement('a'); wa.href = whatsapp(order); wa.target = '_blank'; wa.rel = 'noopener noreferrer'; wa.textContent = 'Send WhatsApp';
  const track = document.createElement('button'); track.type = 'button'; track.className = 'track-delivery'; track.textContent = 'Track Delivery'; track.addEventListener('click', () => {
    if (document.body.dataset.guestPreview !== 'true') document.dispatchEvent(new CustomEvent('delivery-route', {detail:{waybill:order.waybill,pickup:order.pickup,dropoff:order.dropoff}}));
  });
  if(!order.paid_at&&!order.refunded_at){for(const [label,action] of [['Pay with wallet','wallet-pay'],['Pay securely with Paystack','checkout'],['Pay later','pay-later']]){if(order.payment_source==='pay_later')continue;const pay=document.createElement('button');pay.type='button';pay.textContent=label;pay.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('wallet-payment',{detail:{action,waybill:order.waybill}})));actions.append(pay);}}
  actions.append(track, pdf, wa); card.append(head, route, meta, actions);
  if (prepend) container.prepend(card); else container.append(card);
}
async function loadOrders() {
  if (document.body.dataset.guestPreview === 'true') return;
  const version = ++loadVersion;
  document.getElementById('submit').disabled = true;
  document.getElementById('retry').hidden = true;
  try {
    const response = await fetch('/api/customer-bookings');
    const data = await response.json();
    if (version !== loadVersion) return;
    if (!response.ok) throw new Error(data.error);
    document.getElementById('legacy-import').hidden = !data.canImport;
    container.replaceChildren();
    data.orders.forEach(order => addOrder(order));
    if (!data.orders.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Your next delivery starts here. Submit a quote to create your first booking.'; container.append(empty);
    }
    ready = true; calculateButton.disabled=false; report('');
  } catch {
    if (version !== loadVersion) return;
    ready = false;
    container.replaceChildren();
    report('Unable to load bookings. Retry to reconnect.', true);
    document.getElementById('retry').hidden = false;
  } finally { if (version === loadVersion) updateBookButton(); }
}
document.getElementById('retry').addEventListener('click', loadOrders);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready || bookingBusy || document.body.dataset.guestPreview === 'true') return;
  if (!currentQuote || new Date(currentQuote.expires_at).getTime() <= Date.now()) {resetQuote();report('Calculate a fresh route quote before booking.',true);return;}
  const epoch=accountEpoch;
  const acceptedQuote=currentQuote;
  const data = Object.fromEntries(new FormData(form));
  if (['pickup', 'dropoff', 'recipient'].some(key => !data[key].trim())) { report('Enter pickup, drop-off and recipient details.', true); return; }
  // Open during the user gesture so browsers can permit the WhatsApp tab.
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  const submit = document.getElementById('submit'); bookingBusy=true; submit.disabled = true; report('Saving your booking…');
  try {
    const response = await fetch('/api/customer-bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({quote_id:acceptedQuote.id,recipient:data.recipient,payment_method:data.payment_method,counter_offer:data.counter_offer || null,scheduled_at:data.scheduled_at ? data.scheduled_at+':00+02:00' : null,return_address:data.return_address || null,return_at:data.return_at ? data.return_at+':00+02:00' : null,pickup_latitude:data.pickup_latitude?Number(data.pickup_latitude):null,pickup_longitude:data.pickup_longitude?Number(data.pickup_longitude):null,pickup_plus_code:data.pickup_plus_code||null,pickup_geohash:data.pickup_geohash||null,dropoff_latitude:data.dropoff_latitude?Number(data.dropoff_latitude):null,dropoff_longitude:data.dropoff_longitude?Number(data.dropoff_longitude):null,dropoff_plus_code:data.dropoff_plus_code||null,dropoff_geohash:data.dropoff_geohash||null}) });
    const result = await response.json();
    if (epoch !== accountEpoch) {popup?.close();return;}
    if (!response.ok) {if (response.status===409) resetQuote();throw new Error(result.error || 'Unable to save your booking. Please try again.');}
    container.querySelector('.empty')?.remove(); addOrder(result.order, true);
    report('Booking saved. Send the prepared message in WhatsApp, or use Send WhatsApp below.');
    if (popup) popup.location.replace(whatsapp(result.order));
    resetQuote();
  } catch (error) {
    if (popup) popup.close();
    if (epoch!==accountEpoch) return;
    report(error instanceof Error ? error.message : 'Unable to save your booking.', true);
  } finally { bookingBusy=false;updateBookButton(); }
});
function downloadPDF(order) {
  if (!window.jspdf?.jsPDF) { report('PDF library is unavailable. Check your connection and try again.', true); return; }
  try {
    const doc = new window.jspdf.jsPDF();
    let y = 20;
    const line = (text, size = 10) => {
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(String(text), 180);
      lines.forEach(part => { if (y > 277) { doc.addPage(); y = 20; } doc.text(part, 14, y); y += size * 0.5 + 2; });
      y += 4;
    };
    line('SWIFTHAUL SA', 18); line('DELIVERY INVOICE', 13);
    line(`Waybill: ${order.waybill}`);
    line(`Issued: ${new Date(order.created_at).toLocaleDateString('en-ZA')}`);
    line(`Pickup: ${order.pickup}`); line(`Drop-off: ${order.dropoff}`);
    if (order.distance_meters != null) line(`Mapped driving distance: ${km(order.distance_meters)} km`);
    line(`Recipient and notes: ${order.recipient}`); line(`Vehicle: ${order.vehicle.toUpperCase()}`);
    if(order.load) {line(`Actual: ${mass(order.load.weight)} kg; volumetric: ${mass(order.load.volumetric)} kg; chargeable: ${mass(order.load.chargeable)} kg`);line(`Packed dimensions: ${order.load.length} x ${order.load.width} x ${order.load.height} cm; divisor 5000`);line(`Vehicle class: ${order.load.truckClass || order.vehicle}`);line(`Distance fee: ${money(order.distance_fee)}; extra weight: ${mass(order.load.extra)} kg at ${money(order.load.rate)}/kg = ${money(order.load.weightFee)}`);}
    if(order.scheduled_at) line('Requested pickup: '+localTime(order.scheduled_at));
    if(order.return_address) line('Return request (separate quote, excluded from total): '+order.return_address+(order.return_at?' at '+localTime(order.return_at):''));
    line(`Acceptance PIN: ${order.pin}`); line(`Fare: ${money(order.price)} ZAR`, 13);
    line('Payment option: '+(order.payment_method==='cash'?'Cash requested':'Arrange with dispatch'));
    if(order.counter_offer)line('Counteroffer: '+money(order.counter_offer)+'; status: '+order.counter_offer_status+(order.counter_offer_status==='pending'?'. Original fare remains pending company approval.':'.'));
    line('Payment status: '+(order.paid_at?'Confirmed via '+order.payment_source:order.payment_source==='pay_later'?'Pay later; repayment due':'Not confirmed'));
    if(order.original_price)line('Original quoted fare before accepted counteroffer: '+money(order.original_price));
    line('VAT registration and tax details have not been supplied. This document is not a VAT tax invoice.', 9);
    line('Dispatch: +27 61 508 3880');
    doc.save(`Invoice_${order.waybill}.pdf`);
  } catch { report('The PDF could not be generated. Please try again.', true); }
}
document.addEventListener('account-ready', () => {calculateButton.disabled=false;loadOrders();});
document.addEventListener('account-cleared', () => {accountEpoch++;loadVersion++; ready = false;form.reset();toggleBookingOptions();previewLoad();resetQuote(); container.replaceChildren(); document.getElementById('legacy-import').hidden=true; document.getElementById('submit').disabled = true;});

document.getElementById('import-bookings').addEventListener('click', async event => {
  if (document.body.dataset.guestPreview === 'true') return;
  const button = event.currentTarget;button.disabled = true;
  try {
    const response = await fetch('/api/import-browser-bookings',{method:'POST'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to import bookings.');
    await loadOrders();report(`${data.imported} booking(s) moved to your account.`);
  } catch (error) {report(error.message || 'Unable to import bookings.',true);}
  finally {button.disabled = false;}
});

document.addEventListener('guest-preview', () => {
  resetQuote();calculateButton.disabled=true;quoteStatus.textContent='Guest preview: sign in to calculate mapped kilometres and your fare.';
  loadVersion++;
  ready = false;
  document.getElementById('submit').disabled = true;
  document.getElementById('retry').hidden = true;
  document.getElementById('legacy-import').hidden = true;
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = 'Your bookings appear here after you sign in. Preview vehicle choices and prices without creating a delivery.';
  container.replaceChildren(empty);
  report('Guest preview: sign in to save a booking, send delivery details or download invoices.');
});

calculateButton.addEventListener('click', async () => {
  if (document.body.dataset.guestPreview === 'true') return;
  if (!form.elements.pickup.reportValidity() || !form.elements.dropoff.reportValidity()) return;
  if(['weight','length','width','height'].some(key=>!form.elements.namedItem(key).reportValidity()))return;
  const data=Object.fromEntries(new FormData(form));
  if (!data.pickup.trim() || !data.dropoff.trim()) {quoteStatus.textContent='Enter both pickup and drop-off addresses.';return;}
  resetQuote();const active=new AbortController();quoteRequest=active;calculateButton.disabled=true;
  quoteStatus.textContent='Mapping the addresses and calculating your fare…';
  try {
    const response=await fetch('/api/delivery-quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pickup:data.pickup,dropoff:data.dropoff,pickup_location:data.pickup_latitude?{latitude:Number(data.pickup_latitude),longitude:Number(data.pickup_longitude)}:null,dropoff_location:data.dropoff_latitude?{latitude:Number(data.dropoff_latitude),longitude:Number(data.dropoff_longitude)}:null,parcel:Object.fromEntries(['weight','length','width','height'].map(key=>[key,Number(data[key])]))}),signal:active.signal,cache:'no-store'});
    const result=await response.json();
    if (quoteRequest!==active || active.signal.aborted) return;
    if (!response.ok) throw new Error(result.error || 'Unable to calculate the route.');
    currentQuote=result.quote;updatePaymentOptions();const route=currentQuote.route;
    document.getElementById('quote-result').hidden=false;
    document.getElementById('quote-distance').textContent=`${km(route.distance)} km`;
    document.getElementById('quote-price').textContent=money(currentQuote.price);
    document.getElementById('priceBadge').textContent=money(currentQuote.price);
    document.getElementById('quote-band').textContent=`Fare band: ${currentQuote.band*12} km to below ${(currentQuote.band+1)*12} km. Every new 12 km band doubles the fare.`;
    document.getElementById('quote-locations').textContent=`Pickup: ${route.pickup.label}. Drop-off: ${route.dropoff.label}.`;
    document.getElementById('truck-route-note').hidden=currentQuote.vehicle!=='truck';
    document.getElementById('quote-load').textContent=`${currentQuote.load.truckClass || currentQuote.vehicle.toUpperCase()} selected · Actual ${mass(currentQuote.load.weight)} kg · Volumetric ${mass(currentQuote.load.volumetric)} kg · Chargeable ${mass(currentQuote.load.chargeable)} kg. Includes ${currentQuote.load.included} kg.`;
    document.getElementById('quote-breakdown').textContent=`Distance ${money(currentQuote.distanceFee)} + extra weight ${mass(currentQuote.load.extra)} kg × ${money(currentQuote.load.rate)}/kg = ${money(currentQuote.load.weightFee)}. Outbound total ${money(currentQuote.price)}.`;
    const directions=new URL('https://www.google.com/maps/dir/');directions.search=new URLSearchParams({api:'1',origin:data.pickup,destination:data.dropoff,travelmode:'driving'}).toString();
    document.getElementById('quote-directions').href=directions.href;
    const note=document.getElementById('quote-map-note');note.textContent='Planned road route. Live driver location is not included.';
    try {quoteMap=window.renderDeliveryMap(document.getElementById('quote-map'),route,()=>{note.textContent='Some map tiles could not load. Use the directions link to verify your locations.';});}
    catch {document.getElementById('quote-map').hidden=true;note.textContent='The map could not load. Check the matched addresses above or open Google Maps.';}
    quoteStatus.textContent='Route calculated. Review the matched locations and fare before booking.';
    updateBookButton();
  } catch(error) {if (!active.signal.aborted && quoteRequest===active) quoteStatus.textContent=error.message || 'Unable to calculate the quote. Please try again.';}
  finally {if (quoteRequest===active) calculateButton.disabled=false;}
});

function toggleBookingOptions(){
  const scheduled=document.getElementById('schedule-later').checked;
  const returning=document.getElementById('request-return').checked;
  document.getElementById('schedule-field').hidden=!scheduled;
  form.elements.scheduled_at.disabled=!scheduled;form.elements.scheduled_at.required=scheduled;
  document.getElementById('return-fields').hidden=!returning;
  form.elements.return_address.disabled=!returning;form.elements.return_address.required=returning;
  form.elements.return_at.disabled=!returning;
}
document.getElementById('schedule-later').addEventListener('change',toggleBookingOptions);
document.getElementById('request-return').addEventListener('change',toggleBookingOptions);
toggleBookingOptions();

function previewLoad(){
  const values=['weight','length','width','height'].map(key=>Number(form.elements.namedItem(key).value));
  let vehicle='',text='Add weight and dimensions to find your vehicle.';
  if(values.every(value=>Number.isFinite(value)&&value>0)){
    const [weight,length,width,height]=values,volumetric=length*width*height/5000,chargeable=Math.max(weight,volumetric);
    if(chargeable>8000)text='Above 8,000 chargeable kg: contact dispatch for a manual quote.';
    else{vehicle=chargeable<=20?'bike':chargeable<=1000?'van':'truck';const label=vehicle==='truck'?(chargeable<=4000?'4-ton Truck':'8-ton Truck'):vehicle.toUpperCase();text=`${label} recommended · ${mass(chargeable)} chargeable kg (actual ${mass(weight)} kg; volumetric ${mass(volumetric)} kg). Physical cargo fit and access require dispatch confirmation.`;}
  }
  form.querySelectorAll('[name=vehicle]').forEach(input=>{input.checked=input.value===vehicle;});
  document.getElementById('load-summary').textContent=text;
}
form.addEventListener('input',event=>{if(['weight','length','width','height'].includes(event.target.name))previewLoad();});
previewLoad();

function updatePaymentOptions(){
  const distance=currentQuote?.route.distance;
  const cash=Number.isFinite(distance)&&distance<12000;
  const counter=Number.isFinite(distance)&&distance<24000;
  document.getElementById('cash-payment-option').disabled=!cash;
  if(!cash)form.elements.payment_method.value='dispatch';
  const checkbox=document.getElementById('make-counter-offer');checkbox.disabled=!counter;
  if(!counter)checkbox.checked=false;
  const show=counter&&checkbox.checked;
  document.getElementById('counter-offer-field').hidden=!show;
  document.getElementById('counter-offer-note').hidden=!show;
  form.elements.counter_offer.disabled=!show;form.elements.counter_offer.required=show;
  if(!show)form.elements.counter_offer.value='';
  document.getElementById('payment-eligibility').textContent=!currentQuote?'Calculate a route to check cash and counteroffer eligibility.':cash?'Cash or payment through dispatch is available. You may submit a counteroffer for company approval.':counter?'Arrange payment through dispatch. You may submit a counteroffer for company approval.':'Arrange payment through dispatch. Cash and counteroffers are unavailable for this distance.';
}
document.getElementById('make-counter-offer').addEventListener('change',updatePaymentOptions);
updatePaymentOptions();

document.addEventListener('wallet-updated',loadOrders);
