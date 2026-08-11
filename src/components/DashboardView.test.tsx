import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DashboardView, { normalizeDashboardChartData } from './DashboardView';

describe('normalizeDashboardChartData', () => {
  it('normalizes backend chart rows into the shape required by Recharts', () => {
    const input = [
      { name: '6ème', taux: 87.5 },
      { label: '5ème', value: 92.1 },
      { className: '4ème', attendanceRate: 88 },
    ];

    expect(normalizeDashboardChartData(input)).toEqual([
      { name: '6ème', taux: 87.5 },
      { name: '5ème', taux: 92.1 },
      { name: '4ème', taux: 88 },
    ]);
  });

  it('ignores invalid rows', () => {
    expect(normalizeDashboardChartData([{ name: 'A' }, null, { label: 'B' }, { name: 'C', taux: 120 }])).toEqual([
      { name: 'C', taux: 100 },
    ]);
  });
});

describe('DashboardView absence status counts', () => {
  it('uses the full authorized absence scope instead of the 5 most recent rows', () => {
    render(
      <DashboardView
        stats={{ totalStudents: 8, totalAbsences: 8, totalClasses: 2, totalTeachers: 2, attendanceRate: 92.5, maleStudents: 4, femaleStudents: 4 }}
        recentAbsences={Array.from({ length: 5 }, (_, index) => ({
          id: index + 1,
          studentName: `Élève ${index + 1}`,
          className: '6A',
          date: '2026-08-10',
          period: 'morning',
          isJustified: index < 4,
        }))}
        recentGrades={[]}
        userRole="school_admin"
        absenceStatusCounts={{ justified: 5, unjustified: 3 }}
      />
    );

    const justifiedRow = screen.getByText('Justifiées').closest('div')?.parentElement;
    const unjustifiedRow = screen.getByText('Non Justifiées').closest('div')?.parentElement;

    expect(justifiedRow).not.toBeNull();
    expect(unjustifiedRow).not.toBeNull();
    expect(justifiedRow && within(justifiedRow).getByText('5')).toBeTruthy();
    expect(unjustifiedRow && within(unjustifiedRow).getByText('3')).toBeTruthy();
  });
});
