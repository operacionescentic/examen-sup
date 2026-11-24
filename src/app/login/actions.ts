"use server";

import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";

export async function login(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const supabase = await sessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Credenciales inválidas" };
  redirect("/");
}

export async function logout() {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
