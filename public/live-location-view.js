(() => {
  const app = document.body.dataset.app;
  if (!["customer", "company"].includes(app)) return;
  const styles = document.createElement("style");
  styles.textContent = ".live-driver-view{margin-top:14px;padding:16px;border:1px solid #343d49;border-radius:18px;background:#151a22;color:#f5f6f8;box-shadow:0 10px 26px rgba(0,0,0,.38)}.live-driver-view h3{margin:0 0 5px;font-size:16px;color:#fff}.live-driver-view .tracking-kicker{font-size:10px;letter-spacing:.14em;color:#c0c7d1;font-weight:800}.live-driver-view button{min-height:42px;border:1px solid #c0c7d1;border-radius:11px;padding:10px 15px;background:linear-gradient(180deg,#e5e9ef,#aeb8c6);color:#101216;font:inherit;font-weight:800}.live-driver-view button:hover{background:#d5dbe3}.live-driver-view .live-driver-map{height:300px;margin-top:12px;border:1px solid #343d49;border-radius:13px;overflow:hidden;background:#eef3f9}.live-driver-view .live-driver-status{font-size:12px;line-height:1.5;color:#c2c9d3}.live-tracking-details{margin-top:14px;padding:14px;border:1px solid #343d49;border-radius:14px;background:#10151c}.live-tracking-progress{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;list-style:none;padding:0;margin:12px 0 8px}.live-tracking-progress li{position:relative;padding-top:19px;font-size:10px;line-height:1.3;color:#929eac;text-align:center}.live-tracking-progress li:before{content:"";position:absolute;top:0;left:calc(50% - 6px);width:12px;height:12px;border-radius:50%;background:#424b58;border:2px solid #687382}.live-tracking-progress li[data-state="complete"]:before{background:#8c98a7;border-color:#d8dee6}.live-tracking-progress li[data-state="current"]{color:#fff;font-weight:800}.live-tracking-progress li[data-state="current"]:before{background:#d8dee6;border-color:#fff;box-shadow:0 0 0 4px #d8dee633}.live-tracking-note{margin:8px 0 0;color:#aeb8c5;font-size:11px;line-height:1.5}.live-driver-view[hidden]{display:none}";
  document.head.append(styles);
  let active = false;
  const viewers = new Map();
  const getClient = () => window.swiftHaulSupabase;
  const isActiveCard = card => ["accepted", "picked_up", "in_transit"].includes(card.dataset.deliveryStatus) ||
    /ACCEPTED|PICKED UP|IN TRANSIT/i.test(card.querySelector(".status")?.textContent || card.textContent);
  const waybillOf = card => card.dataset.waybill || card.querySelector(".waybill")?.textContent?.trim() || card.querySelector("h3")?.textContent?.trim();
  async function readLocation(waybill) {
    const client = getClient();
    if (!client) throw new Error("Secure account connection unavailable.");
    const { data, error } = await client.functions.invoke("driver-location?waybill=" + encodeURIComponent(waybill), { method: "GET" });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Unable to load driver location.");
    return data;
  }
  function attach(card) {
    const waybill = waybillOf(card);
    if (!waybill || card.querySelector(".live-driver-view") || !isActiveCard(card)) return;
    const box = document.createElement("section");
    box.className = "live-driver-view";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Track driver live";
    const kicker = document.createElement("span"); kicker.className = "tracking-kicker"; kicker.textContent = "LIVE DELIVERY MAP";
    const title = document.createElement("h3"); title.textContent = "Track Your Delivery";
    const status = document.createElement("p");
    status.className = "live-driver-status";
    status.textContent = "Driver location appears only while the driver has enabled sharing.";
    const mapNode = document.createElement("div");
    mapNode.className = "live-driver-map";
    mapNode.hidden = true;
    const details = document.createElement("div");
    details.className = "live-tracking-details";
    const progressTitle = document.createElement("strong");
    progressTitle.textContent = "Delivery progress";
    const progress = document.createElement("ol");
    progress.className = "live-tracking-progress";
    const stages = [
      ["accepted", "Driver accepted"],
      ["picked_up", "Picked up"],
      ["in_transit", "In transit"],
      ["delivered", "Delivered"]
    ];
    const current = card.dataset.deliveryStatus || "assigned";
    const currentIndex = stages.findIndex(([key]) => key === current);
    stages.forEach(([key, label], index) => {
      const item = document.createElement("li");
      item.textContent = label;
      item.dataset.state = index < currentIndex || current === "delivered" ? "complete" : index === currentIndex ? "current" : "upcoming";
      progress.append(item);
    });
    const note = document.createElement("p");
    note.className = "live-tracking-note";
    note.textContent = "ETA and driver contact details will appear when dispatch provides verified live trip information.";
    details.append(progressTitle, progress, note);
    box.append(kicker, title, button, status, mapNode, details);
    card.append(box);
    let map = null, marker = null, timer = null;
    const refresh = async () => {
      try {
        const result = await readLocation(waybill);
        if (!result.location) { status.textContent = result.message || "Driver is not sharing a live location."; return; }
        const p = result.location;
        const point = [Number(p.longitude), Number(p.latitude)];
        if (!point.every(Number.isFinite)) throw new Error("Invalid location update.");
        if (window.maplibregl) {
          if (!map) {
            map = new maplibregl.Map({ container: mapNode, center: point, zoom: 15, style: {
              version: 8, sources: { carto: { type: "raster", tiles: [
                "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
                "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
              ], tileSize: 256, attribution: "© OpenStreetMap contributors © CARTO" } },
              layers: [{ id: "carto-voyager", type: "raster", source: "carto" }]
            }});
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
            map.on("load", () => {
              if (marker) marker.setLngLat(point);
              const pickup = [Number(card.dataset.pickupLongitude), Number(card.dataset.pickupLatitude)];
              const dropoff = [Number(card.dataset.dropoffLongitude), Number(card.dataset.dropoffLatitude)];
              if (pickup.every(Number.isFinite) && dropoff.every(Number.isFinite)) {
                map.addSource("delivery-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [pickup, dropoff] } } });
                map.addLayer({ id: "delivery-route-line", type: "line", source: "delivery-route", paint: { "line-color": "#2878d7", "line-width": 5, "line-opacity": 0.9 } });
                new maplibregl.Marker({ color: "#16845b" }).setLngLat(pickup).addTo(map);
                new maplibregl.Marker({ color: "#d64b4b" }).setLngLat(dropoff).addTo(map);
                map.fitBounds([pickup, dropoff], { padding: 48, maxZoom: 14 });
              }
            });
          }
          if (!marker) {
            const el = document.createElement("div");
            el.style.cssText = "width:20px;height:20px;border:4px solid #fff;border-radius:50%;background:#24558a;box-shadow:0 2px 12px #0006";
            marker = new maplibregl.Marker({ element: el }).setLngLat(point).addTo(map);
          } else marker.setLngLat(point);
          if (map.loaded()) map.easeTo({ center: point, duration: 500 });
          mapNode.hidden = false;
          requestAnimationFrame(() => map?.resize());
        }
        status.textContent = "Live location updated " + new Date(p.updated_at).toLocaleTimeString("en-ZA") +
          (p.accuracy_m == null ? "" : " · GPS accuracy ±" + Math.round(p.accuracy_m) + " m");
      } catch (error) { status.textContent = error.message; }
    };
    button.addEventListener("click", () => {
      if (timer) {
        clearInterval(timer); timer = null;
        if (map) { map.remove(); map = null; marker = null; }
        mapNode.hidden = true;
        button.textContent = "Track driver live";
        status.textContent = "Live tracking paused.";
        return;
      }
      button.textContent = "Pause live tracking";
      refresh();
      timer = setInterval(refresh, 10000);
    });
    viewers.set(waybill, () => { if (timer) clearInterval(timer); if (map) map.remove(); });
  }
  function scan() {
    if (!active || document.body.dataset.guestPreview === "true") return;
    const root = app === "customer" ? document.getElementById("ordersContainer") : document.querySelector("#dispatches .operations-list");
    root?.querySelectorAll(".order").forEach(attach);
  }
  document.addEventListener("account-ready", () => { active = true; scan(); });
  const clear = () => {
    active = false;
    for (const dispose of viewers.values()) dispose();
    viewers.clear();
  };
  document.addEventListener("account-cleared", clear);
  document.addEventListener("guest-preview", clear);
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
})();
