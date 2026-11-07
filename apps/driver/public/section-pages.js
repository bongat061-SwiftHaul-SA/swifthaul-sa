(() => {
  const root = document.querySelector('body[data-app="driver"] #workspace .page');
  if (!root) return;
  const nav = root.querySelector('.section-links');
  const heading = root.querySelector('.page-heading h1');
  const description = root.querySelector('.page-heading .subtle');
  const stats = root.querySelector('#earnings');
  const grid = root.querySelector('.workspace-grid');
  const dispatches = root.querySelector('#dispatches');
  const history = document.createElement('section');
  history.id = 'driver-delivery-history';
  history.className = 'panel';
  history.innerHTML = '<h2>Delivery history</h2><p class="subtle">Completed, failed and cancelled deliveries are listed here after your account loads its dispatch records.</p><div id="driver-delivery-history-list" class="operations-list"><p>No completed deliveries yet.</p></div>';
  grid?.insertAdjacentElement('afterend', history);
  const account = root.querySelector('#account-details');
  const availability = root.querySelector('#availability');
  const payouts = root.querySelector('#payouts');
  const premium = root.querySelector('#premium');
  const pages = {
    home: { title: 'Ready for the road.', description: 'Your driver home, with a quick view of your delivery activity.', show: ['stats'] },
    deliveries: { title: 'Your deliveries.', description: 'Review assigned work and follow each active route from one focused page.', show: ['dispatches'] },
    history: { title: 'Delivery history.', description: 'Review completed, failed and cancelled deliveries from your dispatch history.', show: ['history'] },
    availability: { title: 'Choose when to drive.', description: 'Manage your online status and delivery offer availability.', show: ['availability'] },
    earnings: { title: 'Your earnings.', description: 'Track completed work and your driver earnings at a glance.', show: ['stats','earnings-note'] },
    payouts: { title: 'Payouts.', description: 'Review your available balance, bank payout requests and payout history.', show: ['payouts'] },
    membership: { title: 'Premium membership.', description: 'Manage membership, priority benefits and rewards.', show: ['premium'] },
    account: { title: 'Your account.', description: 'Your driver profile and support details.', show: ['account'] }
  };
  const pageNodes = { stats, dispatches, history, availability, payouts, premium, account };
  const earningsNote = document.createElement('section');
  earningsNote.className = 'panel driver-earnings-note';
  earningsNote.innerHTML = '<h2>How delivery earnings work</h2><p>For completed deliveries, the current standard split is 75% to the driver and 25% to the platform. Vehicle-specific rates may be introduced after operating costs are established.</p>';
  root.insertBefore(earningsNote, grid.nextSibling);
  pageNodes['earnings-note'] = earningsNote;
  function render(key, updateUrl) {
    const page = pages[key] || pages.home;
    Object.entries(pageNodes).forEach(([name,node]) => { if (node) node.hidden = !page.show.includes(name); });
    if (grid) {
      const visibleChild = [dispatches, account].some(node => node && !node.hidden);
      grid.hidden = !visibleChild;
    }
    if (heading) heading.textContent = page.title;
    if (description) description.textContent = page.description;
    nav?.querySelectorAll('a').forEach(link => {
      const selected = link.dataset.page === key;
      link.classList.toggle('is-active', selected);
      if (selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    document.title = 'SwiftHaul SA · Driver · ' + page.title.replace(/\.$/,'');
    if (updateUrl) history.pushState({ page:key }, '', '?page=' + encodeURIComponent(key));
    window.scrollTo({ top:0, behavior:'instant' });
  }
  nav?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      render(link.dataset.page || 'home', true);
    });
  });
  window.addEventListener('popstate', () => render(new URLSearchParams(location.search).get('page') || 'home', false));
  const key = new URLSearchParams(location.search).get('page') || 'home';
  render(key, false);
})();