// Zugriff auf die Datenbank mit Dienstrechten (nur innerhalb der Edge Function).
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// deno-lint-ignore no-explicit-any
export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
