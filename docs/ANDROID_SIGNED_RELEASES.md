# SwiftHaul signed Android APK releases

The signed-release workflow is separate from the debug preview APK workflow. It is restricted to the `feature/customer-simple-estimator-driver-account` branch and builds against the isolated staging Supabase project. It does not publish to Google Play or deploy a website.

## One-time signing key setup

Create one long-lived Android upload/release keystore on a trusted computer. Keep a secure offline backup. **Do not commit the keystore, paste it into chat, or share it with anyone.** The same keystore must be retained for future updates to these app IDs.

With Java's `keytool` installed, run:

```bash
keytool -genkeypair -v \
  -keystore swifthaul-release.jks \
  -alias swifthaul-release \
  -keyalg RSA -keysize 4096 -validity 10000
```

Choose strong passwords and store them in a password manager. Do not lose the keystore or passwords: Android updates must be signed with the same signing identity.

## Add GitHub Actions repository secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add these four secrets:

| Secret name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded contents of `swifthaul-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `swifthaul-release` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | Key password |

Linux encoding command (keeps the output on one line):

```bash
base64 -w 0 swifthaul-release.jks
```

On macOS:

```bash
base64 < swifthaul-release.jks | tr -d '\n'
```

Copy the encoded output directly into the GitHub secret value. Never commit the encoded output file.

## Run the signed build

After all four secrets are configured and the workflow file is available on the repository's default branch, open **Actions → Build signed SwiftHaul Android release APKs → Run workflow**, select `feature/customer-simple-estimator-driver-account`, and run it.

GitHub requires a `workflow_dispatch` workflow to exist on the default branch before it can be manually dispatched. The workflow job itself refuses to build from any branch other than the named feature branch.

## Outputs and release boundary

The workflow creates three 14-day artifacts:

- `swifthaul-customer-signed-apk`
- `swifthaul-driver-signed-apk`
- `swifthaul-company-admin-signed-apk`

These are signed staging APKs. They are not production releases and are not uploaded to Google Play. Test installation, upgrade behavior, authentication, navigation, and staging API access on physical Android devices before considering a production release.
