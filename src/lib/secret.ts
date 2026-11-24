import "server-only";
import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Acepta `Authorization: Bearer <secret>` o `?token=<secret>` (útil para curl en cPanel). */
export function checkBearer(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const fromHeader = header.startsWith("Bearer ") ? header.slice(7) : "";
  const fromQuery = new URL(req.url).searchParams.get("token") ?? "";
  const token = fromHeader || fromQuery;
  return !!token && safeEqual(token, secret);
}
