export type LateArrivalJustificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type LateArrivalDecisionRole = 'teacher' | 'school_admin' | 'surveillant';

export type LateArrivalJustificationTransition = {
  action: 'APPROVED' | 'REJECTED' | 'REEXAMINED_APPROVED';
  fromStatus: LateArrivalJustificationStatus;
  toStatus: LateArrivalJustificationStatus;
  rejectionReason: string | null;
};

export function planLateArrivalJustificationTransition(input: {
  currentStatus: LateArrivalJustificationStatus;
  decision: 'APPROVED' | 'REJECTED' | 'REEXAMINE';
  actorRole: string;
  rejectionReason?: string | null;
}): LateArrivalJustificationTransition | null {
  if (input.decision === 'REEXAMINE') {
    if (input.currentStatus !== 'REJECTED'
      || (input.actorRole !== 'school_admin' && input.actorRole !== 'surveillant')) return null;
    return {
      action: 'REEXAMINED_APPROVED',
      fromStatus: 'REJECTED',
      toStatus: 'APPROVED',
      rejectionReason: null,
    };
  }

  if (input.currentStatus !== 'PENDING'
    || !['teacher', 'school_admin', 'surveillant'].includes(input.actorRole)) return null;
  if (input.decision === 'REJECTED') {
    const rejectionReason = input.rejectionReason?.trim() ?? '';
    if (!rejectionReason || rejectionReason.length > 2000) return null;
    return {
      action: 'REJECTED',
      fromStatus: 'PENDING',
      toStatus: 'REJECTED',
      rejectionReason,
    };
  }
  return {
    action: 'APPROVED',
    fromStatus: 'PENDING',
    toStatus: 'APPROVED',
    rejectionReason: null,
  };
}

export function lateArrivalJustificationNotificationKey(justificationId: number, revision: number): string {
  return `late-arrival-justification-${justificationId}-revision-${revision}`;
}
