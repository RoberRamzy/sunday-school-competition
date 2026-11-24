import { cookies } from "next/headers";
import type { Language, Principal, Theme } from "./api";

export async function readLanguage(): Promise<Language> {
  return (await cookies()).get("sunday-school-language")?.value === "ar" ? "ar" : "en";
}

export async function initialState(): Promise<{ initialLanguage: Language; initialTheme: Theme; initialPrincipal: Principal | null }> {
  const cookieStore = await cookies();
  const session = cookieStore.get("sid");
  const origin = (process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");

  async function read<T>(path: string, cookie?: string): Promise<T | null> {
    try {
      const response = await fetch(`${origin}/api${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        headers: cookie ? { Cookie: cookie } : undefined,
      });
      return response.ok ? await response.json() as T : null;
    } catch {
      return null;
    }
  }

  const [appearance, principal, language] = await Promise.all([
    read<{ theme: Theme }>("/appearance"),
    session ? read<Principal>("/auth/me", `sid=${encodeURIComponent(session.value)}`) : null,
    readLanguage(),
  ]);
  return {
    initialTheme: appearance?.theme === "christmas" ? "christmas" : "classic",
    initialPrincipal: principal,
    initialLanguage: language,
  };
}
