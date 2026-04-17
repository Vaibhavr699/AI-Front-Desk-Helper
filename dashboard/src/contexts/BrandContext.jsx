import { createContext, useContext, useEffect, useMemo } from "react";
import { generateBrandScale, applyBrandScale, resetBrandScale, DEFAULT_SCALE } from "../utils/brandShades";

/**
 * BrandContext — per-tenant branding for white-labeled dashboards.
 * 
 * Data source: the active tenant object (already fetched by DashboardLayout).
 * We deliberately do NOT fetch anything here — the tenant row contains all
 * brand fields, so context just derives from what's already in memory.
 * 
 * Side effects (via useEffect):
 *   - Writes --brand-* CSS variables on <html> for the Tailwind brand-* scale
 *   - Writes document.title
 *   - Writes favicon href
 * 
 * Fallbacks: Any field missing on the tenant falls back to AI Front Desk
 * Helper defaults. Callers using useBrand() never have to null-check.
 */

// ── Defaults (AI Front Desk Helper brand) ─────────────────────────────────

const DEFAULT_BRAND = {
  companyName: "AI Front Desk Helper",
  logoUrl: null,                // null → consumers render fallback mark
  brandColor: "#ea751a",        // matches --brand-500 default
  accentColor: null,            // null → consumers derive from brand
  faviconUrl: "/favicon.ico",   // existing favicon in public/
  supportEmail: "support@aifrontdeskhelper.com",
  customDomain: null,           // Phase 2 stub
  isDefault: true,              // true when rendering AI Front Desk Helper branding
};

// ── Context ───────────────────────────────────────────────────────────────

const BrandContext = createContext(DEFAULT_BRAND);

/**
 * Hook for consuming brand data.
 * Always returns a fully-populated object — never null, never undefined.
 * 
 * Usage:
 *   const { companyName, logoUrl, brandColor } = useBrand();
 */
export function useBrand() {
  return useContext(BrandContext);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract brand fields from a tenant row with defaults.
 * Accepts null (logged out / no tenant loaded yet) and returns defaults.
 */
function deriveBrand(tenant) {
  if (!tenant || tenant.id === "all") {
    // "all" is the HQ rollup pseudo-tenant — use default AI Front Desk
    // Helper branding since there's no single tenant brand to show.
    return DEFAULT_BRAND;
  }

  // A tenant counts as "default branded" only if they've set NOTHING custom.
  // Once they set even one field, isDefault = false so downstream components
  // know to treat this as a white-labeled experience.
  const hasCustomBrand = Boolean(
    tenant.brand_color ||
    tenant.logo_url ||
    tenant.company_name ||
    tenant.accent_color ||
    tenant.favicon_url
  );

  return {
    companyName: tenant.company_name || tenant.name || DEFAULT_BRAND.companyName,
    logoUrl: tenant.logo_url || null,
    brandColor: tenant.brand_color || DEFAULT_BRAND.brandColor,
    accentColor: tenant.accent_color || null,
    faviconUrl: tenant.favicon_url || DEFAULT_BRAND.faviconUrl,
    supportEmail: tenant.support_email || DEFAULT_BRAND.supportEmail,
    customDomain: tenant.custom_domain || null,
    isDefault: !hasCustomBrand,
  };
}

// ── Side effect: update the browser favicon link ──────────────────────────

function setFavicon(href) {
  if (typeof document === "undefined") return;
  // Find any existing favicon link(s). There can be several (apple-touch, etc.)
  // — we only update the primary <link rel="icon"> and leave others alone.
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (link.href !== href) {
    link.href = href;
  }
}

// ── Provider ──────────────────────────────────────────────────────────────

/**
 * Wraps the authenticated dashboard. Must be mounted inside the tree that
 * owns the active tenant (typically DashboardLayout, below tenant fetch).
 * 
 * Props:
 *   - tenant: the active tenant object, or null if none loaded yet
 *   - children: the subtree that will consume useBrand()
 */
export function BrandProvider({ tenant, children }) {
  // Memoize the brand object so consumers that use referential equality
  // (e.g. useEffect deps) don't re-run on every parent render.
  const brand = useMemo(() => deriveBrand(tenant), [tenant]);

  // Apply brand scale to CSS variables. Runs whenever the color changes.
  useEffect(() => {
    const scale = brand.brandColor && !brand.isDefault
      ? generateBrandScale(brand.brandColor)
      : DEFAULT_SCALE;
    applyBrandScale(scale);

    // Reset to defaults on unmount (e.g. user logs out and we go back to
    // the marketing site). Keeps login/landing screens on AI Front Desk
    // Helper branding.
    return () => {
      resetBrandScale();
    };
  }, [brand.brandColor, brand.isDefault]);

  // Apply document.title. We append "· AI Front Desk Helper" only for the
  // default (non-white-labeled) case, so white-labeled tenants don't leak
  // our brand name into their browser tabs.
  useEffect(() => {
    document.title = brand.isDefault
      ? "AI Front Desk Helper"
      : brand.companyName;
  }, [brand.companyName, brand.isDefault]);

  // Apply favicon.
  useEffect(() => {
    setFavicon(brand.faviconUrl);
  }, [brand.faviconUrl]);

  return (
    <BrandContext.Provider value={brand}>
      {children}
    </BrandContext.Provider>
  );
}

export { DEFAULT_BRAND };
