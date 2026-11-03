import {getUser} from '@netlify/identity';
import {createHash} from 'node:crypto';
import {RouteError} from './delivery.mts';
import type {} from '@netlify/functions';
export function appOrigin(app:'driver'|'company'){
 const value=Netlify.env.get(app==='driver'?'DRIVER_SITE_ORIGIN':'COMPANY_SITE_ORIGIN');
 if(!value)throw new RouteError('The '+app+' platform connection is not configured yet.',503);
 const url=new URL(value);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new RouteError('Platform connection configuration is invalid.',503);return url.origin;
}
export const driverKey=(id:string)=>createHash('sha256').update('driver:'+appOrigin('driver')+':'+id).digest('hex');
export async function operationsUser(req:Request){
 const app=req.headers.get('x-swifthaul-app');
 if(app==='driver'||app==='company'){
  const token=req.headers.get('authorization');if(!token||!/^Bearer [A-Za-z0-9_.-]+$/.test(token))throw new RouteError('Sign in to the platform.',401);
  const response=await fetch(appOrigin(app)+'/.netlify/identity/user',{headers:{Authorization:token},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new RouteError('Platform sign-in could not be verified.',401);
  const user=await response.json();const role=app==='driver'?'driver':'admin';
  if(!Array.isArray(user.app_metadata?.roles)||!user.app_metadata.roles.includes(role))throw new RouteError('Your account needs the '+role+' role before accessing deliveries.',403);
  return {app,id:user.id};
 }
 const user=await getUser();if(!user?.roles?.includes('admin'))throw new RouteError('Company administrator access required.',403);return {app:'company',id:user.id};
}
