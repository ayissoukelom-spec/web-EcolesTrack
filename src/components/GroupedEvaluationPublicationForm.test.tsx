import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GroupedEvaluationPublicationForm from './GroupedEvaluationPublicationForm';

const api = vi.hoisted(() => ({
  getAvailability: vi.fn(),
  getOptions: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('../lib/groupedEvaluationPublicationApi.ts', () => ({
  getGroupedEvaluationPublicationAvailability: api.getAvailability,
  getGroupedEvaluationPublicationOptions: api.getOptions,
  getGroupedEvaluationValidationContext: (options: unknown) => options,
  submitGroupedEvaluationPublication: api.submit,
}));

const options = {
  available: true,
  classes: [{ id: 1, name: '6ème A' }, { id: 2, name: '6ème B' }],
  subjects: [{ id: 10, name: 'Mathématiques' }, { id: 11, name: 'Français' }],
  approvedClassIds: [1, 2],
  approvedSubjectIds: [10, 11],
  activeTeachingPairs: [
    { classId: 1, subjectId: 10 },
    { classId: 1, subjectId: 11 },
  ],
  termsByClass: {
    1: [{ id: 100, startDate: '2026-10-01', endDate: '2026-12-31', academicYearId: 5, periodType: 'trimester', orderIndex: 1 }],
    2: [{ id: 101, startDate: '2026-10-01', endDate: '2026-12-31', academicYearId: 5, periodType: 'trimester', orderIndex: 1 }],
  },
};

const optionsWithSemester = {
  ...options,
  classes: [...options.classes, { id: 3, name: 'Classe lycée' }],
  subjects: [...options.subjects, { id: 12, name: 'Physique' }],
  approvedClassIds: [...options.approvedClassIds, 3],
  approvedSubjectIds: [...options.approvedSubjectIds, 12],
  activeTeachingPairs: [
    ...options.activeTeachingPairs,
    { classId: 3, subjectId: 10 },
    { classId: 3, subjectId: 12 },
  ],
  termsByClass: {
    ...options.termsByClass,
    3: [{
      id: 102,
      startDate: '2026-09-01',
      endDate: '2027-01-31',
      academicYearId: 5,
      periodType: 'semester' as const,
      orderIndex: 1,
    }],
  },
};

const successfulResponse = {
  publicationId: 44,
  evaluationIds: [1001],
  evaluationCount: 1,
  notification: { local: 'created', push: 'pending', recipientCount: 2, failedRecipientCount: 0 },
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('GroupedEvaluationPublicationForm', () => {
  it('is only rendered for a school admin', async () => {
    const { rerender } = render(
      <GroupedEvaluationPublicationForm role="teacher" />,
    );
    expect(screen.queryByTestId('grouped-evaluation-publication-form')).toBeNull();
    expect(api.getAvailability).not.toHaveBeenCalled();

    api.getAvailability.mockResolvedValue({ available: false });
    api.getOptions.mockResolvedValue(options);
    rerender(<GroupedEvaluationPublicationForm role="school_admin" />);
    expect(await screen.findByTestId('grouped-evaluation-publication-form')).toBeTruthy();
    expect(screen.getByText(/publication réelle est désactivée/i)).toBeTruthy();
    expect(screen.getByLabelText('Date de début')).toBeTruthy();
    expect(api.getOptions).toHaveBeenCalledOnce();
  });

  it('previews valid and invalid class-subject pairs and blocks an invalid submission', async () => {
    api.getAvailability.mockResolvedValue({ available: true });
    api.getOptions.mockResolvedValue(options);
    render(<GroupedEvaluationPublicationForm role="school_admin" />);

    await screen.findByTestId('grouped-evaluation-publication-form');
    fireEvent.click(screen.getByLabelText(/6ème A/));
    fireEvent.click(screen.getByLabelText(/6ème B/));
    fireEvent.click(screen.getByLabelText('Mathématiques'));

    expect(screen.getByText((_, element) =>
      element?.textContent === '6ème B — Mathématiques (affectation active manquante)',
    )).toBeTruthy();
    expect(screen.getByRole('button', { name: /Vérifier et publier/i })).toBeDisabled();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('shows semester periods and allows an eligible lycée class and its assigned subjects', async () => {
    api.getAvailability.mockResolvedValue({ available: true });
    api.getOptions.mockResolvedValue(optionsWithSemester);
    api.submit.mockResolvedValue(successfulResponse);
    render(<GroupedEvaluationPublicationForm role="school_admin" />);

    await screen.findByTestId('grouped-evaluation-publication-form');
    expect(screen.getByText('Classe lycée')).toBeTruthy();
    expect(screen.getByText('(Semestre S1)')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Date de début'), { target: { value: '2026-11-12' } });
    fireEvent.change(screen.getByLabelText('Date de fin'), { target: { value: '2026-11-15' } });
    fireEvent.click(screen.getByLabelText(/Classe lycée/));
    fireEvent.click(screen.getByLabelText('Mathématiques'));
    fireEvent.click(screen.getByRole('button', { name: /Vérifier et publier/i }));

    await screen.findByText(/Programme enregistré/);
    expect(api.submit).toHaveBeenCalledWith(
      expect.objectContaining({ classIds: [3], subjectIds: [10] }),
      expect.any(String),
    );
  });

  it('blocks selecting trimester and semester classes in the same programme', async () => {
    api.getAvailability.mockResolvedValue({ available: true });
    api.getOptions.mockResolvedValue(optionsWithSemester);
    render(<GroupedEvaluationPublicationForm role="school_admin" />);

    await screen.findByTestId('grouped-evaluation-publication-form');
    fireEvent.change(screen.getByLabelText('Date de début'), { target: { value: '2026-11-12' } });
    fireEvent.change(screen.getByLabelText('Date de fin'), { target: { value: '2026-11-15' } });
    fireEvent.click(screen.getByLabelText(/6ème A/));
    fireEvent.click(screen.getByLabelText(/Classe lycée/));
    fireEvent.click(screen.getByLabelText('Mathématiques'));
    fireEvent.click(screen.getByRole('button', { name: /Vérifier et publier/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/même type de période/i);
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('maps Examen to the grouped request and reuses the idempotency key after a retry', async () => {
    api.getAvailability.mockResolvedValue({ available: true });
    api.getOptions.mockResolvedValue(options);
    api.submit
      .mockRejectedValueOnce({ status: 500, message: 'Temporary failure' })
      .mockResolvedValueOnce(successfulResponse);
    render(<GroupedEvaluationPublicationForm role="school_admin" />);

    await screen.findByTestId('grouped-evaluation-publication-form');
    fireEvent.click(screen.getByRole('radio', { name: /Examen/ }));
    fireEvent.change(screen.getByLabelText('Date de début'), { target: { value: '2026-11-12' } });
    fireEvent.change(screen.getByLabelText('Date de fin'), { target: { value: '2026-11-15' } });
    fireEvent.click(screen.getByLabelText(/6ème A/));
    fireEvent.click(screen.getByLabelText('Mathématiques'));

    fireEvent.click(screen.getByRole('button', { name: /Vérifier et publier/i }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /Vérifier et publier/i }));

    await screen.findByText(/Programme enregistré : 1 évaluation créée/);
    expect(api.submit).toHaveBeenCalledTimes(2);
    const [firstRequest, firstKey] = api.submit.mock.calls[0];
    const [retryRequest, retryKey] = api.submit.mock.calls[1];
    expect(firstRequest).toMatchObject({
      kind: 'examen',
      startDate: '2026-11-12',
      endDate: '2026-11-15',
      classIds: [1],
      subjectIds: [10],
    });
    expect(retryRequest).toEqual(firstRequest);
    expect(retryKey).toBe(firstKey);
    expect(screen.getByText(/Push : en attente de traitement, non confirmé envoyé/)).toBeTruthy();
  });
});
