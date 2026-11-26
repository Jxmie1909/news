// Ausgehende Anfragen. In Tests kann alles über einen lokalen Stellvertreter geleitet werden.
// deno-lint-ignore no-explicit-any
const env = (k: string): string => (globalThis as any).Deno?.env?.get?.(k) ?? (globalThis as any).process?.env?.[k] ?? "";

export function getEnv(k: string): string {
  return env(k);
}

export async function xfetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = init;
  const proxy = env("NEWS_TEST_PROXY");
  const target = proxy ? `${proxy}?url=${encodeURIComponent(url)}` : url;
  return await fetch(target, { ...rest, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
}
