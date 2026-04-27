PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_inventory_state (
  tenant_id TEXT PRIMARY KEY,
  inventory_json TEXT NOT NULL,
  trend_json TEXT NOT NULL,
  last_new_jobs_count INTEGER NOT NULL DEFAULT 0,
  last_new_job_keys_json TEXT NOT NULL DEFAULT '[]',
  last_updated_jobs_count INTEGER NOT NULL DEFAULT 0,
  last_updated_job_keys_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_applied_state (
  tenant_id TEXT PRIMARY KEY,
  applied_jobs_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_inventory_state_updated ON tenant_inventory_state(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_applied_state_updated ON tenant_applied_state(updated_at DESC);
