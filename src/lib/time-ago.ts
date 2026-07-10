/** Compact relative age: "just now", "5m ago", "2h ago", "3d ago". */
export function timeAgo(v: number | string | null | undefined): string {
  if (v == null) return "";
  const t = typeof v === "number" ? v : new Date(v).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
