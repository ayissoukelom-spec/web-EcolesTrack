import { describe, expect, it } from 'vitest';
import type { Grade } from '../types';
import { upsertGradeInList } from './gradeState';

describe('upsertGradeInList', () => {
  it('remplace une note existante au même devoir et élève', () => {
    const initialGrades: Grade[] = [
      {
        id: 1,
        evaluationId: 10,
        studentId: 2,
        score: '12',
        remarks: 'Ancienne remarque',
        editCount: 0,
      },
    ];

    const updatedGrades = upsertGradeInList(initialGrades, {
      id: 1,
      evaluationId: 10,
      studentId: 2,
      score: '16',
      remarks: 'Remarque mise à jour',
      editCount: 1,
      evaluationTitle: 'Devoir 1',
      subject: 'Mathématiques',
    });

    expect(updatedGrades).toHaveLength(1);
    expect(updatedGrades[0]).toMatchObject({
      score: '16',
      remarks: 'Remarque mise à jour',
      editCount: 1,
      evaluationTitle: 'Devoir 1',
      subject: 'Mathématiques',
    });
  });

  it('ajoute une note lorsqu’aucune entrée n’existe encore', () => {
    const initialGrades: Grade[] = [];

    const updatedGrades = upsertGradeInList(initialGrades, {
      id: 99,
      evaluationId: 20,
      studentId: 3,
      score: '14',
      remarks: 'Nouvelle note',
      editCount: 0,
      evaluationTitle: 'Devoir 2',
      subject: 'Français',
    });

    expect(updatedGrades).toHaveLength(1);
    expect(updatedGrades[0]).toMatchObject({
      evaluationId: 20,
      studentId: 3,
      score: '14',
      remarks: 'Nouvelle note',
    });
  });
});
