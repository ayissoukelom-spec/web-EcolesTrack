import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BulletinsView from './BulletinsView';

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
});