import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { createNativePinLock } from './native-pin-lock.js';

const nativePin = await createNativePinLock('driver');
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
    ...(nativePin.storage ? { storage: nativePin.storage } : {})
  }
});
window.swiftHaulSupabase = supabase;

const app = document.body.dataset.app;
const authScreen = document.getElementById('auth-screen');
const workspace = document.getElementById('workspace');
const form = document.getElementById('auth-form');
const status = document.getElementById('auth-status');
const submit = form.querySelector('[type=submit]');
let mode = 'login';
let currentUser = null;

const titles = {
  login: 'Welcome back.',
  signup: 'Join the SwiftHaul driver network.',
  recovery: 'Forgot your password?',
  reset: 'Choose a new password.'
};

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  const recovery = mode === 'recovery';
  const reset = mode === 'reset';
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
  form.elements.email.closest('label').hidden = reset;
  form.elements.email.required = !reset;
  form.elements.password.closest('label').hidden = recovery;
  form.elements.password.required = !recovery;
  form.elements.password.minLength = mode === 'login' ? 1 : 10;
  form.elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  document.getElementById('terms-acceptance').hidden = !signup;
  form.elements.acceptTerms.required = signup;
  form.elements.acceptTerms.checked = false;
  submit.textContent = ({login:'Sign in',signup:'Create driver account',recovery:'Send reset link',reset:'Save new password'})[mode];
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
  authScreen.hidden = true;
  workspace.hidden = false;
  document.dispatchEvent(new CustomEvent('account-ready', { detail: user }));
}

async function validateAccount(session) {
  await nativePin.requireUnlock();
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
document.querySelectorAll('[data-social-provider]').forEach(button => button.addEventListener('click', async () => {
  const provider = button.dataset.socialProvider;
  if (!['google', 'apple'].includes(provider)) return;
  if (mode !== 'login' && mode !== 'signup') {
    status.textContent = 'Return to Sign in or Create account to use Google or Apple.';
    return;
  }
  const intent = { app: 'driver', mode };
  if (mode === 'signup') {
    const fields = ['name', 'phone', 'licenseNumber', 'licenseExpiry', 'vehicleType', 'vehicleRegistration'];
    for (const name of fields) {
      const field = form.elements[name];
      if (!field.value.trim() || !field.checkValidity()) {
        status.textContent = 'Complete all required driver details before continuing.';
        field.reportValidity();
        return;
      }
    }
    if (!form.elements.acceptTerms.checked) {
      status.textContent = 'Read and accept the terms and conditions to continue.';
      form.elements.acceptTerms.reportValidity();
      return;
    }
    const expiry = form.elements.licenseExpiry.value;
    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const today = todayParts.find(part => part.type === 'year').value + '-' +
      todayParts.find(part => part.type === 'month').value + '-' +
      todayParts.find(part => part.type === 'day').value;
    if (expiry <= today) {
      status.textContent = 'Enter a valid licence expiry date in the future.';
      return;
    }
    intent.profile = {
      full_name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      license_number: form.elements.licenseNumber.value.trim(),
      license_expiry: expiry,
      vehicle_type: form.elements.vehicleType.value,
      vehicle_registration: form.elements.vehicleRegistration.value.trim().toUpperCase(),
      terms_accepted: true,
      terms_version: '2026-10-30-wallet'
    };
  }
  button.disabled = true;
  status.textContent = 'Connecting to ' + (provider === 'google' ? 'Google' : 'Apple') + '…';
  sessionStorage.setItem('swifthaul-social-intent', JSON.stringify(intent));
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
  } catch (error) {
    sessionStorage.removeItem('swifthaul-social-intent');
    status.textContent = error?.message || 'Social sign-in could not be started.';
    button.disabled = false;
  }
}));

document.getElementById('sign-out').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    status.textContent = 'Unable to finish signing out. Please retry.';
    return;
  }
  await nativePin.clearPin();
  currentUser = null;
  window.location.replace(window.location.pathname);
});

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    setMode('reset');
    authScreen.hidden = false;
    workspace.hidden = true;
    return;
  }
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    if (document.body.dataset.guestPreview !== 'true') {
      workspace.hidden = true;
      authScreen.hidden = false;
      document.dispatchEvent(new Event('account-cleared'));
    }
  }
  if (event === 'TOKEN_REFRESHED' && session && currentUser) {
    validateAccount(session).catch(() => {
      workspace.hidden = true;
      authScreen.hidden = false;
      document.dispatchEvent(new Event('account-cleared'));
    });
  }
});

async function init() {
  setMode('login');
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (session) {
      const intentRaw = sessionStorage.getItem('swifthaul-social-intent');
      if (intentRaw) {
        const intent = JSON.parse(intentRaw);
        if (intent.app === 'driver' && intent.mode === 'signup') {
          const { data: onboardData, error: onboardError } = await supabase.functions.invoke('social-onboard', {
            body: { ...intent.profile, app_type: 'driver' },
            headers: { Authorization: 'Bearer ' + session.access_token }
          });
          if (onboardError) throw new Error(onboardData?.error || onboardError.message || 'Driver profile setup failed.');
        }
        sessionStorage.removeItem('swifthaul-social-intent');
      }
      await validateAccount(session);
    } else {
      sessionStorage.removeItem('swifthaul-social-intent');
      authScreen.hidden = false;
    }
  } catch (error) {
    authScreen.hidden = false;
    status.textContent = error?.message || 'Sign-in is unavailable. Please try again.';
  }
}

init();

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || workspace.hidden || document.body.dataset.guestPreview === 'true') return;
  try { await openWorkspace(); }
  catch {
    workspace.hidden = true;
    authScreen.hidden = false;
    document.dispatchEvent(new Event('account-cleared'));
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
