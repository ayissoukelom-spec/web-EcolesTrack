// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeroomClassDetail, HomeroomClassSummary } from '../lib/api.ts';

const fetchHomeroomClass = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.ts', () => ({ fetchMyHomeroomClass: fetchHomeroomClass }));

import HomeroomView from './HomeroomView.tsx';

afterEach(() => {
  cleanup();
  fetchHomeroomClass.mockReset();
});

const homeroomClasses: HomeroomClassSummary[] = [
  { id: 10, name: '6ème A', schoolId: 1, schoolName: 'École A', academicYearId: 2, yearName: '2025-2026', levelId: 1, levelName: 'Sixième', teacherId: 7, teacherName: 'Titulaire' },
  { id: 20, name: '5ème B', schoolId: 1, schoolName: 'École A', academicYearId: 2, yearName: '2025-2026', levelId: 2, levelName: 'Cinquième', teacherId: 7, teacherName: 'Titulaire' },
  { id: 30, name: '2nde C', schoolId: 1, schoolName: 'École A', academicYearId: 2, yearName: '2025-2026', levelId: 3, levelName: 'Seconde', teacherId: 7, teacherName: 'Titulaire' },
];

const detailFor = (classSummary: HomeroomClassSummary): HomeroomClassDetail => ({
  class: {
    ...classSummary,
    schoolAddress: null,
    schoolPhone: null,
    cycleCode: classSummary.id === 30 ? 'lycee' : 'college',
  },
  students: [
    { id: 1, firstName: 'Jean', lastName: 'Dupont', birthDate: null, gender: null, isActive: true, withdrawnAt: null, studentStatus: null, parentId: null, parentName: null, parentEmail: null, parentPhone: null, parentAddress: null },
    { id: 2, firstName: 'Alice', lastName: 'Martin', birthDate: null, gender: null, isActive: true, withdrawnAt: null, studentStatus: null, parentId: null, parentName: null, parentEmail: null, parentPhone: null, parentAddress: null },
  ],
  evaluations: classSummary.id === 10
    ? [
      { id: 101, termId: 1, termName: 'Trimestre 1', periodType: 'trimester', orderIndex: 1, subject: 'Mathématiques', title: 'Devoir de maths T1', date: '2025-10-01', teacherName: 'Prof A' },
      { id: 102, termId: 2, termName: 'Trimestre 2', periodType: 'trimester', orderIndex: 2, subject: 'Français', title: 'Dictée T2', date: '2025-10-02', teacherName: 'Prof B' },
      { id: 103, termId: 3, termName: 'Trimestre 3', periodType: 'trimester', orderIndex: 3, subject: 'Mathématiques', title: 'Interrogation de maths T3', date: '2025-10-03', teacherName: 'Prof C' },
      { id: 104, termId: 2, termName: 'Trimestre 2', periodType: 'trimester', orderIndex: 2, subject: 'Mathématiques', title: 'Devoir de maths T2', date: '2025-10-04', teacherName: 'Prof D' },
    ]
    : classSummary.id === 30
      ? [
        { id: 301, termId: 11, termName: 'Semestre 1', periodType: 'semester', orderIndex: 1, subject: 'Mathématiques', title: 'Devoir de maths S1', date: '2025-10-05', teacherName: 'Prof E' },
        { id: 302, termId: 12, termName: 'Semestre 2', periodType: 'semester', orderIndex: 2, subject: 'Français', title: 'Dissertation S2', date: '2025-10-06', teacherName: 'Prof F' },
      ]
      : [{ id: 201, termId: 4, termName: 'Trimestre 1', periodType: 'trimester', orderIndex: 1, subject: 'Histoire', title: 'Devoir histoire', date: '2025-10-04', teacherName: 'Prof D' }],
  grades: classSummary.id === 10
    ? [
      { id: 1001, evaluationId: 101, studentId: 1, studentName: 'Dupont Jean', subject: 'Mathématiques', evaluationTitle: 'Devoir de maths T1', score: '15' },
      { id: 1002, evaluationId: 102, studentId: 1, studentName: 'Dupont Jean', subject: 'Français', evaluationTitle: 'Dictée T2', score: '14' },
      { id: 1003, evaluationId: 103, studentId: 2, studentName: 'Martin Alice', subject: 'Mathématiques', evaluationTitle: 'Interrogation de maths T3', score: '16' },
      { id: 1004, evaluationId: 104, studentId: 1, studentName: 'Dupont Jean', subject: 'Mathématiques', evaluationTitle: 'Devoir de maths T2', score: '17' },
      { id: 1005, evaluationId: 104, studentId: 2, studentName: 'Martin Alice', subject: 'Mathématiques', evaluationTitle: 'Devoir de maths T2', score: '13' },
    ]
    : classSummary.id === 30
      ? [
        { id: 3001, evaluationId: 301, studentId: 1, studentName: 'Dupont Jean', subject: 'Mathématiques', evaluationTitle: 'Devoir de maths S1', score: '15' },
        { id: 3002, evaluationId: 302, studentId: 2, studentName: 'Martin Alice', subject: 'Français', evaluationTitle: 'Dissertation S2', score: '12' },
      ]
      : [{ id: 2001, evaluationId: 201, studentId: 1, studentName: 'Dupont Jean', subject: 'Histoire', evaluationTitle: 'Devoir histoire', score: '12' }],
  absences: classSummary.id === 10
    ? [{ id: 401, studentId: 1, studentName: 'Dupont Jean', date: '2025-10-07', period: 'Matin', subjectName: 'Mathématiques' }]
    : [],
  lateArrivals: classSummary.id === 10
    ? [{ id: 501, studentId: 2, studentName: 'Martin Alice', date: '2025-10-08', period: 'Matin', lateMinutes: 12, reason: 'Transport' }]
    : [],
  bulletins: [],
  examResults: [],
});

const displayedGradeRows = () => Array.from(
  screen.getAllByRole('table')[1].querySelectorAll('tbody tr'),
  (row) => row.textContent ?? '',
);
const displayedEvaluationRows = () => Array.from(
  screen.getAllByRole('table')[0].querySelectorAll('tbody tr'),
  (row) => row.textContent ?? '',
);

describe('HomeroomView', () => {
  it('renders class information without administrative write actions', async () => {
    fetchHomeroomClass.mockResolvedValue(detailFor(homeroomClasses[0]));
    render(<HomeroomView classes={[homeroomClasses[0]]} />);

    expect(await screen.findByText('6ème A')).toBeTruthy();
    expect(screen.getByText('Consultation en lecture seule')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Élèves et responsables' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ajouter|modifier|supprimer|enregistrer|affecter/i })).toBeNull();
  });

  it('allows selecting only classes returned by the homeroom API', async () => {
    fetchHomeroomClass.mockImplementation(async (classId: number) => detailFor(homeroomClasses.find((item) => item.id === classId)!));
    render(<HomeroomView classes={homeroomClasses} />);

    expect(await screen.findByText('6ème A')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Classe' }), { target: { value: '20' } });

    expect(await screen.findByText('5ème B')).toBeTruthy();
    expect(fetchHomeroomClass).toHaveBeenLastCalledWith(20);
  });

  it('shows absences and late arrivals in separate class sections', async () => {
    fetchHomeroomClass.mockResolvedValue(detailFor(homeroomClasses[0]));
    render(<HomeroomView classes={[homeroomClasses[0]]} />);

    expect(await screen.findByText('6ème A')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Absences' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retards' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Absences et retards' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Absences' }));
    expect(screen.queryByText('Aucune absence.')).toBeNull();
    expect(screen.getByText('Mathématiques')).toBeTruthy();
    const absenceTable = screen.getByRole('table');
    expect(absenceTable.textContent).toContain('Dupont Jean');
    expect(absenceTable.textContent).not.toContain('Martin Alice');
    expect(absenceTable.textContent).not.toContain('Minutes');
    expect(absenceTable.textContent).not.toContain('Transport');

    fireEvent.click(screen.getByRole('button', { name: 'Retards' }));
    expect(screen.queryByText('Aucun retard.')).toBeNull();
    const lateArrivalTable = screen.getByRole('table');
    expect(lateArrivalTable.textContent).toContain('Martin Alice');
    expect(lateArrivalTable.textContent).toContain('12');
    expect(lateArrivalTable.textContent).not.toContain('Dupont Jean');
    expect(lateArrivalTable.textContent).not.toContain('Mathématiques');
  });

  it('filters evaluations and their grades by subjects present in the class evaluations', async () => {
    fetchHomeroomClass.mockImplementation(async (classId: number) =>
      detailFor(homeroomClasses.find((item) => item.id === classId)!));
    render(<HomeroomView classes={homeroomClasses} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Évaluations et notes' }));
    expect(screen.getByRole('combobox', { name: 'Matière' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Élève' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Période' })).toHaveValue('');
    const subjectFilter = screen.getByRole('combobox', { name: 'Matière' });

    expect(subjectFilter.querySelectorAll('option')).toHaveLength(3);
    expect(subjectFilter.querySelector('option')?.textContent).toBe('Toutes les matières');
    expect(displayedEvaluationRows()).toHaveLength(4);
    expect(displayedGradeRows()).toHaveLength(5);

    fireEvent.change(subjectFilter, { target: { value: 'Mathématiques' } });

    expect(displayedEvaluationRows()).toHaveLength(3);
    expect(displayedEvaluationRows().some((row) => row.includes('Dictée T2'))).toBe(false);
    expect(displayedGradeRows()).toHaveLength(4);
    expect(displayedGradeRows().every((row) => row.includes('Mathématiques'))).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Matière' })).toHaveValue('Mathématiques');

    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), { target: { value: '' } });
    expect(displayedEvaluationRows()).toHaveLength(4);
    expect(displayedGradeRows()).toHaveLength(5);
  });

  it('resets the subject filter when another homeroom class is selected', async () => {
    fetchHomeroomClass.mockImplementation(async (classId: number) =>
      detailFor(homeroomClasses.find((item) => item.id === classId)!));
    render(<HomeroomView classes={homeroomClasses} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Évaluations et notes' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), {
      target: { value: 'Mathématiques' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Élève' }), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Période' }), {
      target: { value: 'trimester:3' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Classe' }), { target: { value: '20' } });

    expect(await screen.findAllByText('Devoir histoire')).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: 'Matière' })).toHaveValue('');
    expect(displayedEvaluationRows()).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Élève' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Période' })).toHaveValue('');
    expect(displayedGradeRows()).toHaveLength(1);
  });

  it('filters notes by selected student while keeping class evaluations visible', async () => {
    fetchHomeroomClass.mockResolvedValue(detailFor(homeroomClasses[0]));
    render(<HomeroomView classes={[homeroomClasses[0]]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Évaluations et notes' }));
    const studentFilter = screen.getByRole('combobox', { name: 'Élève' });
    expect(studentFilter.querySelectorAll('option')).toHaveLength(3);
    expect(studentFilter.querySelector('option')?.textContent).toBe('Tous les élèves');
    expect(displayedEvaluationRows()).toHaveLength(4);
    expect(displayedGradeRows().some((row) => row.includes('Dupont Jean'))).toBe(true);
    expect(displayedGradeRows().some((row) => row.includes('Martin Alice'))).toBe(true);

    fireEvent.change(studentFilter, { target: { value: '1' } });

    expect(displayedEvaluationRows()).toHaveLength(4);
    expect(displayedGradeRows()).toHaveLength(3);
    expect(displayedGradeRows().every((row) => row.includes('Dupont Jean'))).toBe(true);
  });

  it('offers and filters the three trimester periods for college classes', async () => {
    fetchHomeroomClass.mockResolvedValue(detailFor(homeroomClasses[0]));
    render(<HomeroomView classes={[homeroomClasses[0]]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Évaluations et notes' }));
    const periodFilter = screen.getByRole('combobox', { name: 'Période' });
    expect(Array.from(periodFilter.querySelectorAll('option')).map((option) => option.textContent)).toEqual([
      'Toutes les périodes', '1er trimestre', '2e trimestre', '3e trimestre',
    ]);
    expect(displayedEvaluationRows().some((row) => row.includes('Dictée T2'))).toBe(true);

    fireEvent.change(periodFilter, { target: { value: 'trimester:1' } });
    expect(displayedEvaluationRows()).toHaveLength(1);
    expect(displayedEvaluationRows()[0]).toContain('Devoir de maths T1');
    expect(displayedGradeRows()).toHaveLength(1);

    fireEvent.change(periodFilter, { target: { value: 'trimester:2' } });
    expect(displayedEvaluationRows()).toHaveLength(2);
    expect(displayedEvaluationRows().some((row) => row.includes('Dictée T2'))).toBe(true);
    expect(displayedEvaluationRows().some((row) => row.includes('Devoir de maths T2'))).toBe(true);
    expect(displayedGradeRows()).toHaveLength(3);

    fireEvent.change(periodFilter, { target: { value: 'trimester:3' } });
    expect(displayedEvaluationRows()).toHaveLength(1);
    expect(displayedEvaluationRows()[0]).toContain('Interrogation de maths T3');
    expect(displayedGradeRows()).toHaveLength(1);
  });

  it('offers and filters the two semester periods for lycée classes', async () => {
    fetchHomeroomClass.mockResolvedValue(detailFor(homeroomClasses[2]));
    render(<HomeroomView classes={[homeroomClasses[2]]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Évaluations et notes' }));
    const periodFilter = screen.getByRole('combobox', { name: 'Période' });
    expect(Array.from(periodFilter.querySelectorAll('option')).map((option) => option.textContent)).toEqual([
      'Toutes les périodes', '1er semestre', '2e semestre',
    ]);
    expect(displayedEvaluationRows()).toHaveLength(2);
    expect(displayedGradeRows()).toHaveLength(2);

    fireEvent.change(periodFilter, { target: { value: 'semester:1' } });
    expect(displayedEvaluationRows()).toHaveLength(1);
    expect(displayedEvaluationRows()[0]).toContain('Devoir de maths S1');
    expect(displayedGradeRows()).toHaveLength(1);

    fireEvent.change(periodFilter, { target: { value: 'semester:2' } });
    expect(displayedEvaluationRows()).toHaveLength(1);
    expect(displayedEvaluationRows()[0]).toContain('Dissertation S2');
    expect(displayedGradeRows()).toHaveLength(1);
  });

  it('combines subject, student, and period filters independently', async () => {
    fetchHomeroomClass.mockResolvedValue(detailFor(homeroomClasses[0]));
    render(<HomeroomView classes={[homeroomClasses[0]]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Évaluations et notes' }));
    const subjectFilter = screen.getByRole('combobox', { name: 'Matière' });
    const studentFilter = screen.getByRole('combobox', { name: 'Élève' });
    const periodFilter = screen.getByRole('combobox', { name: 'Période' });

    fireEvent.change(subjectFilter, { target: { value: 'Mathématiques' } });
    expect(displayedGradeRows()).toHaveLength(4);
    expect(displayedGradeRows().every((row) => row.includes('Mathématiques'))).toBe(true);
    expect(displayedEvaluationRows()).toHaveLength(3);

    fireEvent.change(subjectFilter, { target: { value: '' } });
    fireEvent.change(studentFilter, { target: { value: '1' } });
    expect(displayedGradeRows()).toHaveLength(3);
    expect(displayedGradeRows().every((row) => row.includes('Dupont Jean'))).toBe(true);
    expect(displayedEvaluationRows()).toHaveLength(4);

    fireEvent.change(periodFilter, { target: { value: 'trimester:2' } });
    expect(displayedGradeRows()).toHaveLength(2);
    expect(displayedGradeRows().every((row) => row.includes('Dupont Jean'))).toBe(true);
    expect(displayedEvaluationRows()).toHaveLength(2);

    fireEvent.change(subjectFilter, { target: { value: 'Mathématiques' } });
    expect(displayedGradeRows()).toHaveLength(1);
    expect(displayedGradeRows()[0]).toContain('Dupont Jean');
    expect(displayedGradeRows()[0]).toContain('Mathématiques');
    expect(displayedGradeRows()[0]).toContain('Devoir de maths T2');
    expect(displayedEvaluationRows()).toHaveLength(1);

    fireEvent.change(studentFilter, { target: { value: '' } });
    expect(displayedGradeRows()).toHaveLength(2);
    expect(displayedGradeRows().some((row) => row.includes('Martin Alice'))).toBe(true);
  });
});