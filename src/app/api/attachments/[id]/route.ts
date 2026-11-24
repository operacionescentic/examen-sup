import { NextResponse } from "next/server";
import { getAgent } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Redirige a una URL firmada (5 min) del adjunto. Solo agentes. */
export async function GET(_req: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const agent = await getAgent();
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { data: att } = await db().from("attachments").select("storage_path, filename").eq("id", Number(id)).maybeSingle();
  if (!att?.storage_path) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data, error } = await db()
    .storage.from("attachments")
    .createSignedUrl(att.storage_path, 300, { download: att.filename });
  if (error || !data) return NextResponse.json({ error: error?.message }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
