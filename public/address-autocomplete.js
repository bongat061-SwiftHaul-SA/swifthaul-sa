(() => {
  const form = document.getElementById('booking-form');
  if (!form) return;

  const style = document.createElement('style');
  style.textContent = `
    .address-suggestions{position:absolute;z-index:1200;left:0;right:0;top:100%;margin-top:5px;background:#111923;border:1px solid #465467;border-radius:12px;box-shadow:0 12px 30px #0008;max-height:260px;overflow:auto}
    .address-field-wrap{position:relative}
    .address-suggestions button{display:block;width:100%;padding:12px 14px;border:0;border-bottom:1px solid #2b3745;border-radius:0;background:#111923;text-align:left;font-size:12px;line-height:1.55;color:#edf2f7;white-space:normal}
    .address-suggestions button:last-child{border-bottom:0}
    .address-suggestions button:hover,.address-suggestions button[aria-selected=true]{background:#273444}
    .address-suggestions .suggestion-main{display:block;font-weight:700}
    .address-suggestions .suggestion-meta{display:block;margin-top:3px;color:#aab7c7;font-size:10px;font-weight:500}
    .address-search-status{min-height:16px;margin:5px 0 0;color:#aab7c7;font-size:10px;line-height:1.5}
    .address-search-button{margin:6px 0 0!important;padding:7px 10px!important;border:1px solid #536276!important;border-radius:8px!important;background:#202b39!important;color:#eef2f7!important;font-size:10px!important;font-weight:800}
    .address-helper{margin:0 0 14px;color:#aab7c7;font-size:11px;line-height:1.65}
  `;
  document.head.append(style);

  const alphabet='0123456789bcdefghjkmnpqrstuvwxyz';
  const resultCache=new Map();
  if(!window.swiftHaulNominatimFetch){
    let queue=Promise.resolve(),lastRequestAt=0;
    window.swiftHaulNominatimFetch=(url,options={})=>{
      const task=queue.then(async()=>{
        if(options.signal?.aborted)throw new DOMException('Search cancelled','AbortError');
        const wait=Math.max(0,1100-(Date.now()-lastRequestAt));
        if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
        if(options.signal?.aborted)throw new DOMException('Search cancelled','AbortError');
        lastRequestAt=Date.now();
        return fetch(url,options);
      });
      queue=task.catch(()=>{});
      return task;
    };
  }
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
    const road=p.road||p.pedestrian||p.footway||p.street||'';
    const street=[p.house_number,p.housenumber,road].filter(Boolean).join(' ');
    const first=street||p.name||p.display_name?.split(',')[0]||road;
    const areas=[p.neighbourhood,p.suburb,p.city_district,p.district,p.city||p.town||p.village,p.county,p.state,p.postcode,p.country].filter(Boolean);
    return [...new Set([first,...areas].filter(Boolean))].join(', ')||p.display_name||'';
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
    input.dispatchEvent(new Event('change',{bubbles:true}));
    window.swiftHaulShowAddressOnMap?.(input,lat,lng);
    const pinButton=input.nextElementSibling;
    if(pinButton&&pinButton.classList.contains('swift-pin-button'))pinButton.textContent='◎ Adjust pin on map';
  }
  function asFeature(result){
    const address=result.address||{};
    return {
      geometry:{type:'Point',coordinates:[Number(result.lon),Number(result.lat)]},
      properties:{...address,name:result.name||'',display_name:result.display_name||''}
    };
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
    input.setAttribute('autocomplete','off');
    const searchButton=document.createElement('button');
    searchButton.type='button';
    searchButton.className='address-search-button';
    searchButton.textContent='Search address';
    input.insertAdjacentElement('afterend',searchButton);
    const status=document.createElement('p');
    status.className='address-search-status';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    wrap.append(status);
    let controller=null,features=[],active=-1;
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
        const main=document.createElement('span');main.className='suggestion-main';main.textContent=props.name||[props.house_number,props.road].filter(Boolean).join(' ')||full.split(',')[0];
        const meta=document.createElement('span');meta.className='suggestion-meta';meta.textContent=full;
        button.append(main,meta);
        button.addEventListener('mousedown',event=>event.preventDefault());
        button.addEventListener('click',()=>choose(index));
        list.append(button);
      });
      if(list.children.length){list.hidden=false;input.setAttribute('aria-expanded','true');}
      else close();
    };
    async function search(){
      const query=input.value.trim();
      if(query.length<3){status.textContent='Enter at least 3 characters, then search.';return;}
      controller?.abort();const activeController=new AbortController();controller=activeController;
      status.textContent='Searching OpenStreetMap addresses…';
      const cacheKey=query.toLocaleLowerCase();
      try{
        let results=resultCache.get(cacheKey);
        if(!results){
          const params=new URLSearchParams({q:query,format:'jsonv2',addressdetails:'1',limit:'8',countrycodes:'za','accept-language':'en'});
          const response=await window.swiftHaulNominatimFetch('https://nominatim.openstreetmap.org/search?'+params.toString(),{
            signal:activeController.signal,headers:{Accept:'application/json'}
          });
          if(!response.ok)throw new Error('Nominatim address search unavailable ('+response.status+').');
          results=await response.json();
          resultCache.set(cacheKey,results);
          if(resultCache.size>80)resultCache.delete(resultCache.keys().next().value);
        }
        if(activeController.signal.aborted)return;
        const items=results.map(asFeature).filter(item=>Number.isFinite(item.geometry.coordinates[0])&&Number.isFinite(item.geometry.coordinates[1]));
        render(items);
        status.textContent=items.length?'Choose the closest match. Then check and adjust its exact map pin.':'No matching address found. Try adding the suburb, city, province or postal code.';
      }catch(error){
        if(error.name==='AbortError'||activeController.signal.aborted)return;
        close();status.textContent='Nominatim search is temporarily unavailable. You can still type an address and place both pins manually.';
      }
    }
    searchButton.addEventListener('click',search);
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){
        event.preventDefault();
        if(!list.hidden&&active>=0)choose(active);else search();
        return;
      }
      if(list.hidden)return;
      const count=list.querySelectorAll('button').length;
      if(event.key==='ArrowDown'){event.preventDefault();active=Math.min(active+1,count-1);highlight();}
      else if(event.key==='ArrowUp'){event.preventDefault();active=Math.max(active-1,0);highlight();}
      else if(event.key==='Escape'){close();}
    });
    input.addEventListener('input',()=>{
      if(input.dataset.justSelected==='true'){delete input.dataset.justSelected;return;}
      input.dataset.locationSelected='false';
      for(const suffix of ['latitude','longitude','plus_code','geohash']){
        const hidden=form.querySelector('[name="'+input.name+'_'+suffix+'"]');
        if(hidden)hidden.value='';
      }
      controller?.abort();close();
      status.textContent='Edit the address, then tap Search address. The public Nominatim service is queried only when requested.';
    });
    input.addEventListener('blur',()=>setTimeout(()=>{if(!wrap.contains(document.activeElement))close();},120));
    input.addEventListener('change',()=>{if(!input.value.trim())status.textContent='';});
    status.textContent='Enter an address and tap Search address to see OpenStreetMap matches.';
  }
  for(const [id,label] of [['custPickup','Pickup'],['custDropoff','Drop-off']]){
    const input=document.getElementById(id);
    if(input)attach(input,label);
  }
  const helper=document.createElement('p');
  helper.className='address-helper';
  helper.textContent='Search for each address, choose the closest OpenStreetMap match, then confirm the exact gate or entrance on the map. Plus Codes are generated from the confirmed pin.';
  const first=document.getElementById('custPickup');
  first?.parentElement?.insertAdjacentElement('afterend',helper);
})();
