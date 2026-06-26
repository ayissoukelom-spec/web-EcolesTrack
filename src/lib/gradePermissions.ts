import type { Grade, UserRole } from '../types';

export interface GradeEditPermission {
  canCreate: boolean;
  canEditExisting: boolean;
  remainingEdits?: number;
  reason?: string;
}

export const getGradeEditPermission = (
  role: UserRole | undefined,
  existingGrade?: Grade,
): GradeEditPermission => {
  // Central permission matrix for grade actions.
  // UI typing must not be blocked via onChange guards; this matrix is consumed by readOnly and save action gating.
  // Backend remains the source of truth for final authorization.
  if (role === 'super_admin') {
    return {
      canCreate: true,
      canEditExisting: true,
    };
  }

  if (role === 'school_admin') {
    const editCount = existingGrade?.editCount ?? 0;
    const remainingEdits = Math.max(1 - editCount, 0);
    return {
      canCreate: false,
      canEditExisting: !!existingGrade && remainingEdits > 0,
      remainingEdits,
      reason: existingGrade
        ? (remainingEdits > 0 ? undefined : 'Cette note a déjà été modifiée une fois par un school admin.')
        : 'Un school admin ne peut pas créer une nouvelle note.',
    };
  }

  if (role === 'teacher') {
    return {
      canCreate: true,
      canEditExisting: false,
      reason: 'Les enseignants ne peuvent pas modifier une note déjà enregistrée.',
    };
  }

  return {
    canCreate: false,
    canEditExisting: false,
    reason: 'Vous n’êtes pas autorisé à modifier des notes.',
  };
};
