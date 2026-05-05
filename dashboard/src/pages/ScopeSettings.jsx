import { useState, useEffect, useMemo } from "react";

/**
 * ScopeSettings.jsx
 *
 * Owner-facing "Standard Scope" settings tab. Phase V2 (May 5, 2026).
 *
 * Backed by routes/scopeOptions.js. Owner toggles what's included by default
 * in each service's estimator price + customer-facing "What's included" strip.
 * Customer never sees these toggles — they only see the resulting price + strip.
 *
 * Design choices:
 *   - One "Save Changes" button at the bottom batches all toggles in one request
 *     so we don't hit the API on every flip. Keeps per-toggle UX feeling
 *     instant + reduces network chatter.
 *   - Live preview shows BOTH the prose strip ("Includes: walls, trim, ceilings.")
 *     and a structured list (✓/○) so the owner can scan either way.
 *   - Modifier info is shown next to each toggle so the owner sees the price
 *     impact before flipping.
 *   - Services with zero toggles are hidden — currently just deck_fence which
 *     is intentionally skipped in mig 058.
 *
 * Drop-in usage in your existing Settings.jsx:
 *
 *   import ScopeSettings from "./ScopeSettings";
 *   ...
 *   {activeTab === "scope" && <ScopeSettings />}
 *
 * Style: Tailwind. Light theme to match dashboard. Orange accent matches
 * brand (#E8702A → text-orange-600 / bg-orange-600).
 */

// Pretty service names. Keys are vertical_services.service_slug values.
const SERVICE_LABELS = {
  interior:   "Interior Painting",
  exterior:   "Exterior Painting",
  cabinets:   "Cabinet Painting",
  deck_fence: "Deck & Fence Painting",
  // V2 verticals will land here as they ship:
  // replacement: "Roof Replacement", repair: "Roof Repair",
  // new_install: "New Fence Install", staining: "Fence Staining", ...
};

// Fallback for unknown slugs — title-case the snake_case.
function formatServiceName(slug) {
  if (SERVICE_LABELS[slug]) return SERVICE_LABELS[slug];
  return slug
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Strip "Include " prefix from a display label and lowercase, so we can
// build a natural "Includes: walls, trim, and ceilings" sentence.
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

// Build the customer-facing "What's included" prose preview from the
// currently-enabled toggles.
function buildIncludesPreview(service) {
  const visible = service.options.filter(o => o.affects_includes_text);
  const enabled  = visible.filter(o => o.enabled).map(o => stripIncludePrefix(o.display_label));
  const disabled = visible.filter(o => !o.enabled).map(o => stripIncludePrefix(o.display_label));

  const parts = [];
  if (enabled.length > 0) {
    parts.push(`Includes: ${formatList(enabled)}.`);
  }
  if (disabled.length > 0) {
    const list = formatList(disabled);
    parts.push(`${list.charAt(0).toUpperCase()}${list.slice(1)} quoted separately on walkthrough.`);
  }
  return parts.length > 0 ? parts.join(" ") : "Standard scope.";
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
function ServiceCard({ service, onToggle }) {
  // Skip services with no toggles (e.g. deck_fence — intentionally skipped
  // in mig 058 until split into separate deck + fence services).
  if (!service.options || service.options.length === 0) return null;

  const includesPreview = useMemo(() => buildIncludesPreview(service), [service]);

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
        {service.options.map(option => (
          <div
            key={option.option_key}
            className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0"
          >
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
            <Toggle
              enabled={option.enabled}
              onChange={() => onToggle(service.service_id, option.option_key, option.enabled)}
            />
          </div>
        ))}
      </div>

      {/* Live preview of the customer-facing "What's included" strip */}
      <div className="bg-orange-50 border border-orange-100 rounded-lg p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-orange-700 mb-2">
          Customer will see:
        </div>
        <div className="text-sm text-gray-800 leading-relaxed">
          {includesPreview}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function ScopeSettings() {
  const [services, setServices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [pending, setPending]   = useState({}); // { "serviceId-optionKey": enabled }
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(null);

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/scope-options", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setServices(data.services || []);
      } catch (err) {
        if (!cancelled) setError(`Couldn't load: ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Toggle handler — updates local state immediately + queues the change.
  function handleToggle(serviceId, optionKey, currentEnabled) {
    const newEnabled = !currentEnabled;
    const key = `${serviceId}-${optionKey}`;

    // Optimistic UI update
    setServices(prev => prev.map(s => {
      if (s.service_id !== serviceId) return s;
      return {
        ...s,
        options: s.options.map(o =>
          o.option_key === optionKey ? { ...o, enabled: newEnabled } : o
        ),
      };
    }));

    // Queue or unqueue the change. If they flip back to original, remove it.
    setPending(prev => {
      const next = { ...prev };
      // Find the original value to detect "flipped back to original"
      const service = services.find(s => s.service_id === serviceId);
      const option  = service?.options.find(o => o.option_key === optionKey);
      const originalValue = option?.enabled; // pre-flip value
      // If flipping back to what was originally fetched, drop from pending.
      // Otherwise queue it.
      if (originalValue === newEnabled) {
        delete next[key];
      } else {
        next[key] = newEnabled;
      }
      return next;
    });

    // Clear any prior success/error state on new edit
    setSuccess(null);
    setError(null);
  }

  // Save batches all pending changes in one request.
  async function handleSave() {
    if (saving || Object.keys(pending).length === 0) return;
    try {
      setSaving(true);
      setError(null);

      const changes = Object.entries(pending).map(([key, enabled]) => {
        // key format: "<serviceId>-<optionKey>" — but optionKey may contain
        // dashes itself (e.g. include_trim — actually we use underscores, but
        // be defensive). Split on FIRST dash only.
        const dashIdx = key.indexOf("-");
        const service_id = parseInt(key.slice(0, dashIdx), 10);
        const option_key = key.slice(dashIdx + 1);
        return { service_id, option_key, enabled };
      });

      const res = await fetch("/api/scope-options", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setPending({});
      setSuccess(`Saved ${data.updated} change${data.updated === 1 ? "" : "s"}.`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`Couldn't save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const pendingCount = Object.keys(pending).length;
  const visibleServices = services.filter(s => s.options && s.options.length > 0);

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-gray-500 text-sm">Loading scope options…</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-24">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Standard Scope</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Configure what's included by default in your estimates. Customers see one price plus a clear
          "what's included" strip — no toggles, no decision fatigue. You can always upsell additional
          scope on the in-person walkthrough.
        </p>
      </div>

      {/* Error banner (load failures) */}
      {error && !saving && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Empty state */}
      {visibleServices.length === 0 && !error && (
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
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {/* Sticky save bar */}
      {visibleServices.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
            <div className="flex-1 text-sm">
              {pendingCount > 0 && (
                <span className="text-gray-700">
                  {pendingCount} unsaved change{pendingCount === 1 ? "" : "s"}
                </span>
              )}
              {success && (
                <span className="text-green-700 font-medium">✓ {success}</span>
              )}
              {error && saving === false && pendingCount > 0 && (
                <span className="text-red-700">⚠ {error}</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || pendingCount === 0}
              className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium px-6 py-2 rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
