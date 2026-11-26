(() => {
  const form = document.getElementById('booking-form');
  if (!form) return;

  const style = document.createElement('style');
  style.textContent = `
    .address-field-wrap{position:relative}
    .address-suggestions{position:absolute;z-index:1500;left:0;right:0;top:100%;margin-top:5px;background:#fff;border:1px solid #d8e1dc;border-radius:12px;box-shadow:0 14px 34px #142d2326;max-height:250px;overflow:auto}
    .address-suggestions button{display:block;width:100%;padding:12px 14px;border:0;border-bottom:1px solid #edf1ee;border-radius:0;background:#fff;text-align:left;font-size:12px;line-height:1.45;color:#17352e;white-space:normal}
    .address-suggestions button:last-child{border-bottom:0}
    .address-suggestions button:hover,.address-suggestions button[aria-selected=true]{background:#f0f5f2}
    .address-suggestions .suggestion-main{display:block;font-weight:750}
    .address-suggestions .suggestion-meta{display:block;margin-top:3px;color:#687970;font-size:10px;font-weight:500}
    .address-search-status{min-height:14px;margin:4px 0 0;color:#718078;font-size:10px;line-height:1.4}
    .address-helper,.address-search-button,.swift-pin-button{display:none!important}
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
    if(p.display_name)return String(p.display_name);
    const house=p.housenumber||p.house_number||p.house_no||p.street_number||'';
    const road=p.street||p.road||p.route||p.pedestrian||p.footway||'';
    const street=[house,road].filter(Boolean).join(' ').trim();
    const first=street||p.name||road||p.locality||'';
    const areas=[p.suburb||p.sublocality,p.neighbourhood,p.district,p.city||p.locality||p.town||p.village,p.county,p.state||p.province,p.postcode||p.postal_code,p.country||'South Africa'];
    return [...new Set([first,...areas].map(x=>String(x||'').trim()).filter(Boolean))].join(', ')||p.name||'';
  }
  function setLocation(input,feature){
    const coords=feature?.geometry?.coordinates;
    if(!Array.isArray(coords)||coords.length<2)return;
    const lng=Number(coords[0]),lat=Number(coords[1]);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    const prefix=input.name;
    input.value=addressLabel(feature.properties)||input.value;
    input.dataset.justSelected='true';
    input.dataset.locationSelected='true';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    const code=window.OpenLocationCode?.encode(lat,lng,10)||'';
    for(const [suffix,value] of Object.entries({latitude:lat,longitude:lng,plus_code:code,geohash:geohash(lat,lng)})){
      ensureHidden(prefix+'_'+suffix).value=String(value);
    }
    input.dispatchEvent(new Event('change',{bubbles:true}));
    window.swiftHaulShowAddressOnMap?.(input,lat,lng);
  }
  function asFeature(result){
    if(result?.type==='Feature'&&result.geometry?.type==='Point')return result;
    const address=result.address||{};
    return {type:'Feature',geometry:{type:'Point',coordinates:[Number(result.lon),Number(result.lat)]},properties:{...address,name:result.name||'',display_name:result.display_name||'',countrycode:'za'}};
  }
  function attach(input){
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
    const status=document.createElement('p');
    status.className='address-search-status';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    wrap.append(status);
    let controller=null,features=[],active=-1,debounce=null,requestNumber=0;
    const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
    const choose=async index=>{
      let feature=features[index];if(!feature)return;
      try{
        if(feature.properties?.__googlePrediction){
          const prediction=feature.properties.__googlePrediction;
          const place=prediction.toPlace();
          await place.fetchFields({fields:['location','formattedAddress','displayName','addressComponents']});
          if(!place.location)throw new Error('Google Maps did not return a map point for this address.');
          const components={};
          for(const component of place.addressComponents||[]){
            const value=component.longText||component.shortText||'';
            for(const type of component.types||[]){
              if(type==='street_number')components.street_number=value;
              if(type==='route')components.route=value;
              if(type==='sublocality_level_1'||type==='sublocality')components.sublocality=value;
              if(type==='neighborhood')components.neighbourhood=value;
              if(type==='locality')components.locality=value;
              if(type==='administrative_area_level_2')components.district=value;
              if(type==='administrative_area_level_1')components.province=value;
              if(type==='postal_code')components.postal_code=value;
              if(type==='country')components.country=value;
            }
          }
          feature={type:'Feature',geometry:{type:'Point',coordinates:[place.location.lng(),place.location.lat()]},
            properties:{...components,name:String(place.displayName||''),display_name:String(place.formattedAddress||feature.properties.display_name||''),countrycode:'za'}};
          googleSessionToken=null;
        }
        setLocation(input,feature);
        close();
        status.textContent='Google Maps address selected. The map pin uses the selected place coordinates; check the entrance before booking.';
      }catch(error){
        status.textContent=error.message||'Could not load the selected Google Maps address. Please choose it again.';
      }
    };
    const highlight=()=>{
      [...list.querySelectorAll('button')].forEach((button,i)=>button.setAttribute('aria-selected',String(i===active)));
      const target=list.querySelectorAll('button')[active];
      if(target){input.setAttribute('aria-activedescendant',target.id);target.scrollIntoView({block:'nearest'});}
    };
    const render=items=>{
      features=items;list.replaceChildren();active=-1;
      items.forEach((feature,index)=>{
        const props=feature.properties||{},full=addressLabel(props);
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
    let googleSessionToken=null;
    async function googlePlacesSearch(query,signal){
      if(!window.google?.maps?.importLibrary)return null;
      const places=await window.google.maps.importLibrary('places');
      if(signal.aborted)throw new DOMException('Search cancelled','AbortError');
      if(!places?.AutocompleteSuggestion||!places?.AutocompleteSessionToken)return null;
      googleSessionToken ||= new places.AutocompleteSessionToken();
      const {suggestions=[]}=await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input:query,
        includedRegionCodes:['za'],
        locationRestriction:{west:16,south:-35,east:33,north:-22},
        language:'en',
        region:'za',
        sessionToken:googleSessionToken
      });
      if(signal.aborted)throw new DOMException('Search cancelled','AbortError');
      return suggestions.slice(0,8).filter(item=>item.placePrediction).map(item=>{
        const prediction=item.placePrediction;
        const description=String(prediction.text||'');
        return {type:'Feature',geometry:null,properties:{
          name:description.split(',')[0]||'Address suggestion',
          display_name:description,countrycode:'za',__googlePrediction:prediction
        }};
      });
    }
    async function search(query,sequence){
      controller?.abort();const activeController=new AbortController();controller=activeController;
      status.textContent='Searching Google Maps for South African addresses…';
      const cacheKey='google:'+query.toLocaleLowerCase();
      try{
        let features=resultCache.get(cacheKey);
        if(!features){
          features=await googlePlacesSearch(query,activeController.signal);
          if(features===null){
            const params=new URLSearchParams({q:query,limit:'8',lang:'en',bbox:'16,-35,33,-22',countrycode:'ZA'});
            for(const layer of ['house','street','locality','district','city','other'])params.append('layer',layer);
            const response=await fetch('https://photon.komoot.io/api/?'+params.toString(),{signal:activeController.signal,headers:{Accept:'application/json'}});
            if(!response.ok)throw new Error('South African address search unavailable ('+response.status+').');
            const data=await response.json();
            features=(data.features||[]).filter(feature=>{
              const coords=feature?.geometry?.coordinates||[],p=feature?.properties||{};
              const lng=Number(coords[0]),lat=Number(coords[1]),country=String(p.countrycode||'za').toLowerCase();
              return Number.isFinite(lng)&&Number.isFinite(lat)&&lng>=16&&lng<=33&&lat>=-35&&lat<=-22&&country==='za';
            });
          }
          resultCache.set(cacheKey,features||[]);
          if(resultCache.size>80)resultCache.delete(resultCache.keys().next().value);
        }
        if(activeController.signal.aborted||sequence!==requestNumber)return;
        const items=(features||[]).filter(item=>item?.properties?.__googlePrediction||(Array.isArray(item?.geometry?.coordinates)&&item.geometry.coordinates.length>=2)).map(asFeature).filter(item=>item.properties?.__googlePrediction||(Number.isFinite(item.geometry.coordinates[0])&&Number.isFinite(item.geometry.coordinates[1])));
        render(items);
        status.textContent=items.length?'Choose the matching address. Google Maps coordinates will be used for the map pin and route.':'No matching South African address found. Add the street, suburb and city, or try a nearby landmark.';
      }catch(error){
        if(error.name==='AbortError'||activeController.signal.aborted)return;
        close();status.textContent='Google Maps address search is temporarily unavailable. Please try again.';
      }
    }
    input.addEventListener('input',()=>{
      if(input.dataset.justSelected==='true'){delete input.dataset.justSelected;return;}
      input.dataset.locationSelected='false';
      for(const suffix of ['latitude','longitude','plus_code','geohash']){
        const hidden=form.querySelector('[name="'+input.name+'_'+suffix+'"]');
        if(hidden)hidden.value='';
      }
      controller?.abort();close();clearTimeout(debounce);
      const query=input.value.trim(),sequence=++requestNumber;
      if(query.length<3){status.textContent='Enter at least 3 characters to search South African addresses.';return;}
      debounce=setTimeout(()=>search(query,sequence),450);
    });
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){
        if(!list.hidden&&active>=0){event.preventDefault();choose(active);}
        else if(!list.hidden&&list.children.length===1){event.preventDefault();choose(0);}
        return;
      }
      if(list.hidden)return;
      const count=list.querySelectorAll('button').length;
      if(event.key==='ArrowDown'){event.preventDefault();active=Math.min(active+1,count-1);highlight();}
      else if(event.key==='ArrowUp'){event.preventDefault();active=Math.max(active-1,0);highlight();}
      else if(event.key==='Escape'){close();}
    });
    input.addEventListener('blur',()=>setTimeout(()=>{if(!wrap.contains(document.activeElement))close();},150));
    input.addEventListener('change',()=>{if(!input.value.trim())status.textContent='';});
    status.textContent='';
  }
  for(const id of ['custPickup','custDropoff']){
    const input=document.getElementById(id);
    if(input)attach(input);
  }
})();