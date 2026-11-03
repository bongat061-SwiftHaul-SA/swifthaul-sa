import {getUser} from '@netlify/identity';
import type {} from '@netlify/functions';
export default async(req:Request)=>{
 const headers={'Cache-Control':'no-store'};
 const reply=(error:string,status:number)=>Response.json({error},{status,headers});
 if(!['GET','POST'].includes(req.method))return reply('Method not allowed',405);
 if(req.method==='POST'&&req.headers.get('origin')!==new URL(req.url).origin)return reply('Invalid request origin',403);
 const user=await getUser();if(!user)return reply('Sign in to access deliveries.',401);
 const value=Netlify.env.get('CUSTOMER_API_ORIGIN');if(!value)return reply('Customer platform connection is not configured yet.',503);
 try{
  const origin=new URL(value);if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)return reply('Platform connection configuration is invalid.',503);
  const token=req.headers.get('cookie')?.match(/(?:^|;\s*)nf_jwt=([^;]+)/)?.[1];if(!token)return reply('Sign in again to reconnect your account.',401);
  const body=req.method==='POST'?await req.text():undefined;if(body&&body.length>4096)return reply('Request too large',413);
  const response=await fetch(origin.origin+'/api/operations',{method:req.method,headers:{Authorization:'Bearer '+decodeURIComponent(token),'x-swifthaul-app':'driver','Content-Type':'application/json',origin:origin.origin},body,signal:AbortSignal.timeout(20000)});
  return new Response(await response.text(),{status:response.status,headers:{...headers,'Content-Type':'application/json'}});
 }catch{return reply('Platform connection is unavailable. Please retry.',503);}
};
export const config={path:'/api/operations'};
