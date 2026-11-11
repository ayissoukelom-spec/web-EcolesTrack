import { describe, expect, it } from 'vitest';
import {
  normalizeTeacherClassIds,
  planTeacherClassMembershipSync,
  planTeacherTeachingAssignmentSync,
} from './teacherTeachingAssignments';

describe('normalizeTeacherClassIds', () => {
  it('deduplicates authorized classes and rejects a class outside the active school', async () => {
    const isApprovedForSchool = async (classId: number) => classId === 11 || classId === 12;

    await expect(normalizeTeacherClassIds(['11', 12, 11], isApprovedForSchool)).resolves.toEqual([11, 12]);
    await expect(normalizeTeacherClassIds([11, 99], isApprovedForSchool)).resolves.toBeNull();
  });
});

describe('planTeacherClassMembershipSync', () => {
  it('removes only explicitly managed deselections and preserves unavailable historical links', () => {
    expect(planTeacherClassMembershipSync(
      [{ classId: 11 }, { classId: 99 }],
      [11, 12],
      [11, 12],
    )).toEqual({ remove: [], add: [12] });
  });

  it('removes an explicitly deselected available class while keeping unrelated associations', () => {
    expect(planTeacherClassMembershipSync(
      [{ classId: 11 }, { classId: 12 }, { classId: 99 }],
      [11],
      [11, 12],
    )).toEqual({ remove: [12], add: [] });
  });
});

describe('planTeacherTeachingAssignmentSync', () => {
  it('creates only the explicitly selected teaching pairs for a new teacher', () => {
    expect(planTeacherTeachingAssignmentSync([], [
      { classId: 53, subjectId: 10 },
      { classId: 54, subjectId: 10 },
    ])).toEqual([
      { kind: 'insert', assignment: { classId: 53, subjectId: 10 } },
      { kind: 'insert', assignment: { classId: 54, subjectId: 10 } },
    ]);
  });

  it('preserves selected pairs and deactivates only exact pairs removed during modification', () => {
    expect(planTeacherTeachingAssignmentSync([
      { id: 1, classId: 53, subjectId: 10, isActive: true },
      { id: 2, classId: 54, subjectId: 10, isActive: true },
      { id: 3, classId: 53, subjectId: 11, isActive: true },
    ], [
      { classId: 53, subjectId: 10 },
      { classId: 54, subjectId: 12 },
    ])).toEqual([
      { kind: 'deactivate', id: 2 },
      { kind: 'deactivate', id: 3 },
      { kind: 'insert', assignment: { classId: 54, subjectId: 12 } },
    ]);
  });

  it('reactivates an explicitly selected inactive pair instead of duplicating it', () => {
    expect(planTeacherTeachingAssignmentSync([
      { id: 7, classId: 53, subjectId: 10, isActive: false },
    ], [
      { classId: 53, subjectId: 10 },
    ])).toEqual([{ kind: 'activate', id: 7 }]);
  });

  it('leaves untouched active assignments active and does not invent cross-products', () => {
    expect(planTeacherTeachingAssignmentSync([
      { id: 1, classId: 53, subjectId: 10, isActive: true },
      { id: 2, classId: 54, subjectId: 11, isActive: true },
    ], [
      { classId: 53, subjectId: 10 },
      { classId: 54, subjectId: 11 },
    ])).toEqual([]);
  });

  it('does not change active historical pairs outside the editor scope', () => {
    expect(planTeacherTeachingAssignmentSync([
      { id: 1, classId: 53, subjectId: 10, isActive: true },
      { id: 2, classId: 54, subjectId: 11, isActive: true },
    ], [], [
      { classId: 53, subjectId: 10 },
    ])).toEqual([
      { kind: 'deactivate', id: 1 },
    ]);
  });
});
