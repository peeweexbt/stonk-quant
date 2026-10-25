import { clearSession, json } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = json({ ok: true });
  clearSession(res);
  return res;
}
