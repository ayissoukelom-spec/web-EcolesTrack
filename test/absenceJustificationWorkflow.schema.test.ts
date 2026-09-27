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
    const mobileStoreText = fs.readFileSync(path.join(mobileRoot, 'backend/store.ts'), 'utf8');
    const mobileJustificationText = fs.readFileSync(path.join(mobileRoot, 'backend/absenceJustification.ts'), 'utf8');
    const parentPortalText = fs.readFileSync(path.join(mobileRoot, 'src/components/ParentPortal.tsx'), 'utf8');

    expect(mobileServerText).toContain('store.justifyAbsence(absenceId, parentId, justificationReason.trim())');
    expect(mobileStoreText).toContain('submitAbsenceJustificationForReview(dbQuery, absenceId, parentId, justificationReason)');
    expect(mobileJustificationText).toContain("justification_status = 'PENDING'");
    expect(mobileJustificationText).toContain('is_justified = false');
    expect(parentPortalText).toContain('const hasAttachments = justificationAttachments.length > 0');
    expect(parentPortalText).toContain('hasAttachments ? "/justifications" : "/justify"');
    expect(mobileServerText).toContain('forwardAbsenceJustificationToWeb(id, parentId, justificationReason, uploadedFile)');
  });
});
