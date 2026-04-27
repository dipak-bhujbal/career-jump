PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_job_first_seen (
  tenant_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, fingerprint),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_job_seen_markers (
  tenant_id TEXT NOT NULL,
  seen_key TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, seen_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_job_first_seen_updated
  ON tenant_job_first_seen(tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_job_seen_markers_updated
  ON tenant_job_seen_markers(tenant_id, updated_at DESC);
