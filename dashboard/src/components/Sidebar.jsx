import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getUser } from "../api";
import { useBrand } from "../contexts/BrandContext";

// ── Condensed nav — 10 items max ───────────────────────────────────────────
//
// REMOVED from top nav (pages still exist, accessible within parent pages):
//   • Outbound        → tab inside Calls page
//   • AI Conversations → tab inside Leads page
//   • Follow-ups      → tab inside Leads page
//   • Plans           → tab inside Settings page
//   • Usage & Billing → tab inside Settings page
//
// ADDED May 15, 2026 (Phase 6 A4): Call Coach — AI-scored conversation
// analytics. Sits between Metrics and Reviews. Visible to managers/owners/
// admins (anyone with baseNavItems); not staff, not reseller-account tenants.
//
const baseNavItems = [
  { to: "/dashboard",  label: "Home",       icon: HomeIcon       },
  { to: "/calls",      label: "Calls",      icon: CallsIcon      },
  { to: "/leads",      label: "Leads",      icon: LeadsIcon      },
  { to: "/bookings",   label: "Bookings",   icon: BookingsIcon   },
  { to: "/metrics",    label: "Metrics",    icon: MetricsIcon    },
  { to: "/call-coach", label: "AI Coaching", icon: CallCoachIcon  },
  { to: "/reviews",    label: "Reviews",    icon: ReviewsIcon    },
];

// ── Plan + parent-mode helpers (mirrors lib/plans.js canAddLocations) ─────
const HQ_PLAN_IDS = ["hq_starter", "hq_growth", "hq_enterprise"];
const MULTI_LOCATION_PLAN_IDS = ["pro", "elite", ...HQ_PLAN_IDS];

function canTenantAddLocations(activeTenant) {
  if (!activeTenant) return false;
  if (activeTenant.parent_mode === "rollup_only") return true;
  const planId = (activeTenant.plan || "basic").toLowerCase();
  return MULTI_LOCATION_PLAN_IDS.includes(planId);
}

// ── Role-based nav builder ─────────────────────────────────────────────────
function getNavItems(activeTenant) {
  const user = getUser();
  const isImpersonating = !!localStorage.getItem("impersonate_tenant_id");

  // 1. Global super admin (no tenant)
  if (user?.is_super_admin && !user.tenant_id && !isImpersonating) {
    return [
      { to: "/admin/tenants", label: "Tenants",        icon: BusinessesIcon },
      { to: "/admin/admins",  label: "Platform Admins", icon: AdminsIcon    },
    ];
  }

  const role = user?.role || "staff";

  // 2. Staff / Technician — bookings only
  if (role !== "admin" && role !== "owner" && role !== "manager") {
    return [{ to: "/bookings", label: "Bookings", icon: BookingsIcon }];
  }

  // 3. Manager — base items + Settings
  if (role === "manager") {
    return [
      ...baseNavItems,
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ];
  }

  // 4. Owner / Admin

  // 4a. Reseller tenant — dedicated nav
  if (activeTenant?.account_type === "reseller") {
    const items = [
      { to: "/reseller",       label: "Customers", icon: CustomersIcon },
      { to: "/reseller/plans", label: "Plans",     icon: PlansIcon     },
    ];
    if (user?.is_super_admin) {
      items.push({ to: "/admin/tenants", label: "Admin Console", icon: AdminIcon });
    }
    items.push({ to: "/settings", label: "Settings", icon: SettingsIcon });
    return items;
  }

  // 4b. Non-reseller owner/admin — standard operational nav
  const isHQ =
    user?.tenant_business_type === "parent" ||
    activeTenant?.business_type === "parent";

  const showLocations = canTenantAddLocations(activeTenant) || user?.is_super_admin;

  const items = [...baseNavItems];

  if (showLocations) {
    items.push({ to: "/locations", label: "Locations", icon: LocationsIcon });
  }

  // Team management — available to every operating owner/admin tenant, not
  // just HQ parents (Jun 18, 2026). Resellers never reach here (they return
  // early with their own nav above).
  items.push({ to: "/team",               label: "Team",          icon: TeamIcon });
  items.push({ to: "/team/sharing-risks", label: "Sharing Risks", icon: TeamIcon });

  // Businesses + Rollup stay HQ-only — they're multi-location aggregation,
  // not people management.
  if (isHQ) {
    items.push({ to: "/tenants",   label: "Businesses", icon: BusinessesIcon });
    items.push({ to: "/rollup-v5", label: "Rollup",     icon: RollupIcon     });
  }
  if (user?.is_super_admin) {
    items.push({ to: "/admin/tenants", label: "Admin Console", icon: AdminIcon });
  }

  items.push({ to: "/settings", label: "Settings", icon: SettingsIcon });

  return items;
}

// ── Icons ──────────────────────────────────────────────────────────────────
function HomeIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function CallsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function LeadsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function BookingsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function MetricsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

// ── Call Coach icon — graduation cap (coaching / training analytics) ──────
function CallCoachIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
    </svg>
  );
}

function ReviewsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}

function LocationsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21V9l4-3 4 3v12M3 21h8M3 21H1m10 0h2m0 0V11l5-3 5 3v10m-10 0h10m0 0h2M9 9h.01M7 13h.01M9 17h.01M19 13h.01M19 17h.01" />
    </svg>
  );
}

function TeamIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function BusinessesIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

function RollupIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  );
}

function AdminIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

function AdminsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function CustomersIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function PlansIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}

function SettingsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

// ── Sidebar component ──────────────────────────────────────────────────────
export default function Sidebar({ closeMobile, activeTenant }) {
  const [isHovered, setIsHovered] = useState(false);
  const location = useLocation();
  const { companyName, logoUrl, isDefault } = useBrand();

  function handleLinkClick() {
    if (closeMobile) closeMobile();
  }

  const isExpanded = isHovered;

  return (
    <aside
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`flex flex-col bg-white border-r border-stone-200 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] shrink-0 h-full overflow-hidden ${
        isExpanded ? "w-48" : "w-[4.5rem]"
      }`}
    >
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-x-hidden overflow-y-auto min-h-0">
        {getNavItems(activeTenant).map(({ to, label, icon: Icon }) => {
          const isActive =
            location.pathname === to ||
            location.pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              onClick={handleLinkClick}
              title={!isExpanded ? label : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                isActive
                  ? "bg-brand-50 text-brand-600 shadow-sm shadow-brand-100/50"
                  : "text-stone-500 hover:bg-stone-50 hover:text-stone-900"
              }`}
            >
              <Icon
                className={`w-5 h-5 shrink-0 transition-transform duration-200 ${
                  isActive ? "scale-110" : "group-hover:scale-110"
                }`}
              />
              <span
                className={`whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left ${
                  isExpanded
                    ? "opacity-100 translate-x-0 ml-1"
                    : "opacity-0 -translate-x-4 pointer-events-none w-0"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 px-3 py-3 border-t border-stone-100">
        <div
          className="flex items-center gap-3 px-2 py-1.5"
          title={!isExpanded ? companyName : undefined}
        >
          <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-stone-100 flex items-center justify-center ring-1 ring-stone-200">
            {logoUrl ? (
              <img src={logoUrl} alt={companyName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-black text-xs tracking-tight">
                FD
              </div>
            )}
          </div>
          <div
            className={`flex flex-col min-w-0 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left ${
              isExpanded
                ? "opacity-100 translate-x-0"
                : "opacity-0 -translate-x-4 pointer-events-none w-0"
            }`}
          >
            <span className="text-xs font-black text-stone-900 truncate leading-tight">
              {companyName}
            </span>
            {isDefault && (
              <span className="text-[9px] font-bold text-stone-400 uppercase tracking-widest leading-tight mt-0.5">
                Helper
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
