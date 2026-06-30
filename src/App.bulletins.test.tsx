import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.tsx';

const mockApiFetch = vi.hoisted(() => vi.fn());

vi.mock('./lib/api.ts', () => ({
  apiFetch: mockApiFetch,
  getSimulatedRole: () => 'school_admin',
  getUiErrorMessage: (message: string | null) => message,
  setSimulatedRole: vi.fn(),
  clearSimulatedRole: vi.fn(),
  clearSimulatedUser: vi.fn(),
  getSimulatedSchoolId: () => 1,
  getSimulatedUser: () => ({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1 }),
  setSimulatedUser: vi.fn(),
  findTeacherProfileFromSimulatedUser: () => null,
}));

vi.mock('./lib/evaluationUtils.ts', () => ({
  isEvaluationCompleted: () => false,
}));

vi.mock('./hooks/useAdminDashboard.ts', () => ({
  useAdminDashboard: () => ({ stats: {}, recentAbsences: [], recentGrades: [], refresh: vi.fn() }),
}));

vi.mock('./hooks/useStudents.ts', () => ({
  useStudents: () => ({ students: [], refresh: vi.fn(), addStudent: vi.fn(), updateStudent: vi.fn(), batchCreateStudents: vi.fn() }),
}));

vi.mock('./hooks/useClasses.ts', () => ({
  useClasses: () => ({ classes: [], refresh: vi.fn(), addClass: vi.fn(), deleteClass: vi.fn() }),
}));

vi.mock('./hooks/useAbsences.ts', () => ({
  useAbsences: () => ({ absences: [], refresh: vi.fn(), addAbsence: vi.fn(), justifyAbsence: vi.fn() }),
}));

vi.mock('./components/SimulatorHeader.tsx', () => ({ default: () => <div>SimulatorHeader</div> }));
vi.mock('./components/LoginView.tsx', () => ({ default: () => <div>LoginView</div> }));
vi.mock('./components/DashboardView.tsx', () => ({ default: () => <div>DashboardView</div> }));
vi.mock('./components/AdminView.tsx', () => ({ default: () => <div>AdminView</div> }));
vi.mock('./components/ErrorBoundary.tsx', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./components/AbsenceView.tsx', () => ({ default: () => <div>AbsenceView</div> }));
vi.mock('./components/NotesView.tsx', () => ({ default: () => <div>NotesView</div> }));
vi.mock('./components/NotificationView.tsx', () => ({ default: () => <div>NotificationView</div> }));
vi.mock('./components/AuditView.tsx', () => ({ default: () => <div>AuditView</div> }));
vi.mock('./components/MobileParentView.tsx', () => ({ default: () => <div>MobileParentView</div> }));
vi.mock('./components/ArchiveView.tsx', () => ({ default: () => <div>ArchiveView</div> }));
vi.mock('./components/BulletinsView.tsx', () => ({ default: () => <div>BulletinsView</div> }));

describe('App bulletin navigation', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/schools') return Promise.resolve([]);
      if (url === '/api/academic-years') return Promise.resolve([]);
      if (url === '/api/teachers') return Promise.resolve([]);
      if (url === '/api/parents') return Promise.resolve([]);
      if (url === '/api/evaluations') return Promise.resolve([]);
      if (url === '/api/grades') return Promise.resolve([]);
      if (url === '/api/notifications') return Promise.resolve([]);
      if (url === '/api/simulation/users') return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it('shows a dedicated Bulletin entry and opens the bulletin view', async () => {
    render(<App />);

    const bulletinButton = await screen.findByRole('button', { name: /^Bulletins$/i });
    fireEvent.click(bulletinButton);

    expect(await screen.findByText('BulletinsView')).toBeTruthy();
  });
});
