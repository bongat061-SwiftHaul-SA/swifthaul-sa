# Multi-stop dispatch routes

## Status

Development-branch implementation only. The migration and Edge Function are not applied or deployed to the connected Supabase project. Production remains unchanged.

## Data model

- `dispatch_routes` stores a route assignment, driver, lifecycle state and optional server-calculated route analytics.
- `dispatch_route_stops` stores the ordered pickup/drop-off sequence for each waybill.
- Each waybill must have exactly one pickup and one drop-off in a route; pickup must precede its drop-off.
- A route supports up to 30 stops (15 deliveries) in this first iteration.
- Tables have RLS enabled and no direct anon/authenticated grants. Only the server-side service role is granted table access; all user access is mediated by the authenticated Edge Function.

## User interface

- Company Admin shows eligible unassigned pending deliveries with selection checkboxes, accepts the approved driver's account ID, creates a route, and provides persistent up/down stop ordering.
- Driver view displays assigned route stops, identifies the next pending stop, and provides a Start Route action.
- Driver pickup and final drop-off actions call the route API to synchronize the corresponding stop after the delivery status transition succeeds.
- Until the migration and Edge Function are released together, the UI displays a staged-service notice and does not expose route creation controls.

## Edge Function contract: `dispatch-routes`

All requests require a valid Supabase access token.

### GET

- Admin/dispatcher: recent routes and ordered stops.
- Driver: only their own assigned or in-progress routes.
- Stop responses include the linked booking's pickup/drop-off, recipient, vehicle and status for task display.

### POST actions

- `create_route`: dispatcher-only; accepts `driver_user_id` and an ordered `stops` array of `{ waybill, stop_type }`. Each booking must be pending and unassigned, the driver must be active and approved, and every pickup must precede its drop-off. The function assigns the selected bookings to the driver.
- `reorder_route`: dispatcher-only; requires the complete list of stop IDs exactly once. It preserves pickup-before-drop-off ordering and uses a temporary sequence range to avoid unique-key collisions.
- `start_route`: assigned driver only; transitions an assigned route to in-progress.
- `sync_waybill`: assigned driver only; marks pickup stops complete after pickup/in-transit status and drop-off stops complete only after the booking reaches delivered (which already requires proof and recipient PIN). A route closes only when every stop is complete. The dispatch status endpoint also blocks pickup/drop-off progression when the driver has not started the route or is not at the next pending stop.

## Important rollout dependencies

1. Apply the migration in a dedicated Supabase development branch, not production.
2. Deploy `dispatch-routes` to that same development branch.
3. Connect the Company Admin route builder and Driver route sheet to the endpoint.
4. Integrate a traffic-aware routing provider before displaying authoritative cumulative ETA, distance or route geometry.
5. Test route assignment races, stop reordering, proof/PIN gating, driver isolation, dispatcher permissions and cancellation/refund handling.

Fuel, tolls, delivery-tier pricing and profitability are intentionally not calculated by this route persistence layer. Those require trusted server-side routing/cost inputs and a separately reviewed margin engine.
