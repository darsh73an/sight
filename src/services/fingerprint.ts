import crypto from 'crypto';

// Order matters here too: quoted strings and emails/URLs can contain digits,
// so they must be normalized away before the generic number regex runs,
// or the number regex would shred them into a mess of asterisks first.
const QUOTED_STRING_RE = /"[^"]*"|'[^']*'/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /https?:\/\/\S+/g;
const NUMBER_RE = /\d+/g;

/**
 * Collapses variable parts of an error message so that the same bug,
 * fired with different data ("user 42 not found" vs "user 99 not found"),
 * normalizes to the same string.
 */
export function normalizeMessage(message: string): string {
  let normalized = message;
  normalized = normalized.replace(QUOTED_STRING_RE, '*');
  normalized = normalized.replace(EMAIL_RE, '*');
  normalized = normalized.replace(URL_RE, '*');
  normalized = normalized.replace(NUMBER_RE, '*');
  return normalized.toLowerCase().trim();
}

interface ParsedFrame {
  funcName: string;
  fileName: string;
}

function parseStackLine(line: string): ParsedFrame | null {
  const trimmed = line.trim();

  // "at funcName (path/to/file.js:12:34)"
  let match = trimmed.match(/^at\s+(.+?)\s+\((.+):\d+:\d+\)$/);
  if (match) {
    const fileName = match[2].split(/[\\/]/).pop() || match[2];
    return { funcName: match[1], fileName };
  }

  // "at path/to/file.js:12:34" (anonymous frame, no function name)
  match = trimmed.match(/^at\s+(.+):\d+:\d+$/);
  if (match) {
    const fileName = match[1].split(/[\\/]/).pop() || match[1];
    return { funcName: 'anonymous', fileName };
  }

  return null;
}

/**
 * Picks the first stack frame that's actually the developer's own code -
 * skips node_modules and Node's internal frames, since those are noise
 * that's identical across totally unrelated bugs.
 */
export function extractKeyFrame(stackTrace?: string): string | null {
  if (!stackTrace) return null;

  for (const line of stackTrace.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    if (trimmed.includes('node_modules')) continue;
    if (/node:internal|[\\/]internal[\\/]/.test(trimmed)) continue;

    const parsed = parseStackLine(trimmed);
    if (parsed) {
      // No line numbers - line numbers shift on every code change/deploy
      // even though it's still the same bug, which would fragment one
      // real bug into dozens of "different" error groups.
      return `${parsed.funcName}@${parsed.fileName}`;
    }
  }

  return null;
}

/**
 * The full grouping key for an error: normalized message + key frame,
 * hashed to a fixed-length id. SHA-256 gives a huge keyspace (no realistic
 * collisions), we only keep 16 hex chars because we don't need
 * cryptographic strength here - just a short, stable, collision-resistant
 * grouping key that fits comfortably in a DB column.
 */
export function generateFingerprint(message: string, stackTrace?: string): string {
  const normalizedMessage = normalizeMessage(message);
  const keyFrame = extractKeyFrame(stackTrace) ?? 'no-frame';
  const raw = `${normalizedMessage}|${keyFrame}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
