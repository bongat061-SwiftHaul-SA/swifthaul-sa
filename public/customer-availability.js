(() => {
  const home = document.getElementById("customer-home");
  if (!home || home.querySelector("#customer-driver-availability")) return;
  const card = document.createElement("section");
  card.id = "customer-driver-availability";
  card.className = "customer-driver-availability";
  card.innerHTML = '<div class="availability-heading"><div><span class="availability-kicker">BEFORE YOU BOOK</span><h2>Drivers near your area</h2><p>Check general online availability before entering your delivery details.</p></div><span class="availability-live-dot" aria-hidden="true"></span></div><div class="availability-search"><input id="availability-area" type="search" maxlength="140" placeholder="Enter suburb, town or city" aria-label="Search an area"><button type="button" id="availability-search-button">Search</button></div><div class="availability-map-wrap"><div id="customer-availability-map" role="img" aria-label="Approximate online driver availability map"></div><div class="availability-map-hint" id="availability-map-hint">Search for an area to view nearby availability.</div></div><div class="availability-result" role="status" aria-live="polite"><strong id="availability-count">Choose an area to begin</strong><span id="availability-updated">No driver locations are shared until drivers opt in.</span></div><div class="availability-actions"><button type="button" id="availability-refresh">↻ Refresh availability</button><button type="button" id="availability-use-location">Use my location</button></div><p class="availability-privacy">Map markers show approximate areas, not exact driver locations. Online availability does not guarantee a driver assignment.</p>';
  const intro = home.querySelector(".customer-home-intro");
  (intro || home).after(card);
  const $ = id => card.querySelector("#" + id);
  const mapEl = $("customer-availability-map"), hint = $("availability-map-hint");
  const countEl = $("availability-count"), updatedEl = $("availability-updated");
  const endpoint = "https://tagkbropgzthsbjlhyvz.supabase.co/functions/v1/customer-driver-availability";
  let map = null, markers = [], geocoder = null, ready = false, timer = null, lastFetch = 0;
  function setStatus(title, detail) { countEl.textContent = title; updatedEl.textContent = detail; }
  function clearMarkers() { markers.forEach(m => m.setMap(null)); markers = []; }
  async function init() {
    if (ready) return;
    try {
      const maps = await window.SwiftHaulGoogleMaps?.load();
      if (!maps) throw new Error("Map service unavailable.");
      map = new maps.Map(mapEl, { center: {lat:-29.0,lng:24.0}, zoom:5, mapTypeControl:false, streetViewControl:false, fullscreenControl:false, zoomControl:true, gestureHandling:"greedy", clickableIcons:false });
      geocoder = new maps.Geocoder(); ready = true;
      maps.event.addListener(map, "idle", () => { clearTimeout(timer); timer=setTimeout(fetchAvailability,450); });
      hint.hidden = true;
    } catch (error) {
      hint.textContent = "The map is temporarily unavailable. You can still continue with your booking.";
      setStatus("Availability map unavailable", "Please try again shortly or continue with your booking.");
    }
  }
  function boundsQuery() {
    const b = map?.getBounds(); if (!b) return null;
    const sw=b.getSouthWest(), ne=b.getNorthEast();
    const south=sw.lat(), west=sw.lng(), north=ne.lat(), east=ne.lng();
    if (north-south>1.5 || east-west>1.5) return null;
    return new URLSearchParams({south,west,north,east}).toString();
  }
  async function fetchAvailability(force=false) {
    if (!ready || !map) return;
    if (!force && Date.now()-lastFetch<5000) return;
    const query=boundsQuery();
    if (!query) { setStatus("Zoom in to check this area", "Search for a suburb or town, then zoom in to see local availability."); return; }
    lastFetch=Date.now(); $("availability-refresh").disabled=true;
    setStatus("Checking nearby drivers…","Looking for recently updated, opted-in online drivers.");
    try {
      const response=await fetch(endpoint+"?"+query,{headers:{"apikey":"sb_publishable_QWOeGbSVs2nXECI-KsAmWQ_K_Rav892"},cache:"no-store"});
      if(!response.ok) throw new Error("Availability check is temporarily unavailable.");
      const data=await response.json(); clearMarkers();
      const maps=window.google.maps;
      (data.points||[]).forEach(point=>{
        const marker=new maps.Marker({map,position:{lat:point.latitude,lng:point.longitude},title:"Approximate online driver area",icon:{path:maps.SymbolPath.CIRCLE,scale:Math.min(15,8+Number(point.count||1)),fillColor:"#d7dde3",fillOpacity:.95,strokeColor:"#303944",strokeWeight:2}});
        markers.push(marker);
      });
      const n=Number(data.onlineCount||0);
      if(n>0){setStatus(n+" online driver"+(n===1?"":"s")+" showing in this area","Updated "+new Date(data.updatedAt).toLocaleTimeString("en-ZA")+" · Approximate locations");window.dispatchEvent(new CustomEvent("swifthaul:drivers-available",{detail:{count:n}}));}
      else{setStatus("No available drivers showing in this area right now.","You can still continue with your booking, or check again shortly.");window.dispatchEvent(new CustomEvent("swifthaul:no-drivers"));}
    }catch(error){setStatus("Could not refresh driver availability",error.message+" You can still continue with your booking.");}
    finally{$("availability-refresh").disabled=false;}
  }
  function searchArea() {
    const query=$("availability-area").value.trim();
    if(!query){$("availability-area").focus();return;}
    init().then(()=>geocoder.geocode({address:query,componentRestrictions:{country:"ZA"}},(results,status)=>{
      if(status==="OK"&&results?.[0]){map.setCenter(results[0].geometry.location);map.setZoom(12);hint.hidden=true;}
      else setStatus("Area not found","Try a suburb, town or city name in South Africa.");
    }));
  }
  $("availability-search-button").addEventListener("click",searchArea);
  $("availability-area").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchArea();}});
  $("availability-refresh").addEventListener("click",()=>fetchAvailability(true));
  $("availability-use-location").addEventListener("click",()=>{
    if(!navigator.geolocation){setStatus("Location unavailable","Enter your suburb or city in the search box.");return;}
    $("availability-use-location").disabled=true;
    navigator.geolocation.getCurrentPosition(p=>{init().then(()=>{map.setCenter({lat:p.coords.latitude,lng:p.coords.longitude});map.setZoom(12);$("availability-use-location").disabled=false;});},()=>{setStatus("Location permission unavailable","Enter your suburb or city instead.");$("availability-use-location").disabled=false;},{enableHighAccuracy:false,maximumAge:60000,timeout:10000});
  });
  document.addEventListener("account-ready", () => setTimeout(init, 250));
  document.addEventListener("guest-preview", () => setTimeout(init, 250));
  setInterval(()=>{if(document.body.dataset.customerPage==="home"&&ready)fetchAvailability(true);},30000);
})();