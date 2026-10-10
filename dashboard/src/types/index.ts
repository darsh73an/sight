export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface Project {
  id: string;
  name: string;
  api_key: string;
  owner_id: string;
  platform: string;
  created_at: string;
  updated_at: string;
}

export type ErrorGroupStatus = 'unresolved' | 'resolved' | 'ignored';
export type ErrorLevel = 'error' | 'warning' | 'info';

export interface ErrorGroup {
  id: string;
  project_id: string;
  fingerprint: string;
  title: string;
  error_type: string | null;
  status: ErrorGroupStatus;
  level: ErrorLevel;
  event_count: number;
  user_count: number;
  first_seen: string;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface ErrorEvent {
  id: string;
  error_group_id: string;
  project_id: string;
  message: string;
  stack_trace: string | null;
  level: string;
  release: string | null;
  environment: string;
  user_id_hash: string | null;
  breadcrumbs: unknown[];
  context: Record<string, unknown>;
  url: string | null;
  user_agent: string | null;
  created_at: string;
}
