import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, clearTokens, getRefreshToken } from '../api/client';
import { ProjectSelector } from '../components/ProjectSelector';
import { ProjectApiKey } from '../components/ProjectApiKey';
import { ErrorList } from '../components/ErrorList';
import { ErrorDetail } from '../components/ErrorDetail';

export function Dashboard() {
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSelectProject(projectId: string) {
    setSelectedProjectId(projectId);
    // Switching projects clears the detail pane and reloads the list -
    // an old project's selected error shouldn't linger on screen.
    setSelectedGroupId(null);
  }

  async function handleLogout() {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      // Best-effort - a failed revoke (e.g. network drop) shouldn't block
      // the user from logging out locally. Worst case, the refresh token
      // stays valid server-side until it naturally expires.
      try {
        await apiClient.post('/auth/logout', { refreshToken });
      } catch {
        // ignore - see comment above
      }
    }
    clearTokens();
    navigate('/login');
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>ErrSight</h1>
        <button className="secondary" onClick={handleLogout}>
          Log out
        </button>
      </header>

      <ProjectSelector selectedProjectId={selectedProjectId} onSelect={handleSelectProject} />

      {selectedProjectId && <ProjectApiKey projectId={selectedProjectId} />}

      {selectedProjectId && (
        <div className="dashboard-body">
          <div className="dashboard-list-pane">
            <ErrorList
              projectId={selectedProjectId}
              selectedGroupId={selectedGroupId}
              onSelect={setSelectedGroupId}
              refreshKey={refreshKey}
            />
          </div>

          <div className="dashboard-detail-pane">
            {selectedGroupId ? (
              <ErrorDetail
                groupId={selectedGroupId}
                onResolved={() => setRefreshKey((k) => k + 1)}
              />
            ) : (
              <div className="empty-state">Select an error to see details.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
