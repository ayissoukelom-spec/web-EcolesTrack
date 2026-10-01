import { describe, expect, it } from 'vitest';
import { canTeacherAccessAbsence, isTeacherTeachingAssignment, resolveTeacherTeachingAssignmentId } from './absenceTeachingAccess.ts';

const teacherAMath = {
  id: 101,
  teacherId: 1,
  schoolId: 9,
  classId: 60,
  subjectId: 12,
  isActive: true,
};

describe('absence teaching assignment access', () => {
  it('requires the exact active teacher, school, class and subject combination for creation', () => {
    expect(isTeacherTeachingAssignment(teacherAMath, 1, 9, 60, 12)).toBe(true);
    expect(isTeacherTeachingAssignment(teacherAMath, 1, 9, 60, 13)).toBe(false);
    expect(isTeacherTeachingAssignment(teacherAMath, 1, 9, 61, 12)).toBe(false);
    expect(isTeacherTeachingAssignment({ ...teacherAMath, isActive: false }, 1, 9, 60, 12)).toBe(false);
  });

  it('keeps an absence private to its exact assignment when teachers share a subject', () => {
    const teacherBMath = { ...teacherAMath, id: 102, teacherId: 2 };
    const absence = { teachingAssignmentId: teacherAMath.id };

    expect(canTeacherAccessAbsence(absence, 1, [teacherAMath, teacherBMath])).toBe(true);
    expect(canTeacherAccessAbsence(absence, 2, [teacherAMath, teacherBMath])).toBe(false);
  });

  it('does not grant teacher access to legacy absences without an assignment reference', () => {
    expect(canTeacherAccessAbsence({ teachingAssignmentId: null }, 1, [teacherAMath])).toBe(false);
    expect(canTeacherAccessAbsence({}, 1, [teacherAMath])).toBe(false);
  });

  it('rejects an assignment reference inconsistent with the absence class or subject', () => {
    expect(canTeacherAccessAbsence({ teachingAssignmentId: 101, classId: 60, subjectId: 13 }, 1, [teacherAMath])).toBe(false);
    expect(canTeacherAccessAbsence({ teachingAssignmentId: 101, classId: 61, subjectId: 12 }, 1, [teacherAMath])).toBe(false);
  });

  it('does not authorize absence access through an inactive assignment', () => {
    expect(canTeacherAccessAbsence(
      { teachingAssignmentId: 101, classId: 60, subjectId: 12 },
      1,
      [{ ...teacherAMath, isActive: false }],
    )).toBe(false);
  });

  it('resolves a unique active class-subject assignment and refuses ambiguous matches', () => {
    expect(resolveTeacherTeachingAssignmentId([teacherAMath], 60, 12)).toBe(101);
    expect(resolveTeacherTeachingAssignmentId([teacherAMath], 60, 13)).toBeNull();
    expect(resolveTeacherTeachingAssignmentId([teacherAMath, { ...teacherAMath, id: 102 }], 60, 12)).toBeNull();
    expect(resolveTeacherTeachingAssignmentId([{ ...teacherAMath, isActive: false }], 60, 12)).toBeNull();
  });
});