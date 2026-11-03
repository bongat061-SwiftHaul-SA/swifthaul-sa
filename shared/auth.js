import { getUser, login, signup, logout, requestPasswordRecovery, handleAuthCallback, updateUser, acceptInvite, onAuthChange } from 'https://esm.sh/@netlify/identity@2.0.0?bundle';
const app = document.body.dataset.app;
const auth = document.getElementById('auth-screen');
const workspace = document.getElementById('workspace');
const form = document.getElementById('auth-form');
const status = document.getElementById('auth-status');
let mode = 'login';
let inviteToken;
const titles = { login: 'Welcome back.', signup: 'Make room for your next delivery.', recovery: 'Forgot your password?', reset: 'Choose a new password.', invite: 'Welcome to the team.' };
function setMode(next) {
  mode = next;
  const referral=document.getElementById('referral-signup-field');if(referral){referral.hidden=mode!=='signup';if(mode==='signup'&&!form.elements.referralCode.value)form.elements.referralCode.value=new URLSearchParams(location.search).get('ref') || '';}
  const needsTerms = mode === 'signup' || mode === 'invite';
  document.getElementById('terms-acceptance').hidden = !needsTerms;
  form.elements.acceptTerms.required = needsTerms;
  form.elements.acceptTerms.checked = false;
  document.getElementById('auth-title').textContent = titles[mode];
  form.elements.name.closest('label').hidden = mode !== 'signup';
  form.elements.name.required = mode === 'signup';
  form.elements.email.closest('label').hidden = ['reset', 'invite'].includes(mode);
  form.elements.email.required = !['reset', 'invite'].includes(mode);
  form.elements.password.closest('label').hidden = mode === 'recovery';
  form.elements.password.required = mode !== 'recovery';
  form.elements.password.minLength = mode === 'login' ? 1 : 10;
  form.elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  form.querySelector('[type=submit]').textContent = {login:'Sign in',signup:'Create account',recovery:'Send reset link',reset:'Save password',invite:'Accept invitation'}[mode];
  status.textContent = '';
}
async function openWorkspace() {
  if (document.body.dataset.guestPreview === 'true') return;
  const response = await fetch('/api/session', { cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 403) throw new Error('Company access requires an invitation and the admin role. Contact your site administrator.');
    throw new Error('Please sign in to continue.');
  }
  const { user } = await response.json();
  if (document.body.dataset.guestPreview === 'true') return;
  document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = user.name || user.email || 'Your account'; });
  document.body.dataset.guestPreview = 'false';
  document.getElementById('guest-banner').hidden = true;
  document.getElementById('sign-out').hidden = false;
  document.querySelectorAll('[data-account-label]').forEach(el => {el.textContent = 'Signed in as';});
  auth.hidden = true; workspace.hidden = false;
  document.dispatchEvent(new CustomEvent('account-ready', {detail:user}));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if ((mode === 'signup' || mode === 'invite') && !form.elements.acceptTerms.checked) {status.textContent='Read and accept the terms and conditions to continue.';form.elements.acceptTerms.reportValidity();return;}
  const button = form.querySelector('[type=submit]');button.disabled = true;status.textContent = 'Please wait…';
  try {
    const {email,password,name} = form.elements;
    if (mode === 'recovery') {
      await requestPasswordRecovery(email.value.trim());status.textContent = 'If an account exists, a reset link is on its way. Check your inbox.';return;
    }
    if (mode === 'signup') {
      const user = await signup(email.value.trim(), password.value, {full_name:name.value.trim(),referral_code:form.elements.referralCode?.value.trim().toUpperCase() || '',terms_accepted:true,terms_version:'2026-10-30-wallet'});
      password.value = '';
      if (!user.confirmedAt) {status.textContent = 'Check your email to confirm your account, then sign in.';return;}
    } else if (mode === 'reset') await updateUser({password:password.value});
    else if (mode === 'invite') {await acceptInvite(inviteToken,password.value);await updateUser({data:{terms_accepted:true,terms_version:'2026-10-30-wallet'}});}
    else await login(email.value.trim(),password.value);
    password.value = '';
    await openWorkspace();
  } catch (error) {status.textContent = error?.status === 401 ? 'Unable to sign in. Check your email, password and email confirmation.' : error?.message || 'Unable to connect. Please try again.';}
  finally {button.disabled = false;}
});
document.querySelectorAll('[data-auth-mode]').forEach(el => el.addEventListener('click', () => setMode(el.dataset.authMode)));
document.getElementById('sign-out').addEventListener('click',async () => {
  try {await logout();window.location.replace('/');}
  catch {auth.hidden=false;workspace.hidden=true;status.textContent='Unable to finish signing out. Please retry.';}
});
onAuthChange((event) => { if (event === 'logout' && document.body.dataset.guestPreview !== 'true') {workspace.hidden=true;auth.hidden=false;document.dispatchEvent(new Event('account-cleared'));} });
async function init() {
  try {
    const result = await handleAuthCallback();
    if (result?.type === 'recovery') {setMode('reset');return;}
    if (result?.type === 'invite') {inviteToken=result.token;setMode('invite');return;}
    if (await getUser()) await openWorkspace();
  } catch (error) {status.textContent = error?.message || 'Sign-in is unavailable. Please try again.';}
}
setMode('login');init();
// Revalidate when returning to the app, including after account changes in another tab.
document.addEventListener('visibilitychange',async () => {
  if (document.visibilityState !== 'visible' || workspace.hidden || document.body.dataset.guestPreview === 'true') return;
  try {await openWorkspace();} catch {workspace.hidden=true;auth.hidden=false;}
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
