import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getUser, logout } from "../api";
import LocationSwitcher from "./LocationSwitcher";
import NotificationBell from "./NotificationBell";
import { useBrand } from "../contexts/BrandContext";

/**
 * App header: logo, sidebar toggle (mobile), business selector, user menu.
 * Nav links live in the Sidebar.
 *
 * Branding: left-side logo + company name come from useBrand() (tenant's
 * logo_url and company_name, with AI Front Desk Helper defaults as fallback).
 * Right-side avatar continues to use its existing prop-derived logic for
 * the account switcher — unchanged from before.
 */
export default function Header({ tenantId, tenants, onTenantChange, onMenuClick }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const user = getUser();
  const navigate = useNavigate();
  const { companyName, logoUrl, isDefault } = useBrand();

  useEffect(() => {
    function handleClickOutside(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  function handleLogout() {
    setUserMenuOpen(false);
    logout();
    navigate("/");
  }

  const initial = user?.email ? user.email.charAt(0).toUpperCase() : "?";
  const currentTenant = tenantId && tenants?.length ? tenants.find((t) => t.id === tenantId) : null;
  const currentBusinessName = currentTenant ? (currentTenant.company_name || currentTenant.name) : null;
  const currentBusinessLogo = currentTenant?.logo_url || null;

  return (
    <header className="bg-white border-b border-stone-200 sticky top-0 z-30 shadow-sm">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          <div className="flex items-center gap-2">
            {onMenuClick && (
              <button
                type="button"
                onClick={onMenuClick}
                className="lg:hidden p-2 -ml-2 rounded-lg text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-colors"
                aria-label="Open menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <Link
              to={user?.role === 'staff' ? "/bookings" : "/dashboard"}
              className="flex items-center gap-2 shrink-0 group transition-all"
            >
              {/* ── Brand logo ────────────────────────────────────────────
                  - Tenant with logo_url set → their logo
                  - Default branding → AI Front Desk Helper favicon
                  ──────────────────────────────────────────────────────── */}
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-white border border-stone-200 shadow-lg group-hover:scale-105 transition-transform duration-200 overflow-hidden p-1">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={companyName}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <img
                    src="/favicon.png"
                    alt="AI Front Desk Helper"
                    className="w-full h-full object-contain"
                  />
                )}
              </div>
              {/* ── Brand text ────────────────────────────────────────────
                  - Default branding → "AI Front Desk" + "HELPER" subtext
                    (preserves existing two-line layout for our own brand)
                  - White-labeled tenant → single-line company name, no
                    subtext (tenants don't want "HELPER" under their name)
                  ──────────────────────────────────────────────────────── */}
              <div className="flex flex-col">
                {isDefault ? (
                  <>
                    <span className="text-sm font-bold text-stone-900 leading-none">AI Front Desk</span>
                    <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mt-0.5">Helper</span>
                  </>
                ) : (
                  <span className="text-sm font-bold text-stone-900 leading-none truncate max-w-[180px]" title={companyName}>
                    {companyName}
                  </span>
                )}
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {tenantId && (
              <>
                <NotificationBell tenantId={tenantId} />
                <div className="hidden sm:block h-6 w-px bg-stone-200" aria-hidden />
                <LocationSwitcher 
                  tenantId={tenantId}
                  tenants={tenants}
                  onTenantChange={onTenantChange}
                />
              </>
            )}
            <div className="hidden sm:block h-6 w-px bg-stone-200" aria-hidden />
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-stone-200 text-stone-700 text-sm font-medium shrink-0 overflow-hidden hover:bg-stone-300 hover:ring-2 hover:ring-stone-300/50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
                aria-label="Account menu"
              >
                {currentBusinessLogo ? (
                  <img
                    src={currentBusinessLogo}
                    alt={currentBusinessName || "Business logo"}
                    className="w-full h-full object-cover border border-stone-200 rounded-full"
                  />
                ) : (
                  initial
                )}
              </button>
              {userMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-white border border-stone-200 shadow-xl z-10 overflow-hidden"
                  role="menu"
                >
                  <div className="px-4 py-4 bg-stone-50/80 border-b border-stone-100">
                    <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">Signed in as</p>
                    <p className="text-sm font-medium text-stone-900 mt-1 break-all">{user?.email}</p>
                  </div>
                  <div className="py-1 bg-white border-b border-stone-100">
                    
                      href="https://api.aifrontdeskhelper.com/api-docs"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100 transition-colors"
                      role="menuitem"
                    >
                      API Documentation
                    </a>
                  </div>
                  <div className="py-1 bg-stone-50/80">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100 transition-colors"
                      role="menuitem"
                    >
                      Log out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
