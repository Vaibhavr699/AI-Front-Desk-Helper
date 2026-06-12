import { useEffect, useState } from "react";
import { get, patch } from "../../api";

const CUES = [
  { key: "ask_discovery", label: "Ask Discovery" },
  { key: "listen", label: "Listen" },
  { key: "disc_reframe", label: "DISC Reframe" },
  { key: "missing_close", label: "Missing Close" },
  { key: "address_objection", label: "Address Objection" },
  { key: "slow_down", label: "Slow Down" },
  { key: "build_rapport", label: "Build Rapport" },
  { key: "confirm_next_step", label: "Confirm Next Step" },
];

export default function CueEmphasisEditor() {
  const [priority, setPriority] = useState([]);
  const [guidance, setGuidance] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await get("/api/call-coach/scorecard/cue-emphasis");
        if (!cancelled) {
          setPriority(json.cue_emphasis?.priority_cues || []);
          setGuidance(json.cue_emphasis?.guidance || "");
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function toggle(key) {
    setSaved(false);
    setPriority((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const json = await patch("/api/call-coach/scorecard/cue-emphasis", {
        cue_emphasis: { priority_cues: priority, guidance },
      });
      setPriority(json.cue_emphasis?.priority_cues || []);
      setGuidance(json.cue_emphasis?.guidance || "");
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-400 p-4">Loading cue emphasis…</div>;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold text-gray-900">Live cue emphasis</h3>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Tell the live coach which cues matter most to your team and add any
        coaching focus in your own words. This shapes the real-time cues your
        reps get during visits.
      </p>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>
      )}
      {saved && !error && (
        <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">
          Saved. New sessions will use this emphasis.
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {CUES.map((c) => {
          const on = priority.includes(c.key);
          return (
            <button
              key={c.key}
              onClick={() => toggle(c.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                on
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <label className="block text-xs font-semibold text-gray-700 mb-1">
        Coaching focus (optional)
      </label>
      <textarea
        value={guidance}
        onChange={(e) => { setGuidance(e.target.value); setSaved(false); }}
        rows={3}
        maxLength={600}
        placeholder="e.g. Our reps rush the close — push them to slow down and confirm next steps before leaving."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    </div>
  );
}
