import('./auth.js').catch(() => {
  document.getElementById('auth-status').textContent = 'Sign-in could not load. Check your connection and reload this page.';
});
