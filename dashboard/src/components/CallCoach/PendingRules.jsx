import { useState, useEffect, useCallback } from "react";
import { api, post, patch } from "../../api";

// ═══════════════════════════════════════════════════════════════════════════
// PendingRules — Phase 6 B2 (May 15, 2026)
//
// Inline rule approval queue. Renders pending coaching_rules for one
// conversation and lets the owner approve / reject / edit each. Hidden
// when no rules exist (returns null) so callers can always mount it.
// ═══════════════════════════════════════════════════════════════════════════

const CATEGORIES = [
  { key: "rapport",              label: "Rapport" },
  { key: "property_walkthrough", label: "Property Walkthrough" },
  { key: "discovery",            label: "Discovery" },
  { key: "education",            label: "Education" },
  { key: "value_framing",        label: "Value Framing" },
  { key: "objection_handling",   label: "Objection Handling" },
  { key: "close",                label: "Close" },
  { key: "professionalism",      label: "Professionalism" },
  { key: "tone",                 label: "Tone" },
  { key: "scripting",            label: "Scripting" },
  { key: "pricing",              label: "Pricing" },
  { key: "qualification",        label: "Qualification" },
  { key: "other",                label: "Other" },
];

const RULE_TYPES = [
  { key: "do",        label: "Do",        color: "bg-emerald-100 text-emerald-800" },
  { key: "dont",      label: "Don't",     color: "bg-rose-100 text-rose-800" },
  { key: "when_then", label: "When-Then", color: "bg-indigo-100 text-indigo-800" },
];

function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || key;
}

function RuleTypeBadge({ ruleType }) {
  const meta = RULE_TYPES.find((t) => t.key === ruleType);
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function CategoryBadge({ category }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
      {categoryLabel(category)}
    </span>
  );
}

export default function PendingRules({ conversationId, onChange }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionInFlight, setActionInFlight] = useState({});
  const [perRuleError, setPerRuleError] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await api(`/api/call-coach/conversations/${conversationId}/rules`);
      setRules(json.rules || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { load(); }, [load]);

  function setInFlight(ruleId, action) {
    setActionInFlight((prev) => ({ ...prev, [ruleId]: action }));
  }
  function clearInFlight(ruleId) {
    setActionInFlight((prev) => {
      const next = { ...prev };
      delete next[ruleId];
      return next;
    });
  }
  function setRuleError(ruleId, msg) {
    setPerRuleError((prev) => ({ ...prev, [ruleId]: msg }));
  }
  function clearRuleError(ruleId) {
    setPerRuleError((prev) => {
      const next = { ...prev };
      delete next[ruleId];
      return next;
    });
  }

  async function handleApprove(rule) {
    clearRuleError(rule.id);
    setInFlight(rule.id, "approving");
    try {
      await post(`/api/call-coach/rules/${rule.id}/approve`);
      await load();
      onChange?.();
    } catch (err) {
      setRuleError(rule.id, err.message);
    } finally {
      clearInFlight(rule.id);
    }
  }

  function startReject(rule) {
    setRejectingId(rule.id);
    setRejectReason("");
  }

  function cancelReject() {
    setRejectingId(null);
    setRejectReason("");
  }

  async function confirmReject(rule) {
    clearRuleError(rule.id);
    setInFlight(rule.id, "rejecting");
    try {
      await post(`/api/call-coach/rules/${rule.id}/reject`, {
        reason: rejectReason.trim() || null,
      });
      setRejectingId(null);
      setRejectReason("");
      await load();
      onChange?.();
    } catch (err) {
      setRuleError(rule.id, err.message);
    } finally {
      clearInFlight(rule.id);
    }
  }

  function startEdit(rule) {
    clearRuleError(rule.id);
    setEditingId(rule.id);
    setEditForm({
      rule_text: rule.rule_text || "",
      rationale: rule.rationale || "",
      category: rule.category,
      rule_type: rule.rule_type,
      example_quote: rule.example_quote || "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  async function saveEdit(rule) {
    clearRuleError(rule.id);
    if (!editForm.rule_text || editForm.rule_text.trim().length === 0) {
      setRuleError(rule.id, "Rule text cannot be empty");
      return;
    }
    setInFlight(rule.id, "saving");
    try {
      await patch(`/api/call-coach/rules/${rule.id}`, {
        rule_text: editForm.rule_text.trim(),
        rationale: editForm.rationale.trim(),
        category: editForm.category,
        rule_type: editForm.rule_type,
        example_quote: editForm.example_quote.trim() || null,
      });
      setEditingId(null);
      setEditForm({});
      await load();
    } catch (err) {
      setRuleError(rule.id, err.message);
    } finally {
      clearInFlight(rule.id);
    }
  }

  const pending = rules.filter((r) => r.status === "pending_approval");

  // Hide entirely if nothing to show
  if (loading) return null;
  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-md mb-6 text-sm">
        Failed to load rules: {error}
      </div>
    );
  }
  if (pending.length === 0) return null;

  return (
    <div className="bg-white border border-violet-200 rounded-lg mb-6 overflow-hidden">
      <div className="px-4 py-3 border-b border-violet-200 bg-violet-50 flex items-baseline justify-between">
        <div>
          <div className="text-sm font-semibold text-violet-900">Suggested Rules from This Call</div>
          <div className="text-xs text-violet-700 mt-0.5">
            Review each rule — approved rules apply to all future AI conversations.
          </div>
        </div>
        <div className="text-xs text-violet-700 font-medium">{pending.length} pending</div>
      </div>

      <div className="divide-y divide-gray-100">
        {pending.map((rule) => {
          const isEditing = editingId === rule.id;
          const isRejecting = rejectingId === rule.id;
          const inFlight = actionInFlight[rule.id];
          const ruleErr = perRuleError[rule.id];

          return (
            <div key={rule.id} className="px-4 py-4">
              {!isEditing && (
                <>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <CategoryBadge category={rule.category} />
                    <RuleTypeBadge ruleType={rule.rule_type} />
                  </div>
                  <p className="text-sm font-medium text-gray-900 mb-1">{rule.rule_text}</p>
                  {rule.rationale && (
                    <p className="text-sm text-gray-600 mb-2">
                      <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold mr-1.5">
                        Why
                      </span>
                      {rule.rationale}
                    </p>
                  )}
                  {rule.example_quote && (
                    <div className="mt-2 text-xs italic text-gray-600 bg-gray-50 border-l-2 border-gray-300 px-3 py-2 rounded-r">
                      "{rule.example_quote}"
                    </div>
                  )}
                </>
              )}

              {isEditing && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                        Category
                      </label>
                      <select
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                        disabled={!!inFlight}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                        Type
                      </label>
                      <select
                        value={editForm.rule_type}
                        onChange={(e) => setEditForm({ ...editForm, rule_type: e.target.value })}
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                        disabled={!!inFlight}
                      >
                        {RULE_TYPES.map((t) => (
                          <option key={t.key} value={t.key}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                      Rule
                    </label>
                    <textarea
                      value={editForm.rule_text}
                      onChange={(e) => setEditForm({ ...editForm, rule_text: e.target.value.slice(0, 1000) })}
                      rows={2}
                      className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                      disabled={!!inFlight}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                      Rationale
                    </label>
                    <textarea
                      value={editForm.rationale}
                      onChange={(e) => setEditForm({ ...editForm, rationale: e.target.value.slice(0, 1000) })}
                      rows={2}
                      className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                      disabled={!!inFlight}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                      Example quote (optional)
                    </label>
                    <input
                      type="text"
                      value={editForm.example_quote}
                      onChange={(e) => setEditForm({ ...editForm, example_quote: e.target.value.slice(0, 500) })}
                      className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                      disabled={!!inFlight}
                    />
                  </div>
                </div>
              )}

              {isRejecting && (
                <div className="mt-3">
                  <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                    Why are you rejecting this rule? (optional)
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value.slice(0, 500))}
                    rows={2}
                    placeholder="e.g. The AI was actually correct here — this is bad coaching."
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                    disabled={!!inFlight}
                  />
                </div>
              )}

              {ruleErr && (
                <div className="mt-2 bg-rose-50 border border-rose-200 text-rose-700 px-2 py-1.5 rounded text-xs">
                  {ruleErr}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                {!isEditing && !isRejecting && (
                  <>
                    <button
                      onClick={() => handleApprove(rule)}
                      disabled={!!inFlight}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors disabled:opacity-60"
                    >
                      {inFlight === "approving" ? "Approving…" : "Approve"}
                    </button>
                    <button
                      onClick={() => startEdit(rule)}
                      disabled={!!inFlight}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded transition-colors disabled:opacity-60"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => startReject(rule)}
                      disabled={!!inFlight}
                      className="px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 rounded transition-colors disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                )}

                {isEditing && (
                  <>
                    <button
                      onClick={() => saveEdit(rule)}
                      disabled={!!inFlight}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded transition-colors disabled:opacity-60"
                    >
                      {inFlight === "saving" ? "Saving…" : "Save Changes"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={!!inFlight}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded transition-colors disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </>
                )}

                {isRejecting && (
                  <>
                    <button
                      onClick={() => confirmReject(rule)}
                      disabled={!!inFlight}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors disabled:opacity-60"
                    >
                      {inFlight === "rejecting" ? "Rejecting…" : "Confirm Reject"}
                    </button>
                    <button
                      onClick={cancelReject}
                      disabled={!!inFlight}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded transition-colors disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
