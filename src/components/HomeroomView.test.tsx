// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeroomClassDetail, HomeroomClassSummary } from '../lib/api.ts';

const fetchHomeroomClass = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.ts', () => ({ fetchMyHomeroomClass: fetchHomeroomClass }));

import HomeroomView from './HomeroomView.tsx';

afterEach(() => {
  cleanup();
  fetchHomeroomClass.mockReset();
});

const homeroomClasses: HomeroomClassSummary[] = [
  { id: 10, name: '6ème A', schoolId: 1, schoolName: 'École A', academicYearId: 2, yearName: '2025-2026', levelId: 1, levelName: 'Sixième', teacherId: 7, teacherName: 'Titulaire' },
  { id: 20, name: '5ème B', schoolId: 1, schoolName: 'École A', academicYearId: 2, yearName: '2025-2026', levelId: 2, levelName: 'Cinquième', teacherId: 7, teacherName: 'Titulaire' },
];

const detailFor = (classSummary: HomeroomClassSummary): HomeroomClassDetail => ({
  class: { ...classSummary, schoolAddress: null, schoolPhone: null },
  students: [],
  evaluations: [],
  grades: [],
  absences: [],
  lateArrivals: [],
  bulletins: [],
  examResults: [],
});

describe('HomeroomView', () => {
  it('renders class information without administrative write actions', async () => {
    fetchHomeroomClass.mockResolvedValue(detailFor(homeroomClasses[0]));
    render(<HomeroomView classes={[homeroomClasses[0]]} />);

    expect(await screen.findByText('6ème A')).toBeTruthy();
    expect(screen.getByText('Consultation en lecture seule')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Élèves et responsables' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ajouter|modifier|supprimer|enregistrer|affecter/i })).toBeNull();
  });

  it('allows selecting only classes returned by the homeroom API', async () => {
    fetchHomeroomClass.mockImplementation(async (classId: number) => detailFor(homeroomClasses.find((item) => item.id === classId)!));
    render(<HomeroomView classes={homeroomClasses} />);

    expect(await screen.findByText('6ème A')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Classe' }), { target: { value: '20' } });

    expect(await screen.findByText('5ème B')).toBeTruthy();
    expect(fetchHomeroomClass).toHaveBeenLastCalledWith(20);
  });
});