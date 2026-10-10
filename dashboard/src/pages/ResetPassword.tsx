import { FormEvent, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { getErrorMessage } from '../api/errors';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setError(null);
    setLoading(true);

    try {
      await apiClient.post('/auth/reset-password', { token, newPassword });
      // Every existing session was revoked server-side on reset - send
      // them to a fresh login, not back into the dashboard with a token
      // that just got invalidated.
      navigate('/login');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not reset password - the link may have expired'));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Invalid link</h1>
          <p className="auth-subtitle">This password reset link is missing its token.</p>
          <p className="auth-footer">
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Set a new password</h1>

        {error && <div className="alert-error">{error}</div>}

        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
            autoFocus
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? 'Resetting...' : 'Reset password'}
        </button>

        <p className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
