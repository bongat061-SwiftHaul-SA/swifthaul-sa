(() => {
  const app = document.body.dataset.app;
  if (app !== 'customer') return;
  const form = document.getElementById('booking-form');
  if (!form || form.dataset.wizardReady === 'true') return;
  form.dataset.wizardReady = 'true';
  // Validate the active wizard pane ourselves so native validation never tries
  // to focus a required field inside a hidden step.

  const byText = (selector, match) => [...form.querySelectorAll(selector)].find(node =>
    (node.querySelector('legend')?.textContent || node.textContent || '').toLowerCase().includes(match)
  );
  const pickup = form.querySelector('#custPickup')?.closest('.field');
  const dropoff = form.querySelector('#custDropoff')?.closest('.field');
  const recipient = form.querySelector('#custRecip')?.closest('.field');
  const schedule = form.querySelector('#schedule-later')?.closest('fieldset');
  const returnTrip = form.querySelector('#request-return')?.closest('fieldset');
  const parcel = byText('fieldset', 'what are you sending');
  const vehicle = byText('fieldset', 'selected automatically');
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
  if (![pickup,dropoff,recipient,parcel,vehicle,payment,assistance,protection,calculate,quote,submit,counterSubmit].every(Boolean)) return;

  const oldHeading = form.querySelector(':scope > h2');
  oldHeading?.remove();
  const steps = [
    {title:'Route & locations',hint:'Choose pickup and drop-off addresses, then confirm both exact map pins and Plus Codes.'},
    {title:'Parcel details',hint:'Describe your load, review the recommended vehicle and calculate your mapped fare.'},
    {title:'Assistance & protection',hint:'Choose payment and optional handling, then review the customer protection terms.'},
    {title:'Review & book',hint:'Check your delivery details, fare and any counteroffer before submitting.'}
  ];
  const shell = document.createElement('section');
  shell.className = 'booking-wizard';
  shell.setAttribute('aria-label','Four-step delivery booking');
  const header = document.createElement('header');
  header.className = 'booking-wizard-header';
  header.innerHTML = '<div class="booking-wizard-kicker">NEW DELIVERY</div><div class="booking-wizard-heading"><h2 data-wizard-title></h2><span data-wizard-count></span></div><p data-wizard-hint></p><div class="booking-wizard-progress" aria-label="Booking progress"><span></span><span></span><span></span><span></span></div>';
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
  // The location picker builds a map stage containing the pickup/drop-off inputs.
  // Keep that stage intact on step one so the map, address suggestions, draggable
  // pins and Plus Code readout stay together. The previous implementation moved
  // the input wrappers out of the map sheet, leaving a large empty map behind.
  const mapStage = form.querySelector('#delivery-map-stage');
  if (mapStage) {
    move(mapStage,0);
    // Keep the supporting collection details in the same first step as the
    // pickup/drop-off map. The location picker moves only those two address
    // fields into its map sheet; recipient and scheduling controls remain in
    // the original form unless explicitly moved here.
    [recipient,schedule,returnTrip].forEach(node=>move(node,0));
    // The parcel estimator is initially inserted into the map sheet by the
    // location picker; move only the parcel/quote controls into step two.
    [parcel,vehicle,vehicleNote,calculate,pricingNote,quote].forEach(node=>move(node,1));
    [payment,assistance,protection].forEach(node=>move(node,2));
  } else {
    [pickup,dropoff,recipient,schedule,returnTrip].forEach(node=>move(node,0));
    [parcel,vehicle,vehicleNote,calculate,pricingNote,quote].forEach(node=>move(node,1));
    [payment,assistance,protection].forEach(node=>move(node,2));
  }
  const review = document.createElement('section');
  review.className = 'booking-review-card';
  review.innerHTML = '<h3>Delivery summary</h3><dl><div><dt>Pickup</dt><dd data-review-pickup>Not entered</dd></div><div><dt>Drop-off</dt><dd data-review-dropoff>Not entered</dd></div><div><dt>Recipient</dt><dd data-review-recipient>Not entered</dd></div><div><dt>Parcel & vehicle</dt><dd data-review-parcel>Complete parcel details</dd></div><div><dt>Fare</dt><dd data-review-fare>Calculate your route</dd></div><div><dt>Payment</dt><dd data-review-payment>Arrange with dispatch</dd></div><div><dt>Assistance</dt><dd data-review-assistance>Not requested</dd></div></dl><p class="booking-review-note">Your request is only confirmed after SwiftHaul dispatch accepts it. Payment is not confirmed by submitting this request.</p>';
  panes[3].append(review,submit,counterSubmit,message);

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
  const updateReview = () => {
    const set = (key,value) => { const node=review.querySelector('[data-review-'+key+']'); if(node)node.textContent=value || 'Not entered'; };
    set('pickup',form.elements.pickup.value.trim());
    set('dropoff',form.elements.dropoff.value.trim());
    set('recipient',form.elements.recipient.value.trim());
    const weight=Number(form.elements.weight.value);
    const vehicleValue=form.querySelector('[name=vehicle]:checked')?.value;
    set('parcel',weight>0 ? (vehicleValue||'Vehicle pending').toUpperCase()+' · '+weight+' kg estimated' : 'Complete parcel details');
    set('fare',quote.hidden ? 'Calculate your route' : (form.querySelector('#quote-price')?.textContent || 'Quote ready'));
    set('payment',form.elements.payment_method.selectedOptions[0]?.textContent || 'Arrange with dispatch');
    set('assistance',form.querySelector('#assistance-requested').checked ? 'Requested · subject to dispatch approval' : 'Not requested');
  };
  const show = index => {
    active=Math.max(0,Math.min(3,index));
    panes.forEach((pane,i)=>pane.hidden=i!==active);
    title.textContent=steps[active].title;
    count.textContent='STEP '+(active+1)+' OF 4';
    hint.textContent=steps[active].hint;
    progress.forEach((bar,i)=>bar.classList.toggle('is-complete',i<=active));
    back.hidden=active===0;
    next.hidden=active===3;
    next.textContent=active===2?'Review booking':'Continue';
    if(active===3)updateReview();
    controls.hidden=false;
    shell.scrollIntoView({behavior:'smooth',block:'start'});
  };
  const validateStep = () => {
    const controls=[...panes[active].querySelectorAll('input,select,textarea')].filter(el=>!el.disabled && el.type!=='hidden');
    const invalid=controls.find(el=>!el.checkValidity());
    if(invalid){invalid.reportValidity();return false;}
    if(active===1){
      if(!(Number(form.elements.weight.value)>0)){announce('Please estimate your parcel weight and dimensions before continuing.');return false;}
      if(quote.hidden){announce('Calculate the mapped route and fare before continuing.');calculate.focus();return false;}
    }
    return true;
  };
  next.addEventListener('click',()=>{
    if(!validateStep())return;
    show(active+1);
  });
  back.addEventListener('click',()=>show(active-1));
  form.addEventListener('submit',event=>{
    if(active!==3){event.preventDefault();event.stopImmediatePropagation();if(validateStep())show(active+1);return;}
    const required=[...form.querySelectorAll('input,select,textarea')].filter(el=>el.required&&!el.disabled&&el.type!=='hidden');
    const invalid=required.find(el=>!el.checkValidity());
    if(invalid){
      event.preventDefault();event.stopImmediatePropagation();
      const pane=invalid.closest('.booking-step');
      const index=panes.indexOf(pane);
      if(index>=0)show(index);
      requestAnimationFrame(()=>invalid.reportValidity());
    }
  },true);
  form.addEventListener('input',updateReview);
  form.addEventListener('change',updateReview);
  document.addEventListener('account-cleared',()=>show(0));
  show(0);
})();