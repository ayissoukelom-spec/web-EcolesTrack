import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider } from '../contexts/AuthContext';
import ArchiveView from './ArchiveView';
import NotesView from './NotesView';
import type { Evaluation, Grade, Student, Class } from '../types.ts';

afterEach(() => cleanup());

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'sim_school_admin_1', email: 'school_admin@example.test', name: 'School Admin', role: 'school_admin', schoolId: 1 },
    token: null,
    isAuthenticated: false,
    isSimulated: true,
    role: 'school_admin',
    activeSchoolId: 1,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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

  it('affiche un badge Modifiée pour une note marquée comme modifiée', () => {
    const modifiedGrades: Grade[] = [
      { id: 11, evaluationId: 1, studentId: 1, score: '16', studentName: 'Alice Dupont', isModified: true },
    ];

    render(
      <ArchiveView
        {...defaultProps}
        evaluationsList={[evaluations[0]]}
        studentsList={[students[0]]}
        gradesList={modifiedGrades}
      />
    );

    expect(screen.getByText(/Modifiée/i)).toBeDefined();
  });

  it('permet à un administrateur de modifier une note déjà enregistrée', async () => {
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
      <AuthProvider>
        <NotesView
          {...defaultProps}
          initialSelectedEvalId={1}
          evaluationsList={editableEvaluations}
          gradesList={editableGrades}
          studentsList={editableStudents}
          onAddGrade={onAddGrade}
        />
      </AuthProvider>
    );

    const gradeInput = await screen.findByPlaceholderText(/ex\. 15\.5 or Abs/i);
    expect(gradeInput).toBeDefined();
    expect(screen.getByRole('button', { name: /Mettre à jour/i })).toBeDefined();
  });

  it('affiche les boutons d export XLSX et PDF uniquement pour un enseignant', () => {
    render(
      <ArchiveView
        {...defaultProps}
        userRole="teacher"
        teacherId={100}
      />
    );

    expect(screen.getAllByRole('button', { name: /Télécharger Excel/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Télécharger PDF/i })).toHaveLength(2);
  });

  it('n affiche pas les boutons d export pour un administrateur', () => {
    render(
      <ArchiveView
        {...defaultProps}
        userRole="school_admin"
      />
    );

    expect(screen.queryByRole('button', { name: /Télécharger Excel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Télécharger PDF/i })).toBeNull();
  });
});
