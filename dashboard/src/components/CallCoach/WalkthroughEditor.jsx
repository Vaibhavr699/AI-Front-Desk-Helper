import { useEffect, useState } from "react";
import { get, patch } from "../../api";

export default function WalkthroughEditor() {
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await get("/api/call-coach/scorecard/walkthrough");
        if (!cancelled) setStages(json.walkthrough || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function updateLabel(i, label) {
    setStages((prev) => prev.map((s, j) => (j === i ? { ...s, label } : s)));
    setSaved(false);
  }

  function move(i, dir) {
    setStages((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSaved(false);
  }

  function remove(i) {
    setStages((prev) => prev.filter((_, j) => j !== i));
    setSaved(false);
  }

  function add() {
    setStages((prev) => [...prev, { key: "", label: "" }]);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = stages
        .map((s) => ({ label: (s.label || "").trim() }))
        .filter((s) => s.label.length > 0);
      const json = await patch("/api/call-coach/scorecard/walkthrough", {
        walkthrough: payload,
      });
      setStages(json.walkthrough || []);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-400 p-4">Loading walkthrough…</div>;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold text-gray-900">Visit walkthrough stages</h3>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        The stages your reps are coached to cover on each in-home visit. Customize
        these to your trade — they drive the live walkthrough checklist and what
        the AI watches for.
      </p>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
      {saved && !error && (
        <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">
          Saved. New sessions will use these stages.
        </div>
      )}

      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={s.label}
              onChange={(e) => updateLabel(i, e.target.value)}
              placeholder="Stage name (e.g. Roof inspection)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1" title="Move up">↑</button>
            <button onClick={() => move(i, 1)} disabled={i === stages.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1" title="Move down">↓</button>
            <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 px-1" title="Remove">✕</button>
          </div>
        ))}
      </div>

      <button
        onClick={add}
        disabled={stages.length >= 12}
        className="mt-3 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-40"
      >
        + Add stage
      </button>
    </div>
  );
}
