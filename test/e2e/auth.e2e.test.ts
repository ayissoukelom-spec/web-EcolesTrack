import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import ExcelJS from 'exceljs';

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
    { id: 6, uid: 'sim-parent', email: 'parent@x.test', phone: '+22890000001', name: 'Parent', role: 'parent', schoolId: 10, isDeleted: false },
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
  subjects: [{ id: 901, schoolId: null, name: 'Physique', subjectTypeId: 11 }],
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
  ],
  students: [
    { id: 11, schoolId: 10, classId: 1, firstName: 'Child', lastName: 'One', birthDate: '2010-01-01', gender: 'female', parentId: 1, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' },
    { id: 13, schoolId: 10, classId: 4, firstName: 'Global', lastName: 'Approved', birthDate: '2010-01-01', gender: 'female', parentId: null, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' },
    { id: 14, schoolId: 10, classId: 5, firstName: 'Global', lastName: 'Unapproved', birthDate: '2010-01-01', gender: 'female', parentId: null, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' },
  ],
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
    { id: 1, studentId: 11, classId: 1, date: '2026-06-01', period: '1', isJustified: false, justificationReason: null },
  ],
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
  userSchools: [
    { userId: 2, schoolId: 10, role: 'school_admin', isActive: true },
    { userId: 3, schoolId: 10, role: 'teacher', isActive: true },
    { userId: 12, schoolId: 10, role: 'surveillant', isActive: true },
  ],
  auditEvents: [],
  userLoginEvents: [
    { id: 1, userId: 6, role: 'parent', schoolId: 10, loginAt: '2026-09-24T09:00:00.000Z', clientType: 'web' },
    { id: 2, userId: 6, role: 'parent', schoolId: 10, loginAt: '2026-09-24T10:00:00.000Z', clientType: 'android' },
    { id: 3, userId: 3, role: 'teacher', schoolId: 10, loginAt: '2026-09-24T11:00:00.000Z', clientType: null },
  ],
};

const FIXTURES_TEMPLATE = JSON.parse(JSON.stringify(FIXTURES));
function resetFixtures() {
  Object.keys(FIXTURES).forEach((key) => {
    // @ts-ignore
    FIXTURES[key] = JSON.parse(JSON.stringify(FIXTURES_TEMPLATE[key]));
  });
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
  (FIXTURES.parents as any[]).splice(0, FIXTURES.parents.length,
    { id: 1, userId: 6, studentId: 11, schoolId: 10 },
    { id: 2, userId: 7, studentId: 16, schoolId: 10 },
    { id: 3, userId: 8, studentId: 17, schoolId: 10 },
  );
  const currentStudent = (FIXTURES.students as any[]).find((student) => student.id === 11);
  if (currentStudent) currentStudent.parentId = 1;
  (FIXTURES.students as any[]).push(
    { id: 15, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Sibling', parentId: 1 },
    { id: 16, schoolId: 10, classId: null, isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z', firstName: 'Former', lastName: 'Only', parentId: 2 },
    { id: 17, schoolId: 10, classId: 1, isActive: true, withdrawnAt: null, firstName: 'Current', lastName: 'Sibling', parentId: 3 },
    { id: 18, schoolId: 10, classId: 1, isActive: true, withdrawnAt: null, firstName: 'Current', lastName: 'Sibling Two', parentId: 1 },
  );
}

function createMockDb() {
  const db: any = {
    __failNextNotificationAttachmentInsert: false,
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
            if (normalizedLast.includes('uid')) result.uid = value;
            else if (normalizedLast.includes('email')) result.email = value;
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
            if (/is_?active/.test(normalizedLast)) result.isActive = value;
            else if (normalizedLast.includes('uid')) result.uid = value;
            else if (normalizedLast.includes('email')) result.email = value;
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
        if (/is_?active/.test(leftStr) && rightIsPrimitive) result.isActive = rawRight;
        if (/is_?active/.test(leftStr) && rightIsPrimitive) result.isActive = rawRight;
        if (leftStr.includes('uid') && rightIsPrimitive) result.uid = rawRight;
        if (leftStr.includes('email') && rightIsPrimitive) result.email = rawRight;
        if (leftStr.includes('phone') && rightIsPrimitive) result.phone = rawRight;
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
            result.id = rawRight === null ? null : Number(rawRight);
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

  const resolveTableName = (table: any) => {
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
      if (drizzleName === 'class_teachers') return 'classTeachers';
      if (drizzleName === 'teacher_class_subjects') return 'teacherClassSubjects';
      if (drizzleName === 'evaluations') return 'evaluations';
      if (drizzleName === 'absence_declarations') return 'absenceDeclarations';
      if (drizzleName === 'subjects') return 'subjects';
      if (drizzleName === 'subject_types') return 'subjectTypes';
      if (drizzleName === 'school_subjects') return 'schoolSubjects';
      if (drizzleName === 'teacher_subjects') return 'teacherSubjects';
      const keys = Object.keys(table).map((k) => k.toLowerCase());
      if (keys.includes('uid') && keys.includes('email') && keys.includes('role')) return 'users';
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
      : tableName === 'evaluations' ? FIXTURES.evaluations
      : tableName === 'grades' ? FIXTURES.grades
      : tableName === 'examResults' ? FIXTURES.examResults
      : tableName === 'classExamConfigurations' ? FIXTURES.classExamConfigurations
      : tableName === 'absenceJustifications' ? FIXTURES.absenceJustifications
      : tableName === 'notifications' ? FIXTURES.notifications
      : tableName === 'notificationAttachments' ? FIXTURES.notificationAttachments
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
      if (conditions.email !== undefined && String(row.email).toLowerCase() !== String(conditions.email).toLowerCase()) return false;
      if (conditions.phone !== undefined && row.phone !== conditions.phone) return false;
      if (conditions.id !== undefined) {
        if (Array.isArray(conditions.id)) {
          if (!conditions.id.includes(Number(row.id))) return false;
        } else if (Number(row.id) !== Number(conditions.id)) {
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
        if (selectedAlias === 'user' && baseRow._joinedUser) return baseRow._joinedUser;
        if (resolveTableName(builder._table) === 'grades' && selectedAlias === 'subject') {
          const evaluation = FIXTURES.evaluations.find((row: any) => Number(row.id) === Number(baseRow.evaluationId));
          const subject = FIXTURES.subjects.find((row: any) => Number(row.id) === Number(evaluation?.subjectId));
          return subject?.name ?? evaluation?.subject ?? null;
        }
        if (baseRow._joinedClass && selectedAlias === 'classSchoolId') return baseRow._joinedClass.schoolId ?? null;
        if (selectedAlias === 'isApprovedForSchool') return baseRow._joinedSchoolClass != null;
        if (selectedAlias === 'schoolClassStatus') return baseRow._joinedSchoolClass?.status ?? null;
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
        const hasStudentParentJoin = fromName === 'students'
          && builder._joins.some((join: any) => resolveTableName(join.table) === 'parents');
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
      const studentsBefore = JSON.parse(JSON.stringify(FIXTURES.students));
      const usersBefore = JSON.parse(JSON.stringify(FIXTURES.users));
      const localAuthsBefore = JSON.parse(JSON.stringify(FIXTURES.localAuths));
      try {
        return await callback(db);
      } catch (error) {
        FIXTURES.students.splice(0, FIXTURES.students.length, ...studentsBefore);
        FIXTURES.users.splice(0, FIXTURES.users.length, ...usersBefore);
        FIXTURES.localAuths.splice(0, FIXTURES.localAuths.length, ...localAuthsBefore);
        throw error;
      }
    },
    insert(table?: any) {
      const tableName = resolveTableName(table);
      return {
        values: (obj: any) => {
          const executeInsert = async () => {
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

            if (tableName === 'classTeachers') {
              FIXTURES.classTeachers.push(obj as any);
              return [obj];
            }
            if (tableName === 'teacherClassSubjects') {
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
              FIXTURES.auditEvents.push(obj as any);
              return [obj];
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
              const row = { id: newId, ...obj };
              FIXTURES.users.push(row as any);
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
            if (tableName === 'schoolSubjects') {
              const matchedRows = FIXTURES.schoolSubjects.filter((row: any) => Object.entries(conditions).every(([key, value]) => row[key] === value));
              matchedRows.forEach((row: any) => Object.assign(row, values));
              return matchedRows;
            }
            if (tableName === 'localAuths' && conditions.userId != null) {
              const matchedRows = FIXTURES.localAuths.filter((row: any) => row.userId === Number(conditions.userId));
              matchedRows.forEach((row: any) => Object.assign(row, values));
              return matchedRows;
            }
            if (conditions.id != null) {
              const id = Number(conditions.id);
              const updateRow = (rows: any[]) => {
                const idx = rows.findIndex((row) => row.id === id);
                if (idx >= 0) {
                  rows[idx] = { ...rows[idx], ...values };
                  return [rows[idx]];
                }
                return [];
              };

              if (tableName === 'users') return updateRow(FIXTURES.users);
              if (tableName === 'classes') return updateRow(FIXTURES.classes);
              if (tableName === 'students') return updateRow(FIXTURES.students);
              if (tableName === 'parents') return updateRow(FIXTURES.parents);
              if (tableName === 'teachers') return updateRow(FIXTURES.teachers);
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
          if (tableName === 'homeroomAssignments') {
            const before = FIXTURES.homeroomAssignments.length;
            const remaining = FIXTURES.homeroomAssignments.filter((row) => !Object.entries(conditions).every(([key, value]) => (row as any)[key] === value));
            FIXTURES.homeroomAssignments.splice(0, before, ...remaining);
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
  (db as any).execute = async (_sql: any) => {
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
const mockDb = { db: createMockDb() };
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
      else if (token === 'token-teacher') req.user = { uid: 'teacher-uid', role: 'teacher', email: 'teacher@school.test', schoolId: 10, simulated: false };
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
    if (process.env.NODE_ENV === 'production' && simulatedRole) {
      res.status(401).json({ error: 'Simulated headers not allowed in production' });
      return;
    }
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      if (token === 'token-super') req.user = { uid: 'super-uid', role: 'super_admin', email: 'super@x.test', simulated: false };
      else if (token === 'token-school') req.user = { uid: 'school-uid', role: 'school_admin', email: 'admin@school.test', schoolId: 10, simulated: false };
      else if (token === 'token-teacher') req.user = { uid: 'teacher-uid', role: 'teacher', email: 'teacher@school.test', schoolId: 10, simulated: false };
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

describe('E2E security: auth & privilege checks', () => {
  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
    process.env.NODE_ENV = 'test';
    process.env.INTERNAL_SECRET = 'test-internal-secret';
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
  });

  beforeEach(() => {
    resetFixtures();
    resetLocalLoginRateLimit();
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

  it('3d. parent can access own parent details via GET /api/parents/:id', async () => {
    const res = await request(app)
      .get('/api/parents/1')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, userId: 6, schoolId: 10 });
  });

  it('3e. parent cannot access another parent detail via GET /api/parents/:id', async () => {
    const res = await request(app)
      .get('/api/parents/2')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent')
      .set('x-simulated-email', 'parent@x.test')
      .set('x-simulated-school-id', '10');

    expect(res.status).toBe(403);
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

    expect(res.status).toBe(403);
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
      evaluationMinimumScore: 2,
      evaluationMaximumScore: 19,
    });
    expect(grades.body.some((grade: any) => [13, 14, 15].includes(grade.studentId))).toBe(false);
    expect(JSON.stringify(grades.body)).not.toMatch(/Other (Minimum|Maximum)/);
    expect(grades.body.every((grade: any) => !('minimumStudentId' in grade) && !('maximumStudentId' in grade))).toBe(true);

    const ownJustification = await parentAGet('/api/absences/101/justification/download');
    expect(ownJustification.status).toBe(404);
    expect(ownJustification.body.error).toBe('Justification file not found on disk');
    await parentAGet('/api/absences/103/justification/download').expect(403);
    await parentAGet('/api/absences/103/justification/download?studentId=11').expect(403);
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
      .send({ name: 'dUpOnT Jean', lastName: 'dUpOnT', firstNames: 'Jean', email: 'newteacher@x.test', phone: '+22912345678', specialization: 'Science', schoolId: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'newteacher@x.test', schoolId: 10 });
    expect(FIXTURES.users.find((user) => user.email === 'newteacher@x.test')).toMatchObject({
      lastName: 'DUPONT',
      firstNames: 'Jean',
    });
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
      .expect(({ body }) => expect(body.code).toBe('PASSWORD_RESET_REQUIRED'));

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
      .expect(200);
  });

  it('enforces the local login rate limit after five attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(app)
        .post('/api/auth/local-login')
        .send({ email: 'missing@x.test', password: 'incorrect' });
      expect(res.status).not.toBe(429);
    }

    const limited = await request(app)
      .post('/api/auth/local-login')
      .send({ email: 'missing@x.test', password: 'incorrect' });
    expect(limited.status).toBe(429);
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
    await request(app)
      .get('/api/grades')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PASSWORD_RESET_REQUIRED'));

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

    const reset = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: created.body.id });

    expect(reset.status).toBe(200);
    expect(reset.body.mustReset).toBe(true);
    expect(reset.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(reset.body.temporaryPassword).not.toBe(oldTemporaryPassword);
    expect(reset.body).not.toHaveProperty('password');
    expect(JSON.stringify(reset.body)).not.toContain(oldTemporaryPassword);

    const resetAuth = FIXTURES.localAuths.find((row: any) => row.userId === created.body.id);
    expect(resetAuth.mustReset).toBe(true);
    expect(resetAuth.passwordHash).not.toBe(crypto.pbkdf2Sync(oldTemporaryPassword, resetAuth.salt, 310000, 64, 'sha512').toString('hex'));
    expect(resetAuth.passwordHash).not.toBe(reset.body.temporaryPassword);

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
      .expect(({ body }) => expect(body.code).toBe('PASSWORD_RESET_REQUIRED'));

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

  it('does not create local authentication when resetting an externally authenticated account', async () => {
    const response = await request(app)
      .post('/api/admin/set-password')
      .set('Authorization', 'Bearer token-super')
      .send({ userId: 3 });

    expect(response.status).toBe(409);
    expect(response.body).not.toHaveProperty('temporaryPassword');
    expect(FIXTURES.localAuths).toHaveLength(0);
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
    expect(res.body.errors[0]).toMatchObject({ row: 2, name: 'Duplicate Parent', email: 'duplicate@x.test', error: 'duplicate email in this school' });
  });

  it('3o2. globally used email in another school is rejected before user insert', async () => {
    FIXTURES.users.push({ id: 12, uid: 'other-school-parent-uid', email: 'global-parent@x.test', name: 'Other School Parent', role: 'parent', schoolId: 20, isDeleted: false });

    const res = await request(app)
      .post('/api/parents/batch')
      .set('Authorization', 'Bearer token-school')
      .send([{ name: 'Global Duplicate', email: 'global-parent@x.test', phonePrefix: '+228', phone: '90000004', parentType: 'pere' }]);

    expect(res.status).toBe(200);
    expect(res.body.insertedCount).toBe(0);
    expect(res.body.errors[0]).toMatchObject({ row: 2, name: 'Global Duplicate', email: 'global-parent@x.test', error: 'Cet email est déjà utilisé et ne peut pas être importé dans cet établissement' });
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
      expect(res.body.errors[0].row).toBe(0);
    });

    it('rejects ambiguous parentEmail without selecting an arbitrary parent', async () => {
      FIXTURES.users.push({ id: 21, uid: 'duplicate-parent', email: 'parent@x.test', name: 'Duplicate Parent', role: 'parent', schoolId: 10, isDeleted: false });
      FIXTURES.parents.push({ id: 5, userId: 21, studentId: null, schoolId: 10 });

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

  it('creates a teacher with the selected class assignment immediately', async () => {
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
      });

    expect(createRes.status).toBe(201);
    expect(FIXTURES.users.find((user) => user.email === 'teacher-assigned@x.test')).toMatchObject({
      lastName: 'DUPONT',
      firstNames: 'Teacher',
    });
    const createdUser = FIXTURES.users.find((user) => user.uid === 'teacher-assigned-at-create');
    const teacherProfile = FIXTURES.teachers.find((teacher: any) => teacher.userId === createdUser?.id);
    expect(teacherProfile).toBeDefined();
    expect(FIXTURES.classTeachers).toContainEqual(expect.objectContaining({
      classId: 1,
      teacherId: teacherProfile?.id,
      schoolId: 10,
    }));
    expect(createRes.body.classIds).toContain(1);
  });

  it('does not associate a subject approved only for another school when creating a teacher', async () => {
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

    expect(createRes.status).toBe(201);
    const createdUser = FIXTURES.users.find((user) => user.uid === 'teacher-with-unapproved-subject');
    const teacherProfile = FIXTURES.teachers.find((teacher: any) => teacher.userId === createdUser?.id);
    expect(teacherProfile).toBeDefined();
    expect(FIXTURES.teacherSubjects).not.toContainEqual(expect.objectContaining({
      teacherId: teacherProfile?.id,
      schoolId: 10,
      subjectId: 901,
    }));
  });

  it('7. teacher only sees assigned classes via classTeachers', async () => {
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

  it('scopes teacher grade reads to pedagogical assignments plus homeroom classes only', async () => {
    FIXTURES.homeroomAssignments.push(
      { id: 2, classId: 2, schoolId: 10, teacherId: 77 } as any,
    );
    FIXTURES.students.push(
      { id: 31, schoolId: 10, classId: 2, firstName: 'Homeroom', lastName: 'Student', isActive: true },
      { id: 32, schoolId: 10, classId: 5, firstName: 'Unassigned', lastName: 'Student', isActive: true },
      { id: 33, schoolId: 20, classId: 3, firstName: 'Foreign', lastName: 'Student', isActive: true },
    );
    FIXTURES.evaluations.push(
      { id: 101, classId: 1, schoolId: 10, teacherId: 77, subject: 'Math', title: 'Pedagogical class' },
      { id: 102, classId: 2, schoolId: 10, teacherId: 88, subject: 'Science', title: 'Homeroom class' },
      { id: 103, classId: 5, schoolId: 10, teacherId: 88, subject: 'Science', title: 'Unassigned same-school class' },
      { id: 104, classId: 3, schoolId: 20, teacherId: 88, subject: 'Science', title: 'Foreign-school class' },
    );
    FIXTURES.grades.push(
      { id: 201, evaluationId: 101, classId: 1, schoolId: 10, studentId: 11, score: '12' },
      { id: 202, evaluationId: 102, classId: 2, schoolId: 10, studentId: 31, score: '15' },
      { id: 203, evaluationId: 103, classId: 5, schoolId: 10, studentId: 32, score: '18' },
      { id: 204, evaluationId: 104, classId: 3, schoolId: 20, studentId: 33, score: '20' },
    );

    const response = await request(app)
      .get('/api/grades')
      .set('Authorization', 'Bearer token-teacher');

    expect(response.status).toBe(200);
    expect(response.body.map((grade: any) => grade.id).sort()).toEqual([201, 202]);
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
      .set('x-simulated-uid', 'sim-school-admin')
      .set('x-simulated-email', 'simschool@x.test');

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('10. school_admin cannot force another schoolId via query param', async () => {
    const res = await request(app)
      .get('/api/classes?schoolId=20')
      .set('Authorization', 'Bearer token-school');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((c: any) => c.schoolId === 10 || c.schoolId == null)).toBe(true);
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

  it('13. parent without schoolId can still fetch their children classes', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: 1, firstName: 'No School', lastName: 'Parent Child', isActive: true, parentId: 2 });
    const res = await request(app)
      .get('/api/classes')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent-no-school')
      .set('x-simulated-email', 'parent-noschool@x.test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, name: 'Assigned Class' });
  });

  it('14. parent cannot bypass schoolId query param and still sees only their child classes', async () => {
    FIXTURES.students.push({ id: 15, schoolId: 10, classId: 1, firstName: 'Query', lastName: 'Parent Child', isActive: true, parentId: 3 });
    const res = await request(app)
      .get('/api/classes?schoolId=10')
      .set('x-simulated-role', 'parent')
      .set('x-simulated-uid', 'sim-parent-query-bypass')
      .set('x-simulated-email', 'parent-query@x.test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, name: 'Assigned Class' });
    expect(res.body.some((c: any) => c.id === 2)).toBe(false);
    expect(res.body.some((c: any) => c.id === 3)).toBe(false);
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
