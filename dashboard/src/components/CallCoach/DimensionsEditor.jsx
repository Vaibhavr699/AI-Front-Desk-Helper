import { useEffect, useState } from "react";
import { get, patch } from "../../api";

export default function DimensionsEditor() {
  const [dims, setDims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await get("/api/call-coach/scorecard/dimensions");
        if (!cancelled) setDims(json.dimensions || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function update(i, field, value) {
    setSaved(false);
    setDims((prev) => prev.map((d, j) => (j === i ? { ...d, [field]: value } : d)));
  }

  function move(i, dir) {
    setSaved(false);
    setDims((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function remove(i) {
    setSaved(false);
    setDims((prev) => prev.filter((_, j) => j !== i));
  }

  function add() {
    setSaved(false);
    setDims((prev) => [...prev, { key: "", label: "", criteria: "" }]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = dims
        .map((d) => ({ label: (d.label || "").trim(), criteria: (d.criteria || "").trim() }))
        .filter((d) => d.label.length > 0);
      const json = await patch("/api/call-coach/scorecard/dimensions", {
        dimensions: payload,
      });
      setDims(json.dimensions || []);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-400 p-4">Loading scoring dimensions…</div>;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold text-gray-900">Scorecard dimensions</h3>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        The dimensions the AI scores every recorded conversation on. Tailor them
        to your trade. Changes apply to conversations scored after you save.
      </p>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>
      )}
      {saved && !error && (
        <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">
          Saved. New scores will use these dimensions.
        </div>
      )}

      <div className="space-y-3">
        {dims.map((d, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <input
                value={d.label}
                onChange={(e) => update(i, "label", e.target.value)}
                placeholder="Dimension name (e.g. Roof condition)"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1" title="Move up">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === dims.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1" title="Move down">↓</button>
              <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 px-1" title="Remove">✕</button>
            </div>
            <textarea
              value={d.criteria || ""}
              onChange={(e) => update(i, "criteria", e.target.value)}
              rows={2}
              placeholder="What good looks like — the AI scores against this. e.g. Inspected the full roof, documented damage, explained findings clearly."
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        ))}
      </div>

      <button
        onClick={add}
        disabled={dims.length >= 12}
        className="mt-3 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-40"
      >
        + Add dimension
      </button>
      {dims.length < 2 && (
        <p className="mt-2 text-xs text-amber-600">At least 2 dimensions are required.</p>
      )}
    </div>
  );
}
