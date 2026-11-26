// Kursalarm: plötzliche Bewegungen bei beobachteten Aktien erkennen (Yahoo Finance, inoffiziell, ohne Gewähr).
import { xfetch } from "./http.ts";

export interface PriceDue {
  ticker: string;
  topic_id: string;
  name: string;
  priority: number;
  price: number | null;
  prev_close: number | null;
  last_alert_at: string | null;
  last_alert_price: number | null;
  day_alert_dir: number | null;
  day_alert_date: string | null;
}

export interface PriceCheck {
  ticker: string;
  ok: boolean;
  error?: string;
  price?: number;
  prev_close?: number | null;
  currency?: string;
  alert?: {
    kind: "move" | "day";
    movePct: number;
    dayPct: number | null;
    windowMin: number;
    dir: number;
    date: string;
  };
}

// deno-lint-ignore no-explicit-any
export function evaluateChart(json: any, due: PriceDue, pct: number, windowMin: number, nowMs = Date.now()): PriceCheck {
  const r = json?.chart?.result?.[0];
  if (!r) return { ticker: due.ticker, ok: false, error: json?.chart?.error?.description ?? "keine Daten" };
  const ts: number[] = r.timestamp ?? [];
  const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
  const series: { t: number; c: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c) && c > 0) series.push({ t: ts[i] * 1000, c });
  }
  const meta = r.meta ?? {};
  const prev = typeof meta.previousClose === "number" ? meta.previousClose : typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null;
  const currency = meta.currency ?? "";
  if (series.length === 0) {
    return { ticker: due.ticker, ok: true, price: typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : undefined, prev_close: prev, currency };
  }
  const last = series[series.length - 1];
  const out: PriceCheck = { ticker: due.ticker, ok: true, price: last.c, prev_close: prev, currency };
  // Nur wenn gerade gehandelt wird
  if (nowMs - last.t > 4 * 60_000) return out;
  const target = last.t - windowMin * 60_000;
  let ref: { t: number; c: number } | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].t <= target) {
      ref = series[i];
      break;
    }
  }
  if (!ref) ref = series[0].t < last.t - 2 * 60_000 ? series[0] : null;
  const date = new Date(last.t).toISOString().slice(0, 10);
  const dayPct = prev ? (last.c / prev - 1) * 100 : null;
  if (ref && last.t - ref.t <= (windowMin + 6) * 60_000) {
    const movePct = (last.c / ref.c - 1) * 100;
    if (Math.abs(movePct) >= pct) {
      const lastAt = due.last_alert_at ? Date.parse(due.last_alert_at) : 0;
      const sinceAlert = due.last_alert_price ? Math.abs(last.c / due.last_alert_price - 1) * 100 : Infinity;
      if (nowMs - lastAt > 20 * 60_000 || sinceAlert >= pct) {
        out.alert = { kind: "move", movePct, dayPct, windowMin: Math.max(1, Math.round((last.t - ref.t) / 60_000)), dir: Math.sign(movePct), date };
        return out;
      }
    }
  }
  if (dayPct != null && Math.abs(dayPct) >= pct * 2) {
    const dir = Math.sign(dayPct);
    // Kurz nach einem Alarm zur schnellen Bewegung nicht noch die Tagesbewegung hinterherschicken
    const recentMove = due.last_alert_at ? nowMs - Date.parse(due.last_alert_at) < 45 * 60_000 : false;
    if (!recentMove && !(due.day_alert_date === date && due.day_alert_dir === dir)) {
      out.alert = { kind: "day", movePct: dayPct, dayPct, windowMin: 0, dir, date };
    }
  }
  return out;
}

export async function fetchChart(ticker: string): Promise<unknown> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`;
  const r = await xfetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsReader/1.0)", "Accept": "application/json" }, timeoutMs: 7000 });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(`HTTP ${r.status}`);
  }
  return await r.json();
}

export function pctText(n: number): string {
  const v = Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (n < 0 ? "−" : "+") + v + " %";
}

export function priceText(n: number, currency: string): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (currency ? " " + currency : "");
}
