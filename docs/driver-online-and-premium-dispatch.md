# Driver online availability and Premium-first offers

## Driver availability
Approved drivers can explicitly switch Online/Offline. The server stores `driver_profiles.is_online` and `online_updated_at`. Offline or unapproved drivers are excluded from offers. The driver portal polls its offer inbox every 30 seconds.

## Offer dispatch
The dispatcher enters an unassigned waybill and requests the next offer. The server:
- Requires an active admin or dispatcher account.
- Requires the booking to remain pending, unassigned and not refunded.
- Selects only approved, online drivers.
- Requires the driver's vehicle type to match the booking vehicle when specified.
- Prioritizes an active Premium membership before standard drivers.
- Uses least-recently-offered ordering as a basic fair-rotation tie-break.
- Sends one offer at a time with a 60-second expiry.
- Excludes drivers already offered that waybill, including declined/expired offers.
- Allows the driver to accept or decline. Acceptance assigns the booking only while it remains pending and unassigned; other live offers are cancelled.

## Current limitations
- Dispatchers must manually request the next offer after a decline or expiry; no automatic background scheduler is configured.
- Candidate distance ranking is not yet implemented because driver GPS coordinates are not persisted as a trusted, timestamped availability location.
- Vehicle matching currently uses exact normalized vehicle-type equality.
- The offer flow is newly deployed and has not yet been browser-tested with real driver/dispatcher accounts.
- Existing manual assignment remains available through `dispatch-operations`.
- Premium priority is first offer, not a guaranteed delivery or income.
