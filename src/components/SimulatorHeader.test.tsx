// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SimulatorHeader from './SimulatorHeader';

vi.mock('../contexts/AuthContext.tsx', () => ({
  useAuth: () => ({
    user: { id: 1, uid: 'super-admin', email: 'super@example.test', name: 'Super Admin' },
    role: 'super_admin',
  }),
}));

const schools = [
  { id: 25, name: 'École A', address: '', phone: '' },
  { id: 26, name: 'École B', address: '', phone: '' },
];

const subjectsBySchool: Record<string, any[]> = {
  '25': [
    { id: 501, name: 'Mathématiques', schoolId: null, status: 'approved' },
    { id: 502, name: 'Français', schoolId: null, status: 'approved' },
  ],
  '26': [
    { id: 501, name: 'Mathématiques', schoolId: null, status: 'approved' },
    { id: 503, name: 'Physique', schoolId: null, status: 'approved' },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockApi(subjectRows: Record<string, any[]> = subjectsBySchool) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    requests.push({ url: url.toString(), init });

    if (url.pathname === '/api/classes') {
      return jsonResponse([{ id: 53, name: 'Classe de test', schoolId: Number(url.searchParams.get('schoolId')) }]);
    }
    if (url.pathname === '/api/subjects') {
      return jsonResponse(subjectRows[url.searchParams.get('schoolId') || ''] || []);
    }
    if (url.pathname === '/api/admin/users') {
      return jsonResponse({ id: 80, role: 'teacher' }, 201);
    }
    return jsonResponse([]);
  });
  return requests;
}

function renderHeader() {
  return render(
    <SimulatorHeader
      currentRole="super_admin"
      schoolsList={schools as any}
      classesList={[]}
      teachersList={[]}
      usersList={[]}
      studentsList={[]}
      parentsList={[]}
      yearsList={[]}
      approvedSubjectsList={[]}
      onRoleChange={() => undefined}
      onRefreshData={() => undefined}
      isSyncing={false}
    />,
  );
}

function openCreateTeacherAccount() {
  const profileButton = document.getElementById('btn-sim-profile');
  if (!profileButton) throw new Error('Bouton profil absent');
  fireEvent.click(profileButton);
  fireEvent.click(screen.getByRole('button', { name: /Créer un compte/ }));
}

function selectSchool(schoolId: number) {
  const schoolSelect = screen.getAllByRole('combobox').find((element) => (
    element instanceof HTMLSelectElement
    && Array.from(element.options).some((option) => option.value === String(schoolId))
  ));
  if (!schoolSelect) throw new Error(`École ${schoolId} absente du formulaire`);
  fireEvent.change(schoolSelect, { target: { value: String(schoolId) } });
}

async function selectTestClass() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Classe de test' }));
}

function fillRequiredTeacherFields() {
  fireEvent.change(screen.getByPlaceholderText('Dupont'), { target: { value: 'Dupont' } });
  fireEvent.change(screen.getByPlaceholderText('Jean'), { target: { value: 'Jean' } });
  fireEvent.change(screen.getByPlaceholderText('email@exemple.fr'), { target: { value: 'jean@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('90000000'), { target: { value: '90000000' } });
  const genderSelect = screen.getAllByRole('combobox').find((element) => (
    element instanceof HTMLSelectElement && element.querySelector('option[value="M"]')
  ));
  if (!genderSelect) throw new Error('Sélecteur de sexe absent');
  fireEvent.change(genderSelect, { target: { value: 'M' } });
}

describe('SimulatorHeader Super Admin teacher account subjects', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows one option when the school-scoped response repeats a subject ID', async () => {
    mockApi({
      '25': [
        { id: 501, name: 'Mathématiques', status: 'approved' },
        { id: 501, name: 'Mathématiques', status: 'approved' },
      ],
    });
    renderHeader();
    openCreateTeacherAccount();
    selectSchool(25);

    expect(await screen.findAllByRole('checkbox', { name: 'Mathématiques' })).toHaveLength(1);
  });

  it('requests and displays only the selected school approved subjects', async () => {
    const requests = mockApi();
    renderHeader();
    openCreateTeacherAccount();
    selectSchool(25);

    expect(await screen.findByRole('checkbox', { name: 'Français' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Mathématiques' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Physique' })).toBeNull();
    expect(requests.some(({ url }) => url.includes('/api/subjects?schoolId=25&approvedOnly=true'))).toBe(true);
  });

  it('removes selected subjects unavailable after changing schools', async () => {
    mockApi();
    renderHeader();
    openCreateTeacherAccount();
    selectSchool(25);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Mathématiques' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Français' }));
    selectSchool(26);

    const physics = await screen.findByRole('checkbox', { name: 'Physique' });
    expect(physics).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Français' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Mathématiques' }) as HTMLInputElement).checked).toBe(true);
  });

  it('sends each selected subject ID once in the account creation payload', async () => {
    const requests = mockApi({
      '25': [
        { id: 501, name: 'Mathématiques', status: 'approved' },
        { id: 501, name: 'Mathématiques', status: 'approved' },
      ],
    });
    renderHeader();
    openCreateTeacherAccount();
    selectSchool(25);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Mathématiques' }));
    await selectTestClass();
    fillRequiredTeacherFields();
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));

    await waitFor(() => expect(requests.some(({ url }) => url.includes('/api/admin/users'))).toBe(true));
    const createRequest = requests.find(({ url }) => url.includes('/api/admin/users'));
    const payload = JSON.parse(String(createRequest?.init?.body));
    expect(payload).toMatchObject({ role: 'teacher', schoolId: 25, subjectIds: [501] });
  });
});