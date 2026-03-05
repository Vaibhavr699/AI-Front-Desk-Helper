/**
 * Dropdown to select the current tenant (business).
 */
export default function TenantSelector({ tenantId, tenants, onChange }) {
  return (
    <label className="flex items-center gap-2 min-w-0">
      <span className="hidden sm:inline text-sm text-stone-500 shrink-0">
        Business
      </span>
      <select
        value={tenantId}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm border border-stone-300 rounded-md px-2.5 py-1.5 bg-white text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent max-w-[140px] sm:max-w-[200px]"
        aria-label="Select business"
      >
        <option value="">Select…</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.company_name || t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
