import { describe, expect, it } from 'vitest';
import { getGradeEditPermission } from './gradePermissions';

describe('grade edit permissions', () => {
  it('autorise les super admins à modifier une note existante sans limite', () => {
    const permission = getGradeEditPermission('super_admin', {
      id: 1,
      evaluationId: 10,
      studentId: 2,
      score: '15',
      remarks: 'Bien',
      editCount: 7,
    });

    expect(permission.canEditExisting).toBe(true);
    expect(permission.remainingEdits).toBeUndefined();
  });

  it('autorise les school admins à modifier une note une seule fois', () => {
    const firstEdit = getGradeEditPermission('school_admin', {
      id: 2,
      evaluationId: 10,
      studentId: 3,
      score: '12',
      remarks: 'À améliorer',
      editCount: 0,
    });
    const secondEdit = getGradeEditPermission('school_admin', {
      id: 2,
      evaluationId: 10,
      studentId: 3,
      score: '14',
      remarks: 'Mieux',
      editCount: 1,
    });

    expect(firstEdit.canEditExisting).toBe(true);
    expect(firstEdit.canCreate).toBe(false);
    expect(firstEdit.remainingEdits).toBe(1);
    expect(secondEdit.canEditExisting).toBe(false);
    expect(secondEdit.remainingEdits).toBe(0);
  });

  it('empêche les school admins de créer une nouvelle note', () => {
    const permission = getGradeEditPermission('school_admin');

    expect(permission.canCreate).toBe(false);
    expect(permission.canEditExisting).toBe(false);
    expect(permission.reason).toContain('ne peut pas créer');
  });

  it('empêche les enseignants de modifier une note déjà enregistrée', () => {
    const permission = getGradeEditPermission('teacher', {
      id: 3,
      evaluationId: 10,
      studentId: 4,
      score: '16',
      remarks: 'Très bien',
      editCount: 0,
    });

    expect(permission.canEditExisting).toBe(false);
    expect(permission.canCreate).toBe(true);
    expect(permission.reason).toContain('enseignant');
  });
});
