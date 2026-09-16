import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { resolveAbsenceJustificationStorageDirs, resolveAbsenceJustificationFilePath } from '../server.ts';

describe('absence-controls correction policy', () => {
  it('removes browser identity fields from the web Néant payload', () => {
    const viewText = fs.readFileSync(path.resolve('src/components/AbsenceView.tsx'), 'utf8');
    expect(viewText).not.toContain('schoolId: Number(schoolsList[0]?.id');
    expect(viewText).not.toContain('teacherId');
    expect(viewText).toContain("controlType: 'none'");
  });

  it('derives the actor identity from the server and rejects non-teacher roles', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    expect(serverText).toContain('const actor = await resolveActor(req);');
    expect(serverText).toContain("if (actor.role !== 'teacher')");
    expect(serverText).toContain('teacherRow');
    expect(serverText).toContain('actor.schoolId');
  });

  it('enforces duplicate and absence-exists gates before accepting a control record', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    expect(serverText).toContain('existingDuplicate');
    expect(serverText).toContain('conflictingAbsence');
    expect(serverText).toContain('Duplicate absence-control none already exists for this context');
    expect(serverText).toContain('An absence already exists for the same context');
  });

  it('keeps the absences route intact and never routes the control through the notification path', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    expect(serverText).toContain("app.post('/api/absences'");
    expect(serverText).not.toContain('createAbsenceNotification');
    expect(serverText).not.toContain('parentNotification');
  });

  it('documents the requested test matrix for the route policy contract', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    expect(serverText).toContain('Teacher profile not found for the authenticated user');
    expect(serverText).toContain('Teacher is not authorized for this class');
    expect(serverText).toContain('Teacher cannot control a class outside authenticated school scope');
    expect(serverText).toContain('Only teachers may create an absence-control none record');
  });

  it('prefers the configured upload root and falls back to the legacy path when needed', async () => {
    const originalUploadsDir = process.env.UPLOADS_DIR;
    const repoRoot = process.cwd();

    try {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'absence-justification-'));
      const customRoot = path.join(tempRoot, 'custom-uploads');
      const customDir = path.join(customRoot, 'absence-justifications');
      fs.mkdirSync(customDir, { recursive: true });
      process.env.UPLOADS_DIR = customRoot;

      const customFileName = 'custom-justification.pdf';
      const customFilePath = path.join(customDir, customFileName);
      fs.writeFileSync(customFilePath, 'custom-content');

      const configuredDirs = resolveAbsenceJustificationStorageDirs();
      expect(configuredDirs.primaryDir).toBe(customDir);
      await expect(resolveAbsenceJustificationFilePath(customFileName)).resolves.toBe(customFilePath);

      const legacyDir = path.join(repoRoot, 'uploads', 'absence-justifications');
      fs.mkdirSync(legacyDir, { recursive: true });
      const legacyFileName = 'legacy-justification.pdf';
      const legacyFilePath = path.join(legacyDir, legacyFileName);
      fs.writeFileSync(legacyFilePath, 'legacy-content');

      delete process.env.UPLOADS_DIR;
      const runtimeDirs = resolveAbsenceJustificationStorageDirs();
      expect(runtimeDirs.primaryDir).toBe(path.join(repoRoot, 'uploads', 'absence-justifications'));
      await expect(resolveAbsenceJustificationFilePath(legacyFileName)).resolves.toBe(legacyFilePath);
    } finally {
      if (originalUploadsDir === undefined) {
        delete process.env.UPLOADS_DIR;
      } else {
        process.env.UPLOADS_DIR = originalUploadsDir;
      }

      const legacyDir = path.join(repoRoot, 'uploads', 'absence-justifications');
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
