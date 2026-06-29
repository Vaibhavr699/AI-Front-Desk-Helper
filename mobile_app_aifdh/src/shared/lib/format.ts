export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const [hStr, mStr] = value.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h)) return value;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, "0");
  return `${h12}:${mm} ${period}`;
}

export function formatCurrencyRange(
  lowCents: number | null,
  highCents: number | null,
): string | null {
  if (lowCents == null || highCents == null) return null;
  return `$${formatDollarsShort(lowCents)} – $${formatDollarsShort(highCents)}`;
}

function formatDollarsShort(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return k % 1 === 0 ? `${k.toFixed(0)}k` : `${k.toFixed(1)}k`;
  }
  return dollars.toFixed(0);
}

export function formatProjectType(value: string | null | undefined): string {
  if (!value) return "Project";
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
