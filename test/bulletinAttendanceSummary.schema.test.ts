import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const serverText = fs.readFileSync(path.resolve('src/lib/bulletinPdfApi.ts'), 'utf8');
const readText = fs.readFileSync(path.resolve('src/lib/bulletinReadApi.ts'), 'utf8');
const detailText = fs.readFileSync(path.resolve('src/components/bulletins/BulletinDetail.tsx'), 'utf8');

describe('bulletin attendance summary contract', () => {
  it('renders zero values in the requested French format', () => {
    expect(serverText).toContain('`Retard : ${data.retards} min`');
    expect(serverText).toContain('`Absences : ${data.absences}`');
    expect(detailText).toContain('Retard : {detail.retards} min');
    expect(detailText).toContain('Absences : {detail.absences}');
  });

  it('sums lateArrivals.lateMinutes for the student and class inside the term', () => {
    expect(serverText).toContain('coalesce(sum(${lateArrivals.lateMinutes}), 0)::int');
    expect(serverText).toContain('eq(lateArrivals.studentId, header.studentId)');
    expect(serverText).toContain('eq(lateArrivals.classId, header.classId)');
    expect(serverText).toContain('${lateArrivals.date} >= ${header.termStartDate}');
    expect(serverText).toContain('${lateArrivals.date} <= ${header.termEndDate}');
  });

  it('counts only the workflow-defined unjustified absences in the term', () => {
    const condition = "${absences.justificationStatus} = 'REJECTED'";
    const legacyFallback = '${absences.justificationStatus} is null and ${absences.isJustified} = false';
    expect(serverText).toContain(condition);
    expect(serverText).toContain(legacyFallback);
    expect(readText).toContain(condition);
    expect(readText).toContain(legacyFallback);
  });

  it('excludes approved, justified, pending, and out-of-period absences', () => {
    expect(serverText).not.toContain("${absences.justificationStatus} = 'APPROVED'");
    expect(serverText).toContain('${absences.date} >= ${header.termStartDate}');
    expect(serverText).toContain('${absences.date} <= ${header.termEndDate}');
    expect(readText).toContain('${absences.date} >= ${header.termStartDate}');
    expect(readText).toContain('${absences.date} <= ${header.termEndDate}');
  });

  it('uses the bulletin term dates and keeps both web and PDF outputs aligned', () => {
    expect(serverText).toContain('termStartDate: schoolTerms.startDate');
    expect(serverText).toContain('termEndDate: schoolTerms.endDate');
    expect(readText).toContain('termStartDate: schoolTerms.startDate');
    expect(readText).toContain('termEndDate: schoolTerms.endDate');
    expect(detailText).toContain('detail.retards');
    expect(detailText).toContain('detail.absences');
  });

  it('does not introduce a new database field or migration for the summary', () => {
    expect(serverText).toContain('lateArrivals.lateMinutes');
    expect(serverText).not.toContain('ALTER TABLE late_arrivals');
    expect(readText).not.toContain('ALTER TABLE late_arrivals');
  });

  it('keeps the titular block after the summary table', () => {
    expect(serverText.indexOf('`Retard : ${data.retards} min`')).toBeLessThan(serverText.indexOf('Signature du titulaire de la classe'));
    expect(detailText.indexOf('Retard : {detail.retards} min')).toBeLessThan(detailText.indexOf('Signature du titulaire de la classe'));
  });
});