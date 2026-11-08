# SwiftHaul Android APK builds

SwiftHaul has three separate web application entry points and this workflow packages each as an independent Android application using Capacitor:

| App | Application ID | Web source |
| --- | --- | --- |
| Customer | `za.co.swifthaul.customer` | `public/` |
| Driver | `za.co.swifthaul.driver` | `apps/driver/public/` |
| Company Admin | `za.co.swifthaul.company` | `apps/company/public/` |

## Build

The GitHub Actions workflow `.github/workflows/android-apks.yml` creates the native Android project during CI, syncs the relevant web assets, and runs Gradle `assembleDebug` for each app. It uploads three separate APK artifacts:

- `swifthaul-customer-apk`
- `swifthaul-driver-apk`
- `swifthaul-company-admin-apk`

The artifacts are temporary CI test builds retained for 14 days. They are unsigned debug APKs for internal testing, not Play Store or production release packages.

## Important release checks

1. Verify sign-in, sign-out, session restoration and account screens on physical Android devices.
2. Verify map rendering, location permissions, camera/file uploads and delivery proof flows.
3. Verify deep links and any OAuth provider redirect flows on Android; browser OAuth behavior must not be assumed to work in a WebView.
4. Verify each app uses the intended staging Supabase project in preview builds and production configuration only in an explicitly approved release build.
5. Review Android back navigation, keyboard behavior, external links and network-loss handling.
6. Create a separately secured Android signing key and configure it as GitHub Actions secrets before producing signed release APKs. Never commit keystores or passwords.

## Scope and limitations

This workflow does not publish to Google Play, change either Supabase project, publish the GitHub Pages websites, or create a signed production APK. A successful Gradle build proves packaging only; it does not prove end-to-end app behavior. Device testing is required before calling these apps release-ready.
