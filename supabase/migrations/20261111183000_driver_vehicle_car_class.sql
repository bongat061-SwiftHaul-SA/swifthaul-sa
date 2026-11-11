-- Support the South African hatchback/sedan onboarding vehicle class.
alter table public.driver_profiles drop constraint if exists driver_profiles_vehicle_type_check;
alter table public.driver_profiles add constraint driver_profiles_vehicle_type_check
  check (vehicle_type is null or vehicle_type in ('bike','car','bakkie','van','truck'));
