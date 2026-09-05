import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BulletinsView from './BulletinsView';
import ParentNotesView from './ParentNotesView';

vi.mock('../contexts/AuthContext.tsx', () => ({
  useAuth: () => ({
    role: 'super_admin',
    user: {
      uid: 'sim-super-admin',
      email: 'superadmin@example.com',
      name: 'Super Admin',
      schoolId: null,
      role: 'super_admin',
      id: 1,
    },
  }),
}));

vi.mock('../hooks/useBulletinsList.ts', () => ({
  useBulletinsList: () => ({
    items: [],
    total: 0,
    loading: false,
    error: null,
    setError: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('../hooks/useBulletinDetail.ts', () => ({
  useBulletinDetail: () => ({
    detail: null,
    loading: false,
    error: null,
    setError: vi.fn(),
    loadDetail: vi.fn(),
  }),
}));

vi.mock('../hooks/useGenerateBulletin.ts', () => ({
  useGenerateBulletin: () => ({
    loading: false,
    error: null,
    success: null,
    setError: vi.fn(),
    setSuccess: vi.fn(),
    run: vi.fn(),
    runMany: vi.fn(),
  }),
}));

vi.mock('../hooks/useDownloadBulletinPDF.ts', () => ({
  useDownloadBulletinPDF: () => ({
    loading: false,
    error: null,
    run: vi.fn(),
    runMany: vi.fn(),
  }),
}));

vi.mock('../lib/api.ts', () => ({
  apiFetch: vi.fn(() => Promise.resolve([])),
  fetchBulletinDetail: vi.fn(),
}));

describe('BulletinsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps all schools visible to super_admin even when a school has no class yet', () => {
    render(
      <BulletinsView
        schoolsList={[
          { id: 1, name: 'École A' },
          { id: 2, name: 'École sans classe' },
        ]}
        classesList={[
          { id: 10, schoolId: 1, academicYearId: 1, name: '6A' },
        ]}
        studentsList={[]}
        evaluationsList={[]}
        gradesList={[]}
      />,
    );

    const schoolSelect = screen.getAllByRole('combobox')[0];
    expect(schoolSelect).toHaveTextContent('École A');
    expect(schoolSelect).toHaveTextContent('École sans classe');
  });

  it('keeps parent notes limited to attached children while showing per-evaluation bounds', () => {
    render(
      <ParentNotesView
        currentRole="parent"
        parentsList={[{ id: 7, userId: 1, name: 'Parent', email: 'superadmin@example.com', studentId: 10 }]}
        studentsList={[
          { id: 10, schoolId: 1, classId: 3, className: '3A', firstName: 'Alice', lastName: 'Rattachee', parentId: 7 },
          { id: 11, schoolId: 1, classId: 3, className: '3A', firstName: 'Bob', lastName: 'NonRattache', parentId: 8 },
        ]}
        evaluationsList={[
          { id: 1, classId: 3, teacherId: 1, subject: 'Maths', title: 'Devoir 1', type: 'devoir', coefficient: 1, maxScore: 20, date: '2026-01-01' },
          { id: 2, classId: 3, teacherId: 1, subject: 'Francais', title: 'Interro 1', type: 'interrogation', coefficient: 1, maxScore: 10, date: '2026-01-02' },
          { id: 3, classId: 3, teacherId: 1, subject: 'Sciences', title: 'Compo 1', type: 'composition', coefficient: 1, maxScore: 20, date: '2026-01-03' },
        ]}
        gradesList={[
          { id: 1, evaluationId: 1, studentId: 10, score: '14', evaluationMaximumScore: 19, evaluationMinimumScore: 7 },
          { id: 2, evaluationId: 2, studentId: 10, score: '8', evaluationMaximumScore: 18, evaluationMinimumScore: 10 },
          { id: 3, evaluationId: 3, studentId: 10, score: '12', evaluationMaximumScore: 12, evaluationMinimumScore: 12 },
          { id: 4, evaluationId: 1, studentId: 11, score: '20', evaluationMaximumScore: 20, evaluationMinimumScore: 7 },
        ]}
      />,
    );

    expect(screen.getByText('Devoir 1')).toBeInTheDocument();
    expect(screen.getByText('Interro 1')).toBeInTheDocument();
    expect(screen.getByText('Compo 1')).toBeInTheDocument();
    expect(screen.getByText('19.00 / 20')).toBeInTheDocument();
    expect(screen.getByText('7.00 / 20')).toBeInTheDocument();
    expect(screen.queryByText('20 / 20')).toBeNull();
  });
});