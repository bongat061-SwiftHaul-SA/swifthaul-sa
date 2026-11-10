// Native-only quick unlock and Supabase session storage.
// Android values are encrypted by Android Keystore through @aparajita/capacitor-secure-storage.
// This module deliberately does not use its web/localStorage implementation.
export async function createNativePinLock(appId) {
  // Capacitor 7 does not guarantee a window.Capacitor global in every WebView.
  // Import the supported runtime API so native detection works in packaged APKs.
  let capacitor = window.Capacitor;
  if (!capacitor?.isNativePlatform) {
    try {
      const core = await import('https://esm.sh/@capacitor/core@7.6.10');
      capacitor = core.Capacitor;
    } catch (error) {
      console.warn('SwiftHaul: Capacitor runtime could not be loaded; PIN unlock is unavailable.', error);
    }
  }
  if (!capacitor?.isNativePlatform?.()) {
    return {
      isNative: false,
      storage: undefined,
      requireUnlock: async () => {},
      clearPin: async () => {},
      lock: () => {}
    };
  }

  const { SecureStorage } = await import('https://esm.sh/@aparajita/capacitor-secure-storage@7.1.6');
  await SecureStorage.setKeyPrefix(`swifthaul_${appId}_`);

  const storage = {
    getItem: key => SecureStorage.getItem(key),
    setItem: (key, value) => SecureStorage.setItem(key, value),
    removeItem: key => SecureStorage.removeItem(key)
  };
  const pinKey = 'quick_unlock_v1';
  const attemptsKey = 'quick_unlock_attempts_v1';
  const unlockUntilKey = 'quick_unlock_until_v1';
  const getJson = async key => {
    const raw = await SecureStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  };
  const setJson = (key, value) => SecureStorage.setItem(key, JSON.stringify(value));
  const removeValue = key => SecureStorage.removeItem(key);
  let unlocked = false;
  let lastActivity = Date.now();
  let promptPromise = null;
  let idleTimer = null;
  let overlay;
  let appLifecycle = null;

  const getPinRecord = async () => {
    return getJson(pinKey);
  };
  const derive = async (pin, salt) => {
    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256'
    }, material, 256);
    return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
  const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const equal = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };
  const getOverlay = () => {
    if (overlay) return overlay;
    overlay = document.createElement('section');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'swift-pin-title');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#f4f7f5;color:#173d31;display:none;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif';
    overlay.innerHTML = `
      <div style="width:min(100%,390px);background:white;border-radius:20px;padding:28px;box-shadow:0 18px 60px #173d3126">
        <p style="font-size:12px;font-weight:800;letter-spacing:.12em">SWIFTHAUL SA</p>
        <h1 id="swift-pin-title" style="font-size:25px;margin:10px 0">Quick unlock</h1>
        <p id="swift-pin-copy" style="color:#52635b">Enter your six-digit app PIN.</p>
        <form id="swift-pin-form">
          <label for="swift-pin-input" style="display:block;font-weight:700;margin:20px 0 8px">6-digit PIN</label>
          <input id="swift-pin-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required
            style="box-sizing:border-box;width:100%;font-size:28px;letter-spacing:.35em;text-align:center;padding:14px;border:1px solid #b9c8c0;border-radius:12px">
          <div id="swift-pin-confirm-wrap" hidden>
            <label for="swift-pin-confirm" style="display:block;font-weight:700;margin:16px 0 8px">Confirm PIN</label>
            <input id="swift-pin-confirm" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
              style="box-sizing:border-box;width:100%;font-size:28px;letter-spacing:.35em;text-align:center;padding:14px;border:1px solid #b9c8c0;border-radius:12px">
          </div>
          <p id="swift-pin-error" role="alert" style="min-height:22px;color:#a12e2e"></p>
          <button id="swift-pin-submit" type="submit" style="width:100%;padding:14px;border:0;border-radius:12px;background:#173d31;color:white;font-weight:800;font-size:16px">Unlock</button>
        </form>
        <button id="swift-pin-forgot" type="button" style="margin-top:16px;padding:8px 0;border:0;background:transparent;color:#52635b;text-decoration:underline">Forgot PIN? Sign in again</button>
      </div>`;
    document.body.append(overlay);
    return overlay;
  };

  async function showPinPrompt(setup) {
    const root = getOverlay();
    const form = root.querySelector('#swift-pin-form');
    const pinInput = root.querySelector('#swift-pin-input');
    const confirmInput = root.querySelector('#swift-pin-confirm');
    const confirmWrap = root.querySelector('#swift-pin-confirm-wrap');
    const error = root.querySelector('#swift-pin-error');
    const title = root.querySelector('#swift-pin-title');
    const copy = root.querySelector('#swift-pin-copy');
    const submit = root.querySelector('#swift-pin-submit');
    const forgot = root.querySelector('#swift-pin-forgot');
    title.textContent = setup ? 'Create your app PIN' : 'Welcome back';
    copy.textContent = setup
      ? 'Create a six-digit PIN to unlock this app on this device. Your account password remains your recovery method.'
      : 'Enter your six-digit PIN to unlock your signed-in account.';
    confirmWrap.hidden = !setup;
    confirmInput.required = setup;
    submit.textContent = setup ? 'Save PIN and continue' : 'Unlock';
    forgot.hidden = setup;
    root.style.display = 'flex';
    pinInput.value = '';
    confirmInput.value = '';
    error.textContent = '';
    pinInput.focus();

    return new Promise((resolve, reject) => {
      const finish = (ok, value) => {
        form.removeEventListener('submit', onSubmit);
        forgot.removeEventListener('click', onForgot);
        root.style.display = 'none';
        if (ok) resolve(value);
        else reject(new Error('PIN recovery requested.'));
      };
      const onForgot = () => finish(false);
      const onSubmit = async event => {
        event.preventDefault();
        const pin = pinInput.value;
        if (!/^\d{6}$/.test(pin)) { error.textContent = 'Enter all six digits.'; return; }
        submit.disabled = true;
        try {
          if (setup) {
            if (confirmInput.value !== pin) { error.textContent = 'The PINs do not match.'; submit.disabled = false; return; }
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const hash = await derive(pin, salt);
            await setJson(pinKey, { version: 1, salt: toBase64(salt), hash });
            await removeValue(attemptsKey);
            finish(true);
          } else {
            const attempts = await getJson(attemptsKey) || { count: 0, lockedUntil: 0 };
            if (Date.now() < attempts.lockedUntil) {
              const seconds = Math.ceil((attempts.lockedUntil - Date.now()) / 1000);
              error.textContent = `Too many attempts. Try again in ${seconds} seconds.`;
              submit.disabled = false;
              return;
            }
            const record = await getPinRecord();
            const candidate = await derive(pin, fromBase64(record.salt));
            if (!equal(candidate, record.hash)) {
              const count = attempts.count + 1;
              const lockedUntil = count >= 5 ? Date.now() + 60000 : 0;
              await setJson(attemptsKey, { count: count >= 5 ? 0 : count, lockedUntil });
              error.textContent = lockedUntil
                ? 'Five incorrect attempts. PIN unlock is paused for one minute.'
                : `Incorrect PIN. ${5 - count} attempt(s) remaining.`;
              pinInput.value = '';
              submit.disabled = false;
              pinInput.focus();
              return;
            }
            await removeValue(attemptsKey);
            finish(true);
          }
        } catch (err) {
          error.textContent = err?.message || 'Secure PIN storage is unavailable. Sign in again.';
          submit.disabled = false;
        }
      };
      form.addEventListener('submit', onSubmit);
      forgot.addEventListener('click', onForgot);
    });
  }

  async function requireUnlock() {
    if (unlocked && Date.now() - lastActivity < 5 * 60 * 1000) return;
    // A full page navigation creates a fresh JS context. Reuse the encrypted
    // short-lived unlock marker so internal page changes do not ask for PIN again.
    const unlockUntil = Number(await SecureStorage.getItem(unlockUntilKey) || 0);
    if (unlockUntil > Date.now()) {
      unlocked = true;
      lastActivity = Date.now();
      scheduleIdleLock();
      return;
    }
    await removeValue(unlockUntilKey);
    unlocked = false;
    if (promptPromise) return promptPromise;
    promptPromise = (async () => {
      const record = await getPinRecord();
      if (!record) await showPinPrompt(true);
      else await showPinPrompt(false);
      unlocked = true;
      lastActivity = Date.now();
      await SecureStorage.setItem(unlockUntilKey, String(lastActivity + 5 * 60 * 1000));
      scheduleIdleLock();
    })();
    try {
      await promptPromise;
    } catch {
      await removeValue(pinKey);
      await removeValue(attemptsKey);
      const { error } = await window.swiftHaulSupabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      window.location.replace(window.location.pathname);
    } finally {
      promptPromise = null;
    }
  }

  const scheduleIdleLock = () => {
    clearTimeout(idleTimer);
    if (unlocked) idleTimer = setTimeout(async () => {
      unlocked = false;
      await removeValue(unlockUntilKey);
      requireUnlock().catch(() => {});
    }, Math.max(0, lastActivity + 5 * 60 * 1000 - Date.now()));
  };
  const lock = async () => {
    unlocked = false;
    clearTimeout(idleTimer);
    await removeValue(unlockUntilKey);
  };

  // Do not lock on document visibilitychange: Android WebView also fires that
  // during ordinary multi-page navigation. Use the native app lifecycle event.
  try {
    const appModule = await import('https://esm.sh/@capacitor/app@7.0.1?external=@capacitor/core');
    appLifecycle = await appModule.App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) lock().catch(error => console.warn('SwiftHaul PIN lock failed:', error));
    });
  } catch (error) {
    console.warn('SwiftHaul: native background-lock listener unavailable.', error);
  }
  const recordActivity = () => {
    if (unlocked) {
      lastActivity = Date.now();
      scheduleIdleLock();
    }
  };
  document.addEventListener('pointerdown', recordActivity, { passive: true });
  document.addEventListener('keydown', recordActivity, { passive: true });

  return {
    isNative: true,
    storage,
    requireUnlock,
    lock,
    clearPin: async () => {
      await removeValue(pinKey);
      await removeValue(attemptsKey);
      await removeValue(unlockUntilKey);
      unlocked = false;
    }
  };
}
