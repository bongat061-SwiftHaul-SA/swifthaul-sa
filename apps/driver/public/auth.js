import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
window.swiftHaulSupabase = supabase;

const app = document.body.dataset.app;
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

let mode = 'login';
let currentUser = null;
const supportsPin = app === 'driver';
const PIN_ACCOUNT_KEY = 'swifthaul.driver.pin-account';
function rememberPinAccount(email) {
  if (typeof email !== 'string' || !email.includes('@')) return;
  try { localStorage.setItem(PIN_ACCOUNT_KEY, email.trim().toLowerCase()); } catch (error) { console.warn('Could not remember Driver PIN account on this device:', error); }
}
function rememberedPinAccount() {
  try { return localStorage.getItem(PIN_ACCOUNT_KEY) || ''; } catch { return ''; }
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
pinLoginButton.hidden = !supportsPin;
form.after(pinLoginButton);
pinLoginButton.addEventListener('click', () => setMode(mode === 'pin' ? 'login' : 'pin'));
let pinPanel = null;

const titles = {
  login: 'Welcome back.',
  pin: 'Sign in with your six-digit PIN.',
  signup: 'Join the SwiftHaul driver network.',
  recovery: 'Forgot your password?',
  reset: 'Choose a new password.'
};

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  const recovery = mode === 'recovery';
  const reset = mode === 'reset';
  const pinLogin = mode === 'pin';
  document.getElementById('auth-title').textContent = titles[mode];
  form.elements.name.closest('label').hidden = !signup;
  form.elements.name.required = signup;
  for (const field of ['phone','licenseNumber','licenseExpiry','vehicleType','vehicleRegistration']) {
    const control = form.elements[field];
    if (control) {
      control.closest('label').hidden = !signup;
      control.required = signup;
    }
  }
  form.elements.email.closest('label').hidden = reset || pinLogin;
  form.elements.email.required = !reset && !pinLogin;
  form.elements.password.closest('label').hidden = recovery || pinLogin;
  form.elements.password.required = !recovery && !pinLogin;
  pinLabel.hidden = !pinLogin;
  pinInput.required = pinLogin;
  pinLoginButton.hidden = !supportsPin || !['login','pin'].includes(mode);
  pinLoginButton.textContent = pinLogin ? 'Use password instead' : 'Use 6-digit PIN';
  form.elements.password.minLength = mode === 'login' ? 1 : 10;
  form.elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  document.getElementById('terms-acceptance').hidden = !signup;
  form.elements.acceptTerms.required = signup;
  form.elements.acceptTerms.checked = false;
  submit.textContent = ({login:'Sign in',pin:'Sign in with PIN',signup:'Create driver account',recovery:'Send reset link',reset:'Save new password'})[mode];
  status.textContent = '';
}

function showWorkspace(user) {
  currentUser = user;
  document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = user.name || user.email || 'Your account'; });
  document.body.dataset.guestPreview = 'false';
  const banner = document.getElementById('guest-banner');
  if (banner) banner.hidden = true;
  document.getElementById('sign-out').hidden = false;
  document.querySelectorAll('[data-account-label]').forEach(el => { el.textContent = 'Signed in as'; });
  if (app === 'driver') {
    const accountPanel = document.getElementById('account-details');
    let accountId = document.getElementById('driver-account-id');
    if (!accountId) { accountId = document.createElement('p'); accountId.id = 'driver-account-id'; accountPanel.append(accountId); }
    accountId.textContent = 'Driver account ID: ' + user.id;
    let verification = document.getElementById('driver-verification-status');
    if (!verification) { verification = document.createElement('p'); verification.id = 'driver-verification-status'; accountPanel.append(verification); }
    verification.textContent = 'Verification status: ' + (user.driverProfile?.verification_status || 'pending');
  }
  if (app === 'driver') {
    let approval = document.getElementById('driver-approval-banner');
    if (!approval) {
      approval = document.createElement('section');
      approval.id = 'driver-approval-banner';
      approval.className = 'driver-approval-banner';
      approval.setAttribute('role','status');
      const page = workspace.querySelector('main.page');
      page?.insertBefore(approval, page.querySelector('.section-links'));
    }
    const verification = user.driverProfile?.verification_status || 'pending';
    approval.hidden = verification === 'approved';
    approval.textContent = verification === 'approved'
      ? '' : 'APPLICATION PENDING APPROVAL — You can sign in and upload your documents, but delivery offers and going online remain locked until SwiftHaul verifies your application.';
    const online = document.getElementById('driver-online-toggle');
    if (online && verification !== 'approved') { online.checked = false; online.disabled = true; }
  }
  if (restoreScreen) restoreScreen.hidden = true;
  document.body.dataset.authState = 'authenticated';
  authScreen.hidden = true;
  workspace.hidden = false;
  document.dispatchEvent(new CustomEvent('account-ready', { detail: user }));
}


async function refreshPinPanel(session) {
  if (!supportsPin || !session?.access_token) return;
  const { data, error } = await supabase.functions.invoke('account-pin', {
    body: { action: 'status', app_type: 'driver' },
    headers: { Authorization: 'Bearer ' + session.access_token }
  });
  if (error) { console.warn('Driver PIN status unavailable:', error.message); return; }
  if (!pinPanel) {
    pinPanel = document.createElement('section');
    pinPanel.id = 'account-pin-security';
    pinPanel.className = 'panel';
    pinPanel.innerHTML = '<h2>Quick sign-in</h2><p data-pin-state>Check your PIN status.</p><button type="button" data-pin-edit>Set up 6-digit PIN</button><form data-pin-form hidden><label>Create 6-digit PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required></label><label>Confirm 6-digit PIN<input name="confirm_pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required></label><label>Confirm account password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Save PIN</button><p data-pin-message role="status"></p></form>';
    const accountSettings = workspace.querySelector('#driver-account-settings');
    if (accountSettings) accountSettings.append(pinPanel);
    else { const account = workspace.querySelector('#account-details'); if (account) account.append(pinPanel); else workspace.querySelector('main.page')?.prepend(pinPanel); }
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
        body: { action: 'set', app_type: 'driver', pin, password: setup.elements.password.value },
        headers: { Authorization: 'Bearer ' + sessionData.session.access_token }
      });
      if (saveError) { pinPanel.querySelector('[data-pin-message]').textContent = saved?.error || saveError.message; return; }
      setup.reset();
      setup.hidden = true;
      await refreshPinPanel(sessionData.session);
    });
  }
  pinPanel.querySelector('[data-pin-state]').textContent = data?.has_pin
    ? 'A quick sign-in PIN is enabled for this Driver account. You can change it here.'
    : 'Create your own six-digit PIN to sign in faster next time. Password sign-in remains available.';
  pinPanel.querySelector('[data-pin-edit]').textContent = data?.has_pin ? 'Change PIN' : 'Create 6-digit PIN';
}

async function validateAccount(session) {
  const { data, error } = await supabase.functions.invoke('account-me', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + session.access_token }
  });
  if (error) throw new Error(error.message || 'Unable to validate your account.');
  const user = data?.user;
  if (!user) throw new Error('Your account profile could not be loaded.');
  user.driverProfile = data.driverProfile || null;
  if (app === 'driver' && user.role !== 'driver') {
    throw new Error('This account is not registered as a driver. Create a driver account or contact dispatch.');
  }
  if (app === 'company' && !['admin','dispatcher'].includes(user.role)) {
    throw new Error('Company access is invitation-only. Please contact your administrator.');
  }
  if (user.accountStatus !== 'active') throw new Error('Your account is not active. Please contact SwiftHaul support.');
  if (app === 'driver') rememberPinAccount(session?.user?.email || user.email);
  if (app === 'driver' && session?.access_token) {
    // Only run after an authenticated session exists and account-me validates the driver.
    // With email confirmation enabled, this first runs on sign-in after confirmation.
    const { data: notificationResult, error: notificationError } =
      await supabase.functions.invoke('driver-application-notify', {
        body: {},
        headers: { Authorization: 'Bearer ' + session.access_token }
      });
    if (notificationError) console.warn('Driver onboarding notifications pending:', notificationError.message);
    else if (notificationResult?.success !== true) console.warn('Driver onboarding notifications were not completed.');
  }
  showWorkspace(user);
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
    form.elements.acceptTerms.reportValidity();
    return;
  }
  submit.disabled = true;
  status.textContent = 'Please wait…';
  try {
    const email = form.elements.email.value.trim().toLowerCase();
    const password = form.elements.password.value;
    if (mode === 'pin') {
      const pinAccountEmail = rememberedPinAccount();
      if (!pinAccountEmail) {
        setMode('login');
        status.textContent = 'For the first sign-in on this device, use your email and password. Your verified account will then be remembered for PIN-only sign-in.';
        return;
      }
      if (!/^[0-9]{6}$/.test(pinInput.value)) throw new Error('Enter your six-digit PIN.');
      const { data: pinData, error: pinError } = await supabase.functions.invoke('account-pin', {
        body: { action: 'login', app_type: 'driver', email: pinAccountEmail, pin: pinInput.value }
      });
      if (pinError) throw new Error(pinData?.error || pinError.message || 'PIN sign-in failed.');
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession(pinData.session);
      if (sessionError) throw sessionError;
      pinInput.value = '';
      await validateAccount(sessionData.session);
      return;
    }
    if (mode === 'recovery') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.href.split('#')[0]
      });
      if (error) throw error;
      status.textContent = 'If an account exists, a password reset link is on its way. Check your inbox.';
      return;
    }
    if (mode === 'reset') {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      form.elements.password.value = '';
      status.textContent = 'Password updated. You can now sign in.';
      setMode('login');
      return;
    }
    if (mode === 'signup') {
      if (app !== 'driver') throw new Error('Company accounts are created by an administrator.');
      const expiry = new Date(form.elements.licenseExpiry.value + 'T00:00:00');
      if (!Number.isFinite(expiry.getTime()) || expiry <= new Date(new Date().toDateString()))
        throw new Error('Enter a valid licence expiry date in the future.');
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.href.split('#')[0],
          data: {
            app_type: 'driver',
            full_name: form.elements.name.value.trim(),
            phone: form.elements.phone.value.trim(),
            license_number: form.elements.licenseNumber.value.trim(),
            license_expiry: form.elements.licenseExpiry.value,
            vehicle_type: form.elements.vehicleType.value,
            vehicle_registration: form.elements.vehicleRegistration.value.trim().toUpperCase(),
            terms_accepted: true,
            terms_version: '2026-10-30-wallet'
          }
        }
      });
      if (error) throw error;
      form.elements.password.value = '';
      if (!data.session) {
        status.textContent = 'Driver account created. Check your email to confirm it, then sign in.';
        setMode('login');
        return;
      }
      await validateAccount(data.session);
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    form.elements.password.value = '';
    await validateAccount(data.session);
  } catch (error) {
    status.textContent = error?.message || 'Unable to connect. Please try again.';
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('[data-auth-mode]').forEach(el => {
  el.addEventListener('click', () => {
    const requested = el.dataset.authMode;
    if (requested === 'signup' && app !== 'driver') return;
    setMode(requested);
  });
});
document.getElementById('sign-out').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    status.textContent = 'Unable to finish signing out. Please retry.';
    return;
  }
  currentUser = null;
  window.location.replace(window.location.pathname);
});

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    setMode('reset');
    if (restoreScreen) restoreScreen.hidden = true;
    document.body.dataset.authState = 'anonymous';
    authScreen.hidden = false;
    workspace.hidden = true;
    return;
  }
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    if (document.body.dataset.guestPreview !== 'true') {
      workspace.hidden = true;
      if (restoreScreen) restoreScreen.hidden = true;
      document.body.dataset.authState = 'anonymous';
      authScreen.hidden = false;
      document.dispatchEvent(new Event('account-cleared'));
    }
  }
  if (event === 'TOKEN_REFRESHED' && session && currentUser) {
    validateAccount(session).catch(error => console.warn('Account revalidation deferred; current workspace remains open:', error));
  }
});

async function init() {
  setMode('login');
  showSessionRestore();
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (session) {
      await validateAccount(session);
      return;
    }
    showSignIn();
  } catch (error) {
    showSessionRestore(error?.message || 'We could not verify your saved session. Try again, or return to sign in.');
  }
}
init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
