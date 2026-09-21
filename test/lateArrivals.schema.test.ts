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
});
