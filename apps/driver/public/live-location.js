(() => {
  if (document.body.dataset.app !== "driver") return;
  const activeStatuses = new Set(["assigned", "accepted", "picked_up", "in_transit"]);
  const watches = new Map();
  let enabled = false;
  let syncTimer = null;

  const client = () => window.swiftHaulSupabase;
  async function locationRequest(body) {
    const supabase = client();
    if (!supabase) throw new Error("Secure account connection is unavailable.");
    const { data, error } = await supabase.functions.invoke("driver-location", { body });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Location sharing failed.");
    return data;
  }
  function stopLocal(waybill, notify = true) {
    const entry = watches.get(waybill);
    if (!entry) return;
    if (entry.watch !== null) navigator.geolocation.clearWatch(entry.watch);
    watches.delete(waybill);
    if (notify) locationRequest({ waybill, sharing: false }).catch(() => {});
    entry.status.textContent = "Location sharing is off.";
    entry.start.disabled = false;
    entry.stop.disabled = true;
  }
  function attach(card, order) {
    if (card.querySelector(".live-location-control")) return;
    const wrap = document.createElement("section");
    wrap.className = "live-location-control";
    const title = document.createElement("strong");
    title.textContent = "Live location sharing";
    const explanation = document.createElement("p");
    explanation.textContent = "Share your GPS position with this delivery’s customer and authorised dispatch staff. Sharing is optional and stops when you turn it off or the delivery closes.";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Not sharing";
    const start = document.createElement("button");
    start.type = "button";
    start.textContent = "Start sharing";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = "Stop sharing";
    stop.disabled = true;
    wrap.append(title, explanation, status, start, stop);
    card.append(wrap);

    start.addEventListener("click", () => {
      if (!navigator.geolocation) { status.textContent = "This device does not support GPS location."; return; }
      if (watches.has(order.waybill)) return;
      status.textContent = "Requesting location permission…";
      start.disabled = true;
      const publish = async position => {
        const c = position.coords;
        try {
          await locationRequest({ waybill: order.waybill, sharing: true,
            latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy });
          status.textContent = "Sharing live location · updated " +
            new Date(position.timestamp).toLocaleTimeString("en-ZA");
          stop.disabled = false;
        } catch (error) {
          status.textContent = error.message;
          stopLocal(order.waybill, false);
        }
      };
      const fail = error => {
        status.textContent = error.code === 1 ? "Location permission was denied." : "GPS signal unavailable. Check device location settings.";
        stopLocal(order.waybill, true);
      };
      navigator.geolocation.getCurrentPosition(async position => {
        await publish(position);
        if (!watches.has(order.waybill)) {
          const watch = navigator.geolocation.watchPosition(p => {
            const current = watches.get(order.waybill);
            if (!current || Date.now() - current.lastSent < 8000) return;
            current.lastSent = Date.now();
            publish(p);
          }, fail, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
          watches.set(order.waybill, { watch, status, start, stop, lastSent: Date.now() });
          stop.disabled = false;
        }
      }, fail, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    });
    stop.addEventListener("click", () => stopLocal(order.waybill));
  }
  async function sync() {
    if (!enabled || document.body.dataset.guestPreview === "true") return;
    const supabase = client();
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke("dispatch-operations", { method: "GET" });
    if (error || !Array.isArray(data?.orders)) return;
    const cards = [...document.querySelectorAll("#dispatches .operations-list .order")];
    for (const order of data.orders) {
      if (!activeStatuses.has(order.status)) { stopLocal(order.waybill); continue; }
      const card = cards.find(item => item.querySelector("h3")?.textContent === order.waybill);
      if (card) attach(card, order);
    }
  }
  document.addEventListener("account-ready", () => {
    enabled = true;
    sync();
    syncTimer = setInterval(sync, 15000);
  });
  const clear = () => {
    enabled = false;
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    for (const waybill of [...watches.keys()]) stopLocal(waybill);
  };
  document.addEventListener("account-cleared", clear);
  document.addEventListener("guest-preview", clear);
  window.addEventListener("pagehide", clear);
})();
