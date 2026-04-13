import { useState, useEffect, useCallback } from "react";
import { get, getUser } from "../api";

const ACTION_BADGES = {
  user_login:       { label: "Login",            cls: "badge-login" },
  user_removed:     { label: "User removed",     cls: "badge-danger" },
  team_viewed:      { label: "Team viewed",      cls: "badge-team" },
  booking_updated:  { label: "Booking updated",  cls: "badge-booking" },
  lead_viewed:      { label: "Lead viewed",      cls: "badge-lead" },
  settings_updated: { label: "Settings changed", cls: "badge-settings" },
  password_reset:   { label: "Password reset",   cls: "badge-danger" },
  recording_played: { label: "Recording played", cls: "badge-lead" },
};

function initials(email = "") {
  if (!email) return "??";
  const parts = email.split("@")[0].split(/[._-]/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : email.slice(0, 2).toUpperCase();
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function HistoryTab({ tenantId }) {
  const user = getUser();
  const isHQ = user?.tenant_business_type === "parent";

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterFrom, setFilterFrom] = useState(monthAgo);
  const [filterTo, setFilterTo] = useState(today);
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 25 };
      if (filterUser)   params.user_id = filterUser;
      if (filterAction) params.action  = filterAction;
      if (filterFrom)   params.from    = filterFrom;
      if (filterTo)     params.to      = filterTo;

      const data = await get("/api/audit-logs", params);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      setError(err.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [page, filterUser, filterAction, filterFrom, filterTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  function handleFilterChange(setter) {
    return (e) => {
      setter(e.target.value);
      setPage(1);
    };
  }

  return (
    <div style={{ padding: "0 0 2rem" }}>

      {/* Filters */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "12px",
        marginBottom: "1.25rem",
      }}>
        <div>
          <label style={labelStyle}>Action type</label>
          <select style={inputStyle} value={filterAction} onChange={handleFilterChange(setFilterAction)}>
            <option value="">All actions</option>
            {Object.entries(ACTION_BADGES).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>From date</label>
          <input type="date" style={inputStyle} value={filterFrom} onChange={handleFilterChange(setFilterFrom)} />
        </div>
        <div>
          <label style={labelStyle}>To date</label>
          <input type="date" style={inputStyle} value={filterTo} onChange={handleFilterChange(setFilterTo)} />
        </div>
      </div>

      {/* Result count */}
      <div style={{ fontSize: 12, color: "#888", marginBottom: "0.75rem" }}>
        {loading ? "Loading…" : `${total} result${total !== 1 ? "s" : ""}`}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: "#fff1f1", border: "1px solid #fecaca",
          borderRadius: 8, padding: "10px 14px", fontSize: 13,
          color: "#b91c1c", marginBottom: "1rem"
        }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{
        background: "#fff", border: "0.5px solid rgba(0,0,0,0.08)",
        borderRadius: 12, overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Action", "User", isHQ ? "Location" : null, "Detail", "Time"].filter(Boolean).map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={isHQ ? 5 : 4} style={{ padding: "2rem", textAlign: "center", color: "#aaa", fontSize: 13 }}>
                  No activity matches your filters.
                </td>
              </tr>
            )}
            {logs.map((row) => {
              const badge = ACTION_BADGES[row.action] || { label: row.action, cls: "badge-settings" };
              return (
                <tr key={row.id} style={{ borderBottom: "0.5px solid rgba(0,0,0,0.06)" }}>
                  <td style={tdStyle}>
                    <span style={badgeStyles[badge.cls] || badgeStyles["badge-settings"]}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: "#e8f0fe", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 600, color: "#1a56db", flexShrink: 0,
                      }}>
                        {initials(row.user_email)}
                      </div>
                      <span style={{ fontSize: 13 }}>{row.user_email || "System"}</span>
                    </div>
                  </td>
                  {isHQ && (
                    <td style={{ ...tdStyle, fontSize: 12, color: "#888" }}>
                      {row.location_name || "—"}
                    </td>
                  )}
                  <td style={{ ...tdStyle, fontSize: 12, color: "#888", maxWidth: 220 }}>
                    {row.new_value
                      ? summarizeValue(row.new_value)
                      : row.entity_type
                        ? `${row.entity_type}${row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}`
                        : "—"}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "#aaa", whiteSpace: "nowrap" }}>
                    {formatTime(row.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "1rem" }}>
        <span style={{ fontSize: 12, color: "#aaa" }}>
          Page {page} of {pages}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={pageBtnStyle(page <= 1)}
          >
            ← Prev
          </button>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page >= pages}
            style={pageBtnStyle(page >= pages)}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

function summarizeValue(val) {
  if (!val || typeof val !== "object") return String(val || "—");
  const entries = Object.entries(val).slice(0, 2);
  return entries.map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(" · ") || "—";
}

const labelStyle = {
  display: "block",
  fontSize: 11,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
};

const inputStyle = {
  width: "100%",
  fontSize: 13,
  padding: "6px 10px",
  border: "0.5px solid rgba(0,0,0,0.15)",
  borderRadius: 8,
  background: "#fff",
  color: "#111",
  outline: "none",
};

const thStyle = {
  fontSize: 11,
  color: "#999",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 500,
  padding: "10px 14px",
  textAlign: "left",
  borderBottom: "0.5px solid rgba(0,0,0,0.08)",
  background: "#fafafa",
};

const tdStyle = {
  padding: "10px 14px",
  fontSize: 13,
  color: "#111",
  verticalAlign: "middle",
};

const pageBtnStyle = (disabled) => ({
  fontSize: 12,
  padding: "5px 12px",
  border: "0.5px solid rgba(0,0,0,0.15)",
  borderRadius: 8,
  background: disabled ? "#f5f5f5" : "#fff",
  color: disabled ? "#ccc" : "#333",
  cursor: disabled ? "default" : "pointer",
});

const badgeStyles = {
  "badge-login": {
    display: "inline-block", fontSize: 11, fontWeight: 500,
    padding: "2px 8px", borderRadius: 6,
    background: "#dbeafe", color: "#1e40af",
  },
  "badge-team": {
    display: "inline-block", fontSize: 11, fontWeight: 500,
    padding: "2px 8px", borderRadius: 6,
    background: "#dcfce7", color: "#166534",
  },
  "badge-booking": {
    display: "inline-block", fontSize: 11, fontWeight: 500,
    padding: "2px 8px", borderRadius: 6,
    background: "#fef9c3", color: "#854d0e",
  },
  "badge-lead": {
    display: "inline-block", fontSize: 11, fontWeight: 500,
    padding: "2px 8px", borderRadius: 6,
    background: "#ede9fe", color: "#5b21b6",
  },
  "badge-settings": {
    display: "inline-block", fontSize: 11, fontWeight: 500,
    padding: "2px 8px", borderRadius: 6,
    background: "#f3f4f6", color: "#374151",
  },
  "badge-danger": {
    display: "inline-block", fontSize: 11, fontWeight: 500,
    padding: "2px 8px", borderRadius: 6,
    background: "#fee2e2", color: "#991b1b",
  },
};
