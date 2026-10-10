import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { getErrorMessage } from '../api/errors';
import { Project } from '../types';

interface ProjectApiKeyProps {
  projectId: string;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}${'•'.repeat(key.length - 8)}${key.slice(-4)}`;
}

export function ProjectApiKey({ projectId }: ProjectApiKeyProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setRevealed(false);
      setConfirmingRegenerate(false);
      try {
        const res = await apiClient.get<{ project: Project }>(`/projects/${projectId}`);
        if (!cancelled) setProject(res.data.project);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load project'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleCopy() {
    if (!project) return;
    await navigator.clipboard.writeText(project.api_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await apiClient.post<{ project: Project }>(
        `/projects/${projectId}/regenerate-key`
      );
      setProject(res.data.project);
      setRevealed(true);
      setConfirmingRegenerate(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not regenerate API key'));
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) return null;

  if (error) {
    return (
      <div className="api-key-panel">
        <p className="alert-error">{error}</p>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="api-key-panel">
      <span className="api-key-label">API key:</span>
      <code className="api-key-value">
        {revealed ? project.api_key : maskKey(project.api_key)}
      </code>
      <button className="secondary" onClick={() => setRevealed((r) => !r)}>
        {revealed ? 'Hide' : 'Show'}
      </button>
      <button className="secondary" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy'}
      </button>

      {!confirmingRegenerate ? (
        <button className="secondary" onClick={() => setConfirmingRegenerate(true)}>
          Regenerate
        </button>
      ) : (
        <span className="api-key-confirm">
          This will invalidate the current key for any SDK already using it.
          <button onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? 'Regenerating...' : 'Confirm'}
          </button>
          <button className="secondary" onClick={() => setConfirmingRegenerate(false)}>
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}
