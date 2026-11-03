export type Vehicle = 'bike' | 'van' | 'truck';
export const baseFees = {bike:40,van:80,truck:180};
export const isVehicle = (value: unknown): value is Vehicle => typeof value === 'string' && Object.hasOwn(baseFees,value);
export const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
export class RouteError extends Error {status:number;constructor(message:string,status=502){super(message);this.status=status;}}
export function calculateFare(vehicle: Vehicle, meters: number) {
  if (!isVehicle(vehicle) || !Number.isFinite(meters) || meters < 0) throw new RouteError('Invalid vehicle or route distance.',400);
  const band = Math.floor(meters / 12000);
  const price = baseFees[vehicle] * (2 ** band);
  if (!Number.isSafeInteger(price)) throw new RouteError('This route requires a manual quote. Contact dispatch.',422);
  return {price,band};
}
type Point = { latitude: number; longitude: number; label: string };
export async function getDeliveryRoute(pickupAddress: string, dropoffAddress: string, pickupPin?: {latitude:number;longitude:number} | null, dropoffPin?: {latitude:number;longitude:number} | null) {
  const getJSON = async (url: URL) => {
    const response = await fetch(url, {signal:AbortSignal.timeout(10000), headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error('Map provider unavailable');
    return response.json();
  };
  const geocode = async (address: string): Promise<Point | null> => {
    const url = new URL('https://photon.komoot.io/api/');
    url.search = new URLSearchParams({q:address,limit:'1',bbox:'16,-35,33,-22'}).toString();
    const data = await getJSON(url);
    const feature = data.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2 || !coords.every(Number.isFinite) || coords[0] < 16 || coords[0] > 33 || coords[1] < -35 || coords[1] > -22) return null;
    const p = feature.properties || {};
    const label = [p.name, [p.housenumber,p.street].filter(Boolean).join(' '),p.city || p.town || p.district,p.country].filter(Boolean).join(', ');
    return {longitude:coords[0],latitude:coords[1],label:label || address};
  };
  try {
    const validPin=(pin: {latitude:number;longitude:number} | null | undefined): pin is {latitude:number;longitude:number} => !!pin && Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude) && Math.abs(pin.latitude)<=90 && Math.abs(pin.longitude)<=180;
    const [pickup,dropoff] = await Promise.all([validPin(pickupPin)?Promise.resolve({...pickupPin,label:pickupAddress}):geocode(pickupAddress),validPin(dropoffPin)?Promise.resolve({...dropoffPin,label:dropoffAddress}):geocode(dropoffAddress)]);
    if (!pickup || !dropoff) throw new RouteError('We could not locate one of these addresses in South Africa. Enter a more complete street address, suburb and city.',422);
    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${pickup.longitude},${pickup.latitude};${dropoff.longitude},${dropoff.latitude}`);
    url.search = new URLSearchParams({overview:'simplified',geometries:'geojson',alternatives:'false',steps:'false'}).toString();
    const data = await getJSON(url);
    const route = data.routes?.[0];
    if (data.code === 'NoRoute') throw new RouteError('No driving route was found between these locations. Check the pickup and drop-off addresses.',422);
    const coordinates = route?.geometry?.coordinates;
    if (data.code !== 'Ok' || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 20000 || !coordinates.every((c: unknown) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90) || !Number.isFinite(route.distance) || !Number.isFinite(route.duration) || route.distance < 0 || route.duration < 0) throw new Error('Invalid route');
    return {pickup,dropoff,coordinates,distance:route.distance,duration:route.duration};
  } catch (error) {if (error instanceof RouteError) throw error;throw new RouteError('The route map is temporarily unavailable. Please try again.',502);}
}

// One packed consignment; volume is measured in centimetres, mass in kilograms.
export function calculateLoad(input: unknown) {
  const parcel=input as Record<string,unknown> | null;
  const fields=['weight','length','width','height'] as const;
  if (!parcel || fields.some(key=>typeof parcel[key]!=='number' || !Number.isFinite(parcel[key]) || (parcel[key] as number)<=0 || (parcel[key] as number)>100000)) throw new RouteError('Enter a positive actual weight and all three packed dimensions.',400);
  const weight=parcel.weight as number,length=parcel.length as number,width=parcel.width as number,height=parcel.height as number;
  const volumetric=length*width*height/5000;
  const chargeable=Math.max(weight,volumetric);
  if(chargeable>8000) throw new RouteError('Loads above 8,000 chargeable kg require a manual quote. Contact dispatch.',422);
  const vehicle:Vehicle=chargeable<=20?'bike':chargeable<=1000?'van':'truck';
  const truckClass=vehicle==='truck'?(chargeable<=4000?'4-ton':'8-ton'):null;
  const included=vehicle==='bike'?5:vehicle==='van'?50:1000;
  const rate=vehicle==='bike'?8.5:vehicle==='van'?5:truckClass==='4-ton'?0.45:0.5;
  const extra=Math.max(0,chargeable-included);
  const weightFee=Math.round((extra*rate+Number.EPSILON)*100)/100;
  return {weight,length,width,height,volumetric,chargeable,vehicle,truckClass,included,rate,extra,weightFee,divisor:5000};
}
export function calculateDeliveryFare(input:unknown,meters:number){
  const load=calculateLoad(input);
  const {price:distanceFee,band}=calculateFare(load.vehicle,meters);
  const cents=Math.round(distanceFee*100)+Math.round(load.weightFee*100);
  if(!Number.isSafeInteger(cents))throw new RouteError('This load and route require a manual quote. Contact dispatch.',422);
  return {price:cents/100,band,distanceFee,load};
}
