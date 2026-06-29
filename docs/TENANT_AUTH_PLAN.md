# Tenant signup and login: what you need

## Current state

- **Signup**: Creates a user with `tenant_id = NULL` and `role = 'viewer'`. No business is linked.
- **Login**: Returns `user.tenant_id` and `user.role` in the JWT; dashboard stores them but the backend does not use them for access control.
- **Dashboard API**: Requires a valid JWT but does **not** check that the user is allowed to access the `tenant_id` they send. Any logged-in user can request any tenant’s data.
- **GET /api/tenants**: Returns all tenants to any authenticated user.
- **Schema**: `dashboard_users` has `tenant_id` (nullable) and `UNIQUE(tenant_id, email)` (same email can exist in different tenants).

---

## What you need to do (in order)

### 1. Enforce tenant access in the backend (required for security)

- Add a helper, e.g. `requireTenantAccess(req, res, next)` or `getAllowedTenantIds(req)`.
- **Rules**:
  - If `req.user.tenant_id` is set → user may only access that tenant.
  - If `req.user.tenant_id` is null (platform admin) → user may access all tenants (optional; only if you have such users).
- Use this on every dashboard route that is tenant-scoped:
  - For list endpoints (calls, bookings, follow-ups, metrics): allow only if requested `tenant_id` is in the allowed set; otherwise 403.
  - For GET-by-ID (calls/:id, recordings/:id, tenants/:id): load the resource, then allow only if its `tenant_id` is in the allowed set; otherwise 404.
- **GET /api/tenants**: Return only tenants the user is allowed to see (e.g. filter by `req.user.tenant_id` or return all for platform admin).

Until this is in place, “tenant” in signup/login is only cosmetic; the backend does not enforce it.

### 2. Decide how signup should work (product decision)

Pick one (or combine later):

**A) Sign up and create a new business (tenant)**  
- Signup flow: email, password, **business name** (and maybe company name, slug).  
- Backend: create a row in `tenants`, then create `dashboard_users` with that `tenant_id` and `role = 'admin'`.  
- Result: one tenant per new signup; user is admin of that tenant.  
- Optional: create a default `phone_numbers` row or leave that for “setup” later.

**B) Sign up to join an existing business**  
- Signup flow: email, password, and **tenant context** (e.g. invite token, or tenant slug/code from a link).  
- Backend: resolve tenant from token/slug; create `dashboard_users` with that `tenant_id` and `role = 'viewer'` (or role from invite).  
- Result: user belongs to one existing tenant.  
- Requires: invite tokens table or public “join” links (e.g. `/signup?tenant=acme-corp`).

**C) Sign up with no tenant (current)**  
- Keep signup as-is (tenant_id NULL).  
- Then: add a separate “invite” or “assign to business” flow so an admin can attach the user to a tenant.  
- Or: “Create business” flow after first login that creates a tenant and updates the user’s `tenant_id`.

**D) Hybrid**  
- Signup page: “Create a business” vs “I have an invite link.”  
- Path 1 = A; Path 2 = B.

### 3. Login and tenant scope

- **Single-tenant users** (`tenant_id` set):  
  - Optionally restrict GET /api/tenants to that one tenant so the dropdown only shows their business.  
  - Backend already returns `user.tenant_id`; frontend can pre-select that tenant and even hide the selector if there’s only one.

- **Multi-tenant or platform users** (`tenant_id` null):  
  - Keep tenant selector; GET /api/tenants returns only tenants they’re allowed to see (after you add the filter in step 1).

- **Same email in multiple tenants**:  
  - Schema allows it (`UNIQUE(tenant_id, email)`).  
  - Login today is by email only, so you get one row (first match). To support “choose which business” at login you’d either:  
    - Require (email + tenant) at login, or  
    - Return a list of (tenant_id, role) for that email and let the user pick, then issue a token for that tenant.  
  - For many apps, one user = one tenant is enough at first.

### 4. Frontend changes (after backend is decided)

- **Signup**  
  - If A: add fields (e.g. business name, company name); call new endpoint e.g. `POST /api/auth/signup` with `{ email, password, company_name, name? }` and create tenant + user.  
  - If B: add “Invite code” or “Join link”; call signup with `{ email, password, invite_token }` or `{ email, password, tenant_slug }`.  
  - If C: keep current signup; add “Create business” or “Accept invite” flow after login.

- **Login**  
  - No change if each user has one tenant: keep current login; backend will enforce tenant access.  
  - If you later support “same email, multiple tenants,” add a step (e.g. tenant picker after email/password) and possibly a new endpoint or parameter.

- **Tenant selector**  
  - Already exists; once GET /api/tenants is filtered by allowed tenants, it will only show valid options.  
  - Optional: if the user has exactly one allowed tenant, auto-select it and hide the selector.

---

## Recommended order of implementation

1. **Backend: tenant authorization**  
   - Implement `requireTenantAccess` (or allowed-tenant list).  
   - Use it on all dashboard routes that take or return tenant-scoped data.  
   - Filter GET /api/tenants by allowed tenants.

2. **Signup flow**  
   - Choose A, B, or C (or D).  
   - Add the corresponding backend endpoint(s) and DB changes (e.g. invite tokens if B).  
   - Update the signup page (and optional “Create business” / invite flow).

3. **Login**  
   - Keep as-is for single-tenant-per-user; rely on backend tenant checks.  
   - Optionally: default the tenant selector to `user.tenant_id` when it’s set.

4. **Optional**  
   - Roles: enforce `role` (e.g. only `admin` can PATCH tenant, invite users).  
   - Invite table and “accept invite” flow for B/C.

---

## Summary

- **Must do**: Enforce tenant access in the dashboard API and restrict GET /api/tenants so signup/login “tenant structure” is real, not just in the UI.  
- **Then**: Decide whether signup creates a tenant (A), joins one (B), or stays unassigned (C), and implement the matching backend and frontend.  
- **Login** can stay as-is for now; tenant security is then enforced by the new backend checks.
