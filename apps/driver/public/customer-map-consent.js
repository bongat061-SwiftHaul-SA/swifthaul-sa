(() => {
  if (document.body.dataset.app !== "driver") return;
  const panel = document.getElementById("availability");
  if (!panel || panel.querySelector("#customer-map-consent")) return;
  const section = document.createElement("section");
  section.id = "customer-map-consent";
  section.className = "customer-map-consent";
  section.innerHTML = '<h3>Customer availability map</h3><p>Choose whether customers may see an approximate, grouped position for your online area before they book. Your name, phone number and exact GPS position are never shown. This is optional and separate from other bonus or reward settings. You can withdraw consent at any time.</p><label><input type="checkbox" id="customer-map-opt-in"><span>Allow my approximate online location to appear on the customer availability map.</span></label><p id="customer-map-consent-status" role="status" aria-live="polite">Loading your privacy preference…</p>';
  const controls = panel.querySelector(".driver-availability-controls");
  (controls || panel).after(section);
  const checkbox = section.querySelector("#customer-map-opt-in");
  const status = section.querySelector("#customer-map-consent-status");
  let loaded = false, saving = false;
  async function invoke(action, opt_in) {
    const client = window.swiftHaulSupabase;
    if (!client) throw new Error("Secure account connection unavailable.");
    const { data, error } = await client.functions.invoke("customer-driver-availability", {
      body: action === "get_consent" ? { action } : { action, opt_in }
    });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Privacy preference could not be saved.");
    return data;
  }
  async function load() {
    loaded = false; checkbox.disabled = true; status.textContent = "Loading your privacy preference…";
    try {
      const data = await invoke("get_consent");
      checkbox.checked = data.opt_in === true;
      status.textContent = checkbox.checked ? "Your approximate map sharing consent is ON." : "Your approximate map sharing consent is OFF.";
      loaded = true; checkbox.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }
  checkbox.addEventListener("change", async () => {
    if (!loaded || saving) return;
    const next = checkbox.checked; saving = true; checkbox.disabled = true;
    status.textContent = "Saving your privacy preference…";
    try {
      const data = await invoke("set_consent", next);
      checkbox.checked = data.opt_in === true;
      status.textContent = checkbox.checked ? "Saved. Your approximate position may appear while you are online." : "Saved. Your location will no longer appear on the customer map.";
    } catch (error) {
      checkbox.checked = !next; status.textContent = error.message;
    } finally { saving = false; checkbox.disabled = false; }
  });
  document.addEventListener("account-ready", load);
  document.addEventListener("account-cleared", () => { loaded = false; checkbox.checked = false; checkbox.disabled = true; status.textContent = "Sign in to manage this privacy preference."; });
  document.addEventListener("guest-preview", () => { loaded = false; checkbox.checked = false; checkbox.disabled = true; status.textContent = "Sign in to manage this privacy preference."; });
})();