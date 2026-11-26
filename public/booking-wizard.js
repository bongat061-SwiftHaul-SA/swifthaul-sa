(() => {
  const app = document.body.dataset.app;
  if (app !== 'customer') return;
  const form = document.getElementById('booking-form');
  if (!form || form.dataset.wizardReady === 'true') return;
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
  const vehicle = byText('fieldset', 'choose your vehicle');
  const payment = byText('fieldset', 'payment option');
  const counterToggle = form.querySelector('#make-counter-offer')?.closest('label');
  const counterCheckbox = form.querySelector('#make-counter-offer');
  const counterField = form.querySelector('#counter-offer-field');
  const counterNote = form.querySelector('#counter-offer-note');
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
  if (![pickup,dropoff,recipient,parcel,vehicle,payment,calculate,quote,submit,counterSubmit].every(Boolean)) return;
  // Loading help is free and protection details belong in the terms, not this booking step.
  if (assistance) assistance.hidden = true;
  if (protection) protection.hidden = true;
  form.dataset.wizardReady = 'true';

  const oldHeading = form.querySelector(':scope > h2');
  oldHeading?.remove();
  const steps = [
    {title:'Confirm pickup & drop-off',hint:'Type each address and tap the correct suggestion. Then continue to your parcel details.'},
    {title:'Items & vehicle',hint:'Add preset items or describe your own delivery, then choose the vehicle you want. Fare is based on kilometres and vehicle.'},
    {title:'More options & protection',hint:'Open More options for pickup time, return delivery and payment. You can also make a counter-offer here.'},
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
  const moreOptions = document.createElement('details');
  moreOptions.className = 'booking-more-options';
  moreOptions.innerHTML = '<summary>More options <span>Pickup time · Return · Payment</span></summary>';
  [schedule,returnTrip,payment].forEach(node=>{if(node)moreOptions.append(node);});
  moreOptions.open = true;
  const counterPanel = document.createElement('section');
  counterPanel.className = 'customer-counteroffer-panel';
  const counterHeading = document.createElement('h3');
  counterHeading.textContent = 'Make a counter-offer';
  counterPanel.append(counterHeading);
  const counterButton=document.createElement('button');
  counterButton.type='button';counterButton.id='customer-counteroffer-button';counterButton.className='customer-counteroffer-button';
  counterButton.textContent='Make a counter-offer';counterButton.setAttribute('aria-pressed','false');
  counterButton.disabled=counterCheckbox?.disabled!==false;
  counterToggle?.setAttribute('hidden','');
  counterPanel.append(counterButton);
  const counterHelp=document.createElement('p');counterHelp.className='counter-offer-help';counterHelp.textContent='For routes under 24 km: select “Arrange payment with dispatch” above to enable a counter-offer.';counterPanel.append(counterHelp);
  [counterField,counterNote].forEach(node=>{if(node)counterPanel.append(node);});
  counterButton.addEventListener('click',()=>{
    if(!counterCheckbox||counterButton.disabled)return;
    counterCheckbox.checked=!counterCheckbox.checked;
    counterCheckbox.dispatchEvent(new Event('change',{bubbles:true}));
    counterButton.setAttribute('aria-pressed',String(counterCheckbox.checked));
    counterButton.textContent=counterCheckbox.checked?'Cancel counter-offer':'Make a counter-offer';
  });
  // The location picker builds a map stage containing the pickup/drop-off inputs.
  // Keep that stage intact on step one so the map and selected address markers stay together. The previous implementation moved
  // the input wrappers out of the map sheet, leaving a large empty map behind.
  const mapStage = form.querySelector('#delivery-map-stage');
  if (mapStage) {
    move(mapStage,0);
    // Keep the address map on step one; scheduling and return controls live in More options.
    // Scheduling and return options are already grouped in More options.
    // The location picker initially places the recipient and parcel estimator
    // in its map sheet. Move them into step two while leaving the map intact.
    [recipient,parcel,vehicle,vehicleNote,calculate,pricingNote,quote].forEach(node=>move(node,1));
    [moreOptions,counterPanel].forEach(node=>move(node,2));
  } else {
    [pickup,dropoff].forEach(node=>move(node,0));
    [recipient,parcel,vehicle,vehicleNote,calculate,pricingNote,quote].forEach(node=>move(node,1));
    [moreOptions,counterPanel,assistance,protection].forEach(node=>move(node,2));
  }
  const review = document.createElement('section');
  review.className = 'booking-review-card';
  review.innerHTML = '<h3>Delivery summary</h3><dl><div><dt>Pickup</dt><dd data-review-pickup>Not entered</dd></div><div><dt>Drop-off</dt><dd data-review-dropoff>Not entered</dd></div><div><dt>Recipient</dt><dd data-review-recipient>Not entered</dd></div><div><dt>Parcel & vehicle</dt><dd data-review-parcel>Complete parcel details</dd></div><div><dt>Fare</dt><dd data-review-fare>Calculate your route</dd></div><div><dt>Payment</dt><dd data-review-payment>Arrange with dispatch</dd></div></dl><p class="booking-review-note">Your request is only confirmed after SwiftHaul dispatch accepts it. Payment is not confirmed by submitting this request.</p>';
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
    const vehicleInput=form.querySelector('[name=vehicle]:checked');
    const vehicleValue=vehicleInput?.closest('label')?.querySelector('strong')?.textContent || vehicleInput?.value;
    const customItems=form.querySelector('#customer-item-description')?.value.trim();
    const presetItems=form.querySelector('[name=preset_items]')?.value.trim();
    set('parcel',[vehicleValue,[customItems,presetItems].filter(Boolean).join(' · ')].filter(Boolean).join(' · ') || 'Add item details and choose a vehicle');
    set('fare',quote.hidden ? (document.body.dataset.guestPreview === 'true' ? 'Sign in to calculate your live fare' : 'Calculate your route') : (form.querySelector('#quote-price')?.textContent || 'Quote ready'));
    set('payment',form.elements.payment_method.selectedOptions[0]?.textContent || 'Arrange with dispatch');
    set('assistance',form.querySelector('#assistance-requested').checked ? 'Requested · subject to dispatch approval' : 'Not requested');
  };
  const show = index => {
    active=Math.max(0,Math.min(3,index));
    panes.forEach((pane,i)=>pane.hidden=i!==active);
    title.textContent=steps[active].title;
    count.textContent='STEP '+(active+1)+' OF 4';
    hint.textContent=(document.body.dataset.guestPreview === 'true' && active===1) ? 'Preview your parcel dimensions and vehicle recommendation. Sign in to calculate a live mapped fare.' : steps[active].hint;
    progress.forEach((bar,i)=>bar.classList.toggle('is-complete',i<=active));
    back.hidden=active===0;
    next.hidden=active===3;
    next.disabled=false;
    next.textContent=active===0?'Continue to parcel details':active===2?'Review booking':'Continue';
    
    if(active===3)updateReview();
    if(pageHeading)pageHeading.textContent=active===0?'Choose pickup & drop-off.':'Book a delivery.';
    if(pageDescription)pageDescription.textContent=active===0?'Select the correct addresses from the dropdown suggestions.':'Add your parcel details, review the fare and complete your booking request.';
    controls.hidden=false;
    shell.scrollIntoView({behavior:'smooth',block:'start'});
  };
  const validateStep = () => {
    const controls=[...panes[active].querySelectorAll('input,select,textarea')].filter(el=>!el.disabled && el.type!=='hidden');
    const invalid=controls.find(el=>!el.checkValidity());
    if(invalid){invalid.reportValidity();return false;}
    if(active===0){
      const complete = ['pickup','dropoff'].every(key => {
        const address = form.querySelector('[name="'+key+'"]')?.value.trim();
        const lat = form.querySelector('[name="'+key+'_latitude"]')?.value;
        const lng = form.querySelector('[name="'+key+'_longitude"]')?.value;
        return Boolean(address && lat && lng);
      });
      if(!complete){announce('Choose a pickup and drop-off address from the suggestions.');return false;}
    }
    if(active===1){
      if(!form.querySelector('[name=vehicle]:checked')){announce('Choose the vehicle you want to use before continuing.');form.querySelector('[name=vehicle]')?.focus();return false;}
      if(!(form.querySelector('#customer-item-description')?.value.trim()||form.querySelector('[name=preset_items]')?.value.trim())){announce('Describe the items or add at least one preset item before continuing.');form.querySelector('#customer-item-description')?.focus();return false;}
      if(quote.hidden && document.body.dataset.guestPreview !== 'true'){announce('Calculate the mapped route and fare before continuing.');calculate.focus();return false;}
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