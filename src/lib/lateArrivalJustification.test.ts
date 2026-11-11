import { describe, expect, it } from 'vitest';
import {
  lateArrivalJustificationNotificationKey,
  planLateArrivalJustificationTransition,
} from './lateArrivalJustification.ts';

describe('late-arrival justification transitions', () => {
  it('allows only an authorized initial decision from PENDING', () => {
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'PENDING',
      decision: 'APPROVED',
      actorRole: 'teacher',
    })).toMatchObject({ action: 'APPROVED', fromStatus: 'PENDING', toStatus: 'APPROVED' });
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'PENDING',
      decision: 'REJECTED',
      actorRole: 'school_admin',
      rejectionReason: 'Document illisible',
    })).toMatchObject({ action: 'REJECTED', rejectionReason: 'Document illisible' });

    for (const actorRole of ['parent', 'super_admin', 'student']) {
      expect(planLateArrivalJustificationTransition({
        currentStatus: 'PENDING',
        decision: 'APPROVED',
        actorRole,
      })).toBeNull();
    }
  });

  it('requires a refusal reason and rejects repeated or invalid transitions', () => {
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'PENDING',
      decision: 'REJECTED',
      actorRole: 'surveillant',
    })).toBeNull();
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'PENDING',
      decision: 'REJECTED',
      actorRole: 'surveillant',
      rejectionReason: ' '.repeat(2),
    })).toBeNull();
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'APPROVED',
      decision: 'REJECTED',
      actorRole: 'school_admin',
      rejectionReason: 'Correction',
    })).toBeNull();
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'REJECTED',
      decision: 'APPROVED',
      actorRole: 'school_admin',
    })).toBeNull();
  });

  it('allows reexamination only from REJECTED for school administrators and surveillants', () => {
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'REJECTED',
      decision: 'REEXAMINE',
      actorRole: 'surveillant',
    })).toMatchObject({
      action: 'REEXAMINED_APPROVED',
      fromStatus: 'REJECTED',
      toStatus: 'APPROVED',
    });
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'REJECTED',
      decision: 'REEXAMINE',
      actorRole: 'teacher',
    })).toBeNull();
    expect(planLateArrivalJustificationTransition({
      currentStatus: 'PENDING',
      decision: 'REEXAMINE',
      actorRole: 'school_admin',
    })).toBeNull();
  });

  it('uses a stable notification key per justification revision', () => {
    expect(lateArrivalJustificationNotificationKey(12, 3)).toBe('late-arrival-justification-12-revision-3');
  });
});
