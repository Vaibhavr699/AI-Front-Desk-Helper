import { useState, useEffect, useMemo } from "react";
import { getScopeOptions, updateScopeOptions } from "../api";

/**
 * ScopeSettings.jsx
 *
 * Owner-facing "Standard Scope" settings tab. Phase V2 (May 5, 2026).
 *
 * Backed by routes/scopeOptions.js. Owner toggles what's included by default
 * in each service's estimator price + customer-facing "What's included" strip.
 * Customer never sees these toggles — they only see the resulting price + strip.
 *
 * May 5, 2026 fix: switched from raw `fetch("/api/...")` (which hit the
 * dashboard host and got back the SPA fallback HTML) to the api.js helpers
 * which prefix VITE_API_URL + handle Bearer auth + impersonation headers.
 *
 * May 5, 2026 v2: Killed the sticky bottom save bar + Save Changes button.
 * Switched to auto-save on toggle flip — same pattern as the per-service rate
 * overrides elsewhere in Settings. One save mechanism across the whole page,
 * zero "did my change save?" confusion.
 *
 *   - Toggle flips immediately (optimistic UI)
 *   - Tiny spinner appears next to the toggle while save is in-flight
 *   - Brief green ✓ on success (fades after ~1.5s)
 *   - On failure the toggle reverts and an inline red message appears under
 *     the row until the next successful save of that option
 *
 * May 8, 2026: Updated owner preview to match the new customer-facing layout.
 *   - buildIncludesPreview() now returns structured { included, excluded }
 *     matching the backend's buildIncludesText structured payload (mig 058
 *     overlay in routes/estimator.js)
 *   - ServiceCard renders two visually distinct boxes — green ✅ for what's
 *     included, amber ❌ for what is NOT included with a friendly walkthrough
 *     note. Mirrors what customers see in the chat widget result screen so
 *     owners aren't guessing.
 *
 * Wave 1 — May 11, 2026: Roofing support.
 *   - SERVICE_LABELS extended with the 5 roofing service slugs (Mig 062).
 *   - Header optionally renders the vertical name when the API includes it,
 *     so a roofing tenant sees "Standard Scope · Roofing" and a painting
 *     tenant sees "Standard Scope · Painting" (or just "Standard Scope" if
 *     the field is absent — defensive fallback).
 *   - The rest of the component is automatically vertical-aware because
 *     routes/scopeOptions.js filters by tenant.vertical_id; whatever
 *     services come back render via SERVICE_LABELS (or the title-case
 *     fallback for unknown slugs).
 *
 * Design choices:
 *   - Live preview shows exactly what the customer sees in the chat widget,
 *     so the owner never has to guess.
 *   - Modifier info is shown next to each toggle so the owner sees the price
 *     impact before flipping.
 *   - Services with zero toggles are hidden. Painting's deck_fence falls in
 *     this bucket (intentionally skipped in mig 058 until split into
 *     separate deck + fence services).
 *   - Each save sends a single-row change. If the owner spam-flips, the
 *     backend handles last-write-wins; we don't try to debounce here.
 */

// Pretty service names. Keys are vertical_services.service_slug values.
// Unknown slugs fall through to formatServiceName() for graceful title-case.
const SERVICE_LABELS = {
  // ─── Painting (Mig 047) ─────────────────────────────────────────────────
  interior:             "Interior Painting",
  exterior:             "Exterior Painting",
  cabinets:             "Cabinet Painting",
  deck_fence:           "Deck & Fence Painting",

  // ─── Roofing (Mig 062, Wave 1 — May 11, 2026) ───────────────────────────
  asphalt_shingle:      "Asphalt Shingle Roofing",
  metal_standing_seam:  "Metal Standing Seam Roofing",
  tile:                 "Tile Roofing",
  slate:                "Slate Roofing",
  flat_epdm:            "Flat / EPDM Roofing",
};

// Pretty vertical names for the header subtitle. Optional — gracefully
// degrades if the API doesn't return a vertical block.
const VERTICAL_LABELS = {
  painting: "Painting",
  roofing:  "Roofing",
};

// Fallback for unknown slugs — title-case the snake_case.
function formatServiceName(slug) {
  if (SERVICE_LABELS[slug]) return SERVICE_LABELS[slug];
  return slug
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Pretty vertical name with snake_case → title-case fallback.
function formatVerticalName(slugOrName) {
  if (!slugOrName) return null;
  if (VERTICAL_LABELS[slugOrName]) return VERTICAL_LABELS[slugOrName];
  return String(slugOrName)
    .split(/[_\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Strip "Include " prefix from a display label and lowercase, so we can
// build a natural "walls, trim, and ceilings" list.
function stripIncludePrefix(label) {
  return label.replace(/^Include\s+/i, "").toLowerCase();
}

// Format a list of items as "a, b, and c" / "a and b" / "a".
function formatList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.slice(-1)[0]}`;
}

// Format the modifier info string ("+12% to price", "+$75 per door", etc).
function formatModifier(option) {
  const { modifier_type, price_modifier } = option;
  if (price_modifier == null) return "";
  switch (modifier_type) {
    case "percent":  return `+${price_modifier}% to price`;
    case "flat":     return `+$${price_modifier} to total`;
    case "per_unit": return `+$${price_modifier} per item`;
    case "per_lf":   return `+$${price_modifier} per linear foot`;
    case "per_sq":   return `+$${price_modifier} per square`;
    default:         return "";
  }
}

// Build the customer-facing "What's included" preview as structured data.
// Returns { included: string|null, excluded: string|null }.
//
// May 8, 2026: Switched from prose string to structured object so the
// owner-side preview can render the same two-box layout the customer sees
// in the chat widget. Mirrors backend buildIncludesText() in routes/estimator.js.
function buildIncludesPreview(service) {
  const visible  = service.options.filter(o => o.affects_includes_text);
  const enabled  = visible.filter(o =>  o.enabled).map(o => stripIncludePrefix(o.display_label));
  const disabled = visible.filter(o => !o.enabled).map(o => stripIncludePrefix(o.display_label));

  return {
    included: enabled.length  > 0 ? formatList(enabled)  : null,
    excluded: disabled.length > 0 ? formatList(disabled) : null,
  };
}

// ─── Tiny spinner shown while a save is in-flight ───────────────────────────
function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-gray-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// ─── Tiny green check shown briefly on a successful save ────────────────────
function SavedCheck() {
  return (
    <svg
      className="h-4 w-4 text-green-600"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

// ─── Toggle switch (small, animated, brand-coloured) ────────────────────────
function Toggle({ enabled, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${
        enabled ? "bg-orange-600" : "bg-gray-300"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ─── Single service card ─────────────────────────────────────────────────────
function ServiceCard({ service, saveState, onToggle }) {
  // Skip services with no toggles (e.g. painting deck_fence — intentionally
  // skipped in mig 058 until split into separate deck + fence services).
  if (!service.options || service.options.length === 0) return null;

  const preview = useMemo(() => buildIncludesPreview(service), [service]);
  const hasAnyPreview = preview.included || preview.excluded;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          {formatServiceName(service.service_slug)}
        </h3>
        <span className="text-xs font-mono text-gray-400 bg-gray-50 px-2 py-1 rounded">
          {service.service_slug}
        </span>
      </div>

      <div className="space-y-3 mb-5">
        {service.options.map(option => {
          const key    = `${service.service_id}-${option.option_key}`;
          const status = saveState[key]; // { status: "saving" | "saved" | "error", error? }

          return (
            <div
              key={option.option_key}
              className="py-2 border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="text-sm font-medium text-gray-900">
                    {option.display_label}
                  </div>
                  {formatModifier(option) && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatModifier(option)}
                      {option.default_enabled && (
                        <span className="ml-2 text-gray-400">· default ON</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {status?.status === "saving" && <Spinner />}
                  {status?.status === "saved"  && <SavedCheck />}
                  <Toggle
                    enabled={option.enabled}
                    onChange={() => onToggle(service.service_id, option.option_key, option.enabled)}
                  />
                </div>
              </div>
              {status?.status === "error" && (
                <div className="text-xs text-red-600 mt-1.5">
                  Couldn't save — {status.error || "unknown error"}. Click the toggle to try again.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Live preview of the customer-facing "What's included" strip.
          Mirrors the two-box layout the customer sees in the chat widget. */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-600 mb-3">
          Customer will see:
        </div>

        {!hasAnyPreview ? (
          <div className="text-sm text-gray-600 italic">Standard scope.</div>
        ) : (
          <div className="space-y-2">
            {preview.included && (
              <div className="bg-green-50 border-2 border-green-400 rounded-lg p-3">
                <div className="text-xs font-bold text-green-800 mb-1 flex items-center gap-1.5">
                  <span>✅</span>
                  <span>Included in this estimate:</span>
                </div>
                <div className="text-sm font-semibold text-green-900">
                  {preview.included}
                </div>
              </div>
            )}
            {preview.excluded && (
              <div className="bg-orange-50 border-2 border-orange-400 rounded-lg p-3">
                <div className="text-xs font-bold text-orange-800 mb-1 flex items-center gap-1.5">
                  <span>❌</span>
                  <span>Does NOT include:</span>
                </div>
                <div className="text-sm font-semibold text-orange-900 mb-1">
                  {preview.excluded}
                </div>
                <div className="text-xs text-orange-700 italic">
                  These can be added during the in-person walkthrough if needed.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function ScopeSettings() {
  const [services, setServices]   = useState([]);
  const [vertical, setVertical]   = useState(null); // Wave 1: optional, may be null
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Per-toggle save status, keyed by `${service_id}-${option_key}`.
  // Values: { status: "saving" | "saved" | "error", error?: string }
  const [saveState, setSaveState] = useState({});

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const data = await getScopeOptions();
        if (cancelled) return;
        setServices(data?.services || []);
        // Wave 1: capture vertical info if the backend returns it. The header
        // gracefully omits the subtitle if the API doesn't include this field
        // (older routes/scopeOptions.js versions). No-op if absent.
        setVertical(data?.vertical || null);
      } catch (err) {
        if (!cancelled) setLoadError(`Couldn't load: ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-save on toggle flip.
  // Optimistic update first, then PATCH. On failure, revert + show inline error.
  async function handleToggle(serviceId, optionKey, currentEnabled) {
    const newEnabled = !currentEnabled;
    const key = `${serviceId}-${optionKey}`;

    // 1. Optimistic UI update — flip the toggle right away.
    setServices(prev => prev.map(s => {
      if (s.service_id !== serviceId) return s;
      return {
        ...s,
        options: s.options.map(o =>
          o.option_key === optionKey ? { ...o, enabled: newEnabled } : o
        ),
      };
    }));

    // 2. Mark this key as saving (clears any prior error/saved indicator).
    setSaveState(prev => ({ ...prev, [key]: { status: "saving" } }));

    try {
      // 3. Fire the save — single-row change.
      await updateScopeOptions([
        { service_id: serviceId, option_key: optionKey, enabled: newEnabled },
      ]);

      // 4. Success → flash green check, then quietly clear after ~1.5s.
      //    Guard the timeout: if a newer save kicked off for the same key
      //    in the meantime, leave its state alone.
      setSaveState(prev => ({ ...prev, [key]: { status: "saved" } }));
      setTimeout(() => {
        setSaveState(prev => {
          if (prev[key]?.status !== "saved") return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 1500);
    } catch (err) {
      // 5. Failure → revert the optimistic toggle + show inline error
      //    until the user clicks again and a save succeeds.
      setServices(prev => prev.map(s => {
        if (s.service_id !== serviceId) return s;
        return {
          ...s,
          options: s.options.map(o =>
            o.option_key === optionKey ? { ...o, enabled: currentEnabled } : o
          ),
        };
      }));
      setSaveState(prev => ({
        ...prev,
        [key]: { status: "error", error: err.message },
      }));
    }
  }

  const visibleServices = services.filter(s => s.options && s.options.length > 0);

  // Wave 1: resolve a friendly vertical name for the header subtitle.
  // Tries vertical.slug first, then vertical.name, falls back to null.
  const verticalSubtitle = useMemo(() => {
    if (!vertical) return null;
    return formatVerticalName(vertical.slug) || formatVerticalName(vertical.name) || null;
  }, [vertical]);

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-gray-500 text-sm">Loading scope options…</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Standard Scope
          {verticalSubtitle && (
            <span className="text-base font-normal text-gray-500 ml-2">
              · {verticalSubtitle}
            </span>
          )}
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Configure what's included by default in your estimates. Customers see one price plus a clear
          "what's included" strip — no toggles, no decision fatigue. You can always upsell additional
          scope on the in-person walkthrough.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Changes save automatically as you toggle.
        </p>
      </div>

      {/* Load-failure banner */}
      {loadError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
          {loadError}
        </div>
      )}

      {/* Empty state */}
      {visibleServices.length === 0 && !loadError && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-gray-700 font-medium mb-1">No services configured yet</div>
          <div className="text-sm text-gray-500">
            Set up your vertical and services in Settings → Estimator first.
          </div>
        </div>
      )}

      {/* Service cards */}
      {visibleServices.length > 0 && (
        <div className="space-y-4">
          {visibleServices.map(service => (
            <ServiceCard
              key={service.service_id}
              service={service}
              saveState={saveState}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
