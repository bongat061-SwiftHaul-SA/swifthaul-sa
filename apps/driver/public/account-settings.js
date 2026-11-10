(() => {
  const supabase = window.swiftHaulSupabase;
  if (!supabase) return;
  let activeUser = null;
  let initialized = false;
  const bucket = "driver-profile-photos";
  const panel = document.getElementById("account-details");
  if (!panel) return;

  const section = document.createElement("section");
  section.className = "driver-account-settings";
  section.innerHTML = `
    <div class="driver-profile-photo-row">
      <img id="driver-profile-photo" alt="Your driver profile photo" hidden>
      <div class="driver-profile-photo-placeholder" id="driver-profile-photo-placeholder" aria-hidden="true">DS</div>
      <div><strong>Profile photo</strong><p class="subtle">Add a clear photo so dispatch and customers can recognise you.</p>
        <label class="driver-photo-upload">Upload or change photo<input id="driver-photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
        <p class="subtle">JPG, PNG or WebP · maximum 5 MB</p>
      </div>
    </div>
    <form id="driver-profile-form">
      <h3>Personal details</h3>
      <label>Full name<input name="full_name" autocomplete="name" minlength="2" maxlength="120" required></label>
      <label>Mobile number<input name="phone" type="tel" autocomplete="tel" minlength="7" maxlength="30" required></label>
      <button class="primary" type="submit">Save personal details</button>
      <p id="driver-profile-status" role="status" aria-live="polite"></p>
    </form>
    <form id="driver-email-form">
      <h3>Login email</h3>
      <label>New email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
      <label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Change login email</button>
      <p class="subtle">Supabase may send a confirmation link to your current and/or new email address before the change takes effect.</p>
      <p id="driver-email-status" role="status" aria-live="polite"></p>
    </form>
    <form id="driver-password-form">
      <h3>Change password</h3>
      <label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
      <label>New password<input name="new_password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label>
      <label>Confirm new password<input name="confirm_password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label>
      <button type="submit">Update password</button>
      <p class="subtle">Use at least 10 characters. Choose a password you do not use elsewhere.</p>
      <p id="driver-password-status" role="status" aria-live="polite"></p>
    </form>
    <div class="driver-delete-account">
      <h3>Delete driver account</h3>
      <p>Closing your account disables sign-in and availability and anonymises personal profile details. Delivery, payout and financial records may be retained where required for legal, tax, fraud-prevention and reconciliation purposes.</p>
      <form id="driver-delete-form">
        <label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
        <label>Type DELETE to confirm<input name="confirmation" autocomplete="off" required pattern="DELETE"></label>
        <button class="danger" type="submit">Delete my driver account</button>
      </form>
      <p id="driver-delete-status" role="status" aria-live="polite"></p>
    </div>`;

  function setStatus(id, message, isError = false) {
    const el = document.getElementById(id);
    if (el) { el.textContent = message; el.dataset.error = String(isError); }
  }
  async function reauthenticate(password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: activeUser?.email || "", password
    });
    if (error || !data.user) throw new Error("Your current password could not be verified.");
    return data;
  }
  async function loadPhoto(user) {
    const path = user?.user_metadata?.avatar_path;
    const img = document.getElementById("driver-profile-photo");
    const placeholder = document.getElementById("driver-profile-photo-placeholder");
    if (!path) { img.hidden = true; placeholder.hidden = false; return; }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { img.hidden = true; placeholder.hidden = false; return; }
    img.src = data.signedUrl;
    img.hidden = false;
    placeholder.hidden = true;
  }
  function init(user) {
    activeUser = user;
    if (!initialized) {
      panel.append(section);
      initialized = true;
      document.getElementById("driver-profile-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        setStatus("driver-profile-status", "Saving…");
        try {
          const { data, error } = await supabase.functions.invoke("driver-account-settings", {
            body: { action: "update-profile", full_name: form.elements.full_name.value, phone: form.elements.phone.value }
          });
          if (error || !data?.success) throw new Error(data?.error || error?.message || "Unable to save details.");
          document.querySelectorAll("[data-user-name]").forEach(el => el.textContent = data.full_name);
          setStatus("driver-profile-status", "Your personal details have been updated.");
        } catch (error) { setStatus("driver-profile-status", error.message, true); }
        finally { button.disabled = false; }
      });
      document.getElementById("driver-email-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        setStatus("driver-email-status", "Verifying your current password…");
        try {
          await reauthenticate(form.elements.current_password.value);
          const { error } = await supabase.auth.updateUser({ email: form.elements.email.value.trim().toLowerCase() });
          if (error) throw error;
          form.reset();
          setStatus("driver-email-status", "Email change requested. Follow the confirmation instructions sent by email.");
        } catch (error) { setStatus("driver-email-status", error.message || "Unable to change email.", true); }
        finally { button.disabled = false; }
      });
      document.getElementById("driver-password-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector("button[type=submit]");
        if (form.elements.new_password.value !== form.elements.confirm_password.value) {
          setStatus("driver-password-status", "The new passwords do not match.", true); return;
        }
        button.disabled = true;
        setStatus("driver-password-status", "Verifying your current password…");
        try {
          await reauthenticate(form.elements.current_password.value);
          const { error } = await supabase.auth.updateUser({ password: form.elements.new_password.value });
          if (error) throw error;
          form.reset();
          setStatus("driver-password-status", "Your password has been changed.");
        } catch (error) { setStatus("driver-password-status", error.message || "Unable to change password.", true); }
        finally { button.disabled = false; }
      });
      document.getElementById("driver-photo-input").addEventListener("change", async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
          setStatus("driver-profile-status", "Choose a JPG, PNG or WebP image no larger than 5 MB.", true);
          event.target.value = ""; return;
        }
        setStatus("driver-profile-status", "Uploading photo…");
        try {
          const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
          const path = activeUser.id + "/avatar-" + Date.now() + "." + ext;
          const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
            upsert: true, contentType: file.type, cacheControl: "3600"
          });
          if (uploadError) throw uploadError;
          const { data, error } = await supabase.auth.updateUser({ data: { avatar_path: path } });
          if (error) throw error;
          activeUser = data.user || activeUser;
          await loadPhoto(activeUser);
          setStatus("driver-profile-status", "Your profile photo has been updated.");
        } catch (error) { setStatus("driver-profile-status", error.message || "Photo upload failed.", true); }
        finally { event.target.value = ""; }
      });
      document.getElementById("driver-delete-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (form.elements.confirmation.value !== "DELETE") {
          setStatus("driver-delete-status", "Type DELETE exactly to confirm.", true); return;
        }
        if (!window.confirm("Delete your SwiftHaul Driver account? This will close access and anonymise your profile. This cannot be undone.")) return;
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        setStatus("driver-delete-status", "Verifying your password and closing account…");
        try {
          await reauthenticate(form.elements.current_password.value);
          const { data, error } = await supabase.functions.invoke("driver-account-settings", {
            body: { action: "delete-account", confirmation: "DELETE" }
          });
          if (error || !data?.success) throw new Error(data?.error || error?.message || "Account closure failed.");
          setStatus("driver-delete-status", data.message || "Account closed.");
          await supabase.auth.signOut();
          window.location.replace(window.location.pathname);
        } catch (error) {
          setStatus("driver-delete-status", error.message || "Unable to close account.", true);
          button.disabled = false;
        }
      });
    }
    const profileForm = document.getElementById("driver-profile-form");
    profileForm.elements.full_name.value = user.name || "";
    profileForm.elements.phone.value = user.phone || user.driverProfile?.phone || "";
    loadPhoto(user);
  }
  document.addEventListener("account-ready", event => init(event.detail));
  document.addEventListener("account-cleared", () => { activeUser = null; });
})();
