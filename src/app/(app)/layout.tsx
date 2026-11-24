import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const agent = await requireAgent();
  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <Link href="/" className="font-semibold">
            📨 Helpdesk Exámenes
          </Link>
          <nav className="flex gap-4 text-sm text-slate-600">
            <Link href="/" className="hover:text-slate-900">Bandeja</Link>
            <Link href="/ajustes" className="hover:text-slate-900">Ajustes</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>{agent.name ?? agent.email}</span>
            <form action={logout}>
              <button className="btn">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
