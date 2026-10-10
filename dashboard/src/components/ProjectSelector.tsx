import { FormEvent, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { getErrorMessage } from '../api/errors';
import { Project } from '../types';

interface ProjectSelectorProps {
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectSelector({ selectedProjectId, onSelect }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<{ projects: Project[] }>('/projects');
      setProjects(res.data.projects);

      // Auto-select the first project if nothing is selected yet
      if (!selectedProjectId && res.data.projects.length > 0) {
        onSelect(res.data.projects[0].id);
      }
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Could not load projects'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiClient.post<{ project: Project }>('/projects', {
        name: newProjectName.trim(),
      });
      setProjects((prev) => [res.data.project, ...prev]);
      onSelect(res.data.project.id);
      setNewProjectName('');
      setShowCreateForm(false);
    } catch (err) {
      setCreateError(getErrorMessage(err, 'Could not create project - try again'));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <div className="project-selector">Loading projects...</div>;
  }

  if (loadError) {
    return (
      <div className="project-selector empty-state">
        <p className="alert-error">{loadError}</p>
        <button className="secondary" onClick={loadProjects}>
          Retry
        </button>
      </div>
    );
  }

  if (projects.length === 0 && !showCreateForm) {
    return (
      <div className="project-selector empty-state">
        <p>No projects yet.</p>
        <button onClick={() => setShowCreateForm(true)}>Create one</button>
      </div>
    );
  }

  return (
    <div className="project-selector">
      {projects.length > 0 && (
        <select
          aria-label="Select project"
          value={selectedProjectId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {!showCreateForm && (
        <button className="secondary" onClick={() => setShowCreateForm(true)}>
          + New project
        </button>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="inline-form">
          <input
            aria-label="Project name"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project name"
            autoFocus
          />
          <button type="submit" disabled={creating}>
            {creating ? 'Creating...' : 'Create'}
          </button>
          <button type="button" className="secondary" onClick={() => setShowCreateForm(false)}>
            Cancel
          </button>
          {createError && <p className="alert-error">{createError}</p>}
        </form>
      )}
    </div>
  );
}
