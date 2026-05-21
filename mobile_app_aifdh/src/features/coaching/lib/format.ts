export function formatDimensionLabel(raw: string): string {
  return raw
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function scoreToColor(score: number): { bg: string; bar: string; text: string } {
  if (score >= 8) {
    return { bg: "bg-emerald-50", bar: "bg-emerald-500", text: "text-emerald-700" };
  }
  if (score >= 6) {
    return { bg: "bg-brand-50", bar: "bg-brand-500", text: "text-brand-700" };
  }
  if (score >= 4) {
    return { bg: "bg-amber-50", bar: "bg-amber-500", text: "text-amber-700" };
  }
  return { bg: "bg-red-50", bar: "bg-red-500", text: "text-red-700" };
}
