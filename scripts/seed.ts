/**
 * Creates a demo user + project + a handful of sample error groups/events
 * directly via the models (not HTTP) so it can run standalone against a
 * fresh DB with no running API needed.
 *
 * Usage: tsx scripts/seed.ts
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../src/config/database';
import { UserModel } from '../src/models/User';
import { ProjectModel } from '../src/models/Project';
import { ErrorGroupModel } from '../src/models/ErrorGroup';
import { ErrorEventModel } from '../src/models/ErrorEvent';

const DEMO_EMAIL = 'demo@errsight.dev';
const DEMO_PASSWORD = 'demopassword123';

const SAMPLE_ERRORS = [
  {
    title: "TypeError: Cannot read properties of undefined (reading 'id')",
    errorType: 'TypeError',
    level: 'error' as const,
    eventCount: 47,
    message: "TypeError: Cannot read properties of undefined (reading 'id')",
    stack: 'at getCurrentUser (/app/src/auth/session.js:23:15)',
  },
  {
    title: 'Error: Payment gateway timeout after 30000ms',
    errorType: 'Error',
    level: 'error' as const,
    eventCount: 12,
    message: 'Error: Payment gateway timeout after 30000ms',
    stack: 'at processPayment (/app/src/billing/charge.js:88:9)',
  },
  {
    title: 'Warning: deprecated API endpoint /v1/users called',
    errorType: undefined,
    level: 'warning' as const,
    eventCount: 203,
    message: 'Warning: deprecated API endpoint /v1/users called',
    stack: 'at legacyRouter (/app/src/routes/legacy.js:10:3)',
  },
];

async function seed() {
  console.log('Seeding demo data...');

  let user = await UserModel.findByEmail(DEMO_EMAIL);
  if (!user) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    user = await UserModel.create({
      email: DEMO_EMAIL,
      passwordHash,
      name: 'Demo User',
    });
    // Skip the verification flow for the seeded demo account - there's no
    // real inbox to click a link from.
    user = (await UserModel.markEmailVerified(user.id)) ?? user;
    console.log(`Created demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } else {
    console.log(`Demo user already exists: ${DEMO_EMAIL}`);
  }

  const existingProjects = await ProjectModel.findByOwner(user.id);
  let project = existingProjects.find((p) => p.name === 'Demo Project');
  if (!project) {
    project = await ProjectModel.create({ name: 'Demo Project', ownerId: user.id });
    console.log(`Created demo project: ${project.name} (api_key: ${project.api_key})`);
  } else {
    console.log(`Demo project already exists (api_key: ${project.api_key})`);
  }

  for (const sample of SAMPLE_ERRORS) {
    const fingerprint = crypto
      .createHash('sha256')
      .update(sample.title)
      .digest('hex')
      .slice(0, 16);

    let group = await ErrorGroupModel.findByFingerprint(project.id, fingerprint);
    if (!group) {
      const created = await ErrorGroupModel.create({
        projectId: project.id,
        fingerprint,
        title: sample.title,
        errorType: sample.errorType,
        level: sample.level,
      });
      // create() returns null only on a fingerprint conflict (a concurrent
      // insert) - not expected here since this script runs single-threaded
      // and we just checked findByFingerprint above, but handle it rather
      // than assume.
      if (!created) {
        throw new Error(`Failed to create error group for "${sample.title}" (unexpected conflict)`);
      }
      group = created;

      // Back-fill a handful of individual events and bump the counter to
      // match eventCount, so the dashboard has something to show per group.
      const eventsToCreate = Math.min(sample.eventCount, 5);
      for (let i = 0; i < eventsToCreate; i++) {
        await ErrorEventModel.create({
          eventId: crypto.randomUUID(),
          errorGroupId: group.id,
          projectId: project.id,
          message: sample.message,
          stackTrace: sample.stack,
          level: sample.level,
          environment: 'production',
        });
      }
      // create() leaves event_count at its DB default of 0 - one bulk
      // increment instead of eventCount sequential round-trips (the
      // busiest sample here is 203 - that was 203 awaited UPDATEs).
      await ErrorGroupModel.incrementEventCount(group.id, sample.eventCount);

      console.log(`Created error group: "${sample.title}" (${sample.eventCount} events)`);
    } else {
      console.log(`Error group already exists: "${sample.title}"`);
    }
  }

  console.log('\nSeed complete. Log in with:');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
