import { describe, it, expect } from 'vitest';
import { normalizeMessage, extractKeyFrame, generateFingerprint } from './fingerprint';

describe('normalizeMessage', () => {
  it('replaces numbers with *', () => {
    expect(normalizeMessage('user 42 not found')).toBe('user * not found');
  });

  it('collapses different numbers in the same message shape to the same string', () => {
    expect(normalizeMessage('user 42 not found')).toBe(normalizeMessage('user 99 not found'));
  });

  it('replaces emails with *', () => {
    expect(normalizeMessage('failed for user@example.com')).toBe('failed for *');
  });

  it('replaces URLs with *', () => {
    expect(normalizeMessage('fetch failed: https://api.example.com/v1/x')).toBe(
      'fetch failed: *'
    );
  });

  it('replaces quoted strings with *', () => {
    expect(normalizeMessage('invalid value "foo-bar-123"')).toBe('invalid value *');
  });

  it('lowercases the result', () => {
    expect(normalizeMessage('TypeError: Something Broke')).toBe('typeerror: something broke');
  });

  it('normalizes quoted strings and emails before stripping digits, not after', () => {
    // If digit-stripping ran first, the email/quote patterns below would
    // already be mangled (digits are part of both) and fail to match.
    expect(normalizeMessage('user "id123" a1@b.com failed')).toBe('user * * failed');
  });
});

describe('extractKeyFrame', () => {
  it('returns null when there is no stack trace', () => {
    expect(extractKeyFrame(undefined)).toBeNull();
  });

  it('extracts funcName@fileName from a standard V8 frame', () => {
    const stack = 'Error: boom\n    at getUserName (/app/src/services/user.js:42:10)';
    expect(extractKeyFrame(stack)).toBe('getUserName@user.js');
  });

  it('skips node_modules frames and uses the first app frame', () => {
    const stack = [
      'Error: boom',
      '    at Object.wrapper (/app/node_modules/some-lib/index.js:5:1)',
      '    at getUserName (/app/src/services/user.js:42:10)',
    ].join('\n');
    expect(extractKeyFrame(stack)).toBe('getUserName@user.js');
  });

  it('skips node internal frames', () => {
    const stack = [
      'Error: boom',
      '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
      '    at getUserName (/app/src/services/user.js:42:10)',
    ].join('\n');
    expect(extractKeyFrame(stack)).toBe('getUserName@user.js');
  });

  it('handles anonymous frames with no function name', () => {
    const stack = 'Error: boom\n    at /app/src/index.js:10:3';
    expect(extractKeyFrame(stack)).toBe('anonymous@index.js');
  });

  it('never includes line/column numbers in the result', () => {
    const stack = 'Error: boom\n    at getUserName (/app/src/services/user.js:42:10)';
    expect(extractKeyFrame(stack)).not.toMatch(/\d/);
  });
});

describe('generateFingerprint', () => {
  const stack = 'Error: boom\n    at getUserName (/app/src/services/user.js:42:10)';

  it('is deterministic - same input always produces the same hash', () => {
    const a = generateFingerprint('user 42 not found', stack);
    const b = generateFingerprint('user 42 not found', stack);
    expect(a).toBe(b);
  });

  it('is 16 hex characters', () => {
    const fp = generateFingerprint('some error', stack);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('groups the same error sent with different variable data (the core grouping requirement)', () => {
    const a = generateFingerprint('user 42 not found', stack);
    const b = generateFingerprint('user 99 not found', stack);
    expect(a).toBe(b);
  });

  it('does NOT group genuinely different errors', () => {
    const a = generateFingerprint('user not found', stack);
    const b = generateFingerprint('payment failed', stack);
    expect(a).not.toBe(b);
  });

  it('treats the same message at different call sites as different groups', () => {
    const otherStack = 'Error: boom\n    at chargeCard (/app/src/billing/charge.js:10:2)';
    const a = generateFingerprint('timeout', stack);
    const b = generateFingerprint('timeout', otherStack);
    expect(a).not.toBe(b);
  });
});
