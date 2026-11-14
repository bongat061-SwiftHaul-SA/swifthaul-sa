# SwiftHaul Google Maps setup

The Customer booking map supports Google Maps JavaScript API and retains the free MapLibre/CARTO map as a fallback.

## Before enabling Google Maps

Do not use a shared demo key or an unrestricted key in a published app. Create a dedicated browser key in the SwiftHaul Google Cloud project and restrict it before adding it to the site.

1. In Google Cloud Console, enable **Maps JavaScript API**.
2. Attach a billing account if Google requires it for the selected project/key. Review the current Maps Platform pricing and usage limits before enabling production traffic.
3. Under **Application restrictions**, choose **Websites (HTTP referrers)** and add:
   - `https://bongat061-swifthaul-sa.github.io/*`
4. Under **API restrictions**, choose **Restrict key** and allow only:
   - **Maps JavaScript API**
5. Save the restrictions. Wait for them to take effect, then test the key on the GitHub Pages Customer app.
6. Configure budget alerts and review Maps Platform quotas/usage. Budget alerts notify you; they are not a hard spending cap.

If a separately controlled staging hostname is introduced later, add only that exact hostname as another allowed referrer. Avoid broad wildcards such as `https://*.github.io/*`.

## Add the restricted browser key

Edit `public/google-maps-config.js` and set:

```js
window.SWIFTHAUL_GOOGLE_MAPS_API_KEY = 'YOUR_RESTRICTED_BROWSER_KEY';
```

A browser Maps key is visible to visitors in page source and network requests. That is expected for Maps JavaScript API; HTTP-referrer and API restrictions are the security controls. Never place a service-account credential or server-side secret in this file.

The current configuration intentionally contains an empty value. Until a restricted key is supplied, the booking map uses the existing free map provider. Google Maps loading failures also fall back to that free map.
