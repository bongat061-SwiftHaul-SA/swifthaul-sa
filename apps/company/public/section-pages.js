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
  const pages = {
    overview: { title:'Operations overview.', description:'A company-wide snapshot of delivery activity and fleet availability.', show:['stats'] },
    dispatch: { title:'Dispatch desk.', description:'Monitor assigned deliveries and inspect planned pickup-to-drop-off routes.', show:['dispatches'] },
    drivers: { title:'Driver management.', description:'Review driver availability, applications and verification information.', show:['drivers'] },
    refunds: { title:'Cancellations & refunds.', description:'Review customer cancellation requests and refund records.', show:['refunds'] },
    payouts: { title:'Driver payouts.', description:'Review payout requests and record completed manual EFT payments.', show:['payouts'] },
    offers: { title:'Delivery offer dispatch.', description:'Manage premium-first offers for eligible unassigned deliveries.', show:['offers'] },
    finance: { title:'Financial dashboard.', description:'Review reconciled platform, driver, payment and payout figures.', show:['finance'] },
    account: { title:'Company account.', description:'Company administrator profile and support information.', show:['account'] }
  };
  const nodes = { stats, dispatches, drivers, account, refunds, payouts, offers, finance };
  function render(key, updateUrl) {
    const page = pages[key] || pages.overview;
    Object.entries(nodes).forEach(([name,node]) => { if(node) node.hidden = !page.show.includes(name); });
    if (grid) grid.hidden = ![dispatches,drivers,account].some(node => node && !node.hidden);
    const aside = grid?.querySelector('aside');
    if (aside) aside.hidden = ![drivers,account].some(node => node && !node.hidden);
    if (heading) heading.textContent = page.title;
    if (description) description.textContent = page.description;
    nav?.querySelectorAll('a').forEach(link => {
      const selected = link.dataset.page === key;
      link.classList.toggle('is-active',selected);
      if(selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    document.title = 'SwiftHaul SA · Company · ' + page.title.replace(/\.$/,'');
    if(updateUrl) history.pushState({page:key},'', '?page='+encodeURIComponent(key));
    window.scrollTo({top:0,behavior:'instant'});
  }
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click',event => {
    event.preventDefault(); render(link.dataset.page || 'overview',true);
  }));
  window.addEventListener('popstate',() => render(new URLSearchParams(location.search).get('page') || 'overview',false));
  render(new URLSearchParams(location.search).get('page') || 'overview',false);
})();