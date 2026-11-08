const form = document.getElementById('booking-form');
const message = document.getElementById('message');
const container = document.getElementById('ordersContainer');
let currentQuote = null;
let quoteRequest;
let quoteMap;
let accountEpoch = 0;
let bookingBusy = false;
let walletAvailableCents = 0;
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
async function customerFunctionError(error, fallback) {
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      const detail = payload?.error || payload?.message || payload?.msg;
      if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 240);
    } catch {}
    if (Number.isInteger(response.status) && response.status > 0)
      return `${fallback} (HTTP ${response.status}).`;
  }
  return error?.message || fallback;
}
async function customerApi(method, body) {
  const client = window.swiftHaulSupabase;
  if (!client) throw new Error('Customer sign-in connection is unavailable. Reload the page.');
  const { data, error } = await client.functions.invoke('customer-portal', { method, ...(body ? { body } : {}) });
  if (error) throw new Error(await customerFunctionError(error, 'Customer service is unavailable.'));
  if (data?.error) throw new Error(data.error);
  return data;
}
let ready = false;
let loadVersion = 0;
let refundRequestsByWaybill = new Map();
let eftPaymentsByWaybill = new Map();
const report = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
form.addEventListener('input', event => {if(['pickup','dropoff'].includes(event.target.name)){for(const suffix of ['latitude','longitude']){const hidden=form.elements.namedItem(event.target.name+'_'+suffix);if(hidden)hidden.value='';}const picker=event.target.nextElementSibling;if(picker?.matches('button'))picker.textContent='Pick / copy pin';}if (['pickup','dropoff','weight','length','width','height'].includes(event.target.name)) resetQuote();});
form.addEventListener('change', event => {if (['weight','length','width','height'].includes(event.target.name)) resetQuote();});
function whatsapp(order) {
  const text = `*SWIFTHAUL SA DISPATCH*\n*Order:* ${order.waybill}\n*Pickup:* ${order.pickup}\n*Drop:* ${order.dropoff}\n*Recipient & notes:* ${order.recipient}\n*Vehicle:* ${order.vehicle.toUpperCase()}${order.load?.truckClass?' ('+order.load.truckClass+')':''}${order.load?'\n*Chargeable weight:* '+mass(order.load.chargeable)+' kg\n*Distance fee:* '+money(order.distance_fee)+'\n*Weight fee:* '+money(order.load.weightFee):''}\n*Outbound fee:* ${money(order.price)}\n*Payment:* ${order.paid_at?'Confirmed via '+order.payment_source:order.payment_source==='pay_later'?'Pay later':order.payment_method==='cash'?'Cash requested (unconfirmed)':'Arrange with dispatch'}${order.counter_offer?'\n*Counteroffer:* '+money(order.counter_offer)+' · '+order.counter_offer_status:''}${order.scheduled_at?'\n*Scheduled pickup:* '+localTime(order.scheduled_at):''}${order.return_address?'\n*Return request (separate quote):* '+order.return_address:''}${order.return_at?'\n*Requested return:* '+localTime(order.return_at):''}`;
  return `https://wa.me/27615083880?text=${encodeURIComponent(text)}`;
}
function addOrder(order, prepend = false) {
  for (const existing of container.querySelectorAll('.order')) {if (existing.dataset.waybill===order.waybill) existing.remove();}
  const card = document.createElement('article'); card.className = 'order';
  card.dataset.deliveryStatus = order.status || ''; card.dataset.waybill=order.waybill;
  const head = document.createElement('div'); head.className = 'order-head';
  const waybill = document.createElement('span'); waybill.className = 'waybill'; waybill.textContent = order.waybill;
  const status = document.createElement('span'); status.className = 'status'; status.textContent = order.refunded_at?'REFUNDED':order.completed_at?'COMPLETED':order.assigned_driver?'ASSIGNED':'UNASSIGNED';
  head.append(waybill, status);
  const route = document.createElement('p'); route.className = 'route'; route.textContent = `${order.pickup} → ${order.dropoff}`;
  for (const [kind,label] of [['pickup','Pickup'],['dropoff','Drop-off']]) {
    const lat=order[kind+'_latitude'],lng=order[kind+'_longitude'];
    if (lat==null || lng==null) continue;
    const location=document.createElement('p');
    location.textContent=label+' coordinates: '+Number(lat).toFixed(6)+', '+Number(lng).toFixed(6);
    card.append(location);
    if(lat!=null&&lng!=null){const mapLink=document.createElement('a');mapLink.href='https://www.google.com/maps?q='+encodeURIComponent(lat+','+lng);mapLink.target='_blank';mapLink.rel='noopener noreferrer';mapLink.textContent='Open '+label.toLowerCase()+' pin in Maps ↗';card.append(mapLink);}
  }
  const meta = document.createElement('div'); meta.className = 'order-meta';
  const pin = document.createElement('span'); pin.textContent = `Recipient PIN: ${order.pin} · Share only after delivery`;
  const fee = document.createElement('span'); fee.textContent = `${order.vehicle.toUpperCase()} · ${money(order.price)}`;
  meta.append(pin, fee);
  if (order.distance_meters != null) {const distance=document.createElement('span');distance.textContent=`${km(order.distance_meters)} km`;meta.append(distance);}
  if(order.assistance_requested){const handling=document.createElement('p');handling.textContent='Optional handling assistance requested · '+(Number(order.assistance_minutes)||0)+' minutes · '+money((Number(order.assistance_fee_cents)||0)/100)+' · '+String(order.assistance_status||'pending dispatch confirmation').replaceAll('_',' ');card.append(handling);}
  const eftPayment=eftPaymentsByWaybill.get(order.waybill);
  const paymentInfo=document.createElement('p');
  paymentInfo.textContent=order.paid_at?'Payment confirmed · '+order.payment_source:
    eftPayment?.status==='submitted'?'EFT proof submitted · awaiting bank verification · Reference '+eftPayment.payment_reference:
    eftPayment?.status==='verified'?'EFT payment verified · Reference '+eftPayment.payment_reference:
    eftPayment?.status==='rejected'?'EFT proof rejected · '+(eftPayment.rejection_reason||'Please submit a new proof'):
    order.payment_source==='pay_later'?'Pay later · repayment due in 7 days':
    order.payment_source==='wallet'?'Paid from SwiftHaul wallet · Refund '+money((order.wallet_refund_used||0)/100)+' + promotional '+money((order.wallet_promo_used||0)/100):
    order.payment_method==='cash'?'Payment: Cash requested · payment unconfirmed':
    order.payment_method==='eft'?'Payment: EFT · awaiting proof':'Payment: Arrange with dispatch · payment unconfirmed';
  card.append(paymentInfo);
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
  if(!order.paid_at&&!order.refunded_at&&!['cancelled'].includes(order.status)&&eftPayment?.status!=='submitted'&&eftPayment?.status!=='verified'){
    const eft=document.createElement('button');eft.type='button';eft.textContent=eftPayment?.status==='rejected'?'Resubmit EFT proof':'Pay by EFT / submit proof';
    eft.addEventListener('click',()=>{
      const box=document.createElement('div');box.className='eft-instructions';
      const heading=document.createElement('strong');heading.textContent='EFT payment';
      const info=document.createElement('p');info.textContent='Use booking reference '+order.waybill+' as your bank transfer reference. Request the verified SwiftHaul bank details from dispatch before paying. The booking remains unpaid until an administrator checks the bank statement.';
      const contact=document.createElement('a');contact.href='https://wa.me/27615083880?text='+encodeURIComponent('Please send verified EFT payment details for booking '+order.waybill+'.');contact.target='_blank';contact.rel='noopener noreferrer';contact.textContent='Request verified bank details on WhatsApp';
      const reference=document.createElement('input');reference.type='text';reference.maxLength=100;reference.placeholder='Your bank transfer reference (optional)';reference.setAttribute('aria-label','Your bank transfer reference');
      const file=document.createElement('input');file.type='file';file.accept='application/pdf,image/jpeg,image/png';file.setAttribute('aria-label','Proof of payment PDF or image');
      const send=document.createElement('button');send.type='button';send.textContent='Submit proof of payment';
      const note=document.createElement('p');note.className='subtle';note.textContent='PDF, JPG or PNG · maximum 8 MB. Never upload card details or banking passwords.';
      send.addEventListener('click',async()=>{
        const selected=file.files?.[0];
        if(!selected){report('Choose your EFT proof document first.',true);return;}
        if(!['application/pdf','image/jpeg','image/png'].includes(selected.type)||selected.size>8*1024*1024){report('Use a PDF, JPG or PNG file no larger than 8 MB.',true);return;}
        const client=window.swiftHaulSupabase;if(!client){report('Secure account connection unavailable. Reload and try again.',true);return;}
        send.disabled=true;report('Uploading proof securely…');
        let objectPath=null;
        try{
          const {data:{user},error:userError}=await client.auth.getUser();if(userError||!user)throw new Error('Please sign in again before submitting proof.');
          const ext=selected.type==='application/pdf'?'pdf':selected.type==='image/png'?'png':'jpg';
          objectPath=user.id+'/'+order.waybill+'/'+crypto.randomUUID()+'.'+ext;
          const {error:uploadError}=await client.storage.from('customer-eft-proofs').upload(objectPath,selected,{upsert:false,contentType:selected.type});
          if(uploadError)throw uploadError;
          const {data,error}=await client.rpc('submit_customer_eft_proof',{p_waybill:order.waybill,p_proof_object_path:objectPath,p_customer_reference:reference.value.trim()||null});
          if(error)throw error;
          await loadOrders();
          report(data?.already_submitted?'An EFT proof is already awaiting verification.':'EFT proof submitted. Your booking remains unpaid until the bank receipt is verified.');
        }catch(error){report(error?.message||'Unable to submit EFT proof. Please try again.',true);send.disabled=false;}
      });
      box.append(heading,info,contact,reference,file,note,send);eft.replaceWith(box);
    });
    actions.append(eft);
  }
  const existingRefund = refundRequestsByWaybill.get(order.waybill);
  if (existingRefund) {
    const refundStatus=document.createElement('p');
    refundStatus.textContent='Cancellation/refund request: '+existingRefund.status.replaceAll('_',' ');
    card.append(refundStatus);
  } else if (!order.refunded_at && ['pending','assigned','accepted','failed','cancelled'].includes(order.status)) {
    const requestType=['pending','assigned','accepted'].includes(order.status)?'cancellation':'refund';
    const requestButton=document.createElement('button');requestButton.type='button';
    requestButton.textContent=requestType==='cancellation'?'Request cancellation':'Request refund';
    requestButton.addEventListener('click',async()=>{
      const reasonInput=document.createElement('input');reasonInput.type='text';reasonInput.maxLength=1000;
      reasonInput.placeholder='Reason for your request';reasonInput.setAttribute('aria-label','Reason for your request');
      const send=document.createElement('button');send.type='button';send.textContent='Submit request';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Keep booking';
      const formBox=document.createElement('div');formBox.className='order-actions';formBox.append(reasonInput,send,cancel);
      requestButton.replaceWith(formBox);cancel.addEventListener('click',()=>formBox.replaceWith(requestButton));
      send.addEventListener('click',async()=>{
        if(reasonInput.value.trim().length<3){report('Please enter a reason of at least 3 characters.',true);return;}
        send.disabled=true;report('Submitting your request…');
        try{const result=await customerApi('POST',{action:'refund_request',waybill:order.waybill,request_type:requestType,reason:reasonInput.value.trim()});
          if(result.request)refundRequestsByWaybill.set(order.waybill,result.request);
          await loadOrders();report('Your request has been submitted.');
        }catch(error){report(error instanceof Error?error.message:'Unable to submit request.',true);send.disabled=false;}
      });
    });actions.append(requestButton);
  }
  actions.append(track, pdf, wa); card.append(head, route, meta, actions);
  if (prepend) container.prepend(card); else container.append(card);
}


async function loadOrders() {
  if (document.body.dataset.guestPreview === 'true') return;
  const version = ++loadVersion;
  walletAvailableCents = 0;
  updatePaymentOptions();
  document.getElementById('submit').disabled = true;
  document.getElementById('retry').hidden = true;
  try {
    const data = await customerApi('GET');
    if (version !== loadVersion) return;
    document.getElementById('legacy-import').hidden = !data.canImport;
    container.replaceChildren();
    refundRequestsByWaybill = new Map((data.refundRequests || []).map(request => [request.waybill, request]));
    eftPaymentsByWaybill = new Map((data.eftPayments || []).map(payment => [payment.waybill, payment]));
    data.orders.forEach(order => addOrder(order));
    walletAvailableCents = Number(data.wallet?.available_cents) || 0;
    updatePaymentOptions();
    if (!data.orders.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Your next delivery starts here. Submit a quote to create your first booking.'; container.append(empty);
    }
    ready = true; calculateButton.disabled=false; report('');
  } catch (error) {
    if (version !== loadVersion) return;
    ready = false;
    container.replaceChildren();
    const detail = error instanceof Error ? error.message : 'Customer service is unavailable.';
    report(`Unable to load bookings: ${detail} Retry to reconnect.`, true);
    document.getElementById('retry').hidden = false;
  } finally { if (version === loadVersion) updateBookButton(); }
}
document.getElementById('retry').addEventListener('click', loadOrders);
const assistanceRequested=document.getElementById('assistance-requested');
const assistanceOptions=document.getElementById('assistance-options');
const assistanceBlocks=document.getElementById('assistance-blocks');
const assistancePrice=document.getElementById('assistance-price');
function assistanceQuote(){
  if(!assistanceRequested?.checked){assistanceOptions.hidden=true;return {requested:false,minutes:0,fee:0};}
  assistanceOptions.hidden=false;
  const blocks=Math.min(4,Math.max(1,Number(assistanceBlocks.value)||1));
  if(!currentQuote){assistancePrice.textContent='Calculate your vehicle quote first.';return {requested:true,minutes:blocks*30,fee:0};}
  if(currentQuote.vehicle==='bike'){assistancePrice.textContent='Bike deliveries do not offer lifting assistance.';return {requested:true,minutes:blocks*30,fee:0};}
  const van=currentQuote.vehicle==='van',base=van?180:350,extra=van?100:180,fee=base+(blocks-1)*extra;
  assistancePrice.textContent=(van?'1 helper':'2 helpers')+' · '+(blocks*30)+' minutes · '+money(fee)+' proposed assistance fee. Dispatch confirmation required.';
  return {requested:true,minutes:blocks*30,fee};
}
assistanceRequested?.addEventListener('change',()=>{const q=assistanceQuote();if(q.requested&&currentQuote?.vehicle==='bike')assistanceRequested.checked=false;});
assistanceBlocks?.addEventListener('change',assistanceQuote);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready || bookingBusy || document.body.dataset.guestPreview === 'true') return;
  if (!currentQuote || new Date(currentQuote.expires_at).getTime() <= Date.now()) {resetQuote();report('Calculate a fresh route quote before booking.',true);return;}
  const epoch=accountEpoch;
  const acceptedQuote=currentQuote;
  const termsAcknowledgement=document.getElementById('booking-terms-accepted');
  if(!termsAcknowledgement?.checked){termsAcknowledgement?.focus();report('Please read and acknowledge the customer protection and handling terms before booking.',true);return;}
  const data = Object.fromEntries(new FormData(form));
  const assistance=assistanceQuote();
  if(assistance.requested && (!assistance.fee || acceptedQuote.vehicle==='bike')){report('Optional assistance requires a van or truck quote. Please update your vehicle/load or contact dispatch.',true);return;}
  if (['pickup', 'dropoff', 'recipient'].some(key => !data[key].trim())) { report('Enter pickup, drop-off and recipient details.', true); return; }
  const submit = document.getElementById('submit'); bookingBusy=true; submit.disabled = true; report('Saving your booking…');
  try {
    const result = await customerApi('POST', {action:'book',terms_accepted:true,terms_version:'2026-11-07-dispatch-cover-draft',quote_id:acceptedQuote.id,assistance_requested:assistance.requested,assistance_minutes:assistance.minutes,assistance_fee_cents:Math.round(assistance.fee*100),recipient:data.recipient,payment_method:data.payment_method,counter_offer:data.counter_offer || null,scheduled_at:data.scheduled_at ? data.scheduled_at+':00+02:00' : null,return_address:data.return_address || null,return_at:data.return_at ? data.return_at+':00+02:00' : null,pickup_latitude:data.pickup_latitude?Number(data.pickup_latitude):null,pickup_longitude:data.pickup_longitude?Number(data.pickup_longitude):null,dropoff_latitude:data.dropoff_latitude?Number(data.dropoff_latitude):null,dropoff_longitude:data.dropoff_longitude?Number(data.dropoff_longitude):null});
    if (epoch !== accountEpoch) return;
    if (!result.order) throw new Error('Unable to save your booking. Please try again.');
    container.querySelector('.empty')?.remove(); addOrder(result.order, true);
    report('Booking created. Choose cash (if eligible) or EFT instructions below. WhatsApp sharing is a separate action.');
    resetQuote();
  } catch (error) {
    if (epoch!==accountEpoch) return;
    const reason = error instanceof Error ? error.message : 'Unable to save your booking.';
    if (reason === 'quote_expired_recalculate_route' || reason === 'quote_not_found_recalculate_route') {
      report('Your quote is no longer available. I’m refreshing the route and fare now. Review the new total, then tap Book again.', true);
      calculateButton.click();
    } else report(reason, true);
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
document.addEventListener('account-ready', () => {
  calculateButton.disabled=false;loadOrders();
  const params=new URLSearchParams(location.search), payment=params.get('payment');
  if(payment==='return'||payment==='cancel') report('Card payments are currently unavailable. Choose EFT or eligible cash for your booking.');
  if(payment){history.replaceState({},'',location.pathname+location.hash);}
});
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
  if(!Number(form.elements.namedItem('weight')?.value)||['length','width','height'].some(key=>!form.elements.namedItem(key).reportValidity())){quoteStatus.textContent='Add a photo or description, estimate your load, then review the suggested dimensions.';return;}
  const data=Object.fromEntries(new FormData(form));
  if (!data.pickup.trim() || !data.dropoff.trim()) {quoteStatus.textContent='Enter both pickup and drop-off addresses.';return;}
  resetQuote();const active=new AbortController();quoteRequest=active;calculateButton.disabled=true;
  quoteStatus.textContent='Mapping the addresses and calculating your fare…';
  try {
    const result=await customerApi('POST',{action:'quote',pickup:data.pickup,dropoff:data.dropoff,pickup_location:data.pickup_latitude?{latitude:Number(data.pickup_latitude),longitude:Number(data.pickup_longitude)}:null,dropoff_location:data.dropoff_latitude?{latitude:Number(data.dropoff_latitude),longitude:Number(data.dropoff_longitude)}:null,parcel:Object.fromEntries(['weight','length','width','height'].map(key=>[key,Number(data[key])]))});
    if (quoteRequest!==active || active.signal.aborted) return;
    if (!result.quote) throw new Error('Unable to calculate the route.');
    currentQuote=result.quote;assistanceQuote();updatePaymentOptions();window.swiftHaulUpdateVehiclePreview?.(currentQuote.vehicle,currentQuote.load?.chargeable,currentQuote.load?.truckClass || (currentQuote.vehicle||'').toUpperCase());const route=currentQuote.route;window.swiftHaulSetRoadRoute?.(route);
    document.getElementById('quote-result').hidden=false;
    document.getElementById('quote-distance').textContent=`${km(route.distance)} km`;
    document.getElementById('quote-price').textContent=money(currentQuote.price);
    document.getElementById('priceBadge').textContent=money(currentQuote.price);
    document.getElementById('quote-band').textContent=`Fare band: ${currentQuote.band*12} km to below ${(currentQuote.band+1)*12} km. Every new 12 km band doubles the fare.`;
    document.getElementById('quote-locations').textContent=`Pickup: ${route.pickup.label}. Drop-off: ${route.dropoff.label}.`;
    document.getElementById('truck-route-note').hidden=currentQuote.vehicle!=='truck';
    document.getElementById('quote-load').textContent=`${currentQuote.load.truckClass || currentQuote.vehicle.toUpperCase()} selected · Estimated weight ${mass(currentQuote.load.weight)} kg · Volumetric ${mass(currentQuote.load.volumetric)} kg · Chargeable ${mass(currentQuote.load.chargeable)} kg. Includes ${currentQuote.load.included} kg.`;
    document.getElementById('quote-breakdown').textContent=`Distance ${money(currentQuote.distanceFee)} + extra weight ${mass(currentQuote.load.extra)} kg × ${money(currentQuote.load.rate)}/kg = ${money(currentQuote.load.weightFee)}. Outbound total ${money(currentQuote.price)}.`;
    const directions=new URL('https://www.google.com/maps/dir/');directions.search=new URLSearchParams({api:'1',origin:data.pickup,destination:data.dropoff,travelmode:'driving'}).toString();
    document.getElementById('quote-directions').href=directions.href;
    const note=document.getElementById('quote-map-note');note.textContent='Planned road route. Live driver location is not included.';
    try {quoteMap=window.renderDeliveryMap(document.getElementById('quote-map'),route,()=>{note.textContent='Some map tiles could not load. Use the directions link to verify your locations.';});}
    catch {document.getElementById('quote-map').hidden=true;note.textContent='The map could not load. Check the matched addresses above or open Google Maps.';}
    quoteStatus.textContent='Route calculated · quote valid for 15 minutes. Review the locations and fare before booking.';
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
  let vehicle='',text='Choose a parcel category to estimate your load and vehicle.';
  let chargeable=0,label='';
  if(values.every(value=>Number.isFinite(value)&&value>0)){
    const [estimatedWeight,length,width,height]=values,volumetric=length*width*height/5000;
    chargeable=Math.max(estimatedWeight,volumetric);
    if(chargeable>8000)text='Above 8,000 chargeable kg: contact dispatch for a manual quote.';
    else{
      vehicle=chargeable<=20?'bike':chargeable<=1000?'van':'truck';
      label=vehicle==='truck'?(chargeable<=4000?'4-ton Truck':'8-ton Truck'):vehicle.toUpperCase();
      text=label+' recommended · '+mass(chargeable)+' chargeable kg (estimated weight '+mass(estimatedWeight)+' kg; volumetric '+mass(volumetric)+' kg). Physical cargo fit and access require dispatch confirmation.';
    }
  }
  form.querySelectorAll('[name=vehicle]').forEach(input=>{input.checked=input.value===vehicle;});
  const summary=document.getElementById('load-summary');
  if(summary)summary.textContent=text;
  window.swiftHaulUpdateVehiclePreview?.(vehicle,chargeable,label);
}
form.addEventListener('input',event=>{if(['weight','length','width','height'].includes(event.target.name))previewLoad();});
previewLoad();

function updatePaymentOptions(){
  const distance=currentQuote?.route.distance;
  const cash=Number.isFinite(distance)&&distance<12000;
  const counter=Number.isFinite(distance)&&distance<24000;
  document.getElementById('cash-payment-option').disabled=!cash;
  if(form.elements.payment_method.value==='cash'&&!cash)form.elements.payment_method.value='dispatch';
  const checkbox=document.getElementById('make-counter-offer');checkbox.disabled=!counter;
  if(!counter)checkbox.checked=false;
  const show=counter&&checkbox.checked&&form.elements.payment_method.value!=='wallet';
  document.getElementById('counter-offer-field').hidden=!show;
  document.getElementById('counter-offer-note').hidden=!show;
  form.elements.counter_offer.disabled=!show;form.elements.counter_offer.required=show;
  if(!show)form.elements.counter_offer.value='';
  document.getElementById('payment-eligibility').textContent=!currentQuote?'Calculate a route to check cash and counteroffer eligibility.':(cash?'Cash or EFT arranged through dispatch is available.':'EFT arranged through dispatch is available; cash is unavailable for this distance.')+(counter?' Counteroffers are available only when paying through dispatch.':'');
}
document.getElementById('make-counter-offer').addEventListener('change',updatePaymentOptions);
form.elements.payment_method.addEventListener('change',updatePaymentOptions);
updatePaymentOptions();

document.addEventListener('wallet-updated',loadOrders);
