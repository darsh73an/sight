import { describe, it, expect } from 'vitest';
import { scrubPII, scrubContext } from './scrubber';

describe('scrubPII', () => {
  it('redacts emails', () => {
    expect(scrubPII('contact user@example.com for help')).toBe(
      'contact [REDACTED] for help'
    );
  });

  it('redacts credit-card-like digit sequences', () => {
    expect(scrubPII('card 4111 1111 1111 1111 declined')).toBe('card [REDACTED] declined');
  });

  it('redacts JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(scrubPII(`token=${jwt}`)).toBe('token=[REDACTED]');
  });

  it('redacts password fields while keeping the key name', () => {
    expect(scrubPII('password: hunter2')).toBe('password: [REDACTED]');
    expect(scrubPII('pwd=hunter2')).toBe('pwd=[REDACTED]');
  });

  it('redacts long API-key-like tokens', () => {
    expect(scrubPII('key=sk_live_test_key_not_a_real_key')).toBe('key=[REDACTED]');
  });

  it('leaves ordinary text untouched', () => {
    expect(scrubPII('TypeError: cannot read property foo of undefined')).toBe(
      'TypeError: cannot read property foo of undefined'
    );
  });

  it('returns empty/falsy input unchanged', () => {
    expect(scrubPII('')).toBe('');
  });
});

describe('scrubContext', () => {
  it('redacts known sensitive keys at the top level', () => {
    const result = scrubContext({ email: 'a@b.com', userId: 'u_123' });
    expect(result.email).toBe('[REDACTED]');
    expect(result.userId).toBe('u_123');
  });

  it('is case-insensitive on key names', () => {
    const result = scrubContext({ APIKey: 'secret123', Password: 'hunter2' });
    expect(result.APIKey).toBe('[REDACTED]');
    expect(result.Password).toBe('[REDACTED]');
  });

  it('recurses into nested objects (the bug this was added to fix)', () => {
    const result = scrubContext({
      user: { profile: { email: 'nested@example.com' } },
    });
    const user = result.user as Record<string, unknown>;
    const profile = user.profile as Record<string, unknown>;
    expect(profile.email).toBe('[REDACTED]');
  });

  it('recurses into arrays of objects', () => {
    const result = scrubContext({
      requests: [{ token: 'abc' }, { token: 'def' }],
    });
    const requests = result.requests as Record<string, unknown>[];
    expect(requests[0].token).toBe('[REDACTED]');
    expect(requests[1].token).toBe('[REDACTED]');
  });

  it('scrubs PII found in string values under unrecognized keys, at any depth', () => {
    const result = scrubContext({
      meta: { note: 'contact me at someone@example.com' },
    });
    const meta = result.meta as Record<string, unknown>;
    expect(meta.note).toBe('contact me at [REDACTED]');
  });

  it('leaves numbers, booleans, and null untouched', () => {
    const result = scrubContext({ count: 5, active: true, deletedAt: null });
    expect(result.count).toBe(5);
    expect(result.active).toBe(true);
    expect(result.deletedAt).toBeNull();
  });
});
