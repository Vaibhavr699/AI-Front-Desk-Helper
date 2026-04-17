/**
 * Brand shade generator
 *
 * Converts a single hex color into an 11-step Tailwind-compatible scale
 * (50 → 950) by interpolating HSL lightness. Designed to feed CSS variables
 * consumed by the brand-* Tailwind color scale.
 *
 * Returns RGB triplets as "R G B" strings (space-separated) because that's
 * what Tailwind's <alpha-value> placeholder requires. Do NOT change to
 * comma-separated or opacity modifiers silently break across the entire app.
 */

// ── Hex ↔ HSL conversion ──────────────────────────────────────────────────

/**
 * Normalize any hex input ("#abc", "abc", "#aabbcc", "aabbcc", with/without #)
 * to a clean 6-char lowercase hex string, or null if invalid.
 */
function normalizeHex(input) {
  if (typeof input !== "string") return null;
  let h = input.trim().toLowerCase().replace(/^#/, "");
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join(""); // "abc" → "aabbcc"
  }
  if (h.length !== 6) return null;
  return h;
}

/** "ea751a" → { r: 234, g: 117, b: 26 } */
function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** { r, g, b } 0-255 → { h: 0-360, s: 0-1, l: 0-1 } */
function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l }; // achromatic
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
    case gn: h = ((bn - rn) / d + 2); break;
    default: h = ((rn - gn) / d + 4); break;
  }
  return { h: h * 60, s, l };
}

/** { h: 0-360, s: 0-1, l: 0-1 } → { r, g, b } 0-255 (rounded) */
function hslToRgb({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = hue / 360;

  const hueToRgb = (t) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  return {
    r: Math.round(hueToRgb(hk + 1 / 3) * 255),
    g: Math.round(hueToRgb(hk) * 255),
    b: Math.round(hueToRgb(hk - 1 / 3) * 255),
  };
}

// ── Shade generation ──────────────────────────────────────────────────────

/**
 * Target lightness values for each shade (0-1 scale).
 *
 * Calibrated against Tailwind's default color palettes (orange, blue, green,
 * etc.) to match the perceived contrast jumps of the stock scales.
 *
 * Shade 600 is clamped to a [0.35, 0.55] range (see BRAND_600_LIGHTNESS_*
 * constants) regardless of input lightness. This keeps the active-state
 * color visible for both very dark (#03222a) and very light brand inputs.
 */
const TARGET_LIGHTNESS = {
  50:  0.97,
  100: 0.93,
  200: 0.85,
  300: 0.74,
  400: 0.61,
  500: 0.52,
  // 600 is computed dynamically — see clampBrand600Lightness()
  700: 0.38,
  800: 0.30,
  900: 0.24,
  950: 0.15,
};

// Saturation attenuation: the lightest and darkest shades look more natural
// with slightly reduced saturation (prevents neon 50s and washed-out 950s).
const SATURATION_MULTIPLIER = {
  50:  0.45,
  100: 0.65,
  200: 0.80,
  300: 0.90,
  400: 0.95,
  500: 1.00,
  600: 1.00,
  700: 1.00,
  800: 0.95,
  900: 0.90,
  950: 0.75,
};

// Shade 600 (primary interactive color) must stay within this range so
// that active nav states, buttons, and links are always visibly colored
// and have sufficient contrast against backgrounds.
//
// 0.35 lower bound → a #03222a input (lightness 0.09) becomes a visibly
//   colored dark teal at brand-600 instead of near-black.
// 0.55 upper bound → a very pale brand input still produces a visibly
//   saturated brand-600 that's darker than its brand-400 sibling.
const BRAND_600_LIGHTNESS_MIN = 0.35;
const BRAND_600_LIGHTNESS_MAX = 0.55;

// Pale shades (50-200) floor saturation at a minimum so they register as
// "tinted" rather than off-white, even when the input color is very dark
// and has lost most of its effective saturation at high lightness.
const PALE_SHADE_MIN_SATURATION = {
  50:  0.25,
  100: 0.40,
  200: 0.55,
};

const DEFAULT_SCALE = {
  50:  "254 247 238",
  100: "253 237 214",
  200: "249 215 172",
  300: "244 186 119",
  400: "238 146 64",
  500: "234 117 26",
  600: "219 90 16",
  700: "181 67 16",
  800: "144 54 21",
  900: "116 47 20",
  950: "63 21 8",
};

/** Clamp input lightness into the [0.35, 0.55] band for shade 600. */
function clampBrand600Lightness(inputL) {
  if (inputL < BRAND_600_LIGHTNESS_MIN) return BRAND_600_LIGHTNESS_MIN;
  if (inputL > BRAND_600_LIGHTNESS_MAX) return BRAND_600_LIGHTNESS_MAX;
  return inputL;
}

/**
 * Compute effective saturation for a given shade.
 * Applies the standard multiplier, then floors to the pale-shade minimum
 * (if applicable) so 50/100/200 are always visibly tinted.
 */
function effectiveSaturation(shade, inputSat) {
  const multiplied = Math.min(1, inputSat * SATURATION_MULTIPLIER[shade]);
  const floor = PALE_SHADE_MIN_SATURATION[shade];
  if (floor !== undefined) {
    return Math.max(multiplied, floor);
  }
  return multiplied;
}

/**
 * Generate an 11-shade brand scale from a single hex color.
 *
 * @param {string} hex - Hex color (with or without #, 3 or 6 chars)
 * @returns {Object} Map of shade number → "R G B" string
 *
 * Returns the AI Front Desk Helper default scale if input is invalid/null,
 * so callers don't need to null-check.
 */
export function generateBrandScale(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return DEFAULT_SCALE;

  const hsl = rgbToHsl(rgb);
  const scale = {};

  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

  for (const shade of shades) {
    const targetL = shade === 600
      ? clampBrand600Lightness(hsl.l)
      : TARGET_LIGHTNESS[shade];
    const targetS = effectiveSaturation(shade, hsl.s);
    const shadeRgb = hslToRgb({
      h: hsl.h,
      s: targetS,
      l: targetL,
    });
    scale[shade] = `${shadeRgb.r} ${shadeRgb.g} ${shadeRgb.b}`;
  }

  return scale;
}

/**
 * Apply a generated scale to the document root as CSS variables.
 * Pass null/undefined to reset to AI Front Desk Helper defaults.
 *
 * Safe to call from useEffect — only touches the 11 --brand-* variables.
 */
export function applyBrandScale(scale) {
  if (typeof document === "undefined") return; // SSR guard (defensive)
  const root = document.documentElement;
  const target = scale || DEFAULT_SCALE;
  Object.entries(target).forEach(([shade, value]) => {
    root.style.setProperty(`--brand-${shade}`, value);
  });
}

/**
 * Reset brand CSS variables to AI Front Desk Helper defaults.
 * Used on logout or when a tenant has no brand_color set.
 */
export function resetBrandScale() {
  applyBrandScale(DEFAULT_SCALE);
}

export { DEFAULT_SCALE };
