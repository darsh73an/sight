import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { getErrorMessage } from '../api/errors';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await apiClient.post('/auth/forgot-password', { email });
      // The backend always returns the same response whether or not the
      // email exists, specifically so this page can't be used to check
      // which emails are registered - show the generic message either way.
      setSubmitted(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not process request'));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Check your email</h1>
          <p className="auth-subtitle">
            If that email is registered, a password reset link has been sent.
          </p>
          <p className="auth-footer">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Reset your password</h1>
        <p className="auth-subtitle">Enter your email and we'll send you a reset link.</p>

        {error && <div className="alert-error">{error}</div>}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? 'Sending...' : 'Send reset link'}
        </button>

        <p className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
