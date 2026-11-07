# SwiftHaul SA Android preview apps

This branch adds three separate Capacitor shells while leaving the existing web apps and the production Pages workflow untouched.

## App identities

| Platform | Wrapper directory | Android application ID |
|---|---|---|
| Customer | `android-customer/` | `za.co.swifthaul.customer` |
| Driver | `apps/driver/android-wrapper/` | `za.co.swifthaul.driver` |
| Company Admin | `apps/company/android-wrapper/` | `za.co.swifthaul.admin` |

The wrappers copy the existing platform web assets into a generated `www/` directory. The customer entry point is `customer.html`; the copy script also creates the `index.html` entry Capacitor expects.

## Local build

Prerequisites: Node.js 22, JDK 21, Android SDK, and Android build tools.

For each wrapper directory:

1. Run `npm install`.
2. Run `npx cap add android` once to generate the native Android project.
3. Run `npm run cap:sync` to refresh the platform assets and synchronize the Android project.
4. Open the project with `npm run android:open`, or run `cd android && ./gradlew assembleDebug`.

The GitHub Actions workflow `.github/workflows/android-preview.yml` performs these steps independently for all three apps and stores unsigned debug APK artifacts for 14 days. It runs only on this development branch or by manual dispatch. It does not publish to Google Play, create release APKs, or deploy the websites.

## Important integration and release gates

- These are preview wrappers, not production-ready signed mobile releases. The first CI run must validate Android project generation and compilation.
- The current web apps include relative asset paths, Netlify function references, and external web dependencies. Android packaging does not make Netlify Functions run inside the APK. Confirm every authentication, booking, dispatch, payment, and account flow against the deployed HTTPS backend before release.
- Do not put Supabase service-role keys, PayFast secrets, or other server credentials in the app bundle. Keep privileged operations server-side and enforce authorization with backend checks and database row-level security.
- Do not enable background driver location tracking until the Android permission flow, foreground-service notification, consent, and privacy disclosures are implemented and tested.
- Release signing keys must be stored as protected GitHub Actions secrets or in a secure release environment. Never commit keystores or passwords.
- The application IDs above are proposed identifiers. Confirm ownership and final branding before distributing signed builds.
- No Supabase schema, credentials, production configuration, or production deployment is changed by this foundation.

## Next validation

Run the Android preview workflow on this branch, fix any build or asset-path failures, then test each APK on a physical Android device. Only after the web-to-native integration and security checks pass should release signing and private/public APK distribution be prepared.
