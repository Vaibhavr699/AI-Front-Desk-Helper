-- Website Chat tenant: dashboard widget conversations (no tenantId) are stored under this tenant.
INSERT INTO tenants (name, slug, company_name)
SELECT 'Website Chat', 'website-chat', 'Website Chat'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE slug = 'website-chat');
