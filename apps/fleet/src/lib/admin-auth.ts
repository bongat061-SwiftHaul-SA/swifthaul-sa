import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function requireCompanyAdmin(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !anonKey || !serviceKey) {
    return { user: null, response: NextResponse.json({ error: "Company administrator sign-in is required or server auth is not configured." }, { status: 401 }) };
  }
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { user: null, response: NextResponse.json({ error: "Your session is invalid or expired." }, { status: 401 }) };
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await adminClient.from("user_profiles").select("role,account_status").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile) return { user: null, response: NextResponse.json({ error: "Your SwiftHaul account profile could not be verified." }, { status: 403 }) };
  if (profile.account_status !== "active" || profile.role !== "admin") {
    return { user: null, response: NextResponse.json({ error: "Only active Company Admin accounts may change tariffs." }, { status: 403 }) };
  }
  return { user: data.user, response: null };
}
