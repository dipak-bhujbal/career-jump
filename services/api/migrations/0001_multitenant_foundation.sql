PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  auth_provider TEXT NOT NULL DEFAULT 'cloudflare-access',
  provider_user_id TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  companies_json TEXT NOT NULL,
  jobtitles_json TEXT NOT NULL,
  email_settings_json TEXT,
  ui_settings_json TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'system')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_fetched INTEGER NOT NULL DEFAULT 0,
  total_matched INTEGER NOT NULL DEFAULT 0,
  total_new INTEGER NOT NULL DEFAULT 0,
  total_updated INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_company_stats (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  source TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  excluded_non_us_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_postings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source TEXT NOT NULL,
  company_name TEXT NOT NULL,
  ats_job_id TEXT,
  title TEXT NOT NULL,
  location_raw TEXT,
  location_normalized_json TEXT,
  job_url TEXT NOT NULL,
  posted_at TEXT,
  posted_at_source TEXT,
  payload_json TEXT,
  payload_hash TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS canonical_roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  company_name TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  canonical_url TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_emailed_at TEXT,
  last_emailed_at TEXT,
  first_matched_at TEXT,
  last_matched_at TEXT,
  latest_posted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS role_variants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  canonical_role_id TEXT NOT NULL,
  raw_posting_id TEXT NOT NULL,
  variant_fingerprint TEXT NOT NULL,
  normalized_location TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_role_id) REFERENCES canonical_roles(id) ON DELETE CASCADE,
  FOREIGN KEY (raw_posting_id) REFERENCES raw_postings(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, raw_posting_id)
);

CREATE TABLE IF NOT EXISTS role_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  canonical_role_id TEXT NOT NULL,
  run_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'first_seen',
      'matched',
      'updated',
      'emailed',
      'applied',
      'dismissed',
      'rejected',
      'archived'
    )
  ),
  event_at TEXT NOT NULL,
  event_details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_role_id) REFERENCES canonical_roles(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS applied_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  canonical_role_id TEXT NOT NULL,
  variant_id TEXT,
  applied_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Applied', 'Interview', 'Rejected', 'Negotiations', 'Offered')),
  timeline_json TEXT NOT NULL,
  interview_rounds_json TEXT NOT NULL,
  notes_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_role_id) REFERENCES canonical_roles(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES role_variants(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, canonical_role_id)
);

CREATE TABLE IF NOT EXISTS saved_filters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('available_jobs', 'applied_jobs', 'dashboard', 'logs')),
  filter_json TEXT NOT NULL,
  created_by_user_id TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  run_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  event TEXT NOT NULL,
  route TEXT,
  company_name TEXT,
  source TEXT,
  message TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS match_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  raw_posting_id TEXT,
  canonical_role_id TEXT,
  decision_type TEXT NOT NULL CHECK (
    decision_type IN (
      'included',
      'excluded_title',
      'excluded_geography',
      'grouped_duplicate',
      'suppressed_seen',
      'suppressed_emailed'
    )
  ),
  explanation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (raw_posting_id) REFERENCES raw_postings(id) ON DELETE SET NULL,
  FOREIGN KEY (canonical_role_id) REFERENCES canonical_roles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS email_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('started', 'sent', 'failed', 'skipped')),
  webhook_target TEXT,
  subject TEXT,
  new_roles_count INTEGER NOT NULL DEFAULT 0,
  updated_roles_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_configs_active ON tenant_configs(tenant_id, is_active, version DESC);
CREATE INDEX IF NOT EXISTS idx_runs_tenant_started ON runs(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_company_stats_run ON run_company_stats(tenant_id, run_id, company_name);
CREATE INDEX IF NOT EXISTS idx_raw_postings_tenant_run ON raw_postings(tenant_id, run_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_postings_lookup ON raw_postings(tenant_id, source, company_name, ats_job_id);
CREATE INDEX IF NOT EXISTS idx_canonical_roles_seen ON canonical_roles(tenant_id, last_seen_at DESC, is_active);
CREATE INDEX IF NOT EXISTS idx_canonical_roles_title ON canonical_roles(tenant_id, company_name, normalized_title);
CREATE INDEX IF NOT EXISTS idx_role_variants_canonical ON role_variants(tenant_id, canonical_role_id, is_primary DESC);
CREATE INDEX IF NOT EXISTS idx_role_events_tenant_role ON role_events(tenant_id, canonical_role_id, event_type, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_applied_jobs_tenant_status ON applied_jobs(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_filters_scope ON saved_filters(tenant_id, scope, is_default DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_tenant_created ON app_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_decisions_run ON match_decisions(tenant_id, run_id, decision_type);
CREATE INDEX IF NOT EXISTS idx_email_events_run ON email_events(tenant_id, run_id, created_at DESC);
