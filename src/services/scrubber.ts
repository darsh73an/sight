const REDACTED = '[REDACTED]';

// Order matters: scrub high-confidence, specific patterns (JWT, card,
// email, password fields) before the generic "long random string" catch-all,
// or the catch-all would eat parts of them first and leave mangled output.
const PASSWORD_FIELD_RE = /(password|passwd|pwd)(\s*[:=]\s*)["']?[^"'\s,}]+["']?/gi;
const JWT_RE = /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const CREDIT_CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
// Generic catch-all for API keys / tokens: long unbroken alphanumeric runs
const LONG_KEY_RE = /\b[A-Za-z0-9_-]{32,}\b/g;

/**
 * Scrubs PII out of free-text fields (error message, stack trace) before
 * they're persisted. Runs in the worker, never in the request path.
 */
export function scrubPII(text: string): string {
  if (!text) return text;

  let result = text;
  result = result.replace(PASSWORD_FIELD_RE, `$1$2${REDACTED}`);
  result = result.replace(JWT_RE, REDACTED);
  result = result.replace(EMAIL_RE, REDACTED);
  result = result.replace(CREDIT_CARD_RE, REDACTED);
  result = result.replace(LONG_KEY_RE, REDACTED);

  return result;
}

const CONTEXT_REDACT_KEYS = new Set(['email', 'password', 'token', 'apikey']);

/**
 * Recurses into objects and arrays at any depth - context is arbitrary
 * user-supplied JSON (e.g. { user: { profile: { email: '...' } } }), and
 * only checking top-level keys would miss PII nested even one level down.
 * Safe against runaway recursion: this only ever runs on data that came
 * through Express's JSON body parser, which can't produce circular
 * references (JSON.parse can't represent a cycle), so no depth guard needed.
 */
function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubPII(value);
  }

  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = CONTEXT_REDACT_KEYS.has(key.toLowerCase()) ? REDACTED : scrubValue(v);
    }
    return result;
  }

  // numbers, booleans, null, undefined - nothing to scrub
  return value;
}

/**
 * Scrubs the structured context object by key name (exact fields we know
 * are sensitive, at any nesting depth) and by content for any string
 * value that slips through under an unrecognized key.
 */
export function scrubContext(
  context: Record<string, unknown>
): Record<string, unknown> {
  return scrubValue(context) as Record<string, unknown>;
}
