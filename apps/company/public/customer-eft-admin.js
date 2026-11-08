(() => {
  const root = document.getElementById('customer-eft-payments');
  if (!root) return;
  const list = document.getElementById('customer-eft-list');
  const status = document.getElementById('customer-eft-status');
  const refresh = document.getElementById('customer-eft-refresh');
  let active = false, busy = false;
  const money = cents => 'R' + (Number(cents || 0) / 100).toLocaleString('en-ZA', {minimumFractionDigits:2, maximumFractionDigits:2});
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  async function invoke(method, body) {
    const client = window.swiftHaulSupabase;
    if (!client) throw new Error('Secure administrator connection unavailable. Reload the page.');
    const { data, error } = await client.functions.invoke('customer-eft-admin', { method, ...(body ? { body } : {}) });
    if (error) throw new Error(error.message || 'EFT service unavailable.');
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function load() {
    if (!active || busy || document.body.dataset.guestPreview === 'true') return;
    busy = true; refresh.disabled = true; status.textContent = 'Loading customer EFT submissions…';
    try {
      const data = await invoke('GET');
      list.replaceChildren();
      const rows = data.submissions || [];
      if (!rows.length) list.append(element('p', 'No customer EFT submissions are waiting for review.'));
      for (const row of rows) {
        const card = element('article', null, 'operation-card');
        const title = element('strong', row.waybill + ' · ' + money(row.amount_cents));
        const state = element('span', String(row.status).toUpperCase(), 'status');
        const route = element('p', row.booking ? row.booking.pickup + ' → ' + row.booking.dropoff : 'Booking details unavailable');
        const reference = element('p', 'Bank transfer reference: ' + row.payment_reference + (row.customer_reference ? ' · Customer bank reference: ' + row.customer_reference : ''));
        const created = element('p', 'Submitted: ' + new Date(row.created_at).toLocaleString('en-ZA', {timeZone:'Africa/Johannesburg'}));
        card.append(title, state, route, reference, created);
        if (row.proof_url) {
          const proof = element('a', 'Open proof of payment (temporary secure link)');
          proof.href = row.proof_url; proof.target = '_blank'; proof.rel = 'noopener noreferrer';
          card.append(proof);
        } else card.append(element('p', 'Proof file could not be opened. Check Storage access before reviewing.'));
        if (row.status === 'submitted') {
          const bankRef = element('input'); bankRef.type = 'text'; bankRef.maxLength = 120;
          bankRef.placeholder = 'Exact bank statement reference (required to verify)';
          bankRef.setAttribute('aria-label', 'Bank statement reference');
          const rejectReason = element('input'); rejectReason.type = 'text'; rejectReason.maxLength = 500;
          rejectReason.placeholder = 'Reason (required to reject)';
          rejectReason.setAttribute('aria-label', 'Reason for rejecting EFT proof');
          const actions = element('div', null, 'operation-actions');
          const verify = element('button', 'Verify bank receipt');
          const reject = element('button', 'Reject proof');
          verify.type = reject.type = 'button';
          verify.addEventListener('click', () => review(row.id, 'verified', bankRef.value.trim(), ''));
          reject.addEventListener('click', () => review(row.id, 'rejected', '', rejectReason.value.trim()));
          actions.append(verify, reject);
          card.append(bankRef, rejectReason, actions);
        } else {
          card.append(element('p', row.status === 'verified'
            ? 'Verified · bank reference: ' + (row.admin_reference || 'recorded')
            : 'Rejected · ' + (row.rejection_reason || 'No reason recorded')));
        }
        list.append(card);
      }
      status.textContent = rows.filter(row => row.status === 'submitted').length + ' awaiting verification · ' + rows.length + ' total recent submissions.';
    } catch (error) {
      list.replaceChildren(); status.textContent = error.message || 'Unable to load EFT submissions.';
    } finally { busy = false; refresh.disabled = false; }
  }
  async function review(id, decision, adminReference, rejectionReason) {
    if (decision === 'verified' && adminReference.length < 3) { status.textContent = 'Enter the exact bank statement reference before verifying.'; return; }
    if (decision === 'rejected' && rejectionReason.length < 3) { status.textContent = 'Enter a reason before rejecting the proof.'; return; }
    status.textContent = 'Saving EFT review…'; refresh.disabled = true;
    try {
      await invoke('POST', {id, decision, admin_reference:adminReference, rejection_reason:rejectionReason});
      status.textContent = decision === 'verified'
        ? 'Bank receipt verified. The booking is now marked paid.'
        : 'Proof rejected. The booking remains unpaid.';
      await load();
    } catch (error) {
      status.textContent = error.message || 'Unable to save EFT review.';
      refresh.disabled = false;
    }
  }
  refresh.addEventListener('click', load);
  document.addEventListener('account-ready', () => { active = true; load(); });
  document.addEventListener('account-cleared', () => { active = false; list.replaceChildren(); status.textContent = 'Sign in as an administrator to review EFT payments.'; });
  document.addEventListener('guest-preview', () => { active = false; list.replaceChildren(); status.textContent = 'Administrator sign-in required.'; });
})();
