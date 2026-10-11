import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DashboardView, { normalizeDashboardChartData } from './DashboardView';

afterEach(() => cleanup());

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

describe('DashboardView gender distribution', () => {
  it.each([
    [4, 4],
    [1234, 5678],
    [12345, 67890],
    [12345678, 87654321],
  ])('preserves %s and %s with intrinsic responsive sizing', (maleStudents, femaleStudents) => {
    const { container } = render(
      <DashboardView
        stats={{
          totalStudents: maleStudents + femaleStudents,
          totalAbsences: 0,
          totalClasses: 1,
          totalTeachers: 1,
          attendanceRate: 100,
          maleStudents,
          femaleStudents,
        }}
        recentAbsences={[]}
        recentGrades={[]}
        userRole="school_admin"
      />
    );

    const genderCard = container.querySelector<HTMLElement>('#card-stats-gender');
    expect(genderCard).not.toBeNull();
    if (!genderCard) throw new Error('Gender distribution card was not rendered');

    const numberLayout = genderCard.querySelector<HTMLElement>('.flex.flex-wrap');
    expect(numberLayout).not.toBeNull();
    if (!numberLayout) throw new Error('Gender number layout was not rendered');

    const [maleNumber, femaleNumber] = Array.from(numberLayout.querySelectorAll<HTMLElement>('p.text-3xl'));
    if (!maleNumber || !femaleNumber) throw new Error('Both gender counts were not rendered');

    expect(maleNumber.textContent).toBe(String(maleStudents));
    expect(femaleNumber.textContent).toBe(String(femaleStudents));
    expect(maleNumber.classList.contains('text-3xl')).toBe(true);
    expect(femaleNumber.classList.contains('text-3xl')).toBe(true);
    expect(maleNumber.classList.contains('break-all')).toBe(true);
    expect(femaleNumber.classList.contains('break-all')).toBe(true);
    expect(genderCard.classList.contains('min-w-0')).toBe(true);
    expect(genderCard.classList.contains('sm:col-span-2')).toBe(true);
    expect(Array.from(numberLayout.children)).toHaveLength(2);
    expect(Array.from(numberLayout.children).every((tile) => tile.classList.contains('flex-[1_1_max-content]'))).toBe(true);
  });
});

describe('DashboardView attendance rate', () => {
  it.each([
    [92.5, '92.5%'],
    [1234567890, '1234567890%'],
  ])('keeps the rate content visible for %s', (attendanceRate, expectedRate) => {
    const { container } = render(
      <DashboardView
        stats={{
          totalStudents: 0,
          totalAbsences: 0,
          totalClasses: 0,
          totalTeachers: 0,
          attendanceRate,
        }}
        recentAbsences={[]}
        recentGrades={[]}
        userRole="school_admin"
      />
    );

    const rateCard = container.querySelector<HTMLElement>('#card-stats-rate');
    expect(rateCard).not.toBeNull();
    if (!rateCard) throw new Error('Attendance rate card was not rendered');

    expect(within(rateCard).getByText('Taux de Fréquentation')).toBeTruthy();
    expect(within(rateCard).getByText(expectedRate, { exact: true }).classList.contains('text-4xl')).toBe(true);
    expect(within(rateCard).getByText('Taux moyen de présence')).toBeTruthy();
    expect(rateCard.querySelector('svg.lucide-percent')).not.toBeNull();

    const contentRow = rateCard.querySelector<HTMLElement>('.flex.flex-wrap');
    expect(contentRow).not.toBeNull();
    if (!contentRow) throw new Error('Attendance rate content row was not rendered');

    const textContent = contentRow.querySelector<HTMLElement>('.min-w-0');
    const iconContainer = contentRow.querySelector<HTMLElement>('.shrink-0');
    expect(textContent?.classList.contains('flex-[1_1_12rem]')).toBe(true);
    expect(textContent?.querySelector('.break-all')).not.toBeNull();
    expect(textContent?.querySelector('.break-words')).not.toBeNull();
    expect(iconContainer).not.toBeNull();
  });
});

describe('DashboardView class age statistics', () => {
  it('shows the rounded average, included count, distribution, and reference date', () => {
    render(
      <DashboardView
        stats={{ totalStudents: 2, totalAbsences: 0, totalClasses: 1, totalTeachers: 1, attendanceRate: 92.5 }}
        recentAbsences={[]}
        recentGrades={[]}
        userRole="school_admin"
        chartData={[{ name: '6ème A', taux: 92.5 }]}
        ageStatsAsOf="2026-10-11"
        ageStatsByClass={[{
          schoolId: 10,
          classId: 5,
          className: '6ème A',
          averageAge: 16,
          includedStudents: 2,
          distribution: [{ age: 15, count: 1 }, { age: 16, count: 1 }],
        }]}
      />
    );

    const ageSection = screen.getByRole('region', { name: 'Âges des élèves par classe' });
    expect(within(ageSection).getByText('Âge calculé au 2026-10-11 (UTC) · élèves actifs affectés à une classe')).toBeTruthy();
    expect(within(ageSection).getByText('Âge moyen :', { exact: false }).textContent).toContain('16 ans');
    expect(within(ageSection).getByText('Effectif pris en compte : 2')).toBeTruthy();
    expect(within(ageSection).getByText('Répartition : 15 ans : 1 · 16 ans : 1')).toBeTruthy();
    expect(screen.getByText('Fréquentation par Division (%)')).toBeTruthy();
    expect(screen.getByText('92.5%')).toBeTruthy();
  });

  it('shows an explicit message when a class has no usable birth dates', () => {
    render(
      <DashboardView
        stats={{ totalStudents: 1, totalAbsences: 0, totalClasses: 1, totalTeachers: 1, attendanceRate: 100 }}
        recentAbsences={[]}
        recentGrades={[]}
        ageStatsByClass={[{
          schoolId: 10,
          classId: 5,
          className: '6ème A',
          averageAge: null,
          includedStudents: 0,
          distribution: [],
        }]}
      />
    );

    expect(screen.getByText('Aucune date de naissance exploitable. Effectif pris en compte : 0.')).toBeTruthy();
    expect(screen.queryByText(/Âge moyen :/)).toBeNull();
  });
});

describe('DashboardView absence status counts', () => {
  it('shows login statistics only for super admins', () => {
    const loginStats = {
      totalLogins: 12,
      uniqueUsers: 8,
      webLogins: 7,
      androidLogins: 5,
      loginsByDay: [{ date: '2026-09-24', total: 12, web: 7, android: 5 }],
      loginsByRole: [{ role: 'parent', total: 12 }],
    };

    const { rerender } = render(
      <DashboardView
        stats={{ totalStudents: 0, totalAbsences: 0, totalClasses: 0, totalTeachers: 0, attendanceRate: 100 }}
        recentAbsences={[]}
        recentGrades={[]}
        userRole="super_admin"
        loginStats={loginStats}
      />
    );

    expect(screen.getAllByText('Connexions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getByText('Utilisateurs uniques')).toBeTruthy();

    rerender(
      <DashboardView
        stats={{ totalStudents: 0, totalAbsences: 0, totalClasses: 0, totalTeachers: 0, attendanceRate: 100 }}
        recentAbsences={[]}
        recentGrades={[]}
        userRole="school_admin"
        loginStats={loginStats}
      />
    );

    expect(screen.queryByText('Utilisateurs uniques')).toBeNull();
  });

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

  it('counts absences linked to parental declarations separately from unjustified absences', () => {
    render(
      <DashboardView
        stats={{ totalStudents: 3, totalAbsences: 3, totalClasses: 1, totalTeachers: 1, attendanceRate: 0 }}
        recentAbsences={[
          { id: 1, isJustified: false, declarationId: 8 },
          { id: 2, isJustified: false },
          { id: 3, isJustified: true },
        ]}
        recentGrades={[]}
        userRole="school_admin"
        absenceStatusCounts={{ justified: 1, unjustified: 1, pending: 0, declared: 1 }}
      />
    );

    const declaredRow = screen.getByText('Déclarées par un parent').closest('.flex.justify-between');
    const unjustifiedRow = screen.getByText('Non Justifiées').closest('.flex.justify-between');

    expect(declaredRow && within(declaredRow).getByText('1')).toBeTruthy();
    expect(unjustifiedRow && within(unjustifiedRow).getByText('1')).toBeTruthy();
  });

  it('hides recent grades for surveillant while keeping the dashboard visible', () => {
    render(
      <DashboardView
        stats={{ totalStudents: 1, totalAbsences: 0, totalClasses: 1, totalTeachers: 1, attendanceRate: 100 }}
        recentAbsences={[]}
        recentGrades={[{ id: 1, studentName: 'Eleve Test', subject: 'Math', score: '15' }]}
        userRole="surveillant"
      />
    );

    expect(screen.getAllByText('Tableau de Bord Général').length).toBeGreaterThan(0);
    expect(screen.queryByText('Dernières Évaluations & Notes')).toBeNull();
    expect(screen.queryByText('Eleve Test')).toBeNull();
  });
});
