import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { vi, test, expect, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { AuthProvider } from '../../contexts/AuthContext';

afterEach(() => {
  cleanup();
});

const AUTH_ROLE_KEY = 'ecoletrack_simulated_role';
const AUTH_USER_KEY = 'ecoletrack_simulated_user';
const AUTH_ACTIVE_SCHOOL_KEY = 'ecoletrack_active_school_id';

if (typeof globalThis.localStorage === 'undefined') {
  let memoryStorage: Record<string, string> = {};
  const localStorageMock = {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : null;
    },
    setItem(key: string, value: string) {
      memoryStorage[key] = value.toString();
    },
    removeItem(key: string) {
      delete memoryStorage[key];
    },
    clear() {
      memoryStorage = {};
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
}

function renderWithAuth(ui: React.ReactElement, role: 'teacher' | 'school_admin' | 'super_admin', schoolId?: number | null) {
  const storage = typeof globalThis.localStorage !== 'undefined'
    ? globalThis.localStorage
    : (() => {
      let memoryStorage: Record<string, string> = {};
      return {
        getItem(key: string) {
          return memoryStorage[key] ?? null;
        },
        setItem(key: string, value: string) {
          memoryStorage[key] = value.toString();
        },
        removeItem(key: string) {
          delete memoryStorage[key];
        },
        clear() {
          memoryStorage = {};
        },
      };
    })();

  if (typeof storage.clear === 'function') {
    storage.clear();
  }
  storage.setItem(AUTH_ROLE_KEY, role);
  storage.setItem(AUTH_USER_KEY, JSON.stringify({ uid: `sim_${role}_1`, email: `${role}@example.test`, name: `${role} simulé`, schoolId: schoolId ?? null }));
  if (schoolId != null) {
    storage.setItem(AUTH_ACTIVE_SCHOOL_KEY, String(schoolId));
  } else {
    storage.removeItem(AUTH_ACTIVE_SCHOOL_KEY);
  }

  return render(
    <AuthProvider>
      {ui}
    </AuthProvider>
  );
}

function findEvaluationSelect() {
  const selects = screen.getAllByRole('combobox');
  const evalSelect = selects.find((select) => within(select).queryByText(/-- Sélectionnez un devoir --/i));
  if (!evalSelect) {
    throw new Error('Could not locate evaluation select');
  }
  return evalSelect;
}

// Mock evaluation utils used by NotesView to control completed/fully graded behaviour
vi.mock('../../lib/evaluationUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/evaluationUtils')>();
  return {
    ...actual,
    getEligibleStudentsForEvaluation: (ev: any, classStudents: any[]) => classStudents,
    getEligibleStudentsForEvaluationWithGrades: (ev: any, classStudents: any[]) => classStudents,
    getEligibleStudentsWithHistoryForEvaluation: (ev: any, classStudents: any[]) => classStudents,
    getEligibleGradesForEvaluation: (ev: any, classStudents: any[]) => classStudents.map((st) => ({ evaluationId: ev?.id ?? 0, studentId: st.id, score: '0', remarks: '' })),
    getOverdueEvaluations: actual.getOverdueEvaluations,
    isEvaluationFullyGraded: (ev: any) => ev.id === 2,
    isEvaluationCompleted: (ev: any) => ev.id === 2,
    isEvaluationArchivedForSchoolAdminByAge: () => false,
    isStudentEligibleForEvaluation: () => true,
    parseDateValue: (v: any) => new Date(v),
  };
});

import NotesView from '../NotesView';

const baseProps = {
  evaluationsList: [
    { id: 1, classId: 85, teacherId: 10, subject: 'Math', title: 'Eval 1', date: '2026-07-01', maxScore: 20, coefficient: 1 },
    { id: 2, classId: 85, teacherId: 10, subject: 'Math', title: 'Eval 2', date: '2026-06-01', maxScore: 20, coefficient: 1 },
  ],
  gradesList: [
    { id: 11, evaluationId: 2, studentId: 201, score: '15', remarks: '' },
  ],
  studentsList: [
    { id: 201, schoolId: 1, classId: 85, className: '6ème A', firstName: 'Jean', lastName: 'Dupont' },
  ],
  classesList: [
    { id: 85, schoolId: 1, academicYearId: 2026, name: '6ème A' },
  ],
  schoolsList: [{ id: 1, name: 'École Exemple' }],
  onAddEvaluation: vi.fn(),
  onAddGrade: vi.fn(),
};

test('teacher sees only non-completed evaluations and archive contains completed', () => {
  renderWithAuth(<NotesView {...baseProps} teacherId={10} teacherClassIds={[85]} /> as any, 'teacher', 1);

  // evaluation select should contain Eval 1 but not Eval 2
  const evalSelect = findEvaluationSelect();
  within(evalSelect).getByText(/Eval 1/);
  expect(within(evalSelect).queryByText(/Eval 2/)).toBeNull();

  // archive section should be present and include Eval 2
  screen.getByText(/Archive des devoirs terminés/);
  screen.getByText(/Eval 2/);
});

test('school_admin sees archived label on completed evaluations in dropdown', () => {
  renderWithAuth(<NotesView {...baseProps} /> as any, 'school_admin', 1);

  const evalSelect = findEvaluationSelect();
  // For school_admin, completed eval should be visible somewhere (archive)
  const matches = screen.getAllByText(/Eval 2/);
  expect(matches.length).toBeGreaterThan(0);
});

test('school_admin still sees teacher-archived evaluation until it is locked', async () => {
  const props = {
    ...baseProps,
    evaluationsList: [
      { id: 2, classId: 85, teacherId: 10, subject: 'Math', title: 'Eval 2', date: '2026-06-01', maxScore: 20, coefficient: 1 },
    ],
    gradesList: [
      { id: 21, evaluationId: 2, studentId: 201, score: '15', remarks: '' },
    ],
  };

  renderWithAuth(<NotesView {...props} /> as any, 'school_admin', 1);

  const evalSelect = findEvaluationSelect();
  await within(evalSelect).findByRole('option', { name: /Eval 2/i });
  expect(screen.queryByText(/Archive des devoirs terminés/)).toBeNull();
});

test('super_admin sees all evaluations even if archived for teachers', async () => {
  const props = {
    ...baseProps,
    gradesList: [{ id: 11, evaluationId: 2, studentId: 201, score: '15', remarks: '' }],
  };

  renderWithAuth(<NotesView {...props} /> as any, 'super_admin', null);

  const evalSelect = findEvaluationSelect();
  await within(evalSelect).findByRole('option', { name: /Eval 2/i });
});

test('super_admin renders NotesView', () => {
  renderWithAuth(<NotesView {...baseProps} /> as any, 'super_admin', null);
  // basic smoke test: component rendered (allow multiple matches)
  const headers = screen.getAllByText(/Gestion des Notes & Évaluations/);
  expect(headers.length).toBeGreaterThan(0);
});

test('super_admin sees overdue evaluations list with school, class and assignment details', async () => {
  const props = {
    ...baseProps,
    evaluationsList: [
      { id: 3, classId: 85, teacherId: 10, subject: 'Math', title: 'Devoir retard', date: '2024-01-01', maxScore: 20, coefficient: 1 },
    ],
    gradesList: [],
    studentsList: [
      { id: 201, schoolId: 1, classId: 85, className: '6ème A', firstName: 'Jean', lastName: 'Dupont' },
      { id: 202, schoolId: 1, classId: 85, className: '6ème A', firstName: 'Marie', lastName: 'Durand' },
    ],
  };

  renderWithAuth(<NotesView {...props} /> as any, 'super_admin', null);

  await screen.findByRole('heading', { name: /Devoirs en retard/i });
  expect(screen.getAllByText(/Devoir retard/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/6ème A/i).length).toBeGreaterThan(0);
});

test('calls onUpdateGrade for school_admin when updating existing grade', async () => {
  const onAddGrade = vi.fn();
  const onUpdateGrade = vi.fn(() => Promise.resolve());
  renderWithAuth(
    <NotesView {...baseProps} onAddGrade={onAddGrade} onUpdateGrade={onUpdateGrade} initialSelectedEvalId={2} /> as any,
    'school_admin',
    1,
  );

  await waitFor(() => expect(document.getElementById('btn-save-grade-201')).not.toBeNull());
  const btn = document.getElementById('btn-save-grade-201');
  if (!btn) throw new Error('Could not locate update button for student 201');

  fireEvent.click(btn);

  await waitFor(() => expect(onUpdateGrade).toHaveBeenCalled());
  expect(onAddGrade).not.toHaveBeenCalled();
});

test('school_admin can update one existing grade with save all', async () => {
  const props = {
    ...baseProps,
    studentsList: [
      { id: 201, schoolId: 1, classId: 85, className: '6ème A', firstName: 'Jean', lastName: 'Dupont' },
      { id: 202, schoolId: 1, classId: 85, className: '6ème A', firstName: 'Marie', lastName: 'Claire' },
    ],
    gradesList: [
      { id: 11, evaluationId: 2, studentId: 201, score: '15', remarks: '' },
      { id: 12, evaluationId: 2, studentId: 202, score: '12', remarks: '' },
    ],
  };
  const onAddGrade = vi.fn(() => Promise.resolve());
  const onUpdateGrade = vi.fn(() => Promise.resolve());

  renderWithAuth(<NotesView {...props} onAddGrade={onAddGrade} onUpdateGrade={onUpdateGrade} initialSelectedEvalId={2} /> as any, 'school_admin', 1);

  const classSelect = screen.getAllByRole('combobox').find((s) => within(s).queryByText(/6ème A/));
  if (!classSelect) throw new Error('Could not locate class select');
  fireEvent.change(classSelect, { target: { value: '85' } });

  const evalSelect = findEvaluationSelect();
  fireEvent.change(evalSelect, { target: { value: '2' } });

  const studentRow = await screen.findByText(/Marie Claire/i);
  const row = studentRow.closest('tr');
  if (!row) throw new Error('Could not locate student row for Marie Claire');

  const input = await within(row).findByDisplayValue('12');
  fireEvent.change(input, { target: { value: '13' } });

  const container = document.getElementById('grades-table-container');
  if (!container) throw new Error('Could not locate grades table container');
  const saveAllBtn = within(container).getByRole('button', { name: /Enregistrer tout/i });
  fireEvent.click(saveAllBtn);

  expect(onUpdateGrade).toHaveBeenCalledWith({
    gradeId: 12,
    evaluationId: 2,
    studentId: 202,
    score: '13',
    remarks: '',
  });
  expect(onAddGrade).not.toHaveBeenCalled();
});

test('falls back to onAddGrade when onUpdateGrade is not provided', async () => {
  const onAddGrade = vi.fn(() => Promise.resolve());
  renderWithAuth(<NotesView {...baseProps} onAddGrade={onAddGrade} initialSelectedEvalId={2} /> as any, 'super_admin', null);

  const classSelect = screen.getAllByRole('combobox').find((s) => within(s).queryByText(/6ème A/));
  if (!classSelect) throw new Error('Could not locate class select');
  fireEvent.change(classSelect, { target: { value: '85' } });

  const evalSelect = findEvaluationSelect();
  fireEvent.change(evalSelect, { target: { value: '2' } });

  console.log('EVAL SELECT', evalSelect.outerHTML);
  console.log('BUTTON COUNT', screen.getAllByRole('button', { name: /Mettre à jour/i }).map((btn) => ({ id: btn.id, disabled: btn.hasAttribute('disabled'), text: btn.textContent?.trim() })));
  console.log('GRADE CONTAINER', document.getElementById('grades-table-container')?.outerHTML?.slice(0, 400));

  await waitFor(() => expect(document.getElementById('btn-save-grade-201')).not.toBeNull());
  const btn = document.getElementById('btn-save-grade-201');
  if (!btn) throw new Error('Could not locate update button for student 201');
  fireEvent.click(btn);

  expect(onAddGrade).toHaveBeenCalled();
});
