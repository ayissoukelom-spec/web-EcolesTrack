import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AbsenceView from './AbsenceView';

afterEach(() => cleanup());

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