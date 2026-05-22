import { useEffect, useState } from "react";
import { AlertTriangle, ShieldAlert, Smartphone, Wifi, Eye } from "lucide-react";

import { get } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function SignalRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700">
      <Icon size={14} className="text-slate-400" />
      <span className="font-medium">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

export default function SharingRisks() {
  const [flagged, setFlagged] = useState([]);
  const [threshold, setThreshold] = useState(4);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await get("/api/team/sharing-risks", { threshold });
        if (!cancelled) {
          setFlagged(data.flagged || []);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [threshold]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <ShieldAlert size={28} className="text-amber-600" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Rep account sharing
          </h1>
          <p className="text-sm text-slate-500">
            Accounts whose recent device/IP/biometric pattern looks like the
            login may be shared. Review and contact the rep before taking
            action — false positives are common.
          </p>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-3 text-sm">
        <label className="text-slate-600">Score threshold:</label>
        <select
          value={threshold}
          onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
          className="rounded-md border border-slate-300 px-2 py-1"
        >
          <option value={2}>2 (loose)</option>
          <option value={4}>4 (default)</option>
          <option value={6}>6 (strict)</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LumaSpin />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : flagged.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center">
          <ShieldAlert size={32} className="mx-auto mb-3 text-emerald-600" />
          <p className="text-base font-semibold text-emerald-900">
            Nothing flagged
          </p>
          <p className="mt-1 text-sm text-emerald-700">
            No rep accounts are above the threshold right now.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {flagged.map((row) => (
            <div
              key={row.id}
              className="rounded-xl border border-amber-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-600" />
                    <span className="text-base font-semibold text-slate-900">
                      {row.email}
                    </span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      Score {row.score}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {row.seat_tier} seat · last app open {formatTime(row.last_app_open_at)}
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  Scored {formatTime(row.computed_at)}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
                <SignalRow
                  icon={Smartphone}
                  label="Devices (7d)"
                  value={row.signals.distinct_fingerprints_7d ?? 0}
                />
                <SignalRow
                  icon={Wifi}
                  label="IP networks (24h)"
                  value={row.signals.distinct_ip_blocks_24h ?? 0}
                />
                <SignalRow
                  icon={Eye}
                  label="Biometric types (7d)"
                  value={row.signals.distinct_biometric_types_7d ?? 0}
                />
              </div>

              {Array.isArray(row.signals.reasons) && row.signals.reasons.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {row.signals.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
