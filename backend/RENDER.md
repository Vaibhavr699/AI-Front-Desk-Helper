# Deploy on Render (two services)

**Backend:** Web Service (API only). **Frontend:** Static Site (dashboard only).

**Backend is API-only by default.** You do not set `SERVE_DASHBOARD`. The backend serves only `/health`, `/api/*`, and `/twilio/*`. Visiting `/` redirects to `FRONTEND_URL` (if set) or shows a short message.

---

## Backend (Web Service)

- **Build Command:** `npm install` (do **not** run `npm run build:dashboard`)
- **Start Command:** `npm start`
- **Environment:**
  - All backend vars (e.g. `BASE_URL`, `DATABASE_URL`, `TWILIO_*`, `OPENAI_API_KEY`, `JWT_SECRET`, etc.). Set `BASE_URL` to the **backend root** only. For **Supabase**: use `DATABASE_URL` or `SUPABASE_DATABASE_URL` = Supabase Project Settings → Database → Connection string (URI, use pooler port 6543).
  - **`SERVE_DASHBOARD`** — leave unset (default is API-only)
  - **`CORS_ORIGINS`** or **`FRONTEND_URL`** = your frontend URL, e.g. `https://ai-front-desk-backend-1.onrender.com` (required for CORS; set at least one)
  - **`FRONTEND_URL`** (optional) — when set, visiting the backend root `/` redirects to the frontend

## Frontend (Static Site)

**Important:** Create a **Static Site** (not a Web Service). Static Sites do not run Node or a start command.

- **Type:** Static Site
- **Root Directory:** `dashboard`
- **Build Command:** `npm install && npm run build`
- **Publish Directory:** `dist`  
  If you get "Not Found" at `/`, try **`dashboard/dist`** instead.
- **Environment:**
  - **`VITE_API_URL`** = backend URL, e.g. `https://your-backend.onrender.com` (no trailing slash). Required so the built app calls your backend for `/api/...`.
- **Redirects/Rewrites (required for SPA):** In Render Dashboard → your Static Site → **Redirects/Rewrites**, add:
  - **Source:** `/*`
  - **Destination:** `/index.html`
  - **Action:** **Rewrite**

Users open the **frontend** URL; API requests go to the **backend** URL. Twilio webhooks and `BASE_URL` use the backend URL.
