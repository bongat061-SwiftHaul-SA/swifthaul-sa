(() => {
  if (document.body.dataset.app !== 'customer') return;
  const form = document.getElementById('booking-form');
  if (!form || form.dataset.wizardReady === 'true') return;

  const byText = (selector, match) => [...form.querySelectorAll(selector)].find(node =>
    (node.querySelector('legend')?.textContent || node.textContent || '').toLowerCase().includes(match)
  );
  const pickup = form.querySelector('#custPickup')?.closest('.field');
  const dropoff = form.querySelector('#custDropoff')?.closest('.field');
  const recipient = form.querySelector('#custRecip')?.closest('.field');
  const schedule = form.querySelector('#schedule-later')?.closest('fieldset');
  const returnTrip = form.querySelector('#request-return')?.closest('fieldset');
  const parcel = byText('fieldset', 'what are you sending');
  const vehicle = byText('fieldset', 'vehicle class');
  const payment = byText('fieldset', 'payment & counteroffer');
  const assistance = form.querySelector('#handling-assistance');
  const protection = form.querySelector('.customer-terms-acknowledgement');
  const calculate = form.querySelector('#calculate-route');
  const quote = form.querySelector('#quote-result');
  const pricingNote = calculate?.nextElementSibling;
  const vehicleNote = vehicle?.nextElementSibling;
  const submit = form.querySelector('#submit');
  const counterSubmit = form.querySelector('#submit-counter-offer');
  const message = form.querySelector('#message');
  const pageHeading = document.querySelector('#workspace .page-heading h1');
  const pageDescription = document.querySelector('#workspace .page-heading .subtle');
  if (![pickup,dropoff,recipient,parcel,vehicle,payment,assistance,protection,calculate,quote,submit,counterSubmit].every(Boolean)) return;

  form.dataset.wizardReady = 'true';
  form.querySelector(':scope > h2')?.remove();

  const steps = [
    {title:'Pickup & drop-off',hint:'Set both addresses on the map. Move each pin to the exact pickup or delivery entrance.'},
    {title:'Your items & fare',hint:'Tell us what you’re sending. We’ll estimate the load, recommend a vehicle and calculate the route fare.'},
    {title:'Review & book',hint:'Check your delivery, choose how you want to pay and confirm the booking request.'}
  ];

  const shell = document.createElement('section');
  shell.className = 'booking-wizard';
  shell.setAttribute('aria-label','Three-step delivery booking');
  const header = document.createElement('header');
  header.className = 'booking-wizard-header';
  header.innerHTML = '<div class="booking-wizard-kicker">NEW DELIVERY</div><div class="booking-wizard-heading"><h2 data-wizard-title></h2><span data-wizard-count></span></div><p data-wizard-hint></p><div class="booking-wizard-progress" aria-label="Booking progress"><span></span><span></span><span></span></div>';
  const content = document.createElement('div');
  content.className = 'booking-wizard-content';
  const panes = steps.map((step,index) => {
    const pane = document.createElement('section');
    pane.className = 'booking-step';
    pane.dataset.step = String(index);
    pane.hidden = index !== 0;
    pane.setAttribute('aria-label',step.title);
    content.append(pane);
    return pane;
  });
  const controls = document.createElement('footer');
  controls.className = 'booking-wizard-controls';
  controls.innerHTML = '<button type="button" class="booking-back" data-wizard-back hidden>Back</button><span class="booking-wizard-spacer"></span><button type="button" class="primary booking-next" data-wizard-next>Continue</button>';
  shell.append(header,content,controls);
  form.insertBefore(shell,form.firstChild);
  form.noValidate = true;

  const move = (node,index) => { if(node) panes[index].append(node); };
  const mapStage = form.querySelector('#delivery-map-stage');
  if (mapStage) {
    move(mapStage,0);
  } else {
    [pickup,dropoff].forEach(node=>move(node,0));
  }

  // Optional trip settings stay available but no longer compete with the two
  // essential address fields in the normal booking flow.
  const tripOptions = document.createElement('details');
  tripOptions.className = 'booking-optional-details';
  tripOptions.innerHTML = '<summary>Optional trip settings</summary><div class="booking-optional-content"></div>';
  const tripContent = tripOptions.querySelector('.booking-optional-content');
  [schedule,returnTrip].forEach(node=>{ if(node) tripContent.append(node); });
  if (tripContent.childElementCount) panes[0].append(tripOptions);

  [recipient,parcel,vehicle,vehicleNote,calculate,pricingNote,quote].forEach(node=>move(node,1));

  // Keep optional counteroffers and assistance out of the way unless wanted.
  const counterLabel = form.querySelector('#make-counter-offer')?.closest('label');
  const counterField = form.querySelector('#counter-offer-field');
  const counterNote = form.querySelector('#counter-offer-note');
  if (counterLabel && counterField && counterNote) {
    const optionalOffer = document.createElement('details');
    optionalOffer.className = 'booking-optional-details';
    optionalOffer.innerHTML = '<summary>Make an optional counteroffer</summary><div class="booking-optional-content"></div>';
    optionalOffer.querySelector('.booking-optional-content').append(counterLabel,counterField,counterNote);
    const eligibility = payment.querySelector('#payment-eligibility');
    (eligibility || payment).after(optionalOffer);
  }
  move(payment,2);

  const optionalAssistance = document.createElement('details');
  optionalAssistance.className = 'booking-optional-details';
  optionalAssistance.innerHTML = '<summary>Request loading or carrying help (optional)</summary>';
  optionalAssistance.append(assistance);
  panes[2].append(optionalAssistance,protection);

  const review = document.createElement('section');
  review.className = 'booking-review-card';
  review.innerHTML = '<h3>Delivery summary</h3><dl><div><dt>Pickup</dt><dd data-review-pickup>Not entered</dd></div><div><dt>Drop-off</dt><dd data-review-dropoff>Not entered</dd></div><div><dt>Recipient</dt><dd data-review-recipient>Not entered</dd></div><div><dt>Items & vehicle</dt><dd data-review-parcel>Add your items</dd></div><div><dt>Fare</dt><dd data-review-fare>Calculate route</dd></div><div><dt>Pickup time</dt><dd data-review-schedule>As soon as available</dd></div><div><dt>Return trip</dt><dd data-review-return>Not requested</dd></div></dl><p class="booking-review-note">Your booking is a request. Dispatch confirms the driver and delivery, and payment is only confirmed after the selected payment process is completed.</p>';
  panes[2].prepend(review);
  panes[2].append(submit,counterSubmit,message);

  let active = 0;
  const title = header.querySelector('[data-wizard-title]');
  const count = header.querySelector('[data-wizard-count]');
  const hint = header.querySelector('[data-wizard-hint]');
  const progress = [...header.querySelectorAll('.booking-wizard-progress span')];
  const back = controls.querySelector('[data-wizard-back]');
  const next = controls.querySelector('[data-wizard-next]');
  const announce = text => {
    const target = form.querySelector('#quote-status') || message;
    if (target) target.textContent = text;
  };
  const setReview = (key,value) => {
    const node=review.querySelector('[data-review-'+key+']');
    if(node) node.textContent=value || 'Not entered';
  };
  const updateReview = () => {
    setReview('pickup',form.elements.pickup?.value.trim());
    setReview('dropoff',form.elements.dropoff?.value.trim());
    setReview('recipient',form.elements.recipient?.value.trim());
    const weight=Number(form.elements.weight?.value);
    const vehicleValue=form.querySelector('[name=vehicle]:checked');
    setReview('parcel',weight>0 ? (vehicleValue?.parentElement.querySelector('strong')?.textContent || vehicleValue.value)+' · '+weight+' kg estimated' : 'Add your items');
    setReview('fare',quote.hidden ? 'Calculate route' : (form.querySelector('#quote-price')?.textContent || 'Quote ready'));
    const scheduled=form.elements.scheduled_at?.value;
    setReview('schedule',form.querySelector('#schedule-later')?.checked && scheduled ? new Date(scheduled).toLocaleString() : 'As soon as available');
    setReview('return',form.querySelector('#request-return')?.checked ? (form.elements.return_address?.value || 'Return requested · dispatch will quote separately') : 'Not requested');
  };

  const show = index => {
    active=Math.max(0,Math.min(2,index));
    panes.forEach((pane,i)=>pane.hidden=i!==active);
    title.textContent=steps[active].title;
    count.textContent='STEP '+(active+1)+' OF 3';
    hint.textContent=steps[active].hint;
    progress.forEach((bar,i)=>bar.classList.toggle('is-complete',i<=active));
    back.hidden=active===0;
    next.hidden=active===2;
    next.disabled=false;
    next.textContent=active===0?'Continue to items':'Review booking';
    if(active===2) updateReview();
    if(pageHeading) pageHeading.textContent=active===0?'Where should we collect and deliver?':active===1?'What are you sending?':'Review your delivery.';
    if(pageDescription) pageDescription.textContent=active===0?'Add your pickup and drop-off locations.':active===1?'Add your items and check the fare.':'Confirm the details before sending your booking request.';
    controls.hidden=false;
    shell.scrollIntoView({behavior:'smooth',block:'start'});
  };

  const validateStep = () => {
    const controls=[...panes[active].querySelectorAll('input,select,textarea')].filter(el=>!el.disabled && el.type!=='hidden');
    const invalid=controls.find(el=>!el.checkValidity());
    if(invalid){invalid.reportValidity();return false;}
    if(active===0){
      const complete=['pickup','dropoff'].every(key=>{
        const lat=form.querySelector('[name="'+key+'_latitude"]')?.value;
        const lng=form.querySelector('[name="'+key+'_longitude"]')?.value;
        const code=form.querySelector('[name="'+key+'_plus_code"]')?.value;
        return Boolean(lat&&lng&&code);
      });
      if(!complete){announce('Please confirm both map pins before continuing.');return false;}
    }
    if(active===1){
      if(!(Number(form.elements.weight?.value)>0)){announce('Please add at least one item to your load.');return false;}
      if(quote.hidden && document.body.dataset.guestPreview!=='true'){
        announce('Calculate your delivery fare before continuing.');
        calculate.focus();
        return false;
      }
    }
    return true;
  };

  next.addEventListener('click',()=>{
    if(!validateStep()) return;
    show(active+1);
  });
  document.addEventListener('swift-haul:locations-confirmed',()=>{
    if(active!==0) return;
    const ready=['pickup','dropoff'].every(key=>{
      const address=form.querySelector('[name="'+key+'"]')?.value.trim();
      const lat=form.querySelector('[name="'+key+'_latitude"]')?.value;
      const lng=form.querySelector('[name="'+key+'_longitude"]')?.value;
      const code=form.querySelector('[name="'+key+'_plus_code"]')?.value;
      return Boolean(address&&lat&&lng&&code);
    });
    if(ready) show(1);
    else announce('Please confirm both addresses and map pins.');
  });
  back.addEventListener('click',()=>show(active-1));
  form.addEventListener('submit',event=>{
    if(active!==2){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(validateStep()) show(active+1);
      return;
    }
    const required=[...form.querySelectorAll('input,select,textarea')].filter(el=>el.required&&!el.disabled&&el.type!=='hidden');
    const invalid=required.find(el=>!el.checkValidity());
    if(invalid){
      event.preventDefault();
      event.stopImmediatePropagation();
      const pane=invalid.closest('.booking-step');
      const index=panes.indexOf(pane);
      if(index>=0) show(index);
      requestAnimationFrame(()=>invalid.reportValidity());
    }
  },true);
  form.addEventListener('input',updateReview);
  form.addEventListener('change',updateReview);
  document.addEventListener('account-cleared',()=>show(0));
  show(0);
})();