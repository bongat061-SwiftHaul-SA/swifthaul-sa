(() => {
  const root = document.querySelector('body[data-app="company"] #workspace .page');
  if (!root) return;
  const nav = root.querySelector('.section-links');
  const heading = root.querySelector('.page-heading h1');
  const description = root.querySelector('.page-heading .subtle');
  const stats = root.querySelector('.stats');
  const grid = root.querySelector('.workspace-grid');
  const dispatches = root.querySelector('#dispatches');
  const drivers = root.querySelector('#drivers');
  const account = root.querySelector('#account-details');
  const refunds = root.querySelector('#refunds');
  const payouts = root.querySelector('#payouts');
  const offers = root.querySelector('#offer-dispatch');
  const finance = root.querySelector('#financial-dashboard');
  const insurance = root.querySelector('#insurance-management');
  const reports = document.createElement('section');
  reports.id = 'monthly-reports';
  reports.className = 'panel';
  reports.innerHTML = '<h2>Monthly performance reports</h2><p class="subtle">Download a finance snapshot for your records. The current secure finance service returns cumulative totals, so exports clearly identify their reporting scope rather than presenting lifetime totals as month-only figures.</p><label for="report-month">Report month</label><input id="report-month" type="month"><button type="button" id="download-monthly-report">Download CSV snapshot</button><p id="report-status" role="status" aria-live="polite">Sign in as an administrator and refresh the Financial dashboard before exporting.</p>';
  finance?.insertAdjacentElement('afterend', reports);
  const reportStatus = reports.querySelector('#report-status');
  const reportMonth = reports.querySelector('#report-month');
  const downloadReport = reports.querySelector('#download-monthly-report');
  downloadReport.addEventListener('click', () => {
    const month = reportMonth.value;
    if (!month) { reportStatus.textContent = 'Choose a report month first.'; return; }
    const cards = [...(finance?.querySelectorAll('#financial-content .stat') || [])];
    if (!cards.length) { reportStatus.textContent = 'Refresh the administrator Financial dashboard first. No financial figures are available to export.'; return; }
    const rows = [['SwiftHaul SA monthly performance report'],['Selected month',month],['Generated at',new Date().toISOString()],['Data scope','Cumulative snapshot from current admin-financials service; figures are not month-filtered.'],['Metric','Value','Scope']];
    cards.forEach(card => { const label=card.querySelector('span')?.textContent || 'Metric'; const value=card.querySelector('strong')?.textContent || ''; const note=card.querySelector('p')?.textContent || ''; rows.push([label,value,note]); });
    const csv=rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='swifthaul-monthly-performance-'+month+'-snapshot.csv';a.click();URL.revokeObjectURL(url);reportStatus.textContent='CSV snapshot downloaded. Note: figures are cumulative, not month-filtered.';
  });
  const pages = {
    overview: { title:'Operations overview.', description:'A company-wide snapshot of delivery activity and fleet availability.', show:['stats'] },
    dispatch: { title:'Dispatch desk.', description:'Monitor assigned deliveries and inspect planned pickup-to-drop-off routes.', show:['dispatches'] },
    drivers: { title:'Driver management.', description:'Review driver availability, applications and verification information.', show:['drivers'] },
    refunds: { title:'Cancellations & refunds.', description:'Review customer cancellation requests and refund records.', show:['refunds'] },
    payouts: { title:'Driver payouts.', description:'Review payout requests and record completed manual EFT payments.', show:['payouts'] },
    'cash-reconciliation': { title:'Cash reconciliation.', description:'Verify driver cash deposits against company bank records and clear cash-held liabilities.', show:['cash-reconciliation'] },
    offers: { title:'Delivery offer dispatch.', description:'Manage premium-first offers for eligible unassigned deliveries.', show:['offers'] },
    finance: { title:'Financial dashboard.', description:'Review reconciled platform, driver, payment and payout figures.', show:['finance'] },
    reports: { title:'Monthly reports.', description:'Export a dated CSV snapshot of the current administrator financial summary.', show:['reports'] },
    insurance: { title:'Driver insurance management.', description:'Verify Premium eligibility and manage insurer-issued driver policies.', show:['insurance'] },
    'insurance-claims': { title:'Insurance claims review.', description:'Review dispatch-bound GPS evidence, route compliance and insurer decisions.', show:['insurance-claims'] },
    deletions: { title:'Account deletion requests.', description:'Review customer and driver account closure requests while protecting active deliveries and financial records.', show:['deletions'] },
    account: { title:'Company account.', description:'Company administrator profile and support information.', show:['account'] }
  };
  const nodes = { stats, dispatches, drivers, account, refunds, payouts, offers, finance, reports, insurance, "insurance-claims": root.querySelector("#insurance-claims-admin"), deletions: root.querySelector("#account-deletions"), "cash-reconciliation": root.querySelector("#cash-reconciliation") };
  function render(key, updateUrl) {
    const page = pages[key] || pages.overview;
    Object.entries(nodes).forEach(([name,node]) => { if(node) node.hidden = !page.show.includes(name); });
    if (grid) grid.hidden = ![dispatches,drivers,account].some(node => node && !node.hidden);
    const aside = grid?.querySelector('aside');
    if (aside) aside.hidden = ![drivers,account].some(node => node && !node.hidden);
    if (heading) heading.textContent = page.title;
    if (description) description.textContent = page.description;
    const navCurrent = nav?.closest('.workspace-navigation')?.querySelector('[data-nav-current]');
    if (navCurrent) navCurrent.textContent = page.title.replace(/\.$/,'');
    nav?.querySelectorAll('a').forEach(link => {
      const selected = link.dataset.page === key;
      link.classList.toggle('is-active',selected);
      if(selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    document.title = 'SwiftHaul SA · Company · ' + page.title.replace(/\.$/,'');
    if(updateUrl) history.pushState({page:key},'', '?page='+encodeURIComponent(key));
    nav?.closest('details')?.removeAttribute('open');
    window.scrollTo({top:0,behavior:'instant'});
  }
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click',event => {
    event.preventDefault(); render(link.dataset.page || 'overview',true);
  }));
  window.addEventListener('popstate',() => render(new URLSearchParams(location.search).get('page') || 'overview',false));
  render(new URLSearchParams(location.search).get('page') || 'overview',false);
})();