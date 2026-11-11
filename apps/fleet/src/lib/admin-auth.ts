import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function requireCompanyAdmin(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) {
    return { user: null, response: NextResponse.json({ error: "Company administrator sign-in is required." }, { status: 401 }) };
  }
  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { user: null, response: NextResponse.json({ error: "Your session is invalid or expired." }, { status: 401 }) };
  const metadata = data.user.app_metadata || {};
  const roles: string[] = Array.isArray(metadata.roles) ? metadata.roles : [];
  const role = String(metadata.role || metadata.user_role || "").toLowerCase();
  const permitted = ["admin", "company_admin", "super_admin"].includes(role) || roles.some((r) => ["admin", "company_admin", "super_admin"].includes(String(r).toLowerCase())) || metadata.is_company_admin === true;
  if (!permitted) return { user: null, response: NextResponse.json({ error: "Company administrator permission is required." }, { status: 403 }) };
  return { user: data.user, response: null };
}
