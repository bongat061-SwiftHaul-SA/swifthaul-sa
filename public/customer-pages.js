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
  const pages = {
    book: { title: 'Book a delivery.', description: 'Enter your pickup and drop-off details, choose a vehicle and confirm your delivery quote.', current: 'Book a delivery' },
    activity: { title: 'Your activity.', description: 'Review bookings, delivery progress, invoices and payment actions in one focused place.', current: 'Activity' },
    wallet: { title: 'Your wallet.', description: 'Check refund balances, rewards, withdrawals and pay-later activity.', current: 'Wallet' },
    account: { title: 'Your account.', description: 'Manage your profile, picture, sign-in details, PIN and account preferences.', current: 'Account' }
  };
  function render(key, updateUrl) {
    const page = pages[key] || pages.book;
    const selected = pages[key] ? key : 'book';
    if (bookingColumn) bookingColumn.hidden = selected !== 'book';
    if (activityColumn) activityColumn.hidden = selected !== 'activity';
    if (grid) grid.hidden = !['book','activity'].includes(selected);
    if (wallet) wallet.hidden = selected !== 'wallet';
    if (account) account.hidden = selected !== 'account';
    if (heading) heading.textContent = page.title;
    if (description) description.textContent = page.description;
    nav?.querySelectorAll('a[data-page]').forEach(link => {
      const active = link.dataset.page === selected;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    const current = nav?.closest('details')?.querySelector('[data-nav-current]');
    if (current) current.textContent = page.current;
    body.dataset.customerPage = selected;
    document.title = 'SwiftHaul SA · Customer · ' + page.title.replace(/\.$/,'');
    if (updateUrl) {
      const params = new URLSearchParams(location.search);
      params.set('page', selected);
      history.pushState({ page:selected }, '', location.pathname + '?' + params.toString());
    }
    nav?.closest('details')?.removeAttribute('open');
    window.scrollTo({ top:0, behavior:'instant' });
  }
  nav?.querySelectorAll('a[data-page]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    render(link.dataset.page || 'book', true);
  }));
  window.addEventListener('popstate', () => render(new URLSearchParams(location.search).get('page') || body.dataset.customerView || 'book', false));
  render(new URLSearchParams(location.search).get('page') || body.dataset.customerView || 'book', false);
})();