import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ArchiveView from './ArchiveView';
import NotesView from './NotesView';
import type { Evaluation, Grade, Student, Class } from '../types.ts';

const classes: Class[] = [
  { id: 10, schoolId: 1, academicYearId: 1, name: '3ème A' },
];

const students: Student[] = [
  { id: 1, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Alice', lastName: 'Dupont', enrolledAt: '2026-06-24T08:00:00Z' },
  { id: 2, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Bob', lastName: 'Martin', enrolledAt: '2026-06-25T10:00:00Z' },
];

const evaluations: Evaluation[] = [
  {
    id: 1,
    classId: 10,
    teacherId: 100,
    subject: 'Mathématiques',
    title: 'Devoir 1',
    coefficient: 2,
    maxScore: 20,
    date: '2026-06-26',
    createdAt: '2026-06-25T09:00:00Z',
  },
  {
    id: 2,
    classId: 10,
    teacherId: 100,
    subject: 'Français',
    title: 'Devoir 2',
    coefficient: 1,
    maxScore: 20,
    date: '2026-06-20',
    createdAt: '2026-06-24T08:00:00Z',
  },
];

const grades: Grade[] = [
  { id: 1, evaluationId: 1, studentId: 1, score: '15', studentName: 'Alice Dupont' },
  { id: 2, evaluationId: 2, studentId: 1, score: '14', studentName: 'Alice Dupont' },
  { id: 3, evaluationId: 2, studentId: 2, score: '13', studentName: 'Bob Martin' },
];

const schools = [{ id: 1, name: 'Lycée Voltaire' }];

const defaultProps = {
  userRole: 'super_admin' as const,
  evaluationsList: evaluations,
  gradesList: grades,
  studentsList: students,
  classesList: classes,
  schoolsList: schools,
  schoolFilterId: null,
  onSchoolFilterChange: () => undefined,
  teacherClassIds: [10],
  teacherId: 100,
  onAddEvaluation: () => undefined,
  onAddGrade: () => Promise.resolve(),
};

describe('Archive UI regression', () => {
  it('affiche les évaluations terminées dans Archive', () => {
    render(<ArchiveView {...defaultProps} />);

    expect(screen.getByText('Archive des devoirs terminés')).toBeDefined();
    expect(screen.getByText(/2\s*devoirs/i)).toBeDefined();
    expect(screen.getByText('Devoir 1')).toBeDefined();
    expect(screen.getByText('Devoir 2')).toBeDefined();
  });

  it('permet à un administrateur de modifier une note déjà enregistrée', () => {
    const onAddGrade = vi.fn().mockResolvedValue({ id: 1 });
    const editableStudents: Student[] = [
      { id: 1, schoolId: 1, classId: 10, className: '3ème A', firstName: 'Alice', lastName: 'Dupont', enrolledAt: '2026-06-24T08:00:00Z' },
    ];
    const editableEvaluations: Evaluation[] = [
      {
        id: 1,
        classId: 10,
        teacherId: 100,
        subject: 'Mathématiques',
        title: 'Devoir 1',
        coefficient: 2,
        maxScore: 20,
        date: '2026-06-26',
        createdAt: '2026-06-25T09:00:00Z',
      },
    ];
    const editableGrades: Grade[] = [
      { id: 1, evaluationId: 1, studentId: 1, score: '15', studentName: 'Alice Dupont' },
    ];

    render(
      <NotesView
        {...defaultProps}
        userRole="school_admin"
        evaluationsList={editableEvaluations}
        gradesList={editableGrades}
        studentsList={editableStudents}
        onAddGrade={onAddGrade}
      />
    );

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '10' } });
    const evaluationSelect = screen.getAllByRole('combobox')[1];
    expect(screen.getByRole('option', { name: /Mathématiques/i })).toBeDefined();
    fireEvent.change(evaluationSelect, { target: { value: '1' } });

    expect(screen.getByPlaceholderText('ex. 12.5')).toBeDefined();
    expect(screen.getByRole('button', { name: /modifier les notes/i })).toBeDefined();
  });
});
