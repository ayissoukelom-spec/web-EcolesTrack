import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';

const mockApiFetch = vi.hoisted(() => vi.fn());
const mockCountOverdueEvaluations = vi.hoisted(() => vi.fn());
const mockGetSimulatedRole = vi.hoisted(() => vi.fn(() => 'school_admin'));
const mockGetSimulatedUser = vi.hoisted(() => vi.fn(() => ({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 })));
const mockGetActiveSchoolId = vi.hoisted(() => vi.fn(() => 1));

const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    clear() {
      for (const key in store) delete store[key];
    },
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
    removeItem(key: string) {
      delete store[key];
    },
  };
})();

vi.mock('./lib/api.ts', () => ({
  apiFetch: mockApiFetch,
  getSimulatedRole: () => mockGetSimulatedRole(),
  getUiErrorMessage: (message: string | null) => message,
  setSimulatedRole: vi.fn(),
  clearSimulatedRole: vi.fn(),
  clearSimulatedUser: vi.fn(),
  getSimulatedSchoolId: () => 1,
  getActiveSchoolId: () => mockGetActiveSchoolId(),
  getSimulatedUser: () => mockGetSimulatedUser(),
  setSimulatedUser: vi.fn(),
  findTeacherProfileFromSimulatedUser: () => null,
}));

vi.mock('./lib/evaluationUtils.ts', () => ({
  countOverdueEvaluations: mockCountOverdueEvaluations,
  isEvaluationArchived: () => false,
  isEvaluationLockedBySchoolAdmin: () => false,
  isEvaluationArchivedForSchoolAdminByAge: () => false,
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
vi.mock('./components/NotesView.tsx', () => ({
  default: ({ onAddGrade, gradesList }: { onAddGrade?: (data: any) => Promise<void>; gradesList?: any[] }) => (
    <>
      <div>NotesView</div>
      {onAddGrade && <button onClick={() => onAddGrade({ evaluationId: 42, studentId: 7, score: '14', remarks: '' })}>Mock save grade</button>}
      <div data-testid="mock-grades">{JSON.stringify(gradesList || [])}</div>
    </>
  ),
}));
vi.mock('./components/NotificationView.tsx', () => ({ default: () => <div>NotificationView</div> }));
vi.mock('./components/AuditView.tsx', () => ({ default: () => <div>AuditView</div> }));
vi.mock('./components/MobileParentView.tsx', () => ({ default: () => <div>MobileParentView</div> }));
vi.mock('./components/ArchiveView.tsx', () => ({ default: () => <div>ArchiveView</div> }));
vi.mock('./components/BulletinsView.tsx', () => ({ default: () => <div>BulletinsView</div> }));

describe('App bulletin navigation', () => {
  afterEach(() => {
    cleanup();
    localStorageMock.clear();
  });

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });
    localStorageMock.clear();
    localStorageMock.setItem('ecoletrack_jwt_access', 'jwt-token');
    localStorageMock.setItem('ecoletrack_active_school_id', '1');

    mockApiFetch.mockReset();
    mockCountOverdueEvaluations.mockReset();
    mockCountOverdueEvaluations.mockReturnValue(0);
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

  it('allows only the super_admin role to access the Bulletin entry and page', async () => {
    mockGetSimulatedRole.mockReturnValue('super_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-super-admin', email: 'superadmin@example.com', name: 'Super Admin', schoolId: null, role: 'super_admin', id: 1 });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    const bulletinButton = await screen.findByRole('button', { name: /^Bulletins$/i });
    expect(bulletinButton).toBeEnabled();
    fireEvent.click(bulletinButton);

    expect(await screen.findByText('BulletinsView')).toBeTruthy();
  });

  it('refreshes grades from the backend after saving a grade', async () => {
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });
    const initialGrades = [{ id: 1, evaluationId: 1, studentId: 7, score: '10' }];
    const refreshedGrades = [{
      id: 2,
      evaluationId: 42,
      studentId: 7,
      score: '14',
      evaluationMinimumScore: 7,
      evaluationMaximumScore: 19,
    }];
    let gradesRequestCount = 0;
    mockApiFetch.mockImplementation((url: string, options?: { method?: string }) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/grades' && options?.method === 'POST') return Promise.resolve({ id: 2 });
      if (url === '/api/grades') {
        gradesRequestCount += 1;
        return Promise.resolve(gradesRequestCount === 1 ? initialGrades : refreshedGrades);
      }
      if (url === '/api/schools') return Promise.resolve([]);
      if (url === '/api/academic-years') return Promise.resolve([]);
      if (url === '/api/teachers') return Promise.resolve([]);
      if (url === '/api/parents') return Promise.resolve([]);
      if (url === '/api/evaluations') return Promise.resolve([]);
      if (url === '/api/notifications') return Promise.resolve([]);
      if (url === '/api/simulation/users') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Notes & Bulletins/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mock save grade' }));

    await waitFor(() => expect(screen.getByTestId('mock-grades')).toHaveTextContent('evaluationMinimumScore'));
    expect(mockApiFetch).toHaveBeenCalledWith('/api/grades', {
      method: 'POST',
      body: JSON.stringify({ evaluationId: 42, studentId: 7, score: '14', remarks: '' }),
    });
    expect(gradesRequestCount).toBeGreaterThan(1);
    expect(screen.getByTestId('mock-grades')).toHaveTextContent('"evaluationMinimumScore":7');
    expect(screen.getByTestId('mock-grades')).toHaveTextContent('"evaluationMaximumScore":19');
  });

  it('keeps the Bulletin menu visible but disabled for non-super_admin roles and does not navigate on click', async () => {
    for (const role of ['school_admin', 'teacher', 'parent']) {
      mockGetSimulatedRole.mockReturnValue(role);
      mockGetSimulatedUser.mockReturnValue({ uid: `sim-${role}`, email: `${role}@example.com`, name: `Sim ${role}`, schoolId: role === 'parent' ? null : 1, role, id: 1 });

      const { unmount } = render(
        <AuthProvider>
          <App />
        </AuthProvider>,
      );

      const bulletinButton = await screen.findByRole('button', { name: /^Bulletins$/i });
      expect(bulletinButton).toBeDisabled();
      fireEvent.click(bulletinButton);
      expect(screen.queryByText('BulletinsView')).toBeNull();
      unmount();
    }
  });

  it('shows the overdue count on the Notes & Bulletins entry for non-super_admin roles while Bulletin remains blocked', async () => {
    mockCountOverdueEvaluations.mockReturnValue(2);
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    const notesAndBulletinsButton = await screen.findByRole('button', { name: /Notes & Bulletins/i });
    expect(within(notesAndBulletinsButton).getByText('2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Bulletins$/i })).toBeNull();
  });

  it('hides the mobile app entry from the visible menu for all roles', async () => {
    for (const role of ['super_admin', 'school_admin', 'teacher', 'parent', 'student']) {
      mockGetSimulatedRole.mockReturnValue(role);
      mockGetSimulatedUser.mockReturnValue({
        uid: `sim-${role}`,
        email: `${role}@example.com`,
        name: `Sim ${role}`,
        schoolId: role === 'parent' ? null : 1,
        role,
        id: 1,
      });

      const { unmount } = render(
        <AuthProvider>
          <App />
        </AuthProvider>,
      );

      expect(screen.queryByRole('button', { name: /Application Mobile/i })).toBeNull();
      unmount();
    }
  });

  const setupAbsencesResponse = (absences: any[]) => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/dashboard/summary') return Promise.resolve({});
      if (url === '/api/absences') return Promise.resolve(absences);
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
  };

  const renderWithRole = async (role: string, absences: any[]) => {
    mockGetSimulatedRole.mockReturnValue(role);
    mockGetSimulatedUser.mockReturnValue({ uid: `sim-${role}`, email: `${role}@example.com`, name: `Sim ${role}`, schoolId: 1, role, id: 1 });
    setupAbsencesResponse(absences);
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
  };

  it('shows the Absences badge only for unjustified absences', async () => {
    await renderWithRole('school_admin', [
      { id: 1, isJustified: false },
      { id: 2, isJustified: true },
      { id: 3, isJustified: false },
    ]);

    const absencesButtons = await screen.findAllByTestId('sidebar-nav-absences');
    const absencesButton = absencesButtons[0];
    expect(await within(absencesButton).findByText('2')).toBeTruthy();
  });

  it('hides the Absences badge when all absences are justified', async () => {
    await renderWithRole('school_admin', [
      { id: 1, isJustified: true },
      { id: 2, isJustified: true },
    ]);

    const absencesButtons = await screen.findAllByTestId('sidebar-nav-absences');
    const absencesButton = absencesButtons[0];
    expect(within(absencesButton).queryByText('1')).toBeNull();
    expect(within(absencesButton).queryByText('2')).toBeNull();
  });

  it('shows 99+ when unjustified absences count exceeds 99', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/dashboard/summary') return Promise.resolve({});
      if (url === '/api/absences') return Promise.resolve([
        { id: 1, isJustified: true },
        { id: 2, isJustified: true },
      ]);
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

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    const absencesButtons = await screen.findAllByTestId('sidebar-nav-absences');
    const absencesButton = absencesButtons[0];
    expect(within(absencesButton).queryByText('1')).toBeNull();
    expect(within(absencesButton).queryByText('2')).toBeNull();
  });

  it('shows 99+ when unjustified absences count exceeds 99', async () => {
    const manyAbsences = Array.from({ length: 120 }, (_, index) => ({ id: index + 1, isJustified: false }));
    await renderWithRole('school_admin', manyAbsences);

    const absencesButtons = await screen.findAllByTestId('sidebar-nav-absences');
    const absencesButton = absencesButtons[0];
    expect(await within(absencesButton).findByText('99+')).toBeTruthy();
  });

  it('shows the Absences badge for parent role when there are unjustified absences', async () => {
    await renderWithRole('parent', [
      { id: 1, isJustified: false },
      { id: 2, isJustified: true },
    ]);

    const absencesButtons = await screen.findAllByTestId('sidebar-nav-absences');
    const absencesButton = absencesButtons[0];
    expect(await within(absencesButton).findByText('1')).toBeTruthy();
  });

  it('shows the Absences badge for teacher role when there are unjustified absences', async () => {
    await renderWithRole('teacher', [
      { id: 1, isJustified: false },
      { id: 2, isJustified: true },
    ]);

    const absencesButtons = await screen.findAllByTestId('sidebar-nav-absences');
    const absencesButton = absencesButtons[0];
    expect(await within(absencesButton).findByText('1')).toBeTruthy();
  });

  it('shows the Absences badge for super_admin role when there are unjustified absences', async () => {
    await renderWithRole('super_admin', [
      { id: 1, isJustified: false },
      { id: 2, isJustified: true },
    ]);

    const absencesButtons = await screen.findAllByTestId('sidebar-nav-absences');
    const absencesButton = absencesButtons[0];
    expect(await within(absencesButton).findByText('1')).toBeTruthy();
  });
});
