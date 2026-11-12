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
  it('prepares a parent push with the late-arrival target and event metadata', () => {
    const createRoute = routeBody(
      "app.post('/api/late-arrivals', requireAuth,",
      "app.put('/api/late-arrivals/:id', requireAuth,",
    );

    expect(createRoute).toContain("const notificationTitle = `Retard enregistré pour ${student.firstName}`");
    expect(createRoute).toContain("category: 'absence'");
    expect(createRoute).toContain("target: 'late-arrival'");
    expect(createRoute).toContain('lateArrivalId: inserted.id');
    expect(createRoute).toContain('dedupeKey: `late-arrival-${inserted.id}`');
    expect(createRoute).toContain('/api/internal/absence-notification');
    expect(createRoute).toContain('signInternalPayload(notificationPayload)');
  });

  it('exposes parent submission and scoped consultation routes', () => {
    expect(serverText).toMatch(/app\.post\(\s*['"]\/api\/late-arrivals\/:id\/justification['"]/);
    expect(serverText).toContain("app.get('/api/late-arrival-justifications'");
    expect(serverText).toContain("app.get('/api/late-arrivals/:id/justification'");
    expect(serverText).toContain('getParentChildStudentIds(actor.id, actor.schoolId)');
    expect(serverText).toContain('createLateArrivalJustificationAccessChecker(actor');
    expect(serverText).toContain('lateArrivalJustificationFiles');
  });

  it('uses the same Web submission transaction for direct and mobile parent submissions', () => {
    const submission = routeBody(
      'const createLateArrivalJustificationSubmission =',
      "'/api/late-arrivals/:id/justification',",
    );
    const internalRoute = routeBody(
      "'/api/internal/late-arrival-justification',",
      "'/api/internal/late-arrival-justification-file',",
    );

    expect(submission).toContain(".for('update')");
    expect(submission).toContain('lateArrivalJustificationEvents');
    expect(submission).toContain('lateArrivalJustificationFiles');
    expect(submission).toContain("status: 'PENDING'");
    expect(internalRoute).toContain('handleInternalLateArrivalJustificationUpload');
    expect(internalRoute).toContain('verifyInternalLateArrivalJustificationAuth');
    expect(internalRoute).toContain("parent.role !== 'parent'");
    expect(internalRoute).toContain('createLateArrivalJustificationAccessChecker(actor)');
    expect(internalRoute).toContain('createLateArrivalJustificationSubmission(');
    expect(internalRoute).toContain('const uploadedFiles = Array.isArray(req.files)');
    expect(internalRoute).not.toContain('uploadedFiles.length === 0');
    expect(internalRoute).not.toContain('createLateArrivalDecisionNotification');
  });

  it('scopes mobile justification downloads to both the parent and the late-arrival file', () => {
    const downloadRoute = routeBody(
      "app.post('/api/internal/late-arrival-justification-file'",
      "app.post('/api/internal/absence-justification'",
    );
    expect(downloadRoute).toContain('verifyInternalSignedPayload');
    expect(downloadRoute).toContain("parent.role !== 'parent'");
    expect(downloadRoute).toContain('createLateArrivalJustificationAccessChecker(actor, true)');
    expect(downloadRoute).toContain('eq(lateArrivalJustificationFiles.id, fileId)');
    expect(downloadRoute).toContain('eq(lateArrivalJustificationFiles.justificationId, justification.id)');
    expect(downloadRoute).toContain("streamStoredFileToResponse(");
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
    expect(reviewRoute).toContain(
      'createLateArrivalDecisionNotification(tx, context, updated, revision, transition.action)',
    );
    expect(reexamineRoute).toContain(
      "createLateArrivalDecisionNotification(tx, context, updated, revision, 'REEXAMINED_APPROVED')",
    );
    expect(reviewRoute).toContain('if (!await canAccess(context))');
    expect(reexamineRoute).toContain('if (!await canAccess(context))');
  });

  it('uses revision-based notification idempotency and keeps physical late arrivals intact', () => {
    expect(serverText).toContain('lateArrivalJustificationNotificationKey(justification.id, eventRevision)');
    expect(serverText).toContain('.onConflictDoNothing().returning({ id: notifications.id })');
    expect(serverText).toContain("channel: 'push'");
    expect(serverText).toContain("app.delete('/api/late-arrivals/:id'");
    expect(serverText).toContain("res.status(409).json({ error: 'A late arrival with a justification history cannot be deleted' })");
  });

  it('creates the parent notification and push outbox entry in the decision transaction only once', () => {
    const notificationHelper = routeBody(
      'const createLateArrivalDecisionNotification =',
      'const createLateArrivalReviewAudit =',
    );

    expect(notificationHelper).toContain('context.student.parentId');
    expect(notificationHelper).toContain('eq(parents.id, context.student.parentId)');
    expect(notificationHelper).toContain('dedupeKey,');
    expect(notificationHelper).toContain('.onConflictDoNothing()');
    expect(notificationHelper).toContain('if (notification)');
    expect(notificationHelper).toContain("channel: 'push'");
  });

  it('routes late-arrival decisions through the existing absence notification API', () => {
    const workerStart = serverText.indexOf('function createGroupedPushDeliveryRepository()');
    const workerEnd = serverText.indexOf('const groupedPushDeliveryTransport:', workerStart);
    const worker = serverText.slice(workerStart, workerEnd);

    expect(worker).toContain('dedupeKey: notifications.dedupeKey');
    expect(worker).toContain('isNull(notifications.publicationId)');
    expect(worker).not.toContain('isNotNull(notifications.publicationId)');
    expect(worker).toContain("like(notifications.dedupeKey, 'late-arrival-justification-%')");
    expect(worker).not.toContain('candidate.publicationId == null) continue');

    const transportStart = workerEnd;
    const transportEnd = serverText.indexOf('export async function resolveActor', transportStart);
    const transport = serverText.slice(transportStart, transportEnd);
    expect(transport).toContain('/api/internal/absence-notification');
    expect(transport).not.toContain('/api/internal/evaluation-notification');
    expect(transport).toContain('getInternalNotificationDispatchOutcome(await response.json())');
    expect(transport).toContain('resolveMobileApiBaseUrl(process.env.API_URL, process.env.NODE_ENV)');
    expect(transport).not.toContain('localhost:3001');
    expect(serverText).not.toContain('isGroupedPushDeliveryEnabled(process.env)');
  });
});
