import { describe, it, expect } from 'vitest';
import { lateArrivals } from '../src/db/schema.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('late arrivals schema', () => {
  it('exposes the late_arrivals table declaration for the dedicated delay flow', () => {
    expect(lateArrivals).toBeDefined();
  });

  it('keeps the late-arrival API and its uniqueness rule aligned with the attendance flow', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    expect(serverText).toContain("/api/late-arrivals");
    expect(serverText).toContain('lateArrivals');
    expect(serverText).toContain('A late arrival already exists for this student/class/date/period');
    expect(serverText).toContain('expectedStartTime');
    expect(serverText).toContain('Math.max(0, arrivalMinutes - expectedMinutes)');
    expect(serverText).not.toContain('const { studentId, classId, date, period, arrivalTime, lateMinutes, reason } = req.body');
  });

  it('keeps the late-arrival notification contract on the existing absence channel', () => {
    const serverText = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    const creationStart = serverText.indexOf("app.post('/api/late-arrivals'");
    const creationEnd = serverText.indexOf("app.put('/api/late-arrivals/:id'", creationStart);
    const creationRoute = serverText.slice(creationStart, creationEnd);

    expect(creationRoute).toContain("await db.insert(lateArrivals).values");
    expect(creationRoute).toContain("await db.select({ userId: parents.userId }).from(parents).where(eq(parents.id, student.parentId))");
    expect(creationRoute).toContain("title: notificationTitle");
    expect(creationRoute).toContain("body: notificationBody");
    expect(creationRoute).toContain('Retard enregistré pour ${student.firstName}');
    expect(creationRoute).toContain('Un retard de ${inserted.lateMinutes} minutes');
    expect(creationRoute).toContain('target: \'late-arrival\'');
    expect(creationRoute).toContain('lateArrivalId: inserted.id');
    expect(creationRoute).toContain('dedupeKey: `late-arrival-${inserted.id}`');
    expect(creationRoute).toContain("/api/internal/absence-notification");
    expect(creationRoute).toContain("category: 'absence'");
    expect(creationRoute.indexOf("await db.insert(lateArrivals).values")).toBeLessThan(creationRoute.indexOf('const notificationTitle'));
  });
});
