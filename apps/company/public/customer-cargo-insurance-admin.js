(() => {
  const root = document.getElementById('customer-cargo-insurance-admin');
  if (!root) return;
  const list = document.getElementById('customer-cargo-insurance-list');
  const status = document.getElementById('customer-cargo-insurance-status');
  const refresh = document.getElementById('customer-cargo-insurance-refresh');
  let active = false, busy = false;
  const element = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  async function load() {
    if (!active || busy || document.body.dataset.guestPreview === 'true') return;
    const client = window.swiftHaulSupabase;
    if (!client) { status.textContent = 'Secure administrator connection unavailable. Reload the page.'; return; }
    busy = true; refresh.disabled = true; status.textContent = 'Loading customer parcel insurance enquiries…';
    try {
      const { data, error } = await client.functions.invoke('customer-cargo-insurance-admin', { method: 'GET' });
      if (error) throw new Error(error.message || 'Customer insurance enquiry service unavailable.');
      if (data?.error) throw new Error(data.error);
      const rows = Array.isArray(data?.enquiries) ? data.enquiries : [];
      list.replaceChildren();
      if (!rows.length) list.append(element('p', 'No customers have requested Nedbank goods-in-transit insurance information yet.'));
      for (const row of rows) {
        const card = element('article', null, 'operation-card');
        const title = element('strong', row.waybill || 'Booking reference unavailable');
        const state = element('span', String(row.status || 'unknown').toUpperCase(), 'status');
        const route = element('p', (row.pickup || 'Pickup not recorded') + ' → ' + (row.dropoff || 'Drop-off not recorded'));
        const details = element('p', (row.vehicle || 'Vehicle not selected').toUpperCase() + ' · Delivery fare R' + Number(row.price || 0).toFixed(2));
        const created = element('p', 'Enquiry recorded with booking: ' + new Date(row.created_at).toLocaleString('en-ZA', {timeZone:'Africa/Johannesburg'}));
        const disclosure = element('p', 'ENQUIRY ONLY · No policy issued · No insurance cover confirmed');
        disclosure.className = 'subtle';
        card.append(title, state, route, details, created, disclosure);
        list.append(card);
      }
      status.textContent = rows.length + ' customer enquiry/enquiries. Contact customers through the normal customer-support process; do not represent any parcel as insured.';
    } catch (error) {
      list.replaceChildren(); status.textContent = error.message || 'Unable to load customer insurance enquiries.';
    } finally { busy = false; refresh.disabled = false; }
  }
  refresh.addEventListener('click', load);
  document.addEventListener('account-ready', () => { active = true; load(); });
  document.addEventListener('account-cleared', () => { active = false; list.replaceChildren(); status.textContent = 'Sign in as an administrator to view customer enquiries.'; });
  document.addEventListener('guest-preview', () => { active = false; list.replaceChildren(); status.textContent = 'Administrator sign-in required.'; });
})();