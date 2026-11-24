import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/** Cliente con service_role. Solo servidor. Bypass de RLS. */
export function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
