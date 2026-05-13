// middleware/hostnameResolver.js
//
// Resolves the incoming request's hostname to a tenant via the
// custom_domain column. Attaches `req.tenantFromHost` for downstream
// handlers to use. NON-BLOCKING — if no match, sets to null and
// calls next() so default routing still works.
//
// Hostnames considered "default" (our own domain, dev hosts, Render
// preview URLs) are skipped to avoid an unnecessary DB hit per request.
//
// Future-proofing: when we want to support branded subdomains like
// `paragon.aifrontdeskhelper.com`, just add a second query that checks
// for an exact match on a new `subdomain_slug` column, before falling
// through to the custom_domain query. The interface (req.tenantFromHost)
// stays the same.
//
// May 13, 2026 — Phase 7 V2 white-label DNS.
// ─────────────────────────────────────────────────────────────────────

const db = require('./db');

// Hostnames that should NEVER resolve to a custom tenant — these are
// either our own canonical domains, dev environments, or Render-generated
// preview URLs. Add to this set if you spin up new envs.
const DEFAULT_HOSTS = new Set([
  'aifrontdeskhelper.com',
  'www.aifrontdeskhelper.com',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

// Render preview deploys look like ai-front-desk-backend-1.onrender.com
const isRenderHost = (host) => host.endsWith('.onrender.com');

async function resolveHostnameToTenant(req, res, next) {
  // Express's req.hostname strips port automatically and lowercases.
  // We re-lowercase as defense in depth in case behind a proxy that
  // forwards X-Forwarded-Host raw.
  const host = (req.hostname || '').toLowerCase();

  // Default/dev hosts → skip DB lookup
  if (!host || DEFAULT_HOSTS.has(host) || isRenderHost(host)) {
    req.tenantFromHost = null;
    return next();
  }

  try {
    const result = await db.query(
      `SELECT id, custom_domain, custom_domain_verified_at,
              brand_mode, company_name, name, plan
         FROM tenants
        WHERE custom_domain = $1
          AND custom_domain_status = 'active'
        LIMIT 1`,
      [host]
    );

    if (result.rows.length > 0) {
      req.tenantFromHost = result.rows[0];
    } else {
      req.tenantFromHost = null;
      // Log unmatched hostnames — useful for diagnosing the gap between
      // "tenant added the domain in Settings" and "Render is configured
      // to accept that hostname." A flood of these logs for one host
      // means Render config or DNS is wrong.
      console.log(`[hostnameResolver] Unmatched hostname: ${host}`);
    }
  } catch (e) {
    // Don't 500 the entire request if the DB hiccups — degrade gracefully.
    console.error('[hostnameResolver] DB error:', e.message);
    req.tenantFromHost = null;
  }

  next();
}

module.exports = { resolveHostnameToTenant };
