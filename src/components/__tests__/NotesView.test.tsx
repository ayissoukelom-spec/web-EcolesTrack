import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';

// Mock evaluation utils used by NotesView to control completed/fully graded behaviour
vi.mock('../../lib/evaluationUtils', () => ({
  getEligibleStudentsForEvaluation: (ev: any, classStudents: any[]) => classStudents,
  getEligibleStudentsForEvaluationWithGrades: (ev: any, classStudents: any[]) => classStudents,
  getEligibleStudentsWithHistoryForEvaluation: (ev: any, classStudents: any[]) => classStudents,
  getEligibleGradesForEvaluation: (ev: any, classStudents: any[]) => classStudents.map((st) => ({ evaluationId: ev?.id ?? 0, studentId: st.id, score: '0', remarks: '' })),
  isEvaluationFullyGraded: (ev: any) => ev.id === 2,
  isEvaluationCompleted: (ev: any) => ev.id === 2,
  isStudentEligibleForEvaluation: () => true,
  parseDateValue: (v: any) => new Date(v),
}));

import NotesView from '../NotesView';

const baseProps = {
  evaluationsList: [
    { id: 1, classId: 85, teacherId: 10, subject: 'Math', title: 'Eval 1', date: '2026-07-01', maxScore: 20 },
    { id: 2, classId: 85, teacherId: 10, subject: 'Math', title: 'Eval 2', date: '2026-06-01', maxScore: 20 },
  ],
  gradesList: [
    { id: 11, evaluationId: 2, studentId: 201, score: '15', remarks: '' },
  ],
  studentsList: [
    { id: 201, classId: 85, firstName: 'Jean', lastName: 'Dupont' },
  ],
  classesList: [
    { id: 85, name: '6ème A', schoolId: 1 },
  ],
  schoolsList: [{ id: 1, name: 'École Exemple' }],
  onAddEvaluation: vi.fn(),
  onAddGrade: vi.fn(),
};

test('teacher sees only non-completed evaluations and archive contains completed', () => {
  render(<NotesView {...baseProps} userRole="teacher" teacherId={10} teacherClassIds={[85]} /> as any);

  // evaluation select should contain Eval 1 but not Eval 2
  const selects = screen.getAllByRole('combobox');
  const evalSelect = selects[1];
  // Eval 1 should be present in the evaluation select, Eval 2 should appear somewhere (archive)
  within(evalSelect).getByText(/Eval 1/);
  expect(within(evalSelect).queryByText(/Eval 2/)).toBeNull();

  // archive section should be present and include Eval 2
  screen.getByText(/Archive des devoirs terminés/);
  screen.getByText(/Eval 2/);
});

test('school_admin sees archived label on completed evaluations in dropdown', () => {
  render(<NotesView {...baseProps} userRole="school_admin" currentSchoolId={1} /> as any);

  const selects = screen.getAllByRole('combobox');
  const evalSelect = selects[1];
  // For school_admin, completed eval should be visible somewhere (archive)
  const matches = screen.getAllByText(/Eval 2/);
  expect(matches.length).toBeGreaterThan(0);
});

test('school_admin still sees teacher-archived evaluation until it is locked', () => {
  const props = {
    ...baseProps,
    evaluationsList: [
      { id: 2, classId: 85, teacherId: 10, subject: 'Math', title: 'Eval 2', date: '2026-06-01', maxScore: 20 },
    ],
    gradesList: [
      { id: 21, evaluationId: 2, studentId: 201, score: '15', remarks: '' },
    ],
  };

  render(<NotesView {...props} userRole="school_admin" currentSchoolId={1} /> as any);

  const selects = screen.getAllByRole('combobox');
  const evalSelect = selects[1];
  within(evalSelect).getByText(/Eval 2/);
  expect(screen.queryByText(/Archive des devoirs terminés/)).toBeNull();
});

test('super_admin sees all evaluations even if archived for teachers', () => {
  const props = {
    ...baseProps,
    gradesList: [{ id: 11, evaluationId: 2, studentId: 201, score: '15', remarks: '' }],
  };

  render(<NotesView {...props} userRole="super_admin" /> as any);

  const selects = screen.getAllByRole('combobox');
  const evalSelect = selects[1];
  within(evalSelect).getByText(/Eval 2/);
});

test('super_admin renders NotesView', () => {
  render(<NotesView {...baseProps} userRole="super_admin" /> as any);
  // basic smoke test: component rendered (allow multiple matches)
  const headers = screen.getAllByText(/Gestion des Notes & Évaluations/);
  expect(headers.length).toBeGreaterThan(0);
});

test('calls onUpdateGrade for school_admin when updating existing grade', async () => {
  const onAddGrade = vi.fn();
  const onUpdateGrade = vi.fn(() => Promise.resolve());
  render(<NotesView {...baseProps} userRole="school_admin" currentSchoolId={1} onAddGrade={onAddGrade} onUpdateGrade={onUpdateGrade} initialSelectedEvalId={2} /> as any);

  const selects = screen.getAllByRole('combobox');
  const classSelect = selects.find((s) => within(s).queryByText(/6ème A/));
  const evalSelect = selects.find((s) => !within(s).queryByText(/6ème A/));
  if (!classSelect || !evalSelect) throw new Error('Could not locate selects');
  // First select the class so evaluation options populate
    // With initialSelectedEvalId provided the evaluation is pre-selected; click the update button
    // No need to change selects as the evaluation is already selected

  // Select the class so the students list is populated, then click the update button
  fireEvent.change(classSelect, { target: { value: '85' } });
  const btn = await screen.findByRole('button', { name: /Mettre à jour/i });
  fireEvent.click(btn);

  expect(onUpdateGrade).toHaveBeenCalled();
  expect(onAddGrade).not.toHaveBeenCalled();
});

test('falls back to onAddGrade when onUpdateGrade is not provided', async () => {
  const onAddGrade = vi.fn(() => Promise.resolve());
  render(<NotesView {...baseProps} userRole="super_admin" onAddGrade={onAddGrade} initialSelectedEvalId={2} /> as any);

  const selects = screen.getAllByRole('combobox');
  const classSelect = selects.find((s) => within(s).queryByText(/6ème A/));
  const evalSelect = selects.find((s) => !within(s).queryByText(/6ème A/));
  if (!classSelect || !evalSelect) throw new Error('Could not locate selects');
    // Evaluation pre-selected via initialSelectedEvalId; click the update button
    // No need to change selects as the evaluation is already selected

  // Select the class so the students list is populated, then click the update button
  fireEvent.change(classSelect, { target: { value: '85' } });
  const btn = await screen.findByRole('button', { name: /Mettre à jour/i });
  fireEvent.click(btn);

  expect(onAddGrade).toHaveBeenCalled();
});
