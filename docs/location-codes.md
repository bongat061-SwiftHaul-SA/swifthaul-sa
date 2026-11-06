# SwiftHaul SA location codes

The Customer, Driver and Company/Administrator portals include a shared global pin picker.

## Location format

- **Open Location Code (Plus Code)** is the user-facing global location identifier. SwiftHaul generates a full 10-significant-character code (including the Plus Code separator) from the selected latitude/longitude. Full codes are shareable globally.
- **Short Plus Codes** can be produced only when a reference coordinate is supplied. The reference is part of the meaning of a short code; do not share a short code without its reference.
- **Geohash** is generated at precision 9 as a compact technical index for future database queries and proximity searches. It is supplementary and is not the customer-facing location code.
- Latitude and longitude remain the canonical numeric location values.

## Picker behaviour

1. Open **Global location & Plus Code** in the signed-in workspace.
2. Enter latitude/longitude, enter a full Plus Code, or use the device location; none of these actions needs a map. A short Plus Code can be resolved with reference coordinates.
3. Copy the full Plus Code, Geohash, coordinates, or an external map link.
4. Only when exact visual pin placement is useful, choose **Choose / adjust pin on map**, then tap or drag the marker.

The picker works without loading a map: users can enter coordinates or a Plus Code, copy the full code, Geohash and coordinates, or use device location. Leaflet and OpenStreetMap tiles load only after the user chooses “Choose / adjust pin on map”. Customer quote and booking route details are text-first; navigation opens in an external directions service. The Customer portal sends selected pickup/drop-off coordinates into route quoting and saves the Plus Code, Geohash and latitude/longitude with the booking through the authenticated booking API. Editing an address clears its old pin so a stale coordinate cannot silently override the new address. Customer booking cards, invoices and WhatsApp dispatch messages include the saved Plus Codes. The Netlify database migration adds the matching fields and validation; the Supabase `customer_bookings` schema has the same fields, and the secured dispatch function returns them to Driver and Administrator workspaces, where they can open the exact map pin and copy the code. Existing bookings remain valid with null location-code fields until a pin is added.

## Open-source implementation

The Plus Code implementation is loaded from Google's official Open Location Code repository, pinned to commit `83986da0156bbf51fba33d0327d8ca4b7f955c89`:

https://github.com/google/open-location-code

The library is Apache-2.0 licensed. The picker generates Geohash locally; no separate Geohash service is called.

## Data model recommendation for the next backend migration

Store both pickup and drop-off values as separate fields:
- `pickup_latitude`, `pickup_longitude`
- `pickup_plus_code`, `pickup_geohash`
- `dropoff_latitude`, `dropoff_longitude`
- `dropoff_plus_code`, `dropoff_geohash`

Use `geography(Point, 4326)` columns and GiST indexes if PostGIS is enabled. Retain the human-readable street address independently. Never replace the address with a short Plus Code without its reference location.
