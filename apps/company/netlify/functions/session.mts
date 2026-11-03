import { getUser } from '@netlify/identity';
export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  if (req.method !== 'GET') return new Response(null, {status:405,headers:{...headers,Allow:'GET'}});
  const user = await getUser();
  if (!user) return Response.json({error:'Sign in required.'},{status:401,headers});
  if (!user.roles?.includes('admin')) return Response.json({error:'Company administrator access required.'},{status:403,headers});
  return Response.json({user:{id:user.id,email:user.email,name:user.name}},{headers});
};
export const config = {path:'/api/session'};
