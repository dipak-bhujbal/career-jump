PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_filters_scope_name_unique
  ON saved_filters(tenant_id, scope, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_filters_default_scope_unique
  ON saved_filters(tenant_id, scope)
  WHERE is_default = 1;

CREATE INDEX IF NOT EXISTS idx_app_logs_tenant_level_created
  ON app_logs(tenant_id, level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_tenant_event_created
  ON app_logs(tenant_id, event, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_tenant_run_created
  ON app_logs(tenant_id, run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_tenant_route_created
  ON app_logs(tenant_id, route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_tenant_company_created
  ON app_logs(tenant_id, company_name, created_at DESC);
