import "server-only";
import { db } from "@/lib/supabase/admin";

export type Settings = {
  sla_business_days: number;
  sla_auto_send: boolean;
  sla_skip_angry: boolean;
  /** "YYYY-MM-DD": el SLA solo actúa sobre tickets que vencen desde esta fecha. */
  sla_start_date: string;
  signature: string;
  response_guidelines: string;
};

const DEFAULTS: Settings = {
  sla_business_days: 10,
  sla_auto_send: true,
  sla_skip_angry: true,
  sla_start_date: "2026-11-25",
  signature: "Cordialmente,\nÁrea de Exámenes",
  response_guidelines: "",
};

export async function getSettings(): Promise<Settings> {
  const { data, error } = await db().from("settings").select("key, value");
  if (error) throw error;
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const row of data ?? []) out[row.key] = row.value;
  return out as Settings;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const { error } = await db().from("settings").upsert({ key, value });
  if (error) throw error;
}
