import "server-only";
import { db } from "@/lib/supabase/admin";

/** Ejecuta fn solo si se obtiene el lock. Devuelve null si otro proceso lo tiene. */
export async function withJobLock<T>(name: string, seconds: number, fn: () => Promise<T>): Promise<T | null> {
  const { data, error } = await db().rpc("try_job_lock", { p_name: name, p_seconds: seconds });
  if (error) throw error;
  if (!data) return null;
  try {
    return await fn();
  } finally {
    await db().rpc("release_job_lock", { p_name: name });
  }
}
