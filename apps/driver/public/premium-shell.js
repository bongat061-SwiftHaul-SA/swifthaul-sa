(() => {
  const app = document.body.dataset.app;
  if (!['customer','driver'].includes(app)) return;
  const workspace = document.getElementById('workspace');
  const page = workspace?.querySelector('main.page');
  if (!workspace || !page) return;
  const heading = page.querySelector('.page-heading');
  const nav = page.querySelector('.section-links');
  if (!heading || !nav) return;
  workspace.classList.add('premium-shell');
  const topbar = workspace.querySelector(':scope > .topbar');
  if (topbar) {
    topbar.classList.add('premium-topbar');
    const brand = topbar.querySelector('.wordmark');
    if (brand) brand.innerHTML = '<span class="premium-mark">S</span><span class="premium-brand-name">SWIFTHAUL</span><small class="app-tag">'+(app === 'customer' ? 'CUSTOMER' : 'DRIVER')+'</small>';
  }
  const title = heading.querySelector('h1');
  const subtitle = heading.querySelector('.subtle');
  heading.classList.add('premium-hero');
  if (app === 'customer') {
    if (title) title.textContent = 'Move anything.\nWe’ll take it there.';
    if (subtitle) subtitle.textContent = 'Reliable delivery, from your door to its destination.';
    const cta = document.createElement('a');
    cta.className = 'premium-main-cta';
    cta.href = '#new-delivery';
    cta.innerHTML = '<span><small>READY WHEN YOU ARE</small><strong>Book a delivery</strong></span><b aria-hidden="true">→</b>';
    heading.append(cta);
    const quick = document.createElement('section');
    quick.className = 'premium-quick-actions';
    quick.setAttribute('aria-label','Quick actions');
    quick.innerHTML = '<a href="#new-delivery"><span class="quick-icon">＋</span><strong>New delivery</strong><small>Book a pickup</small></a><a href="#bookings"><span class="quick-icon">↗</span><strong>Track delivery</strong><small>View activity</small></a><a href="wallet.html"><span class="quick-icon">R</span><strong>Wallet</strong><small>Balance & rewards</small></a><a href="settings.html"><span class="quick-icon">⌘</span><strong>Account</strong><small>Your details</small></a>';
    heading.after(quick);
    const booking = document.getElementById('new-delivery');
    const orders = document.getElementById('bookings');
    booking?.classList.add('premium-primary-section');
    orders?.classList.add('premium-secondary-section');
    // Keep the page-controller links intact so customer navigation stays in-app.
  } else {
    if (title) title.textContent = 'Your day. Your deliveries.';
    if (subtitle) subtitle.textContent = 'Stay ready, manage dispatches and keep track of your earnings.';
    const stats = document.getElementById('earnings');
    const dispatch = document.getElementById('dispatches');
    const online = document.getElementById('driver-online-toggle');
    const status = document.getElementById('availability-state');
    const statusText = document.createElement('div');
    statusText.className = 'premium-online-status';
    statusText.innerHTML = '<span class="online-indicator"></span><span class="online-copy">Availability</span>';
    if (online) {
      statusText.append(online);
      const label = document.createElement('label');
      label.className = 'premium-online-toggle';
      label.append(statusText);
      heading.append(label);
    }
    stats?.classList.add('premium-driver-stats');
    dispatch?.classList.add('premium-dispatch-card');
    // Preserve the data-page links wired by section-pages.js. Replacing them
    // after listeners attach caused full navigations and apparent sign-in resets.
    const payout = document.getElementById('payouts');
    payout?.classList.add('premium-secondary-section');
    if (status) status.classList.add('premium-status-copy');
  }
  nav.classList.add('premium-bottom-nav');
  nav.setAttribute('aria-label', app === 'customer' ? 'Customer navigation' : 'Driver navigation');
  const footer = workspace.querySelector('.footer');
  if (footer) footer.classList.add('premium-footer');
  const markActive = () => {
    const currentPage = new URLSearchParams(location.search).get('page') || (app === 'customer' ? 'book' : 'home');
    const hash = location.hash || (app === 'customer' ? '#new-delivery' : '');
    nav.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      const active = a.dataset.page ? a.dataset.page === currentPage : href === hash;
      a.classList.toggle('is-active', active);
    });
  };
  markActive();
  addEventListener('hashchange', markActive);
  addEventListener('popstate', markActive);
})();