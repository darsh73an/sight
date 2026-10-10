import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { getErrorMessage } from '../api/errors';
import { ErrorGroup } from '../types';

interface ErrorListProps {
  projectId: string;
  selectedGroupId: string | null;
  onSelect: (groupId: string) => void;
  /** Bumped by the parent to force a refetch (e.g. after a resolve). */
  refreshKey: number;
}

// Colors chosen for WCAG AA contrast (4.5:1 min) against the white badge
// text below, at this badge's ~11px font size. The original warning color
// (#d97706) only measured ~3.2:1 - failed AA - #b45309 measures ~5:1.
const LEVEL_COLORS: Record<string, string> = {
  error: '#dc2626', // ~4.8:1
  warning: '#b45309', // ~5.0:1 (was #d97706, ~3.2:1 - failed AA)
  info: '#2563eb', // ~5.2:1
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function ErrorList({ projectId, selectedGroupId, onSelect, refreshKey }: ErrorListProps) {
  const [groups, setGroups] = useState<ErrorGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<{ groups: ErrorGroup[] }>(
          `/projects/${projectId}/errors`
        );
        if (!cancelled) setGroups(res.data.groups);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load errors'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    // Re-fetch whenever the project changes, the parent bumps refreshKey
    // (e.g. right after a resolve action), or the user clicks retry.
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, retryTick]);

  if (loading) {
    return <div className="error-list">Loading errors...</div>;
  }

  if (error) {
    return (
      <div className="error-list empty-state">
        <p className="alert-error">{error}</p>
        <button className="secondary" onClick={() => setRetryTick((t) => t + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="error-list empty-state">
        <p>All clear - no errors reported for this project.</p>
      </div>
    );
  }

  return (
    <ul className="error-list">
      {groups.map((group) => (
        <li
          key={group.id}
          className={`error-row ${group.id === selectedGroupId ? 'selected' : ''} ${
            group.status === 'resolved' ? 'resolved' : ''
          }`}
          role="button"
          tabIndex={0}
          aria-pressed={group.id === selectedGroupId}
          onClick={() => onSelect(group.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(group.id);
            }
          }}
        >
          <span
            className="level-badge"
            role="status"
            aria-label={`Level: ${group.level}`}
            style={{ backgroundColor: LEVEL_COLORS[group.level] ?? '#6b7280' }}
          >
            {group.level}
          </span>
          <span className="error-title">{group.title}</span>
          <span className="error-count">{group.event_count}x</span>
          <span className="error-time">{formatRelativeTime(group.last_seen)}</span>
          <span className={`status-badge status-${group.status}`} role="status">
            {group.status}
          </span>
        </li>
      ))}
    </ul>
  );
}
