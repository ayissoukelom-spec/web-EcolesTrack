import type { InferSelectModel } from 'drizzle-orm';
import type { classes, students, teachers } from '../db/schema.ts';

interface DebugActorRecord {
  id?: number | null;
  uid: string;
  email?: string | null;
  name?: string | null;
  role: string;
  schoolId?: number | null;
  academicYearId?: number | null;
  simulated?: boolean;
}

type DebugTeacherRecord = Pick<
  InferSelectModel<typeof teachers>,
  'id' | 'userId' | 'schoolId' | 'specialization'
>;

type DebugClassRecord = Pick<
  InferSelectModel<typeof classes>,
  'id' | 'schoolId' | 'academicYearId' | 'name' | 'teacherId'
>;

type DebugStudentRecord = Pick<
  InferSelectModel<typeof students>,
  'id' | 'schoolId' | 'classId' | 'firstName' | 'lastName' | 'matricule' | 'isActive'
>;

export interface SimProfileDebugInput {
  simHeaders: {
    uid: string | string[] | null;
    email: string | string[] | null;
    role: string | string[] | null;
    schoolId: string | string[] | null;
  };
  resolvedActor: DebugActorRecord;
  dbUser: DebugActorRecord | null;
  teacherRow: DebugTeacherRecord | null;
  classes: DebugClassRecord[];
  students: DebugStudentRecord[];
}

function toActorDto(actor: DebugActorRecord | null) {
  if (!actor) return null;
  return {
    id: actor.id ?? null,
    uid: actor.uid,
    email: actor.email ?? null,
    name: actor.name ?? null,
    role: actor.role,
    schoolId: actor.schoolId ?? null,
    academicYearId: actor.academicYearId ?? null,
    simulated: actor.simulated ?? false,
  };
}

export function buildSimProfileDebugDto(input: SimProfileDebugInput) {
  return {
    simHeaders: input.simHeaders,
    resolvedActor: toActorDto(input.resolvedActor),
    dbUser: toActorDto(input.dbUser),
    teacherRow: input.teacherRow
      ? {
        id: input.teacherRow.id,
        userId: input.teacherRow.userId,
        schoolId: input.teacherRow.schoolId,
        specialization: input.teacherRow.specialization,
      }
      : null,
    classCount: input.classes.length,
    classes: input.classes.map((classRow) => ({
      id: classRow.id,
      schoolId: classRow.schoolId,
      academicYearId: classRow.academicYearId,
      name: classRow.name,
      teacherId: classRow.teacherId,
    })),
    studentCount: input.students.length,
    students: input.students.map((studentRow) => ({
      id: studentRow.id,
      schoolId: studentRow.schoolId,
      classId: studentRow.classId,
      firstName: studentRow.firstName,
      lastName: studentRow.lastName,
      matricule: studentRow.matricule,
      isActive: studentRow.isActive,
    })),
  };
}
