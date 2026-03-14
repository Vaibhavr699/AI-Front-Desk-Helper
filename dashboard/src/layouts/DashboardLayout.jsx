import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { getTenant, getUser } from "../api";
import { Header, Sidebar } from "../components";

const TENANT_STORAGE_KEY = "tenantId";
const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

export default function DashboardLayout() {
  const [tenants, setTenants] = useState([]);
  const user = getUser();
  const [tenantId, setTenantId] = useState(user?.tenant_id || "");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  );
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(
    () => localStorage.getItem("impersonate_tenant_id")
  );
  const impersonateName = localStorage.getItem("impersonate_tenant_name");

  useEffect(() => {
    // Override tenantId if impersonating
    if (impersonating) {
      setTenantId(impersonating);
    }
  }, [impersonating]);

  function stopImpersonating() {
    localStorage.removeItem("impersonate_tenant_id");
    localStorage.removeItem("impersonate_tenant_name");
    setImpersonating(null);
    setTenantId(user?.tenant_id || "");
    window.location.href = "/admin"; // Go back to admin
  }

  const [tenant, setTenant] = useState(null);
  const [isSuspended, setIsSuspended] = useState(false);

  useEffect(() => {
    if (tenantId) {
      getTenant(tenantId)
        .then((data) => {
          setTenants([data]);
          setTenant(data);
          setIsSuspended(data.is_suspended && !user?.is_super_admin && !impersonating);
        })
        .catch(() => setTenants([]));
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    }
  }, [tenantId]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  function toggleSidebar() {
    setSidebarCollapsed((c) => !c);
  }

  function openMobileSidebar() {
    setSidebarMobileOpen(true);
  }

  function closeMobileSidebar() {
    setSidebarMobileOpen(false);
  }

  return (
    <div className="h-screen bg-stone-100 flex flex-col overflow-hidden">
      {impersonating && (
        <div className="bg-amber-500 text-white px-6 py-2 flex items-center justify-between text-sm font-bold shadow-lg relative z-[60]">
          <div className="flex items-center gap-2">
            <span className="animate-pulse">⚠️</span>
            <span>Impersonating: <span className="font-black underline">{impersonateName}</span></span>
          </div>
          <button 
            onClick={stopImpersonating}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider transition-all"
          >
            End Session
          </button>
        </div>
      )}
      <Header
        tenantId={tenantId}
        tenants={tenants}
        onMenuClick={openMobileSidebar}
      />

      {isSuspended && (
        <div className="fixed inset-0 z-[100] bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">⚠️</span>
            </div>
            <h2 className="text-2xl font-black text-stone-900 mb-2">Account Suspended</h2>
            <p className="text-stone-500 mb-8">
              Your account has been suspended. Please update your billing information or contact support to restore service.
            </p>
            <div className="space-y-3">
              <a 
                href="/plans" 
                className="block w-full bg-stone-900 hover:bg-black text-white py-3 rounded-xl font-bold transition-all shadow-lg"
              >
                Go to Billing
              </a>
              <button 
                onClick={() => window.location.href = "/login"}
                className="block w-full text-stone-400 hover:text-stone-600 font-bold py-2 transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Desktop sidebar: fixed height, no scroll */}
        <div className="hidden lg:block h-full shrink-0">
          <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        </div>

        {/* Mobile sidebar overlay */}
        {sidebarMobileOpen && (
          <div
            className="lg:hidden fixed inset-0 z-40 bg-stone-900/20 backdrop-blur-sm"
            onClick={closeMobileSidebar}
            aria-hidden
          />
        )}
        <div
          className={`lg:hidden fixed inset-y-0 left-0 z-50 w-56 shadow-xl transform transition-transform duration-200 ease-out ${sidebarMobileOpen ? "translate-x-0" : "-translate-x-full"
            }`}
        >
          <Sidebar
            collapsed={false}
            onToggle={closeMobileSidebar}
            closeMobile={closeMobileSidebar}
          />
        </div>

        <main className="flex-1 min-w-0 min-h-0 overflow-auto flex flex-col">
          <div className="flex-1 max-w-full w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <Outlet context={{ tenantId: tenantId || null, tenants }} />
          </div>
        </main>
      </div>
    </div>
  );
}
