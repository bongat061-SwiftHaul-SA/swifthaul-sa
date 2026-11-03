# SwiftHaul SA location codes

The Customer, Driver and Company/Administrator portals include a shared global pin picker.

## Location format

- **Open Location Code (Plus Code)** is the user-facing global location identifier. SwiftHaul generates a full 10-character code from the selected latitude/longitude. Full codes are shareable globally.
- **Short Plus Codes** can be produced only when a reference coordinate is supplied. The reference is part of the meaning of a short code; do not share a short code without its reference.
- **Geohash** is generated at precision 9 as a compact technical index for future database queries and proximity searches. It is supplementary and is not the customer-facing location code.
- Latitude and longitude remain the canonical numeric location values.

## Picker behaviour

1. Open **Global pin & Plus Code** in the signed-in workspace.
2. Open the map and tap anywhere, drag the marker, enter coordinates, or use the device's location permission.
3. Copy the full Plus Code, Geohash, coordinates, or a Google Maps URL.
4. Optionally enter reference coordinates to generate a regional short Plus Code.

The picker uses Leaflet with OpenStreetMap map tiles. Map tile attribution is shown in the map. It does not require a Google Maps API key. The current picker is a client-side utility; the selected pin is not yet written into the booking or dispatch database. The next integration step is to add pickup/drop-off coordinate and Plus Code fields to the booking quote, booking records and dispatch API, then display the persisted pins to drivers and dispatchers. Do not treat copying a code as proof that it has been saved to an order.

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
