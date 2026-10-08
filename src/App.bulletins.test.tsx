import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
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
vi.mock('./components/AdminView.tsx', () => ({
  default: ({ onSetPassword }: { onSetPassword?: (userId: number) => Promise<{ temporaryPassword?: string }> }) => {
    const [temporaryPassword, setTemporaryPassword] = useState('');
    return (
      <>
        <div>AdminView</div>
        {onSetPassword && (
          <button
            onClick={async () => {
              const result = await onSetPassword(61);
              setTemporaryPassword(result.temporaryPassword || '');
            }}
          >
            Mock reset parent account
          </button>
        )}
        {temporaryPassword && <div role="dialog">{temporaryPassword}</div>}
      </>
    );
  },
}));
vi.mock('./components/ErrorBoundary.tsx', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./components/AbsenceView.tsx', () => ({
  default: ({ absencesList = [], pendingReviewOnly, onReviewAbsence }: {
    absencesList?: Array<{ id: number }>;
    pendingReviewOnly?: boolean;
    onReviewAbsence?: (id: number, status: 'APPROVED' | 'REJECTED', rejectionReason?: string) => Promise<void>;
  }) => (
    <>
      <div>{pendingReviewOnly ? 'PendingReviewView' : 'AbsenceView'}</div>
      <div data-testid="mock-absence-ids">{absencesList.map((absence) => absence.id).join(',')}</div>
      {pendingReviewOnly && (
        <>
          <button onClick={() => onReviewAbsence?.(30, 'APPROVED')}>Mock approve pending</button>
          <button onClick={() => onReviewAbsence?.(30, 'REJECTED', 'Motif de test')}>Mock reject pending</button>
        </>
      )}
    </>
  ),
}));
vi.mock('./components/AbsenceDeclarationValidationsView.tsx', () => ({
  default: ({ declarations, onReview }: {
    declarations: any[];
    onReview: (id: number, status: 'ACCEPTED' | 'REFUSED', rejectionReason?: string) => Promise<void>;
  }) => (
    <div>
      <div>DeclarationValidationsView: {declarations.filter((declaration) => declaration.status === 'RECEIVED').length}</div>
      <button onClick={() => void onReview(1, 'ACCEPTED')}>Mock accept declaration</button>
    </div>
  ),
}));
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
vi.mock('./components/AccountingView.tsx', () => ({
  default: ({ userRole }: { userRole: string }) => <div data-testid="accounting-view">{userRole}</div>,
}));

describe('App navigation', () => {
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

  it('keeps the parent WhatsApp contact available while navigating between parent pages', async () => {
    mockGetSimulatedRole.mockReturnValue('parent');
    mockGetSimulatedUser.mockReturnValue({
      uid: 'sim-parent-10',
      email: 'parent@example.com',
      name: 'Parent',
      schoolId: 1,
      role: 'parent',
      id: 10,
      phone: '+22899999999',
    });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/students?includeFormer=true') {
        return Promise.resolve([{
          id: 71,
          schoolId: 1,
          classId: 4,
          className: '6ème A',
          firstName: 'Alice',
          lastName: 'Akakpo',
          parentId: 3,
        }]);
      }
      if (url === '/api/parents') {
        return Promise.resolve([{ id: 3, userId: 10, name: 'Parent', email: 'parent@example.com', phone: '+22899999999' }]);
      }
      if (url === '/api/parent/whatsapp-contact?studentId=71') {
        return Promise.resolve({ whatsappUrl: 'https://wa.me/22890000001?text=Bonjour' });
      }
      return Promise.resolve([]);
    });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    const contactButton = await screen.findByRole('link', { name: "WhatsApp — Contacter l'administration" });
    expect(contactButton.getAttribute('href')).toBe('https://wa.me/22890000001?text=Bonjour');

    fireEvent.click(screen.getByRole('button', { name: /Absences/i }));
    expect(await screen.findByText('AbsenceView')).toBeTruthy();
    expect(screen.getByRole('link', { name: "WhatsApp — Contacter l'administration" })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(await screen.findByText('Eleve selectionne')).toBeTruthy();
    expect(screen.getByRole('link', { name: "WhatsApp — Contacter l'administration" })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Tableau de Bord/i }));
    expect(await screen.findByText('DashboardView')).toBeTruthy();
    expect(screen.getByRole('link', { name: "WhatsApp — Contacter l'administration" })).toBeTruthy();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/parent/whatsapp-contact?studentId=71');
  });

  it('allows super_admin to access the Bulletin entry and page', async () => {
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

  it('allows school_admin to access the Bulletin entry and page', async () => {
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });

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

  it('routes school_admin from the actual sidebar Comptabilité entry to AccountingView', async () => {
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({
      uid: 'sim-school-admin',
      email: 'admin@example.com',
      name: 'Admin',
      schoolId: 1,
      role: 'school_admin',
      id: 1,
    });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Navigation principale' });
    const accountingButton = within(navigation).getByRole('button', { name: 'Comptabilité' });
    expect(accountingButton).toBeTruthy();
    fireEvent.click(accountingButton);

    expect(await screen.findByTestId('accounting-view')).toHaveTextContent('school_admin');
  });

  it('refreshes after reset without unmounting the admin view or losing its temporary password result', async () => {
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });
    const temporaryPassword = 'K7mP4xQa';
    mockApiFetch.mockImplementation((url: string, options?: { method?: string }) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/admin/set-password' && options?.method === 'POST') {
        return Promise.resolve({ temporaryPassword, mustReset: true });
      }
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

    fireEvent.click(await screen.findByRole('button', { name: 'Administration' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mock reset parent account' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(temporaryPassword);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/set-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 61 }),
    }));
    expect(screen.getByRole('dialog')).toHaveTextContent(temporaryPassword);
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

  it('keeps the Bulletin menu visible but disabled for non-administration roles and does not navigate on click', async () => {
    for (const role of ['teacher', 'parent']) {
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

  it('shows only the permitted navigation entries for surveillant', async () => {
    mockGetSimulatedRole.mockReturnValue('surveillant');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-surveillant', email: 'surveillant@example.com', name: 'Surveillant', schoolId: 1, role: 'surveillant', id: 12 });

    render(<AuthProvider><App /></AuthProvider>);

    expect(await screen.findByRole('button', { name: /Tableau de Bord/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Absences$/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Contrôles Néant/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Notes & Bulletins/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Bulletins$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Administration$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Archive$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Messagerie & Push/i })).toBeNull();
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

  const setupAbsencesResponse = (absences: any[], pendingCount = 0, declarations: any[] = []) => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/dashboard/summary') return Promise.resolve({ absenceStatusCounts: { justified: 0, unjustified: 0, pending: pendingCount } });
      if (url === '/api/absences') return Promise.resolve(absences);
      if (url === '/api/absence-declarations') return Promise.resolve(declarations);
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

  const renderWithRole = async (role: string, absences: any[], pendingCount = 0, declarations: any[] = []) => {
    mockGetSimulatedRole.mockReturnValue(role);
    mockGetSimulatedUser.mockReturnValue({ uid: `sim-${role}`, email: `${role}@example.com`, name: `Sim ${role}`, schoolId: 1, role, id: 1 });
    setupAbsencesResponse(absences, pendingCount, declarations);
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

  it.each(['school_admin', 'super_admin', 'surveillant', 'teacher'])('%s sees the absence validations menu and backend count', async (role) => {
    await renderWithRole(role, [
      { id: 1, justificationStatus: 'PENDING' },
      { id: 2, justificationStatus: 'PENDING' },
      { id: 3, justificationStatus: 'APPROVED' },
      { id: 4, justificationStatus: 'REJECTED' },
    ], 2);

    const menuButton = await screen.findByTestId('sidebar-nav-absence-validations');
    expect(within(menuButton).getByText('Validation des absences à traiter')).toBeInTheDocument();
    expect(within(menuButton).getByText('2')).toBeInTheDocument();
  });

  it('uses the backend pending total instead of the recent absences list', async () => {
    await renderWithRole('school_admin', [{ id: 1, justificationStatus: 'PENDING' }], 5);

    const menuButton = await screen.findByTestId('sidebar-nav-absence-validations');
    expect(within(menuButton).getByText('5')).toBeInTheDocument();
  });

  it('never shows the absence validations menu to parents', async () => {
    await renderWithRole('parent', [], 4);

    expect(screen.queryByTestId('sidebar-nav-absence-validations')).toBeNull();
  });

  it.each(['school_admin', 'super_admin', 'surveillant', 'teacher'])('%s sees only the RECEIVED declaration badge and can navigate to validation', async (role) => {
    await renderWithRole(role, [], 0, [
      { id: 1, status: 'RECEIVED' },
      { id: 2, status: 'ACCEPTED' },
      { id: 3, status: 'REFUSED' },
    ]);

    const menuButton = await screen.findByTestId('sidebar-nav-absence-declaration-validations');
    expect(within(menuButton).getByText('Déclarations d’absence à traiter')).toBeInTheDocument();
    expect(within(menuButton).getByText('1')).toBeInTheDocument();
    fireEvent.click(menuButton);
    expect(await screen.findByText('DeclarationValidationsView: 1')).toBeInTheDocument();
  });

  it('keeps the declaration submenu hidden for parents and hides a zero badge', async () => {
    await renderWithRole('parent', [], 0, [{ id: 1, status: 'RECEIVED' }]);

    expect(screen.queryByTestId('sidebar-nav-absence-declaration-validations')).toBeNull();
  });

  it('hides the declaration badge for authorized staff when there are no RECEIVED declarations', async () => {
    await renderWithRole('school_admin', [], 0, [{ id: 1, status: 'ACCEPTED' }, { id: 2, status: 'REFUSED' }]);

    const menuButton = await screen.findByTestId('sidebar-nav-absence-declaration-validations');
    expect(within(menuButton).queryByText('0')).toBeNull();
  });

  it('refreshes the declaration badge after acceptance from the sidebar page', async () => {
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });
    let declarations = [{ id: 1, status: 'RECEIVED' }];
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/absence-declarations') return Promise.resolve(declarations);
      if (url === '/api/absence-declarations/1/review') {
        declarations = [{ id: 1, status: 'ACCEPTED' }];
        return Promise.resolve({ id: 1, status: 'ACCEPTED' });
      }
      return Promise.resolve([]);
    });

    render(<AuthProvider><App /></AuthProvider>);
    const menuButton = await screen.findByTestId('sidebar-nav-absence-declaration-validations');
    expect(within(menuButton).getByText('1')).toBeInTheDocument();
    fireEvent.click(menuButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Mock accept declaration' }));

    await waitFor(() => expect(within(menuButton).queryByText('1')).toBeNull());
    expect(mockApiFetch).toHaveBeenCalledWith('/api/absence-declarations/1/review', expect.objectContaining({ method: 'PUT' }));
  });


  it('displays a zero pending count and opens the dedicated validation view', async () => {
    await renderWithRole('school_admin', [], 0);

    const menuButton = await screen.findByTestId('sidebar-nav-absence-validations');
    expect(within(menuButton).getByText('0')).toBeInTheDocument();
    fireEvent.click(menuButton);

    expect(await screen.findByText('PendingReviewView')).toBeInTheDocument();
  });

  it('refreshes the dashboard summary when the window regains focus', async () => {
    await renderWithRole('school_admin', [], 0);

    await waitFor(() => expect(mockApiFetch.mock.calls.some(([url]) => url === '/api/dashboard/summary')).toBe(true));
    const requestsBeforeFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/dashboard/summary').length;
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      const requestsAfterFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/dashboard/summary').length;
      expect(requestsAfterFocus).toBeGreaterThan(requestsBeforeFocus);
    });
  });

  it('keeps an older full-list absence while the limited dashboard summary refreshes', async () => {
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });

    const olderAbsence = { id: 1, studentName: 'Absence ancienne' };
    const recentFive = Array.from({ length: 5 }, (_, index) => ({ id: 20 + index }));
    let deferNextFullResponse = false;
    let resolveDeferredFullResponse: ((absences: any[]) => void) | undefined;

    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/dashboard/summary') {
        return Promise.resolve({
          absenceStatusCounts: { justified: 0, unjustified: 0, pending: 1 },
          recentAbsences: recentFive,
        });
      }
      if (url === '/api/absences') {
        if (deferNextFullResponse) {
          deferNextFullResponse = false;
          return new Promise((resolve) => {
            resolveDeferredFullResponse = resolve;
          });
        }
        return Promise.resolve([olderAbsence, ...recentFive]);
      }
      if (url === '/api/schools' || url === '/api/academic-years' || url === '/api/teachers' || url === '/api/parents' || url === '/api/evaluations' || url === '/api/grades' || url === '/api/notifications' || url === '/api/simulation/users') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<AuthProvider><App /></AuthProvider>);
    const absenceNavigation = (await screen.findAllByTestId('sidebar-nav-absences'))[0];
    fireEvent.click(absenceNavigation);
    await waitFor(() => expect(screen.getByTestId('mock-absence-ids')).toHaveTextContent(/^1,/));

    deferNextFullResponse = true;
    resolveDeferredFullResponse = undefined;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(resolveDeferredFullResponse).toBeTypeOf('function'));

    expect(screen.getByTestId('mock-absence-ids')).toHaveTextContent(/^1,/);
    expect(recentFive.some((absence) => absence.id === olderAbsence.id)).toBe(false);

    await act(async () => {
      resolveDeferredFullResponse?.([olderAbsence, ...recentFive]);
    });
    await waitFor(() => expect(screen.getByTestId('mock-absence-ids')).toHaveTextContent(/^1,/));

    deferNextFullResponse = true;
    resolveDeferredFullResponse = undefined;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(resolveDeferredFullResponse).toBeTypeOf('function'));
    await act(async () => {
      resolveDeferredFullResponse?.([...recentFive]);
    });

    await waitFor(() => expect(screen.getByTestId('mock-absence-ids').textContent).toBe('20,21,22,23,24'));
  });

  it.each([
    ['APPROVED', 'Mock approve pending'],
    ['REJECTED', 'Mock reject pending'],
  ] as const)('refreshes the backend badge after %s review', async (status, buttonName) => {
    let reviewCompleted = false;
    let summaryRequests = 0;
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/dashboard/summary') {
        summaryRequests += 1;
        return Promise.resolve({ absenceStatusCounts: { justified: 0, unjustified: 0, pending: reviewCompleted ? 1 : 2 } });
      }
      if (url === '/api/absences/30/justification/review') {
        reviewCompleted = true;
        return Promise.resolve({ justificationStatus: status });
      }
      if (url === '/api/schools' || url === '/api/academic-years' || url === '/api/teachers' || url === '/api/parents' || url === '/api/evaluations' || url === '/api/grades' || url === '/api/notifications' || url === '/api/simulation/users') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<AuthProvider><App /></AuthProvider>);
    const menuButton = await screen.findByTestId('sidebar-nav-absence-validations');
    expect(within(menuButton).getByText('2')).toBeInTheDocument();
    fireEvent.click(menuButton);
    fireEvent.click(await screen.findByRole('button', { name: buttonName }));

    await waitFor(() => expect(within(menuButton).getByText('1')).toBeInTheDocument());
    expect(mockApiFetch).toHaveBeenCalledWith('/api/absences/30/justification/review', expect.objectContaining({ method: 'PUT' }));
    expect(summaryRequests).toBeGreaterThan(1);
  });
});
