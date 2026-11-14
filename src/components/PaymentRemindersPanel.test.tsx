import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/api.ts';
import PaymentRemindersPanel from './PaymentRemindersPanel.tsx';
import type { Class } from '../types.ts';

vi.mock('../lib/api.ts', () => ({ apiFetch: vi.fn() }));

const classes: Class[] = [{ id: 2, schoolId: 1, academicYearId: 4, name: '6e' }];
const candidates = [
  {
    studentId: 10,
    firstName: 'Afi',
    lastName: 'Doe',
    className: '6e',
    obligationClassNames: ['6e'],
    installments: [{
      id: 41,
      obligationId: 31,
      categoryLabel: 'Scolarité',
      feeLabel: 'Scolarité annuelle',
      label: 'Tranche 1',
      dueDate: '2000-01-01',
      amount: 10000,
      paid: 2000,
      remaining: 8000,
      status: 'overdue' as const,
    }],
    ambiguousInstallments: [],
    matchedInstallmentCount: 1,
    settledInstallmentCount: 0,
    totalRemaining: 8000,
    earliestDueDate: '2000-01-01',
    status: 'overdue' as const,
    canSend: true,
    alreadyNotified: false,
    reason: null,
    message: 'Rappel pour Afi Doe',
    dedupeKey: 'key-10',
  },
  {
    studentId: 11,
    firstName: 'Binta',
    lastName: 'Cole',
    className: '6e',
    obligationClassNames: ['6e'],
    installments: [{
      id: 42,
      obligationId: 32,
      categoryLabel: 'Scolarité',
      feeLabel: 'Scolarité annuelle',
      label: 'Tranche 1',
      dueDate: '2000-01-01',
      amount: 12000,
      paid: 0,
      remaining: 12000,
      status: 'overdue' as const,
    }],
    ambiguousInstallments: [],
    matchedInstallmentCount: 1,
    settledInstallmentCount: 0,
    totalRemaining: 12000,
    earliestDueDate: '2000-01-01',
    status: 'overdue' as const,
    canSend: true,
    alreadyNotified: false,
    reason: null,
    message: 'Rappel pour Binta Cole',
    dedupeKey: 'key-11',
  },
];

const renderPanel = () => render(
  <PaymentRemindersPanel
    schoolId={1}
    schoolName="École test"
    yearId={4}
    yearName="2026-2027"
    classes={classes}
  />,
);

beforeEach(() => {
  vi.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path.includes('/api/accounting/reminders/candidates')) {
      return { candidates, deliveryChannel: 'in_app' };
    }
    if (path.includes('/api/accounting/reminders/preview')) {
      return { previewFingerprint: 'a'.repeat(64), candidates, deliveryChannel: 'in_app' };
    }
    if (path.includes('/api/accounting/reminders/confirm')) {
      return {
        selectedStudentCount: 2,
        createdNotifications: 2,
        duplicateCount: 0,
        excludedZeroBalance: 0,
        excludedAmbiguous: 0,
        excludedNoRecipient: 0,
        excludedNoMatchingInstallments: 0,
        studentsWithAmbiguousInstallments: 0,
        ambiguousInstallmentCount: 0,
        failedCount: 0,
        deliveryChannel: 'in_app',
      };
    }
    return [];
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PaymentRemindersPanel', () => {
  it('keeps hidden student selections when deselecting only the filtered students', async () => {
    renderPanel();
    await screen.findByLabelText('Sélectionner Afi Doe');

    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner les élèves affichés' }));
    fireEvent.change(screen.getByLabelText('Rechercher un élève dans les rappels'), {
      target: { value: 'Afi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Désélectionner les élèves affichés' }));
    fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));

    expect(screen.getByLabelText('Sélectionner Afi Doe')).not.toBeChecked();
    expect(screen.getByLabelText('Sélectionner Binta Cole')).toBeChecked();
    expect(screen.getByText('1 élève(s) sélectionné(s)')).toBeTruthy();
  });

  it('requires an explicit preview and confirmation to create internal reminders', async () => {
    renderPanel();
    await screen.findByLabelText('Sélectionner Afi Doe');
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner les élèves affichés' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prévisualiser 2 élève(s)' }));

    expect(await screen.findByText('Prévisualisation avant confirmation')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith('/api/accounting/reminders/preview', expect.objectContaining({
      method: 'POST',
    }));
    expect(apiFetch).not.toHaveBeenCalledWith('/api/accounting/reminders/confirm', expect.anything());

    fireEvent.click(screen.getByRole('button', {
      name: 'Confirmer la création de 2 notification(s) interne(s)',
    }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/accounting/reminders/confirm', expect.objectContaining({
        method: 'POST',
      }));
    });
    expect(await screen.findByText(/Notifications créées : 2/)).toBeTruthy();
  });
});
