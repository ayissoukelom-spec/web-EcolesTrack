import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');

function routeBody(start: string, end: string): string {
  const startIndex = serverText.indexOf(start);
  const endIndex = serverText.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return serverText.slice(startIndex, endIndex);
}

describe('late-arrival justification API contract', () => {
  it('exposes parent submission and scoped consultation routes', () => {
    expect(serverText).toMatch(/app\.post\(\s*['"]\/api\/late-arrivals\/:id\/justification['"]/);
    expect(serverText).toContain("app.get('/api/late-arrival-justifications'");
    expect(serverText).toContain("app.get('/api/late-arrivals/:id/justification'");
    expect(serverText).toContain('getParentChildStudentIds(actor.id, actor.schoolId)');
    expect(serverText).toContain('createLateArrivalJustificationAccessChecker(actor');
    expect(serverText).toContain('lateArrivalJustificationFiles');
  });

  it('locks each decision and records its state change and notification in one transaction', () => {
    const reviewRoute = routeBody(
      "app.put('/api/late-arrivals/:id/justification/review'",
      "app.put('/api/late-arrivals/:id/justification/reexamine'",
    );
    const reexamineRoute = routeBody(
      "app.put('/api/late-arrivals/:id/justification/reexamine'",
      "app.get('/api/absences'",
    );

    for (const route of [reviewRoute, reexamineRoute]) {
      expect(route).toContain('db.transaction(async (tx)');
      expect(route).toContain('.for(\'update\')');
      expect(route).toContain('planLateArrivalJustificationTransition');
      expect(route).toContain('lateArrivalJustificationEvents');
      expect(route).toContain('createLateArrivalDecisionNotification');
      expect(route).toContain('eq(lateArrivalJustifications.revision, justification.revision)');
    }

    expect(reviewRoute).toContain("['teacher', 'school_admin', 'surveillant']");
    expect(reexamineRoute).toContain("['school_admin', 'surveillant']");
  });

  it('uses revision-based notification idempotency and keeps physical late arrivals intact', () => {
    expect(serverText).toContain('lateArrivalJustificationNotificationKey(justification.id, eventRevision)');
    expect(serverText).toContain('.onConflictDoNothing().returning({ id: notifications.id })');
    expect(serverText).toContain("channel: 'push'");
    expect(serverText).toContain("app.delete('/api/late-arrivals/:id'");
    expect(serverText).toContain("res.status(409).json({ error: 'A late arrival with a justification history cannot be deleted' })");
  });

  it('claims null-publication outbox rows only for late-arrival justification notifications', () => {
    const workerStart = serverText.indexOf('function createGroupedPushDeliveryRepository()');
    const workerEnd = serverText.indexOf('const groupedPushDeliveryTransport:', workerStart);
    const worker = serverText.slice(workerStart, workerEnd);

    expect(worker).toContain('dedupeKey: notifications.dedupeKey');
    expect(worker).toContain('isNotNull(notifications.publicationId)');
    expect(worker).toContain('isNull(notifications.publicationId)');
    expect(worker).toContain("like(notifications.dedupeKey, 'late-arrival-justification-%')");
    expect(worker).not.toContain('candidate.publicationId == null) continue');

    const transportStart = workerEnd;
    const transportEnd = serverText.indexOf('export async function resolveActor', transportStart);
    const transport = serverText.slice(transportStart, transportEnd);
    expect(transport).toContain('/api/internal/evaluation-notification');
    expect(transport).not.toContain('/api/internal/absence-notification');
    expect(transport).toContain('buildGroupedPushNotificationPayload(delivery, idempotencyKey)');
  });
});
