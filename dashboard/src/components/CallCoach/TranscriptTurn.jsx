import { useState } from "react";

const FLAG_META = {
  good: {
    label: "Good",
    badge: "bg-emerald-100 text-emerald-800",
    border: "border-l-emerald-400",
    dot: "bg-emerald-500",
  },
  improve: {
    label: "Needs work",
    badge: "bg-amber-100 text-amber-800",
    border: "border-l-amber-400",
    dot: "bg-amber-500",
  },
};

const SPEAKER_COLOR = {
  rep: "text-brand-600",
  customer: "text-emerald-600",
};

export default function TranscriptTurn({
  entry,
  turnIndex,
  timestamp,
  comments,
  canComment,
  onAdd,
  onDelete,
}) {
  const [composing, setComposing] = useState(false);
  const [flag, setFlag] = useState("good");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onAdd(turnIndex, flag, text.trim() || null);
      setComposing(false);
      setText("");
      setFlag("good");
    } catch (err) {
      setError(err.message || "Couldn't save comment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="group px-4 py-2.5">
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className={`text-[10px] font-bold uppercase ${
            SPEAKER_COLOR[entry.speaker] || "text-gray-400"
          }`}
        >
          {entry.speaker}
        </span>
        <span className="text-[10px] text-gray-300 font-mono">{timestamp}</span>
        {canComment && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="ml-auto text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 hover:text-brand-600 transition"
          >
            + Comment
          </button>
        )}
      </div>

      <p className="text-sm text-gray-800">{entry.text}</p>

      {comments.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {comments.map((c) => {
            const meta = FLAG_META[c.flag] || FLAG_META.improve;
            return (
              <div
                key={c.id}
                className={`flex items-start gap-2 border-l-2 ${meta.border} bg-gray-50 rounded-r px-2.5 py-1.5`}
              >
                <span
                  className={`mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${meta.badge}`}
                >
                  {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  {c.text && (
                    <p className="text-xs text-gray-700">{c.text}</p>
                  )}
                  <p className="text-[10px] text-gray-400">
                    {c.manager_email || "Manager"}
                  </p>
                </div>
                {canComment && (
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    className="text-[10px] text-gray-300 hover:text-red-500"
                    aria-label="Delete comment"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {composing && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm">
          <div className="flex gap-1.5 mb-2">
            {["good", "improve"].map((f) => {
              const meta = FLAG_META[f];
              const active = flag === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFlag(f)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    active ? meta.badge : "bg-gray-100 text-gray-500"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </button>
              );
            })}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Add a note for the rep (optional)…"
            className="w-full resize-none rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-brand-400 focus:outline-none"
          />
          {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setText("");
                setError(null);
              }}
              className="rounded px-2.5 py-1 text-[11px] text-gray-500 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="rounded bg-brand-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
