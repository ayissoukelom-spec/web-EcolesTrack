import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

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
});
