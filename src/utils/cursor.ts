/**
 * An opaque pagination cursor - the client just passes back whatever
 * `nextCursor` it was given, never constructs one itself. Base64 of a
 * small JSON object is enough; this doesn't need to be unguessable, just
 * self-describing and tamper-evident enough to reject garbage cleanly.
 */
export interface GroupCursor {
  lastSeen: string;
  id: string;
}

export function encodeCursor(cursor: GroupCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export function decodeCursor(raw: string): GroupCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as GroupCursor).lastSeen === 'string' &&
      typeof (parsed as GroupCursor).id === 'string'
    ) {
      return parsed as GroupCursor;
    }
    return null;
  } catch {
    return null;
  }
}
