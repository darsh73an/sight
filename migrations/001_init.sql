-- ErrSight initial schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  api_key VARCHAR(64) UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL DEFAULT 'javascript',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_api_key ON projects(api_key);

CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint VARCHAR(64) NOT NULL,
  title VARCHAR(500) NOT NULL,
  error_type VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'unresolved', -- unresolved | resolved | ignored
  event_count INTEGER NOT NULL DEFAULT 0,
  user_count INTEGER NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_project ON error_groups(project_id);
CREATE INDEX IF NOT EXISTS idx_error_groups_status ON error_groups(project_id, status);
CREATE INDEX IF NOT EXISTS idx_error_groups_last_seen ON error_groups(project_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS error_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_group_id UUID NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  stack_trace TEXT,
  level VARCHAR(20) NOT NULL DEFAULT 'error', -- error | warning | info
  release VARCHAR(100),
  environment VARCHAR(50) DEFAULT 'production',
  user_id_hash VARCHAR(64), -- hashed/scrubbed end-user identifier
  breadcrumbs JSONB DEFAULT '[]',
  context JSONB DEFAULT '{}',
  url TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_events_group ON error_events(error_group_id);
CREATE INDEX IF NOT EXISTS idx_error_events_project ON error_events(project_id);
CREATE INDEX IF NOT EXISTS idx_error_events_created ON error_events(created_at DESC);
