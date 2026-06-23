import { useState, useEffect, useCallback } from "react";
import { getGbpBookingLink, setGbpBookingLink } from "../api";

/**
 * GbpBookingLinkSection (G6)
 *
 * Renders inside GoogleBusinessProfile.jsx as the "Booking Link" sub-tab.
 * Points the tenant's Google "Appointments" link at their own booking page
 * (book.<domain>) instead of a leaking CRM/provider URL.
 *
 * Conventions match the parent page: tenantId comes in as a prop, styling is
 * passed down via the `s` style object, and user feedback goes through the
 * parent's showToast. It calls the shared api.js helpers (which return the raw
 * service shapes; expected states like not_connected / api_not_enabled come
 * back as 200 with ok:false, so we branch on `reason` rather than catching).
 *
 *   GET  -> { ok, connected, currentUri, isProvider, isEditable, isOurs,
 *            ourBookingUrl, links:[...] }
 *   POST -> { ok, action:"created"|"updated", uri, providerStillPresent }
 *
 * After a successful POST we re-fetch GET (the POST shape lacks the full
 * status fields the view renders).
 */

// Strip protocol + trailing slash for clean display.
function pretty(u) {
  if (!u) return "";
  return String(u).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export default function GbpBookingLinkSection({ tenantId, s, showToast }) {
  const [data, setData] = useState(null);     // GET payload
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await getGbpBookingLink(tenantId);
      setData(res);
    } catch (e) {
      // Only thrown on 500 / network -- expected states are 200 ok:false.
      setData({ ok: false, reason: "server_error", message: e.message });
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  async function pointToOurs() {
    setSaving(true);
    try {
      const res = await setGbpBookingLink(tenantId); // no url -> backend resolves
      if (res?.ok) {
        showToast("Appointment link updated ✓");
        await load();
      } else {
        showToast(reasonMsg(res?.reason), "error");
      }
    } catch (e) {
      showToast(e.message || "Update failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked -- non-fatal */ }
  }

  // -- Loading --------------------------------------------------------------
  if (loading) {
    return <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading…</div>;
  }

  const intro = (
    <div style={{ ...s.card, padding: 20, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>Appointments link</div>
      <div style={{ fontSize: 12, color: "#888", lineHeight: 1.6 }}>
        When customers tap "Appointments" on your Google listing, this is where they go.
        Point it at your own booking page so high-intent clicks run through your booking flow
        instead of leaking to another site.
      </div>
    </div>
  );

  // -- Branch on payload ----------------------------------------------------
  let body;

  if (data?.ok === false && (data.reason === "not_connected" || data.connected === false)) {
    body = (
      <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>Connect Google first</div>
        <div style={{ fontSize: 12, color: "#888" }}>
          Connect your Google Business Profile (Health tab) to manage your appointment link.
        </div>
      </div>
    );
  } else if (data?.ok === false && (data.reason === "api_not_enabled" || data.reason === "permission_denied")) {
    body = <ManualFallback s={s} reason={data.reason} url={data.ourBookingUrl} copied={copied} onCopy={copyUrl} />;
  } else if (data?.ok === false) {
    body = (
      <div style={{ ...s.card, padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 14 }}>Couldn't read your appointment link right now.</div>
        <button onClick={load} style={s.btn("#888", "transparent")}>Try again</button>
      </div>
    );
  } else if (data?.isOurs) {
    // Good state -- already ours.
    body = (
      <div style={{ ...s.card, padding: 24 }}>
        <Pill tone="good" label="Pointing to your booking page" />
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", marginTop: 12 }}>{pretty(data.currentUri || data.ourBookingUrl)}</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
          Live on Google. Changes can take an hour or two to appear publicly.
        </div>
      </div>
    );
  } else if (data?.currentUri) {
    // Leaking -- connected, has a link, but not ours.
    const blocked = data.isEditable === false;
    body = (
      <div style={{ ...s.card, padding: 24 }}>
        <Pill tone="warn" label="Leaking to another site" />
        <div style={{ fontSize: 13, color: "#444", lineHeight: 1.6, marginTop: 12 }}>
          Clicks currently go to <strong style={{ color: "#1a1a1a" }}>{pretty(data.currentUri)}</strong>
          {data.isProvider ? " (set by a third-party provider)" : ""}, bypassing your booking flow.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 10 }}>
          <span style={{ color: "#888" }}>→ should point to</span>
          <strong style={{ color: "#1a1a1a" }}>{pretty(data.ourBookingUrl)}</strong>
        </div>
        {blocked ? (
          <div style={{ marginTop: 16 }}>
            <ManualFallback s={s} reason="provider_locked" url={data.ourBookingUrl} copied={copied} onCopy={copyUrl} embedded />
          </div>
        ) : (
          <button onClick={pointToOurs} disabled={saving} style={{ ...s.btn(), marginTop: 18, padding: "10px 20px", fontSize: 13 }}>
            {saving ? "Updating…" : "Point to my booking page"}
          </button>
        )}
      </div>
    );
  } else {
    // Connected, no appointment link at all.
    body = (
      <div style={{ ...s.card, padding: 24 }}>
        <Pill tone="neutral" label="No appointment link set" />
        <div style={{ fontSize: 13, color: "#444", lineHeight: 1.6, marginTop: 12 }}>
          Add an appointment link so customers can book straight from your Google listing.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 10 }}>
          <span style={{ color: "#888" }}>will point to</span>
          <strong style={{ color: "#1a1a1a" }}>{pretty(data?.ourBookingUrl)}</strong>
        </div>
        <button onClick={pointToOurs} disabled={saving} style={{ ...s.btn(), marginTop: 18, padding: "10px 20px", fontSize: 13 }}>
          {saving ? "Adding…" : "Add my booking link"}
        </button>
      </div>
    );
  }

  return <>{intro}{body}</>;
}

// -- Bits -------------------------------------------------------------------

function Pill({ tone, label }) {
  const map = {
    good:    { bg: "#f0fdf4", border: "#bbf7d0", color: "#16a34a", dot: "#16a34a" },
    warn:    { bg: "#fff7ed", border: "#fed7aa", color: "#E8600A", dot: "#E8600A" },
    neutral: { bg: "#fafaf9", border: "#e8e6e0", color: "#888",    dot: "#888" },
  }[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: map.bg, color: map.color, border: `1px solid ${map.border}`, textTransform: "uppercase", letterSpacing: "0.04em" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: map.dot }} />
      {label}
    </span>
  );
}

function ManualFallback({ s, reason, url, copied, onCopy, embedded }) {
  const intro =
    reason === "provider_locked"
      ? "This link was set by a third-party provider and can't be changed automatically. Update it in Google Business Profile:"
      : reason === "permission_denied"
      ? "We don't have permission to set this link automatically yet. Set it manually in Google Business Profile:"
      : "Automatic updates aren't available for this profile yet. Set the link manually in Google Business Profile:";

  const inner = (
    <>
      <div style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>{intro}</div>
      <ol style={{ margin: "12px 0", paddingLeft: 18, fontSize: 13, color: "#666", lineHeight: 1.9 }}>
        <li>Open your profile -> <strong>Edit profile -> Booking</strong>.</li>
        <li>Paste your booking page as the appointment link.</li>
        <li>Save, and remove any other appointment link still listed.</li>
      </ol>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#1a1a1a" }}>{url}</code>
        <button onClick={() => onCopy(url)} style={s.btn("#888", "transparent")}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </>
  );

  if (embedded) return inner;
  return <div style={{ ...s.card, padding: 24 }}>{inner}</div>;
}

function reasonMsg(reason) {
  switch (reason) {
    case "not_connected":     return "Your Google Business Profile isn't connected.";
    case "api_not_enabled":   return "Google hasn't enabled appointment-link updates for this profile yet.";
    case "permission_denied": return "We don't have permission to set this link automatically.";
    default:                  return "Couldn't update the booking link. Try again in a moment.";
  }
}
