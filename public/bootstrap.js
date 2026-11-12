import('./auth.js').catch(error => {
  console.error('SwiftHaul Customer auth bootstrap failed:', error);
  const screen = document.getElementById('auth-screen');
  const workspace = document.getElementById('workspace');
  const status = document.getElementById('auth-status');
  if (screen) screen.hidden = false;
  if (workspace) workspace.hidden = true;
  if (status) status.textContent = 'Sign-in could not load. Check your connection and reload this page.';
  document.body.dataset.authState = 'error';
});
