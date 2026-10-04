import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { absences } from '../src/db/schema.ts';

describe('absence justification workflow contract', () => {
  it('keeps legacy absence fields and exposes workflow fields', () => {
    expect(absences).toBeDefined();
    const schemaText = fs.readFileSync(path.resolve('src/db/schema.ts'), 'utf8');
    expect(schemaText).toContain("justificationStatus: text('justification_status')");
    expect(schemaText).toContain("rejectionReason: text('rejection_reason')");
    expect(schemaText).toContain("reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' })");
    expect(schemaText).toContain("reviewedAt: timestamp('reviewed_at')");
    expect(schemaText).toContain("isJustified: boolean('is_justified').default(false).notNull()");
    expect(schemaText).toContain("justificationReason: text('justification_reason')");
  });

  it('defines pending submission and protected review transitions', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    expect(serverText).toContain("app.put('/api/absences/:id/justification/review'");
    expect(serverText).toContain("justificationStatus: 'PENDING'");
    expect(serverText).toContain("justificationStatus: status");
    expect(serverText).toContain("if (actor.role === 'parent') return res.status(403)");
    expect(serverText).toContain("if (status === 'REJECTED' && !rejectionReason)");
    expect(serverText).toContain("isJustified: status === 'APPROVED'");
    expect(serverText).toContain("Justification d'absence validée");
    expect(serverText).toContain("Justification d'absence rejetée");
    expect(serverText).toContain("category: 'absence'");
    expect(serverText).toContain("dedupeKey: `absence-justification-review-");
    expect(serverText).toContain("isAlreadyFinalAndEquivalent");
  });

  it('keeps text-only mobile submissions pending and the attachment path separate', () => {
    const mobileRoot = path.resolve('..', 'Nouveau dossier (2)');
    const mobileServerText = fs.readFileSync(path.join(mobileRoot, 'server.ts'), 'utf8');
    const uploadCleanupText = fs.readFileSync(path.join(mobileRoot, 'backend', 'temporaryUploadCleanup.ts'), 'utf8');
    const mobileStoreText = fs.readFileSync(path.join(mobileRoot, 'backend/store.ts'), 'utf8');
    const mobileJustificationText = fs.readFileSync(path.join(mobileRoot, 'backend/absenceJustification.ts'), 'utf8');
    const parentPortalText = fs.readFileSync(path.join(mobileRoot, 'src/components/ParentPortal.tsx'), 'utf8');

    expect(mobileServerText).toContain('store.justifyAbsence(absenceId, parentId, justificationReason.trim())');
    expect(mobileStoreText).toContain('submitAbsenceJustificationForReview(dbQuery, absenceId, parentId, justificationReason)');
    expect(mobileJustificationText).toContain("justification_status = 'PENDING'");
    expect(mobileJustificationText).toContain('is_justified = false');
    expect(parentPortalText).toContain('const hasAttachments = justificationAttachments.length > 0');
    expect(parentPortalText).toContain('hasAttachments ? "/justifications" : "/justify"');
    expect(parentPortalText).toContain('{!justificationStatus && (');
    expect(parentPortalText).not.toContain('{(!justificationStatus || isRejected) && (');
    expect(parentPortalText).toContain('Veuillez vous présenter à l’établissement avec les justificatifs nécessaires.');
    expect(mobileServerText).toContain('forwardAbsenceJustificationToWeb(id, parentId, justificationReason, uploadedFile)');
    expect(mobileServerText).toContain('err instanceof AbsenceJustificationAlreadyRejectedError');
    expect(mobileServerText).toContain('res.status(409).json({ error: err.message, code: err.code })');
    expect(mobileServerText).toContain('withTemporaryUploadCleanup(uploadedFiles, uploadStorageDir');
    expect(uploadCleanupText).toContain('finally {');
    expect(uploadCleanupText).toContain('if (path.dirname(filePath) !== root) return;');
    expect(uploadCleanupText).toContain('await fsPromises.unlink(filePath)');
  });

  it('guards the web text, direct-file and internal-file submission endpoints', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    expect(serverText).toContain("justificationStatus === 'REJECTED'");
    expect(serverText).toContain("sql\`${absences.justificationStatus} IS DISTINCT FROM 'REJECTED'\`");
    expect(serverText).toContain("code: 'JUSTIFICATION_ALREADY_REJECTED'");
    expect(serverText).toContain('cleanupUploadedJustificationFiles(fileList)');
    expect(serverText).toContain("app.post('/api/internal/absence-justification'");
    expect(serverText).toContain("app.post('/api/absences/:id/justifications'");
  });
});
