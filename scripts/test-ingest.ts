/**
 * Sends 5 test events through the real ingestion endpoint, waits for the
 * worker to process them, then checks Postgres directly: 3 identical
 * events + 2 same-pattern-different-data events should collapse into
 * exactly 2 error_groups.
 *
 * Usage:
 *   tsx scripts/test-ingest.ts <projectId> <apiKey>
 *
 * Requires: api running on API_BASE_URL (default http://localhost:4000),
 * worker running, Postgres reachable via DATABASE_URL.
 */
import { query, pool } from '../src/config/database';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const POLL_ATTEMPTS = 10;
const POLL_DELAY_MS = 500;

interface TestEvent {
  message: string;
  stack?: string;
}

// 3 identical -> group A. 2 same-pattern (digits differ) -> group B after
// fingerprint normalization. Total expected: 2 groups.
const EVENTS: TestEvent[] = [
  {
    message: "TypeError: Cannot read properties of undefined (reading 'name')",
    stack: 'at getUserName (/app/src/services/user.js:42:10)',
  },
  {
    message: "TypeError: Cannot read properties of undefined (reading 'name')",
    stack: 'at getUserName (/app/src/services/user.js:42:10)',
  },
  {
    message: "TypeError: Cannot read properties of undefined (reading 'name')",
    stack: 'at getUserName (/app/src/services/user.js:42:10)',
  },
  {
    message: 'Error: user 42 not found',
    stack: 'at findUser (/app/src/services/user.js:88:5)',
  },
  {
    message: 'Error: user 99 not found',
    stack: 'at findUser (/app/src/services/user.js:88:5)',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendEvent(apiKey: string, event: TestEvent): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ingest failed (${res.status}): ${body}`);
  }
}

async function countGroups(projectId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM error_groups WHERE project_id = $1',
    [projectId]
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

async function main() {
  const [projectId, apiKey] = process.argv.slice(2);

  if (!projectId || !apiKey) {
    console.error('Usage: tsx scripts/test-ingest.ts <projectId> <apiKey>');
    process.exit(1);
  }

  // Baseline BEFORE sending anything - the project may already have other
  // groups (e.g. if you ran `npm run seed` against this same project, as
  // the README's own walkthrough does). Asserting an absolute count of 2
  // would wrongly FAIL in that case; the delta this run actually caused
  // is what matters.
  const groupsBefore = await countGroups(projectId);

  console.log(`Sending ${EVENTS.length} test events to ${API_BASE_URL}/api/ingest ...`);
  for (const event of EVENTS) {
    await sendEvent(apiKey, event);
  }
  console.log('All 5 events accepted by the API. Waiting for the worker to process them...');

  // Poll instead of a fixed sleep - the worker processes async, and a
  // fixed delay is either too short (flaky) or wastefully long.
  let groupsAfter = groupsBefore;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    groupsAfter = await countGroups(projectId);
    if (groupsAfter - groupsBefore === 2) break;
    await sleep(POLL_DELAY_MS);
  }

  await pool.end();

  const newGroups = groupsAfter - groupsBefore;
  if (newGroups === 2) {
    console.log(`PASS: this run created exactly 2 new error groups for project ${projectId}`);
    process.exit(0);
  } else {
    console.error(`FAIL: expected 2 new error groups, this run created ${newGroups}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test script errored:', err);
  process.exit(1);
});
