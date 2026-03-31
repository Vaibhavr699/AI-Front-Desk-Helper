import { useState, useRef, useEffect } from "react";

export default function LocationSwitcher({ tenantId, tenants, onTenantChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  if (!tenants || tenants.length <= 1) {
    const current = tenants?.[0] || {};
    return (
      <div className="flex items-center gap-2 min-w-0 max-w-[200px] sm:max-w-[280px]">
        <span className="hidden sm:inline text-xs font-semibold text-stone-400 uppercase tracking-wider shrink-0">Business</span>
        <span className="text-sm font-bold text-stone-900 truncate" title={current.name}>
          {current.name || "—"}
        </span>
      </div>
    );
  }

  const currentTenant = tenants.find((t) => t.id === tenantId);
  const isRollup = tenantId === "all";
  
  const parent = tenants.find(t => t.business_type === 'parent') || tenants[0];
  const children = tenants.filter(t => t.business_type === 'location');

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-stone-200 bg-stone-50 hover:bg-white hover:border-stone-300 hover:shadow-sm transition-all text-left min-w-[140px] max-w-[280px]"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-stone-400 uppercase tracking-tighter leading-none mb-0.5">
            {isRollup ? "Global View" : (currentTenant?.business_type === 'parent' ? "HQ / Parent" : "Location")}
          </div>
          <div className="text-sm font-bold text-stone-900 truncate">
            {isRollup ? "All Locations" : (currentTenant?.name || "Select...")}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-[2]  top-full mt-2 w-56 border-2 rounded-xl bg-white border border-stone-200 shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="space-y-1">
            {/* Roll-up Option */}
            <button
              onClick={() => {
                onTenantChange("all");
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isRollup ? "bg-stone-900 text-white shadow-lg shadow-stone-900/20" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <div className={`w-8 h-8 rounded-md flex items-center justify-center ${isRollup ? "bg-white/20" : "bg-stone-100"}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4M19 21l2-2" />
                </svg>
              </div>
              <div className="text-left">
                <div className="font-bold">All Locations</div>
                <div className={`text-[10px] ${isRollup ? "text-stone-300" : "text-stone-400"}`}>Aggregated reporting</div>
              </div>
            </button>

            <div className="h-px bg-stone-200 mx-2" />

            {/* Parent Location */}
            <button
              onClick={() => {
                onTenantChange(parent.id);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                tenantId === parent.id ? "bg-stone-900 text-white shadow-lg shadow-stone-900/20" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <div className={`w-8 h-8 rounded-md flex items-center justify-center ${tenantId === parent.id ? "bg-white/20" : "bg-stone-100"}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div className="text-left">
                <div className="font-bold">{parent.name}</div>
                <div className={`text-[10px] ${tenantId === parent.id ? "text-stone-300" : "text-stone-400"}`}>HQ / Parent account</div>
              </div>
            </button>

            {children.length > 0 && (
              <>
                <div className="px-3 py-2 text-[10px] font-black text-stone-400 uppercase tracking-widest">Child Locations</div>
                {children.map(child => (
                  <button
                    key={child.id}
                    onClick={() => {
                      onTenantChange(child.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      tenantId === child.id ? "bg-stone-900 text-white shadow-lg shadow-stone-900/20" : "text-stone-600 hover:bg-stone-100"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center ${tenantId === child.id ? "bg-white/20" : "bg-stone-100"}`}>
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <div className="font-bold">{child.name}</div>
                      <div className={`text-[10px] ${tenantId === child.id ? "text-stone-300" : "text-stone-400"}`}>Local branch</div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
          
          <div className="p-2 bg-stone-50 border-t border-stone-100">
             <button 
                onClick={() => {
                  setIsOpen(false);
                  window.location.href = "/add-location";
                }}
                className="w-full py-2 px-3 flex items-center justify-center gap-2 text-[11px] font-bold text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-all"
             >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add New Location
             </button>
          </div>
        </div>
      )}
    </div>
  );
}
