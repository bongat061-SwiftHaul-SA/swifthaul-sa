import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
window.swiftHaulSupabase = supabase;
const authScreen = document.getElementById('auth-screen');
const restoreScreen = document.getElementById('session-restore');
const workspace = document.getElementById('workspace');
const form = document.getElementById('auth-form');
const status = document.getElementById('auth-status');
const submit = form.querySelector('[type=submit]');
function showSignIn(message = '') {
  if (restoreScreen) restoreScreen.hidden = true;
  authScreen.hidden = false;
  workspace.hidden = true;
  document.body.dataset.authState = 'anonymous';
  if (message) status.textContent = message;
}
function showSessionRestore(message = 'Restoring your secure session…') {
  authScreen.hidden = true;
  workspace.hidden = true;
  if (restoreScreen) {
    restoreScreen.hidden = false;
    const note = restoreScreen.querySelector('[data-session-message]');
    if (note) note.textContent = message;
    const retry = restoreScreen.querySelector('[data-session-retry]');
    if (retry) retry.hidden = false;
    const signIn = restoreScreen.querySelector('[data-session-signin]');
    if (signIn) signIn.hidden = false;
  }
  document.body.dataset.authState = 'checking';
}
restoreScreen?.querySelector('[data-session-retry]')?.addEventListener('click', () => init());
restoreScreen?.querySelector('[data-session-signin]')?.addEventListener('click', () => showSignIn());

let mode = 'login', currentUser = null;
const CUSTOMER_DEVICE_EMAIL_KEY = 'swifthaul.customer.pin-account';
function rememberCustomerEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return;
  try { localStorage.setItem(CUSTOMER_DEVICE_EMAIL_KEY, email.trim().toLowerCase()); }
  catch (error) { console.warn('This device could not remember the Customer PIN account:', error); }
}
function rememberedCustomerEmail() {
  try { return localStorage.getItem(CUSTOMER_DEVICE_EMAIL_KEY) || ''; }
  catch { return ''; }
}
const pinLabel = document.createElement('label');
pinLabel.textContent = '6-digit PIN';
pinLabel.hidden = true;
const pinInput = document.createElement('input');
pinInput.name = 'loginPin';
pinInput.type = 'password';
pinInput.inputMode = 'numeric';
pinInput.pattern = '[0-9]{6}';
pinInput.maxLength = 6;
pinInput.autocomplete = 'one-time-code';
pinInput.placeholder = 'Enter your 6-digit PIN';
pinLabel.append(pinInput);
form.insertBefore(pinLabel, document.getElementById('terms-acceptance'));
const pinLoginButton = document.createElement('button');
pinLoginButton.type = 'button';
pinLoginButton.textContent = 'Use 6-digit PIN';
form.after(pinLoginButton);
pinLoginButton.addEventListener('click', () => setMode(mode === 'pin' ? 'login' : 'pin'));
let pinPanel = null;
const titles = { login:'Welcome back.', pin:'Sign in with your six-digit PIN.', signup:'Make room for your next delivery.', recovery:'Forgot your password?', reset:'Choose a new password.' };
function setMode(next) {
  mode = next;
  const signup = mode === 'signup', recovery = mode === 'recovery', reset = mode === 'reset', pinLogin = mode === 'pin';
  const referral = document.getElementById('referral-signup-field');
  if (referral) {
    referral.hidden = !signup;
    if (signup && !form.elements.referralCode.value) form.elements.referralCode.value = new URLSearchParams(location.search).get('ref') || '';
  }
  document.getElementById('terms-acceptance').hidden = !signup;
  form.elements.acceptTerms.required = signup;
  form.elements.acceptTerms.checked = false;
  document.getElementById('auth-title').textContent = titles[mode];
  form.elements.name.closest('label').hidden = !signup;
  form.elements.name.required = signup;
  form.elements.email.closest('label').hidden = reset || pinLogin;
  form.elements.email.required = !reset && !pinLogin;
  form.elements.password.closest('label').hidden = recovery || pinLogin;
  form.elements.password.required = !recovery && !pinLogin;
  pinLabel.hidden = !pinLogin;
  pinInput.required = pinLogin;
  pinLoginButton.hidden = !['login','pin'].includes(mode);
  pinLoginButton.textContent = pinLogin ? 'Use password instead' : 'Use 6-digit PIN';
  form.elements.password.minLength = mode === 'login' ? 1 : 10;
  form.elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  submit.textContent = ({login:'Sign in',pin:'Sign in with PIN',signup:'Create account',recovery:'Send reset link',reset:'Save password'})[mode];
  status.textContent = '';
}

async function refreshPinPanel(session) {
  if (!session?.access_token) return;
  const { data, error } = await supabase.functions.invoke('account-pin', {
    body: { action: 'status', app_type: 'customer' },
    headers: { Authorization: 'Bearer ' + session.access_token }
  });
  if (error) { console.warn('Customer PIN status unavailable:', error.message); return; }
  if (!pinPanel) {
    pinPanel = document.createElement('section');
    pinPanel.id = 'account-pin-security';
    pinPanel.className = 'panel';
    pinPanel.innerHTML = '<h2>Quick sign-in</h2><p data-pin-state>Check your PIN status.</p><button type="button" data-pin-edit>Set up 6-digit PIN</button><form data-pin-form hidden><label>Create 6-digit PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required></label><label>Confirm 6-digit PIN<input name="confirm_pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required></label><label>Confirm account password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Save PIN</button><p data-pin-message role="status"></p></form>';
    const accountSettings = workspace.querySelector('#settings');
    if (accountSettings) accountSettings.append(pinPanel);
    else { const nav = workspace.querySelector('.section-links'); if (nav) nav.after(pinPanel); else workspace.querySelector('main.page')?.prepend(pinPanel); }
    const edit = pinPanel.querySelector('[data-pin-edit]');
    const setup = pinPanel.querySelector('[data-pin-form]');
    edit.addEventListener('click', () => { setup.hidden = !setup.hidden; });
    setup.addEventListener('submit', async event => {
      event.preventDefault();
      const pin = setup.elements.pin.value;
      if (!/^[0-9]{6}$/.test(pin) || pin !== setup.elements.confirm_pin.value) {
        pinPanel.querySelector('[data-pin-message]').textContent = 'Enter the same six-digit PIN in both fields.';
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { pinPanel.querySelector('[data-pin-message]').textContent = 'Please sign in again to update your PIN.'; return; }
      const { data: saved, error: saveError } = await supabase.functions.invoke('account-pin', {
        body: { action: 'set', app_type: 'customer', pin, password: setup.elements.password.value },
        headers: { Authorization: 'Bearer ' + sessionData.session.access_token }
      });
      if (saveError) { pinPanel.querySelector('[data-pin-message]').textContent = saved?.error || saveError.message; return; }
      setup.reset();
      setup.hidden = true;
      await refreshPinPanel(sessionData.session);
    });
  }
  pinPanel.querySelector('[data-pin-state]').textContent = data?.has_pin
    ? 'A quick sign-in PIN is enabled for this Customer account. You can change it here.'
    : 'Create your own six-digit PIN to sign in faster next time. Password sign-in remains available.';
  pinPanel.querySelector('[data-pin-edit]').textContent = data?.has_pin ? 'Change PIN' : 'Create 6-digit PIN';
}

async function sendSignInNotification(session) {
  if (!session?.access_token) return;
  try {
    const { data, error } = await supabase.functions.invoke('account-signin-notify', {
      body: {}, headers: { Authorization: 'Bearer ' + session.access_token }
    });
    if (error) console.warn('Sign-in security email could not be sent:', error.message);
    else if (data?.email_sent !== true) console.warn('Sign-in security email pending:', data?.reason || 'email provider unavailable');
  } catch (error) { console.warn('Sign-in security email pending:', error?.message || error); }
}

async function validateAccount(session) {
  // account-me is a GET-only Edge Function; functions.invoke() sends POST by default.
  const response = await fetch(`${SUPABASE_URL}/functions/v1/account-me`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + session.access_token
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Account validation failed (${response.status}).`);
  const user = data?.user;
  if (!user || user.role !== 'customer') throw new Error('This account is not registered as a customer.');
  if (user.accountStatus !== 'active') throw new Error('Your customer account is not active. Contact SwiftHaul support.');
  currentUser = user;
  // Remember the verified account on this device so PIN sign-in needs no email field.
  rememberCustomerEmail(session?.user?.email || user.email);
  // Send customer welcome email only after authenticated session and customer role validation.
  // This also covers first sign-in after email confirmation and social signup completion.
  if (session?.access_token) {
    const { data: welcomeResult, error: welcomeError } = await supabase.functions.invoke('customer-welcome-notify', {
      body: {}, headers: { Authorization: 'Bearer ' + session.access_token }
    });
    if (welcomeError) console.warn('Customer welcome email pending:', welcomeError.message);
    else if (welcomeResult?.success !== true) console.warn('Customer welcome email was not delivered yet.');
  }
  document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = user.name || user.email || 'Your account'; });
  document.body.dataset.guestPreview = 'false';
  document.getElementById('guest-banner').hidden = true;
  document.getElementById('sign-out').hidden = false;
  document.querySelectorAll('[data-account-label]').forEach(el => { el.textContent = 'Signed in as'; });
  if (restoreScreen) restoreScreen.hidden = true;
  document.body.dataset.authState = 'authenticated';
  authScreen.hidden = true; workspace.hidden = false;
  document.dispatchEvent(new CustomEvent('account-ready', { detail: user }));
  await refreshPinPanel(session);
}
async function openWorkspace() {
  if (document.body.dataset.guestPreview === 'true') return;
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Please sign in to continue.');
  await validateAccount(session);
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (mode === 'signup' && !form.elements.acceptTerms.checked) {
    status.textContent = 'Read and accept the terms and conditions to continue.';
    form.elements.acceptTerms.reportValidity(); return;
  }
  submit.disabled = true; status.textContent = 'Please wait…';
  try {
    const email = form.elements.email.value.trim().toLowerCase(), password = form.elements.password.value;
    if (mode === 'pin') {
      const pinAccountEmail = rememberedCustomerEmail();
      if (!pinAccountEmail) {
        setMode('login');
        status.textContent = 'For your first sign-in on this device, use your email and password. Then create your six-digit PIN.';
        return;
      }
      if (!/^[0-9]{6}$/.test(pinInput.value)) {
        status.textContent = 'Enter your six-digit PIN.';
        return;
      }
      const { data: pinData, error: pinError } = await supabase.functions.invoke('account-pin', {
        body: { action: 'login', app_type: 'customer', email: pinAccountEmail, pin: pinInput.value }
      });
      if (pinError) throw new Error(pinData?.error || pinError.message || 'PIN sign-in failed.');
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession(pinData.session);
      if (sessionError) throw sessionError;
      pinInput.value = '';
      await validateAccount(sessionData.session);
      await sendSignInNotification(sessionData.session);
      return;
    }
    if (mode === 'recovery') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
      if (error) throw error;
      status.textContent = 'If an account exists, a reset link is on its way. Check your inbox.'; return;
    }
    if (mode === 'reset') {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      form.elements.password.value = ''; setMode('login'); status.textContent = 'Password updated. You can now sign in.'; return;
    }
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: location.href.split('#')[0], data: {
          app_type: 'customer', full_name: form.elements.name.value.trim(),
          referral_code: form.elements.referralCode?.value.trim().toUpperCase() || '',
          terms_accepted: true, terms_version: '2026-10-30-wallet'
        }}
      });
      if (error) throw error;
      form.elements.password.value = '';
      if (!data.session) { setMode('login'); status.textContent = 'Customer account created. Check your email to confirm it, then sign in.'; return; }
      await validateAccount(data.session); return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    form.elements.password.value = ''; await validateAccount(data.session); await sendSignInNotification(data.session);
  } catch (error) { status.textContent = error?.message || 'Unable to connect. Please try again.'; }
  finally { submit.disabled = false; }
});
document.querySelectorAll('[data-auth-mode]').forEach(el => el.addEventListener('click', () => setMode(el.dataset.authMode)));
document.getElementById('sign-out').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) { status.textContent = 'Unable to finish signing out. Please retry.'; return; }
  currentUser = null; location.replace(location.pathname);
});
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { setMode('reset'); if (restoreScreen) restoreScreen.hidden = true; document.body.dataset.authState = 'anonymous'; authScreen.hidden = false; workspace.hidden = true; return; }
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    if (document.body.dataset.guestPreview !== 'true') {
      workspace.hidden = true; if (restoreScreen) restoreScreen.hidden = true; document.body.dataset.authState = 'anonymous'; authScreen.hidden = false; document.dispatchEvent(new Event('account-cleared'));
    }
  }
  if (event === 'TOKEN_REFRESHED' && session && currentUser)
    validateAccount(session).catch(error => console.warn('Customer session refresh validation will retry on the next page load:', error));
});
async function init() {
  setMode('login');
  showSessionRestore();
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (session) { await validateAccount(session); return; }
    showSignIn();
  } catch (error) {
    showSessionRestore(error?.message || 'We could not verify your saved session. Try again, or return to sign in.');
  }
}
init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
