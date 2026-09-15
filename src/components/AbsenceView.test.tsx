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
});