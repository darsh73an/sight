import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { getErrorMessage } from '../api/errors';

type Status = 'verifying' | 'success' | 'error';

export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('This verification link is missing its token.');
      return;
    }

    let cancelled = false;
    apiClient
      .post('/auth/verify-email', { token })
      .then(() => {
        if (!cancelled) setStatus('success');
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus('error');
          setError(getErrorMessage(err, 'This verification link is invalid or has expired.'));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        {status === 'verifying' && <p className="auth-subtitle">Verifying your email...</p>}
        {status === 'success' && (
          <>
            <h1>Email verified</h1>
            <p className="auth-subtitle">You're all set.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <h1>Verification failed</h1>
            <p className="alert-error">{error}</p>
          </>
        )}
        <p className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
