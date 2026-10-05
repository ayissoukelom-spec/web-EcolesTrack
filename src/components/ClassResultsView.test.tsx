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
  beforeEach(() => {
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

  afterEach(() => cleanup());

  it('reloads the class ranking for the selected period', async () => {
    render(<ClassResultsView schoolsList={[{ id: 9, name: 'École A' }]} />);

    fireEvent.change(screen.getByLabelText('École'), { target: { value: '9' } });
    fireEvent.change(await screen.findByLabelText('Classe'), { target: { value: '5' } });

    expect(await screen.findByText('15,00')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '22' } });

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('periodId=22'));
      expect(screen.getByText('12,00')).toBeTruthy();
    });
  });
});
