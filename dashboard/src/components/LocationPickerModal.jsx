import React, { useState, useEffect } from "react";

/**
 * LocationPickerModal
 *
 * Shown when a tenant connects a Google account that manages MORE THAN ONE
 * Business Profile location. Lets the owner pick which location AIFDH should
 * manage. On select, stores it and calls onDone().
 *
 * When the account has exactly one location, the backend auto-selects it and
 * this modal never appears.
 *
 * Props:
 *   tenantId   — current tenant UUID
 *   apiBase    — your API base URL (same one Reviews.jsx uses)
 *   authHeaders() — function returning the auth headers object (or pass headers directly)
 *   onDone(location) — called after a successful selection
 *   onCancel() — called if the user dismisses (optional)
 *
 * Wire it up wherever you handle the post-OAuth return. Pattern:
 *   1. After redirect back from Google, call GET /api/reviews/status
 *   2. If status.needs_location_selection === true, render <LocationPickerModal/>
 *   3. onDone → refresh status, show the connected dashboard
 */
export default function LocationPickerModal({
  tenantId,
  apiBase,
  authHeaders,
  onDone,
  onCancel,
}) {
  const [locations, setLocations] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [selecting, setSelecting] = useState(null); // location_id being saved

  const headers = () =>
    typeof authHeaders === "function" ? authHeaders() : (authHeaders || {});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/reviews/locations?tenant_id=${tenantId}`,
          { headers: headers() }
        );
        if (!res.ok) throw new Error(`Failed to load locations (${res.status})`);
        const data = await res.json();
        if (!cancelled) setLocations(data.locations || []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load your locations");
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, apiBase]);

  async function choose(loc) {
    setSelecting(loc.location_id);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/reviews/select-location?tenant_id=${tenantId}`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id:  loc.account_id,
          location_id: loc.location_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not select location");
      onDone && onDone(data.location);
    } catch (e) {
      setError(e.message || "Could not select that location");
      setSelecting(null);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(28,25,23,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, maxWidth: 520, width: "100%",
          maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #f0eeec" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1c1917" }}>
            Choose your business location
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#78716c" }}>
            Your Google account manages more than one Business Profile. Pick the
            one you want AI Front Desk Helper to manage.
          </p>
        </div>

        <div style={{ padding: 16, overflowY: "auto" }}>
          {error && (
            <div style={{
              background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca",
              borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          {locations === null && !error && (
            <div style={{ padding: 24, textAlign: "center", color: "#a8a29e", fontSize: 13 }}>
              Loading your locations…
            </div>
          )}

          {locations && locations.length === 0 && !error && (
            <div style={{ padding: 24, textAlign: "center", color: "#78716c", fontSize: 13 }}>
              No Business Profile locations were found on this Google account.
              Add a location in Google Business Profile, then reconnect.
            </div>
          )}

          {locations && locations.map((loc) => {
            const busy = selecting === loc.location_id;
            const disabled = selecting !== null;
            return (
              <button
                key={loc.location_id}
                onClick={() => choose(loc)}
                disabled={disabled}
                style={{
                  width: "100%", textAlign: "left", background: busy ? "#fff7ed" : "#fff",
                  border: "1px solid", borderColor: busy ? "#fed7aa" : "#e7e5e4",
                  borderRadius: 12, padding: "14px 16px", marginBottom: 10,
                  cursor: disabled ? "default" : "pointer",
                  opacity: disabled && !busy ? 0.5 : 1, transition: "all .15s",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1c1917" }}>
                  {loc.title}
                </div>
                {loc.address && (
                  <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>
                    {loc.address}
                  </div>
                )}
                {busy && (
                  <div style={{ fontSize: 12, color: "#ea580c", marginTop: 6, fontWeight: 600 }}>
                    Connecting…
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {onCancel && (
          <div style={{ padding: "12px 24px", borderTop: "1px solid #f0eeec", textAlign: "right" }}>
            <button
              onClick={onCancel}
              disabled={selecting !== null}
              style={{
                background: "none", border: "none", color: "#78716c",
                fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "6px 8px",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
