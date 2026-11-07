(() => {
  const app = document.body.dataset.app;
  if (!["customer", "company"].includes(app)) return;
  const styles = document.createElement("style");
  styles.textContent = ".live-driver-view{margin-top:12px;padding:12px;border:1px solid #dce7df;border-radius:14px;background:#f8fbf8}.live-driver-view button{border:0;border-radius:10px;padding:10px 14px;background:#173d31;color:#fff;font-weight:800}.live-driver-view .live-driver-map{height:230px;margin-top:10px;border-radius:12px;overflow:hidden;background:#e7eee8}.live-driver-view .live-driver-status{font-size:12px;color:#60746a}.live-driver-view[hidden]{display:none}";
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
    const status = document.createElement("p");
    status.className = "live-driver-status";
    status.textContent = "Driver location appears only while the driver has enabled sharing.";
    const mapNode = document.createElement("div");
    mapNode.className = "live-driver-map";
    mapNode.hidden = true;
    box.append(button, status, mapNode);
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
            map.on("load", () => { if (marker) marker.setLngLat(point); });
          }
          if (!marker) {
            const el = document.createElement("div");
            el.style.cssText = "width:20px;height:20px;border:4px solid #fff;border-radius:50%;background:#16845b;box-shadow:0 2px 12px #0006";
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
