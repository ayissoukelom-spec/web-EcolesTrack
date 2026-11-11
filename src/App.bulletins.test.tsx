import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';

const mockApiFetch = vi.hoisted(() => vi.fn());
const mockCountOverdueEvaluations = vi.hoisted(() => vi.fn());
const mockGetSimulatedRole = vi.hoisted(() => vi.fn(() => 'school_admin'));
const mockGetSimulatedUser = vi.hoisted(() => vi.fn((): {
  uid: string;
  email: string;
  name: string;
  schoolId: number | null;
  role: string;
  id: number;
  phone?: string;
} => ({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 })));
const mockGetActiveSchoolId = vi.hoisted(() => vi.fn(() => 1));
const mockSetSimulatedRole = vi.hoisted(() => vi.fn());
const mockSetActiveSchoolId = vi.hoisted(() => vi.fn());
const mockSetSimulatedUser = vi.hoisted(() => vi.fn());
const mockUseRealNotesView = vi.hoisted(() => ({ value: false }));
const mockGroupedPublicationApi = vi.hoisted(() => ({
  getAvailability: vi.fn(),
  getOptions: vi.fn(),
  submit: vi.fn(),
}));

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
  setSimulatedRole: mockSetSimulatedRole,
  clearSimulatedRole: vi.fn(),
  clearSimulatedUser: vi.fn(),
  getSimulatedSchoolId: () => 1,
  getActiveSchoolId: () => mockGetActiveSchoolId(),
  getSimulatedUser: () => mockGetSimulatedUser(),
  setActiveSchoolId: mockSetActiveSchoolId,
  setSimulatedUser: mockSetSimulatedUser,
  findTeacherProfileFromSimulatedUser: () => null,
}));

vi.mock('./lib/evaluationUtils.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/evaluationUtils.ts')>(),
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
  default: ({ absencesList = [], pendingReviewOnly, onReviewAbsence, onReexamineAbsenceJustification }: {
    absencesList?: Array<{ id: number }>;
    pendingReviewOnly?: boolean;
    onReviewAbsence?: (id: number, status: 'APPROVED' | 'REJECTED', rejectionReason?: string) => Promise<void>;
    onReexamineAbsenceJustification?: (id: number) => Promise<void>;
  }) => (
    <>
      <div>{pendingReviewOnly ? 'PendingReviewView' : 'AbsenceView'}</div>
      <div data-testid="mock-absence-ids">{absencesList.map((absence) => absence.id).join(',')}</div>
      {onReexamineAbsenceJustification && (
        <button onClick={() => onReexamineAbsenceJustification(30)}>Mock reexamine rejected</button>
      )}
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
vi.mock('./components/NotesView.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/NotesView.tsx')>();
  return {
    default: (props: any) => mockUseRealNotesView.value
      ? <actual.default {...props} />
      : (
        <>
          <div>NotesView</div>
          {props.onAddGrade && <button onClick={() => props.onAddGrade({ evaluationId: 42, studentId: 7, score: '14', remarks: '' })}>Mock save grade</button>}
          <div data-testid="mock-grades">{JSON.stringify(props.gradesList || [])}</div>
        </>
      ),
  };
});
vi.mock('./lib/groupedEvaluationPublicationApi.ts', () => ({
  getGroupedEvaluationPublicationAvailability: mockGroupedPublicationApi.getAvailability,
  getGroupedEvaluationPublicationOptions: mockGroupedPublicationApi.getOptions,
  getGroupedEvaluationValidationContext: (options: unknown) => options,
  submitGroupedEvaluationPublication: mockGroupedPublicationApi.submit,
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
    mockUseRealNotesView.value = false;
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
    mockGroupedPublicationApi.getAvailability.mockReset();
    mockGroupedPublicationApi.getOptions.mockReset();
    mockGroupedPublicationApi.submit.mockReset();
    mockSetSimulatedRole.mockReset();
    mockSetActiveSchoolId.mockReset();
    mockSetSimulatedUser.mockReset();
    mockGetActiveSchoolId.mockReturnValue(1);
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

  it('switches from a suspended school to an authorized active function without reusing the old context', async () => {
    mockGetSimulatedRole.mockReturnValue('teacher');
    mockGetActiveSchoolId.mockReturnValue(10);
    mockGetSimulatedUser.mockReturnValue({
      uid: 'teacher-multi-school',
      email: 'teacher@example.test',
      name: 'Teacher',
      schoolId: 10,
      role: 'teacher',
      id: 41,
    });

    localStorageMock.setItem('ecoletrack_jwt_access', 'old-school-token');
    localStorageMock.setItem('ecoletrack_active_school_id', '10');
    const tokenAtRequest: Array<{ url: string; token: string | null }> = [];
    mockApiFetch.mockImplementation((url: string, options?: RequestInit) => {
      tokenAtRequest.push({ url, token: localStorageMock.getItem('ecoletrack_jwt_access') });
      if (url === '/api/auth/schools') {
        return Promise.resolve({
          schools: [
            { id: 10, name: 'École suspendue', isSuspended: true },
            { id: 20, name: 'École active', isSuspended: false },
          ],
          memberships: [
            { membershipId: 101, schoolId: 10, role: 'teacher', isActive: true },
            { membershipId: 201, schoolId: 20, role: 'parent', isActive: true },
            { membershipId: 202, schoolId: 20, role: 'school_admin', isActive: true },
            { membershipId: 203, schoolId: 20, role: 'surveillant', isActive: false },
          ],
        });
      }
      if (url === '/api/auth/context/active') {
        expect(JSON.parse(String(options?.body))).toEqual({
          kind: 'local',
          schoolId: 20,
          role: 'parent',
        });
        return Promise.resolve({ token: 'new-school-parent-token', schoolId: 20, role: 'parent' });
      }
      if (url === '/api/teacher-control/statistics') return Promise.resolve({ pendingRegularizations: 0 });
      return Promise.resolve([]);
    });

    render(<AuthProvider><App /></AuthProvider>);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('schoolSuspended', { detail: { schoolId: 10 } }));
    });

    const schoolSelect = await screen.findByLabelText('École autorisée');
    fireEvent.change(schoolSelect, { target: { value: '20' } });
    const roleSelect = await screen.findByLabelText('Fonction');
    expect(within(roleSelect).queryByRole('option', { name: 'surveillant' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Accéder à cette école' })).toBeDisabled();
    fireEvent.change(roleSelect, { target: { value: 'parent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accéder à cette école' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/auth/context/active', expect.any(Object));
      expect(localStorageMock.getItem('ecoletrack_jwt_access')).toBe('new-school-parent-token');
      expect(mockSetActiveSchoolId).toHaveBeenCalledWith(20);
      expect(mockSetSimulatedRole).toHaveBeenCalledWith('parent');
      expect(mockSetSimulatedUser).toHaveBeenCalledWith(expect.objectContaining({
        id: 41,
        role: 'parent',
        schoolId: 20,
      }));
      expect(screen.queryByText('École suspendue')).toBeNull();
    });

    const contextIndex = tokenAtRequest.findIndex(({ url }) => url === '/api/auth/context/active');
    const postTransitionSync = tokenAtRequest.find(({ url }, index) => (
      index > contextIndex && url === '/api/auth/register-or-login'
    ));
    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(postTransitionSync?.token).toBe('new-school-parent-token');
    expect(tokenAtRequest.slice(contextIndex + 1).every(({ token }) => token !== 'old-school-token')).toBe(true);
  });

  it('does not start business-data requests for a local role before an active school context is restored', async () => {
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetActiveSchoolId.mockReturnValue(null);
    mockGetSimulatedUser.mockReturnValue({
      uid: 'school-admin-without-context',
      email: 'admin@example.test',
      name: 'Admin',
      schoolId: null,
      role: 'school_admin',
      id: 41,
    });
    localStorageMock.removeItem('ecoletrack_active_school_id');

    render(<AuthProvider><App /></AuthProvider>);
    await act(async () => Promise.resolve());

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(screen.getByText('LoginView')).toBeTruthy();

    mockGetActiveSchoolId.mockReturnValue(10);
    localStorageMock.setItem('ecoletrack_active_school_id', '10');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('simulatedUserChanged'));
    });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/dashboard/summary');
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

  it('shows and opens grouped publication from the real School Admin Notes view while publication is disabled', async () => {
    mockUseRealNotesView.value = true;
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({
      uid: 'sim-school-admin',
      email: 'admin@example.com',
      name: 'Admin',
      schoolId: 1,
      role: 'school_admin',
      id: 1,
    });
    mockGroupedPublicationApi.getAvailability.mockResolvedValue({ available: false });
    mockGroupedPublicationApi.getOptions.mockResolvedValue({
      available: true,
      classes: [{ id: 1, name: '6ème A' }],
      subjects: [{ id: 10, name: 'Mathématiques' }],
      approvedClassIds: [1],
      approvedSubjectIds: [10],
      activeTeachingPairs: [{ classId: 1, subjectId: 10 }],
      termsByClass: {
        1: [{ id: 100, startDate: '2026-10-01', endDate: '2026-12-31', academicYearId: 5, periodType: 'trimester', orderIndex: 1 }],
      },
    });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Navigation principale' });
    fireEvent.click(within(navigation).getByRole('button', { name: /Notes & Bulletins/i }));

    const groupedPublicationButton = await screen.findByRole('button', { name: 'Publication groupée' });
    expect(groupedPublicationButton).toBeVisible();
    fireEvent.click(groupedPublicationButton);

    expect(await screen.findByTestId('grouped-evaluation-publication-form')).toBeVisible();
    expect(screen.getByLabelText('Date de début')).toBeVisible();
    expect(screen.getByLabelText(/6ème A/)).toBeVisible();
    expect(screen.getByText(/publication réelle est désactivée/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publication réelle indisponible' })).toBeDisabled();
    expect(mockGroupedPublicationApi.submit).not.toHaveBeenCalled();
  });

  it('shows grouped publication in Notes for super_admin, not in the main menu, and loads the selected school', async () => {
    mockUseRealNotesView.value = true;
    mockGetSimulatedRole.mockReturnValue('super_admin');
    mockGetSimulatedUser.mockReturnValue({
      uid: 'sim-super-admin',
      email: 'superadmin@example.com',
      name: 'Super Admin',
      schoolId: null,
      role: 'super_admin',
      id: 1,
    });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/schools') return Promise.resolve([
        { id: 4, name: 'École A' },
        { id: 5, name: 'École B' },
      ]);
      return Promise.resolve([]);
    });
    mockGroupedPublicationApi.getAvailability.mockResolvedValue({ available: true });
    mockGroupedPublicationApi.getOptions.mockResolvedValue({
      available: true,
      classes: [{ id: 1, name: '6ème A' }],
      subjects: [{ id: 10, name: 'Mathématiques' }],
      approvedClassIds: [1],
      approvedSubjectIds: [10],
      activeTeachingPairs: [{ classId: 1, subjectId: 10 }],
      termsByClass: {
        1: [{ id: 100, startDate: '2026-10-01', endDate: '2026-12-31', academicYearId: 5, periodType: 'trimester', orderIndex: 1 }],
      },
    });

    render(<AuthProvider><App /></AuthProvider>);

    const navigation = await screen.findByRole('navigation', { name: 'Navigation principale' });
    expect(within(navigation).queryByRole('button', { name: 'Publication de devoirs groupés' })).toBeNull();
    fireEvent.click(within(navigation).getByRole('button', { name: /Notes & Bulletins/i }));
    const groupedPublicationButton = await screen.findByRole('button', { name: 'Publication groupée' });
    expect(groupedPublicationButton).toBeVisible();
    fireEvent.click(groupedPublicationButton);
    fireEvent.change(await screen.findByLabelText('Établissement'), { target: { value: '5' } });

    expect(await screen.findByLabelText(/6ème A/)).toBeVisible();
    expect(mockGroupedPublicationApi.getAvailability).toHaveBeenCalledWith(5);
    expect(mockGroupedPublicationApi.getOptions).toHaveBeenCalledWith(5);
  });

  it('routes super_admin from the actual sidebar Comptabilité entry to AccountingView', async () => {
    mockGetSimulatedRole.mockReturnValue('super_admin');
    mockGetSimulatedUser.mockReturnValue({
      uid: 'sim-super-admin',
      email: 'superadmin@example.com',
      name: 'Super Admin',
      schoolId: null,
      role: 'super_admin',
      id: 1,
    });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Navigation principale' });
    const accountingButton = within(navigation).getByRole('button', { name: 'Comptabilité' });
    expect(accountingButton).toBeEnabled();
    fireEvent.click(accountingButton);

    expect(await screen.findByTestId('accounting-view')).toHaveTextContent('super_admin');
  });

  it.each(['school_admin', 'teacher', 'parent', 'surveillant'] as const)(
    'shows Comptabilité disabled and does not open AccountingView for %s',
    async (role) => {
      mockGetSimulatedRole.mockReturnValue(role);
      mockGetSimulatedUser.mockReturnValue({
        uid: `sim-${role}`,
        email: `${role}@example.com`,
        name: role,
        schoolId: 1,
        role,
        id: 1,
      });

      render(
        <AuthProvider>
          <App />
        </AuthProvider>,
      );

      const navigation = await screen.findByRole('navigation', { name: 'Navigation principale' });
      const accountingButton = within(navigation).getByRole('button', { name: 'Comptabilité' });
      expect(accountingButton).toBeDisabled();
      expect(accountingButton).toHaveAttribute('aria-disabled', 'true');

      fireEvent.click(accountingButton);
      expect(screen.queryByTestId('accounting-view')).toBeNull();
    },
  );

  it('does not render AccountingView for school_admin when accounting is selected', async () => {
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

    expect(screen.queryByTestId('accounting-view')).toBeNull();
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
    const absenceGroup = await screen.findByTestId('absences-navigation-group');
    expect(await within(absenceGroup).findByRole('button', { name: /Contrôles Néant/i })).toBeTruthy();
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

  it('shows the teacher-specific name in the shared responsive navigation and opens the attendance module', async () => {
    await renderWithRole('teacher', []);

    const navigation = await screen.findByRole('navigation', { name: 'Navigation principale' });
    const absenceGroup = await screen.findByTestId('absences-navigation-group');
    const sidebar = document.getElementById('main-sidebar');
    expect(sidebar?.className).toContain('w-full');
    expect(sidebar?.className).toContain('lg:w-64');
    const teacherControlButton = within(navigation).getByRole('button', { name: 'Déclaration de présence' });
    expect(teacherControlButton).toBeEnabled();
    expect(within(absenceGroup).queryByTestId('sidebar-nav-absence-controls')).toBeNull();

    fireEvent.click(teacherControlButton);
    expect(await screen.findByRole('heading', { name: 'Déclaration de présence' })).toBeTruthy();
  });

  it.each(['school_admin', 'super_admin'])('%s keeps the administrative module name in the shared responsive navigation', async (role) => {
    await renderWithRole(role, []);

    const homeNavigation = await screen.findByRole('navigation', { name: 'Accueil' });
    const navigation = await screen.findByRole('navigation', { name: 'Navigation principale' });
    const absenceGroup = await screen.findByTestId('absences-navigation-group');
    const sidebar = document.getElementById('main-sidebar');
    expect(sidebar?.className).toContain('w-full');
    expect(sidebar?.className).toContain('lg:w-64');
    expect(within(homeNavigation).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Tableau de Bord',
    ]);
    expect(within(navigation).getAllByRole('button').slice(0, 2).map((button) => button.textContent?.trim())).toEqual([
      'Administration',
      'Contrôle des enseignants',
    ]);
    expect(homeNavigation.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(navigation).getByRole('button', { name: 'Contrôle des enseignants' })).toBeEnabled();
    expect(within(navigation).queryByRole('button', { name: 'Déclaration de présence' })).toBeNull();
    expect(within(absenceGroup).queryByTestId('sidebar-nav-absence-controls') !== null).toBe(role === 'school_admin');
  });

  it.each([
    ['school_admin', 'Régularisations à traiter', '/api/teacher-control/statistics'],
    ['super_admin', 'Régularisations à traiter', '/api/teacher-control/statistics/global'],
    ['teacher', 'Régularisations en attente', '/api/teacher-control/statistics'],
  ] as const)('%s has independent teacher-control and regularization navigation destinations', async (role, label, statisticsEndpoint) => {
    mockGetSimulatedRole.mockReturnValue(role);
    mockGetSimulatedUser.mockReturnValue({
      uid: `sim-${role}`,
      email: `${role}@example.com`,
      name: role,
      schoolId: role === 'super_admin' ? null : 1,
      role,
      id: 1,
    });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === statisticsEndpoint) return Promise.resolve({
        totalSessions: 0,
        openSessions: 0,
        completedSessions: 0,
        incompleteSessions: 0,
        regularizedSessions: 0,
        pendingRegularizations: 3,
        validatedDurationMilliseconds: 0,
        estimatedCompensationXof: 0,
        ...(role === 'super_admin' ? { schools: [] } : {}),
      });
      if (url === '/api/teacher-control/regularizations') return Promise.resolve([]);
      if (url === '/api/teacher-control/assignments') return Promise.resolve([]);
      if (url.startsWith('/api/teacher-control/sessions')) return Promise.resolve([]);
      if (url.startsWith('/api/teacher-control/statistics')) return Promise.resolve({
        totalSessions: 0,
        openSessions: 0,
        completedSessions: 0,
        incompleteSessions: 0,
        regularizedSessions: 0,
        pendingRegularizations: 3,
        validatedDurationMilliseconds: 0,
        estimatedCompensationXof: 0,
        ...(role === 'super_admin' ? { schools: [] } : {}),
      });
      if (url.startsWith('/api/teacher-control/gps-settings')) return Promise.resolve({ geofenceRadiusMeters: 200 });
      if (url === '/api/teacher-control/regularizations') return Promise.resolve([]);
      if (url === '/api/schools' || url === '/api/academic-years' || url === '/api/teachers'
        || url === '/api/parents' || url === '/api/evaluations' || url === '/api/grades'
        || url === '/api/notifications' || url === '/api/simulation/users') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<AuthProvider><App /></AuthProvider>);
    const regularizationsMenu = await screen.findByTestId('sidebar-nav-regularizations');
    expect(within(regularizationsMenu).getByText('3')).toBeInTheDocument();
    expect(within(regularizationsMenu).getByText(label)).toBeInTheDocument();
    expect(mockApiFetch).toHaveBeenCalledWith(statisticsEndpoint, expect.objectContaining({ cache: 'no-store' }));

    fireEvent.click(regularizationsMenu);
    const teacherControlMenu = await screen.findByTestId('sidebar-nav-teacher-control');
    expect(regularizationsMenu.className).toContain('bg-indigo-100');
    expect(teacherControlMenu.className).not.toContain('bg-indigo-600');
    if (role === 'super_admin') {
      expect(await screen.findByRole('region', { name: 'Régularisations à traiter' })).toBeInTheDocument();
    } else {
      expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('Paramètres de contrôle GPS')).toBeNull();
    expect(screen.queryByText('Statistiques par établissement')).toBeNull();

    fireEvent.click(teacherControlMenu);
    await waitFor(() => expect(teacherControlMenu.className).toContain('bg-indigo-600'));
    expect(teacherControlMenu.className).toContain('bg-indigo-600');
    expect(regularizationsMenu.className).not.toContain('bg-indigo-100');
    if (role === 'super_admin') {
      expect(await screen.findByRole('heading', { name: 'Statistiques par établissement' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Régularisations à traiter' })).toBeNull();
    } else {
      expect(await screen.findByRole('tab', { name: 'Séances' })).toHaveAttribute('aria-selected', 'true');
    }

    fireEvent.click(regularizationsMenu);
    expect(regularizationsMenu.className).toContain('bg-indigo-100');
    expect(teacherControlMenu.className).not.toContain('bg-indigo-600');
    if (role === 'super_admin') {
      expect(await screen.findByRole('region', { name: 'Régularisations à traiter' })).toBeInTheDocument();
    } else {
      expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it.each([
    ['school_admin', 'Contrôle des enseignants'],
    ['teacher', 'Déclaration de présence'],
  ] as const)('%s prepares the teacher-control view before activating its navigation destination', async (role, title) => {
    mockGetSimulatedRole.mockReturnValue(role);
    mockGetSimulatedUser.mockReturnValue({
      uid: `sim-${role}`,
      email: `${role}@example.com`,
      name: role,
      schoolId: 1,
      role,
      id: 1,
    });

    let releaseModuleRequests!: () => void;
    const moduleRequestsGate = new Promise<void>((resolve) => {
      releaseModuleRequests = resolve;
    });
    const statistics = {
      totalSessions: 4,
      openSessions: 1,
      completedSessions: 3,
      incompleteSessions: 0,
      regularizedSessions: 0,
      pendingRegularizations: 0,
      validatedDurationMilliseconds: 0,
      estimatedCompensationXof: 0,
    };
    mockApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/teacher-control/')) {
        return moduleRequestsGate.then(() => {
          if (url.startsWith('/api/teacher-control/filter-options')) {
            return { teachers: [], classes: [], subjects: [] };
          }
          if (url.startsWith('/api/teacher-control/statistics')) return statistics;
          if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
          if (url.startsWith('/api/teacher-control/gps-settings')) {
            return { schoolId: 1, isEnabled: false, geofenceRadiusMeters: 200 };
          }
          if (url === '/api/teacher-control/assignments') return [];
          return [];
        });
      }
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/schools' || url === '/api/academic-years' || url === '/api/teachers'
        || url === '/api/parents' || url === '/api/evaluations' || url === '/api/grades'
        || url === '/api/notifications' || url === '/api/simulation/users') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<AuthProvider><App /></AuthProvider>);
    const menu = await screen.findByTestId('sidebar-nav-teacher-control');
    expect(await screen.findByText('DashboardView')).toBeInTheDocument();

    fireEvent.click(menu);
    expect(menu.className).not.toContain('bg-indigo-600');
    expect(screen.getByText('DashboardView')).toBeInTheDocument();
    expect(mockApiFetch.mock.calls.some(([url]) => url.startsWith('/api/teacher-control/sessions'))).toBe(true);

    await act(async () => releaseModuleRequests());

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByTestId('teacher-control-statistics-grid')).toBeInTheDocument();
    expect(within(screen.getByTestId('teacher-control-statistics-grid')).getByText('4')).toBeInTheDocument();
    expect(menu.className).toContain('bg-indigo-600');
  });

  it('renders absence and teacher-control destinations as expandable nested menus', async () => {
    await renderWithRole('school_admin', [], 0, [{ id: 1, status: 'RECEIVED' }]);

    const absenceGroup = await screen.findByTestId('absences-navigation-group');
    const teacherControlGroup = await screen.findByTestId('teacher-control-navigation-group');
    const absenceParent = within(absenceGroup).getByTestId('sidebar-nav-absences');
    const teacherControlParent = within(teacherControlGroup).getByTestId('sidebar-nav-teacher-control');
    const absenceSubmenu = within(absenceGroup).getByTestId('absences-submenu');
    const teacherControlSubmenu = within(teacherControlGroup).getByTestId('teacher-control-submenu');
    const navigation = screen.getByRole('navigation', { name: 'Navigation principale' });
    const navigationIcons = within(navigation).getAllByTestId('sidebar-navigation-icon');
    const mainMenuButtons = Array.from(navigation.querySelectorAll('button:not([data-nav-child="true"]):not([aria-controls])'));
    const absenceControlsEntry = within(absenceSubmenu).getByTestId('sidebar-nav-absence-controls');
    const teacherControlIcon = within(teacherControlParent).getByTestId('sidebar-nav-teacher-control-icon');

    expect(absenceSubmenu.className).toContain('ml-5');
    expect(absenceSubmenu.className).toContain('border-l');
    expect(teacherControlSubmenu.className).toContain('ml-5');
    expect(within(absenceSubmenu).getByTestId('sidebar-nav-absence-declaration-validations')).toBeInTheDocument();
    expect(within(absenceSubmenu).getByTestId('sidebar-nav-absence-validations')).toBeInTheDocument();
    expect(within(teacherControlSubmenu).getByTestId('sidebar-nav-regularizations')).toBeInTheDocument();
    expect(absenceControlsEntry).toHaveAttribute('data-nav-child', 'true');
    expect(within(navigation).getAllByTestId('sidebar-nav-absence-controls')).toHaveLength(1);
    expect(within(teacherControlParent).getByText('Contrôle des enseignants').parentElement).toHaveClass('gap-3', 'px-3.5');
    expect(teacherControlIcon).toHaveClass('h-5', 'w-5');
    expect(teacherControlIcon.querySelector('svg')).toHaveClass('h-5', 'w-5');
    expect(navigationIcons.length).toBeGreaterThan(10);
    navigationIcons.forEach((icon) => expect(icon).toHaveClass('h-5', 'w-5', 'shrink-0'));
    mainMenuButtons.forEach((menuButton) => {
      expect(menuButton).toHaveClass('px-3.5');
      expect(menuButton.querySelector('[data-nav-icon="true"]')).toHaveClass('w-5');
      expect(menuButton.querySelector('span.text-left')).not.toBeNull();
    });
    [absenceSubmenu, teacherControlSubmenu].forEach((submenu) => {
      expect(submenu).toHaveClass('ml-5', 'pl-3');
      within(submenu).getAllByRole('button').forEach((submenuButton) => {
        expect(submenuButton).toHaveClass('gap-2', 'px-3');
        expect(within(submenuButton).getByTestId('sidebar-navigation-icon')).toHaveClass('w-5');
        expect(submenuButton.querySelector('span.text-left')).not.toBeNull();
      });
    });

    fireEvent.click(within(absenceGroup).getByRole('button', { name: 'Réduire le sous-menu' }));
    expect(screen.queryByTestId('absences-submenu')).toBeNull();
    expect(absenceParent).toBeInTheDocument();
    fireEvent.click(within(absenceGroup).getByRole('button', { name: 'Développer le sous-menu' }));
    expect(screen.getByTestId('absences-submenu')).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('absences-submenu')).getByTestId('sidebar-nav-absence-declaration-validations'));
    expect(await screen.findByText('DeclarationValidationsView: 1')).toBeInTheDocument();
    expect(screen.getByTestId('absences-submenu')).toBeInTheDocument();
    expect(absenceGroup.className).toContain('bg-indigo-50/70');
    expect(absenceParent).not.toHaveClass('bg-indigo-600');

    fireEvent.click(within(screen.getByTestId('absences-submenu')).getByTestId('sidebar-nav-absence-controls'));
    expect(await screen.findByRole('heading', { name: 'Contrôles Néant' })).toBeInTheDocument();
    expect(screen.getByTestId('absences-submenu')).toBeInTheDocument();
    expect(absenceGroup.className).toContain('bg-indigo-50/70');

    fireEvent.click(within(teacherControlGroup).getByRole('button', { name: 'Réduire le sous-menu' }));
    expect(screen.queryByTestId('teacher-control-submenu')).toBeNull();
    expect(teacherControlParent).toBeInTheDocument();
    fireEvent.click(within(teacherControlGroup).getByRole('button', { name: 'Développer le sous-menu' }));
    expect(screen.getByTestId('teacher-control-submenu')).toBeInTheDocument();
  });

  it('refreshes an administrator regularization badge from backend statistics on window focus', async () => {
    let pendingCount = 0;
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/teacher-control/statistics') return Promise.resolve({
        totalSessions: 0,
        openSessions: 0,
        completedSessions: 0,
        incompleteSessions: 0,
        regularizedSessions: 0,
        pendingRegularizations: pendingCount,
        validatedDurationMilliseconds: 0,
        estimatedCompensationXof: 0,
      });
      if (url === '/api/teacher-control/regularizations') return Promise.resolve([]);
      if (url.startsWith('/api/teacher-control/sessions')) return Promise.resolve([]);
      if (url.startsWith('/api/teacher-control/statistics')) return Promise.resolve({
        pendingRegularizations: pendingCount,
        totalSessions: 0,
        openSessions: 0,
        completedSessions: 0,
        incompleteSessions: 0,
        regularizedSessions: 0,
        validatedDurationMilliseconds: 0,
        estimatedCompensationXof: 0,
      });
      if (url === '/api/schools' || url === '/api/academic-years' || url === '/api/teachers'
        || url === '/api/parents' || url === '/api/evaluations' || url === '/api/grades'
        || url === '/api/notifications' || url === '/api/simulation/users') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    render(<AuthProvider><App /></AuthProvider>);
    const regularizationsMenu = await screen.findByTestId('sidebar-nav-regularizations');
    expect(within(regularizationsMenu).queryByText('1')).toBeNull();

    pendingCount = 1;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(within(regularizationsMenu).getByText('1')).toBeInTheDocument());

    pendingCount = 0;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(within(regularizationsMenu).queryByText('1')).toBeNull());
  });

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

  it.each(['school_admin', 'super_admin', 'surveillant', 'teacher'])(
    'keeps the existing dashboard refresh on focus for %s',
    async (role) => {
      await renderWithRole(role, [], 0);

      await waitFor(() => expect(mockApiFetch.mock.calls.some(([url]) => url === '/api/dashboard/summary')).toBe(true));
      const requestsBeforeFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/dashboard/summary').length;
      window.dispatchEvent(new Event('focus'));

      await waitFor(() => {
        const requestsAfterFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/dashboard/summary').length;
        expect(requestsAfterFocus).toBeGreaterThan(requestsBeforeFocus);
      });
    },
  );

  it('checks a parent session through the protected notifications API when the window regains focus', async () => {
    await renderWithRole('parent', [], 0);

    await waitFor(() => expect(document.getElementById('sidebar-nav-parent-grades')).toBeTruthy());
    const requestsBeforeFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/notifications').length;
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      const requestsAfterFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/notifications').length;
      expect(requestsAfterFocus).toBeGreaterThan(requestsBeforeFocus);
    });
    expect(localStorage.getItem('ecoletrack_jwt_access')).toBe('jwt-token');
  });

  it.each([
    ['network failure', new TypeError('Network unavailable')],
    ['403 permission error', Object.assign(new Error('Forbidden'), { status: 403 })],
  ])('keeps the parent session on focus after a %s', async (_scenario, error) => {
    await renderWithRole('parent', [], 0);

    await waitFor(() => expect(document.getElementById('sidebar-nav-parent-grades')).toBeTruthy());
    const requestsBeforeFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/notifications').length;
    mockApiFetch.mockImplementation((url: string) => (
      url === '/api/notifications' ? Promise.reject(error) : Promise.resolve([])
    ));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      const requestsAfterFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/notifications').length;
      expect(requestsAfterFocus).toBeGreaterThan(requestsBeforeFocus);
    });
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());

    expect(localStorage.getItem('ecoletrack_jwt_access')).toBe('jwt-token');
    warnSpy.mockRestore();
  });

  it('does not send concurrent parent session checks for closely spaced focus events', async () => {
    await renderWithRole('parent', [], 0);

    await waitFor(() => expect(document.getElementById('sidebar-nav-parent-grades')).toBeTruthy());
    const requestsBeforeFocus = mockApiFetch.mock.calls.filter(([url]) => url === '/api/notifications').length;
    let resolveFocusCheck: ((value: unknown) => void) | undefined;
    mockApiFetch.mockImplementation((url: string) => (
      url === '/api/notifications'
        ? new Promise((resolve) => {
          resolveFocusCheck = resolve;
        })
        : Promise.resolve([])
    ));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(mockApiFetch.mock.calls.filter(([url]) => url === '/api/notifications')).toHaveLength(requestsBeforeFocus + 1);
    await act(async () => {
      resolveFocusCheck?.([]);
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

  it('wires the reexamination action in the live Absences navigation', async () => {
    mockGetSimulatedRole.mockReturnValue('school_admin');
    mockGetSimulatedUser.mockReturnValue({ uid: 'sim-school-admin', email: 'admin@example.com', name: 'Admin', schoolId: 1, role: 'school_admin', id: 1 });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/api/auth/register-or-login') return Promise.resolve({});
      if (url === '/api/schools' || url === '/api/academic-years' || url === '/api/teachers' || url === '/api/parents' || url === '/api/evaluations' || url === '/api/grades' || url === '/api/notifications' || url === '/api/simulation/users') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<AuthProvider><App /></AuthProvider>);
    fireEvent.click((await screen.findAllByTestId('sidebar-nav-absences'))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Mock reexamine rejected' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/absences/30/justification/reexamine',
        expect.objectContaining({ method: 'PUT', body: '{}' }),
      );
    });
  });
});
