(() => {
  const form = document.getElementById('booking-form');
  if (!form) return;

  const style = document.createElement('style');
  style.textContent = `
    .address-suggestions{position:absolute;z-index:1200;left:0;right:0;top:100%;margin-top:5px;background:#fff;border:1px solid #c8d3c7;border-radius:10px;box-shadow:0 12px 30px #17352e1c;max-height:260px;overflow:auto}
    .address-field-wrap{position:relative}
    .address-suggestions button{display:block;width:100%;padding:12px 14px;border:0;border-bottom:1px solid #edf1eb;border-radius:0;background:#fff;text-align:left;font-size:12px;line-height:1.55;color:#17352e;white-space:normal}
    .address-suggestions button:last-child{border-bottom:0}
    .address-suggestions button:hover,.address-suggestions button[aria-selected=true]{background:#edf4e9}
    .address-suggestions .suggestion-main{display:block;font-weight:700}
    .address-suggestions .suggestion-meta{display:block;margin-top:3px;color:#61776f;font-size:10px;font-weight:500}
    .address-search-status{min-height:16px;margin:5px 0 0;color:#61776f;font-size:10px;line-height:1.5}
    .address-helper{margin:0 0 14px;color:#61776f;font-size:11px;line-height:1.65}
  `;
  document.head.append(style);

  const alphabet='0123456789bcdefghjkmnpqrstuvwxyz';
  function geohash(lat,lng,precision=9){
    let latR=[-90,90],lngR=[-180,180],even=true,bits=0,ch=0,out='';
    while(out.length<precision){const range=even?lngR:latR,mid=(range[0]+range[1])/2;ch<<=1;if((even?lng:lat)>=mid){ch|=1;range[0]=mid}else range[1]=mid;even=!even;if(++bits===5){out+=alphabet[ch];bits=0;ch=0;}}
    return out;
  }
  function ensureHidden(name){
    let input=form.querySelector('[name="'+name+'"]');
    if(!input){input=document.createElement('input');input.type='hidden';input.name=name;form.append(input);}
    return input;
  }
  function addressLabel(properties){
    const p=properties||{};
    const street=[p.housenumber,p.street].filter(Boolean).join(' ');
    const first=street||p.name||p.street||'';
    const areas=[p.suburb,p.district,p.city||p.town||p.village,p.state,p.postcode,p.country].filter(Boolean);
    return [...new Set([first,...areas].filter(Boolean))].join(', ');
  }
  function setLocation(input,feature){
    const coords=feature?.geometry?.coordinates;
    if(!Array.isArray(coords)||coords.length<2)return;
    const lng=Number(coords[0]),lat=Number(coords[1]);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    const prefix=input.name;
    input.value=addressLabel(feature.properties)||input.value;
    input.dataset.justSelected='true';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    const code=window.OpenLocationCode?.encode(lat,lng,10)||'';
    for(const [suffix,value] of Object.entries({latitude:lat,longitude:lng,plus_code:code,geohash:geohash(lat,lng)})){
      ensureHidden(prefix+'_'+suffix).value=String(value);
    }
    input.dataset.locationSelected='true';
    const pinButton=input.nextElementSibling;
    if(pinButton&&pinButton.textContent.toLowerCase().includes('pin'))pinButton.textContent=code?'Pin selected · '+code:'Pin selected';
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function attach(input,label){
    const wrap=input.parentElement;
    wrap.classList.add('address-field-wrap');
    const list=document.createElement('div');
    list.className='address-suggestions';
    list.id=input.id+'-suggestions';
    list.setAttribute('role','listbox');
    list.hidden=true;
    wrap.append(list);
    input.setAttribute('role','combobox');
    input.setAttribute('aria-autocomplete','list');
    input.setAttribute('aria-expanded','false');
    input.setAttribute('aria-controls',list.id);
    const status=document.createElement('p');
    status.className='address-search-status';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    wrap.append(status);
    let timer=null,controller=null,features=[],active=-1,suppress=false;
    const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
    const choose=index=>{
      const feature=features[index];if(!feature)return;
      setLocation(input,feature);
      close();status.textContent='Address selected. Check the pin and adjust it if the entrance is different.';
    };
    const highlight=()=>{
      [...list.querySelectorAll('button')].forEach((button,i)=>button.setAttribute('aria-selected',String(i===active)));
      const target=list.querySelectorAll('button')[active];
      if(target){input.setAttribute('aria-activedescendant',target.id);target.scrollIntoView({block:'nearest'});}
    };
    const render=items=>{
      features=items;list.replaceChildren();active=-1;
      items.forEach((feature,index)=>{
        const props=feature.properties||{};
        const full=addressLabel(props);
        if(!full)return;
        const button=document.createElement('button');button.type='button';button.id=list.id+'-'+index;button.setAttribute('role','option');button.setAttribute('aria-selected','false');
        const main=document.createElement('span');main.className='suggestion-main';main.textContent=props.name||[props.housenumber,props.street].filter(Boolean).join(' ')||full.split(',')[0];
        const meta=document.createElement('span');meta.className='suggestion-meta';meta.textContent=full;
        button.append(main,meta);
        button.addEventListener('mousedown',event=>event.preventDefault());
        button.addEventListener('click',()=>choose(index));
        list.append(button);
      });
      if(list.children.length){list.hidden=false;input.setAttribute('aria-expanded','true');}
      else close();
    };
    async function search(query){
      controller?.abort();controller=new AbortController();
      status.textContent='Finding matching addresses…';
      try{
        const url='https://photon.komoot.io/api/?'+new URLSearchParams({q:query,limit:'6',lang:'en'});
        const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error('Address search unavailable');
        const data=await response.json();
        const items=(data.features||[]).filter(item=>item.geometry?.type==='Point'&&Array.isArray(item.geometry.coordinates));
        render(items);
        status.textContent=items.length?'Choose the closest match. You can fine-tune the pin on the map.':'No matching addresses found. Try adding the suburb, city or postal code.';
      }catch(error){
        if(error.name==='AbortError')return;
        close();status.textContent='Address suggestions are temporarily unavailable. You can still enter the address and use Pick / copy pin.';
      }
    }
    input.addEventListener('input',()=>{
      if(input.dataset.justSelected==='true'){delete input.dataset.justSelected;return;}
      if(suppress){suppress=false;return;}
      input.dataset.locationSelected='false';
      clearTimeout(timer);controller?.abort();close();
      const query=input.value.trim();
      if(query.length<3){status.textContent='Type at least 3 characters for address suggestions.';return;}
      timer=setTimeout(()=>search(query),350);
    });
    input.addEventListener('keydown',event=>{
      if(list.hidden)return;
      const count=list.querySelectorAll('button').length;
      if(event.key==='ArrowDown'){event.preventDefault();active=Math.min(active+1,count-1);highlight();}
      else if(event.key==='ArrowUp'){event.preventDefault();active=Math.max(active-1,0);highlight();}
      else if(event.key==='Enter'&&active>=0){event.preventDefault();choose(active);}
      else if(event.key==='Escape'){close();}
    });
    input.addEventListener('blur',()=>setTimeout(()=>{if(!wrap.contains(document.activeElement))close();},120));
    input.addEventListener('focus',()=>{if(input.value.trim().length>=3&&!input.dataset.locationSelected)input.dispatchEvent(new Event('input'));});
    input.addEventListener('change',()=>{if(!input.value.trim())status.textContent='';});
    status.textContent='Type at least 3 characters for address suggestions.';
  }
  for(const [id,label] of [['custPickup','Pickup'],['custDropoff','Drop-off']]){
    const input=document.getElementById(id);
    if(input)attach(input,label);
  }
  const helper=document.createElement('p');
  helper.className='address-helper';
  helper.textContent='Start typing to choose a suggested address. Then use Pick / copy pin to confirm the exact gate, entrance or collection point. Address matches are suggestions; always verify the map pin.';
  const first=document.getElementById('custPickup');
  first?.parentElement?.insertAdjacentElement('afterend',helper);
})();