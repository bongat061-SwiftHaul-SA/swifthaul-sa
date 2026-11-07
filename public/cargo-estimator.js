(() => {
  const form = document.getElementById('booking-form');
  const parcel = form?.querySelector('.parcel-fields');
  if (!form || !parcel || document.getElementById('cargo-estimator')) return;
  const style = document.createElement('style');
  style.textContent = '#cargo-estimator{margin:12px 0;padding:14px;border:1px solid #dce7df;border-radius:18px;background:linear-gradient(145deg,#fbfdfb,#f0f6f1)}#cargo-estimator h3{margin:0;color:#173d31;font-size:15px;font-weight:850;letter-spacing:-.35px}#cargo-estimator .cargo-intro{margin:5px 0 12px;color:#66786e;font-size:11px;line-height:1.45}#cargo-estimator .cargo-categories{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}#cargo-estimator .cargo-category{min-width:0;min-height:94px;padding:8px 4px;border:1px solid #dce6de;border-radius:13px;background:#fff;color:#233b30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;cursor:pointer;transition:transform .15s,border-color .15s,box-shadow .15s}#cargo-estimator .cargo-category[aria-pressed=true]{border:2px solid #1c654b;background:#f1f8f3;box-shadow:0 5px 14px #1d604019;transform:translateY(-1px)}#cargo-estimator .cargo-category svg{width:48px;height:42px;overflow:visible}#cargo-estimator .cargo-category strong{font-size:10px;font-weight:800}#cargo-estimator .cargo-category small{font-size:8px;color:#78877e}#cargo-estimator .cargo-choice-row{display:grid;grid-template-columns:minmax(0,1fr) 82px;gap:8px;margin-top:11px}#cargo-estimator label{display:block;color:#4b6256;font-size:9px;font-weight:800;margin-bottom:5px}#cargo-estimator select,#cargo-estimator input{box-sizing:border-box;width:100%;height:39px;padding:8px 10px;border:1px solid #d4e0d7;border-radius:10px;background:#fff;color:#1d352a;font-size:11px}#cargo-estimator .cargo-estimate-note{margin:9px 0 0;padding:9px 10px;border-radius:10px;background:#e9f2eb;color:#4b6656;font-size:10px;line-height:1.4}#cargo-estimator .cargo-dimensions{margin-top:11px;padding-top:10px;border-top:1px solid #dce7df}#cargo-estimator .cargo-dimensions-title{font-size:10px;font-weight:850;color:#243b30;margin-bottom:7px}#cargo-estimator .cargo-vehicle{margin-top:12px;padding:11px;border:1px solid #dce7df;border-radius:14px;background:#fff}#cargo-estimator .cargo-vehicle-head{display:flex;align-items:center;justify-content:space-between;gap:8px}#cargo-estimator .cargo-vehicle-head strong{font-size:11px;color:#20392d}#cargo-estimator .cargo-vehicle-head span{font-size:8px;font-weight:800;color:#1c654b;background:#e9f4ec;border-radius:99px;padding:5px 7px}#cargo-estimator .cargo-vehicle-visual{display:flex;align-items:center;justify-content:center;min-height:76px;margin:4px 0}#cargo-estimator .cargo-vehicle-visual svg{width:min(100%,260px);height:82px}#cargo-estimator .cargo-vehicle-copy{font-size:9px;color:#66786e;line-height:1.4;text-align:center}#cargo-estimator .cargo-empty{color:#77877d;font-size:10px}@media(max-width:430px){#cargo-estimator{padding:11px}#cargo-estimator .cargo-categories{gap:5px}#cargo-estimator .cargo-category{min-height:85px;padding:6px 2px}#cargo-estimator .cargo-category svg{width:42px;height:37px}#cargo-estimator .cargo-category strong{font-size:9px}#cargo-estimator .cargo-category small{font-size:7px}}';
  document.head.append(style);

  const icons = {
    boxes: '<svg viewBox="0 0 64 52" aria-hidden="true"><path d="M8 15 31 4l24 11-23 12z" fill="#dca65e"/><path d="M8 15v25l24 10V27z" fill="#bd7d3d"/><path d="M32 27v23l23-10V15z" fill="#e8bd7c"/><path d="m20 9 24 11M32 27v13" stroke="#fff1d8" stroke-width="2" opacity=".8"/></svg>',
    furniture: '<svg viewBox="0 0 64 52" aria-hidden="true"><path d="M9 24q0-7 7-7h32q7 0 7 7v16H9z" fill="#477e70"/><path d="M14 18q0-6 7-6h22q7 0 7 6v10H14z" fill="#70a18e"/><path d="M7 27h50v9H7z" fill="#2e6555"/><path d="M12 39v8m40-8v8" stroke="#254d41" stroke-width="4" stroke-linecap="round"/></svg>',
    appliances: '<svg viewBox="0 0 64 52" aria-hidden="true"><defs><linearGradient id="appl" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#e6eef0"/><stop offset="1" stop-color="#9eafb5"/></linearGradient></defs><path d="M17 5h30q4 0 4 4v38H13V9q0-4 4-4" fill="url(#appl)" stroke="#71858c"/><path d="M14 23h36" stroke="#82969d" stroke-width="1.5"/><path d="M43 12v7m0 9v7" stroke="#60777f" stroke-width="2" stroke-linecap="round"/></svg>',
    documents: '<svg viewBox="0 0 64 52" aria-hidden="true"><path d="M15 8h27l9 9v29H15z" fill="#d7e5ee" stroke="#91aebd"/><path d="M42 8v10h9" fill="#a9c2d0"/><path d="M22 24h22M22 30h22M22 36h16" stroke="#7192a2" stroke-width="2" stroke-linecap="round"/></svg>'
  };
  const categories = [
    {id:'boxes',name:'Boxes',hint:'Cartons & parcels',items:[{name:'Small box',weight:5,l:40,w:30,h:30},{name:'Medium box',weight:15,l:60,w:40,h:40},{name:'Large box',weight:25,l:80,w:60,h:60},{name:'Moving boxes (5)',weight:50,l:100,w:80,h:80}]},
    {id:'furniture',name:'Furniture',hint:'Home & office',items:[{name:'Dining chair',weight:8,l:60,w:60,h:90},{name:'Office desk',weight:30,l:120,w:60,h:75},{name:'2-seater couch',weight:45,l:180,w:90,h:85},{name:'3-seater couch',weight:65,l:220,w:95,h:90}]},
    {id:'appliances',name:'Appliances',hint:'White goods & tech',items:[{name:'Microwave',weight:15,l:50,w:40,h:35},{name:'Washing machine',weight:70,l:60,w:65,h:85},{name:'Fridge',weight:90,l:70,w:70,h:180},{name:'Chest freezer',weight:55,l:100,w:65,h:85}]},
    {id:'documents',name:'Documents',hint:'Files & envelopes',items:[{name:'Document envelope',weight:0.5,l:35,w:25,h:2},{name:'Archive box',weight:8,l:45,w:35,h:30},{name:'File carton',weight:12,l:50,w:40,h:35}]}
  ];

  parcel.querySelector('.load-grid')?.remove();
  document.getElementById('load-summary')?.remove();
  const panel = document.createElement('section');
  panel.id = 'cargo-estimator';
  panel.innerHTML = '<h3>What are you sending?</h3><p class="cargo-intro">Choose the closest parcel type. We’ll use a typical packed size and weight as a starting estimate.</p><div class="cargo-categories" role="group" aria-label="Parcel categories"></div><div class="cargo-choice-row"><div><label for="cargo-item">Choose your item</label><select id="cargo-item" disabled><option>Select a category first</option></select></div><div><label for="cargo-quantity">Quantity</label><input id="cargo-quantity" type="number" min="1" max="50" step="1" value="1" disabled></div></div><button type="button" id="cargo-add-item" class="cargo-add-item" disabled>Add item to load</button><div id="cargo-selected-list" class="cargo-selected-list" aria-live="polite"><p class="cargo-empty">No parcels added yet. Select a category and add an item.</p></div><p class="cargo-estimate-note" id="cargo-estimate-note" aria-live="polite">Select a category to see the estimated load and recommended vehicle.</p><div class="cargo-dimensions"><div class="cargo-dimensions-title">Estimated packed dimensions · editable</div><div class="load-grid"><label>Length (cm)<input type="number" name="length" min="0.001" max="100000" step="any" required placeholder="Estimated"></label><label>Width (cm)<input type="number" name="width" min="0.001" max="100000" step="any" required placeholder="Estimated"></label><label>Height (cm)<input type="number" name="height" min="0.001" max="100000" step="any" required placeholder="Estimated"></label></div></div><div class="cargo-vehicle" aria-live="polite"><div class="cargo-vehicle-head"><strong>Recommended vehicle</strong><span id="cargo-vehicle-tag">Awaiting selection</span></div><div class="cargo-vehicle-visual" id="cargo-vehicle-visual"><span class="cargo-empty">Your vehicle recommendation will appear here</span></div><p class="cargo-vehicle-copy" id="cargo-vehicle-copy">Select a parcel category to preview a suitable vehicle.</p></div>';
  parcel.insertBefore(panel, parcel.querySelector('.load-grid'));

  const $ = id => document.getElementById(id);
  const weight = form.elements.namedItem('weight');
  weight?.classList.add('cargo-hidden-weight');
  weight?.removeAttribute('required');
  const quantity = $('cargo-quantity');
  const itemSelect = $('cargo-item');
  let selectedCategory = null;
  let selectedItem = null;
  const cargoItems = [];
  const addItemButton = $('cargo-add-item');
  const selectedList = $('cargo-selected-list');

  const vehicleSvg = type => {
    const defs = '<defs><linearGradient id="veh-side" x1="0" x2="0.9" y1="0" y2="1"><stop stop-color="#3f8b70"/><stop offset="1" stop-color="#15523d"/></linearGradient><linearGradient id="veh-top" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#a9d2bb"/><stop offset="1" stop-color="#4b9877"/></linearGradient><linearGradient id="veh-glass" x1="0" x2="1"><stop stop-color="#d9eff1"/><stop offset="1" stop-color="#78a8ae"/></linearGradient></defs>';
    if (type === 'bike') return '<svg viewBox="0 0 260 92" aria-label="Illustration of a delivery motorbike">' + defs + '<ellipse cx="132" cy="77" rx="91" ry="7" fill="#dfe8e1"/><circle cx="77" cy="67" r="17" fill="#25352e"/><circle cx="77" cy="67" r="8" fill="#aebbb2"/><circle cx="185" cy="67" r="17" fill="#25352e"/><circle cx="185" cy="67" r="8" fill="#aebbb2"/><path d="m77 66 25-25 29 1 20 25h34" fill="none" stroke="#24634b" stroke-width="8" stroke-linecap="round"/><path d="m113 42 21-15 20 2 13 17-23 6z" fill="url(#veh-side)"/><path d="m128 26 12-12h28l11 14z" fill="#dca65e"/><path d="m140 15 25 0 9 13h-35z" fill="#efc987"/></svg>';
    if (type === 'van') return '<svg viewBox="0 0 260 92" aria-label="Illustration of a delivery van">' + defs + '<ellipse cx="132" cy="78" rx="103" ry="7" fill="#dfe8e1"/><path d="M40 29q0-8 9-8h108l31 16 20 23v12H40z" fill="url(#veh-side)" stroke="#174b39" stroke-width="1.5"/><path d="M158 22h-39v33h67l-8-17z" fill="url(#veh-top)"/><path d="M164 27h-36v22h53l-7-13z" fill="url(#veh-glass)"/><path d="M43 28h75v38H43z" fill="#2d7658"/><path d="M50 33h61v27H50z" fill="#4b9272"/><path d="M181 39h7l17 20h-24z" fill="#dce8df"/><circle cx="78" cy="69" r="14" fill="#26362e"/><circle cx="78" cy="69" r="6" fill="#aebbb2"/><circle cx="178" cy="69" r="14" fill="#26362e"/><circle cx="178" cy="69" r="6" fill="#aebbb2"/></svg>';
    return '<svg viewBox="0 0 260 92" aria-label="Illustration of a delivery truck">' + defs + '<ellipse cx="133" cy="79" rx="111" ry="7" fill="#dfe8e1"/><path d="M24 19h139v49H24z" fill="url(#veh-side)" stroke="#174b39" stroke-width="1.5"/><path d="M33 26h120v34H33z" fill="#4b9272"/><path d="M163 37h42l29 22v10h-71z" fill="url(#veh-side)" stroke="#174b39" stroke-width="1.5"/><path d="M173 42h28l18 16h-46z" fill="url(#veh-glass)"/><path d="M24 19h139l-12 7H33z" fill="url(#veh-top)"/><circle cx="65" cy="70" r="14" fill="#26362e"/><circle cx="65" cy="70" r="6" fill="#aebbb2"/><circle cx="190" cy="70" r="14" fill="#26362e"/><circle cx="190" cy="70" r="6" fill="#aebbb2"/></svg>';
  };

  const categoriesNode = panel.querySelector('.cargo-categories');
  categories.forEach(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cargo-category';
    button.dataset.category = category.id;
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = icons[category.id] + '<strong>' + category.name + '</strong><small>' + category.hint + '</small>';
    button.addEventListener('click', () => chooseCategory(category.id));
    categoriesNode.append(button);
  });

  function renderVehicle(type, chargeable, label) {
    $('cargo-vehicle-tag').textContent = label || (type ? type.toUpperCase() + ' recommended' : 'Awaiting selection');
    $('cargo-vehicle-visual').innerHTML = type ? vehicleSvg(type) : '<span class="cargo-empty">Select a parcel category to preview a suitable vehicle</span>';
    $('cargo-vehicle-copy').textContent = type
      ? 'Based on an estimated ' + Number(chargeable).toFixed(1) + ' chargeable kg. Vehicle choice is a guide; dispatch confirms physical fit and access.'
      : 'Select a parcel category to preview a suitable vehicle.';
  }

  function renderSelectedItems() {
    selectedList.replaceChildren();
    if (!cargoItems.length) {
      const empty=document.createElement('p');empty.className='cargo-empty';empty.textContent='No parcels added yet. Select a category and add an item.';selectedList.append(empty);
      return;
    }
    cargoItems.forEach((entry,index)=>{
      const row=document.createElement('div');row.className='cargo-selected-row';
      const copy=document.createElement('span');copy.textContent=entry.category+' · '+entry.name+' × '+entry.quantity;
      const remove=document.createElement('button');remove.type='button';remove.className='cargo-remove-item';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+entry.name);
      remove.addEventListener('click',()=>{cargoItems.splice(index,1);renderSelectedItems();updateLoad();});
      row.append(copy,remove);selectedList.append(row);
    });
  }

  function updateLoad() {
    if (!cargoItems.length) {
      $('cargo-estimate-note').textContent='Add parcels from more than one category to build your combined load.';
      renderVehicle(null,0);
      if (weight) weight.value='';
      return;
    }
    const totalWeight=cargoItems.reduce((sum,item)=>sum+item.weight*item.quantity,0);
    const totalPieces=cargoItems.reduce((sum,item)=>sum+item.quantity,0);
    const maxLength=Math.max(...cargoItems.map(item=>item.l));
    const maxWidth=Math.max(...cargoItems.map(item=>item.w));
    const maxHeight=Math.max(...cargoItems.map(item=>item.h));
    const columns=Math.ceil(Math.sqrt(totalPieces));
    const rows=Math.ceil(totalPieces/columns);
    const dims={length:maxLength*columns,width:maxWidth*rows,height:maxHeight};
    for(const [key,value] of Object.entries(dims)){
      const input=form.elements.namedItem(key);
      if(input){input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));}
    }
    if(weight){weight.value=String(totalWeight);weight.dispatchEvent(new Event('input',{bubbles:true}));}
    const chargeable=Math.max(totalWeight,dims.length*dims.width*dims.height/5000);
    const type=chargeable<=20?'bike':chargeable<=1000?'van':'truck';
    $('cargo-estimate-note').textContent=totalPieces+' parcel item(s) across '+new Set(cargoItems.map(item=>item.category)).size+' categories · estimated total '+totalWeight.toFixed(1)+' kg. Combined dimensions are a starting estimate; adjust below if needed.';
    renderVehicle(type,chargeable);
  }

  function chooseCategory(id) {
    selectedCategory=categories.find(category=>category.id===id);
    selectedItem=selectedCategory.items[0];
    categoriesNode.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===id||cargoItems.some(item=>item.categoryId===button.dataset.category))));
    itemSelect.disabled=false;
    itemSelect.replaceChildren(...selectedCategory.items.map((item,index)=>{
      const option=document.createElement('option');option.value=String(index);option.textContent=item.name+' · approx. '+item.weight+' kg';return option;
    }));
    quantity.disabled=false;quantity.value='1';addItemButton.disabled=false;
    updateLoad();
  }

  function addCurrentItem() {
    if(!selectedCategory||!selectedItem)return;
    const count=Math.max(1,Math.min(50,Number(quantity.value)||1));
    const existing=cargoItems.find(item=>item.categoryId===selectedCategory.id&&item.name===selectedItem.name);
    if(existing)existing.quantity=Math.min(50,existing.quantity+count);
    else cargoItems.push({...selectedItem,category:selectedCategory.name,categoryId:selectedCategory.id,quantity:count});
    categoriesNode.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===selectedCategory.id||cargoItems.some(item=>item.categoryId===button.dataset.category))));
    quantity.value='1';renderSelectedItems();updateLoad();
  }

  itemSelect.addEventListener('change',()=>{
    if(!selectedCategory)return;
    selectedItem=selectedCategory.items[Number(itemSelect.value)]||selectedCategory.items[0];
  });
  quantity.addEventListener('input',()=>{quantity.value=String(Math.max(1,Math.min(50,Number(quantity.value)||1)));});
  addItemButton.addEventListener('click',addCurrentItem);
  renderSelectedItems();

  window.swiftHaulUpdateVehiclePreview = (type, chargeable, label) => renderVehicle(type, chargeable, label);
})();