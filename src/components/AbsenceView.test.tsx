import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AbsenceView from './AbsenceView';

const { downloadAbsenceJustificationMock } = vi.hoisted(() => ({
  downloadAbsenceJustificationMock: vi.fn(),
}));

vi.mock('../lib/api.ts', () => ({
  downloadAbsenceJustification: downloadAbsenceJustificationMock,
}));

afterEach(() => cleanup());

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderJustificationDownloads = () => render(
  <AbsenceView
    userRole="school_admin"
    absencesList={[
      {
        id: 44,
        studentId: 12,
        studentName: 'Awa Exemple',
        classId: 10,
        className: '6e A',
        date: '2026-09-02',
        period: 'morning',
        isJustified: true,
        justificationFileName: 'justificatif-awa.pdf',
      },
      {
        id: 45,
        studentId: 13,
        studentName: 'Kossi Exemple',
        classId: 10,
        className: '6e A',
        date: '2026-09-03',
        period: 'morning',
        isJustified: true,
        justificationFileName: 'justificatif-kossi.pdf',
      },
    ] as any}
    studentsList={[]}
    classesList={[]}
    schoolsList={[]}
    teachersList={[]}
    approvedSubjectsList={[]}
    onAddAbsence={vi.fn()}
    onJustifyAbsence={vi.fn()}
  />,
);

describe('téléchargement des justificatifs d’absence', () => {
  afterEach(() => {
    downloadAbsenceJustificationMock.mockReset();
    vi.restoreAllMocks();
  });

  it('affiche le chargement, ignore le double clic et suit chaque justificatif indépendamment', async () => {
    const firstDownload = createDeferred<Blob>();
    const secondDownload = createDeferred<Blob>();
    downloadAbsenceJustificationMock
      .mockReturnValueOnce(firstDownload.promise)
      .mockReturnValueOnce(secondDownload.promise);
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:justification') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      renderJustificationDownloads();
      const downloadButtons = screen.getAllByRole('button', { name: 'Télécharger' }) as HTMLButtonElement[];
      expect(downloadButtons).toHaveLength(2);

      const awaRow = screen.getByText('Awa Exemple').closest('tr');
      expect(awaRow).not.toBeNull();
      fireEvent.click(within(awaRow as HTMLElement).getByRole('button', { name: 'Télécharger' }));
      const firstLoadingButton = screen.getByRole('button', { name: 'Téléchargement en cours…' }) as HTMLButtonElement;
      expect(firstLoadingButton.disabled).toBe(true);
      expect(screen.getAllByRole('button', { name: 'Télécharger' })[0]).toBeEnabled();

      fireEvent.click(firstLoadingButton);
      expect(downloadAbsenceJustificationMock).toHaveBeenCalledTimes(1);
      expect(downloadAbsenceJustificationMock).toHaveBeenCalledWith(44);

      fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }));
      expect(downloadAbsenceJustificationMock).toHaveBeenCalledTimes(2);
      expect(screen.getAllByRole('button', { name: 'Téléchargement en cours…' })).toHaveLength(2);

      firstDownload.resolve(new Blob(['file']));
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Télécharger' })).toHaveLength(1);
      });
      expect(anchorClick).toHaveBeenCalledTimes(1);

      secondDownload.resolve(new Blob(['file']));
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Télécharger' })).toHaveLength(2);
      });
      expect(anchorClick).toHaveBeenCalledTimes(2);
    } finally {
      if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor);
      else delete (URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor);
      else delete (URL as typeof URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
    }
  });

  it('réactive le bouton si le téléchargement échoue', async () => {
    const failedDownload = createDeferred<Blob>();
    downloadAbsenceJustificationMock.mockReturnValueOnce(failedDownload.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderJustificationDownloads();
    fireEvent.click(screen.getAllByRole('button', { name: 'Télécharger' })[0]);
    expect((screen.getByRole('button', { name: 'Téléchargement en cours…' }) as HTMLButtonElement).disabled).toBe(true);

    failedDownload.reject(new Error('Download failed'));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Télécharger' })).toHaveLength(2);
    });
    expect(screen.getAllByRole('button', { name: 'Télécharger' }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith('Impossible de télécharger le justificatif', expect.any(Error));
  });
});

describe('visibilite du bouton Justifier', () => {
  it.each([
    ['parent', true],
    ['school_admin', false],
    ['super_admin', false],
    ['teacher', false],
    ['surveillant', false],
    ['student', false],
  ])('%s: bouton visible = %s', (role, expectedVisible) => {
    render(
      <AbsenceView
        userRole={role as any}
        absencesList={[{
          id: 44,
          studentId: 12,
          studentName: 'Awa Exemple',
          classId: 10,
          className: '6e A',
          date: '2026-09-02',
          period: 'morning',
          isJustified: false,
        }] as any}
        studentsList={[]}
        classesList={[]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onJustifyAbsence={vi.fn()}
      />
    );

    expect(Boolean(screen.queryByRole('button', { name: 'Justifier' }))).toBe(expectedVisible);
  });
});

describe('absence liée à une déclaration parentale', () => {
  it('affiche le lien sans classer l’absence comme injustifiée', () => {
    render(
      <AbsenceView
        userRole="parent"
        absencesList={[{
          id: 52,
          studentId: 12,
          studentName: 'Awa Exemple',
          classId: 10,
          className: '6e A',
          date: '2026-09-29',
          period: 'morning',
          isJustified: false,
          declarationId: 9,
        }] as any}
        studentsList={[]}
        classesList={[]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onJustifyAbsence={vi.fn()}
      />
    );

    const linkedRow = screen.getByText('Déclaration parentale associée').closest('tr');
    expect(linkedRow).not.toBeNull();
    expect(linkedRow?.textContent).not.toContain('Injustifiée');
    expect(linkedRow?.textContent).toContain('Absence rattachée à une déclaration parentale');
  });
});

describe('section repliable des déclarations', () => {
  const baseProps = {
    userRole: 'school_admin' as const,
    absencesList: [{
      id: 101,
      studentId: 1,
      studentName: 'Élève Absente',
      classId: 10,
      className: '6e A',
      date: '2026-09-29',
      period: 'morning' as const,
      isJustified: false,
    }],
    studentsList: [],
    classesList: [],
    schoolsList: [],
    teachersList: [],
    approvedSubjectsList: [],
    onAddAbsence: vi.fn(),
    onJustifyAbsence: vi.fn(),
    onReviewAbsenceDeclaration: vi.fn().mockResolvedValue(undefined),
  };

  it('is collapsed by default, keeps its RECEIVED badge visible, and toggles the list', () => {
    const declarations = [{
      id: 51,
      studentId: 1,
      studentName: 'Déclaration Élève',
      parentName: 'Parent Exemple',
      classId: 10,
      className: '6e A',
      schoolId: 1,
      date: '2026-10-01',
      startTime: '08:00',
      endTime: '09:00',
      status: 'RECEIVED' as const,
      createdAt: '2026-09-29T09:00:00.000Z',
    }];
    render(<AbsenceView {...baseProps} absenceDeclarationsList={declarations as any} />);

    const toggle = screen.getByTestId('absence-declarations-toggle');
    expect(within(toggle).getByText('Déclarations d’absence à traiter')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(toggle).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('Déclaration Élève')).toBeNull();
    expect(screen.getByText('Élève Absente')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Déclaration Élève')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Déclaration Élève')).toBeNull();
    expect(screen.getByText('Élève Absente')).toBeInTheDocument();
  });

  it('does not render a large declaration list while the section is closed', () => {
    const declarations = Array.from({ length: 1000 }, (_, index) => ({
      id: index + 1,
      studentId: index + 1,
      studentName: `Déclaration ${index + 1}`,
      classId: 10,
      className: '6e A',
      schoolId: 1,
      date: '2026-10-01',
      startTime: '08:00',
      endTime: '09:00',
      status: 'RECEIVED' as const,
    }));
    render(<AbsenceView {...baseProps} absenceDeclarationsList={declarations as any} />);

    const toggle = screen.getByTestId('absence-declarations-toggle');
    expect(within(toggle).getByText('99+')).toBeInTheDocument();
    expect(screen.queryByTestId('absence-declaration-1000')).toBeNull();
    expect(screen.queryByText('Déclaration 1000')).toBeNull();
    expect(screen.getByText('Élève Absente')).toBeInTheDocument();
  });

  it('omits the badge when no declaration needs action', () => {
    render(<AbsenceView {...baseProps} absenceDeclarationsList={[{
      id: 52,
      studentId: 1,
      studentName: 'Déjà traitée',
      classId: 10,
      className: '6e A',
      schoolId: 1,
      date: '2026-10-01',
      startTime: '08:00',
      endTime: '09:00',
      status: 'ACCEPTED',
    } as any]} />);

    expect(screen.queryByTestId('absence-declarations-count')).toBeNull();
  });

  it('requires a nonblank reason before submitting a parent declaration', async () => {
    const onCreateAbsenceDeclaration = vi.fn().mockResolvedValue(undefined);
    render(
      <AbsenceView
        {...baseProps}
        userRole="parent"
        studentsList={[{ id: 8, schoolId: 1, classId: 10, firstName: 'Awa', lastName: 'Test' } as any]}
        onCreateAbsenceDeclaration={onCreateAbsenceDeclaration}
      />
    );

    fireEvent.click(screen.getByTestId('absence-declarations-toggle'));
    fireEvent.click(screen.getByRole('button', { name: /Déclarer une absence/i }));

    const reasonInput = screen.getByLabelText('Motif');
    expect(reasonInput).toHaveAttribute('required');
    fireEvent.change(reasonInput, { target: { value: '   ' } });
    fireEvent.submit(reasonInput.closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Veuillez saisir un motif de déclaration.');
    expect(onCreateAbsenceDeclaration).not.toHaveBeenCalled();
  });
});

describe('AbsenceView surveillant', () => {
  it('affiche le bouton de signalement pour un surveillant', () => {
    render(
      <AbsenceView
        userRole="surveillant"
        absencesList={[]}
        studentsList={[]}
        classesList={[]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Signaler une absence/i })).toBeTruthy();
  });

  it('affiche les matières approuvées sans spécialisation de surveillant', () => {
    render(
      <AbsenceView
        userRole="surveillant"
        absencesList={[]}
        studentsList={[{ id: 1, classId: 10, firstName: 'Ada', lastName: 'Lovelace', schoolId: 7 } as any]}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[{ id: 4, name: 'Mathematiques' }, { id: 5, name: 'Histoire' }]}
        onAddAbsence={vi.fn()}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Signaler une absence/i }));
    expect(screen.getByText('Mathematiques')).toBeTruthy();
    expect(screen.getByText('Histoire')).toBeTruthy();
  });

  it('filtre les absences par statut et conserve la combinaison avec la classe', () => {
    render(
      <AbsenceView
        userRole="surveillant"
        absencesList={[
          { id: 1, studentId: 1, studentName: 'Ada Justifiee', classId: 10, className: '6e A', date: '2026-09-01', period: 'morning', subjectName: 'Maths', isJustified: true },
          { id: 2, studentId: 2, studentName: 'Grace Injustifiee', classId: 10, className: '6e A', date: '2026-09-02', period: 'morning', subjectName: 'Maths', isJustified: false },
          { id: 3, studentId: 3, studentName: 'Alan Justifie', classId: 11, className: '5e B', date: '2026-09-03', period: 'morning', subjectName: 'Maths', isJustified: true },
        ] as any}
        studentsList={[]}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any, { id: 11, name: '5e B', schoolId: 7 } as any]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: '10' } });
    fireEvent.change(selects[3], { target: { value: 'unjustified' } });

    expect(screen.getByText('Grace Injustifiee')).toBeTruthy();
    expect(screen.queryByText('Ada Justifiee')).toBeNull();
    expect(screen.queryByText('Alan Justifie')).toBeNull();
  });

  it('ordonne la liste par date, heure de début puis identifiant, y compris après filtrage', () => {
    const { container } = render(
      <AbsenceView
        userRole="surveillant"
        absencesList={[
          { id: 1, studentId: 1, studentName: 'Absence du 6 octobre', classId: 10, className: '6e A', date: '2026-10-06', period: 'morning', startTime: '08:00', isJustified: false },
          { id: 2, studentId: 1, studentName: 'Absence du 8 octobre matin ID 2', classId: 10, className: '6e A', date: '2026-10-08', period: 'morning', startTime: '08:00', isJustified: false },
          { id: 3, studentId: 1, studentName: 'Absence du 8 octobre après-midi', classId: 10, className: '6e A', date: '2026-10-08', period: 'afternoon', startTime: '12:00', isJustified: false },
          { id: 4, studentId: 1, studentName: 'Absence du 7 octobre', classId: 10, className: '6e A', date: '2026-10-07', period: 'morning', startTime: '08:00', isJustified: false },
          { id: 5, studentId: 1, studentName: 'Absence du 8 octobre matin ID 5', classId: 10, className: '6e A', date: '2026-10-08', period: 'morning', startTime: '08:00', isJustified: false },
        ] as any}
        studentsList={[]}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    const getDisplayedStudentNames = () => Array.from(
      container.querySelectorAll('#absences-table-container tbody tr'),
      (row) => row.querySelector('td')?.textContent?.trim(),
    );

    expect(getDisplayedStudentNames()).toEqual([
      'Absence du 8 octobre après-midi',
      'Absence du 8 octobre matin ID 5',
      'Absence du 8 octobre matin ID 2',
      'Absence du 7 octobre',
      'Absence du 6 octobre',
    ]);

    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: '2026-10-08' },
    });

    expect(getDisplayedStudentNames()).toEqual([
      'Absence du 8 octobre après-midi',
      'Absence du 8 octobre matin ID 5',
      'Absence du 8 octobre matin ID 2',
    ]);
  });

  it('filtre les retards par statut avec les filtres existants', () => {
    const onAddAbsence = vi.fn();
    const onAddLateArrival = vi.fn();

    render(
      <AbsenceView
        userRole="surveillant"
        absencesList={[
          { id: 1, studentId: 1, studentName: 'Ada Absente', classId: 10, className: '6e A', date: '2026-09-01', period: 'morning', subjectName: 'Maths', isJustified: false },
        ] as any}
        lateArrivalsList={[
          { id: 2, studentId: 2, studentName: 'Grace Retard', classId: 10, className: '6e A', date: '2026-09-02', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:15', lateMinutes: 15, reason: 'Trafic' },
        ]}
        studentsList={[]}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={onAddAbsence}
        onAddLateArrival={onAddLateArrival}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Filtrer par statut')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'late' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '10' } });
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-09-02' } });

    expect(screen.getByText('Grace Retard')).toBeTruthy();
    expect(screen.queryByText('Ada Absente')).toBeNull();
    expect(onAddAbsence).not.toHaveBeenCalled();
    expect(onAddLateArrival).not.toHaveBeenCalled();
  });

  it('exclut une absence justifiée lorsque le filtre Retard est sélectionné', () => {
    render(
      <AbsenceView
        userRole="surveillant"
        absencesList={[
          { id: 10, studentId: 10, studentName: 'Élève Absence Justifiée', classId: 10, className: '6e A', date: '2026-09-02', period: 'morning', subjectName: 'Maths', isJustified: true },
        ] as any}
        lateArrivalsList={[
          { id: 20, studentId: 20, studentName: 'Élève Retard', classId: 10, className: '6e A', date: '2026-09-02', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:15', lateMinutes: 15, reason: 'Trafic' },
        ]}
        studentsList={[]}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onAddLateArrival={vi.fn()}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'late' } });

    expect(screen.getByText('Élève Retard')).toBeTruthy();
    expect(screen.queryAllByRole('row').some((row) => row.textContent?.includes('Élève Absence Justifiée'))).toBe(false);
  });

  it('affiche et déclenche les actions accepter/rejeter pour une justification en attente', async () => {
    const onReviewAbsence = vi.fn().mockResolvedValue(undefined);

    render(
      <AbsenceView
        userRole="school_admin"
        absencesList={[{
          id: 30,
          studentId: 30,
          studentName: 'Élève En Attente',
          classId: 10,
          className: '6e A',
          date: '2026-09-02',
          period: 'morning',
          isJustified: false,
          justificationReason: 'Maladie',
          justificationStatus: 'PENDING',
        }] as any}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        studentsList={[]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onReviewAbsence={onReviewAbsence}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    expect(screen.getByText('En attente de validation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accepter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }));
    await waitFor(() => expect(onReviewAbsence).toHaveBeenCalledWith(30, 'APPROVED'));

    fireEvent.click(screen.getByRole('button', { name: 'Rejeter' }));
    fireEvent.change(screen.getByPlaceholderText('Motif obligatoire du rejet'), {
      target: { value: 'Document illisible' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le rejet' }));
    await waitFor(() => expect(onReviewAbsence).toHaveBeenCalledWith(30, 'REJECTED', 'Document illisible'));
  });

  it('in validation mode, displays only absences with an exact PENDING status', () => {
    render(
      <AbsenceView
        userRole="school_admin"
        pendingReviewOnly
        absencesList={[
          { id: 30, studentId: 30, studentName: 'Élève En Attente', classId: 10, className: '6e A', date: '2026-09-02', period: 'morning', isJustified: false, justificationStatus: 'PENDING' },
          { id: 31, studentId: 31, studentName: 'Élève Acceptée', classId: 10, className: '6e A', date: '2026-09-03', period: 'morning', isJustified: true, justificationStatus: 'APPROVED' },
          { id: 32, studentId: 32, studentName: 'Élève Rejetée', classId: 10, className: '6e A', date: '2026-09-04', period: 'morning', isJustified: false, justificationStatus: 'REJECTED' },
          { id: 33, studentId: 33, studentName: 'Ancien Statut', classId: 10, className: '6e A', date: '2026-09-05', period: 'morning', isJustified: false },
        ] as any}
        lateArrivalsList={[
          { id: 34, studentId: 34, studentName: 'Élève en Retard', classId: 10, className: '6e A', date: '2026-09-06', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:15' },
        ]}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        studentsList={[]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onReviewAbsence={vi.fn().mockResolvedValue(undefined)}
        onJustifyAbsence={vi.fn()}
      />,
    );

    expect(screen.getByText('Élève En Attente')).toBeInTheDocument();
    expect(screen.queryByText('Élève Acceptée')).toBeNull();
    expect(screen.queryByText('Élève Rejetée')).toBeNull();
    expect(screen.queryByText('Ancien Statut')).toBeNull();
    expect(screen.queryByText('Élève en Retard')).toBeNull();
    expect(screen.getByRole('button', { name: 'Accepter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeInTheDocument();
  });

  it('ne permet pas au parent de resoumettre une justification rejetée', () => {
    render(
      <AbsenceView
        userRole="parent"
        absencesList={[{
          id: 31,
          studentId: 30,
          studentName: 'Élève Rejetée',
          classId: 10,
          className: '6e A',
          date: '2026-09-02',
          period: 'morning',
          isJustified: false,
          justificationReason: 'Maladie',
          justificationStatus: 'REJECTED',
          rejectionReason: 'Document illisible',
        }] as any}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        studentsList={[]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={vi.fn()}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />,
    );

    expect(screen.getByText('Justification refusée')).toBeTruthy();
    expect(screen.getByText('Veuillez vous présenter à l’établissement avec les justificatifs nécessaires.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Justifier' })).toBeNull();
  });

  it('enregistre un retard avec son motif sans créer une absence', async () => {
    const onAddAbsence = vi.fn();
    const onAddLateArrival = vi.fn().mockResolvedValue(undefined);

    render(
      <AbsenceView
        userRole="surveillant"
        absencesList={[]}
        studentsList={[
          { id: 1, classId: 10, firstName: 'Ada', lastName: 'Lovelace', schoolId: 7 } as any,
        ]}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={onAddAbsence}
        onAddLateArrival={onAddLateArrival}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Signaler une absence/i }));

    const classPicker = screen.getByRole('button', { name: /6e A/i });
    fireEvent.click(classPicker);
    fireEvent.click(screen.getAllByText('6e A')[1] ?? screen.getAllByText('6e A')[0]);

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Ada' } });
    fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: /Retard/i }));
    fireEvent.change(screen.getByLabelText(/Heure prévue/), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText(/Heure d'arrivée/), { target: { value: '08:18' } });
    fireEvent.change(screen.getByPlaceholderText(/rendez-vous médical/i), {
      target: { value: 'Rendez-vous médical' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Enregistrer$/i }));

    expect(onAddLateArrival).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 1,
        classId: 10,
        date: expect.any(String),
        expectedStartTime: '08:00',
        arrivalTime: '08:18',
        reason: 'Rendez-vous médical',
      })
    );
    expect(onAddAbsence).not.toHaveBeenCalled();
  });

  it('enregistre plusieurs retards sans appeler le flux des absences', async () => {
    const onAddAbsence = vi.fn();
    const onAddLateArrival = vi.fn().mockResolvedValue(undefined);

    render(
      <AbsenceView
        userRole="surveillant"
        absencesList={[]}
        studentsList={[
          { id: 1, classId: 10, firstName: 'Ada', lastName: 'Lovelace', schoolId: 7 } as any,
          { id: 2, classId: 10, firstName: 'Grace', lastName: 'Hopper', schoolId: 7 } as any,
        ]}
        classesList={[{ id: 10, name: '6e A', schoolId: 7 } as any]}
        schoolsList={[]}
        teachersList={[]}
        approvedSubjectsList={[]}
        onAddAbsence={onAddAbsence}
        onAddLateArrival={onAddLateArrival}
        onJustifyAbsence={vi.fn()}
        onRecordAbsenceControl={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Signaler une absence/i }));
    expect(screen.getByRole('button', { name: /Enregistrer les absences sélectionnées/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enregistrer les retards sélectionnés/i })).toBeNull();

    const studentCheckboxes = screen.getAllByRole('checkbox');
    fireEvent.click(studentCheckboxes[0]);
    fireEvent.click(studentCheckboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /^Retard$/i }));
    expect(screen.getByRole('button', { name: /Enregistrer les retards sélectionnés/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enregistrer les absences sélectionnées/i })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Heure prévue/), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText(/Heure d'arrivée/), { target: { value: '09:15' } });
    fireEvent.change(screen.getByPlaceholderText(/rendez-vous médical/i), { target: { value: 'Trafic' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer les retards sélectionnés/i }));

    await waitFor(() => expect(onAddLateArrival).toHaveBeenCalledTimes(2));
    expect(onAddLateArrival.mock.calls.map(([data]) => data.studentId)).toEqual(expect.arrayContaining([1, 2]));
    expect(onAddLateArrival).toHaveBeenCalledWith(expect.objectContaining({ classId: 10, expectedStartTime: '08:00', arrivalTime: '09:15', reason: 'Trafic' }));
    expect(onAddAbsence).not.toHaveBeenCalled();
  });
});

describe('AbsenceView teacher teaching assignment payload', () => {
  const renderTeacherAbsenceForm = (multiple: boolean, onAddAbsence = vi.fn()) => {
    const view = render(
      <AbsenceView
        userRole="teacher"
        absencesList={[]}
        studentsList={[{ id: 1, classId: 10, firstName: 'Ada', lastName: 'Lovelace', schoolId: 7 } as any]}
        classesList={[{ id: 10, name: '3e A', schoolId: 7 } as any]}
        schoolsList={[]}
        teachersList={[]}
        teacherSubjectIds={[5]}
        approvedSubjectsList={[{ id: 5, name: 'Mathématiques' }, { id: 6, name: 'Physique' }]}
        onAddAbsence={onAddAbsence}
        onJustifyAbsence={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Signaler une absence/i }));
    if (multiple) {
      fireEvent.click(screen.getByRole('checkbox'));
    } else {
      const studentFields = view.container.querySelectorAll('#box-absence-form select');
      fireEvent.change(studentFields[0], { target: { value: 'Lovelace' } });
      fireEvent.change(studentFields[1], { target: { value: 'Ada' } });
      fireEvent.change(studentFields[2], { target: { value: '1' } });
    }
    fireEvent.click(screen.getByRole('radio', { name: 'Mathématiques' }));
    return onAddAbsence;
  };

  it('shows only subject ids assigned to the current teacher', () => {
    renderTeacherAbsenceForm(true);
    expect(screen.getByRole('radio', { name: 'Mathématiques' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Physique' })).toBeNull();
  });

  it('submits an individual absence without requiring a canonical assignment in the frontend', async () => {
    const onAddAbsence = renderTeacherAbsenceForm(false);

    fireEvent.click(screen.getByRole('button', { name: /^Enregistrer$/i }));

    await waitFor(() => expect(onAddAbsence).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 1,
      classId: 10,
      subjectId: 5,
    })));
    expect(onAddAbsence.mock.calls[0][0]).not.toHaveProperty('teachingAssignmentId');
  });

  it('submits multiple absences without requiring a canonical assignment in the frontend', async () => {
    const onAddAbsence = renderTeacherAbsenceForm(true);

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les absences sélectionnées' }));

    await waitFor(() => expect(onAddAbsence).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 1,
      classId: 10,
      subjectId: 5,
    })));
    expect(onAddAbsence.mock.calls[0][0]).not.toHaveProperty('teachingAssignmentId');
  });
});