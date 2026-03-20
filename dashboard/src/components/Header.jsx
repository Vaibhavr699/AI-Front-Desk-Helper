import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getUser, logout } from "../api";

/**
 * App header: logo, sidebar toggle (mobile), business selector, user menu.
 * Nav links live in the Sidebar.
 */
export default function Header({ tenantId, tenants, onMenuClick }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const user = getUser();
  const navigate = useNavigate();

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
              to="/"
              className="flex items-center gap-2 shrink-0 group transition-all"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-lg shadow-stone-200 group-hover:scale-105 transition-transform duration-200">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2L14.85 8.65L22 9.25L16.5 13.9L18.1 21L12 17.25L5.9 21L7.5 13.9L2 9.25L9.15 8.65L12 2Z" fill="currentColor" />
                  <path d="M12 6L13.5 10H10.5L12 6Z" fill="#fff" opacity="0.5" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-stone-900 leading-none">AI Front Desk</span>
                <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mt-0.5">Helper</span>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {tenantId && (
              <>
                <div className="hidden sm:block h-6 w-px bg-stone-200" aria-hidden />
                <div className="flex items-center gap-2 min-w-0 max-w-[200px] sm:max-w-[280px]">
                  <span className="hidden sm:inline text-sm text-stone-500 shrink-0">Business</span>
                  <span className="text-sm font-medium text-stone-900 truncate" title={currentBusinessName}>
                    {currentBusinessName || "—"}
                  </span>
                </div>
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
