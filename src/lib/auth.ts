import "server-only";
import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";
import { db } from "@/lib/supabase/admin";

export type Agent = { email: string; name: string | null; role: "admin" | "agent" };

/** Usuario autenticado y en allowlist, o null. */
export async function getAgent(): Promise<Agent | null> {
  const supabase = await sessionClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: row } = await db()
    .from("allowed_users")
    .select("email, name, role")
    .eq("email", email)
    .maybeSingle();
  return (row as Agent) ?? null;
}

/** Para páginas y server actions: redirige a /login si no hay agente. */
export async function requireAgent(): Promise<Agent> {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  return agent;
}

export async function requireAdmin(): Promise<Agent> {
  const agent = await requireAgent();
  if (agent.role !== "admin") throw new Error("Solo administradores");
  return agent;
}
