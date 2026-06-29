import { createContext, useContext, useEffect, useState } from "react";

/**
 * HostnameBrandingContext
 *
 * On app mount, detects whether the user is visiting from a tenant's
 * custom domain (e.g. app.paragonext.com vs aifrontdeskhelper.com). If
 * so, fetches the tenant's branding via the public endpoint and applies:
 *
 *   - document.title              → tenant's company name
 *   - <link rel="icon"> in <head> → tenant's favicon
 *   - --brand-color CSS variable  → tenant's brand color
 *   - Context value `branding`    → for Login.jsx to swap logo + welcome copy
 *
 * Falls back silently to AI Front Desk Helper defaults on the canonical
 * domain or when the fetch fails. After login, JWT-based tenant resolution
 * takes over for the dashboard — this hook is primarily for the pre-auth
 * experience (login page, browser tab metadata).
 *
 * Test override: append ?branding_host=app.example.com to any URL to
 * force the fetch as if visiting that hostname. Useful for previewing
 * a tenant's branded login page before their DNS is actually pointed.
 *
 * May 13, 2026 — Phase 7 V2 white-label DNS, Step 5c.
 */

const HostnameBrandingContext = createContext({ branding: null, loaded: false });

// Hosts that should NEVER trigger a custom branding fetch. Mirrors the
// backend's lib/hostnameResolver.js DEFAULT_HOSTS set. Keep in sync if
// you add a new domain on either side.
const DEFAULT_HOSTS = new Set([
  "aifrontdeskhelper.com",
  "www.aifrontdeskhelper.com",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
]);

const isDefaultHost = (host) => {
  if (!host) return true;
  const lower = host.toLowerCase();
  if (DEFAULT_HOSTS.has(lower)) return true;
  if (lower.endsWith(".onrender.com")) return true; // Render preview deploys
  return false;
};

export function HostnameBrandingProvider({ children }) {
  const [branding, setBranding] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Test/dev override: ?branding_host=foo.com lets us preview a tenant's
    // branded experience without their DNS being pointed yet. Removing
    // this would require us to wait until Render is configured for a
    // tenant's domain to validate the visual changes.
    const params = new URLSearchParams(window.location.search);
    const overrideHost = params.get("branding_host");
    const host = overrideHost || window.location.hostname;

    if (!overrideHost && isDefaultHost(host)) {
      setLoaded(true);
      return;
    }

    const apiUrl = (import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com")
      .replace(/\/+$/, "");

    fetch(`${apiUrl}/api/public/branding/by-hostname?host=${encodeURIComponent(host)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          setLoaded(true);
          return;
        }
        setBranding(data);

        // DOM-level side effects — these live outside the React tree.
        if (data.company_name) {
          document.title = data.company_name;
        }
        if (data.favicon_url) {
          let link = document.querySelector("link[rel='icon']");
          if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
          }
          link.href = data.favicon_url;
        }
        if (data.brand_color) {
          document.documentElement.style.setProperty("--brand-color", data.brand_color);
        }

        setLoaded(true);
      })
      .catch((err) => {
        // Silent fallback — if branding fetch fails, the user still gets
        // the default AI Front Desk Helper experience and can log in normally.
        console.warn("[HostnameBranding] Fetch failed:", err.message);
        setLoaded(true);
      });
  }, []);

  return (
    <HostnameBrandingContext.Provider value={{ branding, loaded }}>
      {children}
    </HostnameBrandingContext.Provider>
  );
}

export function useHostnameBranding() {
  return useContext(HostnameBrandingContext);
}
