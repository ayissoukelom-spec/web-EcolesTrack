import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClassResultsView from './ClassResultsView';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock('../lib/api.ts', () => ({
  apiFetch: apiFetchMock,
  getUiErrorMessage: (error: unknown, fallback?: string) => error instanceof Error ? error.message : fallback ?? null,
}));

vi.mock('../contexts/AuthContext.tsx', () => ({
  useAuth: () => ({ role: 'super_admin' }),
}));

describe('ClassResultsView', () => {
  let downloadFilename = '';
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;
  let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    downloadFilename = '';
    originalCreateObjectUrl = URL.createObjectURL;
    originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:ranking') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      downloadFilename = this.download;
    });
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/classes?')) {
        return [{ id: 5, name: '3ème A', schoolId: 9, academicYearId: 4 }];
      }
      if (url.startsWith('/api/school-terms?')) {
        return [
          { id: 21, name: 'Trimestre 1', periodType: 'trimester' },
          { id: 22, name: 'Semestre 1', periodType: 'semester' },
        ];
      }
      if (url.startsWith('/api/results/class-ranking?')) {
        const periodId = new URLSearchParams(url.split('?')[1]).get('periodId');
        return {
          school: { id: 9, name: 'École A' },
          class: { id: 5, name: '3ème A' },
          period: { id: Number(periodId), name: periodId === '21' ? 'Trimestre 1' : 'Semestre 1', periodType: null },
          students: [{
            studentId: 1,
            firstName: 'Alice',
            lastName: 'Akakpo',
            average: periodId === '21' ? 15 : 12,
            rank: 1,
          }],
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('reloads the class ranking for the selected period', async () => {
    render(<ClassResultsView schoolsList={[{ id: 9, name: 'École A' }]} />);

    expect(screen.queryByRole('button', { name: 'Télécharger Excel' })).toBeNull();
    fireEvent.change(screen.getByLabelText('École'), { target: { value: '9' } });
    fireEvent.change(await screen.findByLabelText('Classe'), { target: { value: '5' } });

    expect(await screen.findByText('15,00')).toBeTruthy();
    const exportButton = await screen.findByRole('button', { name: 'Télécharger Excel' });
    fireEvent.click(exportButton);
    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalled());
    expect(downloadFilename).toBe('classement-officiel_3eme-a_trimestre-1.xlsx');

    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '22' } });
    expect(screen.queryByRole('button', { name: 'Télécharger Excel' })).toBeNull();

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('periodId=22'));
      expect(screen.getByText('12,00')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Télécharger Excel' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Mode de classement'), { target: { value: 'custom' } });
    expect(screen.queryByRole('button', { name: 'Télécharger Excel' })).toBeNull();
  });

  it('shows a clear message when Excel generation fails', async () => {
    render(<ClassResultsView schoolsList={[{ id: 9, name: 'École A' }]} />);

    fireEvent.change(screen.getByLabelText('École'), { target: { value: '9' } });
    fireEvent.change(await screen.findByLabelText('Classe'), { target: { value: '5' } });
    const exportButton = await screen.findByRole('button', { name: 'Télécharger Excel' });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => { throw new Error('Excel generation failed'); },
    });

    fireEvent.click(exportButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('Excel generation failed');
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it('calculates the non-official ranking from selected evaluations and resets it when the period changes', async () => {
    const availableEvaluations = [
      {
        id: 31,
        subjectId: 7,
        subject: 'Mathématiques',
        title: 'Devoir 1',
        type: 'devoir',
        coefficient: 2,
        maxScore: 40,
        countInBulletin: false,
        date: '2026-10-10',
      },
      {
        id: 32,
        subjectId: 7,
        subject: 'Mathématiques',
        title: 'Devoir 2',
        type: 'devoir',
        coefficient: 1,
        maxScore: 20,
        countInBulletin: true,
        date: '2026-10-11',
      },
      {
        id: 33,
        subjectId: 8,
        subject: 'Français',
        title: 'Composition 1',
        type: 'composition',
        coefficient: 1,
        maxScore: 20,
        countInBulletin: true,
        date: '2026-10-12',
      },
    ];
    apiFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      if (url.startsWith('/api/classes?')) {
        return [{ id: 5, name: '3ème A', schoolId: 9, academicYearId: 4 }];
      }
      if (url.startsWith('/api/school-terms?')) {
        return [
          { id: 21, name: 'Trimestre 1', periodType: 'trimester' },
          { id: 22, name: 'Trimestre 2', periodType: 'trimester' },
        ];
      }
      if (url.startsWith('/api/results/class-ranking/available-evaluations?')) return availableEvaluations;
      if (url === '/api/results/class-ranking/custom' && options?.method === 'POST') {
        return {
          school: { id: 9, name: 'École A' },
          class: { id: 5, name: '3ème A' },
          period: { id: 21, name: 'Trimestre 1', periodType: 'trimester' },
          evaluations: [availableEvaluations[0]],
          rankedStudentCount: 1,
          calculatedAt: '2026-11-10T12:00:00.000Z',
          students: [
            {
              studentId: 1,
              matricule: 'E001',
              firstName: 'Alice',
              lastName: 'Akakpo',
              subjectAverages: [{ subjectId: 7, subjectName: 'Mathématiques', average: 15 }],
              missingSubjects: [],
              missingEvaluations: [],
              average: 15,
              rank: 1,
            },
            {
              studentId: 2,
              matricule: 'E002',
              firstName: 'Benoît',
              lastName: 'Zinsou',
              subjectAverages: [{ subjectId: 7, subjectName: 'Mathématiques', average: null }],
              missingSubjects: ['Mathématiques'],
              missingEvaluations: ['Mathématiques — Devoir 1'],
              average: null,
              rank: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ClassResultsView schoolsList={[{ id: 9, name: 'École A' }]} />);

    fireEvent.change(screen.getByLabelText('Mode de classement'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('École'), { target: { value: '9' } });
    fireEvent.change(await screen.findByLabelText('Classe'), { target: { value: '5' } });
    const firstEvaluation = await screen.findByLabelText('Mathématiques — Devoir 1');
    expect(await screen.findByLabelText('Français — Composition 1')).toBeTruthy();
    expect(screen.getByText(/compositions à prendre en compte/)).toBeTruthy();
    expect(await screen.findByText(/hors bulletin/)).toBeTruthy();
    fireEvent.click(firstEvaluation);
    fireEvent.click(screen.getByRole('button', { name: 'Calculer les rangs' }));

    expect(await screen.findByText('E001')).toBeTruthy();
    expect(screen.getAllByText('Classement personnalisé — non officiel')).toHaveLength(2);
    expect(screen.getAllByText('15,00')).toHaveLength(2);
    const exportButton = screen.getByRole('button', { name: 'Télécharger Excel' });
    fireEvent.click(exportButton);
    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalled());
    expect(downloadFilename).toBe('classement-personnalise_3eme-a_trimestre-1.xlsx');
    expect(screen.queryByText('Notes / matières manquantes')).toBeNull();
    const rowWithoutGrade = screen.getByText('E002').closest('tr');
    expect(rowWithoutGrade?.querySelectorAll('td')).toHaveLength(5);
    expect(rowWithoutGrade?.querySelectorAll('td')[3].textContent).toBe('—');
    expect(rowWithoutGrade?.querySelectorAll('td')[4].textContent).toBe('—');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/results/class-ranking/custom', {
      method: 'POST',
      body: JSON.stringify({
        schoolId: 9,
        classId: 5,
        periodId: 21,
        evaluationIds: [31],
      }),
    });

    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '22' } });
    expect(screen.queryByRole('button', { name: 'Télécharger Excel' })).toBeNull();
    await waitFor(() => {
      expect(screen.queryByText('E001')).toBeNull();
      expect(screen.getByLabelText('Mathématiques — Devoir 1')).not.toBeChecked();
      expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('periodId=22'));
    });
  });
});
