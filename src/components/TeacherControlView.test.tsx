import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeacherControlView from './TeacherControlView';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../lib/api.ts', () => ({ apiFetch: apiFetchMock }));

const session = {
  id: 1,
  schoolId: 8,
  schoolNameSnapshot: 'École A',
  teacherId: 20,
  teacherNameSnapshot: 'Afi Mensah',
  classId: 30,
  classNameSnapshot: '6e A',
  subjectId: 40,
  subjectNameSnapshot: 'Mathématiques',
  status: 'open',
  startedAt: '2026-10-31T08:00:00.000Z',
  validatedEndedAt: null,
  endSource: null,
  startDistanceMeters: 12,
  startAccuracyMeters: 25,
  startGeofenceRadiusMeters: 200,
  endDistanceMeters: null,
  endAccuracyMeters: null,
  endGeofenceRadiusMeters: null,
  closeReason: null,
  hourlyRateXofSnapshot: 1500,
  durationMilliseconds: null,
  estimatedAmountXof: null,
};

const defaultProps = {
  userRole: 'teacher' as const,
  activeSchoolId: 8,
  schoolsList: [{ id: 8, name: 'École A' }],
  teachersList: [],
  superAdminSchoolFilterId: null,
  onSuperAdminSchoolFilterChange: () => undefined,
};

function configureTeacherApi() {
  apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/teacher-control/sessions')) return [];
    if (url.startsWith('/api/teacher-control/statistics')) {
      return {
        totalSessions: 0,
        openSessions: 0,
        completedSessions: 0,
        incompleteSessions: 0,
        regularizedSessions: 0,
        pendingRegularizations: 0,
        validatedDurationMilliseconds: 0,
        estimatedCompensationXof: 0,
      };
    }
    if (url === '/api/teacher-control/regularizations') return [];
    if (url === '/api/teacher-control/assignments') {
      return [
        {
          assignmentId: 9,
          classId: 30,
          className: '6e A',
          subjectId: 40,
          subjectName: 'Mathématiques',
        },
        {
          assignmentId: 10,
          classId: 31,
          className: '5e B',
          subjectId: 41,
          subjectName: 'Histoire-Géographie',
        },
      ];
    }
    return {};
  });
}

function configureAdminGpsApi() {
  apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/teacher-control/filter-options')) {
      return { teachers: [], classes: [], subjects: [] };
    }
    if (url.startsWith('/api/teacher-control/sessions')) return [];
    if (url.startsWith('/api/teacher-control/statistics')) {
      return {
        totalSessions: 0,
        openSessions: 0,
        completedSessions: 0,
        incompleteSessions: 0,
        regularizedSessions: 0,
        pendingRegularizations: 0,
        validatedDurationMilliseconds: 0,
        estimatedCompensationXof: 0,
      };
    }
    if (url === '/api/teacher-control/regularizations') return [];
    if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
    if (url.startsWith('/api/teacher-control/gps-settings') && options?.method === 'PUT') return {};
    if (url.startsWith('/api/teacher-control/gps-settings')) {
      return {
        schoolId: 8,
        schoolName: 'École A',
        isEnabled: false,
        latitude: null,
        longitude: null,
        geofenceRadiusMeters: 200,
        updatedAt: null,
      };
    }
    return {};
  });
}

describe('TeacherControlView', () => {
  let originalPermissionsPolicyDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    apiFetchMock.mockReset();
    originalPermissionsPolicyDescriptor = Object.getOwnPropertyDescriptor(document, 'permissionsPolicy');
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
    if (originalPermissionsPolicyDescriptor) {
      Object.defineProperty(document, 'permissionsPolicy', originalPermissionsPolicyDescriptor);
    } else {
      Reflect.deleteProperty(document, 'permissionsPolicy');
    }
  });

  it('opens the start form from one Début action without navigating or reloading', async () => {
    configureTeacherApi();
    render(<TeacherControlView {...defaultProps} />);

    expect(await screen.findByRole('heading', { name: 'Déclaration de présence' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Début' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fin' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Classe' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Début' }));
    expect(await screen.findByRole('combobox', { name: 'Classe' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Début' })).toHaveLength(1);
    expect(window.location.pathname).toBe('/');
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/teacher-document-session')).toBe(false);
  });

  it.each(['teacher', 'school_admin', 'super_admin'] as const)('%s dashboard statistics use the shared responsive dashboard card style', async (role) => {
    if (role === 'teacher') configureTeacherApi();
    else if (role === 'school_admin') configureAdminGpsApi();
    else {
      apiFetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/teacher-control/statistics/global') {
          return {
            totalSessions: 0,
            openSessions: 0,
            completedSessions: 0,
            incompleteSessions: 0,
            regularizedSessions: 0,
            pendingRegularizations: 0,
            validatedDurationMilliseconds: 0,
            estimatedCompensationXof: 0,
            schools: [],
          };
        }
        if (url === '/api/teacher-control/regularizations') return [];
        if (url.startsWith('/api/teacher-control/filter-options')) {
          return { teachers: [], classes: [], subjects: [] };
        }
        return {};
      });
    }

    render(
      <TeacherControlView
        {...defaultProps}
        userRole={role}
        activeSchoolId={role === 'super_admin' ? null : 8}
      />,
    );

    const grid = await screen.findByTestId('teacher-control-statistics-grid');
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('sm:grid-cols-2');
    expect(grid.className).toContain('xl:grid-cols-4');
    expect(grid.querySelectorAll('article')).toHaveLength(4);
    const durationCard = Array.from(grid.querySelectorAll('article')).find((card) => card.textContent?.includes('Durée validée'));
    expect(durationCard?.className).toContain('rounded-3xl');
    expect(durationCard?.className).toContain('bg-gradient-to-br');
    expect(durationCard?.className).toContain('hover:-translate-y-1');
    expect(durationCard?.querySelector('svg')).toBeTruthy();
  });

  it('shows readable admin filters and refreshes the super-admin school scope without stale selections', async () => {
    const globalSummary = {
      scope: 'global',
      totalSessions: 2,
      openSessions: 1,
      completedSessions: 1,
      incompleteSessions: 0,
      regularizedSessions: 0,
      pendingRegularizations: 0,
      validatedDurationMilliseconds: 0,
      estimatedCompensationXof: 0,
      schools: [],
    };
    const scopedStatistics = {
      totalSessions: 0,
      openSessions: 0,
      completedSessions: 0,
      incompleteSessions: 0,
      regularizedSessions: 0,
      pendingRegularizations: 0,
      validatedDurationMilliseconds: 0,
      estimatedCompensationXof: 0,
    };
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/teacher-control/filter-options')) {
        return url.includes('schoolId=9')
          ? {
            teachers: [{ id: 22, name: 'Kossi Doe' }],
            classes: [{ id: 32, name: '5e B' }],
            subjects: [{ id: 42, name: 'Histoire-Géographie' }],
          }
          : {
            teachers: [{ id: 20, name: 'Afi Mensah · École A' }, { id: 22, name: 'Kossi Doe · École B' }],
            classes: [{ id: 30, name: '6e A · École A' }, { id: 32, name: '5e B · École B' }],
            subjects: [{ id: 40, name: 'Mathématiques · École A' }, { id: 42, name: 'Histoire-Géographie · École B' }],
          };
      }
      if (url.startsWith('/api/teacher-control/statistics/global')) return globalSummary;
      if (url.startsWith('/api/teacher-control/sessions')) {
        return { items: [], nextCursor: null, hasMore: false, limit: 50, totalCount: 0 };
      }
      if (url.startsWith('/api/teacher-control/statistics')) return scopedStatistics;
      if (url.startsWith('/api/teacher-control/regularizations')) return [];
      if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
      if (url.startsWith('/api/teacher-control/gps-settings')) {
        return {
          schoolId: 9,
          schoolName: 'École B',
          isEnabled: false,
          latitude: null,
          longitude: null,
          geofenceRadiusMeters: 200,
          updatedAt: null,
        };
      }
      return {};
    });

    function SuperAdminView() {
      const [schoolFilterId, setSchoolFilterId] = React.useState<number | null>(null);
      return (
        <TeacherControlView
          {...defaultProps}
          userRole="super_admin"
          activeSchoolId={null}
          schoolsList={[{ id: 8, name: 'École A' }, { id: 9, name: 'École B' }]}
          superAdminSchoolFilterId={schoolFilterId}
          onSuperAdminSchoolFilterChange={setSchoolFilterId}
        />
      );
    }

    render(<SuperAdminView />);
    expect(await screen.findByText('Statistiques par établissement')).toBeTruthy();
    expect(screen.getByLabelText('Établissement')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Afi Mensah · École A' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '6e A · École A' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Mathématiques · École A' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Enseignant'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Classe'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Matière'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer les filtres' }));
    await waitFor(() => {
      expect(apiFetchMock.mock.calls.some(([url]) => typeof url === 'string'
        && url.startsWith('/api/teacher-control/statistics/global?')
        && url.includes('teacherId=20')
        && url.includes('classId=30')
        && url.includes('subjectId=40'))).toBe(true);
    });

    fireEvent.change(screen.getByLabelText('Établissement'), { target: { value: '9' } });
    expect(await screen.findByText('Super Administrateur · consultation par établissement · École B')).toBeTruthy();
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/api/teacher-control/filter-options?schoolId=9');
      expect(apiFetchMock.mock.calls.some(([url]) => typeof url === 'string'
        && url.startsWith('/api/teacher-control/statistics?schoolId=9'))).toBe(true);
    });
    expect(screen.getByLabelText('Enseignant')).toHaveValue('');
    expect(screen.getByLabelText('Classe')).toHaveValue('');
    expect(screen.getByLabelText('Matière')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Kossi Doe' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Afi Mensah · École A' })).toBeNull();
  });

  it('starts the selected exact assignment after a fresh GPS fix and shows server time read-only', async () => {
    configureTeacherApi();
    window.history.replaceState(null, '', '/teacher-control/teacher');
    const requestOrder: string[] = [];
    const getCurrentPosition = vi.fn((success: PositionCallback, _error?: PositionErrorCallback, options?: PositionOptions) => {
      requestOrder.push('geolocation');
      success({
        coords: { latitude: 6.1375, longitude: 1.2123, accuracy: 146 },
        timestamp: Date.now(),
      } as GeolocationPosition);
      expect(options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0, timeout: 45_000 });
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    apiFetchMock.mockImplementation(async (url: string) => {
      requestOrder.push(url);
      if (url === '/api/teacher-control/gps-challenges') return { challenge: 'a'.repeat(43) };
      if (url === '/api/teacher-control/sessions/start') return session;
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      if (url === '/api/teacher-control/assignments') {
        return [{
          assignmentId: 9,
          classId: 30,
          className: '6e A',
          subjectId: 40,
          subjectName: 'Mathématiques',
        }];
      }
      return {};
    });
    render(<TeacherControlView {...defaultProps} />);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Classe' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), { target: { value: '40' } });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/teacher-control/sessions/start',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const startCall = apiFetchMock.mock.calls.find(([url]) => url === '/api/teacher-control/sessions/start');
    expect(JSON.parse(startCall?.[1]?.body as string)).toMatchObject({
      classId: 30,
      subjectId: 40,
      latitude: 6.1375,
      longitude: 1.2123,
      accuracyMeters: 146,
      gpsChallenge: 'a'.repeat(43),
    });
    expect(JSON.parse(startCall?.[1]?.body as string)).not.toHaveProperty('timestamp');
    expect(requestOrder.indexOf('geolocation'))
      .toBeLessThan(requestOrder.indexOf('/api/teacher-control/gps-challenges'));
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: 'Précision GPS de début' })).toHaveValue('146');
    expect(await screen.findByRole('textbox', { name: 'Latitude de début' })).toHaveProperty('readOnly', true);
    expect(screen.getByRole('textbox', { name: 'Latitude de début' })).toHaveValue('6.1375');
    expect(screen.getByText('Heure du début')).toBeTruthy();
    expect(screen.queryByText('Heure du début (Africa/Lome)')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Date du début' }) as HTMLInputElement).value).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Heure du début' }) as HTMLInputElement).value).toBeTruthy();
    expect(screen.getByText(/Séance en cours :/)).toBeTruthy();
    expect(window.location.pathname).toBe('/teacher-control/teacher');
  });

  it('distinguishes an empty pedagogical association list from a technical loading error', async () => {
    configureTeacherApi();
    window.history.replaceState(null, '', '/teacher-control/teacher');
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/teacher-control/assignments') throw new Error('Échec réseau');
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          incompleteSessions: 0,
          regularizedSessions: 0,
          pendingRegularizations: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      return {};
    });
    render(<TeacherControlView {...defaultProps} />);

    expect(await screen.findByText(/associations pédagogiques n’ont pas pu être vérifiées/i)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Échec réseau');
    expect(screen.queryByText(/Aucune association classe-matière active/)).toBeNull();

    configureTeacherApi();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/teacher-control/assignments') return [];
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          incompleteSessions: 0,
          regularizedSessions: 0,
          pendingRegularizations: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      return {};
    });
    cleanup();
    window.history.replaceState(null, '', '/teacher-control/teacher');
    render(<TeacherControlView {...defaultProps} />);

    expect(await screen.findByText(/Aucune association classe-matière active/)).toBeTruthy();
  });

  it('validates a fresh end position before asking for explicit session closure', async () => {
    window.history.replaceState(null, '', '/teacher-control/teacher');
    const fixes = [
      { latitude: 6.1375, longitude: 1.2123, accuracy: 18 },
      { latitude: 6.1378, longitude: 1.2126, accuracy: 500 },
    ];
    let positionIndex = 0;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: fixes[positionIndex++], timestamp: Date.now() } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    let currentSession: typeof session | null = null;
    let challengeIndex = 0;
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/teacher-control/gps-challenges') {
        challengeIndex += 1;
        return { challenge: String(challengeIndex).repeat(43) };
      }
      if (url === '/api/teacher-control/sessions/start') {
        currentSession = { ...session, status: 'open' };
        return currentSession;
      }
      if (url === '/api/teacher-control/sessions/1/end') {
        currentSession = { ...session, status: 'completed', validatedEndedAt: '2026-10-31T09:00:00.000Z' };
        return currentSession;
      }
      if (url === '/api/teacher-control/sessions/1/validate-end') {
        return {
          sessionId: 1,
          latitude: fixes[1].latitude,
          longitude: fixes[1].longitude,
          validatedAt: '2026-10-31T08:55:00.000Z',
        };
      }
      if (url.startsWith('/api/teacher-control/sessions')) return currentSession ? [currentSession] : [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: currentSession ? 1 : 0,
          openSessions: currentSession?.status === 'open' ? 1 : 0,
          completedSessions: currentSession?.status === 'completed' ? 1 : 0,
          incompleteSessions: 0,
          regularizedSessions: 0,
          pendingRegularizations: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      if (url === '/api/teacher-control/assignments') {
        return [{
          assignmentId: 9,
          classId: 30,
          className: '6e A',
          subjectId: 40,
          subjectName: 'Mathématiques',
        }];
      }
      return {};
    });
    render(<TeacherControlView {...defaultProps} />);

    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Classe' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position' }));
    await screen.findByText(/Séance en cours :/);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Fin', pressed: false }));
    expect(await screen.findByRole('radio', { name: /6e A · Mathématiques/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position' }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/teacher-control/sessions/1/validate-end',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(screen.getByRole('textbox', { name: 'Date de fin' })).toHaveValue('En attente de clôture');
    expect(screen.getByRole('textbox', { name: 'Heure de fin' })).toHaveValue('En attente de clôture');
    const validationCall = apiFetchMock.mock.calls.find(([url]) => url === '/api/teacher-control/sessions/1/validate-end');
    expect(JSON.parse(validationCall?.[1]?.body as string)).toMatchObject({
      latitude: fixes[1].latitude,
      longitude: fixes[1].longitude,
      accuracyMeters: fixes[1].accuracy,
      gpsChallenge: '2'.repeat(43),
    });
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/sessions/1/end')).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Latitude de fin' })).toHaveValue(String(fixes[1].latitude));
    fireEvent.click(screen.getByRole('button', { name: 'Terminer maintenant' }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/teacher-control/sessions/1/end',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const endCall = apiFetchMock.mock.calls.find(([url]) => url === '/api/teacher-control/sessions/1/end');
    expect(JSON.parse(endCall?.[1]?.body as string)).toMatchObject({
      latitude: fixes[1].latitude,
      longitude: fixes[1].longitude,
      accuracyMeters: fixes[1].accuracy,
      gpsChallenge: '2'.repeat(43),
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Séance clôturée : 6e A · Mathématiques/)).toBeTruthy();
    expect(screen.getByText('Heure de fin')).toBeTruthy();
    expect(screen.queryByText('Heure de fin (Africa/Lome)')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Date de fin' }) as HTMLInputElement).value).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Heure de fin' }) as HTMLInputElement).value).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Précision GPS de fin' })).toHaveValue('500');
  });

  it('shows a useful message when the teacher refuses location permission', async () => {
    configureTeacherApi();
    window.history.replaceState(null, '', '/teacher-control/teacher');
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, message: 'Permission denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    render(<TeacherControlView {...defaultProps} />);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Classe' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position' }));

    expect(await screen.findByText('Permission de localisation refusée')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Autorisez la géolocalisation');
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/sessions/start')).toBe(false);
  });

  it('retries GPS acquisition after a browser timeout and issues the challenge only after a fix', async () => {
    window.history.replaceState(null, '', '/teacher-control/teacher');
    let attempt = 0;
    const getCurrentPosition = vi.fn((success: PositionCallback, error: PositionErrorCallback) => {
      attempt += 1;
      if (attempt === 1) {
        error({ code: 3, message: 'Timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        return;
      }
      success({
        coords: { latitude: 6.1375, longitude: 1.2123, accuracy: 18 },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/teacher-control/gps-challenges') return { challenge: 'b'.repeat(43) };
      if (url === '/api/teacher-control/sessions/start') return session;
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      if (url === '/api/teacher-control/assignments') {
        return [{ classId: 30, className: '6e A', subjectId: 40, subjectName: 'Mathématiques' }];
      }
      return {};
    });
    render(<TeacherControlView {...defaultProps} />);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Classe' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position' }));
    expect(await screen.findByText('Délai de localisation dépassé')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('n’a pas été obtenue à temps');
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/gps-challenges')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(/Séance en cours :/)).toBeTruthy();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(apiFetchMock.mock.calls.filter(([url]) => url === '/api/teacher-control/gps-challenges')).toHaveLength(1);
  });

  it('rejects one imprecise reading and permits an explicit retry without changing the assignment', async () => {
    window.history.replaceState(null, '', '/');
    let attempt = 0;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      attempt += 1;
      if (attempt === 1) {
        success({
          coords: { latitude: 6.1376, longitude: 1.2124, accuracy: 501 },
          timestamp: Date.now(),
        } as GeolocationPosition);
        return;
      }
      success({
        coords: { latitude: 6.1375, longitude: 1.2123, accuracy: 42 },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/teacher-control/gps-challenges') return { challenge: 'c'.repeat(43) };
      if (url === '/api/teacher-control/sessions/start') return session;
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      if (url === '/api/teacher-control/assignments') {
        return [{ classId: 30, className: '6e A', subjectId: 40, subjectName: 'Mathématiques' }];
      }
      return {};
    });
    render(<TeacherControlView {...defaultProps} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Début' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Classe' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position' }));

    expect(await screen.findByText('Position trop imprécise (501 m)')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Précision GPS de début' })).toHaveValue('501');
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/gps-challenges')).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Classe' })).toHaveValue('30');
    expect(screen.getByRole('combobox', { name: 'Matière' })).toHaveValue('40');

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(/Séance en cours :/)).toBeTruthy();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    const startCall = apiFetchMock.mock.calls.find(([url]) => url === '/api/teacher-control/sessions/start');
    expect(JSON.parse(startCall?.[1]?.body as string)).toMatchObject({ accuracyMeters: 42 });
  });

  it('shows an explicit outside-geofence validation error and keeps the selected assignment', async () => {
    window.history.replaceState(null, '', '/');
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 6.1375, longitude: 1.2123, accuracy: 20 },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/teacher-control/gps-challenges') return { challenge: 'd'.repeat(43) };
      if (url === '/api/teacher-control/sessions/start') throw new Error('GPS validation failed: outside_geofence');
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      if (url === '/api/teacher-control/assignments') {
        return [{ classId: 30, className: '6e A', subjectId: 40, subjectName: 'Mathématiques' }];
      }
      return {};
    });
    render(<TeacherControlView {...defaultProps} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Début' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Classe' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position' }));

    expect(await screen.findByText('Position hors du périmètre autorisé')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('hors du périmètre autorisé de l’école');
    expect(screen.getByRole('textbox', { name: 'Précision GPS de début' })).toHaveValue('20');
    expect(screen.getByRole('combobox', { name: 'Classe' })).toHaveValue('30');
    expect(screen.getByRole('combobox', { name: 'Matière' })).toHaveValue('40');
  });

  it('prevents concurrent GPS acquisition from rapid repeated clicks', async () => {
    window.history.replaceState(null, '', '/teacher-control/teacher');
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    configureTeacherApi();
    render(<TeacherControlView {...defaultProps} />);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Classe' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Matière' }), { target: { value: '40' } });
    const locateButton = screen.getByRole('button', { name: 'Obtenir ma position' });
    fireEvent.click(locateButton);
    fireEvent.click(locateButton);

    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/gps-challenges')).toBe(false);
  });

  it('allows a super admin to review a regularization within the selected school scope', async () => {
    const onSchoolChange = vi.fn();
    let pendingCount = 1;
    let requestStatus = 'pending';
    const superApi = vi.fn(async (url: string, _options?: RequestInit) => {
      if (url.startsWith('/api/teacher-control/sessions')) return [session];
      if (url.startsWith('/api/teacher-control/regularizations/7/decision')) {
        pendingCount = 0;
        requestStatus = 'accepted';
        return { request: {}, decision: {}, session };
      }
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 1,
          openSessions: 1,
          completedSessions: 0,
          pendingRegularizations: pendingCount,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url.startsWith('/api/teacher-control/regularizations')) return [{
        request: {
          id: 7,
          sessionId: 1,
          requestType: 'incomplete_session',
          schoolNameSnapshot: 'École A',
          classId: null,
          classNameSnapshot: null,
          subjectId: null,
          subjectNameSnapshot: null,
          referenceStartedAt: null,
          declaredStartedAt: null,
          teacherNameSnapshot: 'Afi Mensah',
          proposedEndedAt: '2026-10-31T09:00:00.000Z',
          reason: 'Sortie urgente',
          description: null,
          incidentType: null,
          technicalDetails: null,
          gpsLatitude: null,
          gpsLongitude: null,
          gpsAccuracyMeters: null,
          status: requestStatus,
          createdAt: '2026-10-31T09:10:00.000Z',
        },
        decisions: [],
      }];
      if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
      if (url.startsWith('/api/teacher-control/gps-settings')) {
        return {
          schoolId: 8,
          schoolName: 'École A',
          isEnabled: false,
          latitude: null,
          longitude: null,
          geofenceRadiusMeters: 200,
          updatedAt: null,
        };
      }
      return null;
    });
    apiFetchMock.mockImplementation(superApi);
    render(
      <TeacherControlView
        {...defaultProps}
        userRole="super_admin"
        activeSchoolId={null}
        superAdminSchoolFilterId={8}
        onSuperAdminSchoolFilterChange={onSchoolChange}
      />,
    );

    expect(await screen.findByText('6e A · Mathématiques')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clôturer sans heure de fin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accepter l’heure proposée' })).toBeNull();
    expect(screen.getByText(/Accès consultatif/)).toBeTruthy();
    expect(superApi.mock.calls.some(([url]) => url.includes('schoolId=8'))).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Régularisations' }));
    expect(await screen.findByText(/Afi Mensah · Demande #7/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accepter l’heure proposée' }));
    await waitFor(() => {
      const decisionCall = superApi.mock.calls.find(([url]) => url.includes('/regularizations/7/decision'));
      expect(decisionCall).toBeTruthy();
      expect(JSON.parse((decisionCall?.[1] as RequestInit)?.body as string)).toEqual({
        decision: 'accepted',
        schoolId: 8,
      });
    });
    expect(await screen.findByText('Acceptée')).toBeTruthy();
  });

  it('keeps a teacher request history visible and refreshes its real status on focus', async () => {
    let status: 'pending' | 'accepted' | 'rejected' = 'pending';
    const onPendingCountChange = vi.fn();
    const requestRow = {
      id: 77,
      schoolId: 8,
      sessionId: 12,
      requestType: 'incomplete_session',
      schoolNameSnapshot: 'École A',
      classId: null,
      classNameSnapshot: null,
      subjectId: null,
      subjectNameSnapshot: null,
      referenceStartedAt: null,
      declaredStartedAt: null,
      teacherNameSnapshot: 'Afi Mensah',
      proposedEndedAt: '2026-10-31T09:00:00.000Z',
      reason: 'Sortie urgente',
      description: null,
      incidentType: null,
      technicalDetails: null,
      gpsLatitude: null,
      gpsLongitude: null,
      gpsAccuracyMeters: null,
      get status() { return status; },
      createdAt: '2026-10-31T09:10:00.000Z',
    };
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          incompleteSessions: 0,
          regularizedSessions: 0,
          pendingRegularizations: status === 'pending' ? 1 : 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [{ request: requestRow, decisions: [] }];
      if (url === '/api/teacher-control/assignments') return [];
      return {};
    });

    render(
      <TeacherControlView
        {...defaultProps}
        initialTab="requests"
        onPendingRegularizationsCountChange={onPendingCountChange}
      />,
    );

    expect(await screen.findByText('En attente')).toBeTruthy();
    expect(onPendingCountChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByText(/Séance #12/)).toBeTruthy();
    expect(screen.getByText(/Sortie urgente/)).toBeTruthy();
    status = 'accepted';
    await act(async () => window.dispatchEvent(new Event('focus')));

    expect(await screen.findByText('Acceptée')).toBeTruthy();
    expect(apiFetchMock.mock.calls.filter(([url]) => url === '/api/teacher-control/regularizations').length)
      .toBeGreaterThan(1);
  });

  it('renders only the regularization review page for an administrator and preserves decision actions', async () => {
    const statuses: Record<number, string> = { 7: 'pending', 8: 'pending' };
    const onPendingCountChange = vi.fn();
    const request = {
      id: 7,
      sessionId: 1,
      requestType: 'incomplete_session',
      schoolId: 8,
      schoolNameSnapshot: 'École A',
      classNameSnapshot: '6e A',
      subjectNameSnapshot: 'Mathématiques',
      teacherNameSnapshot: 'Afi Mensah',
      proposedEndedAt: '2026-10-31T09:00:00.000Z',
      reason: 'Sortie urgente',
      description: null,
      status: statuses[7],
      createdAt: '2026-10-31T09:10:00.000Z',
    };
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/teacher-control/statistics') {
        return { totalSessions: 0, openSessions: 0, pendingRegularizations: Object.values(statuses).filter((status) => status === 'pending').length };
      }
      if (url === '/api/teacher-control/regularizations') {
        return [
          { request: { ...request, status: statuses[7] }, decisions: [] },
          { request: { ...request, id: 8, sessionId: 2, status: statuses[8] }, decisions: [] },
        ];
      }
      const decisionMatch = url.match(/\/regularizations\/(\d+)\/decision$/);
      if (decisionMatch) {
        const requestId = Number(decisionMatch[1]);
        const body = JSON.parse(String(options?.body ?? '{}'));
        statuses[requestId] = body.decision === 'rejected' ? 'rejected' : 'accepted';
        return { request: { ...request, id: requestId, status: statuses[requestId] }, decision: {}, session };
      }
      return {};
    });

    render(
      <TeacherControlView
        {...defaultProps}
        userRole="school_admin"
        viewMode="regularizations"
        onPendingRegularizationsCountChange={onPendingCountChange}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Régularisations à traiter' })).toBeTruthy();
    expect(onPendingCountChange).toHaveBeenLastCalledWith(2);
    expect(await screen.findByText(/Afi Mensah · École A · Demande #7/)).toBeTruthy();
    expect(screen.getAllByText(/Motif : Sortie urgente/)).toHaveLength(2);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('Paramètres de contrôle GPS')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Début' })).toBeNull();
    expect(apiFetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/teacher-control/sessions'))).toBe(false);
    expect(apiFetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/teacher-control/filter-options'))).toBe(false);

    fireEvent.click(screen.getAllByRole('button', { name: 'Accepter l’heure proposée' })[0]);
    expect(await screen.findByText(/Demande #8/)).toBeTruthy();
    expect(screen.queryByText(/Demande #7/)).toBeNull();
    expect(onPendingCountChange).toHaveBeenLastCalledWith(1);
    fireEvent.change(screen.getByLabelText('Motif (obligatoire pour refus ou modification)'), {
      target: { value: 'Présence non confirmée' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(await screen.findByText('Aucune demande de régularisation à afficher.')).toBeTruthy();
    expect(onPendingCountChange).toHaveBeenLastCalledWith(0);
    expect(apiFetchMock.mock.calls.some(([url, options]) => url === '/api/teacher-control/regularizations/8/decision'
      && JSON.parse(String((options as RequestInit)?.body ?? '{}')).reason === 'Présence non confirmée')).toBe(true);
  });

  it('shows only a teacher’s regularization history in isolated mode', async () => {
    let teacherStatus = 'pending';
    const rows = [
      {
        request: {
          id: 77,
          schoolId: 8,
          sessionId: 12,
          requestType: 'incomplete_session',
          schoolNameSnapshot: 'École A',
          teacherNameSnapshot: 'Afi Mensah',
          proposedEndedAt: '2026-10-31T09:00:00.000Z',
          reason: 'Sortie urgente',
          get status() { return teacherStatus; },
          createdAt: '2026-10-31T09:10:00.000Z',
        },
        decisions: [],
      },
      {
        request: {
          id: 78,
          schoolId: 8,
          sessionId: 13,
          requestType: 'incomplete_session',
          schoolNameSnapshot: 'École A',
          teacherNameSnapshot: 'Afi Mensah',
          proposedEndedAt: '2026-10-30T09:00:00.000Z',
          reason: 'Régularisation ancienne',
          status: 'accepted',
          createdAt: '2026-10-30T09:10:00.000Z',
        },
        decisions: [{
          id: 10,
          decision: 'accepted',
          actorNameSnapshot: 'Administrateur',
          decidedStartedAt: null,
          decidedEndedAt: '2026-10-30T09:00:00.000Z',
          reason: 'Validée',
          createdAt: '2026-10-30T10:00:00.000Z',
        }],
      },
    ];
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/teacher-control/statistics') {
        return { totalSessions: 0, openSessions: 0, pendingRegularizations: teacherStatus === 'pending' ? 1 : 0 };
      }
      if (url === '/api/teacher-control/regularizations') {
        return rows.map((entry) => ({ ...entry, request: { ...entry.request, status: entry.request.status } }));
      }
      return {};
    });

    render(<TeacherControlView {...defaultProps} viewMode="regularizations" initialTab="requests" />);

    expect(await screen.findByRole('heading', { name: 'Régularisations en attente' })).toBeTruthy();
    expect(await screen.findByText('En attente')).toBeTruthy();
    expect(screen.queryByText('Acceptée')).toBeNull();
    expect(screen.queryByText(/Régularisation ancienne/)).toBeNull();
    expect(screen.getAllByText(/Demandée le/)).toHaveLength(1);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accepter l’heure proposée' })).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/teacher-control/regularizations', { cache: 'no-store' });
    expect(apiFetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/teacher-control/sessions'))).toBe(false);
    expect(apiFetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/teacher-control/filter-options'))).toBe(false);

    teacherStatus = 'accepted';
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByText('Vous n’avez aucune demande de régularisation.')).toBeTruthy();
    expect(screen.queryByText('En attente')).toBeNull();
  });

  it('requires a reason before a school administrator can reject a regularization request', async () => {
    let pendingCount = 1;
    let requestStatus = 'pending';
    const onPendingCountChange = vi.fn();
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/teacher-control/sessions')) return [session];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 1,
          openSessions: 1,
          completedSessions: 0,
          pendingRegularizations: pendingCount,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url.startsWith('/api/teacher-control/regularizations/7/decision')) {
        pendingCount = 0;
        requestStatus = 'rejected';
        return { request: {}, decision: {}, session };
      }
      if (url.startsWith('/api/teacher-control/regularizations')) {
        return [{
          request: {
            id: 7,
            sessionId: 1,
            teacherNameSnapshot: 'Afi Mensah',
            proposedEndedAt: '2026-10-31T09:00:00.000Z',
            reason: 'Sortie urgente',
            status: requestStatus,
            createdAt: '2026-10-31T09:10:00.000Z',
          },
          decisions: [],
        }];
      }
      if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
      if (url.startsWith('/api/teacher-control/gps-settings')) {
        return {
          schoolId: 8,
          schoolName: 'École A',
          isEnabled: false,
          latitude: null,
          longitude: null,
          geofenceRadiusMeters: 200,
          updatedAt: null,
        };
      }
      return {};
    });
    render(<TeacherControlView {...defaultProps} userRole="school_admin" onPendingRegularizationsCountChange={onPendingCountChange} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Régularisations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refuser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Un motif est obligatoire');

    fireEvent.change(screen.getByLabelText('Motif (obligatoire pour refus ou modification)'), {
      target: { value: 'Justificatif insuffisant' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/teacher-control/regularizations/7/decision',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const decisionCall = apiFetchMock.mock.calls.find(([url]) => url === '/api/teacher-control/regularizations/7/decision');
    expect(JSON.parse(decisionCall?.[1]?.body as string)).toMatchObject({
      decision: 'rejected',
      reason: 'Justificatif insuffisant',
    });
    await waitFor(() => expect(onPendingCountChange).toHaveBeenLastCalledWith(0));
    expect(await screen.findByText('Refusée')).toBeTruthy();
  });

  it('lets a super administrator capture school coordinates and edit them before saving', async () => {
    configureAdminGpsApi();
    const getCurrentPosition = vi.fn((success: PositionCallback, _error?: PositionErrorCallback, options?: PositionOptions) => {
      success({
        coords: { latitude: 6.1375, longitude: 1.2123, accuracy: 18 },
        timestamp: Date.now(),
      } as GeolocationPosition);
      expect(options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0, timeout: 45_000 });
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    render(
      <TeacherControlView
        {...defaultProps}
        userRole="super_admin"
        activeSchoolId={null}
        superAdminSchoolFilterId={8}
      />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration GPS' }));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position automatiquement' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/précision indiquée par l’appareil : 18 m/);
    expect(screen.getByLabelText('Latitude de l’établissement')).toHaveValue(6.1375);
    expect(screen.getByLabelText('Longitude de l’établissement')).toHaveValue(1.2123);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Latitude de l’établissement'), { target: { value: '6.1400' } });
    fireEvent.change(screen.getByLabelText('Longitude de l’établissement'), { target: { value: '1.2150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les coordonnées GPS' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/teacher-control/gps-settings',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    const settingsCall = apiFetchMock.mock.calls.find(([url, options]) => url === '/api/teacher-control/gps-settings' && options?.method === 'PUT');
    expect(JSON.parse(settingsCall?.[1]?.body as string)).toMatchObject({
      schoolId: 8,
      isEnabled: false,
      latitude: 6.14,
      longitude: 1.215,
      geofenceRadiusMeters: 200,
    });
  });

  it('lets an authorized administrator save a radius independently and refreshes the displayed value', async () => {
    let savedRadius = 500;
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/teacher-control/filter-options')) return { teachers: [], classes: [], subjects: [] };
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          incompleteSessions: 0,
          regularizedSessions: 0,
          pendingRegularizations: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
      if (url.startsWith('/api/teacher-control/gps-settings') && options?.method === 'PUT') {
        savedRadius = JSON.parse(options.body as string).geofenceRadiusMeters as number;
        return {};
      }
      if (url.startsWith('/api/teacher-control/gps-settings')) {
        return {
          schoolId: 8,
          schoolName: 'École A',
          isEnabled: true,
          latitude: 6.1375,
          longitude: 1.2123,
          geofenceRadiusMeters: savedRadius,
          updatedAt: null,
        };
      }
      return {};
    });
    render(<TeacherControlView {...defaultProps} userRole="school_admin" />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration GPS' }));
    expect(screen.getByRole('heading', { name: 'Contrôle des enseignants' })).toBeTruthy();
    const radiusInput = screen.getByRole('spinbutton', { name: 'Rayon de présence (mètres)' });
    expect(radiusInput).toHaveValue(500);
    expect(radiusInput).toHaveAttribute('min', '1');
    expect(radiusInput).toHaveAttribute('max', '10000');
    expect(screen.getByRole('button', { name: 'Enregistrer le rayon' })).toBeEnabled();

    fireEvent.change(radiusInput, { target: { value: '750' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le rayon' }));

    expect(await screen.findByText('Le rayon de présence a été enregistré.')).toBeTruthy();
    await waitFor(() => expect(radiusInput).toHaveValue(750));
    const radiusUpdate = apiFetchMock.mock.calls.find(([url, options]) => url === '/api/teacher-control/gps-settings' && options?.method === 'PUT');
    expect(JSON.parse(radiusUpdate?.[1]?.body as string)).toMatchObject({
      isEnabled: true,
      latitude: 6.1375,
      longitude: 1.2123,
      geofenceRadiusMeters: 750,
      maxGpsAccuracyMeters: 500,
    });
  });

  it('lets an authorized administrator persist the GPS accuracy threshold independently', async () => {
    let savedAccuracy = 500;
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/teacher-control/filter-options')) return { teachers: [], classes: [], subjects: [] };
      if (url.startsWith('/api/teacher-control/sessions')) return [];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 0,
          openSessions: 0,
          completedSessions: 0,
          incompleteSessions: 0,
          regularizedSessions: 0,
          pendingRegularizations: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url === '/api/teacher-control/regularizations') return [];
      if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
      if (url.startsWith('/api/teacher-control/gps-settings') && options?.method === 'PUT') {
        savedAccuracy = JSON.parse(options.body as string).maxGpsAccuracyMeters as number;
        return { maxGpsAccuracyMeters: savedAccuracy };
      }
      if (url.startsWith('/api/teacher-control/gps-settings')) {
        return {
          schoolId: 8,
          schoolName: 'École A',
          isEnabled: true,
          latitude: 6.1375,
          longitude: 1.2123,
          geofenceRadiusMeters: 750,
          maxGpsAccuracyMeters: savedAccuracy,
          updatedAt: null,
        };
      }
      return {};
    });
    const { unmount } = render(<TeacherControlView {...defaultProps} userRole="school_admin" />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration GPS' }));
    const accuracyInput = screen.getByRole('spinbutton', { name: 'Précision GPS maximale (mètres)' });
    expect(accuracyInput).toHaveValue(500);
    expect(accuracyInput).toHaveAttribute('min', '1');
    expect(accuracyInput).toHaveAttribute('max', '5000');
    expect(screen.getByRole('region', { name: 'Précision GPS maximale acceptée' }).textContent)
      .toContain('Valeur actuellement enregistrée : 500 m · maximum configurable : 5000 m');

    fireEvent.change(accuracyInput, { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la précision' }));

    expect(await screen.findByText('La précision GPS maximale a été enregistrée.')).toBeTruthy();
    await waitFor(() => expect(accuracyInput).toHaveValue(2000));
    const accuracyUpdate = apiFetchMock.mock.calls.find(([url, options]) => url === '/api/teacher-control/gps-settings' && options?.method === 'PUT');
    expect(JSON.parse(accuracyUpdate?.[1]?.body as string)).toMatchObject({
      isEnabled: true,
      latitude: 6.1375,
      longitude: 1.2123,
      geofenceRadiusMeters: 750,
      maxGpsAccuracyMeters: 2000,
    });
    const settingsReads = apiFetchMock.mock.calls.filter(([url, options]) => (
      url.startsWith('/api/teacher-control/gps-settings')
      && !url.includes('/history')
      && options?.method !== 'PUT'
    ));
    expect(settingsReads.length).toBeGreaterThan(0);
    expect(settingsReads[settingsReads.length - 1]?.[1]).toMatchObject({ cache: 'no-store' });
    unmount();
    render(<TeacherControlView {...defaultProps} userRole="school_admin" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration GPS' }));
    const reloadedAccuracyInput = await screen.findByRole('spinbutton', { name: 'Précision GPS maximale (mètres)' });
    await waitFor(() => expect(reloadedAccuracyInput).toHaveValue(2000));
  });

  it('does not expose GPS radius configuration to teachers', async () => {
    configureTeacherApi();
    render(<TeacherControlView {...defaultProps} userRole="teacher" />);

    expect(await screen.findByRole('tab', { name: 'Séances' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Configuration GPS' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Rayon de présence (mètres)' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Précision GPS maximale (mètres)' })).toBeNull();
  });

  it.each([
    [1, 'Le navigateur a refusé la géolocalisation'],
    [2, 'Position indisponible'],
    [3, 'Délai dépassé'],
  ])('explains automatic location error code %s', async (code, expectedMessage) => {
    configureAdminGpsApi();
    Object.defineProperty(document, 'permissionsPolicy', {
      configurable: true,
      value: { allowsFeature: () => true },
    });
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({
        code,
        message: 'Geolocation error',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    render(<TeacherControlView {...defaultProps} userRole="school_admin" />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration GPS' }));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position automatiquement' }));

    expect(await screen.findByRole('status')).toHaveTextContent(expectedMessage);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('explains when automatic location is blocked by the current document policy without requesting a position', async () => {
    configureAdminGpsApi();
    Object.defineProperty(document, 'permissionsPolicy', {
      configurable: true,
      value: { allowsFeature: vi.fn(() => false) },
    });
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    render(<TeacherControlView {...defaultProps} userRole="school_admin" />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration GPS' }));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir ma position automatiquement' }));

    expect(await screen.findByRole('status')).toHaveTextContent('bloquée par la politique de sécurité');
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

    it('shows global super-admin aggregates, including schools without sessions', async () => {
      const globalSummary = {
        scope: 'global',
        totalSessions: 2,
        openSessions: 1,
        completedSessions: 1,
        incompleteSessions: 0,
        regularizedSessions: 1,
        pendingRegularizations: 0,
        validatedDurationMilliseconds: 3_600_000,
        estimatedCompensationXof: 1_500,
        schools: [
          {
            schoolId: 8,
            schoolName: 'École A',
            totalSessions: 2,
            openSessions: 1,
            completedSessions: 1,
            incompleteSessions: 0,
            regularizedSessions: 1,
            pendingRegularizations: 0,
            validatedDurationMilliseconds: 3_600_000,
            estimatedCompensationXof: 1_500,
          },
          {
            schoolId: 9,
            schoolName: 'École sans séance',
            totalSessions: 0,
            openSessions: 0,
            completedSessions: 0,
            incompleteSessions: 0,
            regularizedSessions: 0,
            pendingRegularizations: 0,
            validatedDurationMilliseconds: 0,
            estimatedCompensationXof: 0,
          },
        ],
      };
      apiFetchMock.mockImplementation(async (url: string) => {
        if (url.startsWith('/api/teacher-control/statistics/global')) return globalSummary;
        return {};
      });

      render(
        <TeacherControlView
          {...defaultProps}
          userRole="super_admin"
          activeSchoolId={null}
          superAdminSchoolFilterId={null}
        />,
      );

      expect(await screen.findByText('Statistiques par établissement')).toBeTruthy();
      expect(screen.getByText('École sans séance')).toBeTruthy();
      expect(screen.getByText('Rémunération validée')).toBeTruthy();
      expect(apiFetchMock).toHaveBeenCalledWith('/api/teacher-control/statistics/global');
    });

    it('requests server-filtered session pages and displays the per-session audit timeline', async () => {
      const auditEvent = {
        id: 21,
        actorRole: 'school_admin',
        actorNameSnapshot: 'Admin école',
        actorEmailSnapshot: 'admin@example.test',
        action: 'session_closed',
        resourceType: 'session',
        reason: 'Clôture administrative',
        beforeValues: {},
        afterValues: {},
        createdAt: '2026-10-31T09:00:00.000Z',
      };
      apiFetchMock.mockImplementation(async (url: string) => {
        if (url.startsWith('/api/teacher-control/filter-options')) {
          return {
            teachers: [{ id: 20, name: 'Afi Mensah' }],
            classes: [{ id: 30, name: '6e A' }],
            subjects: [{ id: 40, name: 'Mathématiques' }],
          };
        }
        if (url.startsWith('/api/teacher-control/sessions/1/audit')) return [auditEvent];
        if (url.startsWith('/api/teacher-control/sessions')) {
          return {
            items: [session],
            nextCursor: 'next-page-cursor',
            hasMore: true,
            limit: 50,
            totalCount: 2,
          };
        }
        if (url.startsWith('/api/teacher-control/statistics')) {
          return {
            totalSessions: 2,
            openSessions: 1,
            completedSessions: 1,
            incompleteSessions: 0,
            regularizedSessions: 0,
            pendingRegularizations: 0,
            validatedDurationMilliseconds: 0,
            estimatedCompensationXof: 0,
          };
        }
        if (url.startsWith('/api/teacher-control/regularizations')) return [];
        if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
        if (url.startsWith('/api/teacher-control/gps-settings')) {
          return { isEnabled: false, latitude: null, longitude: null, geofenceRadiusMeters: 200 };
        }
        return {};
      });
      render(
        <TeacherControlView
          {...defaultProps}
          userRole="school_admin"
        />,
      );

      expect(await screen.findByText('6e A · Mathématiques')).toBeTruthy();
      expect(screen.queryByLabelText('Établissement')).toBeNull();
      expect(screen.getByLabelText('Enseignant').tagName).toBe('SELECT');
      expect(screen.getByRole('option', { name: 'Afi Mensah' })).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Enseignant'), { target: { value: '20' } });
      fireEvent.change(screen.getByLabelText('Statut de séance'), { target: { value: 'open' } });
      fireEvent.click(screen.getByRole('button', { name: 'Appliquer les filtres' }));
      await waitFor(() => {
        expect(apiFetchMock.mock.calls.some(([url]) => (
          typeof url === 'string' && url.startsWith('/api/teacher-control/sessions?')
          && url.includes('teacherId=20') && url.includes('status=open')
        ))).toBe(true);
      });

      fireEvent.click(screen.getByRole('button', { name: 'Page suivante' }));
      await waitFor(() => {
        expect(apiFetchMock.mock.calls.some(([url]) => (
          typeof url === 'string' && url.includes('cursor=next-page-cursor')
        ))).toBe(true);
      });

      fireEvent.click(screen.getByRole('button', { name: /6e A · Mathématiques/ }));
      expect(await screen.findByText(/session_closed · Admin école/)).toBeTruthy();
      expect(screen.getByText('Motif : Clôture administrative')).toBeTruthy();
      expect(apiFetchMock).toHaveBeenCalledWith('/api/teacher-control/sessions/1/audit');
    });

    it('updates combined admin filters in place without reloading or hiding existing results', async () => {
      let resolveFilteredSessions: ((value: unknown) => void) | undefined;
      let resolveFilteredStatistics: ((value: unknown) => void) | undefined;
      const filteredSessions = new Promise<unknown>((resolve) => {
        resolveFilteredSessions = resolve;
      });
      const filteredStatistics = new Promise<unknown>((resolve) => {
        resolveFilteredStatistics = resolve;
      });
      apiFetchMock.mockImplementation(async (url: string) => {
        if (url.startsWith('/api/teacher-control/filter-options')) {
          return {
            teachers: [{ id: 20, name: 'Afi Mensah' }],
            classes: [{ id: 30, name: '6e A' }],
            subjects: [{ id: 40, name: 'Mathématiques' }],
          };
        }
        if (url.startsWith('/api/teacher-control/sessions?') && url.includes('teacherId=20')) return filteredSessions;
        if (url.startsWith('/api/teacher-control/statistics?') && url.includes('teacherId=20')) return filteredStatistics;
        if (url.startsWith('/api/teacher-control/sessions')) {
          return { items: [session], nextCursor: null, hasMore: false, limit: 50, totalCount: 2 };
        }
        if (url.startsWith('/api/teacher-control/statistics')) {
          return {
            totalSessions: 2,
            openSessions: 1,
            completedSessions: 1,
            incompleteSessions: 0,
            regularizedSessions: 0,
            pendingRegularizations: 0,
            validatedDurationMilliseconds: 0,
            estimatedCompensationXof: 0,
          };
        }
        if (url.startsWith('/api/teacher-control/regularizations')) return [];
        if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
        if (url.startsWith('/api/teacher-control/gps-settings')) {
          return { isEnabled: false, latitude: null, longitude: null, geofenceRadiusMeters: 200 };
        }
        return {};
      });
      render(<TeacherControlView {...defaultProps} userRole="school_admin" />);

      expect(await screen.findByText('6e A · Mathématiques')).toBeTruthy();
      const ancillaryRequestCount = apiFetchMock.mock.calls.filter(([url]) => (
        typeof url === 'string'
        && (url.startsWith('/api/teacher-control/regularizations')
          || url.startsWith('/api/teacher-control/gps-settings'))
      )).length;
      fireEvent.change(screen.getByLabelText('Enseignant'), { target: { value: '20' } });
      fireEvent.change(screen.getByLabelText('Classe'), { target: { value: '30' } });
      fireEvent.change(screen.getByLabelText('Matière'), { target: { value: '40' } });
      fireEvent.change(screen.getByLabelText('Statut de séance'), { target: { value: 'open' } });
      const applyButton = screen.getByRole('button', { name: 'Appliquer les filtres' });
      fireEvent.click(applyButton);
      fireEvent.click(applyButton);

      expect(await screen.findByRole('status')).toHaveTextContent('Actualisation des séances et statistiques…');
      expect(screen.getByText('6e A · Mathématiques')).toBeTruthy();
      expect(screen.getByText(/2 résultat\(s\) au total/)).toBeTruthy();
      expect(apiFetchMock.mock.calls.filter(([url]) => (
        typeof url === 'string'
        && (url.startsWith('/api/teacher-control/regularizations')
          || url.startsWith('/api/teacher-control/gps-settings'))
      ))).toHaveLength(ancillaryRequestCount);
      expect(apiFetchMock.mock.calls.filter(([url]) => (
        typeof url === 'string' && url.startsWith('/api/teacher-control/sessions?') && url.includes('teacherId=20')
      ))).toHaveLength(1);
      expect(window.location.pathname).toBe('/');

      resolveFilteredSessions?.({
        items: [session],
        nextCursor: null,
        hasMore: false,
        limit: 50,
        totalCount: 1,
      });
      resolveFilteredStatistics?.({
        totalSessions: 1,
        openSessions: 1,
        completedSessions: 0,
        incompleteSessions: 0,
        regularizedSessions: 0,
        pendingRegularizations: 0,
        validatedDurationMilliseconds: 0,
        estimatedCompensationXof: 0,
      });
      await waitFor(() => {
        expect(screen.getByText(/1 résultat\(s\) au total/)).toBeTruthy();
        expect(screen.queryByText('Actualisation des séances et statistiques…')).toBeNull();
      });

      fireEvent.change(screen.getByLabelText('Enseignant'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('Classe'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('Matière'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('Statut de séance'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Appliquer les filtres' }));
      await waitFor(() => {
        expect(screen.getByText(/2 résultat\(s\) au total/)).toBeTruthy();
        expect(apiFetchMock).toHaveBeenCalledWith('/api/teacher-control/sessions?limit=50');
      });
    });

    it('keeps admin filter selections and existing results when the filtered API request fails', async () => {
      apiFetchMock.mockImplementation(async (url: string) => {
        if (url.startsWith('/api/teacher-control/filter-options')) {
          return { teachers: [{ id: 20, name: 'Afi Mensah' }], classes: [], subjects: [] };
        }
        if (url.startsWith('/api/teacher-control/sessions?') && url.includes('teacherId=20')) {
          throw new Error('Erreur API de test');
        }
        if (url.startsWith('/api/teacher-control/sessions')) {
          return { items: [session], nextCursor: null, hasMore: false, limit: 50, totalCount: 1 };
        }
        if (url.startsWith('/api/teacher-control/statistics')) {
          return {
            totalSessions: 1,
            openSessions: 1,
            completedSessions: 0,
            incompleteSessions: 0,
            regularizedSessions: 0,
            pendingRegularizations: 0,
            validatedDurationMilliseconds: 0,
            estimatedCompensationXof: 0,
          };
        }
        if (url.startsWith('/api/teacher-control/regularizations')) return [];
        if (url.startsWith('/api/teacher-control/gps-settings/history')) return [];
        if (url.startsWith('/api/teacher-control/gps-settings')) {
          return { isEnabled: false, latitude: null, longitude: null, geofenceRadiusMeters: 200 };
        }
        return {};
      });
      render(<TeacherControlView {...defaultProps} userRole="school_admin" />);

      expect(await screen.findByText('6e A · Mathématiques')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Enseignant'), { target: { value: '20' } });
      fireEvent.click(screen.getByRole('button', { name: 'Appliquer les filtres' }));

      expect(await screen.findByText('Erreur API de test')).toBeTruthy();
      expect(screen.getByLabelText('Enseignant')).toHaveValue('20');
      expect(screen.getByText('6e A · Mathématiques')).toBeTruthy();
      expect(window.location.pathname).toBe('/');
      expect(screen.queryByText('Chargement des données du module…')).toBeNull();
    });

    it('submits an immediate report without requiring a GPS attempt or existing session', async () => {
      let submittedBody: Record<string, unknown> | null = null;
      let createdRequest: Record<string, unknown> | null = null;
      const serverTimestamp = '2026-10-31T12:00:00.000Z';
      apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url === '/api/teacher-control/regularizations/unrecorded') {
          submittedBody = JSON.parse(options?.body as string) as Record<string, unknown>;
          createdRequest = {
            id: 52,
            sessionId: null,
            requestType: 'immediate_report',
            schoolNameSnapshot: 'École A',
            teacherNameSnapshot: 'Test actor',
            classId: 30,
            classNameSnapshot: '6e A',
            subjectId: 40,
            subjectNameSnapshot: 'Mathématiques',
            referenceStartedAt: serverTimestamp,
            declaredStartedAt: null,
            proposedEndedAt: null,
            reason: submittedBody.reason,
            description: null,
            incidentType: submittedBody.incidentType,
            technicalDetails: submittedBody.technicalDetails,
            gpsLatitude: null,
            gpsLongitude: null,
            gpsAccuracyMeters: null,
            status: 'pending',
            createdAt: serverTimestamp,
          };
          return createdRequest;
        }
        if (url.startsWith('/api/teacher-control/sessions')) return [];
        if (url.startsWith('/api/teacher-control/statistics')) {
          return {
            totalSessions: 0,
            openSessions: 0,
            completedSessions: 0,
            incompleteSessions: 0,
            regularizedSessions: 0,
            pendingRegularizations: createdRequest ? 1 : 0,
            validatedDurationMilliseconds: 0,
            estimatedCompensationXof: 0,
          };
        }
        if (url === '/api/teacher-control/regularizations') {
          return createdRequest ? [{ request: createdRequest, decisions: [] }] : [];
        }
        if (url === '/api/teacher-control/assignments') {
          return [{
            assignmentId: 9,
            classId: 30,
            className: '6e A',
            subjectId: 40,
            subjectName: 'Mathématiques',
          }];
        }
        return {};
      });
      render(<TeacherControlView {...defaultProps} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Demander la régularisation d’une séance non enregistrée' }));
      const requestType = screen.getByLabelText('Circonstance de la demande') as HTMLSelectElement;
      const immediateOption = screen.getByRole('option', { name: 'Signalement immédiat d’un problème de démarrage' }) as HTMLOptionElement;
      expect(immediateOption.disabled).toBe(false);
      fireEvent.change(requestType, { target: { value: 'immediate_report' } });
      fireEvent.change(screen.getByLabelText('Classe de la demande'), { target: { value: '30' } });
      fireEvent.change(screen.getByLabelText('Matière de la demande'), { target: { value: '40' } });
      fireEvent.change(screen.getByLabelText('Motif / explication'), { target: { value: 'Le démarrage est impossible.' } });
      expect((screen.getByRole('button', { name: 'Transmettre à l’administration' }) as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Transmettre à l’administration' }));

      expect(await screen.findByText(/SIGNALEMENT IMMÉDIAT/)).toBeTruthy();
      expect(submittedBody).toMatchObject({
        requestType: 'immediate_report',
        classId: 30,
        subjectId: 40,
        incidentType: 'gps_unavailable',
        reason: 'Le démarrage est impossible.',
      });
      expect(submittedBody).not.toHaveProperty('schoolId');
      expect(submittedBody).not.toHaveProperty('referenceStartedAt');
      expect(submittedBody).not.toHaveProperty('startedAt');
      expect(submittedBody).not.toHaveProperty('latitude');
      expect(submittedBody).not.toHaveProperty('longitude');
      expect(submittedBody).not.toHaveProperty('accuracyMeters');
      expect(createdRequest?.referenceStartedAt).toBe(serverTimestamp);
      expect(createdRequest?.sessionId).toBeNull();
      expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/sessions/start')).toBe(false);
      expect(window.location.pathname).toBe('/');
    });

    it('submits a late unrecorded-session declaration using the selected active assignment', async () => {
      let submittedBody: Record<string, unknown> | null = null;
      let createdRequest: Record<string, unknown> | null = null;
      apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url === '/api/teacher-control/regularizations/unrecorded') {
          submittedBody = JSON.parse(options?.body as string) as Record<string, unknown>;
          createdRequest = {
            id: 51,
            sessionId: null,
            requestType: 'late_declaration',
            schoolNameSnapshot: 'École A',
            teacherNameSnapshot: 'Test actor',
            classId: 30,
            classNameSnapshot: '6e A',
            subjectId: 40,
            subjectNameSnapshot: 'Mathématiques',
            referenceStartedAt: null,
            declaredStartedAt: submittedBody.declaredStartedAt,
            proposedEndedAt: submittedBody.proposedEndedAt,
            reason: submittedBody.reason,
            description: submittedBody.description,
            incidentType: null,
            technicalDetails: null,
            gpsLatitude: null,
            gpsLongitude: null,
            gpsAccuracyMeters: null,
            status: 'pending',
            createdAt: new Date().toISOString(),
          };
          return createdRequest;
        }
        if (url.startsWith('/api/teacher-control/sessions')) return [];
        if (url.startsWith('/api/teacher-control/statistics')) {
          return {
            totalSessions: 0,
            openSessions: 0,
            completedSessions: 0,
            incompleteSessions: 0,
            regularizedSessions: 0,
            pendingRegularizations: 1,
            validatedDurationMilliseconds: 0,
            estimatedCompensationXof: 0,
          };
        }
        if (url.startsWith('/api/teacher-control/regularizations')) {
          return createdRequest ? [{ request: createdRequest, decisions: [] }] : [];
        }
        if (url === '/api/teacher-control/assignments') {
          return [{
            assignmentId: 9,
            classId: 30,
            className: '6e A',
            subjectId: 40,
            subjectName: 'Mathématiques',
          }];
        }
        return {};
      });
      render(<TeacherControlView {...defaultProps} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Demander la régularisation d’une séance non enregistrée' }));
      fireEvent.change(screen.getByLabelText('Classe de la demande'), { target: { value: '30' } });
      fireEvent.change(screen.getByLabelText('Matière de la demande'), { target: { value: '40' } });
      const start = new Date(Date.now() - 3_600_000).toISOString().slice(0, 16);
      const end = new Date(Date.now() - 1_800_000).toISOString().slice(0, 16);
      fireEvent.change(screen.getByLabelText('Début déclaré'), { target: { value: start } });
      fireEvent.change(screen.getByLabelText('Fin déclarée'), { target: { value: end } });
      fireEvent.change(screen.getByLabelText('Motif / explication'), { target: { value: 'Oubli de saisie' } });
      fireEvent.click(screen.getByRole('button', { name: 'Transmettre à l’administration' }));

      expect(await screen.findByText(/DÉCLARATION TARDIVE/)).toBeTruthy();
      expect(submittedBody).toMatchObject({
        requestType: 'late_declaration',
        classId: 30,
        subjectId: 40,
        reason: 'Oubli de saisie',
      });
      expect(submittedBody).not.toHaveProperty('schoolId');
      expect(submittedBody).not.toHaveProperty('referenceStartedAt');
      expect(typeof submittedBody?.declaredStartedAt).toBe('string');
      expect(typeof submittedBody?.proposedEndedAt).toBe('string');
      expect(window.location.pathname).toBe('/');
    });
});
