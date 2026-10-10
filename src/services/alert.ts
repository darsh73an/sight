import { config } from '../config';
import { ErrorGroup } from '../models/ErrorGroup';
import { logger } from '../utils/logger';

/**
 * Fires exactly once per NEW error group - never on repeat occurrences of
 * a group that already exists, or every event would spam the channel.
 * Sends to Slack if a webhook is configured, always logs regardless so
 * nothing is silently dropped in dev/test environments.
 */
export async function sendAlert(projectId: string, group: ErrorGroup): Promise<void> {
  logger.warn('New error group detected', {
    projectId,
    groupId: group.id,
    fingerprint: group.fingerprint,
    title: group.title,
  });

  if (!config.alerts.slackWebhookUrl) {
    return;
  }

  try {
    await fetch(config.alerts.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:rotating_light: New error group in project ${projectId}\n*${group.title}*\nfingerprint: \`${group.fingerprint}\``,
      }),
    });
  } catch (err) {
    // Don't let a broken webhook fail the job - the event is already
    // saved, the alert is best-effort on top of it.
    logger.error('Slack alert delivery failed', err);
  }
}
