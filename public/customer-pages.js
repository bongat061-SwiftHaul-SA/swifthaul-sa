(() => {
  const body = document.body;
  if (body.dataset.app !== 'customer') return;
  const workspace = document.getElementById('workspace');
  const root = workspace?.querySelector('main.page');
  if (!root) return;
  const nav = root.querySelector('.section-links');
  const grid = root.querySelector('.workspace-grid');
  const bookingColumn = root.querySelector('#new-delivery');
  const activityColumn = root.querySelector('#bookings')?.parentElement;
  const wallet = root.querySelector('#wallet');
  const account = root.querySelector('#settings');
  const heading = root.querySelector('.page-heading h1');
  const description = root.querySelector('.page-heading .subtle');
  const navCurrent = nav?.closest('.workspace-navigation')?.querySelector('[data-nav-current]');
  if (!nav || !grid || !bookingColumn || !activityColumn) return;

  nav.innerHTML = '';
  const home = document.createElement('section');
  home.className = 'customer-home';
  home.id = 'customer-home';
  home.innerHTML = '<div class="customer-home-intro"><span class="customer-kicker">YOUR CUSTOMER SPACE</span><h2>What can we move for you?</h2><p>Book a pickup, then follow your delivery from one simple place.</p><a class="customer-book-cta" href="?page=book"><span><small>READY WHEN YOU ARE</small><strong>Book a delivery</strong></span><b aria-hidden="true">→</b></a></div>';
  grid.before(home);
  const trackingIntro = document.createElement('section');
  trackingIntro.className = 'customer-tracking-intro';
  trackingIntro.innerHTML = '<h2>Track your delivery</h2><p>Choose <strong>Track Delivery</strong> to open the mapped route, or <strong>Track driver live</strong> when the driver has enabled location sharing. Live location refreshes while tracking is active.</p>';
  grid.before(trackingIntro);

  const pages = {
    home: { title: 'Welcome to SwiftHaul.', description: 'Your deliveries, payments and account — all in one place.', current: 'Home' },
    book: { title: 'Book a delivery.', description: 'Set your pickup and destination, review the route and confirm your delivery.', current: 'Book' },
    activity: { title: 'Your deliveries.', description: 'Review bookings, delivery progress, invoices and payment actions.', current: 'Deliveries' },
    tracking: { title: 'Track a delivery.', description: 'Follow the planned route and check live driver location when it is shared.', current: 'Tracking' },
    wallet: { title: 'Your wallet.', description: 'Check refund balances, rewards, withdrawals and pay-later activity.', current: 'Wallet' },
    account: { title: 'Your account.', description: 'Manage your profile, picture, sign-in details, PIN and preferences.', current: 'Account' }
  };
  const bottomNav = document.createElement('nav');
  bottomNav.className = 'customer-bottom-nav';
  bottomNav.setAttribute('aria-label','Customer navigation');
  const navItems = [
    ['home','Home','⌂'],['book','Book','＋'],['activity','Orders','↗'],
    ['tracking','Track','⌖'],['wallet','Wallet','R'],['account','Account','◎']
  ];
  navItems.forEach(([key,label,icon]) => {
    const link = document.createElement('a');
    const params = new URLSearchParams(location.search);
    params.set('page',key);
    link.href = location.pathname + '?' + params.toString();
    link.className = 'customer-bottom-nav-link';
    link.dataset.navPage = key;
    link.innerHTML = '<span aria-hidden="true">'+icon+'</span><small>'+label+'</small>';
    bottomNav.append(link);
  });
  root.append(bottomNav);
  function render(key, updateUrl) {
    const selected = pages[key] ? key : 'home';
    const page = pages[selected];
    home.hidden = selected !== 'home';
    bookingColumn.hidden = selected !== 'book';
    activityColumn.hidden = !['activity','tracking'].includes(selected);
    trackingIntro.hidden = selected !== 'tracking';
    grid.hidden = !['book','activity','tracking'].includes(selected);
    wallet.hidden = selected !== 'wallet';
    if (account) account.hidden = selected !== 'account';
    if (heading) heading.textContent = page.title;
    if (description) description.textContent = page.description;
    if (navCurrent) navCurrent.textContent = page.current;
    bottomNav.querySelectorAll('a[data-nav-page]').forEach(link => {
      const active = link.dataset.navPage === selected;
      link.classList.toggle('is-active',active);
      if(active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    nav.querySelectorAll('a[data-page]').forEach(link => {
      const active = link.dataset.page === selected;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    body.dataset.customerPage = selected;
    document.title = 'SwiftHaul SA · Customer · ' + page.current;
    if (updateUrl) {
      const params = new URLSearchParams(location.search);
      params.set('page', selected);
      history.pushState({ page:selected }, '', location.pathname + '?' + params.toString());
    }
    window.scrollTo({ top:0, behavior:'instant' });
  }
  root.addEventListener('click', event => {
    const link = event.target.closest('a[data-page]');
    if (!link || !root.contains(link)) return;
    event.preventDefault();
    render(link.dataset.page || 'home', true);
  });
  window.addEventListener('popstate', () => render(new URLSearchParams(location.search).get('page') || 'home', false));
  render(new URLSearchParams(location.search).get('page') || 'home', false);
})();