-- Migration 056 - audit_logs tenant_id canonicalization
-- Replaces legacy audit organization columns with tenant_id UUID.

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE NOTICE 'audit_logs table not found; skipping audit tenant_id migration';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_logs'
        AND column_name = 'tenant_id'
    ) THEN
      ALTER TABLE public.audit_logs ADD COLUMN tenant_id UUID;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_logs'
        AND column_name = 'organization_id'
    ) THEN
      UPDATE public.audit_logs
         SET tenant_id = organization_id::uuid
       WHERE tenant_id IS NULL
         AND organization_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

      ALTER TABLE public.audit_logs DROP COLUMN organization_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_logs'
        AND column_name = 'org_id'
    ) THEN
      UPDATE public.audit_logs
         SET tenant_id = org_id::uuid
       WHERE tenant_id IS NULL
         AND org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

      ALTER TABLE public.audit_logs DROP COLUMN org_id;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id
      ON public.audit_logs(tenant_id);
  END IF;
END $$;
