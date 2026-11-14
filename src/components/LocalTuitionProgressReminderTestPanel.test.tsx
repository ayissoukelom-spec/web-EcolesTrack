import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/api.ts';
import LocalTuitionProgressReminderTestPanel from './LocalTuitionProgressReminderTestPanel.tsx';
import type { Parent, School, Student } from '../types.ts';

vi.mock('../lib/api.ts', () => ({ apiFetch: vi.fn() }));

const schools: School[] = [{ id: 1, name: 'École de test' }];
const students: Student[] = [{
  id: 2,
  schoolId: 1,
  parentId: 4,
  classId: 5,
  className: 'CM2',
  firstName: 'Afi',
  lastName: 'Test',
  isActive: true,
}];
const parents: Parent[] = [{
  id: 4,
  userId: 3,
  name: 'Parent Test',
  schoolId: 1,
}];
const target = { schoolId: 1, studentId: 2, parentUserId: 3, deviceId: '42' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LocalTuitionProgressReminderTestPanel', () => {
  it('requires explicit confirmation and submits only the selected test tuple', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === '/api/admin/tuition-progress-reminder-local-test') {
        return { availableLocally: true, enabled: true, reason: null, targets: [target] };
      }
      if (path.endsWith('/run')) return { simulatedAt: '2027-07-16T08:00:00.000Z' };
      return null;
    });

    render(
      <LocalTuitionProgressReminderTestPanel
        schools={schools}
        students={students}
        parents={parents}
      />,
    );
    const runButton = await screen.findByRole('button', { name: 'Simuler et envoyer au seul appareil de test' });
    expect(runButton).toBeDisabled();
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Confirmer l’envoi au seul appareil de test'));
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(2);
    });
    const [, options] = vi.mocked(apiFetch).mock.calls[1];
    expect(vi.mocked(apiFetch).mock.calls[1][0]).toBe('/api/admin/tuition-progress-reminder-local-test/run');
    expect(JSON.parse(String(options?.body))).toMatchObject({
      ...target,
      monthStart: expect.stringMatching(/^\d{4}-(0[1-9]|1[0-2])-01$/),
    });
  });

  it('shows the server-side security failure and keeps sending disabled', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      availableLocally: false,
      enabled: false,
      reason: 'local_test_database_identity_unverified',
      targets: [],
    });

    render(
      <LocalTuitionProgressReminderTestPanel
        schools={schools}
        students={students}
        parents={parents}
      />,
    );
    expect(await screen.findByText(/vérification PostgreSQL a échoué/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simuler et envoyer au seul appareil de test' })).toBeDisabled();
  });

  it('displays the server preparation diagnosis without replacing it with a generic message', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === '/api/admin/tuition-progress-reminder-local-test') {
        return { availableLocally: true, enabled: true, reason: null, targets: [target] };
      }
      if (path.endsWith('/run')) {
        throw new Error('Aucune date de contrôle « dernier jour du mois à 08 h » n’est planifiée.');
      }
      return null;
    });

    render(
      <LocalTuitionProgressReminderTestPanel
        schools={schools}
        students={students}
        parents={parents}
      />,
    );
    fireEvent.click(await screen.findByLabelText('Confirmer l’envoi au seul appareil de test'));
    fireEvent.click(screen.getByRole('button', { name: 'Simuler et envoyer au seul appareil de test' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Aucune date de contrôle « dernier jour du mois à 08 h » n’est planifiée.',
    );
  });

  it('shows the panel but keeps sending disabled when no device allowlist is configured', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      availableLocally: true,
      enabled: false,
      reason: 'test_targets_not_configured',
      targets: [],
    });

    render(
      <LocalTuitionProgressReminderTestPanel
        schools={schools}
        students={students}
        parents={parents}
      />,
    );

    expect(await screen.findByText(/configurez une cible autorisée/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simuler et envoyer au seul appareil de test' })).toBeDisabled();
  });

  it('shows an explicit message and disabled send action when the configuration API rejects the request', async () => {
    vi.mocked(apiFetch).mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    render(
      <LocalTuitionProgressReminderTestPanel
        schools={schools}
        students={students}
        parents={parents}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/API a refusé l’accès \(403\)/);
    expect(screen.getByRole('button', { name: 'Simuler et envoyer au seul appareil de test' })).toBeDisabled();
  });
});
