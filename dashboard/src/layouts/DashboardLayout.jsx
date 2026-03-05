import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { getTenants } from "../api";
import { Header, Sidebar } from "../components";

const TENANT_STORAGE_KEY = "tenantId";
const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

export default function DashboardLayout() {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState(
    () => localStorage.getItem(TENANT_STORAGE_KEY) || ""
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  );
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  useEffect(() => {
    getTenants()
      .then((data) => setTenants(data.tenants || []))
      .catch(() => setTenants([]));
  }, []);

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
    <div className="min-h-screen bg-stone-100 flex flex-col">
      <Header
        tenantId={tenantId}
        tenants={tenants}
        onTenantChange={setTenantId}
        onMenuClick={openMobileSidebar}
      />

      <div className="flex-1 flex min-h-0">
        {/* Desktop sidebar */}
        <div className="hidden lg:block">
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
          className={`lg:hidden fixed inset-y-0 left-0 z-50 w-56 shadow-xl transform transition-transform duration-200 ease-out ${
            sidebarMobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            collapsed={false}
            onToggle={closeMobileSidebar}
            closeMobile={closeMobileSidebar}
          />
        </div>

        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <Outlet context={{ tenantId: tenantId || null }} />
          </div>
        </main>
      </div>
    </div>
  );
}
