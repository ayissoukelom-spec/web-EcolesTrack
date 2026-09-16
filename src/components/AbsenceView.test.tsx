import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});