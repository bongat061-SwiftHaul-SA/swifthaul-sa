(() => {
  const body = document.body;
  const root = document.querySelector('body[data-app="driver"] #workspace .page');
  if (!root) return;
  const nav = root.querySelector('.section-links');
  if (nav) nav.innerHTML = document.body.dataset.portal === 'true'
    ? '<a href="?page=home" data-page="home">Home</a><a href="?page=deliveries" data-page="deliveries">Deliveries</a><a href="?page=availability" data-page="availability">Availability</a><a href="?page=history" data-page="history">History</a><a href="?page=earnings" data-page="earnings">Earnings</a><a href="?page=payouts" data-page="payouts">Payouts</a><a href="?page=cash" data-page="cash">Cash &amp; deposits</a><a href="?page=membership" data-page="membership">Premium</a><a href="?page=insurance-claims" data-page="insurance-claims">Insurance</a><a href="?page=account" data-page="account">Profile</a><a href="map.html">Driver map</a>'
    : '<a href="?page=home" data-page="home">Home</a><a href="?page=deliveries" data-page="deliveries">Deliveries</a><a href="?page=availability" data-page="availability">Availability</a><a href="?page=account" data-page="account">Profile</a>';
  const heading = root.querySelector('.page-heading h1');
  const description = root.querySelector('.page-heading .subtle');
  const stats = root.querySelector('#earnings');
  const grid = root.querySelector('.workspace-grid');
  const dispatches = root.querySelector('#dispatches');
  const historyPanel = document.createElement('section');
  historyPanel.id = 'driver-delivery-history';
  historyPanel.className = 'panel';
  historyPanel.innerHTML = '<h2>Delivery history</h2><p class="subtle">Completed, failed and cancelled deliveries are listed here after your account loads its dispatch records.</p><div id="driver-delivery-history-list" class="operations-list"><p>No completed deliveries yet.</p></div>';
  grid?.insertAdjacentElement('afterend', historyPanel);
  const driverHome = document.createElement('section');
  driverHome.id = 'driver-home-screen';
  driverHome.className = 'driver-home-screen';
  driverHome.innerHTML = '<div class="driver-profile-card"><div class="driver-avatar" aria-hidden="true">SH</div><div class="driver-profile-copy"><span class="driver-home-kicker">DRIVER DASHBOARD</span><h2><strong data-driver-home-name>Driver</strong></h2><p data-driver-id>SwiftHaul approved driver</p><span class="driver-rating-placeholder">★ &nbsp; Rating shown from completed trips</span></div><a class="driver-profile-action" href="?page=account" data-page="account">Profile ↗</a></div><div class="driver-earnings-card"><div><span class="driver-home-kicker">TODAY’S EARNINGS</span><strong data-driver-today-earnings>—</strong><p>75% driver share on completed, paid deliveries</p></div><a href="?page=earnings" data-page="earnings">View Details →</a></div><div class="driver-metric-row"><div><span>▣</span><strong data-driver-today-count>—</strong><small>Deliveries</small></div><div><span>⌁</span><strong data-driver-distance>—</strong><small>Travelled</small></div><div><span>◷</span><strong data-driver-online-time>—</strong><small>Online Time</small></div></div><div class="driver-feed-heading"><h2>Available Deliveries</h2><span data-driver-offer-count>•</span></div><div class="driver-home-shortcuts"><a href="?page=deliveries" data-page="deliveries"><span>↗</span><strong>Open Deliveries</strong><small>View assigned and available work</small></a><a href="?page=availability" data-page="availability"><span>◉</span><strong>Availability</strong><small>Manage online status</small></a><a href="?page=history" data-page="history"><span>▤</span><strong>History</strong><small>Past deliveries</small></a><a href="?page=payouts" data-page="payouts"><span>R</span><strong>Payouts</strong><small>Wallet &amp; bank</small></a></div>';
  if (document.body.dataset.portal !== 'true') {
    driverHome.innerHTML = driverHome.innerHTML.replace('href="?page=earnings"', 'href="../driver-portal/?page=earnings"').replace('href="?page=history" data-page="history"', 'href="../driver-portal/?page=history"').replace('href="?page=payouts" data-page="payouts"', 'href="../driver-portal/?page=payouts"');
  }
  root.querySelector('.page-heading')?.insertAdjacentElement('afterend', driverHome);
  const account = root.querySelector('#account-details');
  const availability = root.querySelector('#availability');
  const payouts = root.querySelector('#payouts');
  const premium = root.querySelector('#premium');
  const insuranceClaims = root.querySelector('#insurance-claims');
  const cash = root.querySelector('#cash-management');
  const pages = {
    home: { title: 'Your driver home.', description: 'Your profile, earnings and next delivery in one place.', show: ['home','dispatches'] },
    deliveries: { title: 'Your deliveries.', description: 'Review assigned work and follow each active route from one focused page.', show: ['dispatches'] },
    history: { title: 'Delivery history.', description: 'Review completed, failed and cancelled deliveries from your dispatch history.', show: ['history'] },
    availability: { title: 'Choose when to drive.', description: 'Manage your online status and delivery offer availability.', show: ['availability'] },
    earnings: { title: 'Your earnings.', description: 'Track completed work and your driver earnings at a glance.', show: ['stats','earnings-note'] },
    payouts: { title: 'Payouts.', description: 'Review your available balance, bank payout requests and payout history.', show: ['payouts'] },
    cash: { title: 'Cash & deposits.', description: 'Record customer cash held for SwiftHaul and reconcile your company deposits.', show: ['cash'] },
    membership: { title: 'Premium membership.', description: 'Manage membership, priority benefits and rewards.', show: ['premium'] },
    'insurance-claims': { title: 'Insurance claims.', description: 'Submit and track accident claims linked to your active assigned dispatches.', show: ['insurance-claims'] },
    account: { title: 'Your account.', description: 'Your driver profile and support details.', show: ['account'] }
  };
  const pageNodes = { home: driverHome, stats, dispatches, history: historyPanel, availability, payouts, cash, premium, account, 'insurance-claims': insuranceClaims };
  const earningsNote = document.createElement('section');
  earningsNote.className = 'panel driver-earnings-note';
  earningsNote.innerHTML = '<h2>How delivery earnings work</h2><p>For completed deliveries, the current standard split is 75% to the driver and 25% to the platform. Vehicle-specific rates may be introduced after operating costs are established.</p>';
  root.insertBefore(earningsNote, grid.nextSibling);
  pageNodes['earnings-note'] = earningsNote;
  function render(key, updateUrl) {
    const allowedPages = document.body.dataset.portal === 'true' ? Object.keys(pages) : ['home','deliveries','availability','account'];
    const selected = allowedPages.includes(key) ? key : 'home';
    const page = pages[selected];
    body.dataset.driverPage = selected;
    Object.entries(pageNodes).forEach(([name,node]) => { if (node) node.hidden = !page.show.includes(name); });
    if (grid) {
      const visibleChild = [dispatches, account].some(node => node && !node.hidden);
      grid.hidden = !visibleChild;
    }
    if (heading) heading.textContent = page.title;
    if (description) description.textContent = page.description;
    const navCurrent = nav?.closest('.workspace-navigation')?.querySelector('[data-nav-current]');
    if (navCurrent) navCurrent.textContent = page.title.replace(/\.$/,'');
    nav?.querySelectorAll('a').forEach(link => {
      const active = link.dataset.page === selected;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    document.title = 'SwiftHaul SA · Driver · ' + page.title.replace(/\.$/,'');
    if (updateUrl) history.pushState({ page:selected }, '', '?page=' + encodeURIComponent(selected));
    nav?.closest('details')?.setAttribute('open','');
    window.scrollTo({ top:0, behavior:'instant' });
  }
  driverHome.querySelectorAll('a[data-page]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); render(link.dataset.page || 'home', true); }));
  root.querySelectorAll('a[data-page]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      render(link.dataset.page || 'home', true);
    });
  });
  window.addEventListener('popstate', () => render(new URLSearchParams(location.search).get('page') || 'home', false));
  const nameTarget = driverHome.querySelector('[data-driver-home-name]');
  const sourceName = root.querySelector('[data-user-name]');
  if (nameTarget && sourceName) { const syncName=()=>{ nameTarget.textContent=sourceName.textContent.trim() || 'Driver'; }; syncName(); new MutationObserver(syncName).observe(sourceName,{childList:true,subtree:true,characterData:true}); }
  // Reuse the live earnings summary as the source for the reference-style home card.
  const sourceStats = root.querySelectorAll('#earnings .stat strong');
  const syncHomeMetrics = () => {
    const completed = driverHome.querySelector('[data-driver-today-count]');
    const earningsValue = driverHome.querySelector('[data-driver-today-earnings]');
    if (completed && sourceStats[1]) completed.textContent = sourceStats[1].textContent.trim() || '—';
    if (earningsValue && sourceStats[2]) earningsValue.textContent = sourceStats[2].textContent.trim() || '—';
  };
  syncHomeMetrics();
  const statsPanel = root.querySelector('#earnings');
  if (statsPanel) new MutationObserver(syncHomeMetrics).observe(statsPanel,{childList:true,subtree:true,characterData:true});
  const key = new URLSearchParams(location.search).get('page') || 'home';
  render(key, false);
})();