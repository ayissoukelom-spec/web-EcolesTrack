import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  apiFetchMock.mockImplementation(async (url: string) => {
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

    expect(await screen.findByText('Contrôle des enseignants')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Début' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fin' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Classe' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Début' }));
    expect(await screen.findByRole('combobox', { name: 'Classe' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Début' })).toHaveLength(1);
    expect(window.location.pathname).toBe('/');
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/teacher-document-session')).toBe(false);
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
        coords: { latitude: 6.1375, longitude: 1.2123, accuracy: 18 },
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
      accuracyMeters: 18,
      gpsChallenge: 'a'.repeat(43),
    });
    expect(JSON.parse(startCall?.[1]?.body as string)).not.toHaveProperty('timestamp');
    expect(requestOrder.indexOf('geolocation'))
      .toBeLessThan(requestOrder.indexOf('/api/teacher-control/gps-challenges'));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Précision GPS de début' })).toHaveValue('18');
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
      { latitude: 6.1378, longitude: 1.2126, accuracy: 24 },
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
    expect(screen.getByRole('textbox', { name: 'Précision GPS de fin' })).toHaveValue('24');
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
          coords: { latitude: 6.1376, longitude: 1.2124, accuracy: 132 },
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

    expect(await screen.findByText('Position trop imprécise (132 m)')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Précision GPS de début' })).toHaveValue('132');
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

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls.some(([url]) => url === '/api/teacher-control/gps-challenges')).toBe(false);
  });

  it('keeps super-admin session and regularization access read-only', async () => {
    const onSchoolChange = vi.fn();
    const superApi = vi.fn(async (url: string) => {
      if (url.startsWith('/api/teacher-control/sessions')) return [session];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 1,
          openSessions: 1,
          completedSessions: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url.startsWith('/api/teacher-control/regularizations')) return [{
        request: {
          id: 7,
          sessionId: 1,
          teacherNameSnapshot: 'Afi Mensah',
          proposedEndedAt: '2026-10-31T09:00:00.000Z',
          reason: 'Sortie urgente',
          status: 'pending',
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
    expect(await screen.findByText('Afi Mensah · Demande #7')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accepter l’heure proposée' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refuser' })).toBeNull();
  });

  it('requires a reason before a school administrator can reject a regularization request', async () => {
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/teacher-control/sessions')) return [session];
      if (url.startsWith('/api/teacher-control/statistics')) {
        return {
          totalSessions: 1,
          openSessions: 1,
          completedSessions: 0,
          validatedDurationMilliseconds: 0,
          estimatedCompensationXof: 0,
        };
      }
      if (url.startsWith('/api/teacher-control/regularizations/7/decision')) return { request: {}, decision: {}, session };
      if (url.startsWith('/api/teacher-control/regularizations')) {
        return [{
          request: {
            id: 7,
            sessionId: 1,
            teacherNameSnapshot: 'Afi Mensah',
            proposedEndedAt: '2026-10-31T09:00:00.000Z',
            reason: 'Sortie urgente',
            status: 'pending',
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
    render(<TeacherControlView {...defaultProps} userRole="school_admin" />);
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
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la configuration' }));

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
});
