import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { getErrorMessage } from '../api/errors';
import { ErrorGroup, ErrorEvent } from '../types';

interface ErrorDetailProps {
  groupId: string;
  /** Called after a successful resolve, so the parent can refresh the list. */
  onResolved: () => void;
}

export function ErrorDetail({ groupId, onResolved }: ErrorDetailProps) {
  const [group, setGroup] = useState<ErrorGroup | null>(null);
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await apiClient.get<{ group: ErrorGroup; events: ErrorEvent[] }>(
          `/errors/${groupId}`
        );
        if (!cancelled) {
          setGroup(res.data.group);
          setEvents(res.data.events);
        }
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load this error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [groupId, retryTick]);

  async function handleResolve() {
    setResolving(true);
    setResolveError(null);
    try {
      const res = await apiClient.post<{ group: ErrorGroup }>(`/errors/${groupId}/resolve`);
      // Update local state directly from the response instead of
      // re-fetching - the UI reflects the new status immediately, no
      // full page reload or extra round trip needed.
      setGroup(res.data.group);
      onResolved();
    } catch (err) {
      setResolveError(getErrorMessage(err, 'Could not resolve this error - try again'));
    } finally {
      setResolving(false);
    }
  }

  if (loading) {
    return <div className="error-detail">Loading...</div>;
  }

  if (loadError) {
    return (
      <div className="error-detail">
        <p className="alert-error">{loadError}</p>
        <button className="secondary" onClick={() => setRetryTick((t) => t + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (!group) {
    return <div className="error-detail">Error group not found.</div>;
  }

  return (
    <div className="error-detail">
      <div className="error-detail-header">
        <h2>{group.title}</h2>
        <span className={`status-badge status-${group.status}`}>{group.status}</span>
      </div>

      <div className="error-detail-meta">
        <span>Level: {group.level}</span>
        <span>Occurrences: {group.event_count}</span>
        <span>First seen: {new Date(group.first_seen).toLocaleString()}</span>
        <span>Last seen: {new Date(group.last_seen).toLocaleString()}</span>
      </div>

      {group.status !== 'resolved' && (
        <>
          <button onClick={handleResolve} disabled={resolving}>
            {resolving ? 'Resolving...' : 'Mark as resolved'}
          </button>
          {resolveError && <p className="alert-error">{resolveError}</p>}
        </>
      )}

      <h3>Recent events ({events.length})</h3>
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id} className="event-item">
            <div className="event-header">
              <span>{new Date(event.created_at).toLocaleString()}</span>
              <span>{event.environment}</span>
            </div>
            <p className="event-message">{event.message}</p>
            {event.stack_trace && <pre className="event-stack">{event.stack_trace}</pre>}
            {Object.keys(event.context).length > 0 && (
              <pre className="event-context">{JSON.stringify(event.context, null, 2)}</pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
