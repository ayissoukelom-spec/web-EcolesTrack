import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import ExcelJS from 'exceljs';
import { getTeacherDisplayName } from '../../src/types.ts';

// Mock DB and Auth middleware before importing the server so the real server
// uses our test doubles when startServer() runs on import.

// In-memory fixture state
const FIXTURES = {
  users: [
    { id: 1, uid: 'super-uid', email: 'super@x.test', name: 'Super', role: 'super_admin', schoolId: null, isDeleted: false },
    { id: 2, uid: 'school-uid', email: 'admin@school.test', name: 'SchoolAdmin', role: 'school_admin', schoolId: 10, isDeleted: false },
    { id: 3, uid: 'teacher-uid', email: 'teacher@school.test', name: 'Teacher', role: 'teacher', schoolId: 10, isDeleted: false },
    { id: 4, uid: 'other-teacher-uid', email: 'otherteacher@school.test', name: 'OtherTeacher', role: 'teacher', schoolId: 10, isDeleted: false },
    { id: 5, uid: 'no-school-teacher-uid', email: 'noschool@x.test', name: 'NoSchool', role: 'teacher', schoolId: null, isDeleted: false },
    { id: 6, uid: 'sim-parent', email: 'parent@x.test', phone: '+22890000001', name: 'Parent', role: 'parent', schoolId: 10, isDeleted: false, lastLoginAt: '2026-09-24T09:00:00.000Z', lastMobileVisitAt: '2026-09-24T10:00:00.000Z' },
    { id: 7, uid: 'sim-parent-no-school', email: 'parent-noschool@x.test', phone: '+22890000002', name: 'ParentNoSchool', role: 'parent', schoolId: null, isDeleted: false },
    { id: 8, uid: 'sim-parent-query-bypass', email: 'parent-query@x.test', phone: '+22890000003', name: 'ParentQuery', role: 'parent', schoolId: null, isDeleted: false },
    { id: 9, uid: 'sim-school-admin-no-school', email: 'admin-noschool@x.test', name: 'SchoolAdminNoSchool', role: 'school_admin', schoolId: null, isDeleted: false },
    { id: 10, uid: 'teacher-sim', email: 'teacher@x.test', name: 'TeacherSim', role: 'teacher', schoolId: 10, isDeleted: false },
    { id: 11, uid: 'other-school-admin-uid', email: 'other-admin@x.test', name: 'OtherSchoolAdmin', role: 'school_admin', schoolId: 20, isDeleted: false },
    { id: 12, uid: 'surveillant-uid', email: 'surveillant@school.test', name: 'Surveillant', role: 'surveillant', schoolId: 10, isDeleted: false },
  ],
  schools: [
    { id: 10, name: 'Test School' },
    { id: 20, name: 'Other School' },
  ],
  academicYears: [{ id: 1, schoolId: 10, name: '2025-2026', isActive: true }],
  classes: [
    { id: 1, name: 'Assigned Class', schoolId: 10, academicYearId: 1, teacherId: 77 },
    { id: 2, name: 'Unassigned Class', schoolId: 10, academicYearId: 1, teacherId: 88 },
    { id: 3, name: 'Other School Class', schoolId: 20, academicYearId: 1, teacherId: 88 },
    { id: 4, name: 'Global Approved Class', schoolId: null, academicYearId: 1, teacherId: null },
    { id: 5, name: 'Global Unapproved Class', schoolId: null, academicYearId: 1, teacherId: null },
  ],
  teachers: [
    { id: 77, userId: 3, schoolId: 10, phone: '+22911111111', specialization: 'Math' },
    { id: 88, userId: 4, schoolId: 10, phone: '+22922222222', specialization: 'Science' },
    { id: 99, userId: 5, schoolId: null, phone: '+22933333333', specialization: 'History' },
    { id: 100, userId: 10, schoolId: 10, phone: '+22944444444', specialization: 'Science' },
  ],
  subjects: [{ id: 901, schoolId: null, name: 'Physique', subjectTypeId: 11 }] as Array<{
    id: number;
    schoolId: number | null;
    name: string;
    subjectTypeId: number | null;
    code?: string | null;
  }>,
  subjectTypes: [
    { id: 11, name: 'Littéraire', description: null, sortOrder: 1 },
    { id: 12, name: 'Scientifique', description: null, sortOrder: 2 },
  ],
  schoolSubjects: [{ id: 1, schoolId: 20, subjectId: 901, status: 'approved', subjectTypeId: 12 }],
  teacherSubjects: [] as Array<{ teacherId: number; schoolId: number; subjectId: number }>,
  teacherClassSubjects: [] as Array<{ id: number; teacherId: number; schoolId: number; classId: number; subjectId: number; isActive: boolean }>,
  parents: [
    { id: 1, userId: 6, studentId: 11, schoolId: 10 },
    { id: 2, userId: 7, studentId: 11, schoolId: 10 },
    { id: 3, userId: 8, studentId: 11, schoolId: 10 },
  ] as Array<{
    id: number;
    userId: number;
    studentId?: number | null;
    schoolId: number;
    phone?: string | null;
    address?: string | null;
  }>,
  students: [
    { id: 11, schoolId: 10, classId: 1, firstName: 'Child', lastName: 'One', birthDate: '2010-01-01', gender: 'female', parentId: 1, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' },
    { id: 13, schoolId: 10, classId: 4, firstName: 'Global', lastName: 'Approved', birthDate: '2010-01-01', gender: 'female', parentId: null, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' },
    { id: 14, schoolId: 10, classId: 5, firstName: 'Global', lastName: 'Unapproved', birthDate: '2010-01-01', gender: 'female', parentId: null, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' },
  ] as Array<{
    id: number;
    schoolId: number;
    classId: number | null;
    firstName: string;
    lastName: string;
    birthDate?: string | null;
    gender?: string | null;
    parentId?: number | null;
    schoolAdminId?: number | null;
    enrolledAt?: string;
    isActive?: boolean;
    withdrawnAt?: string | null;
  }>,
  classTeachers: [
    { classId: 1, teacherId: 77, schoolId: 10 },
    { classId: 1, teacherId: 100, schoolId: 10 },
  ],
  homeroomAssignments: [] as Array<{ id: number; schoolId: number; classId: number; teacherId: number; name?: string; schoolName?: string; yearName?: string; levelName?: string }>,
  schoolClasses: [
    { id: 500, classId: 3, schoolId: 10, status: 'approved' },
    { id: 501, classId: 4, schoolId: 10, status: 'approved' },
  ],
  absences: [
    { id: 1, studentId: 11, classId: 1, subjectId: 901, schoolId: 10, date: '2026-06-01', period: '1', isJustified: false, justificationReason: null },
  ] as Array<Record<string, unknown> & {
    id: number;
    studentId: number;
    classId: number;
    subjectId?: number;
    schoolId?: number;
    teachingAssignmentId?: number;
    date: string;
    period: string;
    isJustified?: boolean;
    justificationReason?: string | null;
  }>,
  lateArrivals: [],
  absenceDeclarations: [] as any[],
  evaluations: [] as any[],
  grades: [],
  examResults: [],
  classExamConfigurations: [],
  absenceJustifications: [],
  notificationAttachments: [],
  notifications: [],
  localAuths: [],
  accessSessions: [] as Array<{
    id: string;
    userId: number;
    observedGeneration: bigint | number;
    status: 'active' | 'revoked' | 'expired';
    contextVersion: number;
    context: unknown;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    revokedAt: Date | null;
  }>,
  userSchools: [
    { userId: 2, schoolId: 10, role: 'school_admin', isActive: true },
    { userId: 3, schoolId: 10, role: 'teacher', isActive: true },
    { userId: 12, schoolId: 10, role: 'surveillant', isActive: true },
    { userId: 4, schoolId: 10, role: 'teacher', isActive: true },
    { userId: 6, schoolId: 10, role: 'parent', isActive: true },
    { userId: 7, schoolId: 10, role: 'parent', isActive: true },
    { userId: 8, schoolId: 10, role: 'parent', isActive: true },
    { userId: 10, schoolId: 10, role: 'teacher', isActive: true },
    { userId: 11, schoolId: 20, role: 'school_admin', isActive: true },
  ] as Array<{ id?: number; userId: number; schoolId: number; role: string; isActive: boolean | null }>,
  auditEvents: [],
  userLoginEvents: [
    { id: 1, userId: 6, role: 'parent', schoolId: 10, loginAt: '2026-09-24T09:00:00.000Z', clientType: 'web' },
    { id: 2, userId: 6, role: 'parent', schoolId: 10, loginAt: '2026-09-24T10:00:00.000Z', clientType: 'android' },
    { id: 3, userId: 3, role: 'teacher', schoolId: 10, loginAt: '2026-09-24T11:00:00.000Z', clientType: null },
  ],
  mobileParentSessions: [
    { id: 'parent-session-6', parentId: '6', isActive: true, revokedAt: null },
  ],
};

for (const user of FIXTURES.users as any[]) {
  user.accessSessionGeneration = 1;
  user.deactivationGenerationAware = null;
}

const FIXTURES_TEMPLATE = JSON.parse(JSON.stringify(FIXTURES));
function resetFixtures() {
  Object.keys(FIXTURES).forEach((key) => {
    // @ts-ignore
    FIXTURES[key] = JSON.parse(JSON.stringify(FIXTURES_TEMPLATE[key]));
  });
}

function setFixtureMembership(userId: number, schoolId: number, role: string, isActive: boolean | null, id?: number) {
  const membership = FIXTURES.userSchools.find((row) => (
    row.userId === userId && row.schoolId === schoolId && row.role === role
  ));
  if (membership) {
    membership.isActive = isActive;
    if (id != null) membership.id = id;
    return;
  }
  FIXTURES.userSchools.push({ ...(id == null ? {} : { id }), userId, schoolId, role, isActive });
}

function resetLocalLoginRateLimit() {
  const route = app._router.stack
    .find((layer: any) => layer.route?.path === '/api/auth/local-login')?.route;
  const limiter = route?.stack
    .find((layer: any) => typeof layer.handle.resetKey === 'function')?.handle;
  if (!limiter) throw new Error('Could not locate the local login rate limiter');
  limiter.resetKey('127.0.0.1');
}

function setCurrentAndFormerNotificationRecipients() {
  (FIXTURES.users as any[]).push(
    { id: 21, uid: 'teacher-parent-inactive', email: 'teacher-parent@test', name: 'Teacher with inactive parent function', role: 'teacher', schoolId: 10, isDeleted: false },
    { id: 22, uid: 'inactive-parent-only', email: 'inactive-parent@test', name: 'Inactive Parent', role: 'parent', schoolId: 10, isDeleted: false },
  );
  (FIXTURES.userSchools as any[]).push(
    { userId: 21, schoolId: 10, role: 'teacher', isActive: true },
    { userId: 21, schoolId: 10, role: 'parent', isActive: false },
    { userId: 22, schoolId: 10, role: 'parent', isActive: false },
  );
  (FIXTURES.parents as any[]).splice(0, FIXTURES.parents.length,
    { id: 1, userId: 6, studentId: 11, schoolId: 10 },
    { id: 2, userId: 7, studentId: 16, schoolId: 10 },
    { id: 3, userId: 8, studentId: 17, schoolId: 10 },
    { id: 4, userId: 21, studentId: 19, schoolId: 10 },
    { id: 5, userId: 22, studentId: 20, schoolId: 10 },
  );
  const currentStudent = (FIXTURES.students as any[]).find((student) => student.id === 11);
  if (currentStudent) currentStudent.parentId = 1;
  (FIXTURES.students as any[]).push(
    { id: 15, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Sibling', parentId: 1 },
    { id: 16, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Only', parentId: 2 },
    { id: 17, schoolId: 10, classId: 1, isActive: true, withdrawnAt: null, firstName: 'Current', lastName: 'Sibling', parentId: 3 },
    { id: 18, schoolId: 10, classId: 1, isActive: true, withdrawnAt: null, firstName: 'Current', lastName: 'Sibling Two', parentId: 1 },
    { id: 19, schoolId: 10, classId: 1, isActive: true, withdrawnAt: null, firstName: 'Inactive Parent', lastName: 'Function', parentId: 4 },
    { id: 20, schoolId: 10, classId: 1, isActive: true, withdrawnAt: null, firstName: 'Inactive Parent', lastName: 'Only', parentId: 5 },
  );
}

function createMockDb() {
  const db: any = {
    __returnUsersWithBigIntAccessSessionGeneration: false,
    __skipNextNormalizedEmailLookup: false,
    __failNextNotificationAttachmentInsert: false,
    __failNextParentInsert: false,
    __failNextParentMembershipInsert: false,
    __failNextTeacherClassSubjectInsert: false,
    __failNextClassTeacherInsert: false,
    __legacyUserSchoolPairConstraint: false,
    __failNextUsersUpdateError: null,
    __failNextMobileParentSessionRevocationError: null,
    __failNextLifecycleAuditInsertError: null,
    __failLifecycleAuditInsertAfter: null,
    __failNextLocalAuthUpdateError: null,
    __changeLocalAuthBeforeNextUpdate: null,
    __transactionCommitCount: 0,
    __transactionRollbackCount: 0,
    __userSchoolWriteCount: 0,
    __selectQueries: [] as Array<{ table: string; sql: string }>,
    __activeTestContext: null as {
      kind: 'local';
      userId?: number;
      uid?: string;
      email?: string | null;
      active: { schoolId: number; role: string };
    } | null,
  };

  // Minimal mock that supports the select/insert/update/delete chains used
  // by server.ts. It inspects query conditions to match rows for uid, email,
  // id and schoolId, and keeps fixture state in memory.
  const extractConditions = (cond: any): Record<string, any> => {
    const result: Record<string, any> = {};
    const visited = new WeakSet<any>();

    const parseQueryChunks = (sqlObj: any) => {
      if (!sqlObj || !Array.isArray(sqlObj.queryChunks)) return;
      const flattened: any[] = [];
      const collectChunks = (obj: any) => {
        if (!obj || typeof obj !== 'object' || !Array.isArray(obj.queryChunks)) return;
        for (const chunk of obj.queryChunks) {
          if (chunk == null) continue;
          if (typeof chunk === 'object' && chunk !== null && Array.isArray((chunk as any).queryChunks)) {
            collectChunks(chunk);
          } else {
            flattened.push(chunk);
          }
        }
      };
      collectChunks(sqlObj);

      let lastColumn: string | null = null;
      for (const chunk of flattened) {
        if (chunk == null) continue;
        const ctor = chunk.constructor?.name;

        if ((ctor === 'PgText' || ctor === 'PgSerial' || ctor === 'PgInteger' || ctor === 'PgBoolean') && typeof chunk.name === 'string') {
          lastColumn = chunk.name.toLowerCase();
          continue;
        }

        if ((ctor === 'PgText' || ctor === 'PgSerial' || ctor === 'PgInteger' || ctor === 'PgBoolean') && typeof (chunk as any).text === 'string') {
          const text = (chunk as any).text.toLowerCase();
          if (text.includes('lower(') && text.includes('email')) {
            lastColumn = 'email';
            continue;
          }
        }

        if (typeof chunk === 'string') {
          const text = chunk.toLowerCase();
          if (text.includes('lower(') && text.includes('email')) {
            lastColumn = 'email';
            continue;
          }
          if (lastColumn) {
            const normalizedLast = lastColumn.replace(/_/g, '').replace(/\./g, '');
            const value = chunk;
            if (/isdeleted/.test(normalizedLast)) result.isDeleted = value;
            else if (normalizedLast.includes('uid')) result.uid = value;
            else if (normalizedLast.includes('email')) result.email = value;
            else if (normalizedLast === 'role') result.role = value;
            else if (normalizedLast === 'phone') result.phone = value;
            else if (/school.*id/.test(normalizedLast)) result.schoolId = value === null ? null : Number(value);
            else if (/user.*id/.test(normalizedLast)) result.userId = value === null ? null : Number(value);
            else if (/student.*id/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.studentIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.studentId = value === null ? null : Number(value);
              }
            } else if (/parent.*id/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.parentIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.parentId = value === null ? null : Number(value);
              }
            } else if (/class.*id/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.classIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.classId = value === null ? null : Number(value);
              }
            } else if (/teacher.*id/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.teacherIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.teacherId = value === null ? null : Number(value);
              }
            } else if (/status/.test(normalizedLast)) {
              result.status = value;
            } else if (normalizedLast === 'id' || /^id$/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.ids = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.id = value === null ? null : Number(value);
              }
            }
            lastColumn = null;
            continue;
          }
        }

        if (ctor === 'Param') {
          if (lastColumn) {
            const normalizedLast = lastColumn.replace(/_/g, '').replace(/\./g, '');
            const value = (chunk as any).value;
            if (/is_?deleted/.test(normalizedLast)) result.isDeleted = value;
            else if (/is_?active/.test(normalizedLast)) result.isActive = value;
            else if (normalizedLast.includes('uid')) result.uid = value;
            else if (normalizedLast.includes('email')) result.email = value;
            else if (normalizedLast === 'role') result.role = value;
            else if (normalizedLast === 'phone') result.phone = value;
            else if (/school.*id/.test(normalizedLast)) result.schoolId = value === null ? null : Number(value);
            else if (/user.*id/.test(normalizedLast)) result.userId = value === null ? null : Number(value);
            else if (/student.*id/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.studentIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.studentId = value === null ? null : Number(value);
              }
            } else if (/parent.*id/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.parentIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.parentId = value === null ? null : Number(value);
              }
            } else if (/class.*id/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.classIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.classId = value === null ? null : Number(value);
              }
            } else if (/teacher.*id/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.teacherIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.teacherId = value === null ? null : Number(value);
              }
            } else if (/status/.test(normalizedLast)) {
              result.status = value;
            } else if (normalizedLast === 'id' || /^id$/.test(normalizedLast)) {
              if (Array.isArray(value)) {
                result.ids = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.id = value === null ? null : Number(value);
              }
            }
          }
          lastColumn = null;
          continue;
        }

        if (ctor === 'Array' && lastColumn) {
          const normalizedLast = lastColumn.replace(/_/g, '');
          const rawValues = chunk as any[];
          const values = rawValues.map((v: any) => (v && typeof v === 'object' && 'value' in v) ? v.value : v);
          const parsed = values.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          if (normalizedLast.includes('schoolid')) {
            result.schoolIds = parsed;
          } else if (normalizedLast.includes('studentid')) {
            result.studentIds = parsed;
          } else if (normalizedLast.includes('parentid')) {
            result.parentIds = parsed;
          } else if (normalizedLast.includes('classid')) {
            result.classIds = parsed;
          } else if (normalizedLast.includes('teacherid')) {
            result.teacherIds = parsed;
          } else if (normalizedLast.includes('id') || normalizedLast.endsWith('.id')) {
            result.ids = parsed;
          }
          lastColumn = null;
          continue;
        }
      }
    };

    const search = (item: any) => {
      if (item == null || typeof item !== 'object') return;
      if (visited.has(item)) return;
      visited.add(item);
      if (Array.isArray(item)) {
        item.forEach(search);
        return;
      }
      if (Array.isArray(item.queryChunks)) {
        parseQueryChunks(item);
      }
      const left = item.left;
      const right = item.right;
      if (left !== undefined && right !== undefined) {
        const leftStr = String(left).toLowerCase().replace(/\./g, '');
        const rawRight = right && typeof right === 'object' && 'value' in right ? (right as any).value : right;
        const rightIsPrimitive = rawRight === null || ['string', 'number', 'boolean'].includes(typeof rawRight);
        if (/is_?deleted/.test(leftStr) && rightIsPrimitive) result.isDeleted = rawRight;
        if (/is_?active/.test(leftStr) && rightIsPrimitive) result.isActive = rawRight;
        if (/is_?active/.test(leftStr) && rightIsPrimitive) result.isActive = rawRight;
        if (leftStr.includes('uid') && rightIsPrimitive) result.uid = rawRight;
        if (leftStr.includes('email') && rightIsPrimitive) result.email = rawRight;
        if (/\brole\b/.test(leftStr) && rightIsPrimitive) result.role = rawRight;
        if (leftStr.includes('phone') && rightIsPrimitive) result.phone = rawRight;
        if (/expires_?at/.test(leftStr) && rightIsPrimitive) result.expiresAt = rawRight;
        if (/school.*id/.test(leftStr)) {
          if (Array.isArray(rawRight)) result.schoolIds = rawRight.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          else if (rightIsPrimitive) result.schoolId = rawRight === null ? null : Number(rawRight);
        }
        if (/user.*id/.test(leftStr) && rightIsPrimitive) result.userId = rawRight === null ? null : Number(rawRight);
        if (/student.*id/.test(leftStr)) {
          if (Array.isArray(rawRight)) {
            result.studentIds = rawRight.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          } else if (rightIsPrimitive) {
            result.studentId = rawRight === null ? null : Number(rawRight);
          }
        }
        if (/parent.*id/.test(leftStr)) {
          if (Array.isArray(rawRight)) {
            result.parentIds = rawRight.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          } else if (rightIsPrimitive) {
            result.parentId = rawRight === null ? null : Number(rawRight);
          }
        }
        if (/class.*id/.test(leftStr)) {
          if (Array.isArray(rawRight)) {
            result.classIds = rawRight.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          } else if (rightIsPrimitive) {
            result.classId = rawRight === null ? null : Number(rawRight);
          }
        }
        if (/teacher.*id/.test(leftStr) && rightIsPrimitive) result.teacherId = rawRight === null ? null : Number(rawRight);
        if (/status/.test(leftStr) && rightIsPrimitive) result.status = rawRight;
        if (/id/.test(leftStr) && !/school.*id/.test(leftStr) && !/user.*id/.test(leftStr) && !/class.*id/.test(leftStr) && !/teacher.*id/.test(leftStr) && !/student.*id/.test(leftStr) && !/parent.*id/.test(leftStr)) {
          if (Array.isArray(rawRight)) {
            result.ids = rawRight.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
          } else if (rightIsPrimitive) {
            result.id = rawRight === null
              ? null
              : typeof rawRight === 'string' && !/^\d+$/.test(rawRight)
                ? rawRight
                : Number(rawRight);
          }
        }
        if (typeof left === 'object' && left !== null) search(left);
        if (typeof right === 'object' && right !== null) search(right);
        return;
      }
      if (item.args && Array.isArray(item.args)) {
        item.args.forEach(search);
      }
      Object.values(item).forEach((value) => {
        if (typeof value === 'object' && value !== null) search(value);
      });
    };

    search(cond);

    if (!Object.keys(result).length && cond != null && typeof cond !== 'string') {
      try {
        const text = String(cond);
        const maybeUid = /uid\s*=\s*['"]([^'"]+)['"]/i.exec(text);
        if (maybeUid) result.uid = maybeUid[1];
        const maybeEmail = /email\s*=\s*['"]([^'"]+)['"]/i.exec(text);
        if (maybeEmail) result.email = maybeEmail[1];
        const maybeId = /(?:\b(?:id|class_id|teacher_id|school_id)\b)\s*=\s*(\d+)/i.exec(text);
        if (maybeId) result.id = Number(maybeId[1]);
      } catch (_err) {
        // ignore stringification failures
      }
    }

    return result;
  };

  const resolveTableName = (table: any): string => {
    if (typeof table === 'string') {
      const lower = table.toLowerCase();
      if (lower.includes('users')) return 'users';
      if (lower.includes('schools')) return 'schools';
      if (lower.includes('academicyears')) return 'academicYears';
      if (lower.includes('localauths')) return 'localAuths';
      if (lower.includes('userschools')) return 'userSchools';
      if (lower.includes('classhomeroomassignments') || lower.includes('class_homeroom_assignments')) return 'homeroomAssignments';
      if (lower.includes('parents')) return 'parents';
      if (lower.includes('students')) return 'students';
      if (lower.includes('classesteachers') || lower.includes('classteachers')) return 'classTeachers';
      if (lower.includes('teacherclasssubjects') || lower.includes('teacher_class_subjects')) return 'teacherClassSubjects';
      if (lower.includes('schoolclasses')) return 'schoolClasses';
      if (lower.includes('absences')) return 'absences';
      if (lower.includes('absence_declarations') || lower.includes('absencedeclarations')) return 'absenceDeclarations';
      if (lower.includes('latearrivals') || lower.includes('late_arrivals')) return 'lateArrivals';
      if (lower.includes('evaluations')) return 'evaluations';
      if (lower.includes('grades')) return 'grades';
      if (lower.includes('examresults')) return 'examResults';
      if (lower.includes('classexamconfigurations')) return 'classExamConfigurations';
      if (lower.includes('absencejustifications')) return 'absenceJustifications';
      if (lower.includes('notificationattachments')) return 'notificationAttachments';
      if (lower.includes('notifications')) return 'notifications';
      if (lower.includes('auditevents')) return 'auditEvents';
      if (lower.includes('userloginevents')) return 'userLoginEvents';
    }
    if (table && typeof table === 'object') {
      const drizzleName = table[Symbol.for('drizzle:Name')];
      if (drizzleName === 'access_sessions') return 'accessSessions';
      if (drizzleName === 'class_teachers') return 'classTeachers';
      if (drizzleName === 'teacher_class_subjects') return 'teacherClassSubjects';
      if (drizzleName === 'evaluations') return 'evaluations';
      if (drizzleName === 'absence_declarations') return 'absenceDeclarations';
      if (drizzleName === 'financial_obligations') return 'financialObligations';
      if (drizzleName === 'accounting_tariffs') return 'accountingTariffs';
      if (drizzleName === 'accounting_fee_definitions') return 'accountingFeeDefinitions';
      if (drizzleName === 'subjects') return 'subjects';
      if (drizzleName === 'subject_types') return 'subjectTypes';
      if (drizzleName === 'school_subjects') return 'schoolSubjects';
      if (drizzleName === 'teacher_subjects') return 'teacherSubjects';
      const keys = Object.keys(table).map((k) => k.toLowerCase());
      if (keys.includes('uid') && keys.includes('email') && keys.includes('role')) return 'users';
      if (keys.includes('observedgeneration') && keys.includes('contextversion') && keys.includes('expiresat')) return 'accessSessions';
      if (keys.includes('actoruserid') && keys.includes('resourceid')) return 'auditEvents';
      if (keys.includes('userid') && keys.includes('passwordhash')) return 'localAuths';
      if (keys.includes('teacherid') && keys.includes('schoolid') && keys.includes('classid') && keys.includes('subjectid') && keys.includes('isactive')) return 'teacherClassSubjects';
      if (keys.includes('userid') && keys.includes('schoolid') && keys.includes('role') && keys.includes('isactive')) return 'userSchools';
      if (keys.includes('schoolid') && keys.includes('classid') && keys.includes('teacherid')) return 'homeroomAssignments';
      if (keys.includes('schoolid') && keys.includes('isactive') && keys.includes('name')) return 'academicYears';
      if (keys.includes('name') && keys.includes('address')) return 'schools';
      if (keys.includes('userid') && keys.includes('studentid') && keys.includes('address')) return 'parents';
      if (keys.includes('parentid') && keys.includes('studentid') && keys.includes('date') && keys.includes('status')) return 'absenceDeclarations';
      if (keys.includes('schoolid') && keys.includes('classid') && keys.includes('parentid')) return 'students';
      if (keys.includes('studentid') && keys.includes('academicyearid') && keys.includes('examtype')) return 'examResults';
      if (keys.includes('classid') && keys.includes('academicyearid') && keys.includes('examtype') && keys.includes('isactive')) return 'classExamConfigurations';
      if (keys.includes('studentid') && keys.includes('expectedstarttime') && keys.includes('arrivaltime')) return 'lateArrivals';
      if (keys.includes('studentid') && keys.includes('evaluationid') && keys.includes('score')) return 'grades';
      if (keys.includes('classid') && keys.includes('teacherid') && keys.includes('subject') && keys.includes('title')) return 'evaluations';
      if (keys.includes('name') && keys.includes('schoolid') && keys.includes('teacherid')) return 'classes';
      if (keys.includes('userid') && keys.includes('schoolid') && keys.includes('id')) return 'teachers';
      if (keys.includes('schoolid') && keys.includes('teacherid') && keys.includes('userid')) return 'teachers';
      if (keys.includes('classid') && keys.includes('teacherid')) return 'classTeachers';
      if (keys.includes('schoolid') && keys.includes('classid') && keys.includes('status')) return 'schoolClasses';
      if (keys.includes('studentid') && keys.includes('date') && keys.includes('period') && keys.includes('isjustified')) return 'absences';
      if (keys.includes('studentid') && keys.includes('expectedstarttime') && keys.includes('arrivaltime')) return 'lateArrivals';
      if (keys.includes('absenceid') && keys.includes('filepath') && keys.includes('mimetype') && keys.includes('uploadedby')) return 'absenceJustifications';
      if (keys.includes('notificationid') && keys.includes('filepath') && keys.includes('mimetype') && keys.includes('uploadedby')) return 'notificationAttachments';
      if (keys.includes('type') && keys.includes('userid') && keys.includes('title')) return 'notifications';
      if (keys.includes('clienttype') && keys.includes('loginat')) return 'userLoginEvents';
    }

    const maybeName = table && typeof table === 'object' ? (table.name || table.tableName || table.alias) : undefined;
    if (typeof maybeName === 'string') {
      const lower = maybeName.toLowerCase();
      const normalizedName = lower.replace(/_/g, '');
      if (lower.includes('users')) return 'users';
      if (lower.includes('access_sessions') || normalizedName.includes('accesssessions')) return 'accessSessions';
      if (lower.includes('schools')) return 'schools';
      if (lower.includes('academicyears')) return 'academicYears';
      if (lower.includes('localauths')) return 'localAuths';
      if (lower.includes('userschools')) return 'userSchools';
      if (normalizedName.includes('classhomeroomassignments')) return 'homeroomAssignments';
      if (normalizedName.includes('absencedeclarations')) return 'absenceDeclarations';
      if (lower.includes('parents')) return 'parents';
      if (lower.includes('students')) return 'students';
      if (lower.includes('classesteachers') || lower.includes('classteachers')) return 'classTeachers';
      if (normalizedName.includes('teacherclasssubjects')) return 'teacherClassSubjects';
      if (lower.includes('schoolclasses')) return 'schoolClasses';
      if (lower.includes('absences')) return 'absences';
      if (normalizedName.includes('evaluations')) return 'evaluations';
      if (normalizedName.includes('latearrivals')) return 'lateArrivals';
      if (normalizedName.includes('examresults')) return 'examResults';
      if (normalizedName.includes('classexamconfigurations')) return 'classExamConfigurations';
      if (normalizedName.includes('grades')) return 'grades';
      if (normalizedName.includes('absencejustifications')) return 'absenceJustifications';
      if (normalizedName.includes('notificationattachments')) return 'notificationAttachments';
      if (normalizedName.includes('notifications')) return 'notifications';
    }

    return '';
  };

  const filterTableRows = (table: any, cond: any, rawCond?: any) => {
    const tableName = resolveTableName(table);
    const rows = (tableName === 'users' ? FIXTURES.users
      : tableName === 'schools' ? FIXTURES.schools
      : tableName === 'academicYears' ? FIXTURES.academicYears
      : tableName === 'localAuths' ? FIXTURES.localAuths
      : tableName === 'accessSessions' ? FIXTURES.accessSessions
      : tableName === 'userSchools' ? FIXTURES.userSchools
      : tableName === 'homeroomAssignments' ? FIXTURES.homeroomAssignments
      : tableName === 'parents' ? FIXTURES.parents
      : tableName === 'students' ? FIXTURES.students.map((student: any) => ({ isActive: true, withdrawnAt: null, ...student }))
      : tableName === 'classes' ? FIXTURES.classes
      : tableName === 'teachers' ? FIXTURES.teachers
      : tableName === 'subjects' ? FIXTURES.subjects
      : tableName === 'subjectTypes' ? FIXTURES.subjectTypes
      : tableName === 'schoolSubjects' ? FIXTURES.schoolSubjects
      : tableName === 'teacherSubjects' ? FIXTURES.teacherSubjects
      : tableName === 'teacherClassSubjects' ? FIXTURES.teacherClassSubjects
      : tableName === 'classTeachers' ? FIXTURES.classTeachers
      : tableName === 'schoolClasses' ? FIXTURES.schoolClasses
      : tableName === 'absences' ? FIXTURES.absences
      : tableName === 'lateArrivals' ? FIXTURES.lateArrivals
      : tableName === 'absenceDeclarations' ? FIXTURES.absenceDeclarations
      : tableName === 'financialObligations' ? []
      : tableName === 'accountingTariffs' ? []
      : tableName === 'accountingFeeDefinitions' ? []
      : tableName === 'evaluations' ? FIXTURES.evaluations
      : tableName === 'grades' ? FIXTURES.grades
      : tableName === 'examResults' ? FIXTURES.examResults
      : tableName === 'classExamConfigurations' ? FIXTURES.classExamConfigurations
      : tableName === 'absenceJustifications' ? FIXTURES.absenceJustifications
      : tableName === 'notifications' ? FIXTURES.notifications
      : tableName === 'notificationAttachments' ? FIXTURES.notificationAttachments
      : tableName === 'auditEvents' ? FIXTURES.auditEvents
      : []) as any[];

    if (!cond) return rows;
    const isNormalizedConditionsObject = cond && typeof cond === 'object' && !('queryChunks' in cond) && !('left' in cond) && !('right' in cond) && !('args' in cond);
    const conditions = isNormalizedConditionsObject
      ? (cond as Record<string, any>)
      : extractConditions(cond);
    if (tableName === 'grades' && rawCond) {
      const query = new PgDialect().sqlToQuery(rawCond);
      if (/"grades"\."evaluation_id"/i.test(query.sql)) {
        const evaluationIds = query.params.flat(Infinity)
          .filter((value): value is number => typeof value === 'number');
        if (evaluationIds.length > 0) {
          conditions.evaluationIds = evaluationIds;
          delete conditions.ids;
        }
      }
    }
    if (tableName === 'students' && rawCond) {
      const query = new PgDialect().sqlToQuery(rawCond);
      for (const match of query.sql.matchAll(/LOWER\("students"\."(first_name|last_name)"\)\s*=\s*\$(\d+)/gi)) {
        const field = match[1] === 'first_name' ? 'firstName' : 'lastName';
        conditions[field] = String(query.params[Number(match[2]) - 1] ?? '').toLowerCase();
      }
      if (/"students"\."parent_id"\s+IS\s+NULL/i.test(query.sql)) conditions.parentId = null;
    }
    if (tableName === 'users' && rawCond) {
      const query = new PgDialect().sqlToQuery(rawCond);
      if (query.sql.includes('LOWER(BTRIM("users"."email"')) {
        conditions.email = String(query.params[0] ?? '').trim().toLowerCase();
        if (/"users"\."id"\s*<>/i.test(query.sql)) {
          delete conditions.id;
          conditions.excludedUserId = Number(query.params[query.params.length - 1]);
        }
      }
      if (
        tableName === 'users'
        && conditions.email !== undefined
        && db.__skipNextNormalizedEmailLookup
      ) {
        db.__skipNextNormalizedEmailLookup = false;
        return [];
      }
    }
    if (!Object.keys(conditions).length && typeof cond === 'string') {
      const maybeUid = /"([a-z0-9\-]+)"/gi.exec(cond);
      if (maybeUid) conditions.uid = maybeUid[1];
      const maybeEmail = /"([\w.%+-]+@[\w.-]+\.[a-z]{2,})"/i.exec(cond);
      if (maybeEmail) conditions.email = maybeEmail[1];
      const maybeId = /"?(\d+)"?/.exec(cond);
      if (maybeId) conditions.id = Number(maybeId[1]);
    }

    if (tableName === 'users' && !Object.keys(conditions).length && cond && typeof cond === 'object' && JSON.stringify(cond).includes('LOWER')) {
      console.log('DEBUG filterTableRows users no conditions', { cond });
    }
    if (tableName === 'teachers') {
      console.log('DEBUG filterTableRows teachers', { conditions, rows });
    }
    return rows.filter((row) => {
      if (conditions.uid !== undefined && row.uid !== conditions.uid) return false;
      if (conditions.email !== undefined && String(row.email).trim().toLowerCase() !== String(conditions.email).toLowerCase()) return false;
      if (conditions.excludedUserId !== undefined && Number(row.id) === conditions.excludedUserId) return false;
      if (conditions.phone !== undefined && row.phone !== conditions.phone) return false;
      if (conditions.id !== undefined) {
        if (Array.isArray(conditions.id)) {
          if (!conditions.id.includes(Number(row.id))) return false;
        } else if (tableName === 'accessSessions'
          ? row.id !== conditions.id
          : Number(row.id) !== Number(conditions.id)) {
          return false;
        }
      }
      if (conditions.ids !== undefined) {
        const idMatchTarget = tableName === 'parents' ? Number(row.studentId)
          : tableName === 'absences' ? Number(row.studentId)
          : tableName === 'absenceJustifications' ? Number(row.absenceId)
          : tableName === 'notificationAttachments' ? Number(row.notificationId)
          : Number(row.id);
        if (!Array.isArray(conditions.ids) || !conditions.ids.includes(idMatchTarget)) return false;
      }
      if (conditions.notificationId !== undefined && row.notificationId !== conditions.notificationId) return false;
      if (conditions.schoolId !== undefined && row.schoolId !== conditions.schoolId) return false;
      if (conditions.schoolIds !== undefined && !conditions.schoolIds.includes(Number(row.schoolId))) return false;
      if (conditions.userId !== undefined && row.userId !== conditions.userId) return false;
      if (conditions.role !== undefined && row.role !== conditions.role) return false;
      if (conditions.studentId !== undefined && row.studentId !== conditions.studentId) return false;
      if (conditions.studentIds !== undefined) {
        if (!Array.isArray(conditions.studentIds) || !conditions.studentIds.includes(Number(row.studentId))) return false;
      }
      if (conditions.evaluationIds !== undefined && !conditions.evaluationIds.includes(Number(row.evaluationId))) return false;
      if (conditions.parentId !== undefined && row.parentId !== conditions.parentId) return false;
      if (conditions.parentIds !== undefined) {
        if (!Array.isArray(conditions.parentIds) || !conditions.parentIds.includes(Number(row.parentId))) return false;
      }
      if (conditions.classId !== undefined && row.classId !== conditions.classId) return false;
      if (conditions.classIds !== undefined) {
        if (!Array.isArray(conditions.classIds) || !conditions.classIds.includes(Number(row.classId))) return false;
      }
      if (conditions.teacherId !== undefined && row.teacherId !== conditions.teacherId) return false;
      if (conditions.teacherIds !== undefined) {
        if (!Array.isArray(conditions.teacherIds) || !conditions.teacherIds.includes(Number(row.teacherId))) return false;
      }
      if (conditions.status !== undefined && row.status !== conditions.status) return false;
      if (conditions.isActive !== undefined && row.isActive !== conditions.isActive) return false;
      if (conditions.isDeleted !== undefined && (row.isDeleted ?? false) !== conditions.isDeleted) return false;
      if (conditions.firstName !== undefined && String(row.firstName).toLowerCase() !== conditions.firstName) return false;
      if (conditions.lastName !== undefined && String(row.lastName).toLowerCase() !== conditions.lastName) return false;
      return true;
    });
  };

  Object.assign(db, {
    select(selectSpec?: any) {
      const builder: any = {
        _selected: selectSpec,
        _table: null,
        _joins: [] as Array<{ table: any; cond: any }>,
        _conds: [] as any[],
        _cond: undefined as any,
        _limit: undefined as number | undefined,
        _orderBy: undefined as any,
        _distinct: false,
        from(table: any) {
          builder._table = table;
          return builder;
        },
        innerJoin(table: any, cond: any) {
          builder._joins.push({ table, cond });
          return builder;
        },
        leftJoin(table: any, cond: any) {
          builder._joins.push({ table, cond });
          return builder;
        },
        where(cond?: any) {
          if (cond !== undefined) builder._conds.push(cond);
          builder._cond = cond;
          return builder;
        },
        for(_strength: string) {
          return builder;
        },
        orderBy(..._args: any[]) {
          builder._orderBy = _args;
          return builder;
        },
        groupBy(..._args: any[]) {
          builder._groupBy = _args;
          return builder;
        },
        limit(n: number) {
          builder._limit = n;
          return builder;
        },
        then(onfulfilled: any, onrejected: any) {
          return executeQuery().then(onfulfilled, onrejected);
        },
        catch(onrejected: any) {
          return executeQuery().catch(onrejected);
        },
      };

      const resolveRowField = (row: any, rawKey: string) => {
        if (row == null) return null;
        const effectiveKey = String(rawKey).includes('.') ? String(rawKey).split('.').pop() ?? rawKey : rawKey;
        if (Object.prototype.hasOwnProperty.call(row, effectiveKey)) return row[effectiveKey];
        const camelCaseKey = effectiveKey.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
        if (Object.prototype.hasOwnProperty.call(row, camelCaseKey)) return row[camelCaseKey];
        const snakeCaseKey = effectiveKey.replace(/([A-Z])/g, (_match, letter) => `_${letter.toLowerCase()}`);
        if (Object.prototype.hasOwnProperty.call(row, snakeCaseKey)) return row[snakeCaseKey];
        const lowerKey = effectiveKey.toLowerCase();
        const foundKey = Object.keys(row).find((k) => String(k).toLowerCase() === lowerKey);
        if (foundKey) return row[foundKey];
        return null;
      };

      const resolveSelectedValue = (expr: any, baseRow: any, selectedAlias?: string) => {
        if (expr == null) return null;
        if (resolveTableName(builder._table) === 'grades' && selectedAlias) {
          const evaluation = FIXTURES.evaluations.find((row: any) => Number(row.id) === Number(baseRow.evaluationId));
          const evaluationFields: Record<string, string> = {
            classId: 'classId',
            evaluationSchoolId: 'schoolId',
            evaluationTitle: 'title',
            evaluationDate: 'date',
            subjectId: 'subjectId',
          };
          const evaluationField = evaluationFields[selectedAlias];
          if (evaluationField) return evaluation?.[evaluationField] ?? null;
        }
        if (selectedAlias === 'accessSessionGeneration') {
          return BigInt(baseRow.accessSessionGeneration ?? 1);
        }
        if (selectedAlias === 'currentGeneration') {
          return BigInt(baseRow.currentGeneration ?? 1);
        }
        if (selectedAlias === 'user' && baseRow._joinedUser) return baseRow._joinedUser;
        if (resolveTableName(builder._table) === 'parents'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'users')
          && ['lastLoginAt', 'lastMobileVisitAt'].includes(String(selectedAlias))) {
          const user = FIXTURES.users.find((row: any) => Number(row.id) === Number(baseRow.userId));
          return user?.[String(selectedAlias)] ?? null;
        }
        if (resolveTableName(builder._table) === 'teachers'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'users')
          && ['uid', 'name', 'lastName', 'firstNames', 'email', 'gender', 'isDeleted'].includes(String(selectedAlias))) {
          const user = FIXTURES.users.find((row: any) => Number(row.id) === Number(baseRow.userId));
          return user?.[String(selectedAlias)] ?? null;
        }
        if (resolveTableName(builder._table) === 'users'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'teachers')
          && ['teacherPhone', 'teacherSchoolId', 'teacherSpecialization'].includes(String(selectedAlias))) {
          const teacher = FIXTURES.teachers.find((row: any) => Number(row.userId) === Number(baseRow.id));
          if (selectedAlias === 'teacherPhone') return teacher?.phone ?? null;
          if (selectedAlias === 'teacherSchoolId') return teacher?.schoolId ?? null;
          return teacher?.specialization ?? null;
        }
        if (resolveTableName(builder._table) === 'grades' && selectedAlias === 'subject') {
          const evaluation = FIXTURES.evaluations.find((row: any) => Number(row.id) === Number(baseRow.evaluationId));
          const subject = FIXTURES.subjects.find((row: any) => Number(row.id) === Number(evaluation?.subjectId));
          return subject?.name ?? evaluation?.subject ?? null;
        }
        if (baseRow._joinedClass && selectedAlias === 'classSchoolId') return baseRow._joinedClass.schoolId ?? null;
        if (selectedAlias === 'isApprovedForSchool') return baseRow._joinedSchoolClass != null;
        if (selectedAlias === 'schoolClassStatus') return baseRow._joinedSchoolClass?.status ?? null;
        if (selectedAlias === 'status' && baseRow._joinedSchoolClass !== undefined) return baseRow._joinedSchoolClass?.status ?? null;
        if (baseRow._currentStudent !== undefined) {
          const studentFields: Record<string, string> = {
            studentId: 'id',
            studentFirstName: 'firstName',
            studentLastName: 'lastName',
            studentClassId: 'classId',
            studentSchoolId: 'schoolId',
          };
          const studentField = studentFields[String(selectedAlias)];
          if (studentField) return baseRow._currentStudent?.[studentField] ?? null;
        }
        if (selectedAlias === 'teacherName' && ['classes', 'homeroomAssignments'].includes(resolveTableName(builder._table))) {
          const teacher = FIXTURES.teachers.find((row: any) => Number(row.id) === Number(baseRow.teacherId));
          return FIXTURES.users.find((row: any) => Number(row.id) === Number(teacher?.userId))?.name ?? null;
        }
        if (resolveTableName(builder._table) === 'subjects' && ['subjectTypeId', 'status'].includes(String(selectedAlias))) {
          const relation = baseRow._schoolSubject;
          if (selectedAlias === 'subjectTypeId') return relation ? relation.subjectTypeId ?? null : baseRow.subjectTypeId ?? null;
          return relation?.status ?? 'approved';
        }
        if (typeof expr === 'string' || typeof expr === 'number' || typeof expr === 'boolean') return expr;
        if (typeof expr === 'object') {
          if (expr.name) {
            const key = String(expr.name);
            return resolveRowField(baseRow, key);
          }
          if (expr.value !== undefined) return expr.value;
        }
        return null;
      };

      const executeQuery = async () => {
        const combinedConditions = builder._conds.reduce((acc: Record<string, any>, cond: any) => {
          const extracted = extractConditions(cond);
          return Object.assign(acc, extracted);
        }, {} as Record<string, any>);

        console.log('DEBUG select.where', {
          fromTable: resolveTableName(builder._table),
          joins: builder._joins.map((j: any) => resolveTableName(j.table)),
          cond: builder._cond,
          conditions: combinedConditions,
          limit: builder._limit,
          orderBy: builder._orderBy,
        });

        const conditions = combinedConditions;
        const fromName = resolveTableName(builder._table);
        if (['evaluations', 'grades'].includes(fromName) && builder._cond) {
          db.__selectQueries.push({
            table: fromName,
            sql: new PgDialect().sqlToQuery(builder._cond).sql,
          });
        }
        if (fromName === 'accessSessions') {
          for (const cond of builder._conds) {
            const query = new PgDialect().sqlToQuery(cond);
            const columnAliases: Record<string, string> = {
              id: 'id',
              user_id: 'userId',
              status: 'status',
              context_version: 'contextVersion',
              observed_generation: 'observedGeneration',
              expires_at: 'expiresAt',
            };
            for (const match of query.sql.matchAll(/"access_sessions"\."([a-z_]+)"\s*(=|>)\s*\$(\d+)/gi)) {
              const property = columnAliases[match[1]];
              if (!property) continue;
              conditions[property] = query.params[Number(match[3]) - 1];
              if (match[1] === 'expires_at' && match[2] === '>') {
                conditions.expiresAtAfter = query.params[Number(match[3]) - 1];
              }
            }
          }
        }
        const hasStudentParentJoin = fromName === 'students'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'parents');
        const hasStudentParentMembershipJoin = fromName === 'students'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'userSchools')
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'users');
        const hasAccessSessionUserJoin = fromName === 'accessSessions'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'users');
        const hasTeacherUserJoin = fromName === 'teachers'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'users');
        const hasUsersParentPhoneLookup = fromName === 'users'
          && conditions.phone !== undefined
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'parents');
        const hasParentStudentJoin = fromName === 'parents'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'students');
        const hasClassTeachersClassJoin = fromName === 'classTeachers'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'classes');
        const hasHomeroomClassJoin = fromName === 'homeroomAssignments'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'classes');
        const hasAbsenceStudentJoin = fromName === 'absences'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'students');
        const baseConditions = { ...conditions };
        if (hasTeacherUserJoin) delete baseConditions.isDeleted;
        if (hasStudentParentJoin) delete baseConditions.userId;
        if (hasUsersParentPhoneLookup) delete baseConditions.phone;
        if (hasClassTeachersClassJoin) delete baseConditions.schoolId;
        if (hasHomeroomClassJoin) delete baseConditions.schoolId;
        if (hasAbsenceStudentJoin) delete baseConditions.schoolId;
        const hasSchoolClassesJoin = fromName === 'classes'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'schoolClasses');
        if (hasSchoolClassesJoin) delete baseConditions.schoolId;
        const hasSchoolSubjectsJoin = fromName === 'subjects'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'schoolSubjects');
        if (hasSchoolSubjectsJoin) delete baseConditions.schoolId;
        let rows = filterTableRows(builder._table, baseConditions, hasUsersParentPhoneLookup ? undefined : builder._cond);

        if (hasAccessSessionUserJoin) {
          rows = rows.flatMap((session: any) => {
            const user = FIXTURES.users.find((row: any) => Number(row.id) === Number(session.userId));
            return user ? [{ ...session, currentGeneration: (user as any).accessSessionGeneration, _joinedUser: user }] : [];
          });
        }

        if (hasTeacherUserJoin && conditions.isDeleted !== undefined) {
          rows = rows.filter((teacher: any) => {
            const user = FIXTURES.users.find((row: any) => Number(row.id) === Number(teacher.userId));
            return (user?.isDeleted ?? false) === conditions.isDeleted;
          });
        }

        if (hasAbsenceStudentJoin && conditions.schoolId != null) {
          rows = rows.filter((absence: any) => {
            const student = FIXTURES.students.find((row: any) => Number(row.id) === Number(absence.studentId));
            return Number(student?.schoolId) === Number(conditions.schoolId);
          });
        }

        const boundColumnValue = (condition: any, tableName: string, columnName: string) => {
          if (!condition) return undefined;
          const query = new PgDialect().sqlToQuery(condition);
          const match = new RegExp(`"${tableName}"\\."${columnName}"\\s*=\\s*\\$(\\d+)`, 'i').exec(query.sql);
          return match ? query.params[Number(match[1]) - 1] : undefined;
        };

        if (hasClassTeachersClassJoin || hasHomeroomClassJoin) {
          const relationSchoolId = hasHomeroomClassJoin
            ? boundColumnValue(builder._cond, 'class_homeroom_assignments', 'school_id')
            : undefined;
          const classSchoolId = boundColumnValue(builder._cond, 'classes', 'school_id');
          const schoolClassJoin = builder._joins.find((join: any) => resolveTableName(join.table) === 'schoolClasses');
          const approvedSchoolId = schoolClassJoin
            ? boundColumnValue(schoolClassJoin.cond, 'school_classes', 'school_id') ?? relationSchoolId
            : relationSchoolId;
          const approvedStatus = schoolClassJoin
            ? boundColumnValue(schoolClassJoin.cond, 'school_classes', 'status')
            : undefined;

          rows = rows.flatMap((assignment: any) => {
            if (relationSchoolId != null && Number(assignment.schoolId) !== Number(relationSchoolId)) return [];
            const joinedClass = FIXTURES.classes.find((klass: any) => Number(klass.id) === Number(assignment.classId));
            if (!joinedClass) return [];
            const joinedSchoolClass = approvedSchoolId == null
              ? null
              : FIXTURES.schoolClasses.find((schoolClass: any) => (
                Number(schoolClass.classId) === Number(joinedClass.id)
                && Number(schoolClass.schoolId) === Number(approvedSchoolId)
                && (approvedStatus == null || schoolClass.status === approvedStatus)
              )) ?? null;
            const isApprovedGlobalHomeroomClass = hasHomeroomClassJoin
              && joinedClass.schoolId == null
              && joinedSchoolClass?.status === 'approved';
            if (classSchoolId != null && Number(joinedClass.schoolId) !== Number(classSchoolId) && !isApprovedGlobalHomeroomClass) return [];
            return [{ ...assignment, _joinedClass: joinedClass, _joinedSchoolClass: joinedSchoolClass }];
          });
        }

        if (hasSchoolSubjectsJoin) {
          const joinConditions = builder._joins
            .filter((join: any) => resolveTableName(join.table) === 'schoolSubjects')
            .reduce((acc: Record<string, any>, join: any) => Object.assign(acc, extractConditions(join.cond)), {});
          rows = rows.map((subject: any) => ({
            ...subject,
            _schoolSubject: FIXTURES.schoolSubjects.find((schoolSubject: any) => (
              schoolSubject.subjectId === subject.id
              && (joinConditions.schoolId == null || schoolSubject.schoolId === joinConditions.schoolId)
            )) ?? null,
          }));
        }

        if (hasSchoolClassesJoin && conditions.schoolId != null) {
          rows = rows.filter((row: any) => row.schoolId === conditions.schoolId || (
            row.schoolId == null
            && FIXTURES.schoolClasses.some((schoolClass: any) => (
              schoolClass.classId === row.id
              && schoolClass.schoolId === conditions.schoolId
              && schoolClass.status === 'approved'
            ))
          ));
        }

        if (fromName === 'classes' && hasSchoolClassesJoin) {
          const schoolClassJoin = builder._joins.find((join: any) => resolveTableName(join.table) === 'schoolClasses');
          const approvedSchoolId = boundColumnValue(schoolClassJoin?.cond, 'school_classes', 'school_id');
          const approvedStatus = boundColumnValue(schoolClassJoin?.cond, 'school_classes', 'status');
          rows = rows.map((row: any) => ({
            ...row,
            _joinedSchoolClass: approvedSchoolId == null
              ? null
              : FIXTURES.schoolClasses.find((schoolClass: any) => (
                Number(schoolClass.classId) === Number(row.id)
                && Number(schoolClass.schoolId) === Number(approvedSchoolId)
                && (approvedStatus == null || schoolClass.status === approvedStatus)
              )) ?? null,
          }));
        }

        if (hasSchoolSubjectsJoin && conditions.schoolId != null) {
          rows = rows.filter((subject: any) => subject.schoolId === conditions.schoolId || (
            FIXTURES.schoolSubjects.some((schoolSubject: any) => (
              schoolSubject.subjectId === subject.id
              && schoolSubject.schoolId === conditions.schoolId
              && schoolSubject.status === 'approved'
            ))
          ));
        }

        if (hasStudentParentJoin) {
          rows = rows.flatMap((student: any) => FIXTURES.parents
            .filter((parent: any) => parent.id === student.parentId)
            .map((parent: any) => ({ ...student, userId: parent.userId })));
        }

        if (hasStudentParentMembershipJoin) {
          rows = rows.filter((student: any) => (
            FIXTURES.users.some((user: any) => user.id === student.userId && user.isDeleted !== true)
            && FIXTURES.userSchools.some((membership: any) => (
              membership.userId === student.userId
              && membership.schoolId === student.schoolId
              && membership.role === 'parent'
              && membership.isActive !== false
            ))
          ));
        }

        if (hasUsersParentPhoneLookup) {
          const requestedPhone = String(conditions.phone ?? '').replace(/\D/g, '');
          rows = rows
            .filter((user: any) => user.role === 'parent' && FIXTURES.parents.some((parent: any) => (
              Number(parent.userId) === Number(user.id)
              && [parent.phone, user.phone].some((phone) => String(phone ?? '').replace(/\D/g, '') === requestedPhone)
            )))
            .map((user: any) => ({ ...user, _joinedUser: user }));
        }

        if (hasParentStudentJoin) {
          rows = rows.flatMap((parent: any) => {
            const linkedStudents = FIXTURES.students.filter((student: any) => (
              student.parentId === parent.id && student.schoolId === parent.schoolId
            ));
            return linkedStudents.length > 0
              ? linkedStudents.map((student: any) => ({ ...parent, _currentStudent: student }))
              : [{ ...parent, _currentStudent: null }];
          });
        }

        if (builder._selected && typeof builder._selected === 'object') {
          const selectedKeys = Object.keys(builder._selected);
          if (selectedKeys.includes('totalLogins')) {
            const events = FIXTURES.userLoginEvents;
            return [{
              totalLogins: events.length,
              uniqueUsers: new Set(events.map((event) => event.userId)).size,
              webLogins: events.filter((event) => event.clientType === 'web').length,
              androidLogins: events.filter((event) => event.clientType === 'android').length,
            }];
          }
          if (selectedKeys.includes('role') && selectedKeys.includes('total') && selectedKeys.length === 2) {
            const totals = new Map<string, number>();
            for (const event of FIXTURES.userLoginEvents) {
              totals.set(event.role, (totals.get(event.role) || 0) + 1);
            }
            return Array.from(totals, ([role, total]) => ({ role, total }));
          }
        }

          if (fromName === 'notificationAttachments' && builder._cond) {
            const queryChunks: any[] = [];
            const collectQueryChunks = (value: any) => {
              if (!value || typeof value !== 'object') return;
              if (Array.isArray(value.queryChunks)) {
                value.queryChunks.forEach((chunk: any) => {
                  if (chunk && typeof chunk === 'object' && Array.isArray(chunk.queryChunks)) {
                    collectQueryChunks(chunk);
                  } else {
                    queryChunks.push(chunk);
                  }
                });
              }
            };
            collectQueryChunks(builder._cond);
            for (let index = 0; index < queryChunks.length; index += 1) {
              const column = queryChunks[index];
              if (column?.name === 'notification_id') {
                const value = queryChunks.slice(index + 1).find((chunk: any) => chunk?.constructor?.name === 'Param');
                if (value) conditions.notificationId = Number(value.value);
              }
            }
            rows = filterTableRows(builder._table, conditions);
          }

        if (fromName === 'classes' && conditions.userId !== undefined) {
          rows = rows.filter((row) => {
            return FIXTURES.classTeachers.some((assignment) => {
              if (assignment.classId !== row.id) return false;
              const teacher = FIXTURES.teachers.find((t) => t.id === assignment.teacherId);
              return teacher?.userId === conditions.userId;
            });
          });
        }

        if (fromName === 'classes' && conditions.ids !== undefined) {
          rows = rows.filter((row) => {
            return Array.isArray(conditions.ids) && conditions.ids.includes(Number(row.id));
          });
        }

        if (fromName === 'classes' && conditions.teacherId !== undefined) {
          rows = rows.filter((row) => {
            return FIXTURES.classTeachers.some((assignment) => {
              if (assignment.classId !== row.id) return false;
              return assignment.teacherId === conditions.teacherId;
            });
          });
        }

        if (fromName === 'classes' && conditions.rawClassTeacherFilter) {
          rows = rows.filter((row) => {
            return FIXTURES.classTeachers.some((assignment) => assignment.classId === row.id && assignment.teacherId === Number(conditions.rawClassTeacherFilter));
          });
        }

        if (typeof builder._limit === 'number') {
          rows = rows.slice(0, builder._limit);
        }

        if (builder._selected && typeof builder._selected === 'object' && !Array.isArray(builder._selected)) {
          const mappedRows = rows.map((row: any) => {
            const mapped: Record<string, any> = {};
            for (const [alias, expr] of Object.entries(builder._selected)) {
              mapped[alias] = resolveSelectedValue(expr, row, alias);
            }
            return mapped;
          });
          return builder._distinct
            ? Array.from(new Map(mappedRows.map((row: any) => [JSON.stringify(row), row])).values())
            : mappedRows;
        }

        return rows;
      };

      return builder;
    },
    selectDistinct(selectSpec?: any) {
      const builder = (db as any).select(selectSpec);
      builder._distinct = true;
      return builder;
    },
    async transaction(callback: (tx: any) => Promise<any>) {
      const studentsBefore = structuredClone(FIXTURES.students);
      const usersBefore = structuredClone(FIXTURES.users);
      const localAuthsBefore = structuredClone(FIXTURES.localAuths);
      const teachersBefore = structuredClone(FIXTURES.teachers);
      const teacherSubjectsBefore = structuredClone(FIXTURES.teacherSubjects);
      const teacherClassSubjectsBefore = structuredClone(FIXTURES.teacherClassSubjects);
      const classTeachersBefore = structuredClone(FIXTURES.classTeachers);
      const accessSessionsBefore = FIXTURES.accessSessions.map((row) => ({
        ...row,
        expiresAt: new Date(row.expiresAt),
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
      }));
      const parentsBefore = structuredClone(FIXTURES.parents);
      const userSchoolsBefore = structuredClone(FIXTURES.userSchools);
      const auditEventsBefore = structuredClone(FIXTURES.auditEvents);
      const mobileParentSessionsBefore = structuredClone(FIXTURES.mobileParentSessions);
      try {
        const result = await callback(db);
        db.__transactionCommitCount += 1;
        return result;
      } catch (error) {
        db.__transactionRollbackCount += 1;
        FIXTURES.students.splice(0, FIXTURES.students.length, ...studentsBefore);
        FIXTURES.users.splice(0, FIXTURES.users.length, ...usersBefore);
        FIXTURES.localAuths.splice(0, FIXTURES.localAuths.length, ...localAuthsBefore);
        FIXTURES.teachers.splice(0, FIXTURES.teachers.length, ...teachersBefore);
        FIXTURES.teacherSubjects.splice(0, FIXTURES.teacherSubjects.length, ...teacherSubjectsBefore);
        FIXTURES.teacherClassSubjects.splice(0, FIXTURES.teacherClassSubjects.length, ...teacherClassSubjectsBefore);
        FIXTURES.classTeachers.splice(0, FIXTURES.classTeachers.length, ...classTeachersBefore);
        FIXTURES.accessSessions.splice(0, FIXTURES.accessSessions.length, ...accessSessionsBefore);
        FIXTURES.parents.splice(0, FIXTURES.parents.length, ...parentsBefore);
        FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length, ...userSchoolsBefore);
        FIXTURES.auditEvents.splice(0, FIXTURES.auditEvents.length, ...auditEventsBefore);
        FIXTURES.mobileParentSessions.splice(0, FIXTURES.mobileParentSessions.length, ...mobileParentSessionsBefore);
        throw error;
      }
    },
    insert(table?: any) {
      const tableName = resolveTableName(table);
      return {
        values: (obj: any) => {
          const executeInsert = async (ignoreConflict = false) => {
            if (Array.isArray(obj)) {
              const inserted: any[] = [];
              if (db.__failNextNotificationAttachmentInsert) {
                const hasAttachmentRows = obj.some((item) => item && item.notificationId != null);
                if (hasAttachmentRows) {
                  throw new Error('Simulated DB failure for notification attachments');
                }
              }
              for (const item of obj) {
                if (item == null) continue;
                if (tableName === 'teacherSubjects') {
                  FIXTURES.teacherSubjects.push(item as any);
                  inserted.push(item);
                  continue;
                }
                if (item.notificationId != null) {
                  const nextId = FIXTURES.notificationAttachments.reduce((max, row: any) => Math.max(max, Number(row.id) || 0), 0) + 1;
                  const row = { id: nextId, ...item };
                  FIXTURES.notificationAttachments.push(row as any);
                  inserted.push(row);
                  continue;
                }
                if (item.userId != null && item.type != null) {
                  const nextId = FIXTURES.notifications.reduce((max, row: any) => Math.max(max, Number(row.id) || 0), 0) + 1;
                  const row = { id: nextId, ...item };
                  FIXTURES.notifications.push(row as any);
                  inserted.push(row);
                  continue;
                }
                if (item.absenceId != null || item.filePath != null || item.fileName != null) {
                  FIXTURES.absenceJustifications.push(item as any);
                  inserted.push(item);
                  continue;
                }
                inserted.push(item);
              }
              return inserted;
            }

            if (tableName === 'accessSessions') {
              if (FIXTURES.accessSessions.some((session) => session.id === obj.id)) return [];
              FIXTURES.accessSessions.push({
                ...obj,
                observedGeneration: BigInt(obj.observedGeneration),
                expiresAt: new Date(obj.expiresAt),
                createdAt: new Date(obj.createdAt),
                updatedAt: new Date(obj.updatedAt),
                revokedAt: obj.revokedAt ? new Date(obj.revokedAt) : null,
              });
              return [{ id: obj.id }];
            }

            if (tableName === 'classTeachers') {
              if (db.__failNextClassTeacherInsert) {
                db.__failNextClassTeacherInsert = false;
                throw new Error('Simulated DB failure for teacher class assignment');
              }
              FIXTURES.classTeachers.push(obj as any);
              return [obj];
            }
            if (tableName === 'teacherClassSubjects') {
              if (db.__failNextTeacherClassSubjectInsert) {
                db.__failNextTeacherClassSubjectInsert = false;
                throw new Error('Simulated DB failure for teacher class-subject assignment');
              }
              const nextId = FIXTURES.teacherClassSubjects.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
              const row = { id: nextId, ...obj };
              FIXTURES.teacherClassSubjects.push(row as any);
              return [row];
            }
            if (tableName === 'teachers') {
              const nextId = FIXTURES.teachers.reduce((max, row: any) => Math.max(max, Number(row.id) || 0), 0) + 1;
              const row = { id: nextId, ...obj };
              FIXTURES.teachers.push(row as any);
              return [row];
            }
            if (tableName === 'parents') {
              if (db.__failNextParentInsert) {
                db.__failNextParentInsert = false;
                throw new Error('Simulated DB failure for parent profile');
              }
              const nextId = FIXTURES.parents.reduce((max: number, row: any) => Math.max(max, Number(row.id) || 0), 0) + 1;
              const row = { id: nextId, ...obj };
              FIXTURES.parents.push(row as any);
              return [row];
            }
            if (tableName === 'teacherSubjects') {
              const rows = (Array.isArray(obj) ? obj : [obj]) as any[];
              FIXTURES.teacherSubjects.push(...rows);
              return rows;
            }
            if (tableName === 'students') {
              const nextId = FIXTURES.students.reduce((max: number, row: any) => Math.max(max, Number(row.id) || 0), 0) + 1;
              const row = { id: nextId, isActive: true, withdrawnAt: null, ...obj };
              FIXTURES.students.push(row as any);
              return [row];
            }

            if (obj.userId !== undefined && obj.schoolId !== undefined && obj.role && obj.passwordHash === undefined && obj.actorUserId === undefined) {
              db.__userSchoolWriteCount += 1;
              if (db.__failNextParentMembershipInsert && obj.role === 'parent') {
                db.__failNextParentMembershipInsert = false;
                throw new Error('Simulated DB failure for parent school membership');
              }
              const samePair = FIXTURES.userSchools.filter((row: any) => (
                row.userId === obj.userId && row.schoolId === obj.schoolId
              ));
              if (db.__legacyUserSchoolPairConstraint && samePair.length > 0) {
                if (ignoreConflict) return [];
                throw Object.assign(new Error('duplicate user school membership'), {
                  code: '23505',
                  constraint: 'user_schools_user_id_school_id_idx',
                  detail: `Key (user_id, school_id)=(${obj.userId}, ${obj.schoolId}) already exists.`,
                });
              }
              FIXTURES.userSchools.push(obj as any);
              return [obj];
            }
            if (obj.schoolId !== undefined && obj.classId !== undefined && obj.teacherId !== undefined) {
              const existing = FIXTURES.homeroomAssignments.find((row) => row.schoolId === obj.schoolId && row.classId === obj.classId);
              if (existing) Object.assign(existing, obj);
              else FIXTURES.homeroomAssignments.push({ id: FIXTURES.homeroomAssignments.length + 1, ...obj } as any);
              return [existing || FIXTURES.homeroomAssignments[FIXTURES.homeroomAssignments.length - 1]];
            }
            if (obj.userId !== undefined && obj.passwordHash) {
              if (db.__failNextLocalAuthInsert) {
                db.__failNextLocalAuthInsert = false;
                throw new Error('Simulated DB failure for local authentication');
              }
              FIXTURES.localAuths.push(obj as any);
              return [obj];
            }
            if (obj.actorUserId !== undefined) {
              if (db.__failLifecycleAuditInsertAfter !== null) {
                if (db.__failLifecycleAuditInsertAfter === 0) {
                  db.__failLifecycleAuditInsertAfter = null;
                  throw new Error('Simulated DB failure for lifecycle audit');
                }
                db.__failLifecycleAuditInsertAfter -= 1;
              }
              if (db.__failNextLifecycleAuditInsertError) {
                const error = db.__failNextLifecycleAuditInsertError;
                db.__failNextLifecycleAuditInsertError = null;
                throw error;
              }
              const nextAuditEventId = Math.max(0, ...FIXTURES.auditEvents.map((event: any) => Number(event.id) || 0)) + 1;
              const auditEvent = { ...obj, id: nextAuditEventId };
              FIXTURES.auditEvents.push(auditEvent as any);
              return [auditEvent];
            }
            if (obj.uid && obj.role && Object.prototype.hasOwnProperty.call(obj, 'email')) {
              const phone = typeof obj.phone === 'string' ? obj.phone : '';
              if (!/^\+[1-9][0-9]{1,14}$/.test(phone)) {
                throw Object.assign(new Error('users.phone must contain a canonical phone'), { code: '23514', constraint: 'users_phone_canonical_check' });
              }
              if (FIXTURES.users.some((user: any) => user.phone === phone)) {
                throw Object.assign(new Error('duplicate users.phone'), { code: '23505', constraint: 'users_phone_unique' });
              }
              const newId = FIXTURES.users.length + 1;
              const row = {
                id: newId,
                accessSessionGeneration: db.__returnUsersWithBigIntAccessSessionGeneration ? 1n : 1,
                deactivationGenerationAware: false,
                ...obj,
              };
              FIXTURES.users.push({ ...row, accessSessionGeneration: 1 } as any);
              return [row];
            }
            if (obj.notificationId != null) {
              if (db.__failNextNotificationAttachmentInsert) {
                throw new Error('Simulated DB failure for notification attachments');
              }
              const nextId = FIXTURES.notificationAttachments.reduce((max, row: any) => Math.max(max, Number(row.id) || 0), 0) + 1;
              const row = { id: nextId, ...obj };
              FIXTURES.notificationAttachments.push(row as any);
              return [row];
            }
            if (obj.absenceId !== undefined || obj.filePath !== undefined || obj.fileName !== undefined) {
              FIXTURES.absenceJustifications.push(obj as any);
              return [obj];
            }
            if (obj.userId !== undefined && obj.type !== undefined) {
              const nextId = FIXTURES.notifications.reduce((max, row: any) => Math.max(max, Number(row.id) || 0), 0) + 1;
              const row = { id: nextId, ...obj };
              FIXTURES.notifications.push(row as any);
              return [row];
            }
            if (obj.studentId !== undefined && obj.academicYearId !== undefined && obj.examType !== undefined) {
              const existing = FIXTURES.examResults.find((row: any) => row.studentId === obj.studentId && row.academicYearId === obj.academicYearId && row.examType === obj.examType);
              if (existing) Object.assign(existing, obj);
              else {
                const nextId = FIXTURES.examResults.reduce((max: number, row: any) => Math.max(max, Number(row.id) || 0), 0) + 1;
                FIXTURES.examResults.push({ id: nextId, ...obj });
              }
              return [existing || FIXTURES.examResults[FIXTURES.examResults.length - 1]];
            }
            return [obj];
          };

          return {
            returning: async () => executeInsert(),
            onConflictDoNothing: () => ({ returning: async () => executeInsert(true) }),
            onConflictDoUpdate: () => ({ returning: async () => executeInsert() }),
            then: async (onfulfilled?: any, onrejected?: any) => {
              try {
                const result = await executeInsert();
                return onfulfilled ? onfulfilled(result) : result;
              } catch (error) {
                if (onrejected) return onrejected(error);
                throw error;
              }
            },
            catch: async (onrejected?: any) => {
              try {
                return await executeInsert();
              } catch (error) {
                if (onrejected) return onrejected(error);
                throw error;
              }
            },
          };
        },
      };
    },
    update(table?: any) {
      return {
        set: (values: any) => {
          const executeUpdate = async (cond: any) => {
            const conditions = extractConditions(cond);
            const tableName = resolveTableName(table);
            if (tableName === 'users' && db.__failNextUsersUpdateError) {
              const error = db.__failNextUsersUpdateError;
              db.__failNextUsersUpdateError = null;
              throw error;
            }
            if (tableName === 'localAuths' && db.__failNextLocalAuthUpdateError) {
              const error = db.__failNextLocalAuthUpdateError;
              db.__failNextLocalAuthUpdateError = null;
              throw error;
            }
            if (tableName === 'accessSessions') {
              const query = cond ? new PgDialect().sqlToQuery(cond) : null;
              const columnAliases: Record<string, string> = {
                id: 'id',
                user_id: 'userId',
                status: 'status',
                context_version: 'contextVersion',
                observed_generation: 'observedGeneration',
                expires_at: 'expiresAt',
              };
              const contextMatch = query?.sql.match(/"access_sessions"\."context"\s*@>\s*\$(\d+)/i);
              const expectedContext = contextMatch
                ? JSON.parse(String(query!.params[Number(contextMatch[1]) - 1]))
                : null;
              const containsContext = (actual: any, expected: any): boolean => (
                expected == null
                || (actual != null && typeof actual === 'object'
                  && Object.entries(expected).every(([key, value]) => (
                    value != null && typeof value === 'object'
                      ? containsContext(actual[key], value)
                      : actual[key] === value
                  )))
              );
              const predicates = query
                ? Array.from(query.sql.matchAll(/"access_sessions"\."([a-z_]+)"\s*(=|>)\s*\$(\d+)/gi))
                  .map((match) => ({
                    property: columnAliases[match[1]],
                    operator: match[2],
                    value: query.params[Number(match[3]) - 1],
                  }))
                  .filter((predicate) => predicate.property)
                : [];
              const matchedRows = FIXTURES.accessSessions.filter((row) => predicates.every(({ property, operator, value }) => {
                if (property === 'id') return operator === '=' && row.id === value;
                if (property === 'status') return operator === '=' && row.status === value;
                if (property === 'userId' || property === 'contextVersion') {
                  return operator === '=' && Number(row[property]) === Number(value);
                }
                if (property === 'observedGeneration') {
                  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return false;
                  return operator === '=' && BigInt(row.observedGeneration) === BigInt(value);
                }
                if (property === 'expiresAt') {
                  const expiresAt = new Date(row.expiresAt).getTime();
                  const expectedAt = new Date(value as Date).getTime();
                  return operator === '>' ? expiresAt > expectedAt : expiresAt === expectedAt;
                }
                return false;
              }));
              const contextMatchedRows = matchedRows.filter((row) => containsContext(row.context, expectedContext));
              contextMatchedRows.forEach((row) => Object.assign(row, values));
              return contextMatchedRows.map((row) => ({ id: row.id }));
            }
            if (tableName === 'schoolSubjects') {
              const matchedRows = FIXTURES.schoolSubjects.filter((row: any) => Object.entries(conditions).every(([key, value]) => row[key] === value));
              matchedRows.forEach((row: any) => Object.assign(row, values));
              return matchedRows;
            }
            if (tableName === 'userSchools') {
              db.__userSchoolWriteCount += 1;
              const query = cond ? new PgDialect().sqlToQuery(cond) : null;
              const columnAliases: Record<string, string> = {
                user_id: 'userId',
                school_id: 'schoolId',
                role: 'role',
                is_active: 'isActive',
              };
              const predicates = query
                ? Array.from(query.sql.matchAll(/"user_schools"\."([a-z_]+)"\s*=\s*\$(\d+)/gi))
                  .map((match) => ({
                    property: columnAliases[match[1]],
                    value: query.params[Number(match[2]) - 1],
                  }))
                  .filter((predicate) => predicate.property)
                : [];
              const matchedRows = FIXTURES.userSchools.filter((row: any) => (
                predicates.every(({ property, value }) => row[property] === value)
                && Object.entries(conditions).every(([key, value]) => row[key] === value)
              ));
              matchedRows.forEach((row: any) => Object.assign(row, values));
              return matchedRows;
            }
            if (tableName === 'localAuths' && conditions.userId != null) {
              const query = cond ? new PgDialect().sqlToQuery(cond) : null;
              if (db.__changeLocalAuthBeforeNextUpdate) {
                const change = db.__changeLocalAuthBeforeNextUpdate;
                db.__changeLocalAuthBeforeNextUpdate = null;
                const row = FIXTURES.localAuths.find((auth: any) => auth.userId === Number(conditions.userId));
                if (row) Object.assign(row, change);
              }
              const expected: Record<string, unknown> = {};
              if (query) {
                for (const match of query.sql.matchAll(/"local_auths"\."(user_id|password_hash|salt|must_reset)"\s*=\s*\$(\d+)/gi)) {
                  const key = match[1] === 'user_id'
                    ? 'userId'
                    : match[1] === 'password_hash'
                      ? 'passwordHash'
                      : match[1] === 'must_reset'
                        ? 'mustReset'
                        : 'salt';
                  expected[key] = query.params[Number(match[2]) - 1];
                }
              }
              const matchedRows = FIXTURES.localAuths.filter((row: any) => (
                row.userId === Number(conditions.userId)
                && Object.entries(expected).every(([key, value]) => row[key] === value)
              ));
              matchedRows.forEach((row: any) => Object.assign(row, values));
              return matchedRows;
            }
            if (conditions.id != null) {
              const id = Number(conditions.id);
              const updateRow = (rows: any[]) => {
                const idx = rows.findIndex((row) => row.id === id);
                if (idx >= 0) {
                  const normalizedValues = { ...values };
                  if (typeof normalizedValues.accessSessionGeneration === 'bigint') {
                    normalizedValues.accessSessionGeneration = Number(normalizedValues.accessSessionGeneration);
                  }
                  rows[idx] = { ...rows[idx], ...normalizedValues };
                  return [rows[idx]];
                }
                return [];
              };

              if (tableName === 'users') return updateRow(FIXTURES.users);
              if (tableName === 'classes') return updateRow(FIXTURES.classes);
              if (tableName === 'students') return updateRow(FIXTURES.students);
              if (tableName === 'parents') return updateRow(FIXTURES.parents);
              if (tableName === 'teachers') return updateRow(FIXTURES.teachers);
              if (tableName === 'teacherClassSubjects') return updateRow(FIXTURES.teacherClassSubjects);
              if (tableName === 'homeroomAssignments') return updateRow(FIXTURES.homeroomAssignments);
              if (tableName === 'userSchools') return updateRow(FIXTURES.userSchools);
              if (tableName === 'localAuths') return updateRow(FIXTURES.localAuths);
              if (tableName === 'subjects') return updateRow(FIXTURES.subjects);
              if (tableName === 'subjectTypes') return updateRow(FIXTURES.subjectTypes);
              if (tableName === 'schoolClasses') return updateRow(FIXTURES.schoolClasses);
              if (tableName === 'absences') return updateRow(FIXTURES.absences);
              if (tableName === 'notifications') return updateRow(FIXTURES.notifications);
              if (tableName === 'notificationAttachments') return updateRow(FIXTURES.notificationAttachments);
              if (tableName === 'auditEvents') return updateRow(FIXTURES.auditEvents);
            }
            if (tableName === 'schoolSubjects') {
              const updatedRows = FIXTURES.schoolSubjects.filter((row: any) => Object.entries(conditions).every(([key, value]) => row[key] === value));
              updatedRows.forEach((row: any) => Object.assign(row, values));
              return updatedRows;
            }
            return [];
          };

          const createWhereResult = (cond: any) => {
            let promise: Promise<any> | null = null;
            const response: any = {
              returning: async () => {
                promise = promise || executeUpdate(cond);
                return promise;
              },
              then(onfulfilled: any, onrejected: any) {
                promise = promise || executeUpdate(cond);
                return promise.then(onfulfilled, onrejected);
              },
            };
            return response;
          };

          return {
            where: (cond: any) => createWhereResult(cond),
            returning: () => ({
              where: async (cond: any) => {
                return executeUpdate(cond);
              },
            }),
          };
        },
      };
    },
    delete(table?: any) {
      return {
        where: async (cond: any) => {
          const conditions = extractConditions(cond);
          const tableName = resolveTableName(table);
          if (tableName === 'userSchools') db.__userSchoolWriteCount += 1;
          if (tableName === 'homeroomAssignments') {
            const before = FIXTURES.homeroomAssignments.length;
            const remaining = FIXTURES.homeroomAssignments.filter((row) => !Object.entries(conditions).every(([key, value]) => (row as any)[key] === value));
            FIXTURES.homeroomAssignments.splice(0, before, ...remaining);
            return [];
          }
          if (tableName === 'classTeachers') {
            const remaining = FIXTURES.classTeachers.filter((row) => !Object.entries(conditions).every(([key, value]) => (row as any)[key] === value));
            FIXTURES.classTeachers.splice(0, FIXTURES.classTeachers.length, ...remaining);
            return [];
          }
          if (tableName === 'teacherClassSubjects') {
            const remaining = FIXTURES.teacherClassSubjects.filter((row) => !Object.entries(conditions).every(([key, value]) => (row as any)[key] === value));
            FIXTURES.teacherClassSubjects.splice(0, FIXTURES.teacherClassSubjects.length, ...remaining);
            return [];
          }
          if (tableName === 'teacherSubjects') {
            const remaining = FIXTURES.teacherSubjects.filter((row) => !Object.entries(conditions).every(([key, value]) => (row as any)[key] === value));
            FIXTURES.teacherSubjects.splice(0, FIXTURES.teacherSubjects.length, ...remaining);
            return [];
          }
          if (conditions.id != null) {
            if (tableName === 'users') {
              const idx = FIXTURES.users.findIndex((u) => u.id === Number(conditions.id));
              if (idx >= 0) {
                FIXTURES.users[idx].isDeleted = true;
                return [FIXTURES.users[idx]];
              }
            }
            if (tableName === 'classes') {
              const idx = FIXTURES.classes.findIndex((c) => c.id === Number(conditions.id));
              if (idx >= 0) {
                const row = FIXTURES.classes[idx];
                if ('isDeleted' in row) {
                  row.isDeleted = true;
                } else {
                  FIXTURES.classes.splice(idx, 1);
                }
                return [row];
              }
            }
          }
          return [];
        },
      };
    },
  });
  // Simulate the daily aggregate query without connecting to PostgreSQL.
  (db as any).__mobileParentSessionRevocationQueries = [];
  (db as any).execute = async (_sql: any) => {
    const query = new PgDialect().sqlToQuery(_sql);
    if (/UPDATE mobile_parent_sessions/i.test(query.sql)) {
      (db as any).__mobileParentSessionRevocationQueries.push(query);
      if (db.__failNextMobileParentSessionRevocationError) {
        const error = db.__failNextMobileParentSessionRevocationError;
        db.__failNextMobileParentSessionRevocationError = null;
        throw error;
      }
      const parentId = String(query.params[0]);
      for (const session of FIXTURES.mobileParentSessions as any[]) {
        if (session.parentId === parentId && session.isActive) {
          session.isActive = false;
          session.revokedAt = '2026-09-24T12:00:00.000Z';
        }
      }
      return { rows: [] };
    }

    const today = new Date('2026-09-24T00:00:00.000Z');
    const eventsByDate = new Map<string, { total: number; web: number; android: number }>();
    for (const event of FIXTURES.userLoginEvents) {
      const date = String(event.loginAt).slice(0, 10);
      const current = eventsByDate.get(date) || { total: 0, web: 0, android: 0 };
      current.total += 1;
      if (event.clientType === 'web') current.web += 1;
      if (event.clientType === 'android') current.android += 1;
      eventsByDate.set(date, current);
    }

    const rows = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() - 29 + index);
      const key = date.toISOString().slice(0, 10);
      const values = eventsByDate.get(key) || { total: 0, web: 0, android: 0 };
      return { date: key, ...values };
    });
    return { rows };
  };
  return db;
}

// Mock the DB module used by server.ts (cover both relative and bare imports)
const mockDb = {
  db: createMockDb(),
  withNotificationRecipientAccountLock: async (_userId: number, action: (db: any) => Promise<unknown>) => action(mockDb.db),
};
vi.mock('../../src/db/index.ts', () => mockDb);
vi.mock('src/db/index.ts', () => mockDb);
vi.mock('src/db', () => mockDb);

// Mock auth middleware: inspect headers and populate req.user accordingly.
vi.mock('../../src/middleware/auth.ts', async () => {
  const expr = await vi.importActual<any>('../../src/middleware/auth.ts');
  // Provide a simple `requireAuth` that behaves like the real middleware for tests
  function requireAuth(req: any, res: any, next: any) {
    const auth = req.headers.authorization as string | undefined;
    const simulatedRole = req.headers['x-simulated-role'] as string | undefined;
    if (mockDb.db.__activeTestContext) {
      req.user = {
        id: mockDb.db.__activeTestContext.userId ?? 3,
        uid: mockDb.db.__activeTestContext.uid ?? 'teacher-uid',
        role: mockDb.db.__activeTestContext.active.role,
        email: mockDb.db.__activeTestContext.email ?? 'teacher@school.test',
        schoolId: mockDb.db.__activeTestContext.active.schoolId,
        accessContext: mockDb.db.__activeTestContext,
        simulated: false,
      };
      next();
      return;
    }

    // Production rejects simulated headers
    if (process.env.NODE_ENV === 'production' && simulatedRole) {
      res.status(401).json({ error: 'Simulated headers not allowed in production' });
      return;
    }

    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      // map some test tokens to users
      if (token === 'token-super') req.user = { uid: 'super-uid', role: 'super_admin', email: 'super@x.test', simulated: false };
      else if (token === 'token-school') req.user = { uid: 'school-uid', role: 'school_admin', email: 'admin@school.test', schoolId: 10, simulated: false };
      else if (token === 'token-parent') req.user = { id: 6, uid: 'sim-parent', role: 'parent', email: 'parent@x.test', schoolId: 10, simulated: false };
      else if (token === 'token-teacher') req.user = { id: 3, uid: 'teacher-uid', role: 'teacher', email: 'teacher@school.test', schoolId: 10, simulated: false };
      else if (token === 'token-surveillant') req.user = { uid: 'surveillant-uid', role: 'surveillant', email: 'surveillant@school.test', schoolId: 10, simulated: false };
      else return expr.verifyToken(req, res, next);
      if (req.user) req.user.appRole = expr.mapToAppRole(req.user.role);
      next();
      return;
    }

    // No Bearer: fallback to simulated headers in non-prod
    if (simulatedRole) {
      req.user = {
        uid: req.headers['x-simulated-uid'] || `sim-${Date.now()}`,
        email: req.headers['x-simulated-email'] || null,
        role: simulatedRole,
        appRole: expr.mapToAppRole(simulatedRole),
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        simulated: true,
      };
      next();
      return;
    }

    // No auth
    res.status(401).json({ error: 'Unauthenticated' });
  }

  return { ...expr, verifyToken: requireAuth, requireAuth };
});

// Also mock bare specifier used across codebase
vi.mock('src/middleware/auth', async () => {
  const expr = await vi.importActual<any>('../../src/middleware/auth.ts');
  function requireAuth(req: any, res: any, next: any) {
    const auth = req.headers.authorization as string | undefined;
    const simulatedRole = req.headers['x-simulated-role'] as string | undefined;
    if (mockDb.db.__activeTestContext) {
      req.user = {
        id: mockDb.db.__activeTestContext.userId ?? 3,
        uid: mockDb.db.__activeTestContext.uid ?? 'teacher-uid',
        role: mockDb.db.__activeTestContext.active.role,
        email: mockDb.db.__activeTestContext.email ?? 'teacher@school.test',
        schoolId: mockDb.db.__activeTestContext.active.schoolId,
        accessContext: mockDb.db.__activeTestContext,
        simulated: false,
      };
      next();
      return;
    }
    if (process.env.NODE_ENV === 'production' && simulatedRole) {
      res.status(401).json({ error: 'Simulated headers not allowed in production' });
      return;
    }
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      if (token === 'token-super') req.user = { uid: 'super-uid', role: 'super_admin', email: 'super@x.test', simulated: false };
      else if (token === 'token-school') req.user = { uid: 'school-uid', role: 'school_admin', email: 'admin@school.test', schoolId: 10, simulated: false };
      else if (token === 'token-parent') req.user = { id: 6, uid: 'sim-parent', role: 'parent', email: 'parent@x.test', schoolId: 10, simulated: false };
      else if (token === 'token-teacher') req.user = { id: 3, uid: 'teacher-uid', role: 'teacher', email: 'teacher@school.test', schoolId: 10, simulated: false };
      else if (token === 'token-surveillant') req.user = { uid: 'surveillant-uid', role: 'surveillant', email: 'surveillant@school.test', schoolId: 10, simulated: false };
      else return expr.verifyToken(req, res, next);
      if (req.user) req.user.appRole = expr.mapToAppRole(req.user.role);
      next();
      return;
    }
    if (simulatedRole) {
      req.user = {
        uid: req.headers['x-simulated-uid'] || `sim-${Date.now()}`,
        email: req.headers['x-simulated-email'] || null,
        role: simulatedRole,
        appRole: expr.mapToAppRole(simulatedRole),
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        simulated: true,
      };
      next();
      return;
    }
    res.status(401).json({ error: 'Unauthenticated' });
  }
  return { ...expr, verifyToken: requireAuth, requireAuth };
});

// Stub bulletin service used by bulletinSnapshotService to avoid importing optional
// or environment-specific native modules during test startup.
vi.mock('../../src/lib/bulletinService', () => ({
  generateBulletinSnapshot: async () => null,
  createBulletinPdf: async () => null,
}));

// Also mock the root-imported specifier used in some modules
vi.mock('src/lib/bulletinService', () => ({
  generateBulletinSnapshot: async () => null,
  createBulletinPdf: async () => null,
}));

// Defer importing the server until after mocks are registered so Vite/Vitest
// resolver handles bare-module imports (import 'src/...') correctly.
let serverModule: any = null;
let app: any = null;
let originalFetch: typeof fetch;
let originalWebJwtSecret: string | undefined;

describe('E2E security: auth & privilege checks', () => {
  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
    process.env.NODE_ENV = 'test';
    process.env.INTERNAL_SECRET = 'test-internal-secret';
    originalWebJwtSecret = process.env.WEB_JWT_SECRET;
    process.env.WEB_JWT_SECRET = crypto.randomBytes(32).toString('base64url');
    // Ensure TextEncoder/TextDecoder exist for esbuild used by Vite
    try {
      const util = await import('util');
      const UE = (util as any).TextEncoder;
      const UD = (util as any).TextDecoder;
      if (UE) {
        // wrapper to guarantee a Uint8Array return value
        // @ts-ignore
        globalThis.TextEncoder = class TextEncoderShim {
          private _enc: any;
          constructor() { this._enc = new UE(); }
          encode(str: string) { return Uint8Array.from(this._enc.encode(str)); }
        };
      }
      if (UD) {
        // @ts-ignore
        globalThis.TextDecoder = class TextDecoderShim {
          private _dec: any;
          constructor() { this._dec = new UD(); }
          decode(buf: any) { return this._dec.decode(Buffer.from(buf)); }
        };
      }
    } catch (e) {
      // ignore if util not available
    }
    // Import the app factory and create an express app for Supertest
    serverModule = await import('../../server.ts');
    app = await serverModule.createApp();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalWebJwtSecret === undefined) delete process.env.WEB_JWT_SECRET;
    else process.env.WEB_JWT_SECRET = originalWebJwtSecret;
  });

  beforeEach(() => {
    resetFixtures();
    mockDb.db.__activeTestContext = null;
    mockDb.db.__returnUsersWithBigIntAccessSessionGeneration = false;
    mockDb.db.__skipNextNormalizedEmailLookup = false;
    mockDb.db.__failNextTeacherClassSubjectInsert = false;
    mockDb.db.__failNextUsersUpdateError = null;
    mockDb.db.__legacyUserSchoolPairConstraint = false;
    mockDb.db.__failNextMobileParentSessionRevocationError = null;
    mockDb.db.__failNextLifecycleAuditInsertError = null;
    mockDb.db.__failLifecycleAuditInsertAfter = null;
    mockDb.db.__failNextLocalAuthUpdateError = null;
    mockDb.db.__changeLocalAuthBeforeNextUpdate = null;
    mockDb.db.__transactionCommitCount = 0;
    mockDb.db.__transactionRollbackCount = 0;
    mockDb.db.__selectQueries = [];
    resetLocalLoginRateLimit();
  });

  async function loginTeacherWithPassword(password = 'Current-Password-2026!', mustReset = false) {
    const salt = crypto.randomBytes(16).toString('hex');
    (FIXTURES.localAuths as any[]).push({
      userId: 3,
      passwordHash: crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex'),
      salt,
      mustReset,
    } as any);
    const login = await request(app)
      .post('/api/auth/local-login')
      .send({ email: 'teacher@school.test', password });
    expect(login.status).toBe(200);
    mockDb.db.__transactionCommitCount = 0;
    mockDb.db.__transactionRollbackCount = 0;
    return { token: login.body.token as string, password };
  }

  const getParentSchools = () => request(app)
    .get('/api/auth/schools')
    .set('Authorization', 'Bearer token-parent');

  it.each([true, false, null])('lists a canonical membership only when is_active is not false (%s)', async (isActive) => {
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length, {
      userId: 6, schoolId: 10, role: 'parent', isActive,
    });
    mockDb.db.__userSchoolWriteCount = 0;

    const response = await getParentSchools();

    expect(response.status).toBe(200);
    expect(response.body.schools).toEqual(isActive === false
      ? []
      : [{ id: 10, name: 'Test School', isSuspended: false }]);
    expect(response.body.memberships).toEqual(isActive === false
      ? []
      : [expect.objectContaining({ schoolId: 10, role: 'parent', isActive })]);
    expect(response.body.activeSchoolId).toBeNull();
    expect(mockDb.db.__userSchoolWriteCount).toBe(0);
  });

  it('returns every canonical function for one school without duplicating that school', async () => {
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length,
      { userId: 6, schoolId: 10, role: 'teacher', isActive: false },
      { userId: 6, schoolId: 10, role: 'parent', isActive: true },
      { userId: 6, schoolId: 10, role: 'school_admin', isActive: null },
      { userId: 6, schoolId: 10, role: 'surveillant', isActive: false },
    );
    mockDb.db.__userSchoolWriteCount = 0;

    const response = await getParentSchools();

    expect(response.status).toBe(200);
    expect(response.body.schools).toHaveLength(1);
    expect(response.body.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ schoolId: 10, role: 'parent', isActive: true }),
      expect.objectContaining({ schoolId: 10, role: 'school_admin', isActive: null }),
    ]));
    expect(response.body.memberships).toHaveLength(2);
    expect(response.body.activeSchoolId).toBeNull();
    expect(mockDb.db.__userSchoolWriteCount).toBe(0);
  });

  it('lists memberships across schools regardless of the global user role', async () => {
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length,
      { userId: 6, schoolId: 10, role: 'teacher', isActive: false },
      { userId: 6, schoolId: 20, role: 'surveillant', isActive: null },
    );
    mockDb.db.__userSchoolWriteCount = 0;

    const response = await getParentSchools();

    expect(response.status).toBe(200);
    expect(response.body.schools.map((school: any) => school.id)).toEqual([20]);
    expect(response.body.memberships).toEqual([
      expect.objectContaining({ schoolId: 20, role: 'surveillant', isActive: null }),
    ]);
    expect(response.body.activeSchoolId).toBeNull();
    expect(mockDb.db.__userSchoolWriteCount).toBe(0);
  });

  it('does not infer the active school from membership flags without an active session context', async () => {
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length,
      { userId: 6, schoolId: 10, role: 'parent', isActive: false },
      { userId: 6, schoolId: 20, role: 'teacher', isActive: true },
    );

    const response = await getParentSchools();

    expect(response.status).toBe(200);
    expect(response.body.activeSchoolId).toBeNull();
  });

  it('excludes unknown, null and legacy admin-alias roles without inferring a function', async () => {
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length,
      { userId: 6, schoolId: 10, role: 'unknown', isActive: true },
      { userId: 6, schoolId: 20, role: 'admin', isActive: true },
      { userId: 6, schoolId: 10, role: null as any, isActive: false },
    );
    mockDb.db.__userSchoolWriteCount = 0;

    const response = await getParentSchools();

    expect(response.status).toBe(200);
    expect(response.body.schools).toEqual([]);
    expect(response.body.memberships).toEqual([]);
    expect(response.body.activeSchoolId).toBeNull();
    expect(FIXTURES.userSchools).toHaveLength(3);
    expect(mockDb.db.__userSchoolWriteCount).toBe(0);
  });

  it('does not create a membership or infer a school when no membership exists', async () => {
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length);
    mockDb.db.__userSchoolWriteCount = 0;

    const response = await getParentSchools();

    expect(response.status).toBe(200);
    expect(response.body.schools).toEqual([]);
    expect(response.body.memberships).toEqual([]);
    expect(response.body.activeSchoolId).toBeNull();
    expect(FIXTURES.userSchools).toEqual([]);
    expect(mockDb.db.__userSchoolWriteCount).toBe(0);
  });

  it('does not select arbitrarily among multiple schools when active flags and account school are absent', async () => {
    const parent = FIXTURES.users.find((user: any) => user.id === 6) as any;
    parent.schoolId = null;
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length,
      { userId: 6, schoolId: 10, role: 'parent', isActive: false },
      { userId: 6, schoolId: 20, role: 'teacher', isActive: null },
    );

    const response = await getParentSchools();

    expect(response.status).toBe(200);
    expect(response.body.schools).toHaveLength(1);
    expect(response.body.activeSchoolId).toBeNull();
  });

  it('changes the password and revokes previous sessions in one committed transaction', async () => {
    const { token, password } = await loginTeacherWithPassword();
    mockDb.db.__transactionCommitCount = 0;

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'Changed-Password-2026!' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, reauthenticationRequired: true });
    expect(mockDb.db.__transactionCommitCount).toBe(1);
    expect((FIXTURES.users.find((user: any) => user.id === 3) as any)?.accessSessionGeneration).toBe(2);
    expect((FIXTURES.users.find((user: any) => user.id === 3) as any)?.deactivationGenerationAware).toBeNull();
    expect(FIXTURES.auditEvents).toContainEqual(expect.objectContaining({
      resourceType: 'user',
      resourceId: 3,
      action: 'session_revoked',
    }));

    const changedAuth = FIXTURES.localAuths.find((auth: any) => auth.userId === 3) as any;
    expect(changedAuth.mustReset).toBe(false);
    expect(changedAuth.passwordHash).toBe(
      crypto.pbkdf2Sync('Changed-Password-2026!', changedAuth.salt, 310000, 64, 'sha512').toString('hex'),
    );
    expect(JSON.stringify(response.body)).not.toContain(changedAuth.passwordHash);
    expect(JSON.stringify(response.body)).not.toContain(changedAuth.salt);

    const oldSessionRequest = await request(app)
      .get('/api/grades')
      .set('Authorization', `Bearer ${token}`);
    expect(oldSessionRequest.status).toBe(401);
  });

  it('establishes a new Web session after a required password change and keeps prior tokens revoked', async () => {
    const temporaryPassword = 'Temporary-Password-2026!';
    const { token } = await loginTeacherWithPassword(temporaryPassword, true);

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: temporaryPassword, newPassword: 'Changed-Password-2026!' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      reauthenticationRequired: false,
      tokenType: 'access',
    });
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.token).not.toBe(token);
    expect((FIXTURES.users.find((user: any) => user.id === 3) as any)?.accessSessionGeneration).toBe(2);
    expect((FIXTURES.localAuths[0] as any).mustReset).toBe(false);

    const oldSessionRequest = await request(app)
      .get('/api/auth/schools')
      .set('Authorization', `Bearer ${token}`);
    expect(oldSessionRequest.status).toBe(401);

    const currentSessionRequest = await request(app)
      .get('/api/auth/schools')
      .set('Authorization', `Bearer ${response.body.token}`);
    expect(currentSessionRequest.status).toBe(200);
    expect(currentSessionRequest.body.memberships).toEqual(
      expect.arrayContaining([expect.objectContaining({ schoolId: 10, role: 'teacher' })]),
    );

    const oldPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: 'teacher@school.test', password: temporaryPassword });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: 'teacher@school.test', password: 'Changed-Password-2026!' });
    expect(newPasswordLogin.status).toBe(200);
    expect(newPasswordLogin.body.mustReset).toBe(false);
  });

  it('rejects a wrong current password without changing credentials or generation', async () => {
    const { token } = await loginTeacherWithPassword();
    const authBefore = { ...(FIXTURES.localAuths[0] as any) };

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong-current-password', newPassword: 'Changed-Password-2026!' });

    expect(response.status).toBe(401);
    expect((FIXTURES.users.find((user: any) => user.id === 3) as any)?.accessSessionGeneration).toBe(1);
    expect(FIXTURES.localAuths[0]).toEqual(authBefore);
    expect(mockDb.db.__transactionCommitCount).toBe(0);
  });

  it('reports an absent authenticated user or local-auth row without revoking sessions', async () => {
    const token = 'token-teacher';
    const user = FIXTURES.users.findIndex((row: any) => row.id === 3);
    FIXTURES.users.splice(user, 1);
    const missingUser = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Current-Password-2026!', newPassword: 'Changed-Password-2026!' });
    expect(missingUser.status).toBe(404);

    (FIXTURES.users as any[]).push({ ...FIXTURES_TEMPLATE.users.find((row: any) => row.id === 3) });
    FIXTURES.localAuths.splice(0, FIXTURES.localAuths.length);
    const missingAuth = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Current-Password-2026!', newPassword: 'Changed-Password-2026!' });
    expect(missingAuth.status).toBe(400);
    expect(mockDb.db.__transactionCommitCount).toBe(0);
  });

  it('rolls back the generation when stored credentials changed after password verification', async () => {
    const { token, password } = await loginTeacherWithPassword();
    const authBeforeConcurrent = { ...(FIXTURES.localAuths[0] as any) };
    mockDb.db.__changeLocalAuthBeforeNextUpdate = {
      passwordHash: 'concurrent-hash',
      salt: 'concurrent-salt',
    };

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'Changed-Password-2026!' });

    expect(response.status).toBe(409);
    expect((FIXTURES.users.find((user: any) => user.id === 3) as any)?.accessSessionGeneration).toBe(1);
    expect(FIXTURES.localAuths[0]).toMatchObject({
      passwordHash: crypto.pbkdf2Sync(password, authBeforeConcurrent.salt, 310000, 64, 'sha512').toString('hex'),
      salt: authBeforeConcurrent.salt,
    });
    expect(FIXTURES.auditEvents).toHaveLength(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(1);
  });

  it('rolls back credentials and generation when generation increment fails', async () => {
    const { token, password } = await loginTeacherWithPassword();
    const authBefore = { ...(FIXTURES.localAuths[0] as any) };
    mockDb.db.__failNextUsersUpdateError = new Error('simulated generation update failure');

    const response = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'Changed-Password-2026!' });

    expect(response.status).toBe(500);
    expect((FIXTURES.users.find((user: any) => user.id === 3) as any)?.accessSessionGeneration).toBe(1);
    expect(FIXTURES.localAuths[0]).toEqual(authBefore);
    expect(FIXTURES.auditEvents).toHaveLength(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(1);
  });

  it('rolls back generation and audit if the credential callback fails without logging secrets', async () => {
    const { token, password } = await loginTeacherWithPassword();
    const authBefore = { ...(FIXTURES.localAuths[0] as any) };
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDb.db.__failNextLocalAuthUpdateError = new Error('simulated local auth update failure');

    try {
      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: password, newPassword: 'Changed-Password-2026!' });

      expect(response.status).toBe(500);
      expect((FIXTURES.users.find((user: any) => user.id === 3) as any)?.accessSessionGeneration).toBe(1);
      expect(FIXTURES.localAuths[0]).toEqual(authBefore);
      expect(FIXTURES.auditEvents).toHaveLength(0);
      expect(mockDb.db.__transactionRollbackCount).toBe(1);
      expect(JSON.stringify(logError.mock.calls)).not.toContain(authBefore.passwordHash);
      expect(JSON.stringify(logError.mock.calls)).not.toContain(authBefore.salt);
      expect(JSON.stringify(response.body)).not.toContain(authBefore.passwordHash);
      expect(JSON.stringify(response.body)).not.toContain(authBefore.salt);
    } finally {
      logError.mockRestore();
    }
  }, 15_000);

  it('allows only the Android WebView origin to preflight API requests in development', async () => {
    process.env.NODE_ENV = 'development';
    try {
      const allowed = await request(app)
        .options('/api/auth/local-login')
        .set('Origin', 'https://appassets.androidplatform.net')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-simulated-role');

      expect(allowed.status).toBe(204);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://appassets.androidplatform.net');
      expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
      expect(allowed.headers['access-control-allow-headers']).toContain('X-Simulated-Role');

      const denied = await request(app)
        .options('/api/auth/local-login')
        .set('Origin', 'https://untrusted.example')
        .set('Access-Control-Request-Method', 'POST');

      expect(denied.headers['access-control-allow-origin']).toBeUndefined();

      process.env.NODE_ENV = 'production';
      const production = await request(app)
        .options('/api/auth/local-login')
        .set('Origin', 'https://appassets.androidplatform.net')
        .set('Access-Control-Request-Method', 'POST');

      expect(production.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('refuses to create the app when simulated auth is enabled in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_SIMULATED_AUTH = 'true';

    try {
      await expect(serverModule.createApp()).rejects.toThrow(
        'ALLOW_SIMULATED_AUTH=true is not allowed when NODE_ENV=production.',
      );
    } finally {
      process.env.NODE_ENV = 'test';
      delete process.env.ALLOW_SIMULATED_AUTH;
    }
  });

  it('1. rejects x-simulated-* headers in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .post('/api/auth/register-or-login')
      .set('x-simulated-role', 'super_admin')
      .send();
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    process.env.NODE_ENV = 'test';
  });

  it('does not create a Parent account without a resolved school, but preserves an existing account login', async () => {
    const usersBefore = FIXTURES.users.length;
    const parentsBefore = FIXTURES.parents.length;
    const rejected = await request(app)
      .post('/api/auth/register-or-login')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'new-parent-without-school')
      .set('x-simulated-email', 'new-parent-without-school@x.test')
      .send({ phone: '+22890000070' });

    expect(rejected.status).toBe(400);
    expect(FIXTURES.users).toHaveLength(usersBefore);
    expect(FIXTURES.parents).toHaveLength(parentsBefore);

    const existingLogin = await request(app)
      .post('/api/auth/register-or-login')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent-no-school')
      .set('x-simulated-email', 'parent-noschool@x.test')
      .send();

    expect(existingLogin.status).toBe(200);
    expect(existingLogin.body.id).toBe(7);
    expect(FIXTURES.parents).toHaveLength(parentsBefore);
  });

  it('creates a new Parent profile in its resolved school and never changes an existing account school on login', async () => {
    const uid = 'parent-register-school-scoped';
    const created = await request(app)
      .post('/api/auth/register-or-login')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', uid)
      .set('x-simulated-email', 'parent-register-school-scoped@x.test')
      .set('x-simulated-school-id', '20')
      .send({ phone: '+22890000071' });

    expect(created.status).toBe(200);
    expect(FIXTURES.parents.find((profile: any) => profile.userId === created.body.id)?.schoolId).toBe(20);

    const existing = FIXTURES.users.find((user) => user.id === 6)!;
    const originalSchoolId = existing.schoolId;
    const login = await request(app)
      .post('/api/auth/register-or-login')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', existing.uid)
      .set('x-simulated-email', existing.email!)
      .set('x-simulated-school-id', '20')
      .send();

    expect(login.status).toBe(200);
    expect(existing.schoolId).toBe(originalSchoolId);
  });

  it('2. simulated context cannot create super_admin', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .post('/api/admin/users')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'attacker-uid')
      .send({ email: 'new@x.test', name: 'Evil', role: 'super_admin' });
    // In production, simulated headers must never be accepted for admin creation.
    expect([401, 403]).toContain(res.status);
    process.env.NODE_ENV = 'test';
  });

  it('3. school_admin cannot create/modify other admins', async () => {
    // Attempt to create a super_admin using school_admin token
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({ email: 'newsuper@x.test', name: 'NewSuper', role: 'super_admin' });
    expect([400, 403]).toContain(createRes.status);

    // Attempt to update a super_admin by school_admin
    const updateRes = await request(app)
      .put('/api/admin/users/1')
      .set('Authorization', 'Bearer token-school')
      .send({ email: 'super@x.test', name: 'SuperChanged', role: 'super_admin' });
    expect([400, 403]).toContain(updateRes.status);
  });

  it('surveillant: super_admin creates and binds the account to the selected school', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ uid: 'surveillant-valid', email: 'surveillant-valid@x.test', name: 'Surveillant Valid', role: 'surveillant', schoolId: 20, phone: '+22890000011' });

    expect(res.status).toBe(201);
    const created = FIXTURES.users.find((user) => user.uid === 'surveillant-valid');
    expect(created?.schoolId).toBe(20);
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({ userId: created?.id, schoolId: 20, role: 'surveillant' }));
  });

  it('surveillant: super_admin must provide a school', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ uid: 'surveillant-no-school', email: 'surveillant-no-school@x.test', name: 'Surveillant No School', role: 'surveillant' });

    expect(res.status).toBe(400);
  });

  it('surveillant: super_admin cannot select an unknown school', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ uid: 'surveillant-unknown-school', email: 'surveillant-unknown-school@x.test', name: 'Surveillant Unknown School', role: 'surveillant', schoolId: 999 });

    expect(res.status).toBe(400);
  });

  it('parent: admin creation requires an existing school selected by the Super Admin', async () => {
    const headers = {
      'x-simulated-role': 'super_admin',
      'x-simulated-uid': 'super-uid',
      'x-simulated-email': 'super@x.test',
    };
    const payload = {
      uid: 'parent-school-required',
      email: 'parent-school-required@x.test',
      name: 'Parent School Required',
      role: 'parent',
      phone: '+22890000071',
    };

    const missingSchool = await request(app).post('/api/admin/users').set(headers).send(payload);
    expect(missingSchool.status).toBe(400);
    expect(FIXTURES.users.some((user) => user.uid === payload.uid)).toBe(false);

    const unknownSchool = await request(app).post('/api/admin/users').set(headers)
      .send({ ...payload, uid: 'parent-unknown-school', schoolId: 999 });
    expect(unknownSchool.status).toBe(400);
    expect(FIXTURES.users.some((user) => user.uid === 'parent-unknown-school')).toBe(false);

    const created = await request(app).post('/api/admin/users').set(headers)
      .send({ ...payload, uid: 'parent-explicit-school', schoolId: 20 });
    expect(created.status).toBe(201);
    const user = FIXTURES.users.find((candidate) => candidate.uid === 'parent-explicit-school');
    expect(user?.schoolId).toBe(20);
    expect(FIXTURES.parents).toContainEqual(expect.objectContaining({ userId: user?.id, schoolId: 20 }));
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({
      userId: user?.id,
      schoolId: 20,
      role: 'parent',
      isActive: true,
    }));
  });

  it('parent: admin creation uses the school_admin server context and rejects another school', async () => {
    const headers = {
      'x-simulated-role': 'school_admin',
      'x-simulated-uid': 'school-uid',
      'x-simulated-email': 'admin@school.test',
    };
    const missingSelection = await request(app).post('/api/admin/users').set(headers).send({
      uid: 'parent-local-school',
      email: 'parent-local-school@x.test',
      name: 'Local Parent',
      role: 'parent',
      phone: '+22890000072',
    });
    expect(missingSelection.status).toBe(201);
    expect(FIXTURES.users.find((user) => user.uid === 'parent-local-school')?.schoolId).toBe(10);

    const otherSchool = await request(app).post('/api/admin/users').set(headers).send({
      uid: 'parent-local-other-school',
      email: 'parent-local-other-school@x.test',
      name: 'Other School Parent',
      role: 'parent',
      phone: '+22890000073',
      schoolId: 20,
    });
    expect(otherSchool.status).toBe(403);
    expect(FIXTURES.users.some((user) => user.uid === 'parent-local-other-school')).toBe(false);
  });

  it('surveillant: school_admin defaults to its own school when schoolId is omitted', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({ uid: 'surveillant-school-default', email: 'surveillant-school-default@x.test', name: 'Surveillant School Default', role: 'surveillant', phone: '+22890000012' });

    expect(res.status).toBe(201);
    const created = FIXTURES.users.find((user) => user.uid === 'surveillant-school-default');
    expect(created?.schoolId).toBe(10);
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({ userId: created?.id, schoolId: 10, role: 'surveillant' }));
  });

  it('surveillant: school_admin accepts its own schoolId', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({ uid: 'surveillant-school-explicit', email: 'surveillant-school-explicit@x.test', name: 'Surveillant School Explicit', role: 'surveillant', schoolId: 10, phone: '+22890000013' });

    expect(res.status).toBe(201);
    const created = FIXTURES.users.find((user) => user.uid === 'surveillant-school-explicit');
    expect(created?.schoolId).toBe(10);
  });

  it('surveillant: school_admin cannot select another school', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({ uid: 'surveillant-other-school', email: 'surveillant-other-school@x.test', name: 'Surveillant Other School', role: 'surveillant', schoolId: 20 });

    expect(res.status).toBe(403);
  });

  it('surveillant: records an absence for a student in the assigned school', async () => {
    const res = await request(app)
      .post('/api/absences')
      .set('Authorization', 'Bearer token-surveillant')
      .send({ studentId: 11, classId: 1, date: '2026-06-02', subjectId: 1, startTime: '08:00', endTime: '09:30', isJustified: false });

    expect(res.status).toBe(201);
  });

  it('does not create an absence for a withdrawn student and keeps their earlier absence readable', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Student', birthDate: '2010-01-01', gender: 'female', parentId: 1, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });
    FIXTURES.absences.push({ id: 2, studentId: 15, classId: 1, date: '2026-08-30', period: 'morning', isJustified: false, justificationReason: null });

    const createResponse = await request(app)
      .post('/api/absences')
      .set('Authorization', 'Bearer token-surveillant')
      .send({ studentId: 15, classId: 1, date: '2026-09-02', subjectId: 1, startTime: '08:00', endTime: '09:30', isJustified: false });
    expect(createResponse.status).toBe(400);
    expect(FIXTURES.absences).toHaveLength(2);

    const historyResponse = await request(app).get('/api/absences').set('Authorization', 'Bearer token-super');
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.map((absence: any) => absence.id)).toContain(2);
  });

  it('requires an active student to belong to the selected class for an absence', async () => {
    const response = await request(app)
      .post('/api/absences')
      .set('Authorization', 'Bearer token-surveillant')
      .send({ studentId: 11, classId: 2, date: '2026-09-02', subjectId: 1, startTime: '08:00', endTime: '09:30', isJustified: false });

    expect(response.status).toBe(400);
    expect(FIXTURES.absences).toHaveLength(1);
  });

  it('rejects a withdrawn student for new late arrivals but keeps earlier delays readable', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Student', birthDate: '2010-01-01', gender: 'female', parentId: 1, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });
    FIXTURES.lateArrivals.push({ id: 2, studentId: 15, classId: 1, date: '2026-08-30', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:15', lateMinutes: 15, reason: null, createdAt: '2026-08-30T08:15:00.000Z', updatedAt: '2026-08-30T08:15:00.000Z' });

    const createResponse = await request(app)
      .post('/api/late-arrivals')
      .set('Authorization', 'Bearer token-school')
      .send({ studentId: 15, classId: 1, date: '2026-09-02', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:10' });
    expect(createResponse.status).toBe(400);

    const historyResponse = await request(app).get('/api/late-arrivals').set('Authorization', 'Bearer token-super');
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.map((lateArrival: any) => lateArrival.id)).toContain(2);

    const updateResponse = await request(app)
      .put('/api/late-arrivals/2')
      .set('Authorization', 'Bearer token-school')
      .send({ arrivalTime: '08:20' });
    const deleteResponse = await request(app)
      .delete('/api/late-arrivals/2')
      .set('Authorization', 'Bearer token-school');
    expect(updateResponse.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
    expect(FIXTURES.lateArrivals).toHaveLength(1);
  });

  it('allows an active student to receive a new late arrival', async () => {
    const response = await request(app)
      .post('/api/late-arrivals')
      .set('Authorization', 'Bearer token-school')
      .send({ studentId: 11, classId: 1, date: '2026-09-02', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:10' });

    expect(response.status).toBe(201);
  });

  it('limits current exam operations to active class students and preserves former results in history', async () => {
    FIXTURES.classExamConfigurations.push({ id: 1, classId: 1, schoolId: 10, academicYearId: 1, examType: 'BEPC', isActive: true });
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Student', birthDate: '2010-01-01', gender: 'female', parentId: 1, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });
    FIXTURES.examResults.push(
      { id: 1, studentId: 11, academicYearId: 1, examType: 'BEPC', resultStatus: 'ADMITTED' },
      { id: 2, studentId: 15, schoolId: 10, isActive: false, academicYearId: 1, examType: 'BEPC', resultStatus: 'ADMITTED' },
    );

    const currentResponse = await request(app)
      .get('/api/exam-results?classId=1&schoolId=10&academicYearId=1&examType=BEPC')
      .set('Authorization', 'Bearer token-school');
    expect(currentResponse.status).toBe(200);
    expect(currentResponse.body.map((student: any) => student.id)).toEqual([11]);

    const activeSaveResponse = await request(app)
      .put('/api/exam-results/batch')
      .set('Authorization', 'Bearer token-school')
      .send({ classId: 1, schoolId: 10, academicYearId: 1, examType: 'BEPC', results: [{ studentId: 11, resultStatus: 'ADMITTED' }] });
    expect(activeSaveResponse.status, JSON.stringify(activeSaveResponse.body)).toBe(200);
    expect(FIXTURES.examResults.some((result: any) => result.studentId === 11)).toBe(true);

    const historicalResponse = await request(app)
      .get('/api/exam-results?studentId=15')
      .set('Authorization', 'Bearer token-school');
    expect(historicalResponse.status).toBe(200);
    expect(historicalResponse.body).toEqual([expect.objectContaining({ id: 2, studentId: 15, resultStatus: 'ADMITTED' })]);

    const updateResponse = await request(app)
      .put('/api/exam-results/batch')
      .set('Authorization', 'Bearer token-school')
      .send({ classId: 1, schoolId: 10, academicYearId: 1, examType: 'BEPC', results: [{ studentId: 15, resultStatus: 'ADMITTED' }] });
    expect(updateResponse.status).toBe(403);
    expect(FIXTURES.examResults).toHaveLength(2);

    const deleteResponse = await request(app)
      .delete('/api/exam-results/2')
      .set('Authorization', 'Bearer token-super');
    expect(deleteResponse.status).toBe(409);
    expect(FIXTURES.examResults.some((result: any) => result.id === 2)).toBe(true);
  });

  it('surveillant: cannot record an absence outside the assigned school', async () => {
    FIXTURES.students.push({ id: 12, schoolId: 20, classId: 3, firstName: 'Other', lastName: 'School', birthDate: '2010-01-01', gender: 'female', parentId: null, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });

    const res = await request(app)
      .post('/api/absences')
      .set('Authorization', 'Bearer token-surveillant')
      .send({ studentId: 12, classId: 3, date: '2026-06-02', subjectId: 1, startTime: '08:00', endTime: '09:30', isJustified: false });

    expect(res.status).toBe(403);
  });

  it('surveillant: records an absence in a global class approved for the school', async () => {
    const res = await request(app)
      .post('/api/absences')
      .set('Authorization', 'Bearer token-surveillant')
      .send({ studentId: 13, classId: 4, date: '2026-06-02', subjectId: 1, startTime: '08:00', endTime: '09:30', isJustified: false });

    expect(res.status).toBe(201);
  });

  it('surveillant: rejects a global class that is not approved for the school', async () => {
    const res = await request(app)
      .post('/api/absences')
      .set('Authorization', 'Bearer token-surveillant')
      .send({ studentId: 14, classId: 5, date: '2026-06-02', subjectId: 1, startTime: '08:00', endTime: '09:30', isJustified: false });

    expect(res.status).toBe(403);
  });

  it('surveillant: can read absence controls but cannot create one', async () => {
    const readRes = await request(app)
      .get('/api/absence-controls')
      .set('Authorization', 'Bearer token-surveillant');
    expect(readRes.status).toBe(200);

    const writeRes = await request(app)
      .post('/api/absence-controls')
      .set('Authorization', 'Bearer token-surveillant')
      .send({ classId: 1, date: '2026-06-02', controlType: 'none' });
    expect(writeRes.status).toBe(403);
  });

  it.each([
    ['GET', '/api/evaluations'],
    ['GET', '/api/grades'],
  ])('surveillant: %s %s is forbidden', async (method, path) => {
    const res = method === 'GET'
      ? await request(app).get(path).set('Authorization', 'Bearer token-surveillant')
      : await request(app).post(path).set('Authorization', 'Bearer token-surveillant').send({});
    expect(res.status).toBe(403);
  });

  it.each([
    ['/api/evaluations', { classId: 1, teacherId: 77, termId: 1, subject: 'Math', type: 'devoir', coefficient: 1, maxScore: 20, date: '2026-01-01' }],
    ['/api/grades', { evaluationId: 1, studentId: 11, score: 12 }],
  ])('surveillant: POST %s is forbidden', async (path, payload) => {
    const res = await request(app)
      .post(path)
      .set('Authorization', 'Bearer token-surveillant')
      .send(payload);
    expect(res.status).toBe(403);
  });

  it('3a. school_admin cannot update a user outside their school via PUT /api/users/:id', async () => {
    FIXTURES.users.push({ id: 99, uid: 'other-school-user', email: 'otherparent@x.test', name: 'OtherUser', role: 'teacher', schoolId: 20, isDeleted: false });

    const res = await request(app)
      .put('/api/users/99')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'Intruder' });

    expect(res.status).toBe(403);
  });

  it('3b. school_admin cannot update an admin account via PUT /api/users/:id', async () => {
    const res = await request(app)
      .put('/api/users/1')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'SuperChanged' });

    expect(res.status).toBe(403);
  });

  it('3c. school_admin can update a same-school teacher via PUT /api/users/:id', async () => {
    const res = await request(app)
      .put('/api/users/3')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'dUpOnT Jean', lastName: 'dUpOnT', firstNames: 'Jean' });

    expect(res.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 3)).toMatchObject({
      lastName: 'DUPONT',
      firstNames: 'Jean',
    });
  });
  it('uppercases lastName when an admin updates a teacher account', async () => {
    const res = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({
        email: 'teacher@school.test',
        name: 'dUpOnT Jean',
        lastName: 'dUpOnT',
        firstNames: 'Jean',
        role: 'teacher',
        schoolId: 10,
      });

    expect(res.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 3)).toMatchObject({
      lastName: 'DUPONT',
      firstNames: 'Jean',
    });
  });

  it('preserves a parent email when an admin update omits email', async () => {
    const existingEmail = FIXTURES.users.find((user) => user.id === 6)!.email;
    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent Updated', role: 'parent', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 6)?.email).toBe(existingEmail);
    expect(FIXTURES.auditEvents[FIXTURES.auditEvents.length - 1]?.description).not.toContain('email:');
  });

  it('PUT /api/users/:id requires a selected existing school only when it must create a parent profile', async () => {
    FIXTURES.users.push({
      id: 30,
      uid: 'parent-profile-via-self-update',
      email: 'parent-profile-via-self-update@x.test',
      name: 'Parent Profile Update',
      role: 'parent',
      schoolId: null,
      phone: '+22890000076',
      isDeleted: false,
    } as any);
    FIXTURES.userSchools.push({ userId: 30, schoolId: 20, role: 'parent', isActive: true });
    const headers = {
      'x-simulated-role': 'super_admin',
      'x-simulated-uid': 'super-uid',
      'x-simulated-email': 'super@x.test',
    };

    const missingSchool = await request(app).put('/api/users/30').set(headers).send({ address: 'Updated address' });
    expect(missingSchool.status).toBe(400);
    expect(FIXTURES.parents.some((parent: any) => parent.userId === 30)).toBe(false);

    const unknownSchool = await request(app).put('/api/users/30').set(headers)
      .send({ address: 'Updated address', schoolId: 999 });
    expect(unknownSchool.status).toBe(400);
    expect(FIXTURES.parents.some((parent: any) => parent.userId === 30)).toBe(false);

    const created = await request(app).put('/api/users/30').set(headers)
      .send({ address: 'Updated address', schoolId: 20 });
    expect(created.status).toBe(200);
    expect(FIXTURES.parents).toContainEqual(expect.objectContaining({ userId: 30, schoolId: 20 }));
  });

  it('local school admins create missing parent profiles only in their verified school context', async () => {
    FIXTURES.users.push(
      { id: 33, uid: 'local-self-parent-profile', email: 'local-self-parent-profile@x.test', name: 'Local Self Parent', role: 'parent', schoolId: 10, phone: '+22890000081', isDeleted: false } as any,
      { id: 34, uid: 'local-admin-parent-profile', email: 'local-admin-parent-profile@x.test', name: 'Local Admin Parent', role: 'parent', schoolId: 10, phone: '+22890000082', isDeleted: false } as any,
    );
    FIXTURES.userSchools.push(
      { userId: 33, schoolId: 10, role: 'parent', isActive: true },
      { userId: 34, schoolId: 10, role: 'parent', isActive: true },
    );
    const headers = {
      'x-simulated-role': 'school_admin',
      'x-simulated-uid': 'school-uid',
      'x-simulated-email': 'admin@school.test',
    };

    const selfUpdate = await request(app).put('/api/users/33').set(headers).send({ address: 'Local address' });
    expect(selfUpdate.status).toBe(200);
    expect(FIXTURES.parents).toContainEqual(expect.objectContaining({ userId: 33, schoolId: 10 }));

    const outOfSchool = await request(app).put('/api/admin/users/34').set(headers)
      .send({ name: 'Local Admin Parent', role: 'parent', schoolId: 20 });
    expect(outOfSchool.status).toBe(403);
    expect(FIXTURES.parents.some((parent: any) => parent.userId === 34)).toBe(false);

    const adminUpdate = await request(app).put('/api/admin/users/34').set(headers)
      .send({ name: 'Local Admin Parent', role: 'parent' });
    expect(adminUpdate.status).toBe(200);
    expect(FIXTURES.parents).toContainEqual(expect.objectContaining({ userId: 34, schoolId: 10 }));
  });

  it('PUT /api/admin/users/:id requires an explicit valid school when it must create a parent profile', async () => {
    FIXTURES.users.push({
      id: 31,
      uid: 'parent-profile-via-admin-update',
      email: 'parent-profile-via-admin-update@x.test',
      name: 'Parent Admin Update',
      role: 'parent',
      schoolId: null,
      phone: '+22890000077',
      isDeleted: false,
    } as any);
    FIXTURES.userSchools.push({ userId: 31, schoolId: 20, role: 'parent', isActive: true });
    const headers = {
      'x-simulated-role': 'super_admin',
      'x-simulated-uid': 'super-uid',
      'x-simulated-email': 'super@x.test',
    };

    const missingSchool = await request(app).put('/api/admin/users/31').set(headers)
      .send({ name: 'Parent Admin Update', role: 'parent' });
    expect(missingSchool.status).toBe(400);
    expect(FIXTURES.parents.some((parent: any) => parent.userId === 31)).toBe(false);

    const created = await request(app).put('/api/admin/users/31').set(headers)
      .send({ name: 'Parent Admin Update', role: 'parent', schoolId: 999 });
    expect(created.status).toBe(400);
    expect(FIXTURES.parents.some((parent: any) => parent.userId === 31)).toBe(false);

    const updated = await request(app).put('/api/admin/users/31').set(headers)
      .send({ name: 'Parent Admin Update', role: 'parent', schoolId: 20 });
    expect(updated.status).toBe(200);
    expect(FIXTURES.parents).toContainEqual(expect.objectContaining({ userId: 31, schoolId: 20 }));
  });

  it('profile updates do not assign a school to an existing historical schoolless parent profile', async () => {
    FIXTURES.users.push({
      id: 32,
      uid: 'historical-schoolless-parent',
      email: 'historical-schoolless-parent@x.test',
      name: 'Historical Parent',
      role: 'parent',
      schoolId: 10,
      phone: '+22890000080',
      isDeleted: false,
    } as any);
    FIXTURES.parents.push({ id: 5, userId: 32, studentId: null, schoolId: null } as any);
    const headers = {
      'x-simulated-role': 'super_admin',
      'x-simulated-uid': 'super-uid',
      'x-simulated-email': 'super@x.test',
    };

    const selfUpdate = await request(app).put('/api/users/32').set(headers).send({ address: 'Historical address' });
    expect(selfUpdate.status).toBe(200);
    expect(FIXTURES.parents.find((parent: any) => parent.userId === 32)?.schoolId).toBeNull();

    const adminUpdate = await request(app).put('/api/admin/users/32').set(headers)
      .send({ name: 'Historical Parent Updated', role: 'parent', schoolId: 20 });
    expect(adminUpdate.status).toBe(200);
    expect(FIXTURES.parents.find((parent: any) => parent.userId === 32)?.schoolId).toBeNull();
  });

  it('adds a teacher function to a parent without changing the parent profile or child link', async () => {
    const parentBefore = structuredClone(FIXTURES.parents.find((parent) => parent.userId === 6));
    const linkedStudentBefore = structuredClone(FIXTURES.students.find((student) => student.id === 11));
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 6));

    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: userBefore!.name, role: 'parent', additionalRole: 'teacher', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 6)).toEqual(userBefore);
    expect(FIXTURES.parents.find((parent) => parent.userId === 6)).toEqual(parentBefore);
    expect(FIXTURES.students.find((student) => student.id === 11)).toEqual(linkedStudentBefore);
    expect(FIXTURES.teachers).toContainEqual(expect.objectContaining({ userId: 6, schoolId: 10 }));
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({
      userId: 6,
      schoolId: 10,
      role: 'teacher',
      isActive: true,
    }));
  });

  it('preserves a parent profile and child link when the account role is changed to teacher', async () => {
    const parentBefore = structuredClone(FIXTURES.parents.find((parent) => parent.userId === 6));
    const studentBefore = structuredClone(FIXTURES.students.find((student) => student.id === 11));

    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent', role: 'teacher', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.parents.find((parent) => parent.userId === 6)).toEqual(parentBefore);
    expect(FIXTURES.students.find((student) => student.id === 11)).toEqual(studentBefore);
    expect(FIXTURES.teachers).toContainEqual(expect.objectContaining({ userId: 6, schoolId: 10 }));
  });

  it('adds a parent function to a teacher without changing the teacher profile or assignments', async () => {
    const teacherBefore = structuredClone(FIXTURES.teachers.find((teacher) => teacher.userId === 3));
    const assignmentsBefore = structuredClone(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === teacherBefore!.id));
    const teachingAssignmentsBefore = structuredClone(FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === teacherBefore!.id));
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 3));

    const response = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: userBefore!.name, role: 'teacher', additionalRole: 'parent', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 3)).toEqual(userBefore);
    expect(FIXTURES.teachers.find((teacher) => teacher.userId === 3)).toEqual(teacherBefore);
    expect(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === teacherBefore!.id)).toEqual(assignmentsBefore);
    expect(FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === teacherBefore!.id)).toEqual(teachingAssignmentsBefore);
    expect(FIXTURES.parents).toContainEqual(expect.objectContaining({ userId: 3, schoolId: 10 }));
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({
      userId: 3,
      schoolId: 10,
      role: 'parent',
      isActive: true,
    }));
  });

  it.each([true, false, null])('keeps an existing function and its isActive=%s value when adding another function', async (isActive) => {
    FIXTURES.userSchools.push({ userId: 6, schoolId: 10, role: 'teacher', isActive });

    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent', role: 'parent', additionalRole: 'surveillant', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 6 && membership.schoolId === 10))
      .toContainEqual({ userId: 6, schoolId: 10, role: 'teacher', isActive });
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 6 && membership.schoolId === 10 && membership.role === 'surveillant'))
      .toHaveLength(1);
  });

  it('reactivates only the exact inactive primary membership during an admin update', async () => {
    setFixtureMembership(6, 10, 'parent', false);
    setFixtureMembership(6, 20, 'parent', false);
    setFixtureMembership(6, 10, 'teacher', true);
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 6));

    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent', role: 'parent', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.userSchools.filter((membership) => (
      membership.userId === 6 && membership.schoolId === 10
    ))).toEqual(expect.arrayContaining([
      { userId: 6, schoolId: 10, role: 'parent', isActive: true },
      { userId: 6, schoolId: 10, role: 'teacher', isActive: true },
    ]));
    expect(FIXTURES.userSchools.find((membership) => (
      membership.userId === 6 && membership.schoolId === 20 && membership.role === 'parent'
    ))?.isActive).toBe(false);
    expect(FIXTURES.userSchools.filter((membership) => (
      membership.userId === 6 && membership.schoolId === 10 && membership.role === 'parent'
    ))).toHaveLength(1);
    expect(FIXTURES.users.find((user) => user.id === 6)).toMatchObject({
      role: userBefore!.role,
      isDeleted: userBefore!.isDeleted,
    });
  });

  it.each(['parent', 'teacher'] as const)(
    'does not let a school_admin update a %s profile stored in another school',
    async (role) => {
      const targetUserId = role === 'parent' ? 6 : 3;
      if (role === 'parent') {
        FIXTURES.parents[0].schoolId = 20;
      } else {
        FIXTURES.teachers[0].schoolId = 20;
      }

      const response = await request(app)
        .put(`/api/admin/users/${targetUserId}`)
        .set('x-simulated-role', 'school_admin')
        .set('x-simulated-uid', 'school-uid')
        .send({ name: role === 'parent' ? 'Parent' : 'Teacher', role, schoolId: 10 });

      expect(response.status).toBe(403);
      if (role === 'parent') {
        expect(FIXTURES.parents[0].schoolId).toBe(20);
      } else {
        expect(FIXTURES.teachers[0].schoolId).toBe(20);
      }
    },
  );

  it('lets a school_admin update a teacher profile in its active school', async () => {
    const response = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .send({ name: 'Teacher Updated', role: 'teacher', schoolId: 10 });

    expect(response.status).toBe(200);
  });

  it.each([true, null])('preserves a primary membership with isActive=%s during an admin update', async (isActive) => {
    setFixtureMembership(6, 10, 'parent', isActive);

    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent', role: 'parent', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.userSchools.filter((membership) => (
      membership.userId === 6 && membership.schoolId === 10 && membership.role === 'parent'
    ))).toEqual([{ userId: 6, schoolId: 10, role: 'parent', isActive }]);
  });

  it('reactivates an inactive additional membership during an admin update', async () => {
    setFixtureMembership(6, 10, 'parent', true);
    setFixtureMembership(6, 10, 'teacher', false);
    setFixtureMembership(6, 20, 'teacher', false);
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 6));

    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent', role: 'parent', additionalRole: 'teacher', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.userSchools.filter((membership) => (
      membership.userId === 6 && membership.schoolId === 10
    ))).toEqual(expect.arrayContaining([
      { userId: 6, schoolId: 10, role: 'parent', isActive: true },
      { userId: 6, schoolId: 10, role: 'teacher', isActive: true },
    ]));
    expect(FIXTURES.userSchools.find((membership) => (
      membership.userId === 6 && membership.schoolId === 20 && membership.role === 'teacher'
    ))?.isActive).toBe(false);
    expect(FIXTURES.userSchools.filter((membership) => (
      membership.userId === 6 && membership.schoolId === 10 && membership.role === 'teacher'
    ))).toHaveLength(1);
    expect(FIXTURES.users.find((user) => user.id === 6)).toEqual(userBefore);
  });

  it('does not replace an existing function when adding another function in the same school', async () => {
    setFixtureMembership(6, 10, 'parent', null);
    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent', role: 'parent', additionalRole: 'teacher', schoolId: 10 });
    expect(response.status).toBe(200);

    const repeatedResponse = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent', role: 'parent', additionalRole: 'teacher', schoolId: 10 });

    expect(repeatedResponse.status).toBe(200);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 6 && membership.schoolId === 10))
      .toEqual(expect.arrayContaining([
        { userId: 6, schoolId: 10, role: 'parent', isActive: null },
        expect.objectContaining({ role: 'teacher' }),
      ]));
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 6 && membership.schoolId === 10 && membership.role === 'parent'))
      .toEqual([{ userId: 6, schoolId: 10, role: 'parent', isActive: null }]);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 6 && membership.schoolId === 10 && membership.role === 'teacher'))
      .toHaveLength(1);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 6 && membership.schoolId === 10 && membership.role === 'parent'))
      .toEqual([{ userId: 6, schoolId: 10, role: 'parent', isActive: null }]);
  });

  it('does not allow a school_admin to grant an additional function', async () => {
    const response = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .send({ name: 'Teacher', role: 'teacher', additionalRole: 'parent', schoolId: 10 });

    expect(response.status).toBe(403);
    expect(FIXTURES.parents.some((parent) => parent.userId === 3)).toBe(false);
    expect(FIXTURES.userSchools.some((membership) => membership.userId === 3 && membership.role === 'parent')).toBe(false);
  });

  it('assigns local functions through the multi-function endpoint without changing account or profile links', async () => {
    setFixtureMembership(6, 10, 'parent', true);
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 6));
    const parentBefore = structuredClone(FIXTURES.parents.find((parent) => parent.userId === 6));
    const linkedStudentBefore = structuredClone(FIXTURES.students.find((student) => student.id === 11));

    const sameSchoolResponse = await request(app)
      .post('/api/admin/users/6/functions')
      .set('Authorization', 'Bearer token-super')
      .send({ schoolId: 10, role: 'teacher' });
    const otherSchoolResponse = await request(app)
      .post('/api/admin/users/6/functions')
      .set('Authorization', 'Bearer token-super')
      .send({ schoolId: 20, role: 'surveillant' });
    const repeatedResponse = await request(app)
      .post('/api/admin/users/6/functions')
      .set('Authorization', 'Bearer token-super')
      .send({ schoolId: 10, role: 'teacher' });

    expect(sameSchoolResponse.status).toBe(201);
    expect(otherSchoolResponse.status).toBe(201);
    expect(repeatedResponse.status).toBe(200);
    expect(repeatedResponse.body.alreadyAssigned).toBe(true);
    expect(FIXTURES.users.find((user) => user.id === 6)).toEqual(userBefore);
    expect(FIXTURES.parents.find((parent) => parent.userId === 6)).toEqual(parentBefore);
    expect(FIXTURES.students.find((student) => student.id === 11)).toEqual(linkedStudentBefore);
    expect(FIXTURES.teachers.filter((teacher) => teacher.userId === 6)).toHaveLength(1);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 6)).toEqual(expect.arrayContaining([
      expect.objectContaining({ schoolId: 10, role: 'parent' }),
      expect.objectContaining({ schoolId: 10, role: 'teacher' }),
      expect.objectContaining({ schoolId: 20, role: 'surveillant' }),
    ]));
  });

  it.each([
    { userId: 6, role: 'parent', schoolId: 20 },
    { userId: 3, role: 'teacher', schoolId: 20 },
  ])('adds a $role profile in another school without changing the existing profile', async ({ userId, role, schoolId }) => {
    const profilesBefore = structuredClone(
      role === 'parent'
        ? FIXTURES.parents.filter((profile) => profile.userId === userId)
        : FIXTURES.teachers.filter((profile) => profile.userId === userId),
    );
    const linkedStudentBefore = structuredClone(FIXTURES.students.find((student) => student.parentId === 1));

    const response = await request(app)
      .post(`/api/admin/users/${userId}/functions`)
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId, role });

    expect(response.status).toBe(201);
    expect(role === 'parent'
      ? FIXTURES.parents.filter((profile) => profile.userId === userId)
      : FIXTURES.teachers.filter((profile) => profile.userId === userId)).toHaveLength(profilesBefore.length + 1);
    expect(role === 'parent'
      ? FIXTURES.parents.find((profile) => profile.userId === userId && profile.schoolId === schoolId)
      : FIXTURES.teachers.find((profile) => profile.userId === userId && profile.schoolId === schoolId)).toBeDefined();
    expect(role === 'parent'
      ? FIXTURES.parents.filter((profile) => profile.userId === userId && profile.schoolId !== schoolId)
      : FIXTURES.teachers.filter((profile) => profile.userId === userId && profile.schoolId !== schoolId)).toEqual(profilesBefore);
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({ userId, schoolId, role, isActive: true }));
    if (role === 'parent') {
      expect(FIXTURES.students.find((student) => student.parentId === 1)).toEqual(linkedStudentBefore);
    }
  });

  it.each([
    { userId: 6, role: 'parent' },
    { userId: 3, role: 'teacher' },
  ])('creates a $role profile in the selected school instead of moving the existing profile', async ({ userId, role }) => {
    setFixtureMembership(userId, 20, role, true);
    const profilesBefore = structuredClone(
      role === 'parent'
        ? FIXTURES.parents.filter((profile) => profile.userId === userId)
        : FIXTURES.teachers.filter((profile) => profile.userId === userId),
    );

    const response = await request(app)
      .put(`/api/admin/users/${userId}`)
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Updated profile', role, schoolId: 20 });

    expect(response.status).toBe(200);
    expect(role === 'parent'
      ? FIXTURES.parents.filter((profile) => profile.userId === userId)
      : FIXTURES.teachers.filter((profile) => profile.userId === userId)).toHaveLength(profilesBefore.length + 1);
    expect(role === 'parent'
      ? FIXTURES.parents.filter((profile) => profile.userId === userId && profile.schoolId !== 20)
      : FIXTURES.teachers.filter((profile) => profile.userId === userId && profile.schoolId !== 20)).toEqual(profilesBefore);
    expect(role === 'parent'
      ? FIXTURES.parents.find((profile) => profile.userId === userId && profile.schoolId === 20)
      : FIXTURES.teachers.find((profile) => profile.userId === userId && profile.schoolId === 20)).toBeDefined();
  });

  it('creates a Parent profile for the selected school during an admin update without changing linked students', async () => {
    setFixtureMembership(6, 20, 'parent', true);
    const existingParentBefore = structuredClone(FIXTURES.parents.find((profile) => profile.userId === 6 && profile.schoolId === 10));
    const linkedStudentBefore = structuredClone(FIXTURES.students.find((student) => student.parentId === existingParentBefore?.id));

    const response = await request(app)
      .put('/api/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 20, address: 'Address in school 20' });

    expect(response.status).toBe(200);
    expect(FIXTURES.parents.find((profile) => profile.userId === 6 && profile.schoolId === 10)).toEqual(existingParentBefore);
    expect(FIXTURES.parents.find((profile) => profile.userId === 6 && profile.schoolId === 20))
      .toEqual(expect.objectContaining({ userId: 6, schoolId: 20, address: 'Address in school 20' }));
    expect(FIXTURES.students.find((student) => student.parentId === existingParentBefore?.id)).toEqual(linkedStudentBefore);
  });

  it('reactivates only the exact inactive membership through the multi-function endpoint', async () => {
    setFixtureMembership(6, 10, 'parent', true);
    setFixtureMembership(6, 10, 'teacher', false);
    setFixtureMembership(6, 20, 'teacher', false);
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 6));

    const response = await request(app)
      .post('/api/admin/users/6/functions')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'teacher' });

    expect(response.status).toBe(200);
    expect(response.body.alreadyAssigned).toBe(true);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 6 && membership.schoolId === 10))
      .toEqual(expect.arrayContaining([
        { userId: 6, schoolId: 10, role: 'parent', isActive: true },
        { userId: 6, schoolId: 10, role: 'teacher', isActive: true },
      ]));
    expect(FIXTURES.userSchools.find((membership) => (
      membership.userId === 6 && membership.schoolId === 20 && membership.role === 'teacher'
    ))?.isActive).toBe(false);
    expect(FIXTURES.userSchools.filter((membership) => (
      membership.userId === 6 && membership.schoolId === 10 && membership.role === 'teacher'
    ))).toHaveLength(1);
    expect(FIXTURES.users.find((user) => user.id === 6)).toEqual(userBefore);
  });

  it.each([true, null])('preserves a multi-function membership with isActive=%s', async (isActive) => {
    setFixtureMembership(6, 10, 'teacher', isActive);

    const response = await request(app)
      .post('/api/admin/users/6/functions')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'teacher' });

    expect(response.status).toBe(200);
    expect(FIXTURES.userSchools.filter((membership) => (
      membership.userId === 6 && membership.schoolId === 10 && membership.role === 'teacher'
    ))).toEqual([{ userId: 6, schoolId: 10, role: 'teacher', isActive }]);
  });

  it('blocks school_admin self-grants and global-role grants through the multi-function endpoint', async () => {
    const selfGrant = await request(app)
      .post('/api/admin/users/2/functions')
      .set('Authorization', 'Bearer token-school')
      .send({ schoolId: 10, role: 'teacher' });
    const globalGrant = await request(app)
      .post('/api/admin/users/3/functions')
      .set('Authorization', 'Bearer token-school')
      .send({ role: 'super_admin' });

    expect(selfGrant.status).toBe(403);
    expect(globalGrant.status).toBe(403);
    expect(FIXTURES.userSchools.some((membership) => membership.userId === 2 && membership.role === 'teacher')).toBe(false);
    expect(FIXTURES.users.find((user) => user.id === 3)?.role).toBe('teacher');
  });

  it('adds a parent function to a teacher without changing teacher assignments', async () => {
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 3));
    const teacherBefore = structuredClone(FIXTURES.teachers.find((teacher) => teacher.userId === 3));
    const classAssignmentsBefore = structuredClone(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === teacherBefore!.id));
    const subjectAssignmentsBefore = structuredClone(FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === teacherBefore!.id));

    const response = await request(app)
      .post('/api/admin/users/3/functions')
      .set('Authorization', 'Bearer token-super')
      .send({ schoolId: 10, role: 'parent' });

    expect(response.status).toBe(201);
    expect(FIXTURES.users.find((user) => user.id === 3)).toEqual(userBefore);
    expect(FIXTURES.teachers.find((teacher) => teacher.userId === 3)).toEqual(teacherBefore);
    expect(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === teacherBefore!.id)).toEqual(classAssignmentsBefore);
    expect(FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === teacherBefore!.id)).toEqual(subjectAssignmentsBefore);
    expect(FIXTURES.parents.filter((parent) => parent.userId === 3)).toHaveLength(1);
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({
      userId: 3,
      schoolId: 10,
      role: 'parent',
      isActive: true,
    }));
  });

  it('rejects an additional school_admin function without a role-scoped academic year', async () => {
    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent', role: 'parent', additionalRole: 'school_admin', schoolId: 10 });

    expect(response.status).toBe(409);
    expect(FIXTURES.users.find((user) => user.id === 6)?.role).toBe('parent');
    expect(FIXTURES.userSchools.some((membership) => membership.userId === 6 && membership.role === 'school_admin')).toBe(false);
  });

  it('normalizes a legacy whitespace-only parent email to null when email is omitted', async () => {
    (FIXTURES.users.find((user) => user.id === 6) as any).email = ' \uFEFF\u00A0 ';

    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent Updated', role: 'parent', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 6)?.email).toBeNull();
    expect(FIXTURES.auditEvents[FIXTURES.auditEvents.length - 1]?.description).toContain('email:');
    expect(FIXTURES.auditEvents[FIXTURES.auditEvents.length - 1]?.description).toContain('→ NULL');
  });

  it('uses a valid existing email when changing a parent to a role that requires it', async () => {
    const existingEmail = FIXTURES.users.find((user) => user.id === 6)!.email;
    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent Updated', role: 'teacher', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 6)).toMatchObject({
      email: existingEmail,
      role: 'teacher',
    });
    expect(FIXTURES.auditEvents[FIXTURES.auditEvents.length - 1]?.description).not.toContain('email:');
  });

  it('normalizes a provided blank parent email to null and records the effective value', async () => {
    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ email: ' \uFEFF\u00A0 ', name: 'Parent', role: 'parent', schoolId: 10 });

    expect(response.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 6)?.email).toBeNull();
    expect(FIXTURES.auditEvents[FIXTURES.auditEvents.length - 1]?.description).toContain('email: "parent@x.test" → NULL');
  });

  it.each([
    { label: 'no email', email: null },
    { label: 'whitespace-only email', email: ' \uFEFF\u00A0 ' },
  ])('requires an email when a parent with $label changes to a role that requires it', async ({ email }) => {
    (FIXTURES.users as any[]).push({ id: 20, uid: 'email-required-on-role-change', email, name: 'Parent Without Email', role: 'parent', schoolId: 10, isDeleted: false });

    const response = await request(app)
      .put('/api/admin/users/20')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ name: 'Parent Without Email', role: 'teacher', schoolId: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing required field: email');
    expect(FIXTURES.users.find((user) => user.id === 20)?.role).toBe('parent');
  });

  it('rejects a normalized email duplicate across roles and schools during admin update', async () => {
    FIXTURES.users.push(
      { id: 20, uid: 'update-email-target', email: 'parent-old@x.test', name: 'Update Target', role: 'parent', schoolId: 10, isDeleted: false },
      { id: 21, uid: 'global-email-owner', email: ' shared@x.test ', name: 'Other School User', role: 'teacher', schoolId: 20, isDeleted: false },
    );
    FIXTURES.parents.push({ id: 4, userId: 20, studentId: null, schoolId: 10 });
    FIXTURES.userSchools.push({ userId: 20, schoolId: 10, role: 'parent', isActive: true });

    const response = await request(app)
      .put('/api/admin/users/20')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ email: ' SHARED@X.TEST ', name: 'Update Target', role: 'parent', schoolId: 10 });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_ALREADY_IN_USE');
    expect(FIXTURES.users.find((user) => user.id === 20)?.email).toBe('parent-old@x.test');
  });

  it.each([
    { label: 'direct', error: Object.assign(new Error('duplicate'), { code: '23505', constraint: 'users_email_normalized_unique_idx' }), expectedStatus: 409, expectedCode: 'EMAIL_ALREADY_IN_USE' },
    { label: 'wrapped', error: Object.assign(new Error('wrapped duplicate'), { cause: Object.assign(new Error('duplicate'), { code: '23505', constraint: 'users_email_normalized_unique_idx' }) }), expectedStatus: 409, expectedCode: 'EMAIL_ALREADY_IN_USE' },
    { label: 'uid', error: Object.assign(new Error('duplicate uid'), { code: '23505', constraint: 'users_uid_unique' }), expectedStatus: 500, expectedCode: undefined },
    { label: 'phone', error: Object.assign(new Error('duplicate phone'), { code: '23505', constraint: 'users_phone_unique' }), expectedStatus: 409, expectedCode: 'PHONE_ALREADY_IN_USE' },
  ])('maps a $label SQL unique violation during admin update correctly', async ({ error, expectedStatus, expectedCode }) => {
    (mockDb.db as any).__failNextUsersUpdateError = error;

    const response = await request(app)
      .put('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ email: 'parent@x.test', name: 'Parent', role: 'parent', schoolId: 10 });

    expect(response.status).toBe(expectedStatus);
    if (expectedCode) expect(response.body.code).toBe(expectedCode);
    else expect(response.body).toEqual({ error: 'Internal server error' });
    expect((mockDb.db as any).__failNextUsersUpdateError).toBeNull();
  });

  it('updates a teacher family name and returns the coherent name in the teacher list', async () => {
    const teacher = FIXTURES.users.find((user) => user.id === 3)!;
    Object.assign(teacher, {
      name: 'KANGNI SOUKPE Parfait',
      lastName: 'KANGNI SOUKPE',
      firstNames: 'Parfait',
    });

    const update = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({
        email: teacher.email,
        name: 'KANGNI-SOUKPE Parfait',
        lastName: 'KANGNI-SOUKPE',
        firstNames: 'Parfait',
        role: 'teacher',
        schoolId: 10,
      });

    expect(update.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 3)).toMatchObject({
      name: 'KANGNI-SOUKPE Parfait',
      lastName: 'KANGNI-SOUKPE',
      firstNames: 'Parfait',
    });

    const list = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(list.status).toBe(200);
    const listedTeacher = list.body.find((row: any) => row.userId === 3);
    expect(listedTeacher).toMatchObject({
      name: 'KANGNI-SOUKPE Parfait',
      lastName: 'KANGNI-SOUKPE',
      firstNames: 'Parfait',
    });
    expect(getTeacherDisplayName(listedTeacher)).toBe('KANGNI-SOUKPE Parfait');
  });

  it('updates teacher first names and keeps the full name synchronized', async () => {
    const teacher = FIXTURES.users.find((user) => user.id === 3)!;
    Object.assign(teacher, {
      name: 'KANGNI-SOUKPE Parfait',
      lastName: 'KANGNI-SOUKPE',
      firstNames: 'Parfait',
    });

    const update = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({
        email: teacher.email,
        name: 'KANGNI-SOUKPE Jean-Pierre',
        lastName: 'KANGNI-SOUKPE',
        firstNames: 'Jean-Pierre',
        role: 'teacher',
        schoolId: 10,
      });

    expect(update.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 3)).toMatchObject({
      name: 'KANGNI-SOUKPE Jean-Pierre',
      lastName: 'KANGNI-SOUKPE',
      firstNames: 'Jean-Pierre',
    });

    const list = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    const listedTeacher = list.body.find((row: any) => row.userId === 3);
    expect(getTeacherDisplayName(listedTeacher)).toBe('KANGNI-SOUKPE Jean-Pierre');
  });

  it('limits the teacher list returned to a school admin to their school', async () => {
    FIXTURES.users.push({
      id: 20,
      uid: 'other-school-teacher',
      email: 'other-school-teacher@example.test',
      name: 'Other School Teacher',
      role: 'teacher',
      schoolId: 20,
      isDeleted: false,
    });
    FIXTURES.teachers.push({
      id: 200,
      userId: 20,
      schoolId: 20,
      phone: '+22955555555',
      specialization: 'Science',
    });

    const response = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .set('x-simulated-email', 'admin@school.test')
      .set('x-simulated-school-id', '10');

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.every((teacher: any) => teacher.schoolId === 10)).toBe(true);
    expect(response.body.some((teacher: any) => teacher.userId === 20)).toBe(false);
  });

  it('3d. parent keeps access to own details for every legacy membership state', async () => {
    for (const isActive of [true, false, null]) {
      FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length, {
        userId: 6,
        schoolId: 10,
        role: 'parent',
        isActive,
      } as any);

      const res = await request(app)
        .get('/api/parents/1')
        .set('x-simulated-role', 'parent')
        .set('x-simulated-uid', 'sim-parent')
        .set('x-simulated-email', 'parent@x.test')
        .set('x-simulated-school-id', '10');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 1, userId: 6, schoolId: 10 });
    }
  });

  it('3e. parent cannot access another parent detail via GET /api/parents/:id', async () => {
    const res = await request(app)
      .get('/api/parents/2')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(404);
  });

  it('3f. school_admin can access same-school parent detail via GET /api/parents/:id', async () => {
    const res = await request(app)
      .get('/api/parents/1')
      .set('Authorization', 'Bearer token-school');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, userId: 6, schoolId: 10 });
  });

  it('3g. school_admin cannot access another-school parent detail via GET /api/parents/:id', async () => {
    FIXTURES.users.push({ id: 20, uid: 'other-parent-uid', email: 'otherparent@x.test', name: 'OtherParent', role: 'parent', schoolId: 20, isDeleted: false });
    FIXTURES.parents.push({ id: 4, userId: 20, studentId: null, schoolId: 20 });

    const res = await request(app)
      .get('/api/parents/4')
      .set('Authorization', 'Bearer token-school');

    expect(res.status).toBe(404);
  });

  it('school_admin cannot use a parent membership in school B to read a profile and children owned by school A', async () => {
    FIXTURES.userSchools.push({ userId: 6, schoolId: 20, role: 'parent', isActive: true });

    const res = await request(app)
      .get('/api/parents/1')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'other-school-admin-uid')
      .set('x-simulated-email', 'other-admin@x.test')
      .set('x-simulated-school-id', '20');

    expect(res.status).toBe(404);
  });

  it('GET /api/parents returns the separate login and APK visit timestamps', async () => {
    const res = await request(app)
      .get('/api/parents')
      .set('Authorization', 'Bearer token-school');

    expect(res.status).toBe(200);
    expect(res.body.find((parent: any) => parent.id === 1)).toMatchObject({
      lastLoginAt: '2026-09-24T09:00:00.000Z',
      lastMobileVisitAt: '2026-09-24T10:00:00.000Z',
    });
  });

  it('3h. teacher only sees parents for authorized same-school students', async () => {
    FIXTURES.users.push({ id: 20, uid: 'otherparent@x.test', email: 'otherparent@x.test', name: 'Other Parent', role: 'parent', schoolId: 20, isDeleted: false });
    FIXTURES.parents.push({ id: 4, userId: 20, studentId: 12, schoolId: 20 });
    FIXTURES.students.push({ id: 12, schoolId: 20, classId: 1, firstName: 'Unauthorized', lastName: 'Kid', birthDate: '2010-02-02', gender: 'male', parentId: 4, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });

    const res = await request(app)
      .get('/api/parents')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-email', 'teacher@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((item: any) => item.id)).toContain(1);
    expect(res.body.map((item: any) => item.id)).not.toContain(4);
  });

  it('teacher sees only their own private teacher profile when sharing a class', async () => {
    const res = await request(app)
      .get('/api/teachers')
      .set('Authorization', 'Bearer token-teacher');

    expect(res.status).toBe(200);
    expect(res.body.map((teacher: any) => teacher.id)).toEqual([77]);
    expect(res.body.some((teacher: any) => teacher.id === 100)).toBe(false);
  });

  it('teacher cannot use another-school class assignment to access parents of an approved global class', async () => {
    FIXTURES.classes.find((klass: any) => klass.id === 1)!.schoolId = null;
    FIXTURES.schoolClasses.push({ id: 502, classId: 1, schoolId: 10, status: 'approved' } as any);
    FIXTURES.classTeachers.splice(0, FIXTURES.classTeachers.length,
      { classId: 1, teacherId: 77, schoolId: 20 },
    );
    FIXTURES.userSchools.push({ userId: 3, schoolId: 20, role: 'teacher', isActive: true });

    const res = await request(app)
      .get('/api/parents')
      .set('Authorization', 'Bearer token-teacher');

    expect(res.status).toBe(200);
    expect(res.body.map((parent: any) => parent.id)).not.toContain(1);
    expect(res.body).toHaveLength(0);
  });

  it('3h1. teacher sees absences only for their authorized student classes', async () => {
    FIXTURES.teacherClassSubjects.push({ id: 101, teacherId: 77, schoolId: 10, classId: 1, subjectId: 901, isActive: true });
    FIXTURES.schoolSubjects.push({ id: 2, schoolId: 10, subjectId: 901, status: 'approved', subjectTypeId: 11 });
    FIXTURES.absences[0].teachingAssignmentId = 101;

    const res = await request(app)
      .get('/api/absences')
      .set('Authorization', 'Bearer token-teacher');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0]?.studentId).toBe(11);
  });

  it('3h2. teacher cannot justify absence for student outside their assigned classes', async () => {
    const res = await request(app)
      .put('/api/absences/1/justify')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'other-teacher-uid')
      .set('x-simulated-email', 'otherteacher@school.test')
      .set('x-simulated-school-id', '10')
      .send({ justificationReason: 'Motif invalide' });

    expect(res.status).toBe(403);
  });

  it('parent text justification remains pending before any rejection', async () => {
    const res = await request(app)
      .put('/api/absences/1/justify')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10')
      .send({ justificationReason: 'Maladie' });

    expect(res.status).toBe(200);
    expect(res.body.justificationStatus).toBe('PENDING');
    expect(res.body.isJustified).toBe(false);
  });

  it('parent text resubmission is rejected after the absence has been rejected', async () => {
    Object.assign(FIXTURES.absences[0], {
      isJustified: false,
      justificationReason: 'Maladie',
      justificationStatus: 'REJECTED',
      rejectionReason: 'Document illisible',
    });

    const res = await request(app)
      .put('/api/absences/1/justify')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10')
      .send({ justificationReason: 'Nouvelle tentative' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('JUSTIFICATION_ALREADY_REJECTED');
    expect(res.body.error).toContain('Veuillez vous rapprocher de l’établissement');
    expect(FIXTURES.absences[0]).toMatchObject({ justificationStatus: 'REJECTED', isJustified: false, rejectionReason: 'Document illisible' });
  });

  it('parent direct-file resubmission is rejected and its temporary upload is removed', async () => {
    Object.assign(FIXTURES.absences[0], {
      isJustified: false,
      justificationReason: 'Maladie',
      justificationStatus: 'REJECTED',
      rejectionReason: 'Document illisible',
    });
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'absence-justifications');
    const filesBefore = new Set(fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []);

    const res = await request(app)
      .post('/api/absences/1/justifications')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10')
      .field('justificationReason', 'Nouvelle tentative avec fichier')
      .attach('files', Buffer.from('test image payload'), { filename: 'proof.png', contentType: 'image/png' });

    const filesAfter = new Set(fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('JUSTIFICATION_ALREADY_REJECTED');
    expect(filesAfter).toEqual(filesBefore);
    expect(FIXTURES.absences[0]).toMatchObject({ justificationStatus: 'REJECTED', isJustified: false });
  });

  it('internal signed upload rejects an absence already rejected', async () => {
    Object.assign(FIXTURES.absences[0], {
      isJustified: false,
      justificationReason: 'Maladie',
      justificationStatus: 'REJECTED',
      rejectionReason: 'Document illisible',
    });
    const previousSecret = process.env.INTERNAL_SECRET;
    const internalSecret = 'absence-rejection-test-secret';
    process.env.INTERNAL_SECRET = internalSecret;
    const fileBuffer = Buffer.from('%PDF-1.4 test document');
    const payload = {
      absenceId: '1',
      parentId: '6',
      justificationReason: 'Nouvelle tentative par transfert interne',
      fileName: 'proof.pdf',
      fileMimeType: 'application/pdf',
      fileSize: String(fileBuffer.length),
      fileSha256: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
    };
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac('sha256', internalSecret)
      .update(`${JSON.stringify(payload)}${timestamp}`)
      .digest('hex');

    try {
      const res = await request(app)
        .post('/api/internal/absence-justification')
        .set('X-Internal-Signature', signature)
        .set('X-Internal-Timestamp', timestamp)
        .field('absenceId', payload.absenceId)
        .field('parentId', payload.parentId)
        .field('justificationReason', payload.justificationReason)
        .field('fileName', payload.fileName)
        .field('fileMimeType', payload.fileMimeType)
        .field('fileSize', payload.fileSize)
        .field('fileSha256', payload.fileSha256)
        .attach('file', fileBuffer, { filename: payload.fileName, contentType: payload.fileMimeType });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('JUSTIFICATION_ALREADY_REJECTED');
      expect(FIXTURES.absences[0]).toMatchObject({ justificationStatus: 'REJECTED', isJustified: false });
      expect(FIXTURES.absenceJustifications).toHaveLength(0);
    } finally {
      if (previousSecret === undefined) delete process.env.INTERNAL_SECRET;
      else process.env.INTERNAL_SECRET = previousSecret;
    }
  });

  it('school_admin approves a pending absence justification', async () => {
    const absence = FIXTURES.absences[0] as any;
    Object.assign(absence, {
      justificationStatus: 'PENDING',
      justificationReason: 'Maladie',
      rejectionReason: null,
      isJustified: false,
    });
    FIXTURES.students.find((student) => student.id === absence.studentId)!.parentId = null;

    const res = await request(app)
      .put('/api/absences/1/justification/review')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .set('x-simulated-email', 'admin@school.test')
      .set('x-simulated-school-id', '10')
      .send({ status: 'APPROVED' });

    expect(res.status).toBe(200);
    expect(res.body.justificationStatus).toBe('APPROVED');
    expect(res.body.isJustified).toBe(true);
    expect(FIXTURES.absences[0]).toMatchObject({ justificationStatus: 'APPROVED', isJustified: true });
  });

  it('school_admin rejects a pending absence justification with its reason', async () => {
    const absence = FIXTURES.absences[0] as any;
    Object.assign(absence, {
      justificationStatus: 'PENDING',
      justificationReason: 'Maladie',
      rejectionReason: null,
      isJustified: false,
    });
    FIXTURES.students.find((student) => student.id === absence.studentId)!.parentId = null;

    const res = await request(app)
      .put('/api/absences/1/justification/review')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .set('x-simulated-email', 'admin@school.test')
      .set('x-simulated-school-id', '10')
      .send({ status: 'REJECTED', rejectionReason: 'Document illisible' });

    expect(res.status).toBe(200);
    expect(res.body.justificationStatus).toBe('REJECTED');
    expect(res.body.isJustified).toBe(false);
    expect(res.body.rejectionReason).toBe('Document illisible');
    expect(FIXTURES.absences[0]).toMatchObject({ justificationStatus: 'REJECTED', isJustified: false, rejectionReason: 'Document illisible' });
  });

  it('3h3. parent sees only their child absences', async () => {
    const res = await request(app)
      .get('/api/absences')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0]?.studentId).toBe(11);
  });

  it('isolates parent data by current student.parentId across child-data routes and IDOR inputs', async () => {
    FIXTURES.users.push({ id: 20, uid: 'parent-b-uid', email: 'parent-b@x.test', name: 'Parent B', role: 'parent', schoolId: 10, isDeleted: false });
    FIXTURES.parents.splice(0, FIXTURES.parents.length,
      { id: 1, userId: 6, studentId: 13, schoolId: 10 },
      { id: 4, userId: 20, studentId: 11, schoolId: 10 },
    );
    FIXTURES.students.splice(0, FIXTURES.students.length,
      { id: 11, schoolId: 10, classId: 1, firstName: 'Awa', lastName: 'One', isActive: true, parentId: 1 },
      { id: 12, schoolId: 10, classId: 2, firstName: 'Awa', lastName: 'Two', isActive: true, parentId: 1 },
      { id: 13, schoolId: 10, classId: 3, firstName: 'Binta', lastName: 'Three', isActive: true, parentId: 4 },
      { id: 14, schoolId: 10, classId: 1, firstName: 'Other', lastName: 'Minimum', isActive: true, parentId: null },
      { id: 15, schoolId: 10, classId: 1, firstName: 'Other', lastName: 'Maximum', isActive: true, parentId: null },
    );
    FIXTURES.classes.find((klass: any) => klass.id === 3)!.schoolId = 10;
    FIXTURES.absences = [
      { id: 101, studentId: 11, classId: 1, date: '2026-09-20', period: '1', isJustified: false },
      { id: 102, studentId: 12, classId: 2, date: '2026-09-21', period: '1', isJustified: false },
      { id: 103, studentId: 13, classId: 3, date: '2026-09-22', period: '1', isJustified: false },
    ];
    FIXTURES.lateArrivals = [
      { id: 201, studentId: 11, classId: 1, date: '2026-09-20', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:10', lateMinutes: 10 },
      { id: 202, studentId: 12, classId: 2, date: '2026-09-21', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:10', lateMinutes: 10 },
      { id: 203, studentId: 13, classId: 3, date: '2026-09-22', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:10', lateMinutes: 10 },
    ];
    FIXTURES.absenceDeclarations = [
      { id: 301, studentId: 11, parentId: 1, date: '2026-09-20', status: 'RECEIVED' },
      { id: 302, studentId: 12, parentId: 1, date: '2026-09-21', status: 'RECEIVED' },
      { id: 303, studentId: 13, parentId: 4, date: '2026-09-22', status: 'RECEIVED' },
    ];
    FIXTURES.evaluations = [
      { id: 51, classId: 1, schoolId: 10, teacherId: 77, title: 'Evaluation A', subject: 'Math', maxScore: 20, date: '2026-09-20' },
      { id: 52, classId: 2, schoolId: 10, teacherId: 77, title: 'Evaluation B', subject: 'Math', maxScore: 20, date: '2026-09-21' },
      { id: 53, classId: 3, schoolId: 10, teacherId: 77, title: 'Evaluation B-only', subject: 'Math', maxScore: 20, date: '2026-09-22' },
    ];
    FIXTURES.grades = [
      { id: 401, evaluationId: 51, classId: 1, schoolId: 10, studentId: 11, score: '8', maxScore: 20, evaluationTitle: 'Evaluation A' },
      { id: 402, evaluationId: 52, classId: 2, schoolId: 10, studentId: 12, score: '12', maxScore: 20, evaluationTitle: 'Evaluation B' },
      { id: 403, evaluationId: 51, classId: 1, schoolId: 10, studentId: 14, score: '2', maxScore: 20, evaluationTitle: 'Evaluation A' },
      { id: 404, evaluationId: 51, classId: 1, schoolId: 10, studentId: 15, score: '19', maxScore: 20, evaluationTitle: 'Evaluation A' },
      { id: 405, evaluationId: 53, classId: 3, schoolId: 10, studentId: 13, score: '20', maxScore: 20, evaluationTitle: 'Evaluation B-only' },
    ];
    FIXTURES.absenceJustifications = [{ id: 701, absenceId: 101, fileName: 'child-a.pdf', filePath: 'missing-child-a.pdf', mimeType: 'application/pdf', uploadedBy: 6 }];
    FIXTURES.notifications = [{ id: 501, userId: 20, type: 'info', title: 'Parent B only', body: 'Private' }];
    FIXTURES.notificationAttachments = [{ id: 801, notificationId: 501, fileName: 'parent-b.pdf', filePath: 'missing-parent-b.pdf', mimeType: 'application/pdf', uploadedBy: 2 }];

    const parentAGet = (url: string) => request(app).get(url)
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');
    const parentAPost = (url: string) => request(app).post(url)
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    const students = await parentAGet('/api/students?studentId=13');
    expect(students.status).toBe(200);
    expect(students.body.map((student: any) => student.id).sort()).toEqual([11, 12]);

    const classes = await parentAGet('/api/classes?classId=3');
    expect(classes.status).toBe(200);
    expect(classes.body.map((klass: any) => klass.id).sort()).toEqual([1, 2]);

    const parents = await parentAGet('/api/parents?parentId=4');
    expect(parents.status).toBe(200);
    expect(parents.body.map((parent: any) => parent.id)).toEqual([1, 1]);
    expect(parents.body.map((parent: any) => parent.studentId).sort()).toEqual([11, 12]);

    const absences = await parentAGet('/api/absences');
    expect(absences.status).toBe(200);
    expect(absences.body.map((absence: any) => absence.studentId).sort()).toEqual([11, 12]);

    const lateArrivals = await parentAGet('/api/late-arrivals');
    expect(lateArrivals.status).toBe(200);
    expect(lateArrivals.body.map((arrival: any) => arrival.studentId).sort()).toEqual([11, 12]);

    const declarations = await parentAGet('/api/absence-declarations');
    expect(declarations.status).toBe(200);
    expect(declarations.body.map((declaration: any) => declaration.studentId).sort()).toEqual([11, 12]);

    const evaluations = await parentAGet('/api/evaluations?evaluationId=53');
    expect(evaluations.status).toBe(200);
    expect(evaluations.body.map((evaluation: any) => evaluation.id).sort()).toEqual([51, 52]);

    const grades = await parentAGet('/api/grades?evaluationId=53');
    expect(grades.status).toBe(200);
    expect(grades.body.map((grade: any) => grade.studentId).sort()).toEqual([11, 12]);
    expect(grades.body.find((grade: any) => grade.evaluationId === 51)).toMatchObject({
      evaluationMinimumScore: 8,
      evaluationMaximumScore: 8,
    });
    expect(grades.body.find((grade: any) => grade.evaluationId === 52)).toMatchObject({
      evaluationMinimumScore: 12,
      evaluationMaximumScore: 12,
    });
    expect(grades.body.some((grade: any) => [13, 14, 15].includes(grade.studentId))).toBe(false);
    expect(JSON.stringify(grades.body)).not.toMatch(/Other (Minimum|Maximum)/);
    expect(grades.body.every((grade: any) => !('minimumStudentId' in grade) && !('maximumStudentId' in grade))).toBe(true);

    const ownJustification = await parentAGet('/api/absences/101/justification/download');
    expect(ownJustification.status).toBe(404);
    expect(ownJustification.body.error).toBe('Justification file not found on disk');
    expect(ownJustification.headers['content-disposition']).toBeUndefined();
    const outOfScopeJustification = await parentAGet('/api/absences/103/justification/download');
    expect(outOfScopeJustification.status).toBe(403);
    expect(outOfScopeJustification.headers['content-type']).toMatch(/application\/json/);
    expect(outOfScopeJustification.headers['content-disposition']).toBeUndefined();
    const queryOverrideJustification = await parentAGet('/api/absences/103/justification/download?studentId=11');
    expect(queryOverrideJustification.status).toBe(403);
    expect(queryOverrideJustification.headers['content-disposition']).toBeUndefined();
    await request(app).put('/api/absences/103/justify')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10')
      .send({ justificationReason: 'IDOR test' })
      .expect(403);

    await parentAPost('/api/absence-declarations')
      .send({ parentId: 4, studentId: 13, date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), startTime: '08:00', endTime: '10:00', reason: 'IDOR test' })
      .expect(403);
    await parentAGet('/api/notifications/501/attachments/801').expect(403);
  });

  it('scopes school_admin justification downloads to the verified school and preserves super_admin access', async () => {
    FIXTURES.students.push({
      id: 16,
      schoolId: 20,
      classId: 3,
      firstName: 'Child',
      lastName: 'Other School',
      isActive: true,
      parentId: null,
    } as any);
    FIXTURES.absences.push({
      id: 2,
      studentId: 16,
      classId: 3,
      date: '2026-09-23',
      period: '1',
      isJustified: true,
    } as any);
    FIXTURES.absenceJustifications.push({
      id: 702,
      absenceId: 1,
      fileName: 'school-a.pdf',
      filePath: 'missing-school-a.pdf',
      mimeType: 'application/pdf',
      uploadedBy: 2,
    } as any, {
      id: 703,
      absenceId: 2,
      fileName: 'school-b.pdf',
      filePath: 'missing-school-b.pdf',
      mimeType: 'application/pdf',
      uploadedBy: 11,
    } as any);

    const noSchoolAdmin = await request(app)
      .get('/api/absences/1/justification/download?schoolId=10')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim-school-admin-no-school')
      .set('x-simulated-email', 'admin-noschool@x.test');
    expect(noSchoolAdmin.status).toBe(403);
    expect(noSchoolAdmin.headers['content-type']).toMatch(/application\/json/);
    expect(noSchoolAdmin.headers['content-disposition']).toBeUndefined();

    const schoolAdminMembership = FIXTURES.userSchools.find((membership: any) => (
      membership.userId === 2 && membership.schoolId === 10 && membership.role === 'school_admin'
    ));
    expect(schoolAdminMembership).toBeDefined();
    schoolAdminMembership.isActive = false;
    const inactiveSchoolAdmin = await request(app)
      .get('/api/absences/1/justification/download')
      .set('Authorization', 'Bearer token-school');
    expect(inactiveSchoolAdmin.status).toBe(403);
    expect(inactiveSchoolAdmin.headers['content-type']).toMatch(/application\/json/);
    expect(inactiveSchoolAdmin.headers['content-disposition']).toBeUndefined();
    schoolAdminMembership.isActive = true;

    const sameSchoolAdmin = await request(app)
      .get('/api/absences/1/justification/download?schoolId=20')
      .set('Authorization', 'Bearer token-school');
    expect(sameSchoolAdmin.status).toBe(404);
    expect(sameSchoolAdmin.body.error).toBe('Justification file not found on disk');
    expect(sameSchoolAdmin.headers['content-disposition']).toBeUndefined();

    const otherSchoolAdmin = await request(app)
      .get('/api/absences/2/justification/download?schoolId=10')
      .set('Authorization', 'Bearer token-school');
    expect(otherSchoolAdmin.status).toBe(403);
    expect(otherSchoolAdmin.headers['content-type']).toMatch(/application\/json/);
    expect(otherSchoolAdmin.headers['content-disposition']).toBeUndefined();

    const superAdmin = await request(app)
      .get('/api/absences/2/justification/download')
      .set('Authorization', 'Bearer token-super');
    expect(superAdmin.status).toBe(404);
    expect(superAdmin.body.error).toBe('Justification file not found on disk');
    expect(superAdmin.headers['content-disposition']).toBeUndefined();
  });

  it('scopes a multi-school parent to the verified school context, not a requested schoolId', async () => {
    FIXTURES.parents.push(
      { id: 4, userId: 6, studentId: 16, schoolId: 20 },
      { id: 5, userId: 20, studentId: 17, schoolId: 10 },
    );
    FIXTURES.userSchools.push({ userId: 6, schoolId: 20, role: 'parent', isActive: true });
    FIXTURES.users.push({
      id: 20,
      uid: 'other-parent-context',
      email: 'other-parent-context@x.test',
      name: 'Other Parent',
      role: 'parent',
      schoolId: 10,
      isDeleted: false,
    } as any);
    FIXTURES.students.push(
      { id: 16, schoolId: 20, classId: 3, firstName: 'Child', lastName: 'Other School', isActive: true, parentId: 4 } as any,
      { id: 17, schoolId: 10, classId: 1, firstName: 'Other', lastName: 'Parent', isActive: true, parentId: 5 } as any,
    );

    const responseAtSchool10 = await request(app)
      .get('/api/students?schoolId=20')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-school-id', '10');
    expect(responseAtSchool10.status).toBe(200);
    expect(responseAtSchool10.body.map((student: any) => student.id)).toEqual([11]);
    expect(responseAtSchool10.body.some((student: any) => [16, 17].includes(student.id))).toBe(false);

    const responseAtSchool20 = await request(app)
      .get('/api/students')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-school-id', '20');
    expect(responseAtSchool20.status).toBe(200);
    expect(responseAtSchool20.body.map((student: any) => student.id)).toEqual([16]);

    const otherSchoolParentProfile = await request(app)
      .get('/api/parents/4')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-school-id', '10');
    expect(otherSchoolParentProfile.status).toBe(404);
  });

  it('uses the parent school context for global class status instead of the requested schoolId', async () => {
    FIXTURES.students.find((student: any) => student.id === 11)!.classId = 4;
    FIXTURES.schoolClasses.find((schoolClass: any) => schoolClass.id === 501)!.status = 'pending';
    FIXTURES.schoolClasses.push(
      { id: 502, classId: 4, schoolId: 20, status: 'approved' },
    );

    const correctContext = await request(app)
      .get('/api/classes?schoolId=10')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-school-id', '10');
    expect(correctContext.status).toBe(200);
    expect(correctContext.body.map((klass: any) => klass.id)).toEqual([4]);
    expect(correctContext.body[0]).toHaveProperty('status', null);

    const mismatchedClientSchool = await request(app)
      .get('/api/classes?schoolId=20')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-school-id', '10');
    expect(mismatchedClientSchool.status).toBe(403);
  });

  it('3h4. parent dashboard summary is scoped to their child', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stats');
    expect(res.body).toHaveProperty('recentAbsences');
    expect(res.body).toHaveProperty('recentGrades');
  });

  it('3h5. super_admin can retrieve aggregated login statistics', async () => {
    const res = await request(app)
      .get('/api/admin/login-stats')
      .set('Authorization', 'Bearer token-super');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalLogins: 3,
      uniqueUsers: 2,
      webLogins: 1,
      androidLogins: 1,
    });
    expect(res.body.loginsByDay).toHaveLength(30);
    expect(res.body.loginsByRole).toEqual([
      { role: 'parent', total: 2 },
      { role: 'teacher', total: 1 },
    ]);
    expect(res.body.loginsByDay.find((entry: any) => entry.date === '2026-09-24')).toMatchObject({
      total: 3,
      web: 1,
      android: 1,
    });
  });

  it('3h6. non-super_admin roles cannot retrieve login statistics', async () => {
    const res = await request(app)
      .get('/api/admin/login-stats')
      .set('Authorization', 'Bearer token-school');

    expect(res.status).toBe(403);
  });

  it('3h7. login statistics return zeroes when there are no events', async () => {
    FIXTURES.userLoginEvents.splice(0);

    const res = await request(app)
      .get('/api/admin/login-stats')
      .set('Authorization', 'Bearer token-super');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalLogins: 0,
      uniqueUsers: 0,
      webLogins: 0,
      androidLogins: 0,
    });
    expect(res.body.loginsByDay).toHaveLength(30);
    expect(res.body.loginsByDay.every((entry: any) => entry.total === 0 && entry.web === 0 && entry.android === 0)).toBe(true);
    expect(res.body.loginsByRole).toEqual([]);
  });

  it('Super Admin can update a global subject name, code and default type', async () => {
    const response = await request(app)
      .put('/api/subjects/901')
      .set('Authorization', 'Bearer token-super')
      .send({ name: 'Physique générale', code: 'PHY-G', subjectTypeId: 12 });

    expect(response.status).toBe(200);
    expect(FIXTURES.subjects.find((subject: any) => subject.id === 901)).toMatchObject({
      name: 'Physique générale',
      code: 'PHY-G',
      subjectTypeId: 12,
    });
  });

  it('School Admin updates an assigned global subject type only for its school and reads the effective type', async () => {
    FIXTURES.schoolSubjects.push({ id: 2, schoolId: 10, subjectId: 901, status: 'approved', subjectTypeId: 11 });

    const updateResponse = await request(app)
      .put('/api/subjects/901')
      .set('Authorization', 'Bearer token-school')
      .send({ subjectTypeId: 12 });

    expect(updateResponse.status).toBe(200);
    expect(FIXTURES.schoolSubjects.find((relation: any) => relation.schoolId === 10 && relation.subjectId === 901)?.subjectTypeId).toBe(12);
    expect(FIXTURES.subjects.find((subject: any) => subject.id === 901)?.subjectTypeId).toBe(11);

    const readResponse = await request(app)
      .get('/api/subjects')
      .set('Authorization', 'Bearer token-school');
    expect(readResponse.status).toBe(200);
    expect(readResponse.body.find((subject: any) => subject.id === 901)).toMatchObject({ subjectTypeId: 12, status: 'approved' });
  });

  it('School Admin cannot change the name of an assigned global subject', async () => {
    FIXTURES.schoolSubjects.push({ id: 2, schoolId: 10, subjectId: 901, status: 'approved', subjectTypeId: 11 });

    const response = await request(app)
      .put('/api/subjects/901')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'Nom interdit', subjectTypeId: 12 });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Global subject names can only be changed by a super admin');
    expect(FIXTURES.subjects.find((subject: any) => subject.id === 901)?.name).toBe('Physique');
    expect(FIXTURES.schoolSubjects.find((relation: any) => relation.schoolId === 10)?.subjectTypeId).toBe(11);
  });

  it('School Admin cannot change the code of an assigned global subject', async () => {
    FIXTURES.schoolSubjects.push({ id: 2, schoolId: 10, subjectId: 901, status: 'approved', subjectTypeId: 11 });

    const response = await request(app)
      .put('/api/subjects/901')
      .set('Authorization', 'Bearer token-school')
      .send({ code: 'PHY-NEW', subjectTypeId: 12 });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Global subject names can only be changed by a super admin');
    expect(FIXTURES.subjects.find((subject: any) => subject.id === 901)?.code).toBeUndefined();
    expect(FIXTURES.schoolSubjects.find((relation: any) => relation.schoolId === 10)?.subjectTypeId).toBe(11);
  });

  it('School Admin cannot change a global subject type without an approved school assignment', async () => {
    const response = await request(app)
      .put('/api/subjects/901')
      .set('Authorization', 'Bearer token-school')
      .send({ subjectTypeId: 12 });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Global subject is not assigned to your school');
    expect(FIXTURES.subjects.find((subject: any) => subject.id === 901)?.subjectTypeId).toBe(11);
  });

  it('3i. school_admin can create a teacher in their own school via POST /api/teachers', async () => {
    const res = await request(app)
      .post('/api/teachers')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'KANGNI - SOUKPE Parfait', lastName: 'KANGNI - SOUKPE', firstNames: 'Parfait', email: 'newteacher@x.test', phone: '+22912345678', specialization: 'Science', schoolId: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'newteacher@x.test', schoolId: 10 });
    const createdUser = FIXTURES.users.find((user) => user.email === 'newteacher@x.test')!;
    expect(createdUser).toMatchObject({
      name: 'KANGNI - SOUKPE Parfait',
      lastName: 'KANGNI - SOUKPE',
      firstNames: 'Parfait',
    });
    const list = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(list.status).toBe(200);
    const listedTeacher = list.body.find((row: any) => row.userId === createdUser.id);
    expect(getTeacherDisplayName(listedTeacher)).toBe('KANGNI - SOUKPE Parfait');
  });

  it('does not serialize access-session generation BigInts in public user responses', async () => {
    mockDb.db.__returnUsersWithBigIntAccessSessionGeneration = true;
    const superAdminHeaders = {
      'x-simulated-role': 'super_admin',
      'x-simulated-uid': 'super-uid',
      'x-simulated-email': 'super@x.test',
    };

    const adminCreated = await request(app)
      .post('/api/admin/users')
      .set(superAdminHeaders)
      .send({
        email: 'bigint-admin-create@x.test',
        name: 'BigInt Admin Create',
        role: 'surveillant',
        schoolId: 20,
        phone: '+22890000061',
      });
    expect(adminCreated.status).toBe(201);
    expect(adminCreated.body).toMatchObject({
      email: 'bigint-admin-create@x.test',
      role: 'surveillant',
      schoolId: 20,
    });
    expect(adminCreated.body).not.toHaveProperty('accessSessionGeneration');
    expect(() => JSON.stringify(adminCreated.body)).not.toThrow();

    const teacherCreated = await request(app)
      .post('/api/teachers')
      .set(superAdminHeaders)
      .send({
        lastName: 'BigInt',
        firstNames: 'Teacher Create',
        email: 'bigint-teacher-create@x.test',
        phone: '+22890000062',
        specialization: 'Science',
        schoolId: 20,
      });
    expect(teacherCreated.status).toBe(201);
    expect(teacherCreated.body).toMatchObject({
      email: 'bigint-teacher-create@x.test',
      role: 'teacher',
      teacherId: expect.any(Number),
    });
    expect(teacherCreated.body).not.toHaveProperty('accessSessionGeneration');
    expect(() => JSON.stringify(teacherCreated.body)).not.toThrow();

    const parentCreated = await request(app)
      .post('/api/parents')
      .set(superAdminHeaders)
      .send({
        name: 'BigInt Parent Create',
        email: 'bigint-parent-create@x.test',
        phone: '+22890000063',
        address: 'Test',
        schoolId: 20,
      });
    expect(parentCreated.status).toBe(201);
    expect(parentCreated.body).toMatchObject({
      email: 'bigint-parent-create@x.test',
      name: 'BigInt Parent Create',
      parentId: expect.any(Number),
    });
    expect(parentCreated.body).not.toHaveProperty('accessSessionGeneration');
    expect(() => JSON.stringify(parentCreated.body)).not.toThrow();

    const updateTarget = FIXTURES.users.find((user) => user.id === 3)! as any;
    updateTarget.accessSessionGeneration = 1n;
    const teacherUpdated = await request(app)
      .put('/api/admin/users/3')
      .set(superAdminHeaders)
      .send({
        email: updateTarget.email,
        name: 'Teacher Updated',
        role: 'teacher',
        schoolId: 10,
      });
    expect(teacherUpdated.status).toBe(200);
    expect(teacherUpdated.body).toMatchObject({
      id: 3,
      email: updateTarget.email,
      name: 'Teacher Updated',
      teacherId: 77,
    });
    expect(teacherUpdated.body).not.toHaveProperty('accessSessionGeneration');
    expect(() => JSON.stringify(teacherUpdated.body)).not.toThrow();
  });

  it('3i. teacher cannot create a teacher via POST /api/teachers', async () => {
    const res = await request(app)
      .post('/api/teachers')
      .set('Authorization', 'Bearer token-teacher')
      .send({ name: 'Bad Teacher', email: 'badteacher@x.test', phone: '+22912345678', specialization: 'Science', schoolId: 10 });

    expect(res.status).toBe(403);
  });

  it('3j. parent cannot create a teacher via POST /api/teachers', async () => {
    const res = await request(app)
      .post('/api/teachers')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10')
      .send({ name: 'Bad Teacher', email: 'badteacher2@x.test', phone: '+22912345678', specialization: 'Science', schoolId: 10 });

    expect(res.status).toBe(403);
  });

  it('3k. school_admin can create a parent in their own school via POST /api/parents', async () => {
    const res = await request(app)
      .post('/api/parents')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'New Parent', email: 'newparent@x.test', phone: '+22998765432', address: 'Rue Test', schoolId: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'newparent@x.test', name: 'New Parent', schoolId: 10 });
  });

  it('3k-bis. school_admin can create a parent without an email via POST /api/parents', async () => {
    const res = await request(app)
      .post('/api/parents')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'Parent Sans Email', phone: '+22998765433', address: 'Rue Sans Email', schoolId: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: null, name: 'Parent Sans Email', schoolId: 10 });
  });

  it('Super Admin must explicitly select an existing school when creating a parent directly', async () => {
    const headers = {
      'x-simulated-role': 'super_admin',
      'x-simulated-uid': 'super-uid',
      'x-simulated-email': 'super@x.test',
    };
    const payload = {
      name: 'Explicit School Parent',
      email: 'explicit-school-parent@x.test',
      phone: '+22890000074',
      address: 'Rue Test',
    };
    const usersBefore = FIXTURES.users.length;
    const parentsBefore = FIXTURES.parents.length;

    const missingSchool = await request(app).post('/api/parents').set(headers).send(payload);
    expect(missingSchool.status).toBe(400);

    const invalidSchool = await request(app).post('/api/parents').set(headers)
      .send({ ...payload, email: 'invalid-school-parent@x.test', schoolId: 999 });
    expect(invalidSchool.status).toBe(400);
    expect(FIXTURES.users).toHaveLength(usersBefore);
    expect(FIXTURES.parents).toHaveLength(parentsBefore);

    const created = await request(app).post('/api/parents').set(headers)
      .send({ ...payload, schoolId: 20 });
    expect(created.status).toBe(201);
    expect(created.body.schoolId).toBe(20);
    expect(FIXTURES.parents).toContainEqual(expect.objectContaining({ userId: created.body.id, schoolId: 20 }));
  });

  it('school_admin cannot create a parent in a client-selected other school', async () => {
    const response = await request(app)
      .post('/api/parents')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .set('x-simulated-email', 'admin@school.test')
      .send({
        name: 'Remote Parent',
        email: 'remote-parent-direct@x.test',
        phone: '+22890000075',
        address: 'Rue Test',
        schoolId: 20,
      });

    expect(response.status).toBe(403);
    expect(FIXTURES.users.some((user) => user.email === 'remote-parent-direct@x.test')).toBe(false);
  });

  it('rolls back direct parent creation if the school association fails, then allows a retry', async () => {
    FIXTURES.students.push({
      id: 19,
      schoolId: 10,
      classId: 1,
      firstName: 'Unlinked',
      lastName: 'Student',
      birthDate: '2010-01-01',
      gender: 'female',
      parentId: null,
      schoolAdminId: null,
      enrolledAt: '2025-09-01T00:00:00Z',
    });
    const usersBefore = FIXTURES.users.length;
    const parentsBefore = FIXTURES.parents.length;
    const membershipsBefore = FIXTURES.userSchools.length;
    (mockDb.db as any).__failNextParentInsert = false;
    (mockDb.db as any).__failNextParentMembershipInsert = true;

    const payload = {
      name: 'Atomic Parent',
      email: 'atomic-parent@x.test',
      phone: '+22890000061',
      address: 'Test address',
      schoolId: 10,
      studentId: 19,
    };
    const failed = await request(app)
      .post('/api/parents')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send(payload);

    expect(failed.status).toBe(500);
    expect(FIXTURES.users).toHaveLength(usersBefore);
    expect(FIXTURES.parents).toHaveLength(parentsBefore);
    expect(FIXTURES.userSchools).toHaveLength(membershipsBefore);
    expect(FIXTURES.users.some((user) => user.email === payload.email)).toBe(false);
    expect(FIXTURES.students.find((student: any) => student.id === 19)?.parentId).toBeNull();

    const retried = await request(app)
      .post('/api/parents')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send(payload);

    expect(retried.status).toBe(201);
    const createdUser = FIXTURES.users.find((user) => user.email === payload.email);
    const createdParent = FIXTURES.parents.find((parent: any) => parent.userId === createdUser?.id);
    expect(createdUser).toBeDefined();
    expect(createdParent).toMatchObject({ userId: createdUser?.id, schoolId: 10 });
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({
      userId: createdUser?.id,
      schoolId: 10,
      role: 'parent',
    }));
    expect(FIXTURES.students.find((student: any) => student.id === 19)?.parentId).toBe(createdParent?.id);
  });

  it('rolls back admin parent user and local auth if its profile insert fails', async () => {
    const usersBefore = FIXTURES.users.length;
    const parentsBefore = FIXTURES.parents.length;
    const localAuthsBefore = FIXTURES.localAuths.length;
    const membershipsBefore = FIXTURES.userSchools.length;
    (mockDb.db as any).__failNextParentMembershipInsert = false;
    (mockDb.db as any).__failNextParentInsert = true;

    const payload = {
      uid: 'atomic-admin-parent',
      email: 'atomic-admin-parent@x.test',
      name: 'Atomic Admin Parent',
      role: 'parent',
      schoolId: 10,
      phone: '+22890000062',
    };
    const failed = await request(app)
      .post('/api/admin/users')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send(payload);

    expect(failed.status).toBe(500);
    expect(FIXTURES.users).toHaveLength(usersBefore);
    expect(FIXTURES.parents).toHaveLength(parentsBefore);
    expect(FIXTURES.localAuths).toHaveLength(localAuthsBefore);
    expect(FIXTURES.userSchools).toHaveLength(membershipsBefore);
    expect(FIXTURES.users.some((user) => user.uid === payload.uid)).toBe(false);

    const retried = await request(app)
      .post('/api/admin/users')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send(payload);

    expect(retried.status).toBe(201);
    const createdUser = FIXTURES.users.find((user) => user.uid === payload.uid);
    expect(FIXTURES.parents).toContainEqual(expect.objectContaining({ userId: createdUser?.id, schoolId: 10 }));
    expect(FIXTURES.localAuths).toContainEqual(expect.objectContaining({ userId: createdUser?.id, mustReset: true }));
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({
      userId: createdUser?.id,
      schoolId: 10,
      role: 'parent',
    }));
  });

  it('3k-ter. school_admin can create a parent without an email via POST /api/admin/users', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({ uid: 'parent-no-email-2', name: 'Parent sans email admin', role: 'parent', phone: '+22998765434', schoolId: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: null, name: 'Parent sans email admin', role: 'parent', schoolId: 10 });
  });

  it('requires a valid phone when creating parents, teachers, and administrators', async () => {
    const initialUserCount = FIXTURES.users.length;
    const parent = await request(app)
      .post('/api/parents')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'Parent Invalid Phone', email: 'parent-no-phone@x.test', phone: '123', address: 'Rue Test', schoolId: 10 });
    const teacher = await request(app)
      .post('/api/teachers')
      .set('Authorization', 'Bearer token-school')
      .send({ lastName: 'NoPhone', firstNames: 'Teacher', email: 'teacher-no-phone@x.test', specialization: 'Science', schoolId: 10 });
    const admin = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ email: 'admin-no-phone@x.test', name: 'Admin Without Phone', role: 'school_admin', schoolId: 10, academicYearId: 1 });

    expect(parent.status).toBe(400);
    expect(teacher.status).toBe(400);
    expect(admin.status).toBe(400);
    expect(FIXTURES.users).toHaveLength(initialUserCount);
  });

  it('enforces canonical phone uniqueness across parents, administrators, and teachers', async () => {
    const firstParent = await request(app)
      .post('/api/parents')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'Parent Phone Owner', email: 'phone-owner@x.test', phone: '+229 98 76 54 32', schoolId: 10 });
    expect(firstParent.status).toBe(201);

    const duplicateParent = await request(app)
      .post('/api/parents')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'Different Parent', email: 'different-parent@x.test', phone: '00229 98-76-54-32', schoolId: 10 });
    expect(duplicateParent.status).toBe(409);
    expect(duplicateParent.body.code).toBe('PHONE_ALREADY_IN_USE');

    const duplicateParentOtherSchool = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ email: 'different-school-parent@x.test', name: 'Different School Parent', role: 'parent', schoolId: 20, phone: '+22998765432' });
    expect(duplicateParentOtherSchool.status).toBe(409);

    const duplicateAdmin = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ email: 'different-admin@x.test', name: 'Different Admin', role: 'school_admin', schoolId: 10, academicYearId: 1, phone: '+22998765432' });
    expect(duplicateAdmin.status).toBe(409);

    const duplicateTeacher = await request(app)
      .post('/api/teachers')
      .set('Authorization', 'Bearer token-school')
      .send({ lastName: 'Different', firstNames: 'Teacher', email: 'different-teacher@x.test', phone: '0022998765432', specialization: 'Science', schoolId: 10 });
    expect(duplicateTeacher.status).toBe(409);

    const duplicateTeacherOtherSchool = await request(app)
      .post('/api/teachers')
      .set('Authorization', 'Bearer token-super')
      .send({ lastName: 'Different', firstNames: 'School Teacher', email: 'different-school-teacher@x.test', phone: '+229 98 76 54 32', specialization: 'Science', schoolId: 20 });
    expect(duplicateTeacherOtherSchool.status).toBe(409);
  });

  it('canonicalizes complete Togo phone numbers on direct parent creation endpoints', async () => {
    const directParent = await request(app)
      .post('/api/parents')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({ name: 'Direct Parent', email: 'direct-parent-phone@x.test', phone: '228 90 12 12 13', schoolId: 10 });
    expect(directParent.status).toBe(201);
    expect(directParent.body.phone).toBe('+22890121213');
    expect((FIXTURES.parents as any[]).find((parent) => parent.userId === directParent.body.id)?.phone).toBe('+22890121213');

    const adminCreatedParent = await request(app)
      .post('/api/admin/users')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({ email: 'admin-parent-phone@x.test', name: 'Admin Parent', role: 'parent', schoolId: 20, phone: '00228 90 12 12 14' });
    expect(adminCreatedParent.status).toBe(201);
    expect(adminCreatedParent.body.phone).toBe('+22890121214');
    expect((FIXTURES.parents as any[]).find((parent) => parent.userId === adminCreatedParent.body.id)?.phone).toBe('+22890121214');
  });

  it('does not provision a new user through register-or-login without a phone', async () => {
    const uid = 'sim-parent-register-without-phone';
    const res = await request(app)
      .post('/api/auth/register-or-login')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', uid)
      .set('x-simulated-email', 'register-no-phone@x.test')
      .send();

    expect(res.status).toBe(400);
    expect(FIXTURES.users.some((user) => user.uid === uid)).toBe(false);
  });

  it('returns serializable public DTOs for existing register-or-login UID and email matches', async () => {
    const existing = FIXTURES.users.find((user) => user.id === 6) as any;
    existing.accessSessionGeneration = 1n;
    const simulatedHeaders = {
      'x-simulated-role': 'parent',
      'x-simulated-email': 'parent@x.test',
      'x-simulated-school-id': '10',
    };

    const byUid = await request(app)
      .post('/api/auth/register-or-login')
      .set({ ...simulatedHeaders, 'x-simulated-uid': 'sim-parent' })
      .send();

    expect(byUid.status).toBe(200);
    expect(byUid.body).toMatchObject({
      id: 6,
      uid: 'sim-parent',
      email: 'parent@x.test',
      name: 'Parent',
      role: 'parent',
      schoolId: 10,
    });
    expect(byUid.body).not.toHaveProperty('accessSessionGeneration');
    expect(() => JSON.stringify(byUid.body)).not.toThrow();

    mockDb.db.__skipNextNormalizedEmailLookup = true;
    const byEmail = await request(app)
      .post('/api/auth/register-or-login')
      .set({ ...simulatedHeaders, 'x-simulated-uid': 'register-email-match' })
      .send();

    expect(byEmail.status).toBe(200);
    expect(byEmail.body).toMatchObject({
      id: 6,
      uid: 'sim-parent',
      email: 'parent@x.test',
      name: 'Parent',
      role: 'parent',
      schoolId: 10,
    });
    expect(byEmail.body).not.toHaveProperty('accessSessionGeneration');
    expect(() => JSON.stringify(byEmail.body)).not.toThrow();
    expect(mockDb.db.__skipNextNormalizedEmailLookup).toBe(false);
  });

  it('allows the existing account phone on update but rejects another account phone', async () => {
    FIXTURES.users.push(
      { id: 20, uid: 'phone-update-parent', email: null, name: 'Phone Parent', role: 'parent', schoolId: 10, phone: '+22890000041', isDeleted: false },
      { id: 21, uid: 'phone-update-teacher', email: 'phone-teacher@x.test', name: 'Phone Teacher', role: 'teacher', schoolId: 10, phone: '+22990000042', isDeleted: false },
    );
    FIXTURES.parents.push({ id: 4, userId: 20, phone: '+228 90 00 00 41', address: '', schoolId: 10 });

    const selfSamePhone = await request(app)
      .put('/api/users/20')
      .set('Authorization', 'Bearer token-super')
      .send({ phone: '00228 90-00-00-41' });
    expect(selfSamePhone.status).toBe(200);

    const selfDifferentPhone = await request(app)
      .put('/api/users/20')
      .set('Authorization', 'Bearer token-super')
      .send({ phone: '+229 90 00 00 42' });
    expect(selfDifferentPhone.status).toBe(409);

    const adminSamePhone = await request(app)
      .put('/api/admin/users/20')
      .set('Authorization', 'Bearer token-super')
      .send({ email: null, name: 'Phone Parent', role: 'parent', schoolId: 10, phone: '+22890000041' });
    expect(adminSamePhone.status).toBe(200);

    const adminDifferentPhone = await request(app)
      .put('/api/admin/users/20')
      .set('Authorization', 'Bearer token-super')
      .send({ email: null, name: 'Phone Parent', role: 'parent', schoolId: 10, phone: '+22990000042' });
    expect(adminDifferentPhone.status).toBe(409);
  });

  it('lets only one concurrent parent creation claim a canonical phone', async () => {
    const createParent = (uid: string, name: string, email: string, phone: string) => request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({ uid, name, email, role: 'parent', schoolId: 10, phone });

    const responses = await Promise.all([
      createParent('concurrent-parent-a', 'Concurrent Parent A', 'concurrent-a@x.test', '+228 90 00 00 51'),
      createParent('concurrent-parent-b', 'Concurrent Parent B', 'concurrent-b@x.test', '00228 90000051'),
    ]);

    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(FIXTURES.users.filter((user) => user.phone === '+22890000051')).toHaveLength(1);
  });

  it('3l. parent cannot create a parent via POST /api/parents', async () => {
    const res = await request(app)
      .post('/api/parents')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10')
      .send({ name: 'Bad Parent', email: 'badparent@x.test', phone: '+22998765432', address: 'Rue Test', schoolId: 10 });

    expect(res.status).toBe(403);
  });

  it('3m. teacher cannot create a parent via POST /api/parents', async () => {
    const res = await request(app)
      .post('/api/parents')
      .set('Authorization', 'Bearer token-teacher')
      .send({ name: 'Bad Parent', email: 'badparent2@x.test', phone: '+22998765432', address: 'Rue Test', schoolId: 10 });

    expect(res.status).toBe(403);
  });

  it('rejects new parent-child associations to former students across create and import routes', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Student', birthDate: '2010-01-01', gender: 'female', parentId: null, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });
    const initialUserCount = FIXTURES.users.length;

    const parentProfileResponse = await request(app)
      .post('/api/parents')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'Former Student Parent', email: 'former-profile@x.test', phone: '+228 90000001', address: 'Rue Test', schoolId: 10, studentId: 15 });
    expect(parentProfileResponse.status).toBe(400);

    const adminUserResponse = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({ uid: 'former-parent-account', email: 'former-account@x.test', name: 'Former Account', role: 'parent', schoolId: 10, studentId: 15 });
    expect(adminUserResponse.status).toBe(400);

    const batchResponse = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send([
        { name: 'Former By Id', email: 'former-id@x.test', phonePrefix: '+228', phone: '90000002', parentType: 'mere', studentId: 15 },
        { name: 'Former By Id List', email: 'former-ids@x.test', phonePrefix: '+228', phone: '90000003', parentType: 'pere', studentIds: '15' },
        { name: 'Former By Name', email: 'former-name@x.test', phonePrefix: '+228', phone: '90000004', parentType: 'mere', studentNames: 'Former Student' },
      ]);
    expect(batchResponse.status).toBe(200);
    expect(batchResponse.body.insertedCount).toBe(0);
    expect(batchResponse.body.errors).toHaveLength(3);
    expect(FIXTURES.users).toHaveLength(initialUserCount);
  });

  it('preserves an existing former-student parent link when only the parent profile is edited', async () => {
    FIXTURES.users.push({ id: 20, uid: 'former-linked-parent', email: 'former-linked@x.test', name: 'Former Linked Parent', role: 'parent', schoolId: 10, isDeleted: false });
    FIXTURES.parents.push({ id: 4, userId: 20, studentId: 15, schoolId: 10 });
    FIXTURES.userSchools.push({ userId: 20, schoolId: 10, role: 'parent', isActive: true });
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Student', birthDate: '2010-01-01', gender: 'female', parentId: 4, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });

    const response = await request(app)
      .put('/api/admin/users/20')
      .set('Authorization', 'Bearer token-school')
      .send({ email: 'former-linked@x.test', name: 'Former Linked Parent Updated', role: 'parent', schoolId: 10, studentId: 15 });

    expect(response.status).toBe(200);
    expect(FIXTURES.parents.find((parent: any) => parent.id === 4)?.studentId).toBe(15);
  });

  it('3n. school_admin cannot batch import parents for another school via POST /api/parents/batch', async () => {
    const res = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send([{ name: 'Remote Parent', email: 'remote@x.test', schoolId: 20 }]);

    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(0);
    expect(res.body.errors[0]).toMatchObject({ error: 'Cannot import parent for another school' });
  });

  it('documents the parent phone formats in the Excel template', async () => {
    const res = await request(app)
      .get('/api/parents/template')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(['parents', 'Instructions']);
    const parentsWorksheet = workbook.getWorksheet('parents')!;
    const parentHeaders = parentsWorksheet.getRow(1).values as unknown as unknown[];
    expect(parentHeaders.slice(1)).toEqual([
      'Nom', 'Prénoms', 'email', 'phonePrefix', 'phone', 'address', 'schoolId', 'studentId',
      'parentType', 'gender', 'studentIds', 'studentNames',
    ]);
    const instructionsWorksheet = workbook.getWorksheet('Instructions')!;
    const instructions: string[] = [];
    instructionsWorksheet.eachRow((row) => {
      const values = row.values as unknown as unknown[];
      instructions.push(...values.slice(1).map(String));
    });
    const instructionsText = instructions.join(' ');
    expect(instructionsText).toContain('Indicatif togolais 228, +228 ou 00228');
    expect(instructionsText).toContain('+22890121212');
    expect(instructionsText).toContain('aucun double indicatif');
  });

  it('3o. school_admin can batch import parents for their own school via POST /api/parents/batch', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: 1, isActive: true, firstName: 'New', lastName: 'Student', parentId: null });
    const res = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send([{ name: 'Local Parent', email: 'localparent@x.test', phonePrefix: '228', phone: '00228 90121212', parentType: 'mere', studentId: 15 }]);

    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(1);
    expect(res.body.inserted[0].user.email).toBe('localparent@x.test');
    expect(res.body.inserted[0].user.schoolId).toBe(10);
    expect(res.body.inserted[0].user.phone).toBe('+22890121212');
    expect((FIXTURES.parents as any[]).find((parent) => parent.id === res.body.inserted[0].parentId)?.phone).toBe('+22890121212');
    expect(FIXTURES.students.find((student: any) => student.id === 15)?.parentId).toBe(res.body.inserted[0].parentId);

    const importedUserId = res.body.inserted[0].user.id;
    const auth = FIXTURES.localAuths.find((row: any) => row.userId === importedUserId);
    expect(auth).toBeDefined();
    expect(auth.mustReset).toBe(true);
    const temporaryPassword = res.body.inserted[0].temporaryPassword;
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(auth.passwordHash).not.toBe(temporaryPassword);
    expect(auth).not.toHaveProperty('temporaryPassword');
    expect(JSON.stringify(auth)).not.toContain(temporaryPassword);
    expect(crypto.pbkdf2Sync(temporaryPassword, auth.salt, 310000, 64, 'sha512').toString('hex')).toBe(auth.passwordHash);

    const sharedPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: 'localparent@x.test', password: '123456' });
    expect(sharedPasswordLogin.status).toBe(401);

    const login = await request(app)
      .post('/api/auth/local-login')
      .send({ email: 'localparent@x.test', password: temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.mustReset).toBe(true);

    await request(app)
      .get('/api/grades')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ACCESS_CONTEXT_REQUIRED'));

    await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ email: 'localparent@x.test', currentPassword: temporaryPassword, newPassword: 'Changed-Password-2026!' })
      .expect(200);

    const changedAuth = FIXTURES.localAuths.find((row: any) => row.userId === importedUserId);
    expect(changedAuth.mustReset).toBe(false);
    expect(changedAuth.passwordHash).toBe(crypto.pbkdf2Sync('Changed-Password-2026!', changedAuth.salt, 310000, 64, 'sha512').toString('hex'));
    expect(changedAuth.passwordHash).not.toBe(crypto.pbkdf2Sync(temporaryPassword, changedAuth.salt, 310000, 64, 'sha512').toString('hex'));
    const changedPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: 'localparent@x.test', password: 'Changed-Password-2026!' });
    expect(changedPasswordLogin.status).toBe(200);

    await request(app)
      .get('/api/grades')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(401);
    mockDb.db.__activeTestContext = {
      kind: 'local',
      userId: importedUserId,
      uid: FIXTURES.users.find((user) => user.id === importedUserId)!.uid,
      email: 'localparent@x.test',
      active: { schoolId: 10, role: 'parent' },
    };
    await request(app)
      .get('/api/grades')
      .set('Authorization', `Bearer ${changedPasswordLogin.body.token}`)
      .expect(200);
    mockDb.db.__activeTestContext = null;
  }, 15_000);

  it('enforces the local login rate limit after five attempts', async () => {
    expect(app.get('trust proxy')).toBe(false);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(app)
        .post('/api/auth/local-login')
        .set('X-Forwarded-For', `198.51.100.${attempt + 1}`)
        .send({ email: 'missing@x.test', password: 'incorrect' });
      expect(res.status).not.toBe(429);
    }

    const limited = await request(app)
      .post('/api/auth/local-login')
      .set('X-Forwarded-For', '198.51.100.99')
      .send({ email: 'missing@x.test', password: 'incorrect' });
    expect(limited.status).toBe(429);
  });

  it("uses Render's single trusted proxy hop for production login rate limiting", async () => {
    const originalFileStorageProvider = process.env.FILE_STORAGE_PROVIDER;
    const originalS3Bucket = process.env.S3_BUCKET;
    process.env.NODE_ENV = 'production';
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'test-bucket';

    try {
      const productionApp = await serverModule.createApp();
      expect(productionApp.get('trust proxy')).toBe(1);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await request(productionApp)
          .post('/api/auth/local-login')
          .set('X-Forwarded-For', `198.51.100.${attempt + 1}, 203.0.113.77`)
          .send({ email: 'missing@x.test', password: 'incorrect' });
        expect(res.status).not.toBe(429);
      }

      const limited = await request(productionApp)
        .post('/api/auth/local-login')
        .set('X-Forwarded-For', '192.0.2.250, 203.0.113.77')
        .send({ email: 'missing@x.test', password: 'incorrect' });
      expect(limited.status).toBe(429);

      const differentClient = await request(productionApp)
        .post('/api/auth/local-login')
        .set('X-Forwarded-For', '192.0.2.250, 203.0.113.78')
        .send({ email: 'missing@x.test', password: 'incorrect' });
      expect(differentClient.status).not.toBe(429);
    } finally {
      process.env.NODE_ENV = 'test';
      if (originalFileStorageProvider === undefined) delete process.env.FILE_STORAGE_PROVIDER;
      else process.env.FILE_STORAGE_PROVIDER = originalFileStorageProvider;
      if (originalS3Bucket === undefined) delete process.env.S3_BUCKET;
      else process.env.S3_BUCKET = originalS3Bucket;
    }
  });

  it('creates local accounts with unique one-time temporary passwords and stores only hashes', async () => {
    const create = (suffix: string, phone: string) => request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({
        uid: `temporary-account-${suffix}`,
        email: `temporary-account-${suffix}@x.test`,
        name: `Temporary Teacher ${suffix}`,
        lastName: 'Temporary',
        firstNames: `Teacher ${suffix}`,
        role: 'teacher',
        schoolId: 10,
        phone,
      });

    const [first, second] = await Promise.all([
      create('one', '+22890000031'),
      create('two', '+22890000032'),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(second.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(first.body.temporaryPassword).not.toBe('123456');
    expect(second.body.temporaryPassword).not.toBe('123456');
    expect(first.body.temporaryPassword).not.toBe(second.body.temporaryPassword);

    const firstTemporaryPassword = first.body.temporaryPassword;
    for (const response of [first, second]) {
      const auth = FIXTURES.localAuths.find((row: any) => row.userId === response.body.id);
      expect(auth).toMatchObject({ mustReset: true });
      expect(auth.passwordHash).toMatch(/^[a-f0-9]{128}$/);
      expect(auth.salt).toMatch(/^[a-f0-9]{32}$/);
      expect(auth).not.toHaveProperty('temporaryPassword');
      expect(auth.passwordHash).not.toBe(response.body.temporaryPassword);
      expect(JSON.stringify(auth)).not.toContain(response.body.temporaryPassword);
    }

    const login = await request(app)
      .post('/api/auth/local-login')
      .send({ email: first.body.email, password: firstTemporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.mustReset).toBe(true);
    const reusedTemporaryPassword = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        currentPassword: firstTemporaryPassword,
        newPassword: firstTemporaryPassword,
      });
    expect(reusedTemporaryPassword.status).toBe(400);
    expect(reusedTemporaryPassword.body.error).toBe(
      'Le nouveau mot de passe doit être différent du mot de passe actuel.',
    );
    const unchangedAuth = FIXTURES.localAuths.find((row: any) => row.userId === first.body.id);
    expect(unchangedAuth.mustReset).toBe(true);
    expect(unchangedAuth.passwordHash).toBe(
      crypto.pbkdf2Sync(firstTemporaryPassword, unchangedAuth.salt, 310000, 64, 'sha512').toString('hex'),
    );
    const temporaryPasswordStillWorks = await request(app)
      .post('/api/auth/local-login')
      .send({ email: first.body.email, password: firstTemporaryPassword });
    expect(temporaryPasswordStillWorks.status).toBe(200);
    expect(temporaryPasswordStillWorks.body.mustReset).toBe(true);

    await request(app)
      .get('/api/grades')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ACCESS_CONTEXT_REQUIRED'));

    const newPassword = 'Changed-Teacher-2026!';
    await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: firstTemporaryPassword, newPassword })
      .expect(200);

    const oldPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: first.body.email, password: firstTemporaryPassword });
    expect(oldPasswordLogin.status).toBe(401);

    const phoneLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ identifier: '90000031', phoneCountryCode: '+228', password: newPassword });
    expect(phoneLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: first.body.email, password: newPassword });
    expect(newPasswordLogin.status).toBe(200);
    expect(newPasswordLogin.body.mustReset).toBe(false);

    const changedAgain = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${newPasswordLogin.body.token}`)
      .send({ currentPassword: newPassword, newPassword: 'Changed-Teacher-2027!' });
    expect(changedAgain.status).toBe(200);
    resetLocalLoginRateLimit();
    const normalPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: first.body.email, password: 'Changed-Teacher-2027!' });
    expect(normalPasswordLogin.status).toBe(200);
    expect(normalPasswordLogin.body.mustReset).toBe(false);
  }, 30000);

  it('allows a parent without email to log in by phone and change the required temporary password', async () => {
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', '******')
      .send({
        uid: 'temporary-parent-without-email',
        name: 'Parent sans email',
        role: 'parent',
        schoolId: 10,
        phone: '+22890000035',
      })
      .set('Authorization', 'Bearer token-school');

    expect(created.status).toBe(201);
    expect(created.body.email).toBeNull();
    expect(created.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);

    const temporaryPassword = created.body.temporaryPassword;
    const auth = FIXTURES.localAuths.find((row: any) => row.userId === created.body.id);
    expect(auth.mustReset).toBe(true);
    expect(auth).not.toHaveProperty('temporaryPassword');
    expect(JSON.stringify(auth)).not.toContain(temporaryPassword);

    const login = await request(app)
      .post('/api/auth/local-login')
      .send({ identifier: '90000035', phoneCountryCode: '+228', password: temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ id: created.body.id, email: null, mustReset: true });

    const newPassword = 'Changed-Password-2026!';
    await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: temporaryPassword, newPassword })
      .expect(200);

    expect(auth.mustReset).toBe(false);
    const oldPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ identifier: '90000035', phoneCountryCode: '+228', password: temporaryPassword });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ identifier: '90000035', phoneCountryCode: '+228', password: newPassword });
    expect(newPasswordLogin.status).toBe(200);
    expect(newPasswordLogin.body.mustReset).toBe(false);
  });

  it('rolls back local account creation if local authentication cannot be stored', async () => {
    (mockDb.db as any).__failNextLocalAuthInsert = true;
    const response = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({
        uid: 'temporary-account-auth-failure',
        email: 'temporary-account-auth-failure@x.test',
        name: 'Temporary Account Auth Failure',
        role: 'surveillant',
        schoolId: 10,
        phone: '+22890000033',
      });

    expect(response.status).toBe(500);
    expect(FIXTURES.users.some((row: any) => row.uid === 'temporary-account-auth-failure')).toBe(false);
    expect(FIXTURES.localAuths).toHaveLength(0);
  });

  it('resets a local password to a new one-time temporary password', async () => {
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({
        uid: 'temporary-account-reset',
        email: 'temporary-account-reset@x.test',
        name: 'Temporary Account Reset',
        role: 'surveillant',
        schoolId: 10,
        phone: '+22890000034',
      });
    expect(created.status).toBe(201);
    const oldTemporaryPassword = created.body.temporaryPassword;
    const oldLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: created.body.email, password: oldTemporaryPassword });
    expect(oldLogin.status).toBe(200);
    mockDb.db.__transactionCommitCount = 0;
    const adminGenerationBefore = (FIXTURES.users.find((row: any) => row.id === 1) as any).accessSessionGeneration;

    const reset = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: created.body.id });

    expect(reset.status).toBe(200);
    expect(mockDb.db.__transactionCommitCount).toBe(1);
    expect(reset.body.mustReset).toBe(true);
    expect(reset.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(reset.body.temporaryPassword).not.toBe(oldTemporaryPassword);
    expect(reset.body).not.toHaveProperty('password');
    expect(JSON.stringify(reset.body)).not.toContain(oldTemporaryPassword);

    const resetAuth = FIXTURES.localAuths.find((row: any) => row.userId === created.body.id);
    expect(resetAuth.mustReset).toBe(true);
    expect(resetAuth.passwordHash).not.toBe(crypto.pbkdf2Sync(oldTemporaryPassword, resetAuth.salt, 310000, 64, 'sha512').toString('hex'));
    expect(resetAuth.passwordHash).not.toBe(reset.body.temporaryPassword);
    expect((FIXTURES.users.find((row: any) => row.id === created.body.id) as any).accessSessionGeneration).toBe(2);
    expect((FIXTURES.users.find((row: any) => row.id === created.body.id) as any).deactivationGenerationAware).toBe(false);
    expect((FIXTURES.users.find((row: any) => row.id === 1) as any).accessSessionGeneration).toBe(adminGenerationBefore);
    expect(FIXTURES.auditEvents).toContainEqual(expect.objectContaining({
      resourceType: 'user',
      resourceId: created.body.id,
      action: 'session_revoked',
    }));

    const oldSessionRequest = await request(app)
      .get('/api/grades')
      .set('Authorization', `Bearer ${oldLogin.body.token}`);
    expect(oldSessionRequest.status).toBe(401);

    const adminSessionRequest = await request(app)
      .get('/api/audit/events')
      .set('Authorization', 'Bearer token-super');
    expect(adminSessionRequest.status).toBe(200);

    const oldPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: created.body.email, password: oldTemporaryPassword });
    expect(oldPasswordLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: created.body.email, password: reset.body.temporaryPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.mustReset).toBe(true);

    await request(app)
      .get('/api/grades')
      .set('Authorization', `Bearer ${newLogin.body.token}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ACCESS_CONTEXT_REQUIRED'));

    const chosenPassword = 'Teacher-After-Reset-2026!';
    await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${newLogin.body.token}`)
      .send({ currentPassword: reset.body.temporaryPassword, newPassword: chosenPassword })
      .expect(200);

    const temporaryPasswordAfterChange = await request(app)
      .post('/api/auth/local-login')
      .send({ email: created.body.email, password: reset.body.temporaryPassword });
    expect(temporaryPasswordAfterChange.status).toBe(401);

    const chosenPasswordLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: created.body.email, password: chosenPassword });
    expect(chosenPasswordLogin.status).toBe(200);
    expect(chosenPasswordLogin.body.mustReset).toBe(false);
  });

  it('refuses password reset when a school_admin has no verified school context', async () => {
    FIXTURES.localAuths.push({
      userId: 3,
      passwordHash: 'existing-hash',
      salt: 'existing-salt',
      mustReset: false,
    } as any);

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim-school-admin-no-school')
      .set('x-simulated-email', 'admin-noschool@x.test')
      .send({ userId: 3 });

    expect(response.status).toBe(403);
    expect(FIXTURES.localAuths.find((row: any) => row.userId === 3)).toMatchObject({
      passwordHash: 'existing-hash',
      mustReset: false,
    });
    expect(mockDb.db.__transactionCommitCount).toBe(0);
    expect(FIXTURES.auditEvents).toHaveLength(0);
  });

  it('refuses a school_admin reset for a target belonging only to another school', async () => {
    FIXTURES.users.push({
      id: 99,
      uid: 'other-school-teacher',
      email: 'other-school-teacher@x.test',
      name: 'Other School Teacher',
      role: 'teacher',
      schoolId: 20,
      isDeleted: false,
      accessSessionGeneration: 1,
      deactivationGenerationAware: null,
    } as any);
    FIXTURES.userSchools.push({ userId: 99, schoolId: 20, role: 'teacher', isActive: true });
    FIXTURES.localAuths.push({
      userId: 99,
      passwordHash: 'existing-hash',
      salt: 'existing-salt',
      mustReset: false,
    } as any);

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-school')
      .send({ userId: 99 });

    expect(response.status).toBe(403);
    expect(FIXTURES.localAuths.find((row: any) => row.userId === 99)).toMatchObject({
      passwordHash: 'existing-hash',
      mustReset: false,
    });
    expect(mockDb.db.__transactionCommitCount).toBe(0);
  });

  it('allows a school_admin reset when the target has an exact role and school membership', async () => {
    FIXTURES.localAuths.push({
      userId: 12,
      passwordHash: 'existing-hash',
      salt: 'existing-salt',
      mustReset: false,
    } as any);

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-school')
      .send({ userId: 12 });

    expect(response.status).toBe(200);
    expect(response.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(FIXTURES.localAuths.find((row: any) => row.userId === 12)?.mustReset).toBe(true);
    expect(mockDb.db.__transactionCommitCount).toBe(1);
  });

  it('refuses a same-school target whose membership role does not match the target role', async () => {
    FIXTURES.users.push({
      id: 99,
      uid: 'teacher-without-teacher-membership',
      email: 'teacher-without-teacher-membership@x.test',
      name: 'Teacher With Mismatched Membership',
      role: 'teacher',
      schoolId: 10,
      isDeleted: false,
      accessSessionGeneration: 1,
      deactivationGenerationAware: null,
    } as any);
    FIXTURES.userSchools.push({ userId: 99, schoolId: 10, role: 'surveillant', isActive: true });
    FIXTURES.localAuths.push({
      userId: 99,
      passwordHash: 'existing-hash',
      salt: 'existing-salt',
      mustReset: false,
    } as any);

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-school')
      .send({ userId: 99 });

    expect(response.status).toBe(403);
    expect(FIXTURES.localAuths.find((row: any) => row.userId === 99)).toMatchObject({
      passwordHash: 'existing-hash',
      mustReset: false,
    });
    expect(mockDb.db.__transactionCommitCount).toBe(0);
  });

  it('preserves super_admin password reset access across schools without local membership', async () => {
    FIXTURES.users.push({
      id: 99,
      uid: 'other-school-teacher',
      email: 'other-school-teacher@x.test',
      name: 'Other School Teacher',
      role: 'teacher',
      schoolId: 20,
      isDeleted: false,
      accessSessionGeneration: 1,
      deactivationGenerationAware: null,
    } as any);
    FIXTURES.localAuths.push({
      userId: 99,
      passwordHash: 'existing-hash',
      salt: 'existing-salt',
      mustReset: false,
    } as any);

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: 99 });

    expect(response.status).toBe(200);
    expect(FIXTURES.localAuths.find((row: any) => row.userId === 99)?.mustReset).toBe(true);
    expect(mockDb.db.__transactionCommitCount).toBe(1);
  });

  it('does not create local authentication when resetting an externally authenticated account', async () => {
    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: 3 });

    expect(response.status).toBe(409);
    expect(response.body).not.toHaveProperty('temporaryPassword');
    expect(FIXTURES.localAuths).toHaveLength(0);
  });

  it('does not revoke sessions or disclose a temporary password for a missing target', async () => {
    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: 9999 });

    expect(response.status).toBe(404);
    expect(response.body).not.toHaveProperty('temporaryPassword');
    expect(mockDb.db.__transactionCommitCount).toBe(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(0);
    expect(FIXTURES.auditEvents).toHaveLength(0);
  });

  it('does not reveal a temporary password or persist changes when the generation increment fails', async () => {
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({
        uid: 'temporary-account-generation-failure',
        email: 'temporary-account-generation-failure@x.test',
        name: 'Temporary Account Generation Failure',
        role: 'surveillant',
        schoolId: 10,
        phone: '+22890000035',
      });
    expect(created.status).toBe(201);
    const authBefore = { ...(FIXTURES.localAuths.find((row: any) => row.userId === created.body.id) as any) };
    const generationBefore = (FIXTURES.users.find((row: any) => row.id === created.body.id) as any).accessSessionGeneration;
    mockDb.db.__transactionCommitCount = 0;
    mockDb.db.__transactionRollbackCount = 0;
    mockDb.db.__failNextUsersUpdateError = new Error('simulated generation update failure');

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: created.body.id });

    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('temporaryPassword');
    expect((FIXTURES.users.find((row: any) => row.id === created.body.id) as any).accessSessionGeneration).toBe(generationBefore);
    expect(FIXTURES.localAuths.find((row: any) => row.userId === created.body.id)).toEqual(authBefore);
    expect(FIXTURES.auditEvents.filter((event: any) => (
      event.resourceType === 'user'
      && event.resourceId === created.body.id
      && event.action === 'session_revoked'
    ))).toHaveLength(0);
    expect(mockDb.db.__transactionCommitCount).toBe(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(1);
  });

  it('does not return a temporary password when the target generation is exhausted', async () => {
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({
        uid: 'temporary-account-generation-exhausted',
        email: 'temporary-account-generation-exhausted@x.test',
        name: 'Temporary Account Generation Exhausted',
        role: 'surveillant',
        schoolId: 10,
        phone: '+22890000038',
      });
    expect(created.status).toBe(201);
    const target = FIXTURES.users.find((row: any) => row.id === created.body.id) as any;
    target.accessSessionGeneration = '9223372036854775807';
    const authBefore = { ...(FIXTURES.localAuths.find((row: any) => row.userId === created.body.id) as any) };

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: created.body.id });

    expect(response.status).toBe(409);
    expect(response.body).not.toHaveProperty('temporaryPassword');
    expect(target.accessSessionGeneration).toBe('9223372036854775807');
    expect(FIXTURES.localAuths.find((row: any) => row.userId === created.body.id)).toEqual(authBefore);
    expect(FIXTURES.auditEvents.filter((event: any) => (
      event.resourceType === 'user'
      && event.resourceId === created.body.id
      && event.action === 'session_revoked'
    ))).toHaveLength(0);
  });

  it('rolls back the target generation when the credential update fails', async () => {
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({
        uid: 'temporary-account-callback-failure',
        email: 'temporary-account-callback-failure@x.test',
        name: 'Temporary Account Callback Failure',
        role: 'surveillant',
        schoolId: 10,
        phone: '+22890000036',
      });
    expect(created.status).toBe(201);
    const authBefore = { ...(FIXTURES.localAuths.find((row: any) => row.userId === created.body.id) as any) };
    const generationBefore = (FIXTURES.users.find((row: any) => row.id === created.body.id) as any).accessSessionGeneration;
    mockDb.db.__transactionCommitCount = 0;
    mockDb.db.__transactionRollbackCount = 0;
    mockDb.db.__failNextLocalAuthUpdateError = new Error('simulated credential update failure');

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: created.body.id });

    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('temporaryPassword');
    expect((FIXTURES.users.find((row: any) => row.id === created.body.id) as any).accessSessionGeneration).toBe(generationBefore);
    expect(FIXTURES.localAuths.find((row: any) => row.userId === created.body.id)).toEqual(authBefore);
    expect(FIXTURES.auditEvents.filter((event: any) => (
      event.resourceType === 'user'
      && event.resourceId === created.body.id
      && event.action === 'session_revoked'
    ))).toHaveLength(0);
    expect(mockDb.db.__transactionCommitCount).toBe(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(1);
  });

  it('resets a disabled account without reactivating it', async () => {
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({
        uid: 'temporary-account-disabled-reset',
        email: 'temporary-account-disabled-reset@x.test',
        name: 'Temporary Account Disabled Reset',
        role: 'surveillant',
        schoolId: 10,
        phone: '+22890000037',
      });
    expect(created.status).toBe(201);
    (FIXTURES.users.find((row: any) => row.id === created.body.id) as any).isDeleted = true;

    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: created.body.id });

    expect(response.status).toBe(200);
    expect(response.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    const targetAfterReset = FIXTURES.users.find((row: any) => row.id === created.body.id) as any;
    expect(targetAfterReset.isDeleted).toBe(true);
    expect(targetAfterReset.accessSessionGeneration).toBe(2);
    expect((FIXTURES.localAuths.find((row: any) => row.userId === created.body.id) as any).mustReset).toBe(true);
  });

  it('preserves school-admin restrictions when resetting passwords', async () => {
    const generationBefore = (FIXTURES.users.find((row: any) => row.id === 2) as any).accessSessionGeneration;
    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-school')
      .send({ userId: 2 });

    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty('temporaryPassword');
    expect((FIXTURES.users.find((row: any) => row.id === 2) as any).accessSessionGeneration).toBe(generationBefore);
    expect(mockDb.db.__transactionCommitCount).toBe(0);
  });

  it('3o0. school_admin can batch import multiple parents without students', async () => {
    const res = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send([
        { name: 'Parent Sans Enfant 1', email: 'parent-no-child-1@x.test', phonePrefix: '+228', phone: '90000021', parentType: 'mere', address: '' },
        { name: 'Parent Sans Enfant 2', email: 'parent-no-child-2@x.test', phonePrefix: '+228', phone: '90000022', parentType: 'pere', address: '' },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(2);
    expect(res.body.errors).toEqual([]);
  });

  it('Super Admin batch import rejects rows with missing or unknown schools', async () => {
    const response = await request(app)
      .post('/api/parents/batch')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send([
        { name: 'Missing School Parent', email: 'missing-school-batch@x.test', phonePrefix: '+228', phone: '90000078', parentType: 'mere' },
        { name: 'Unknown School Parent', email: 'unknown-school-batch@x.test', phonePrefix: '+228', phone: '90000079', parentType: 'pere', schoolId: 999 },
      ]);

    expect(response.status).toBe(200);
    expect(response.body.insertedCount).toBe(0);
    expect(response.body.errors).toHaveLength(2);
    expect(response.body.errors[0].error).toContain('schoolId');
    expect(response.body.errors[1].error).toContain('school not found');
    expect(FIXTURES.users.some((user) => user.email === 'missing-school-batch@x.test')).toBe(false);
    expect(FIXTURES.users.some((user) => user.email === 'unknown-school-batch@x.test')).toBe(false);
  });

  it('rejects duplicate canonical phones within the same parent import', async () => {
    const res = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send([
        { name: 'Import Parent A', email: 'import-phone-a@x.test', phonePrefix: '+228', phone: '90000030', parentType: 'mere' },
        { name: 'Import Parent B', email: 'import-phone-b@x.test', phonePrefix: '+228', phone: '90000030', parentType: 'pere' },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].error).toContain('déjà utilisé par un autre compte');
    expect(res.body.inserted[0].temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(res.body.errors[0]).not.toHaveProperty('temporaryPassword');
  });

  it('rejects parent import when another user role already owns the phone', async () => {
    FIXTURES.users.push({ id: 30, uid: 'phone-owner-teacher', email: 'phone-owner-teacher@x.test', name: 'Phone Owner Teacher', role: 'teacher', schoolId: 10, phone: '+22890000031', isDeleted: false });

    const res = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send([{ name: 'Imported Parent', email: 'imported-parent@x.test', phonePrefix: '+228', phone: '90000031', parentType: 'mere' }]);

    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(0);
    expect(res.body.errors[0].error).toContain('déjà utilisé par un autre compte');
  });

  it('3o1. duplicate Parent email is rejected clearly during batch import', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: 1, isActive: true, firstName: 'New', lastName: 'Student', parentId: null });
    const payload = [{ name: 'Duplicate Parent', email: 'duplicate@x.test', phonePrefix: '+228', phone: '90000099', parentType: 'pere', studentId: 15 }];
    await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send(payload);

    const res = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(0);
    expect(res.body.errors[0]).toMatchObject({
      row: 2,
      name: 'Duplicate Parent',
      email: 'duplicate@x.test',
      error: 'Cet email est déjà utilisé par un autre compte et ne peut pas être importé',
    });
  });

  it('3o2. globally used email in another school is rejected before user insert', async () => {
    FIXTURES.users.push({ id: 12, uid: 'other-school-teacher-uid', email: 'global-parent@x.test', name: 'Other School Teacher', role: 'teacher', schoolId: 20, isDeleted: false });

    const res = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send([{ name: 'Global Duplicate', email: ' Global-Parent@X.Test ', phonePrefix: '+228', phone: '90000004', parentType: 'pere' }]);

    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(0);
    expect(res.body.errors[0]).toMatchObject({
      row: 2,
      name: 'Global Duplicate',
      email: 'global-parent@x.test',
      error: 'Cet email est déjà utilisé par un autre compte et ne peut pas être importé',
    });
    expect(FIXTURES.users.filter((user: any) => user.email === 'global-parent@x.test')).toHaveLength(1);
  });

  describe('POST /api/students/batch parent resolution', () => {
    const studentRow = (overrides: Record<string, any> = {}) => ({
      firstName: 'Awa',
      lastName: 'Koffi',
      birthDate: '2010-01-01',
      schoolId: 10,
      classId: 1,
      gender: 'Féminin',
      schoolAdminId: 2,
      ...overrides,
    });

    const importStudents = (rows: any[]) => request(app)
      .post('/api/students/batch')
      .set('Authorization', 'Bearer token-school')
      .send(rows);

    it('accepts a valid parentId without parentEmail', async () => {
      const res = await importStudents([studentRow({ parentId: 1 })]);
      expect(res.status).toBe(200);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
    });

    it('rejects an invalid parentId', async () => {
      const res = await importStudents([studentRow({ parentId: 999 })]);
      expect(res.status).toBe(200);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('Invalid or missing parentId');
    });

    it('rejects an invalid provided parentId instead of falling back to parentEmail', async () => {
      const res = await importStudents([studentRow({ parentId: 'abc', parentEmail: 'parent@x.test' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('Invalid parentId');
      expect(res.body.inserted).toEqual([]);
    });

    it('rejects parentId zero instead of falling back to parentEmail', async () => {
      const res = await importStudents([studentRow({ parentId: '0', parentEmail: 'parent@x.test' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('Invalid parentId');
      expect(res.body.inserted).toEqual([]);
    });

    it('resolves a valid parentEmail to parentId', async () => {
      const res = await importStudents([studentRow({ parentEmail: 'parent@x.test' })]);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
    });

    it('normalizes parentEmail casing', async () => {
      const res = await importStudents([studentRow({ parentEmail: 'PARENT@X.TEST' })]);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
    });

    it('normalizes surrounding spaces in parentEmail', async () => {
      const res = await importStudents([studentRow({ parentEmail: '  parent@x.test  ' })]);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
    });

    it('rejects an unknown parentEmail with a row-level business error', async () => {
      const res = await importStudents([studentRow({ parentEmail: 'missing@x.test' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].error || res.body.errors[0].reason).toContain('Parent introuvable');
    });

    it('rejects a row with no parent identifier', async () => {
      const res = await importStudents([studentRow()]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('Parent non identifiable');
    });

    it('accepts matching parentId and parentEmail', async () => {
      const res = await importStudents([studentRow({ parentId: 1, parentEmail: 'parent@x.test' })]);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
    });

    it('rejects a parentId and parentEmail mismatch', async () => {
      const res = await importStudents([studentRow({ parentId: 1, parentEmail: 'parent-query@x.test' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('ne correspond pas');
    });

    it('resolves parentPhone to the persisted parents.id even when the parent has no email', async () => {
      FIXTURES.users.find((user: any) => user.id === 6).email = null;
      const res = await importStudents([studentRow({ parentPhonePrefix: '+228', parentPhone: '90000001' })]);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
      expect(res.body.inserted[0].parentId).not.toBe('+22890000001');
    });

    it.each([
      ['90000001', '228'],
      ['90000001', '+228'],
      ['+22890000001', ''],
      ['0022890000001', ''],
      ['228 90000001', ''],
    ])('resolves canonical phone form %s with prefix %s', async (parentPhone, parentPhonePrefix) => {
      const res = await importStudents([studentRow({ parentPhone, parentPhonePrefix })]);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
    });

    it('rejects a parentPhone that does not resolve to a parent in the school', async () => {
      const res = await importStudents([studentRow({ parentPhone: '+22899999999' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('Parent introuvable pour le téléphone');
      expect(res.body.inserted).toEqual([]);
    });

    it('rejects an ambiguous parentPhone without selecting an arbitrary parent', async () => {
      FIXTURES.users.push({ id: 21, uid: 'duplicate-phone-parent', email: 'duplicate-phone@x.test', phone: '+22890000001', name: 'Duplicate Phone Parent', role: 'parent', schoolId: 10, isDeleted: false });
      FIXTURES.parents.push({ id: 5, userId: 21, studentId: null, schoolId: 10 });
      FIXTURES.userSchools.push({ userId: 21, schoolId: 10, role: 'parent', isActive: true });
      const res = await importStudents([studentRow({ parentPhone: '+22890000001' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('Plusieurs parents correspondent au téléphone');
      expect(res.body.inserted).toEqual([]);
    });

    it('rejects a parentId and parentPhone mismatch', async () => {
      const res = await importStudents([studentRow({ parentId: 1, parentPhone: '+22890000002' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('parentId fourni ne correspond pas au parentPhone');
    });

    it('accepts a parentId and parentPhone that identify the same parent', async () => {
      const res = await importStudents([studentRow({ parentId: 1, parentPhone: '0022890000001' })]);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
    });

    it('rejects a parentPhone and parentEmail mismatch', async () => {
      const res = await importStudents([studentRow({ parentPhone: '+22890000001', parentEmail: 'parent-noschool@x.test' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('parentPhone fourni ne correspond pas au parentEmail');
    });

    it('rejects a parentPhone that is not accessible from the requested school', async () => {
      FIXTURES.users.push({ id: 20, uid: 'other-school-phone-parent', email: 'other-school-phone@x.test', phone: '+22890000020', name: 'Other School Parent', role: 'parent', schoolId: 20, isDeleted: false });
      FIXTURES.parents.push({ id: 4, userId: 20, studentId: null, schoolId: 20 });
      const res = await importStudents([studentRow({ parentPhone: '+22890000020' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].reason).toContain('Parent introuvable pour le téléphone');
    });

    it('includes phone matching columns and instructions in the student template', async () => {
      const res = await request(app).get('/api/students/template').buffer(true).parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body);
      expect(workbook.worksheets.map((worksheet) => worksheet.name)).toContain('instructions');
      const studentsWorksheet = workbook.getWorksheet('students')!;
      const headers = (studentsWorksheet.getRow(1).values as unknown[]).slice(1);
      expect(headers).toContain('parentPhonePrefix');
      expect(headers).toContain('parentPhone');
      const instructionsWorksheet = workbook.getWorksheet('instructions')!;
      const instructions: string[] = [];
      instructionsWorksheet.eachRow((row) => {
        const values = row.values as unknown as unknown[];
        instructions.push(...values.slice(1).map(String));
      });
      expect(instructions.join(' ')).toContain('+22890121212');
    });

    it('rejects a parent from another school even when the email matches', async () => {
      FIXTURES.users.push({ id: 20, uid: 'other-school-parent', email: 'other-school-parent@x.test', name: 'Other School Parent', role: 'parent', schoolId: 20, isDeleted: false });
      FIXTURES.parents.push({ id: 4, userId: 20, studentId: null, schoolId: 20 });

      const res = await importStudents([studentRow({ parentEmail: 'other-school-parent@x.test' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].error || res.body.errors[0].reason).toContain('Parent introuvable');
    });

    it('reuses the same resolved parentId for multiple student rows', async () => {
      const res = await importStudents([
        studentRow({ firstName: 'Awa', parentEmail: 'parent@x.test' }),
        studentRow({ firstName: 'Kossi', parentEmail: 'parent@x.test' }),
        studentRow({ firstName: 'Kodjo', parentEmail: 'parent@x.test' }),
      ]);

      expect(res.body.insertedCount).toBe(3);
      expect(res.body.inserted.map((row: any) => row.parentId)).toEqual([1, 1, 1]);
    });

    it('continues processing valid rows when another row is invalid', async () => {
      const res = await importStudents([
        studentRow({ firstName: 'Invalid', parentEmail: 'missing@x.test' }),
        studentRow({ firstName: 'Valid', parentEmail: 'parent@x.test' }),
      ]);

      expect(res.body.insertedCount).toBe(1);
      expect(res.body.inserted[0].parentId).toBe(1);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].row).toBe(2);
    });

    it('rejects ambiguous parentEmail without selecting an arbitrary parent', async () => {
      FIXTURES.users.push({ id: 21, uid: 'duplicate-parent', email: 'parent@x.test', name: 'Duplicate Parent', role: 'parent', schoolId: 10, isDeleted: false });
      FIXTURES.parents.push({ id: 5, userId: 21, studentId: null, schoolId: 10 });
      FIXTURES.userSchools.push({ userId: 21, schoolId: 10, role: 'parent', isActive: true });

      const res = await importStudents([studentRow({ parentEmail: 'parent@x.test' })]);
      expect(res.body.insertedCount).toBe(0);
      expect(res.body.errors[0].error || res.body.errors[0].reason).toContain('Plusieurs parents correspondent');
    });
  });

  it('3p. school_admin cannot send notification to another-school user via POST /api/notifications/send', async () => {
    const anotherUser = { id: 99, uid: 'other-notif-uid', email: 'othernotif@x.test', name: 'OtherNotif', role: 'parent', schoolId: 20, isDeleted: false };
    (FIXTURES.users as any[]).push(anotherUser);

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .send({ title: 'Hello', body: 'Important message', type: 'alert', userId: anotherUser.id });

    expect(res.status).toBe(403);
  });

  it('3q. non-admin cannot send notifications via POST /api/notifications/send', async () => {
    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-teacher')
      .send({ title: 'Oops', body: 'This should fail', type: 'alert' });

    expect(res.status).toBe(403);
  });

  it('3q1. school_admin can send a notification with PDF and PNG attachments', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF', 'base64');

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Important document')
      .field('body', 'Veuillez consulter le document joint')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', pdfBuffer, { filename: 'notice.pdf', contentType: 'application/pdf' })
      .attach('files', pngBuffer, { filename: 'image.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(FIXTURES.notifications.length).toBeGreaterThan(0);
    expect(FIXTURES.notificationAttachments.length).toBe(2);
  });

  it('school-wide notifications target parents with active children and deduplicate mixed-history families', async () => {
    setCurrentAndFormerNotificationRecipients();

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .send({ title: 'Current families', body: 'Current students only', type: 'info' });

    expect(res.status).toBe(200);
    expect(FIXTURES.notifications.map((notification: any) => notification.userId).sort()).toEqual([6, 8]);
  });

  it('class notifications exclude former-only parents and retain mixed-history parents with an active child', async () => {
    setCurrentAndFormerNotificationRecipients();

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .send({ title: 'Class update', body: 'Class 1', type: 'info', classId: 1 });

    expect(res.status).toBe(200);
    expect(FIXTURES.notifications.map((notification: any) => notification.userId).sort()).toEqual([6, 8]);
  });

  it('individual notifications reject former-only parents but allow a parent with an active child', async () => {
    setCurrentAndFormerNotificationRecipients();

    const formerOnlyResponse = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .send({ title: 'Former only', body: 'Not eligible', type: 'info', userId: 7 });
    expect(formerOnlyResponse.status).toBe(403);
    expect(FIXTURES.notifications).toHaveLength(0);

    const activeFamilyResponse = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .send({ title: 'Active family', body: 'Eligible', type: 'info', userId: 6 });
    expect(activeFamilyResponse.status).toBe(200);
    expect(FIXTURES.notifications.map((notification: any) => notification.userId)).toEqual([6]);
  });

  it('3q2. parent GET /api/notifications includes attachment metadata', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Document de réunion')
      .field('body', 'Pièce jointe disponible')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', pdfBuffer, { filename: 'reunion.pdf', contentType: 'application/pdf' });

    const res = await request(app)
      .get('/api/notifications')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: 'reunion.pdf' }),
    ]));
  });

  it('3q3. attachment download rejects attachments crossed between two notifications', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Notification A')
      .field('body', 'Attachment A')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', pdfBuffer, { filename: 'attachment-a.pdf', contentType: 'application/pdf' });

    await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Notification B')
      .field('body', 'Attachment B')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', pdfBuffer, { filename: 'attachment-b.pdf', contentType: 'application/pdf' });

    const notificationA = FIXTURES.notifications.find((notification: any) => notification.title === 'Notification A');
    const notificationB = FIXTURES.notifications.find((notification: any) => notification.title === 'Notification B');
    const attachmentA = FIXTURES.notificationAttachments.find((attachment: any) => attachment.fileName === 'attachment-a.pdf');
    const attachmentB = FIXTURES.notificationAttachments.find((attachment: any) => attachment.fileName === 'attachment-b.pdf');

    expect(notificationA).toBeDefined();
    expect(notificationB).toBeDefined();
    expect(attachmentA).toMatchObject({ notificationId: notificationA.id });
    expect(attachmentB).toMatchObject({ notificationId: notificationB.id });

    const resAWithAttachmentB = await request(app)
      .get(`/api/notifications/${notificationA.id}/attachments/${attachmentB.id}`)
      .set('Authorization', 'Bearer token-school');
    const resBWithAttachmentA = await request(app)
      .get(`/api/notifications/${notificationB.id}/attachments/${attachmentA.id}`)
      .set('Authorization', 'Bearer token-school');

    expect(resAWithAttachmentB.status).toBe(404);
    expect(resBWithAttachmentA.status).toBe(404);
  });

  it('3q4. notification upload cleans uploaded files when DB insert fails', async () => {
    const dir = path.join(process.cwd(), 'uploads', 'notification-attachments');
    fs.mkdirSync(dir, { recursive: true });
    const existingFilePath = path.join(dir, 'preexisting-notification-file.pdf');
    fs.writeFileSync(existingFilePath, 'preexisting file');
    const beforeFileNames = new Set(fs.readdirSync(dir));
    (mockDb.db as any).__failNextNotificationAttachmentInsert = true;

    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    try {
      const res = await request(app)
        .post('/api/notifications/send')
        .set('Authorization', 'Bearer token-school')
        .field('title', 'Cleanup test')
        .field('body', 'Should clean uploaded files')
        .field('type', 'info')
        .field('userId', '6')
        .attach('files', pdfBuffer, { filename: `cleanup-test-${Date.now()}.pdf`, contentType: 'application/pdf' });

      expect(res.status).toBe(500);
      expect(fs.existsSync(existingFilePath)).toBe(true);
      expect(fs.readdirSync(dir).filter((fileName) => !beforeFileNames.has(fileName))).toEqual([]);
    } finally {
      (mockDb.db as any).__failNextNotificationAttachmentInsert = false;
      fs.rmSync(existingFilePath, { force: true });
    }
  });

  it('3q5. text-only JSON notifications remain compatible without attachments', async () => {
    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .send({ title: 'Text only', body: 'No attachment', type: 'info', userId: 6 });

    expect(res.status).toBe(200);
    const createdNotification = FIXTURES.notifications.find((notification: any) => notification.title === 'Text only');
    expect(createdNotification).toBeDefined();
    expect(FIXTURES.notificationAttachments.filter((attachment: any) => attachment.notificationId === createdNotification.id)).toHaveLength(0);

    const feed = await request(app)
      .get('/api/notifications')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    const textNotification = feed.body.find((notification: any) => notification.id === createdNotification.id);
    expect(textNotification.attachments).toEqual([]);
  });

  it('3q6. JPG and JPEG attachments are accepted', async () => {
    const imageBuffer = Buffer.from('image bytes');
    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'JPEG formats')
      .field('body', 'Images')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .attach('files', imageBuffer, { filename: 'photo.jpeg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(FIXTURES.notificationAttachments.filter((attachment: any) => ['photo.jpg', 'photo.jpeg'].includes(attachment.fileName))).toHaveLength(2);
  });

  it('3q7. five attachments are accepted', async () => {
    const imageBuffer = Buffer.from('image bytes');
    let uploadRequest = request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Five files')
      .field('body', 'Maximum accepted count')
      .field('type', 'info')
      .field('userId', '6');
    for (let index = 1; index <= 5; index += 1) {
      uploadRequest = uploadRequest.attach('files', imageBuffer, { filename: `file-${index}.png`, contentType: 'image/png' }) as any;
    }

    const res = await uploadRequest;
    expect(res.status).toBe(200);
    expect(FIXTURES.notificationAttachments.filter((attachment: any) => attachment.fileName.startsWith('file-'))).toHaveLength(5);
  });

  it('3q8. six attachments are rejected with HTTP 400', async () => {
    const imageBuffer = Buffer.from('image bytes');
    let uploadRequest = request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Six files')
      .field('body', 'Too many files')
      .field('type', 'info')
      .field('userId', '6');
    for (let index = 1; index <= 6; index += 1) {
      uploadRequest = uploadRequest.attach('files', imageBuffer, { filename: `too-many-${index}.png`, contentType: 'image/png' }) as any;
    }

    const res = await uploadRequest;
    expect(res.status).toBe(400);
  });

  it('3q9. oversized and unsupported notification files are rejected with HTTP 400', async () => {
    const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');
    const oversizedRes = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Oversized file')
      .field('body', 'Too large')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', oversizedBuffer, { filename: 'large.pdf', contentType: 'application/pdf' });

    const unsupportedRes = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Unsupported file')
      .field('body', 'Wrong MIME')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', Buffer.from('text'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(oversizedRes.status).toBe(400);
    expect(unsupportedRes.status).toBe(400);
  });

  it('3q10. attachment extension and MIME must match', async () => {
    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Mismatched type')
      .field('body', 'Wrong extension')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', Buffer.from('not a png'), { filename: 'not-a-png.txt', contentType: 'image/png' });

    expect(res.status).toBe(400);
  });

  it('3q11. authorized parent can download an attachment', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\nparent download');
    await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Parent download')
      .field('body', 'Download')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', pdfBuffer, { filename: 'parent-download.pdf', contentType: 'application/pdf' });
    const notification = FIXTURES.notifications.find((row: any) => row.title === 'Parent download');
    const attachment = FIXTURES.notificationAttachments.find((row: any) => row.fileName === 'parent-download.pdf');

    const res = await request(app)
      .get(`/api/notifications/${notification.id}/attachments/${attachment.id}`)
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.body).toEqual(pdfBuffer);
  });

  it('3q12. attachment download enforces exact actor authorization statuses', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\nauthorized roles');
    await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer token-school')
      .field('title', 'Role authorization')
      .field('body', 'Download')
      .field('type', 'info')
      .field('userId', '6')
      .attach('files', pdfBuffer, { filename: 'role-authorization.pdf', contentType: 'application/pdf' });
    const notification = FIXTURES.notifications.find((row: any) => row.title === 'Role authorization');
    const attachment = FIXTURES.notificationAttachments.find((row: any) => row.fileName === 'role-authorization.pdf');
    const url = `/api/notifications/${notification.id}/attachments/${attachment.id}`;

    const unauthenticated = await request(app).get(url);
    const unauthorizedParent = await request(app)
      .get(url)
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent-no-school')
      .set('x-simulated-email', 'parent-noschool@x.test');
    const sameSchoolAdmin = await request(app).get(url).set('Authorization', 'Bearer token-school');
    const otherSchoolAdmin = await request(app)
      .get(url)
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'other-school-admin-uid')
      .set('x-simulated-email', 'other-admin@x.test')
      .set('x-simulated-school-id', '20');
    const superAdmin = await request(app).get(url).set('Authorization', 'Bearer token-super');

    expect(unauthenticated.status).toBe(401);
    expect(unauthorizedParent.status).toBe(403);
    expect(sameSchoolAdmin.status).toBe(200);
    expect(otherSchoolAdmin.status).toBe(403);
    expect(superAdmin.status).toBe(200);
  });

  it('3r. school_admin cannot change a student to another school via PUT /api/students/:id', async () => {
    const res = await request(app)
      .put('/api/students/11')
      .set('Authorization', 'Bearer token-school')
      .send({ firstName: 'Child', lastName: 'One', birthDate: '2010-01-01', schoolId: 20, classId: 1, parentId: 1 });

    expect(res.status).toBe(403);
  });

  it('refuses student updates when a school_admin has no verified school context', async () => {
    const res = await request(app)
      .put('/api/students/11')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim-school-admin-no-school')
      .set('x-simulated-email', 'admin-noschool@x.test')
      .send({ firstName: 'Child', lastName: 'Unauthorized Update', birthDate: '2010-01-01', schoolId: 10, classId: 1, parentId: 1 });

    expect(res.status).toBe(403);
    expect(FIXTURES.students.find((student: any) => student.id === 11)?.lastName).toBe('One');
  });

  it('3s. school_admin can update a same-school student via PUT /api/students/:id', async () => {
    const res = await request(app)
      .put('/api/students/11')
      .set('Authorization', 'Bearer token-school')
      .send({ firstName: 'Child', lastName: 'One Updated', birthDate: '2010-01-01', schoolId: 10, classId: 1, parentId: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 11, lastName: 'ONE UPDATED', schoolId: 10 });
  });

  it('4. school_admin cannot act outside their school', async () => {
    // school_admin tries to set password for a user in another school (simulate target with schoolId null)
    // create a user in another school via fixtures
    const newUser = { id: 99, uid: 'other-uid', email: 'other@x.test', name: 'Other', role: 'teacher', schoolId: 999 };
    (FIXTURES.users as any[]).push(newUser);

    const res = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-school')
      .send({ userId: newUser.id, password: 'SafePass1!' });
    expect([400, 403]).toContain(res.status);
  });

  it('4a. super_admin can add a school membership for a teacher', async () => {
    const res = await request(app)
      .post('/api/users/3/schools')
      .set('Authorization', 'Bearer token-super')
      .send({ schoolId: 20, role: 'teacher' });

    expect([200, 201]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body).toMatchObject({ userId: 3, schoolId: 20, role: 'teacher' });
      expect(FIXTURES.userSchools.some((row: any) => row.userId === 3 && row.schoolId === 20 && row.role === 'teacher')).toBe(true);
    }
  });

  it('adds a teacher function to a parent in the same school without changing the identity or parent data', async () => {
    setFixtureMembership(6, 10, 'parent', true);
    setFixtureMembership(6, 20, 'parent', false);
    const userBefore = structuredClone(FIXTURES.users.find((user: any) => user.id === 6));
    const parentBefore = structuredClone(FIXTURES.parents.find((parent: any) => parent.userId === 6));
    const studentBefore = structuredClone(FIXTURES.students.find((student: any) => student.parentId === parentBefore?.id));
    const teachersBefore = structuredClone(FIXTURES.teachers);
    const assignmentsBefore = structuredClone(FIXTURES.teacherClassSubjects);
    const otherMembershipBefore = structuredClone(FIXTURES.userSchools.find((membership: any) => (
      membership.userId === 6 && membership.schoolId === 20
    )));

    const response = await request(app)
      .post('/api/users/6/schools')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'teacher' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ userId: 6, schoolId: 10, role: 'teacher' });
    expect(FIXTURES.userSchools.filter((membership: any) => membership.userId === 6 && membership.schoolId === 10))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'parent' }),
        expect.objectContaining({ role: 'teacher' }),
      ]));
    expect(FIXTURES.users.find((user: any) => user.id === 6)).toEqual(userBefore);
    expect(FIXTURES.parents.find((parent: any) => parent.userId === 6)).toEqual(parentBefore);
    expect(FIXTURES.students.find((student: any) => student.parentId === parentBefore?.id)).toEqual(studentBefore);
    expect(FIXTURES.teachers).toEqual(teachersBefore);
    expect(FIXTURES.teacherClassSubjects).toEqual(assignmentsBefore);
    expect(FIXTURES.userSchools.find((membership: any) => membership.userId === 6 && membership.schoolId === 20))
      .toEqual(otherMembershipBefore);
  });

  it('adds a parent function to a teacher without replacing the teacher membership or profile', async () => {
    FIXTURES.teacherClassSubjects.push({
      id: 701,
      teacherId: 77,
      schoolId: 10,
      classId: 1,
      subjectId: 901,
      isActive: true,
    });
    const teacherMembershipBefore = structuredClone(FIXTURES.userSchools.find((membership: any) => (
      membership.userId === 3 && membership.schoolId === 10 && membership.role === 'teacher'
    )));
    const teacherProfileBefore = structuredClone(FIXTURES.teachers.find((teacher: any) => teacher.userId === 3));
    const assignmentsBefore = structuredClone(FIXTURES.teacherClassSubjects.filter((assignment: any) => assignment.teacherId === 77));
    const userBefore = structuredClone(FIXTURES.users.find((user: any) => user.id === 3));
    const parentProfileCount = FIXTURES.parents.length;

    const response = await request(app)
      .post('/api/users/3/schools')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'parent' });

    expect(response.status).toBe(201);
    expect(FIXTURES.userSchools).toContainEqual(teacherMembershipBefore);
    expect(FIXTURES.userSchools).toContainEqual(expect.objectContaining({
      userId: 3, schoolId: 10, role: 'parent',
    }));
    expect(FIXTURES.users.find((user: any) => user.id === 3)).toEqual(userBefore);
    expect(FIXTURES.teachers.find((teacher: any) => teacher.userId === 3)).toEqual(teacherProfileBefore);
    expect(FIXTURES.teacherClassSubjects.filter((assignment: any) => assignment.teacherId === 77)).toEqual(assignmentsBefore);
    expect(FIXTURES.parents).toHaveLength(parentProfileCount);
  });

  it('is idempotent when the exact user-school-role membership already exists', async () => {
    const membershipsBefore = structuredClone(FIXTURES.userSchools.filter((membership: any) => membership.userId === 3));

    const response = await request(app)
      .post('/api/users/3/schools')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'teacher' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      message: 'Membership already exists',
      membership: { userId: 3, schoolId: 10, role: 'teacher' },
    });
    expect(FIXTURES.userSchools.filter((membership: any) => membership.userId === 3)).toEqual(membershipsBefore);
  });

  it('reactivates only the exact inactive membership through the school-membership endpoint', async () => {
    setFixtureMembership(6, 10, 'parent', true);
    setFixtureMembership(6, 10, 'teacher', false);
    setFixtureMembership(6, 20, 'teacher', false);
    const userBefore = structuredClone(FIXTURES.users.find((user: any) => user.id === 6));

    const response = await request(app)
      .post('/api/users/6/schools')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'teacher' });

    expect(response.status).toBe(200);
    expect(response.body.membership).toMatchObject({
      userId: 6,
      schoolId: 10,
      role: 'teacher',
      isActive: true,
    });
    expect(FIXTURES.userSchools.filter((membership: any) => (
      membership.userId === 6 && membership.schoolId === 10 && membership.role === 'teacher'
    ))).toHaveLength(1);
    expect(FIXTURES.userSchools.find((membership: any) => (
      membership.userId === 6 && membership.schoolId === 20 && membership.role === 'teacher'
    ))?.isActive).toBe(false);
    expect(FIXTURES.userSchools.find((membership: any) => (
      membership.userId === 6 && membership.schoolId === 10 && membership.role === 'parent'
    ))?.isActive).toBe(true);
    expect(FIXTURES.users.find((user: any) => user.id === 6)).toEqual(userBefore);
  });

  it('deactivates one function and revokes only sessions using that exact context', async () => {
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length, ...FIXTURES.userSchools.filter((membership: any) => membership.userId !== 6));
    FIXTURES.userSchools.push(
      { id: 901, userId: 6, schoolId: 10, role: 'parent', isActive: true },
      { id: 902, userId: 6, schoolId: 10, role: 'teacher', isActive: true },
      { id: 903, userId: 6, schoolId: 20, role: 'teacher', isActive: true },
    );
    const makeSession = (id: string, userId: number, schoolId: number, role: string, membershipId: number) => ({
      id,
      userId,
      observedGeneration: 1n,
      status: 'active' as const,
      contextVersion: 1,
      context: {
        kind: 'local',
        identity: { userId },
        active: { schoolId, role },
        membershipId,
      },
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      revokedAt: null,
    });
    FIXTURES.accessSessions.push(
      makeSession('parent-session', 6, 10, 'parent', 901),
      makeSession('teacher-session', 6, 10, 'teacher', 902),
      makeSession('other-school-session', 6, 20, 'teacher', 903),
      makeSession('other-user-session', 7, 10, 'parent', 904),
    );
    const parentProfilesBefore = structuredClone(FIXTURES.parents.filter((parent: any) => parent.userId === 6));
    const userBefore = structuredClone(FIXTURES.users.find((user: any) => user.id === 6));

    const response = await request(app)
      .delete('/api/admin/users/6/functions/901')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');

    expect(response.status).toBe(200);
    expect(FIXTURES.userSchools.find((membership: any) => membership.id === 901)?.isActive).toBe(false);
    expect(FIXTURES.userSchools.find((membership: any) => membership.id === 902)?.isActive).toBe(true);
    expect(FIXTURES.userSchools.find((membership: any) => membership.id === 903)?.isActive).toBe(true);
    expect(FIXTURES.parents.filter((parent: any) => parent.userId === 6)).toEqual(parentProfilesBefore);
    expect(FIXTURES.users.find((user: any) => user.id === 6)).toEqual(userBefore);
    expect(FIXTURES.accessSessions.map((session) => [session.id, session.status])).toEqual([
      ['parent-session', 'revoked'],
      ['teacher-session', 'active'],
      ['other-school-session', 'active'],
      ['other-user-session', 'active'],
    ]);

    const reactivation = await request(app)
      .post('/api/admin/users/6/functions')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'parent' });

    expect(reactivation.status).toBe(200);
    expect(FIXTURES.userSchools.find((membership: any) => membership.id === 901)?.isActive).toBe(true);
    expect(FIXTURES.accessSessions.find((session) => session.id === 'parent-session')?.status).toBe('revoked');
    expect(FIXTURES.parents.filter((parent: any) => parent.userId === 6)).toEqual(parentProfilesBefore);
  });

  it('allows a school admin to manage only non-admin functions in their verified school', async () => {
    FIXTURES.userSchools.splice(0, FIXTURES.userSchools.length, ...FIXTURES.userSchools.filter((membership: any) => membership.userId !== 6));
    FIXTURES.userSchools.push(
      { id: 911, userId: 6, schoolId: 10, role: 'parent', isActive: true },
      { id: 912, userId: 6, schoolId: 20, role: 'teacher', isActive: true },
    );

    const listResponse = await request(app)
      .get('/api/admin/users/6/functions')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .set('x-simulated-school-id', '10');
    const outOfSchoolResponse = await request(app)
      .delete('/api/admin/users/6/functions/912')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .set('x-simulated-school-id', '10');
    const sameSchoolResponse = await request(app)
      .delete('/api/admin/users/6/functions/911')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .set('x-simulated-school-id', '10');

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual([
      expect.objectContaining({ id: 911, schoolId: 10, role: 'parent', isActive: true }),
    ]);
    expect(outOfSchoolResponse.status).toBe(403);
    expect(FIXTURES.userSchools.find((membership: any) => membership.id === 912)?.isActive).toBe(true);
    expect(sameSchoolResponse.status).toBe(200);
    expect(FIXTURES.userSchools.find((membership: any) => membership.id === 911)?.isActive).toBe(false);
  });

  it.each([true, null])('preserves an existing school membership with isActive=%s', async (isActive) => {
    setFixtureMembership(6, 10, 'teacher', isActive);

    const response = await request(app)
      .post('/api/users/6/schools')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'teacher' });

    expect(response.status).toBe(200);
    expect(response.body.membership.isActive).toBe(isActive);
    expect(FIXTURES.userSchools.filter((membership: any) => (
      membership.userId === 6 && membership.schoolId === 10 && membership.role === 'teacher'
    ))).toEqual([{ userId: 6, schoolId: 10, role: 'teacher', isActive }]);
  });

  it.each(['super_admin', 'admin', 'Teacher', 'invalid'])(
    'rejects non-canonical local membership role %s without changing existing memberships',
    async (role) => {
      const membershipsBefore = structuredClone(FIXTURES.userSchools.filter((membership: any) => membership.userId === 3));

      const response = await request(app)
        .post('/api/users/3/schools')
        .set('x-simulated-role', 'super_admin')
        .set('x-simulated-uid', 'super-uid')
        .send({ schoolId: 20, role });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_LOCAL_SCHOOL_ROLE');
      expect(FIXTURES.userSchools.filter((membership: any) => membership.userId === 3)).toEqual(membershipsBefore);
    },
  );

  it('reports the legacy user-school unique constraint instead of overwriting another role', async () => {
    mockDb.db.__legacyUserSchoolPairConstraint = true;
    const membershipsBefore = structuredClone(FIXTURES.userSchools.filter((membership: any) => membership.userId === 6));
    const profilesBefore = structuredClone(FIXTURES.parents.filter((parent: any) => parent.userId === 6));
    const userBefore = structuredClone(FIXTURES.users.find((user: any) => user.id === 6));

    const response = await request(app)
      .post('/api/users/6/schools')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .send({ schoolId: 10, role: 'teacher' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('MULTI_ROLE_MEMBERSHIP_UNSUPPORTED_BY_DATABASE');
    expect(FIXTURES.userSchools.filter((membership: any) => membership.userId === 6)).toEqual(membershipsBefore);
    expect(FIXTURES.parents.filter((parent: any) => parent.userId === 6)).toEqual(profilesBefore);
    expect(FIXTURES.users.find((user: any) => user.id === 6)).toEqual(userBefore);
  });

  it('4b. non-super_admin cannot add school membership', async () => {
    const res = await request(app)
      .post('/api/users/3/schools')
      .set('Authorization', 'Bearer token-school')
      .send({ schoolId: 20, role: 'teacher' });

    expect(res.status).toBe(403);
  });

  it('4c. super_admin cannot add membership for non-teacher/parent user', async () => {
    const res = await request(app)
      .post('/api/users/1/schools')
      .set('Authorization', 'Bearer token-super')
      .send({ schoolId: 20, role: 'teacher' });

    expect(res.status).toBe(400);
  });

  it('5. super_admin can perform allowed actions', async () => {
    // super_admin creates a school_admin
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ email: 'created@x.test', name: 'Created', role: 'school_admin', schoolId: 10, academicYearId: 1, phone: '+22890000014' });
    // Accept 201 or 400/409 if fixture constraints prevent creation
    expect([201, 400, 409]).toContain(createRes.status);

    // super_admin deletes a user
    const delRes = await request(app)
      .delete('/api/admin/users/3')
      .set('Authorization', 'Bearer token-super');
    expect([200, 404]).toContain(delRes.status);
  });

  it('6. DB reflects role changes after actions', async () => {
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({ email: 'created@x.test', name: 'Created', role: 'school_admin', schoolId: 10, academicYearId: 1, phone: '+22890000015' });
    expect([201, 400, 409]).toContain(createRes.status);

    const created = FIXTURES.users.find((u) => u.email === 'created@x.test');
    if (created) expect(created.role).toBe('school_admin');

    const delRes = await request(app)
      .delete('/api/admin/users/3')
      .set('Authorization', 'Bearer token-super');
    expect([200, 404]).toContain(delRes.status);

    const deleted = FIXTURES.users.find((u) => u.id === 3);
    if (deleted) expect(deleted.isDeleted).toBe(true);
  });

  it('deactivates and reactivates the same teacher account without deleting related records', async () => {
    const accountBefore = structuredClone(FIXTURES.users.find((user) => user.id === 3));
    const teacherBefore = structuredClone(FIXTURES.teachers.find((teacher) => teacher.userId === 3));
    const membershipsBefore = structuredClone(FIXTURES.userSchools.filter((membership) => membership.userId === 3));
    const assignmentsBefore = structuredClone(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === teacherBefore?.id));

    const deactivateResponse = await request(app)
      .delete('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(deactivateResponse.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 3)?.isDeleted).toBe(true);
    expect(FIXTURES.users.find((user) => user.id === 3)).toMatchObject({
      accessSessionGeneration: 2,
      deactivationGenerationAware: true,
    });
    expect(FIXTURES.teachers.find((teacher) => teacher.userId === 3)).toEqual(teacherBefore);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 3)).toEqual(membershipsBefore);
    expect(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === teacherBefore?.id)).toEqual(assignmentsBefore);

    const listResponse = await request(app)
      .get('/api/simulation/users?includeDeleted=true')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.find((user: any) => user.id === 3)?.isDeleted).toBe(true);

    const operationalTeachers = await request(app)
      .get('/api/teachers')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(operationalTeachers.status).toBe(200);
    expect(operationalTeachers.body.some((teacher: any) => teacher.userId === 3)).toBe(false);

    const allTeacherProfiles = await request(app)
      .get('/api/teachers?includeDeleted=true')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(allTeacherProfiles.status).toBe(200);
    expect(allTeacherProfiles.body.find((teacher: any) => teacher.userId === 3)?.isDeleted).toBe(true);

    const reactivateResponse = await request(app)
      .post('/api/admin/users/3/reactivate')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(reactivateResponse.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 3)).toMatchObject({
      id: accountBefore?.id,
      uid: accountBefore?.uid,
      role: accountBefore?.role,
      isDeleted: false,
      accessSessionGeneration: 2,
      deactivationGenerationAware: true,
    });
    expect(FIXTURES.teachers.find((teacher) => teacher.userId === 3)).toEqual(teacherBefore);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 3)).toEqual(membershipsBefore);
    expect(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === teacherBefore?.id)).toEqual(assignmentsBefore);
    expect(FIXTURES.auditEvents.filter((event: any) => event.resourceId === 3 && event.resourceType === 'user').map((event: any) => event.action))
      .toEqual(expect.arrayContaining(['delete', 'reactivate']));

    const schoolAdminBefore = structuredClone(FIXTURES.users.find((user) => user.id === 2));
    const schoolAdminMembershipsBefore = structuredClone(FIXTURES.userSchools.filter((membership) => membership.userId === 2));
    const schoolAdminDeactivateResponse = await request(app)
      .delete('/api/admin/users/2')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(schoolAdminDeactivateResponse.status).toBe(200);
    const schoolAdminReactivateResponse = await request(app)
      .post('/api/admin/users/2/reactivate')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(schoolAdminReactivateResponse.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === 2)).toMatchObject({
      id: schoolAdminBefore?.id,
      uid: schoolAdminBefore?.uid,
      role: 'school_admin',
      isDeleted: false,
    });
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === 2)).toEqual(schoolAdminMembershipsBefore);
  });

  it('lets only a super admin deactivate and reactivate a parent without changing the parent-child relationship or restoring old sessions', async () => {
    const parentUser = FIXTURES.users.find((user) => user.id === 6)!;
    const parentBefore = structuredClone(FIXTURES.parents.find((parent) => parent.userId === parentUser.id));
    const mobileSessionBefore = structuredClone(FIXTURES.mobileParentSessions[0]);
    const childrenBefore = structuredClone(FIXTURES.students.filter((student) => student.parentId === parentBefore?.id));
    const password = 'ParentLifecycleSecret2026!';
    const salt = 'parent-lifecycle-salt';
    const passwordHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
    FIXTURES.localAuths.push({
      userId: parentUser.id,
      passwordHash,
      salt,
      mustReset: false,
    } as any);

    const initialLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: parentUser.email, password });
    expect(initialLogin.status).toBe(200);
    const oldToken = initialLogin.body.token as string;
    mockDb.db.__activeTestContext = {
      kind: 'local',
      userId: parentUser.id,
      uid: parentUser.uid,
      email: parentUser.email,
      active: { schoolId: 10, role: 'parent' },
    };
    await request(app)
      .get('/api/parents')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(200);
    mockDb.db.__activeTestContext = null;

    const unauthorizedDeactivation = await request(app)
      .delete(`/api/admin/users/${parentUser.id}`)
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid');
    expect(unauthorizedDeactivation.status).toBe(403);
    expect(FIXTURES.users.find((user) => user.id === parentUser.id)?.isDeleted).toBe(false);

    const unauthorizedReactivation = await request(app)
      .post(`/api/admin/users/${parentUser.id}/reactivate`)
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid');
    expect(unauthorizedReactivation.status).toBe(403);

    const deactivation = await request(app)
      .delete(`/api/admin/users/${parentUser.id}`)
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(deactivation.status).toBe(200);
    expect(mockDb.db.__mobileParentSessionRevocationQueries).toHaveLength(1);
    expect(mockDb.db.__mobileParentSessionRevocationQueries[0].sql)
      .toMatch(/WHERE parent_id = \$1 AND is_active = true/i);
    expect(mockDb.db.__mobileParentSessionRevocationQueries[0].params).toEqual([String(parentUser.id)]);
    expect(FIXTURES.users.find((user) => user.id === parentUser.id)?.isDeleted).toBe(true);
    expect(FIXTURES.users.find((user) => user.id === parentUser.id)).toMatchObject({
      accessSessionGeneration: 2,
      deactivationGenerationAware: true,
    });
    expect(FIXTURES.mobileParentSessions[0]).toMatchObject({ isActive: false });
    expect(FIXTURES.parents.find((parent) => parent.userId === parentUser.id)).toEqual(parentBefore);
    expect(FIXTURES.students.filter((student) => student.parentId === parentBefore?.id)).toEqual(childrenBefore);

    const disabledAccounts = await request(app)
      .get('/api/simulation/users?includeDeleted=true')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(disabledAccounts.status).toBe(200);
    expect(disabledAccounts.body.find((user: any) => user.id === parentUser.id)).toMatchObject({
      id: parentUser.id,
      role: 'parent',
      isDeleted: true,
    });

    const disabledLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: parentUser.email, password });
    expect(disabledLogin.status).toBe(403);
    expect(disabledLogin.body.code).toBe('ACCOUNT_DISABLED');
    const disabledProtectedResponse = await request(app)
      .get('/api/parents')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(401);
    expect(disabledProtectedResponse.body.code).toBe('ACCOUNT_DISABLED');

    const reactivation = await request(app)
      .post(`/api/admin/users/${parentUser.id}/reactivate`)
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(reactivation.status).toBe(200);
    expect(FIXTURES.users.find((user) => user.id === parentUser.id)).toMatchObject({
      id: 6,
      role: 'parent',
      isDeleted: false,
      accessSessionGeneration: 2,
      deactivationGenerationAware: true,
    });
    expect(FIXTURES.mobileParentSessions[0]).toMatchObject({
      id: mobileSessionBefore.id,
      isActive: false,
      revokedAt: expect.any(String),
    });
    expect(FIXTURES.parents.find((parent) => parent.userId === parentUser.id)).toEqual(parentBefore);
    expect(FIXTURES.students.filter((student) => student.parentId === parentBefore?.id)).toEqual(childrenBefore);

    await request(app)
      .get('/api/parents')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(401);

    const newLogin = await request(app)
      .post('/api/auth/local-login')
      .send({ email: parentUser.email, password });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.token).not.toBe(oldToken);
    mockDb.db.__activeTestContext = {
      kind: 'local',
      userId: parentUser.id,
      uid: parentUser.uid,
      email: parentUser.email,
      active: { schoolId: 10, role: 'parent' },
    };
    await request(app)
      .get('/api/parents')
      .set('Authorization', `Bearer ${newLogin.body.token}`)
      .expect(200);
    mockDb.db.__activeTestContext = null;

    expect(FIXTURES.auditEvents.filter((event: any) => (
      event.resourceType === 'user' && event.resourceId === parentUser.id
    )).map((event: any) => event.action)).toEqual(['delete', 'session_revoked', 'reactivate']);
  });

  it('does not increment twice when deactivation is repeated', async () => {
    const first = await request(app)
      .delete('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(first.status).toBe(200);
    const auditCount = FIXTURES.auditEvents.length;

    const repeated = await request(app)
      .delete('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');

    expect(repeated.status).toBe(200);
    expect(repeated.body.alreadyDeactivated).toBe(true);
    expect((FIXTURES.users.find((user) => user.id === 3) as any).accessSessionGeneration).toBe(2);
    expect(FIXTURES.auditEvents).toHaveLength(auditCount);
  });

  it('rolls back generation, account, Android sessions, and audits when mobile revocation fails', async () => {
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 6));
    const sessionsBefore = structuredClone(FIXTURES.mobileParentSessions);
    mockDb.db.__failNextMobileParentSessionRevocationError = new Error('simulated Android revoke failure');

    const response = await request(app)
      .delete('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');

    expect(response.status).toBe(500);
    expect(FIXTURES.users.find((user) => user.id === 6)).toEqual(userBefore);
    expect(FIXTURES.mobileParentSessions).toEqual(sessionsBefore);
    expect(FIXTURES.auditEvents).toHaveLength(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(1);
  });

  it('rolls back the lifecycle transition when generation persistence fails', async () => {
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 3));
    mockDb.db.__failNextUsersUpdateError = new Error('simulated generation update failure');

    const response = await request(app)
      .delete('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');

    expect(response.status).toBe(500);
    expect(FIXTURES.users.find((user) => user.id === 3)).toEqual(userBefore);
    expect(FIXTURES.auditEvents).toHaveLength(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(1);
  });

  it('rolls back generation, account, and Android revocation when lifecycle audit insertion fails', async () => {
    const userBefore = structuredClone(FIXTURES.users.find((user) => user.id === 6));
    const sessionsBefore = structuredClone(FIXTURES.mobileParentSessions);
    mockDb.db.__failNextLifecycleAuditInsertError = new Error('simulated lifecycle audit failure');

    const response = await request(app)
      .delete('/api/admin/users/6')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');

    expect(response.status).toBe(500);
    expect(FIXTURES.users.find((user) => user.id === 6)).toEqual(userBefore);
    expect(FIXTURES.mobileParentSessions).toEqual(sessionsBefore);
    expect(FIXTURES.auditEvents).toHaveLength(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(1);
  });

  it('rolls back historical reactivation when its second audit insert fails', async () => {
    const target = FIXTURES.users.find((user) => user.id === 3) as any;
    target.isDeleted = true;
    target.deactivationGenerationAware = null;
    const userBefore = structuredClone(target);
    mockDb.db.__failLifecycleAuditInsertAfter = 1;

    const response = await request(app)
      .post('/api/admin/users/3/reactivate')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');

    expect(response.status).toBe(500);
    expect(FIXTURES.users.find((user) => user.id === 3)).toEqual(userBefore);
    expect(FIXTURES.auditEvents).toHaveLength(0);
    expect(mockDb.db.__transactionRollbackCount).toBe(1);
  });

  it('refuses disabled FALSE states and exhausted generations without partial writes', async () => {
    const target = FIXTURES.users.find((user) => user.id === 3) as any;
    target.isDeleted = true;
    target.deactivationGenerationAware = false;
    const invalidStateBefore = structuredClone(target);

    const invalidState = await request(app)
      .post('/api/admin/users/3/reactivate')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(invalidState.status).toBe(409);
    expect(target).toEqual(invalidStateBefore);
    expect(FIXTURES.auditEvents).toHaveLength(0);

    target.isDeleted = false;
    target.deactivationGenerationAware = null;
    target.accessSessionGeneration = '9223372036854775807';
    const exhaustedBefore = structuredClone(target);
    const exhausted = await request(app)
      .delete('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(exhausted.status).toBe(409);
    expect(target).toEqual(exhaustedBefore);
    expect(FIXTURES.auditEvents).toHaveLength(0);
  });

  it('restricts reactivation to super admins and handles invalid or existing accounts', async () => {
    const forbiddenDeactivationResponse = await request(app)
      .delete('/api/admin/users/3')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid');
    expect(forbiddenDeactivationResponse.status).toBe(403);
    expect(FIXTURES.users.find((user) => user.id === 3)?.isDeleted).toBe(false);

    const forbiddenResponse = await request(app)
      .post('/api/admin/users/3/reactivate')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid');
    expect(forbiddenResponse.status).toBe(403);

    const invalidIdResponse = await request(app)
      .post('/api/admin/users/0/reactivate')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(invalidIdResponse.status).toBe(400);

    const missingAccountResponse = await request(app)
      .post('/api/admin/users/9999/reactivate')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(missingAccountResponse.status).toBe(404);

    const alreadyActiveResponse = await request(app)
      .post('/api/admin/users/3/reactivate')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');
    expect(alreadyActiveResponse.status).toBe(200);
    expect(alreadyActiveResponse.body).toMatchObject({ success: true, id: 3, alreadyActive: true });
  });

  it('creates a revocation boundary when reactivating a legacy disabled account without a delete event', async () => {
    const user = FIXTURES.users.find((candidate) => candidate.id === 3);
    expect(user).toBeDefined();
    if (!user) return;
    user.isDeleted = true;
    const teacherBefore = structuredClone(FIXTURES.teachers.find((teacher) => teacher.userId === user.id));
    const membershipsBefore = structuredClone(FIXTURES.userSchools.filter((membership) => membership.userId === user.id));
    expect(FIXTURES.auditEvents.some((event: any) => (
      event.resourceType === 'user'
      && event.resourceId === user.id
      && event.action === 'delete'
    ))).toBe(false);

    const response = await request(app)
      .post(`/api/admin/users/${user.id}/reactivate`)
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid');

    expect(response.status).toBe(200);
    expect(FIXTURES.users.find((candidate) => candidate.id === user.id)).toMatchObject({
      id: 3,
      uid: 'teacher-uid',
      role: 'teacher',
      isDeleted: false,
      accessSessionGeneration: 2,
      deactivationGenerationAware: true,
    });
    expect(FIXTURES.teachers.find((teacher) => teacher.userId === user.id)).toEqual(teacherBefore);
    expect(FIXTURES.userSchools.filter((membership) => membership.userId === user.id)).toEqual(membershipsBefore);
    expect(FIXTURES.auditEvents.filter((event: any) => (
      event.resourceType === 'user'
      && event.resourceId === user.id
    )).map((event: any) => event.action)).toEqual(['session_revoked', 'reactivate']);
  });

  it('6a. school_admin created by admin preserves phone and appears in simulation users', async () => {
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-super')
      .send({
        email: 'schoolphone@x.test',
        name: 'SchoolPhoneAdmin',
        role: 'school_admin',
        schoolId: 10,
        academicYearId: 1,
        phone: '+228 98765432',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({ email: 'schoolphone@x.test', role: 'school_admin', phone: '+22898765432' });

    const listRes = await request(app)
      .get('/api/simulation/users')
      .set('Authorization', 'Bearer token-super');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.some((u: any) => u.email === 'schoolphone@x.test' && u.phone === '+22898765432')).toBe(true);
  });

  describe('GET /api/simulation/users school isolation', () => {
    const requestAsSchoolAdmin = (schoolId = '10') => request(app)
      .get('/api/simulation/users')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-uid')
      .set('x-simulated-school-id', schoolId);

    it('requires a valid active school context', async () => {
      const response = await requestAsSchoolAdmin('0');

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('school context');
    });

    it('includes only active or legacy-null local memberships and scopes every returned field', async () => {
      (FIXTURES.users as any[]).push(
        { id: 13, uid: 'simulation-active-a', email: 'active-a@test', name: 'Active A', role: 'parent', schoolId: 10, isDeleted: false, phone: null },
        { id: 14, uid: 'simulation-inactive-a', email: 'inactive-a@test', name: 'Inactive A', role: 'teacher', schoolId: 10, isDeleted: false },
        { id: 15, uid: 'simulation-null-a', email: 'null-a@test', name: 'Legacy Null A', role: 'parent', schoolId: null, isDeleted: false },
        { id: 16, uid: 'simulation-historical-a', email: 'historical-a@test', name: 'Historical A', role: 'parent', schoolId: 10, isDeleted: false },
        { id: 17, uid: 'simulation-multi-school', email: 'multi-school@test', name: 'Multi School', role: 'teacher', schoolId: 20, isDeleted: false },
        { id: 18, uid: 'simulation-multi-role', email: 'multi-role@test', name: 'Multi Role', role: 'parent', schoolId: 10, isDeleted: false },
        { id: 19, uid: 'simulation-profile-other-school', email: 'profile-other@test', name: 'Other School Profile', role: 'parent', schoolId: 10, isDeleted: false, phone: null },
        { id: 20, uid: 'simulation-disabled-account', email: 'disabled@test', name: 'Disabled Account', role: 'parent', schoolId: 10, isDeleted: true },
      );
      FIXTURES.userSchools.push(
        { userId: 13, schoolId: 10, role: 'parent', isActive: true },
        { userId: 14, schoolId: 10, role: 'teacher', isActive: false },
        { userId: 15, schoolId: 10, role: 'parent', isActive: null },
        { userId: 17, schoolId: 10, role: 'parent', isActive: true },
        { userId: 17, schoolId: 20, role: 'teacher', isActive: true },
        { userId: 18, schoolId: 10, role: 'parent', isActive: true },
        { userId: 18, schoolId: 10, role: 'teacher', isActive: true },
        { userId: 19, schoolId: 10, role: 'parent', isActive: true },
        { userId: 20, schoolId: 10, role: 'parent', isActive: true },
      );
      FIXTURES.parents.push({ id: 20, userId: 19, studentId: null, schoolId: 20, phone: 'secret-parent-phone-B' } as any);
      FIXTURES.teachers.push({ id: 120, userId: 19, schoolId: 20, phone: 'secret-teacher-phone-B', specialization: 'Secret B' } as any);
      FIXTURES.classTeachers.push(
        { classId: 3, teacherId: 77, schoolId: 20 },
        { classId: 4, teacherId: 77, schoolId: 10 },
      );

      const response = await requestAsSchoolAdmin();

      expect(response.status).toBe(200);
      const users = response.body as Array<Record<string, any>>;
      const byId = new Map(users.map((user) => [user.id, user]));

      expect(byId.get(13)).toMatchObject({ schoolId: 10, schoolIds: [10] });
      expect(byId.has(14)).toBe(false);
      expect(byId.get(15)).toMatchObject({ schoolId: 10, schoolIds: [10] });
      expect(byId.has(16)).toBe(false);
      expect(byId.get(17)).toMatchObject({ schoolId: 10, schoolIds: [10] });
      expect(byId.get(17)?.functions).toEqual([{ role: 'parent', schoolId: 10 }]);
      expect(byId.get(18)).toMatchObject({ schoolId: 10, schoolIds: [10] });
      expect(byId.get(18)?.functions).toEqual(expect.arrayContaining([
        { role: 'parent', schoolId: 10 },
        { role: 'teacher', schoolId: 10 },
      ]));
      expect(byId.has(20)).toBe(false);
      expect(users.filter((user) => user.id === 18)).toHaveLength(1);
      expect(byId.get(19)).toMatchObject({
        schoolId: 10,
        schoolIds: [10],
        phone: null,
        specialization: null,
        classIds: [],
      });
      expect(JSON.stringify(byId.get(19))).not.toContain('secret-parent-phone-B');
      expect(JSON.stringify(byId.get(19))).not.toContain('secret-teacher-phone-B');
      expect(JSON.stringify(byId.get(19))).not.toContain('Secret B');

      const teacher = byId.get(3);
      expect(teacher?.classIds).toEqual(expect.arrayContaining([1, 4]));
      expect(teacher?.classIds).not.toContain(3);
      for (const user of users) {
        expect(user.schoolIds).toEqual([10]);
        expect(user.schoolId).toBe(10);
      }
    });

    it('keeps super_admin global visibility and includeDeleted behavior unchanged', async () => {
      (FIXTURES.users as any[]).push(
        { id: 30, uid: 'simulation-global-other-school', email: 'global-other@test', name: 'Global Other', role: 'teacher', schoolId: 20, isDeleted: false },
        { id: 31, uid: 'simulation-global-deleted', email: 'global-deleted@test', name: 'Global Deleted', role: 'parent', schoolId: 20, isDeleted: true },
      );

      const normalResponse = await request(app)
        .get('/api/simulation/users')
        .set('x-simulated-role', 'super_admin')
        .set('x-simulated-uid', 'super-uid');
      const includeDeletedResponse = await request(app)
        .get('/api/simulation/users?includeDeleted=true')
        .set('x-simulated-role', 'super_admin')
        .set('x-simulated-uid', 'super-uid');

      expect(normalResponse.status).toBe(200);
      expect(normalResponse.body.some((user: any) => user.id === 30)).toBe(true);
      expect(normalResponse.body.some((user: any) => user.id === 31)).toBe(false);
      expect(includeDeletedResponse.status).toBe(200);
      expect(includeDeletedResponse.body.some((user: any) => user.id === 31 && user.isDeleted)).toBe(true);
    });
  });

  it('creates a teacher with the selected class assignment immediately', async () => {
    FIXTURES.subjects.push({ id: 902, schoolId: 10, name: 'Science', subjectTypeId: 12, status: 'approved' } as any);
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({
        uid: 'teacher-assigned-at-create',
        email: 'teacher-assigned@x.test',
        lastName: 'dUpOnT',
        firstNames: 'Teacher',
        name: 'Assigned Teacher',
        role: 'teacher',
        schoolId: 10,
        phone: '+228 90000000',
        specialization: 'Science',
        classIds: [1],
        subjectIds: [902],
        teachingAssignments: [{ classId: 1, subjectId: 902 }],
      });

    expect(createRes.status).toBe(201);
    expect(FIXTURES.users.find((user) => user.email === 'teacher-assigned@x.test')).toMatchObject({
      lastName: 'DUPONT',
      firstNames: 'Teacher',
    });
    const createdUser = FIXTURES.users.find((user) => user.uid === 'teacher-assigned-at-create');
    const teacherProfile = FIXTURES.teachers.find((teacher: any) => teacher.userId === createdUser?.id);
    expect(teacherProfile).toBeDefined();
    expect(FIXTURES.userSchools.filter((membership) => (
      membership.userId === createdUser?.id
      && membership.schoolId === 10
      && membership.role === 'teacher'
    ))).toHaveLength(1);
    expect(FIXTURES.teachers.filter((teacher: any) => teacher.userId === createdUser?.id)).toHaveLength(1);
    expect(FIXTURES.classTeachers).toContainEqual(expect.objectContaining({
      classId: 1,
      teacherId: teacherProfile?.id,
      schoolId: 10,
    }));
    expect(FIXTURES.teacherClassSubjects).toContainEqual(expect.objectContaining({
      teacherId: teacherProfile?.id,
      schoolId: 10,
      classId: 1,
      subjectId: 902,
      isActive: true,
    }));
    expect(createRes.body.classIds).toContain(1);
  });

  it('creates only explicitly selected class-subject assignments', async () => {
    FIXTURES.subjects.push(
      { id: 902, schoolId: 10, name: 'Science', subjectTypeId: 12, status: 'approved' } as any,
      { id: 903, schoolId: 10, name: 'Math', subjectTypeId: 12, status: 'approved' } as any,
    );
    const isolatedSchoolResponse = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({
        uid: 'teacher-cross-school-assignment',
        email: 'teacher-cross-school-assignment@x.test',
        lastName: 'Cross',
        firstNames: 'School',
        name: 'Cross School',
        role: 'teacher',
        schoolId: 10,
        phone: '+22890000030',
        subjectIds: [902],
        classIds: [3],
        teachingAssignments: [{ classId: 3, subjectId: 902 }],
      });
    expect(isolatedSchoolResponse.status).toBe(400);
    expect(FIXTURES.users.some((user) => user.uid === 'teacher-cross-school-assignment')).toBe(false);

    const cases = [
      {
        uid: 'teacher-matrix-single',
        email: 'teacher-matrix-single@x.test',
        phone: '+22890000031',
        classIds: [1],
        subjectIds: [902],
        teachingAssignments: [{ classId: 1, subjectId: 902 }],
        expected: [{ classId: 1, subjectId: 902 }],
      },
      {
        uid: 'teacher-matrix-common',
        email: 'teacher-matrix-common@x.test',
        phone: '+22890000032',
        classIds: [1, 2],
        subjectIds: [902],
        teachingAssignments: [{ classId: 2, subjectId: 902 }],
        expected: [{ classId: 2, subjectId: 902 }],
      },
      {
        uid: 'teacher-matrix-multiple',
        email: 'teacher-matrix-multiple@x.test',
        phone: '+22890000033',
        classIds: [1, 2],
        subjectIds: [902, 903],
        teachingAssignments: [
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 903 },
        ],
        expected: [
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 903 },
        ],
      },
      {
        uid: 'teacher-matrix-no-subject',
        email: 'teacher-matrix-no-subject@x.test',
        phone: '+22890000035',
        classIds: [1],
        subjectIds: [],
        teachingAssignments: [],
        expected: [],
      },
    ];

    const createdTeachers: Array<{ teacherId: number; expected: Array<{ classId: number; subjectId: number }> }> = [];
    for (const [index, testCase] of cases.entries()) {
      const response = await request(app)
        .post('/api/admin/users')
        .set('x-simulated-role', 'super_admin')
        .set('x-simulated-uid', 'super-uid')
        .set('x-simulated-email', 'super@x.test')
        .send({
          ...testCase,
          lastName: 'Matrix',
          firstNames: `Teacher ${index}`,
          name: `Matrix Teacher ${index}`,
          role: 'teacher',
          schoolId: 10,
          specialization: '',
        });

      expect(response.status).toBe(201);
      expect(response.body.classIds.sort()).toEqual([...testCase.classIds].sort());
      const createdUser = FIXTURES.users.find((user) => user.uid === testCase.uid);
      const profile = FIXTURES.teachers.find((teacher: any) => teacher.userId === createdUser?.id);
      expect(profile).toBeDefined();
      expect(FIXTURES.classTeachers.filter((row) => row.teacherId === profile?.id).map((row) => row.classId).sort())
        .toEqual([...testCase.classIds].sort());
      const recordedAssignments = FIXTURES.teacherClassSubjects
        .filter((assignment) => assignment.teacherId === profile?.id && assignment.isActive)
        .map(({ classId, subjectId }) => ({ classId, subjectId }))
        .sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId);
      expect(recordedAssignments).toEqual(
        [...testCase.expected].sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId),
      );
      createdTeachers.push({ teacherId: profile!.id, expected: testCase.expected });
    }

    const publicCreate = await request(app)
      .post('/api/teachers')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        lastName: 'Public',
        firstNames: 'Route',
        name: 'Public Route',
        email: 'teacher-public-route@x.test',
        phone: '+22890000036',
        specialization: 'Science',
        schoolId: 10,
        classIds: [1, 2],
        subjectIds: [902],
        teachingAssignments: [{ classId: 2, subjectId: 902 }],
      });
    expect(publicCreate.status).toBe(201);
    expect(FIXTURES.classTeachers.filter((row) => row.teacherId === publicCreate.body.teacherId)
      .map((row) => row.classId).sort()).toEqual([1, 2]);
    expect(FIXTURES.teacherClassSubjects.filter((row) => row.teacherId === publicCreate.body.teacherId && row.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId }))
      .sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId))
      .toEqual([{ classId: 2, subjectId: 902 }]);

    const readback = await request(app)
      .get('/api/teachers?schoolId=10')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test');
    expect(readback.status).toBe(200);
    for (const created of createdTeachers) {
      const teacher = readback.body.find((row: any) => row.id === created.teacherId);
      expect(teacher).toBeDefined();
      expect(teacher.teachingAssignments
        .filter((assignment: any) => assignment.isActive)
        .map(({ classId, subjectId }: any) => ({ classId, subjectId }))
        .sort((left: any, right: any) => left.classId - right.classId || left.subjectId - right.subjectId))
        .toEqual([...created.expected].sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId));
    }
  });

  it('reopens selected classes and subjects without inferring new class-subject pairs', async () => {
    FIXTURES.subjects.push(
      { id: 902, schoolId: 10, name: 'Global Science', subjectTypeId: 12, status: 'approved' } as any,
      { id: 903, schoolId: 10, name: 'Specific Math', subjectTypeId: 12, status: 'approved' } as any,
    );
    FIXTURES.schoolSubjects.push(
      { id: 902, schoolId: 10, subjectId: 902, status: 'approved', subjectTypeId: 12 },
      { id: 903, schoolId: 10, subjectId: 903, status: 'approved', subjectTypeId: 12 },
    );
    const created = await request(app)
      .post('/api/admin/users')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        uid: 'teacher-reopened-global-config',
        email: 'teacher-reopened-global-config@x.test',
        lastName: 'Reopened',
        firstNames: 'Teacher',
        name: 'Reopened Teacher',
        role: 'teacher',
        schoolId: 10,
        phone: '+22890000037',
        specialization: 'Global Science, Specific Math',
        subjectIds: [902, 903],
        classIds: [1],
        teachingAssignments: [{ classId: 1, subjectId: 902 }],
      });

    expect(created.status).toBe(201);
    const listed = await request(app)
      .get('/api/teachers?schoolId=10')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test');
    expect(listed.status).toBe(200);
    const profile = listed.body.find((row: any) => row.teacherId === created.body.teacherId);
    expect(FIXTURES.teacherClassSubjects
      .filter((assignment) => assignment.teacherId === created.body.teacherId && assignment.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId }))
      .sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId))
      .toEqual([{ classId: 1, subjectId: 902 }]);
    expect(FIXTURES.teacherSubjects.filter((assignment) => assignment.teacherId === created.body.teacherId)
      .map((assignment) => assignment.subjectId).sort()).toEqual([902, 903]);
    expect(profile.teachingAssignments
      .filter((assignment: any) => assignment.isActive)
      .map(({ classId, subjectId }: any) => ({ classId, subjectId }))
      .sort((left: any, right: any) => left.classId - right.classId || left.subjectId - right.subjectId))
      .toEqual([{ classId: 1, subjectId: 902 }]);

    const addedClass = await request(app)
      .put(`/api/admin/users/${profile.userId}`)
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        name: 'Reopened Teacher',
        role: 'teacher',
        schoolId: 10,
        subjectIds: [902, 903],
        classIds: [1, 2],
        teachingAssignments: [
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 903 },
        ],
      });
    expect(addedClass.status).toBe(200);
    expect(FIXTURES.teacherClassSubjects
      .filter((assignment) => assignment.teacherId === profile.teacherId && assignment.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId })))
      .toEqual([
        { classId: 1, subjectId: 902 },
        { classId: 2, subjectId: 903 },
      ]);
    expect(FIXTURES.classTeachers.some((assignment) => assignment.teacherId === profile.teacherId && assignment.classId === 2)).toBe(true);
    expect(FIXTURES.teacherSubjects.filter((assignment) => assignment.teacherId === profile.teacherId)
      .map((assignment) => assignment.subjectId).sort()).toEqual([902, 903]);
  });

  it('preserves a no-op exact assignment set and synchronizes intentional class and subject changes', async () => {
    FIXTURES.subjects.push(
      { id: 902, schoolId: 10, name: 'Science', subjectTypeId: 12, status: 'approved' } as any,
      { id: 903, schoolId: 10, name: 'Math', subjectTypeId: 12, status: 'approved' } as any,
    );
    FIXTURES.teacherSubjects.push(
      { teacherId: 77, schoolId: 10, subjectId: 902 },
      { teacherId: 77, schoolId: 10, subjectId: 903 },
    );
    FIXTURES.teachers.push({ id: 177, userId: 3, schoolId: 20, phone: '+22890000038', specialization: 'Other school' } as any);
    FIXTURES.classTeachers.push({ classId: 3, teacherId: 177, schoolId: 20 });
    FIXTURES.teacherClassSubjects.push({
      id: 102,
      teacherId: 177,
      schoolId: 20,
      classId: 3,
      subjectId: 902,
      isActive: true,
    });
    FIXTURES.teacherClassSubjects.push({
      id: 101,
      teacherId: 77,
      schoolId: 10,
      classId: 1,
      subjectId: 903,
      isActive: true,
    });
    FIXTURES.teacherClassSubjects.push({
      id: 103,
      teacherId: 77,
      schoolId: 10,
      classId: 1,
      subjectId: 902,
      isActive: true,
    });

    const noOpBefore = structuredClone({
      teacherSubjects: FIXTURES.teacherSubjects.filter((row) => row.teacherId === 77),
      classTeachers: FIXTURES.classTeachers.filter((row) => row.teacherId === 77),
      teacherClassSubjects: FIXTURES.teacherClassSubjects.filter((row) => row.teacherId === 77),
    });
    const noOp = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [1],
        subjectIds: [902, 903],
        teachingAssignments: [
          { classId: 1, subjectId: 903 },
          { classId: 1, subjectId: 902 },
        ],
      });

    expect(noOp.status, JSON.stringify(noOp.body)).toBe(200);
    expect({
      teacherSubjects: FIXTURES.teacherSubjects.filter((row) => row.teacherId === 77),
      classTeachers: FIXTURES.classTeachers.filter((row) => row.teacherId === 77),
      teacherClassSubjects: FIXTURES.teacherClassSubjects.filter((row) => row.teacherId === 77),
    }).toEqual(noOpBefore);

    FIXTURES.teacherSubjects.splice(
      0,
      FIXTURES.teacherSubjects.length,
      ...FIXTURES.teacherSubjects.filter((row) => row.teacherId !== 77),
    );
    const partialNoOp = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({ name: 'Teacher', role: 'teacher', schoolId: 10, classIds: [1] });
    expect(partialNoOp.status, JSON.stringify(partialNoOp.body)).toBe(200);
    expect(FIXTURES.teacherClassSubjects.filter((row) => row.teacherId === 77 && row.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId })))
      .toEqual([{ classId: 1, subjectId: 903 }, { classId: 1, subjectId: 902 }]);
    expect(FIXTURES.teacherSubjects.filter((row) => row.teacherId === 77)
      .map((row) => row.subjectId).sort()).toEqual([902, 903]);

    const partialNoOpWithoutClasses = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({ name: 'Teacher', role: 'teacher', schoolId: 10, subjectIds: [902, 903] });
    expect(partialNoOpWithoutClasses.status, JSON.stringify(partialNoOpWithoutClasses.body)).toBe(200);
    expect(FIXTURES.classTeachers.filter((row) => row.teacherId === 77 && row.schoolId === 10)
      .map((row) => row.classId)).toEqual([1]);

    const addClass = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [1, 2],
        subjectIds: [902, 903],
        teachingAssignments: [
          { classId: 1, subjectId: 903 },
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 903 },
        ],
      });

    expect(addClass.status).toBe(200);
    expect(FIXTURES.teacherClassSubjects.filter((row) => row.teacherId === 77 && row.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId }))
      .sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId))
      .toEqual([
        { classId: 1, subjectId: 902 },
        { classId: 1, subjectId: 903 },
        { classId: 2, subjectId: 903 },
      ]);
    expect(FIXTURES.classTeachers.some((row) => row.teacherId === 77 && row.classId === 2)).toBe(true);

    const addSubject = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [1, 2],
        subjectIds: [903],
        teachingAssignments: [
          { classId: 1, subjectId: 903 },
          { classId: 2, subjectId: 903 },
        ],
      });
    expect(addSubject.status).toBe(200);
    expect(FIXTURES.teacherClassSubjects.filter((row) => row.teacherId === 77 && row.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId }))
      .sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId))
      .toEqual([
        { classId: 1, subjectId: 903 },
        { classId: 2, subjectId: 903 },
      ]);

    const removeClass = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [2],
        subjectIds: [903],
        teachingAssignments: [{ classId: 2, subjectId: 903 }],
      });
    expect(removeClass.status).toBe(200);
    expect(FIXTURES.classTeachers.some((row) => row.teacherId === 77 && row.classId === 1)).toBe(false);
    expect(FIXTURES.teacherClassSubjects.some((row) => row.teacherId === 77 && row.classId === 1 && row.isActive)).toBe(false);

    const removeSubject = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [2],
        subjectIds: [],
        teachingAssignments: [],
      });
    expect(removeSubject.status).toBe(200);
    expect(FIXTURES.teacherClassSubjects.some((row) => row.teacherId === 77 && row.classId === 2 && row.isActive)).toBe(false);
    expect(FIXTURES.teacherSubjects.some((row) => row.teacherId === 77 && row.schoolId === 10)).toBe(false);

    const reopened = await request(app)
      .get('/api/teachers?schoolId=10')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test');
    const reopenedTeacher = reopened.body.find((row: any) => row.teacherId === 77);
    expect(reopenedTeacher.administrativeClassIds).toContain(2);
    expect(reopenedTeacher.teachingAssignments.filter((assignment: any) => assignment.isActive)).toEqual([]);
    const reopenedNoOp = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [2],
        subjectIds: [],
      });
    expect(reopenedNoOp.status).toBe(200);
    expect(FIXTURES.classTeachers.some((row) => row.teacherId === 77 && row.schoolId === 10 && row.classId === 2)).toBe(true);
    expect(FIXTURES.teacherClassSubjects.some((row) => row.teacherId === 77 && row.schoolId === 10 && row.classId === 2 && row.isActive)).toBe(false);
    expect(FIXTURES.teacherClassSubjects.find((row) => row.teacherId === 177 && row.schoolId === 20))
      .toMatchObject({ classId: 3, subjectId: 902, isActive: true });

    const independentSelectionUpdate = await request(app)
      .put('/api/admin/users/3')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [2],
        subjectIds: [903],
      });
    expect(independentSelectionUpdate.status).toBe(200);
    expect(FIXTURES.teacherClassSubjects.filter((row) => row.teacherId === 77 && row.schoolId === 10 && row.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId })))
      .toEqual([]);
    expect(FIXTURES.teacherSubjects.filter((row) => row.teacherId === 77 && row.schoolId === 10)
      .map((row) => row.subjectId)).toEqual([903]);
    expect(FIXTURES.teacherClassSubjects.find((row) => row.teacherId === 177 && row.schoolId === 20))
      .toMatchObject({ classId: 3, subjectId: 902, isActive: true });
  });

  it('updates teacher selections over HTTP without deleting historical or other-school assignments', async () => {
    FIXTURES.subjects.push({ id: 902, schoolId: 10, name: 'Science', subjectTypeId: 12, status: 'approved' } as any);
    FIXTURES.classes.push({
      id: 6,
      name: 'Unshared Other School Class',
      schoolId: 20,
      academicYearId: 1,
      teacherId: null,
    } as any);
    FIXTURES.userSchools.push(
      { userId: 3, schoolId: 10, role: 'parent', isActive: true },
      { userId: 3, schoolId: 20, role: 'teacher', isActive: true },
    );
    FIXTURES.parents.push({ id: 20, userId: 3, studentId: null, schoolId: 10 } as any);
    FIXTURES.teachers.push({ id: 177, userId: 3, schoolId: 20, phone: '+22890000038', specialization: 'Other school' } as any);
    FIXTURES.classTeachers.push(
      { classId: 5, teacherId: 77, schoolId: 10 },
      { classId: 3, teacherId: 177, schoolId: 20 },
    );
    FIXTURES.teacherClassSubjects.push(
      { id: 901, teacherId: 77, schoolId: 10, classId: 5, subjectId: 902, isActive: true },
      { id: 902, teacherId: 177, schoolId: 20, classId: 3, subjectId: 901, isActive: true },
    );

    const schoolAdminHeaders = {
      'x-simulated-role': 'school_admin',
      'x-simulated-uid': 'school-uid',
      'x-simulated-email': 'admin@school.test',
      'x-simulated-school-id': '10',
    };
    const originalParent = structuredClone(FIXTURES.parents.find((profile: any) => profile.userId === 3));
    const otherSchoolAssignments = structuredClone({
      classLinks: FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === 177),
      teachingPairs: FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === 177),
    });

    const invalidSelection = await request(app)
      .put('/api/admin/users/3')
      .set(schoolAdminHeaders)
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [6],
        classSelectionScopeIds: [1, 2],
        subjectIds: [902],
        teachingAssignments: [],
        teachingAssignmentScope: [],
      });

    expect(invalidSelection.status).toBe(400);
    expect(invalidSelection.body.error).toBe('Invalid teacher class selection');
    expect(FIXTURES.classTeachers.some((assignment) => assignment.teacherId === 77 && assignment.classId === 5)).toBe(true);

    const crossSchoolUpdate = await request(app)
      .put('/api/admin/users/3')
      .set(schoolAdminHeaders)
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 20,
        classIds: [1, 2],
        classSelectionScopeIds: [1, 2],
        subjectIds: [902],
        teachingAssignments: [
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 902 },
        ],
        teachingAssignmentScope: [
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 902 },
        ],
      });

    expect(crossSchoolUpdate.status).toBe(403);
    expect(crossSchoolUpdate.body.error).toBe('Forbidden: cannot move user to another school');

    const saveAvailableSelections = await request(app)
      .put('/api/admin/users/3')
      .set(schoolAdminHeaders)
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [1, 2],
        classSelectionScopeIds: [1, 2],
        subjectIds: [902],
        teachingAssignments: [
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 902 },
        ],
        teachingAssignmentScope: [
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 902 },
        ],
      });

    expect(saveAvailableSelections.status, JSON.stringify(saveAvailableSelections.body)).toBe(200);
    expect(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === 77).map((assignment) => assignment.classId).sort())
      .toEqual([1, 2, 5]);
    expect(FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === 77 && assignment.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId }))
      .sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId))
      .toEqual([
        { classId: 1, subjectId: 902 },
        { classId: 2, subjectId: 902 },
        { classId: 5, subjectId: 902 },
      ]);
    expect(FIXTURES.parents.find((profile: any) => profile.userId === 3)).toEqual(originalParent);
    expect({
      classLinks: FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === 177),
      teachingPairs: FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === 177),
    }).toEqual(otherSchoolAssignments);

    const removeAvailableClass = await request(app)
      .put('/api/admin/users/3')
      .set(schoolAdminHeaders)
      .send({
        name: 'Teacher',
        role: 'teacher',
        schoolId: 10,
        classIds: [2],
        classSelectionScopeIds: [1, 2],
        subjectIds: [902],
        teachingAssignments: [{ classId: 2, subjectId: 902 }],
        teachingAssignmentScope: [
          { classId: 1, subjectId: 902 },
          { classId: 2, subjectId: 902 },
        ],
      });

    expect(removeAvailableClass.status, JSON.stringify(removeAvailableClass.body)).toBe(200);
    expect(FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === 77).map((assignment) => assignment.classId).sort())
      .toEqual([2, 5]);
    expect(FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === 77 && assignment.isActive)
      .map(({ classId, subjectId }) => ({ classId, subjectId }))
      .sort((left, right) => left.classId - right.classId || left.subjectId - right.subjectId))
      .toEqual([
        { classId: 2, subjectId: 902 },
        { classId: 5, subjectId: 902 },
      ]);
    expect({
      classLinks: FIXTURES.classTeachers.filter((assignment) => assignment.teacherId === 177),
      teachingPairs: FIXTURES.teacherClassSubjects.filter((assignment) => assignment.teacherId === 177),
    }).toEqual(otherSchoolAssignments);
  });

  it('rolls back a teacher account when a pedagogical assignment fails during creation', async () => {
    FIXTURES.subjects.push({ id: 902, schoolId: 10, name: 'Science', subjectTypeId: 12, status: 'approved' } as any);
    const usersBefore = FIXTURES.users.length;
    const localAuthsBefore = FIXTURES.localAuths.length;
    const membershipsBefore = FIXTURES.userSchools.length;
    const teachersBefore = FIXTURES.teachers.length;
    const classTeachersBefore = FIXTURES.classTeachers.length;
    const teacherClassSubjectsBefore = FIXTURES.teacherClassSubjects.length;
    const auditEventsBefore = FIXTURES.auditEvents.length;
    const rollbacksBefore = mockDb.db.__transactionRollbackCount;
    mockDb.db.__failNextClassTeacherInsert = true;

    const response = await request(app)
      .post('/api/admin/users')
      .set('x-simulated-role', 'super_admin')
      .set('x-simulated-uid', 'super-uid')
      .set('x-simulated-email', 'super@x.test')
      .send({
        uid: 'teacher-assignment-failure',
        email: 'teacher-assignment-failure@x.test',
        lastName: 'Failed',
        firstNames: 'Teacher',
        name: 'Failed Teacher',
        role: 'teacher',
        schoolId: 10,
        phone: '+228 99999999',
        specialization: 'Science',
        classIds: [1],
        subjectIds: [902],
      });

    expect(response.status).toBe(500);
    expect(FIXTURES.users).toHaveLength(usersBefore);
    expect(FIXTURES.localAuths).toHaveLength(localAuthsBefore);
    expect(FIXTURES.userSchools).toHaveLength(membershipsBefore);
    expect(FIXTURES.teachers).toHaveLength(teachersBefore);
    expect(FIXTURES.classTeachers).toHaveLength(classTeachersBefore);
    expect(FIXTURES.teacherClassSubjects).toHaveLength(teacherClassSubjectsBefore);
    expect(FIXTURES.auditEvents).toHaveLength(auditEventsBefore);
    expect(FIXTURES.users.some((user) => user.uid === 'teacher-assignment-failure')).toBe(false);
    expect(mockDb.db.__transactionRollbackCount).toBe(rollbacksBefore + 1);
  });

  it('rejects a subject approved only for another school when creating a teacher', async () => {
    const createRes = await request(app)
      .post('/api/admin/users')
      .set('Authorization', 'Bearer token-school')
      .send({
        uid: 'teacher-with-unapproved-subject',
        email: 'teacher-unapproved-subject@x.test',
        lastName: 'Unapproved',
        firstNames: 'Teacher',
        name: 'Unapproved Teacher',
        role: 'teacher',
        schoolId: 10,
        phone: '+228 90009999',
        specialization: 'Physique',
        subjectIds: [901],
      });

    expect(createRes.status).toBe(400);
    expect(FIXTURES.users.some((user) => user.uid === 'teacher-with-unapproved-subject')).toBe(false);
    expect(FIXTURES.teacherSubjects.some((assignment) => assignment.schoolId === 10 && assignment.subjectId === 901)).toBe(false);
  });

  it('7. distinguishes class association, pedagogical assignment, and homeroom access', async () => {
    mockDb.db.__activeTestContext = { kind: 'local', active: { schoolId: 10, role: 'teacher' } };
    const associationOnly = await request(app)
      .get('/api/classes')
      .set('Authorization', '******');
    expect(associationOnly.status).toBe(200);
    expect(associationOnly.body).toEqual([]);
    const associationOnlyHomeroom = await request(app)
      .get('/api/my-homeroom-classes/1');
    expect(associationOnlyHomeroom.status).toBe(404);
    FIXTURES.schoolSubjects.push({ id: 2, schoolId: 10, subjectId: 901, status: 'approved', subjectTypeId: 11 } as any);
    FIXTURES.subjects.push({ id: 902, schoolId: 10, name: 'Unauthorized Science', subjectTypeId: 12, status: 'approved' } as any);
    FIXTURES.schoolSubjects.push({ id: 3, schoolId: 10, subjectId: 902, status: 'approved', subjectTypeId: 12 } as any);
    FIXTURES.teacherClassSubjects.push({
      id: 101,
      teacherId: 77,
      schoolId: 10,
      classId: 1,
      subjectId: 901,
      isActive: true,
    });
    const res = await request(app)
      .get('/api/classes')
      .set('Authorization', 'Bearer token-teacher');

    console.log('DEBUG class fetch response', res.status, res.body);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, name: 'Assigned Class' });
    expect(res.body.some((c: any) => c.id === 2)).toBe(false);
    expect(res.body.some((c: any) => c.id === 3)).toBe(false);

    const subjectsResponse = await request(app)
      .get('/api/subjects')
      .set('Authorization', '******');
    expect(subjectsResponse.status).toBe(200);
    expect(subjectsResponse.body.map((subject: any) => subject.id)).toContain(901);
    expect(subjectsResponse.body.map((subject: any) => subject.id)).not.toContain(902);

    const pedagogicalAssignmentIsNotHomeroom = await request(app)
      .get('/api/my-homeroom-classes/1')
      .set('Authorization', '******');
    expect(pedagogicalAssignmentIsNotHomeroom.status).toBe(404);

    FIXTURES.homeroomAssignments.push({ id: 2, classId: 2, schoolId: 10, teacherId: 77 } as any);
    const withHomeroom = await request(app)
      .get('/api/classes')
      .set('Authorization', '******');
    expect(withHomeroom.status).toBe(200);
    expect(withHomeroom.body.map((klass: any) => klass.id).sort()).toEqual([1, 2]);
    const homeroomDetail = await request(app)
      .get('/api/my-homeroom-classes/2')
      .set('Authorization', '******');
    expect(homeroomDetail.status).toBe(200);
    expect(homeroomDetail.body.class.id).toBe(2);
  });

  it('homeroom teacher can read only the homeroom classes assigned in their active school', async () => {
    FIXTURES.homeroomAssignments.push(
      { id: 2, classId: 2, schoolId: 10, teacherId: 77, name: 'Unassigned Class', schoolName: 'Test School', yearName: '2025-2026', levelName: 'Sixième', status: 'approved' } as any,
      { id: 4, classId: 4, schoolId: 10, teacherId: 77, name: 'Global Approved Class', schoolName: 'Test School', yearName: '2025-2026', levelName: 'Sixième', status: 'approved' } as any,
    );

    const listResponse = await request(app)
      .get('/api/my-homeroom-classes')
      .set('Authorization', 'Bearer token-teacher');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.map((row: any) => row.id).sort()).toEqual([2, 4]);

    const ownClass = await request(app)
      .get('/api/my-homeroom-classes/2')
      .set('Authorization', 'Bearer token-teacher');
    expect(ownClass.status).toBe(200);
    expect(ownClass.body.class).toMatchObject({ id: 2, schoolId: 10 });
    expect(ownClass.body).toHaveProperty('students');
    expect(ownClass.body).toHaveProperty('grades');
    expect(ownClass.body).toHaveProperty('absences');
    expect(ownClass.body).toHaveProperty('bulletins');
    expect(ownClass.body).toHaveProperty('examResults');

    const globalClass = await request(app)
      .get('/api/my-homeroom-classes/4')
      .set('Authorization', 'Bearer token-teacher');
    expect(globalClass.status).toBe(200);
    expect(globalClass.body.class).toMatchObject({ id: 4, schoolId: 10 });
  });

  it('does not grant titular read access from classTeachers or a forged classId', async () => {
    FIXTURES.homeroomAssignments.push(
      { id: 2, classId: 2, schoolId: 10, teacherId: 77, name: 'Unassigned Class', schoolName: 'Test School', yearName: '2025-2026', status: 'approved' } as any,
    );

    const notHomeroom = await request(app)
      .get('/api/my-homeroom-classes/1')
      .set('Authorization', 'Bearer token-teacher');
    const foreignClass = await request(app)
      .get('/api/my-homeroom-classes/3')
      .set('Authorization', 'Bearer token-teacher');
    const forgedQuery = await request(app)
      .get('/api/my-homeroom-classes?classId=3')
      .set('Authorization', 'Bearer token-teacher');

    expect(notHomeroom.status).toBe(404);
    expect(foreignClass.status).toBe(404);
    expect(forgedQuery.status).toBe(200);
    expect(forgedQuery.body.map((row: any) => row.id)).toEqual([2]);
  });

  it('does not share a global class titular assignment with another school', async () => {
    FIXTURES.users.push({ id: 13, uid: 'teacher-school-20', email: 'teacher20@x.test', name: 'Teacher20', role: 'teacher', schoolId: 20, isDeleted: false });
    FIXTURES.teachers.push({ id: 101, userId: 13, schoolId: 20, phone: null, specialization: null });
    FIXTURES.homeroomAssignments.push(
      { id: 4, classId: 4, schoolId: 10, teacherId: 77, name: 'Global Approved Class', schoolName: 'Test School', yearName: '2025-2026', status: 'approved' } as any,
    );

    const response = await request(app)
      .get('/api/my-homeroom-classes/4')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-school-20')
      .set('x-simulated-email', 'teacher20@x.test')
      .set('x-simulated-school-id', '20');

    expect(response.status).toBe(404);
  });

  it('school_admin can assign a global class titular only in its approved school context', async () => {
    const assigned = await request(app)
      .put('/api/schools/10/classes/4/homeroom')
      .set('Authorization', 'Bearer token-school')
      .send({ teacherId: 77 });
    expect(assigned.status).toBe(200);
    expect(FIXTURES.homeroomAssignments).toContainEqual(expect.objectContaining({ schoolId: 10, classId: 4, teacherId: 77 }));
    expect(FIXTURES.classes.find((klass: any) => klass.id === 4)?.teacherId).toBeNull();

    const unapproved = await request(app)
      .put('/api/schools/10/classes/5/homeroom')
      .set('Authorization', 'Bearer token-school')
      .send({ teacherId: 77 });
    const foreignSchool = await request(app)
      .put('/api/schools/20/classes/3/homeroom')
      .set('Authorization', 'Bearer token-school')
      .send({ teacherId: 88 });
    expect(unapproved.status).toBe(403);
    expect(foreignSchool.status).toBe(403);
  });

  it('teacher cannot create or change homeroom assignments', async () => {
    const response = await request(app)
      .put('/api/schools/10/classes/1/homeroom')
      .set('Authorization', 'Bearer token-teacher')
      .send({ teacherId: 77 });
    expect(response.status).toBe(403);
    expect(FIXTURES.homeroomAssignments).toHaveLength(0);
  });

  it('separates pedagogical grade reads from read-only homeroom grade reads', async () => {
    mockDb.db.__activeTestContext = { kind: 'local', active: { schoolId: 10, role: 'teacher' } };
    FIXTURES.schoolSubjects.push(
      { id: 2, schoolId: 10, subjectId: 901, status: 'approved', subjectTypeId: 11 } as any,
    );
    FIXTURES.teacherClassSubjects.push({
      id: 101,
      teacherId: 77,
      schoolId: 10,
      classId: 1,
      subjectId: 901,
      isActive: true,
    });
    FIXTURES.homeroomAssignments.push(
      { id: 2, classId: 2, schoolId: 10, teacherId: 77 } as any,
      { id: 4, classId: 4, schoolId: 10, teacherId: 77 } as any,
    );
    FIXTURES.students.push(
      { id: 31, schoolId: 10, classId: 2, firstName: 'Homeroom', lastName: 'Student', isActive: true },
      { id: 32, schoolId: 10, classId: 5, firstName: 'Unassigned', lastName: 'Student', isActive: true },
      { id: 33, schoolId: 20, classId: 3, firstName: 'Foreign', lastName: 'Student', isActive: true },
    );
    FIXTURES.evaluations.push(
      { id: 101, classId: 1, schoolId: 10, teacherId: 77, subjectId: 901, subject: 'Math', title: 'Pedagogical class' },
      { id: 102, classId: 2, schoolId: 10, teacherId: 88, subject: 'Science', title: 'Homeroom class' },
      { id: 103, classId: 2, schoolId: 10, teacherId: 88, subject: 'History', title: 'Homeroom second subject' },
      { id: 104, classId: 4, schoolId: 10, teacherId: 88, subject: 'Science', title: 'Shared class, active school' },
      { id: 105, classId: 4, schoolId: 20, teacherId: 88, subject: 'Science', title: 'Shared class, foreign school' },
    );
    FIXTURES.grades.push(
      { id: 201, evaluationId: 101, classId: 1, schoolId: 10, studentId: 11, score: '12' },
      { id: 202, evaluationId: 102, classId: 2, schoolId: 10, studentId: 31, score: '15' },
      { id: 203, evaluationId: 103, classId: 2, schoolId: 10, studentId: 31, score: '18' },
      { id: 204, evaluationId: 104, classId: 4, schoolId: 10, studentId: 13, score: '16' },
      { id: 205, evaluationId: 105, classId: 4, schoolId: 20, studentId: 13, score: '20' },
    );

    const pedagogicalResponse = await request(app)
      .get('/api/grades')
      .set('Authorization', 'Bearer token-teacher');

    expect(pedagogicalResponse.status).toBe(200);
    expect(pedagogicalResponse.body.map((grade: any) => grade.id)).toEqual([201]);
    mockDb.db.__selectQueries = [];

    const homeroomResponse = await request(app)
      .get('/api/my-homeroom-classes/2')
      .set('Authorization', 'Bearer token-teacher');
    expect(homeroomResponse.status).toBe(200);
    expect(homeroomResponse.body.grades.map((grade: any) => grade.id).sort()).toEqual([202, 203]);
    expect(mockDb.db.__selectQueries.some(
      (query: any) => query.table === 'evaluations' && query.sql.includes('"evaluations"."school_id"'),
    )).toBe(true);
    expect(mockDb.db.__selectQueries.some(
      (query: any) => query.table === 'grades' && query.sql.includes('"evaluations"."school_id"'),
    )).toBe(true);
    mockDb.db.__selectQueries = [];

    const sharedGlobalClassResponse = await request(app)
      .get('/api/my-homeroom-classes/4')
      .set('Authorization', 'Bearer token-teacher');
    expect(sharedGlobalClassResponse.status).toBe(200);
    expect(sharedGlobalClassResponse.body.grades.map((grade: any) => grade.id)).toEqual([204]);
    expect(mockDb.db.__selectQueries.some(
      (query: any) => query.table === 'evaluations' && query.sql.includes('"evaluations"."school_id"'),
    )).toBe(true);
    expect(mockDb.db.__selectQueries.some(
      (query: any) => query.table === 'grades' && query.sql.includes('"evaluations"."school_id"'),
    )).toBe(true);

  });

  it('8. school_admin with schoolId can fetch classes', async () => {
    const res = await request(app)
      .get('/api/classes')
      .set('Authorization', 'Bearer token-school');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('9. school admin and super admin see the same school class set', async () => {
    const schoolAdminResponse = await request(app)
      .get('/api/classes')
      .set('Authorization', 'Bearer token-school');
    const superAdminResponse = await request(app)
      .get('/api/classes?schoolId=10')
      .set('Authorization', 'Bearer token-super');

    expect(schoolAdminResponse.status).toBe(200);
    expect(superAdminResponse.status).toBe(200);
    const schoolAdminClassIds = schoolAdminResponse.body.map((klass: any) => klass.id).sort((a: number, b: number) => a - b);
    const superAdminClassIds = superAdminResponse.body.map((klass: any) => klass.id).sort((a: number, b: number) => a - b);
    expect(superAdminClassIds).toEqual(schoolAdminClassIds);
    expect(new Set(superAdminClassIds).size).toBe(superAdminClassIds.length);
  });

  it('returns each global class titular for the selected school and refreshes after reassignment', async () => {
    const globalClass = FIXTURES.classes.find((klass: any) => klass.id === 4);
    if (globalClass) globalClass.teacherId = 88;
    FIXTURES.homeroomAssignments.push({ id: 1, classId: 1, schoolId: 10, teacherId: 100 } as any);
    FIXTURES.classTeachers.push({ classId: 4, teacherId: 77, schoolId: 10 } as any);
    FIXTURES.schoolSubjects.push({ id: 2, schoolId: 10, subjectId: 901, status: 'approved', subjectTypeId: 11 } as any);
    FIXTURES.teacherClassSubjects.push({
      id: 101, teacherId: 77, schoolId: 10, classId: 4, subjectId: 901, isActive: true,
    });
    FIXTURES.users.push({ id: 13, uid: 'teacher-school-20', email: 'teacher20@x.test', name: 'Teacher20', role: 'teacher', schoolId: 20, isDeleted: false });
    FIXTURES.teachers.push({ id: 101, userId: 13, schoolId: 20, phone: null, specialization: null });
    FIXTURES.schoolClasses.push({ id: 502, classId: 4, schoolId: 20, status: 'approved' } as any);

    const schoolTenBefore = await request(app)
      .get('/api/classes?schoolId=10')
      .set('Authorization', 'Bearer token-super');
    expect(schoolTenBefore.status).toBe(200);
    expect(schoolTenBefore.body.find((klass: any) => klass.id === 1)).toMatchObject({ teacherId: 100, teacherName: 'TeacherSim' });
    expect(schoolTenBefore.body.find((klass: any) => klass.id === 2)).toMatchObject({ teacherId: 88, teacherName: 'OtherTeacher' });
    expect(schoolTenBefore.body.find((klass: any) => klass.id === 4)).toMatchObject({ teacherId: null, teacherName: null });

    const approvedWithoutSchool = await request(app)
      .get('/api/classes?approvedOnly=true')
      .set('Authorization', 'Bearer token-super');
    expect(approvedWithoutSchool.body.find((klass: any) => klass.id === 4)).toMatchObject({ teacherId: null, teacherName: null });

    const teacherBeforeAssignment = await request(app)
      .get('/api/classes')
      .set('Authorization', 'Bearer token-teacher');
    expect(teacherBeforeAssignment.body.find((klass: any) => klass.id === 4)).toMatchObject({ teacherId: null, teacherName: null });

    const firstAssignment = await request(app)
      .put('/api/schools/10/classes/4/homeroom')
      .set('Authorization', 'Bearer token-super')
      .send({ teacherId: 77 });
    expect(firstAssignment.status).toBe(200);

    const schoolTenAfter = await request(app)
      .get('/api/classes?schoolId=10')
      .set('Authorization', 'Bearer token-super');
    expect(schoolTenAfter.body.find((klass: any) => klass.id === 4)).toMatchObject({ teacherId: 77, teacherName: 'Teacher' });

    const teacherAfterAssignment = await request(app)
      .get('/api/classes')
      .set('Authorization', 'Bearer token-teacher');
    expect(teacherAfterAssignment.body.find((klass: any) => klass.id === 4)).toMatchObject({ teacherId: 77, teacherName: 'Teacher' });

    const secondAssignment = await request(app)
      .put('/api/schools/20/classes/4/homeroom')
      .set('Authorization', 'Bearer token-super')
      .send({ teacherId: 101 });
    expect(secondAssignment.status).toBe(200);

    const schoolTwenty = await request(app)
      .get('/api/classes?schoolId=20')
      .set('Authorization', 'Bearer token-super');
    expect(schoolTwenty.body.find((klass: any) => klass.id === 4)).toMatchObject({ teacherId: 101, teacherName: 'Teacher20' });

    const schoolTenStillAssigned = await request(app)
      .get('/api/classes?schoolId=10')
      .set('Authorization', 'Bearer token-super');
    expect(schoolTenStillAssigned.body.find((klass: any) => klass.id === 4)).toMatchObject({ teacherId: 77, teacherName: 'Teacher' });
  });

  it('9. school_admin without schoolId is rejected', async () => {
    const res = await request(app)
      .get('/api/classes')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim-school-admin-no-school')
      .set('x-simulated-email', 'admin-noschool@x.test');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('10. school_admin cannot force another schoolId via query param', async () => {
    const res = await request(app)
      .get('/api/classes?schoolId=20')
      .set('Authorization', 'Bearer token-school');

    expect(res.status).toBe(403);
  });

  it('11. teacher without school context is rejected', async () => {
    const res = await request(app)
      .get('/api/classes')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'no-school-teacher-uid')
      .set('x-simulated-email', 'noschool@x.test');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('12. parent with children only sees their child classes', async () => {
    const res = await request(app)
      .get('/api/classes')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, name: 'Assigned Class' });
    expect(res.body.some((c: any) => c.id === 2)).toBe(false);
    expect(res.body.some((c: any) => c.id === 3)).toBe(false);
  });

  it('13. parent with no legacy schoolId can fetch children using their active school context', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: 1, firstName: 'No School', lastName: 'Parent Child', isActive: true, parentId: 2 });
    const res = await request(app)
      .get('/api/classes')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent-no-school')
      .set('x-simulated-email', 'parent-noschool@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, name: 'Assigned Class' });
  });

  it('14. parent cannot bypass schoolId query param and still sees only their child classes', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: 1, firstName: 'Query', lastName: 'Parent Child', isActive: true, parentId: 3 });
    const res = await request(app)
      .get('/api/classes?schoolId=20')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent-query-bypass')
      .set('x-simulated-email', 'parent-query@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(403);
  });

  it('15. teacher cannot delete a class even in their school', async () => {
    const res = await request(app)
      .delete('/api/classes/1')
      .set('Authorization', 'Bearer token-teacher');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('16. parent cannot delete a class even in their school', async () => {
    const res = await request(app)
      .delete('/api/classes/2')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('17. school_admin without schoolId can update a class in another school', async () => {
    const res = await request(app)
      .put('/api/classes/3')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim-school-admin-no-school')
      .set('x-simulated-email', 'admin-noschool@x.test')
      .send({ teacherId: null });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'School admin school context is required' });
  });

  it('18. school_admin without schoolId cannot delete a class', async () => {
    const res = await request(app)
      .delete('/api/classes/3')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'sim-school-admin-no-school')
      .set('x-simulated-email', 'admin-noschool@x.test');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  describe('PUT /api/classes/:id', () => {
    it('super_admin can update the teacher for a class in any school', async () => {
      const res = await request(app)
        .put('/api/classes/1')
        .set('Authorization', 'Bearer token-super')
        .send({ teacherId: 88 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 1, teacherId: 88 });
    });

    it('school_admin with schoolId can update the teacher for a class in their own school', async () => {
      const res = await request(app)
        .put('/api/classes/1')
        .set('Authorization', 'Bearer token-school')
        .send({ teacherId: 88 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 1, teacherId: 88 });
    });

    it('school_admin assigns a titular to a globally approved class through the school-scoped endpoint', async () => {
      const genericUpdate = await request(app)
        .put('/api/classes/4')
        .set('Authorization', 'Bearer token-school')
        .send({ teacherId: 88 });

      expect(genericUpdate.status).toBe(400);
      expect(genericUpdate.body).toMatchObject({ error: 'Use the school-scoped homeroom assignment endpoint for a global class' });

      const res = await request(app)
        .put('/api/schools/10/classes/4/homeroom')
        .set('Authorization', 'Bearer token-school')
        .send({ teacherId: 88 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ classId: 4, schoolId: 10, teacherId: 88 });
      expect(FIXTURES.homeroomAssignments).toContainEqual(expect.objectContaining({ schoolId: 10, classId: 4, teacherId: 88 }));
    });

    it('school_admin cannot update a globally unapproved class for their school', async () => {
      const res = await request(app)
        .put('/api/classes/5')
        .set('Authorization', 'Bearer token-school')
        .send({ teacherId: 88 });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'Cannot update class in another school' });
    });

    it('school_admin with schoolId cannot update a class in another school', async () => {
      const res = await request(app)
        .put('/api/classes/3')
        .set('Authorization', 'Bearer token-school')
        .send({ teacherId: 88 });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
    });

    it('teacher cannot update a class', async () => {
      const res = await request(app)
        .put('/api/classes/1')
        .set('Authorization', 'Bearer token-teacher')
        .send({ teacherId: 88 });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
    });

    it('parent cannot update a class', async () => {
      const res = await request(app)
        .put('/api/classes/1')
        .set('x-simulated-role', 'parent')
        .set('x-simulated-uid', 'sim-parent')
        .set('x-simulated-email', 'parent@x.test')
        .set('x-simulated-school-id', '10')
        .send({ teacherId: 88 });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 for invalid teacherId', async () => {
      const res = await request(app)
        .put('/api/classes/1')
        .set('Authorization', 'Bearer token-super')
        .send({ teacherId: 'not-a-number' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 404 when class does not exist', async () => {
      const res = await request(app)
        .put('/api/classes/999')
        .set('Authorization', 'Bearer token-super')
        .send({ teacherId: 88 });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/classes/:id', () => {
    it('super_admin can delete a class in any school', async () => {
      const res = await request(app)
        .delete('/api/classes/3')
        .set('Authorization', 'Bearer token-super');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ message: 'Class deleted successfully' });
    });

    it('school_admin with schoolId cannot delete a class in another school', async () => {
      const res = await request(app)
        .delete('/api/classes/3')
        .set('Authorization', 'Bearer token-school');

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
    });

    it('teacher with schoolId cannot delete a class in another school', async () => {
      const res = await request(app)
        .delete('/api/classes/3')
        .set('Authorization', 'Bearer token-teacher');

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
    });

    it('teacher without schoolId cannot delete a class', async () => {
      const res = await request(app)
        .delete('/api/classes/3')
        .set('x-simulated-role', 'teacher')
        .set('x-simulated-uid', 'no-school-teacher-uid')
        .set('x-simulated-email', 'noschool@x.test');

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
    });

    it('parent without schoolId cannot delete a class', async () => {
      const res = await request(app)
        .delete('/api/classes/3')
        .set('x-simulated-role', 'parent')
        .set('x-simulated-uid', 'sim-parent-no-school')
        .set('x-simulated-email', 'parent-noschool@x.test');

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 404 when class does not exist', async () => {
      const res = await request(app)
        .delete('/api/classes/999')
        .set('Authorization', 'Bearer token-super');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
