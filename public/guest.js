// The public preview works independently of the account SDK and never requests account data.
(() => {
  const auth = document.getElementById('auth-screen');
  const workspace = document.getElementById('workspace');
  const banner = document.getElementById('guest-banner');
  document.getElementById('continue-as-guest').addEventListener('click', () => {
    document.body.dataset.guestPreview = 'true';
    document.dispatchEvent(new Event('account-cleared'));
    document.querySelectorAll('[data-user-name]').forEach(el => {el.textContent = 'Guest preview';});
    document.querySelectorAll('[data-account-label]').forEach(el => {el.textContent = 'Previewing as';});
    document.getElementById('sign-out').hidden = true;
    auth.hidden = true;
    banner.hidden = false;
    workspace.hidden = false;
    document.dispatchEvent(new Event('guest-preview'));
    const heading = workspace.querySelector('h1');
    heading.setAttribute('tabindex', '-1');
    heading.focus();
    window.scrollTo(0, 0);
  });
  document.getElementById('exit-guest').addEventListener('click', () => {
    document.body.dataset.guestPreview = 'false';
    document.dispatchEvent(new Event('account-cleared'));
    workspace.hidden = true;
    banner.hidden = true;
    auth.hidden = false;
    document.getElementById('sign-out').hidden = false;
    document.querySelector('[data-auth-mode="login"]').click();
    document.getElementById('auth-form').elements.email.focus();
    window.scrollTo(0, 0);
  });
})();
