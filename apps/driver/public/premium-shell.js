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
  heading.classList.add('premium-hero');
  if (app === 'driver') {
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