import type { Grade, UserRole } from '../types';

export interface GradeDeletionPermission {
  canDelete: boolean;
  reason?: string;
}

export const getGradeDeletionPermission = (
  role: UserRole | undefined,
  existingGrade?: Grade,
): GradeDeletionPermission => {
  if (role === 'super_admin') {
    return { canDelete: true };
  }

  if (role === 'school_admin') {
    return {
      canDelete: true,
      reason: existingGrade?.editCount && existingGrade.editCount > 0 ? undefined : 'Les school admins peuvent supprimer une note uniquement si elle n’a pas encore été modifiée.',
    };
  }

  return {
    canDelete: false,
    reason: 'Vous n’êtes pas autorisé à supprimer une note.',
  };
};
