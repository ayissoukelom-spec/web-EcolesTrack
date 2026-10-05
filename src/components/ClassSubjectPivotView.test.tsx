import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClassSubjectPivotView from './ClassSubjectPivotView';

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

describe('ClassSubjectPivotView', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/classes?')) {
        return [{ id: 5, name: '3ème A', academicYearId: 4, yearName: '2025-2026' }];
      }
      if (url.startsWith('/api/school-terms?')) {
        return [{ id: 21, name: 'Trimestre 1', periodType: 'trimester' }];
      }
      if (url.startsWith('/api/results/class-subject-pivot?')) {
        return {
          school: { id: 9, name: 'École A' },
          academicYear: { id: 4, name: '2025-2026' },
          period: { id: 21, name: 'Trimestre 1', periodType: 'trimester' },
          classes: [{ id: 5, name: '3ème A', levelId: 2, levelName: '3ème' }],
          subjects: [{ id: 7, name: 'Mathématiques' }],
          cells: [{
            classId: 5,
            subjectId: 7,
            average: 15.5,
            studentsWithResult: 2,
            studentsWithoutResult: 1,
          }],
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(() => cleanup());

  it('loads the current official class-subject matrix and exposes result counts', async () => {
    render(<ClassSubjectPivotView schoolsList={[{ id: 9, name: 'École A' }]} />);

    fireEvent.change(screen.getByLabelText('Établissement'), { target: { value: '9' } });

    expect(await screen.findByText('15,50')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Mathématiques' })).toBeTruthy();
    expect(screen.getByText('Avec résultat : 2')).toBeTruthy();
    expect(screen.getByText('Sans résultat : 1')).toBeTruthy();
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/results/class-subject-pivot?'));
    });
  });
});
