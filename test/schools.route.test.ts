import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  schools, academicYears, users, userSchools, localAuths, teachers, parents, students, subjects, classes,
  classTeachers, teacherClassSubjects, schoolClasses, schoolSubjects, schoolTerms, cycles, schoolCycles,
  schoolPeriodTypeApprovals, financialObligations, auditEvents, studentAcademicYearStatuses, examResults,
  evaluations, grades, evaluationParticipations, bulletins, bulletinGenerations, absences, lateArrivals,
  classHomeroomAssignments, classSuccessions, classExamConfigurations, absenceControls, teacherSubjects,
  accountingCategories, accountingTariffs, accountingScheduleTemplates, accountingFeeDefinitions, financialPayments,
} from '../src/db/schema.ts';
import { hashLocalPassword } from '../src/lib/localPassword.ts';

const schoolLogoS3 = vi.hoisted(() => ({
  send: vi.fn(),
  objects: new Map<string, Buffer>(),
}));

const mockState = {
  users: [
    { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'super_admin', schoolId: null },
  ] as Array<Record<string, any>>,
  userSchools: [] as Array<Record<string, any>>,
  localAuths: [] as Array<{ userId: number; passwordHash: string; salt: string }>,
  teachers: [] as Array<Record<string, any>>,
  parents: [] as Array<Record<string, any>>,
  students: [] as Array<Record<string, any>>,
  classTeachers: [] as Array<Record<string, any>>,
  teacherClassSubjects: [] as Array<Record<string, any>>,
  authenticated: true,
  academicYears: [
    { id: 1, name: '2024-2025', isActive: true, schoolId: null },
  ],
  schools: [] as Array<{ id: number; name: string; address?: string; phone?: string; ministryName?: string | null; principalName?: string | null; principalGender?: string | null; logoPath?: string | null; promotionThreshold?: string | number | null; isSuspended?: boolean }>,
  lastSchoolUpdate: null as Record<string, any> | null,
  schoolUpdateError: null as Error | null,
  classes: [] as Array<{ id: number; name: string; schoolId: number | null; academicYearId: number | null; cycleId?: number | null; cycleCode?: string | null }>,
  schoolClasses: [] as Array<{ id: number; schoolId: number; classId: number; status: string }>,
  schoolSubjects: [] as Array<{ id: number; schoolId: number; subjectId: number; status: string }>,
  schoolSubjectUpdateCalls: [] as Array<{ schoolId: number; subjectId: number }>,
  schoolTerms: [] as Array<Record<string, any>>,
  cycles: [
    { id: 1, code: 'college', isActive: true },
    { id: 2, code: 'lycee', isActive: true },
  ],
  schoolCycles: [] as Array<{ id: number; schoolId: number; cycleId: number; isActive: boolean }>,
  periodApprovals: [] as Array<{ id: number; schoolId: number; periodType: string; status: string }>,
  subjects: [] as Array<{ id: number; name: string; schoolId: number | null }>,
  createdClasses: [] as Array<{ id: number; name: string; schoolId: number | null; academicYearId: number | null }>,
  financialObligations: [] as Array<Record<string, any>>,
  financialPayments: [] as Array<Record<string, any>>,
  evaluations: [] as Array<Record<string, any>>,
  grades: [] as Array<Record<string, any>>,
  evaluationParticipations: [] as Array<Record<string, any>>,
  studentAcademicYearStatuses: [] as Array<Record<string, any>>,
  examResults: [] as Array<Record<string, any>>,
  bulletins: [] as Array<Record<string, any>>,
  bulletinGenerations: [] as Array<Record<string, any>>,
  absences: [] as Array<Record<string, any>>,
  lateArrivals: [] as Array<Record<string, any>>,
  classHomeroomAssignments: [] as Array<Record<string, any>>,
  classSuccessions: [] as Array<Record<string, any>>,
  classExamConfigurations: [] as Array<Record<string, any>>,
  absenceControls: [] as Array<Record<string, any>>,
  teacherSubjects: [] as Array<Record<string, any>>,
  accountingCategories: [] as Array<Record<string, any>>,
  accountingTariffs: [] as Array<Record<string, any>>,
  accountingScheduleTemplates: [] as Array<Record<string, any>>,
  accountingFeeDefinitions: [] as Array<Record<string, any>>,
  auditEvents: [] as Array<Record<string, any>>,
  failOnDeleteTable: null as any,
  transactionIsolationLevels: [] as Array<string | undefined>,
  transactionLockTableCalls: 0,
  onTransactionLock: null as (() => void) | null,
};

const setSuperAdminPassword = () => {
  const salt = 'test-salt';
  mockState.localAuths = [{
    userId: 1,
    salt,
    passwordHash: hashLocalPassword('unit-test-password', salt),
  }];
};

const normalizeColumnName = (value: string) => value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

const extractConditionPairs = (condition: any, pairs: Array<{ column: string; value: any }> = []): Array<{ column: string; value: any }> => {
  if (!condition || typeof condition !== 'object') {
    return pairs;
  }

  const queryChunks = condition.queryChunks ?? [];
  for (let index = 0; index < queryChunks.length; index += 1) {
    const chunk = queryChunks[index];

    if (chunk?.config?.name && queryChunks[index + 1]?.value?.[0] === ' = ') {
      const param = queryChunks[index + 2];
      pairs.push({ column: normalizeColumnName(chunk.config.name), value: param?.value ?? param });
      continue;
    }

    if (chunk?.queryChunks) {
      extractConditionPairs(chunk, pairs);
    }
  }

  return pairs;
};

const conditionContainsOr = (condition: any): boolean => (condition?.queryChunks ?? []).some((chunk: any) => (
  chunk?.value?.some?.((part: any) => typeof part === 'string' && part.includes(' or '))
  || conditionContainsOr(chunk)
));

const conditionMatchesRow = (condition: any, row: Record<string, any>): boolean => {
  const chunks = condition?.queryChunks ?? [];
  const nested = chunks.filter((chunk: any) => Array.isArray(chunk?.queryChunks));
  const connector = chunks.flatMap((chunk: any) => chunk?.value ?? [])
    .find((part: any) => typeof part === 'string' && (part.includes(' or ') || part.includes(' and ')));
  if (connector && nested.length >= 2) {
    const matches = nested.map((chunk: any) => conditionMatchesRow(chunk, row));
    return connector.includes(' or ') ? matches.some(Boolean) : matches.every(Boolean);
  }
  if (nested.length === 1) return conditionMatchesRow(nested[0], row);

  const columnIndex = chunks.findIndex((chunk: any) => chunk?.config?.name);
  if (columnIndex < 0) return true;
  const column = normalizeColumnName(chunks[columnIndex].config.name);
  const operator = chunks[columnIndex + 1]?.value?.join?.('').trim().toLowerCase();
  const operand = chunks[columnIndex + 2];
  if (operator === 'in') {
    const values = Array.isArray(operand) ? operand.map((item: any) => item?.value ?? item) : [];
    return values.includes(row[column]);
  }
  if (operator === '=') {
    const value = operand && Object.prototype.hasOwnProperty.call(operand, 'value') ? operand.value : operand;
    return row[column] === value;
  }
  if (operator === 'is null') return row[column] == null;
  return true;
};

const matchesConditions = (row: Record<string, any>, conditions: any[]): boolean => (
  conditions.every((condition) => conditionMatchesRow(condition, row))
);

const getRowsForTable = (table: any): Array<Record<string, any>> | null => {
  const tableRows = new Map<any, Array<Record<string, any>>>([
    [schools, mockState.schools as Array<Record<string, any>>],
    [academicYears, mockState.academicYears as Array<Record<string, any>>],
    [users, mockState.users],
    [userSchools, mockState.userSchools],
    [teachers, mockState.teachers],
    [parents, mockState.parents],
    [students, mockState.students],
    [classes, mockState.classes as Array<Record<string, any>>],
    [subjects, mockState.subjects as Array<Record<string, any>>],
    [schoolClasses, mockState.schoolClasses as Array<Record<string, any>>],
    [schoolSubjects, mockState.schoolSubjects as Array<Record<string, any>>],
    [schoolTerms, mockState.schoolTerms],
    [classTeachers, mockState.classTeachers],
    [teacherClassSubjects, mockState.teacherClassSubjects],
    [financialObligations, mockState.financialObligations as Array<Record<string, any>>],
    [studentAcademicYearStatuses, mockState.studentAcademicYearStatuses],
    [examResults, mockState.examResults],
    [evaluations, mockState.evaluations],
    [grades, mockState.grades],
    [evaluationParticipations, mockState.evaluationParticipations],
    [bulletins, mockState.bulletins],
    [bulletinGenerations, mockState.bulletinGenerations],
    [absences, mockState.absences],
    [lateArrivals, mockState.lateArrivals],
    [classHomeroomAssignments, mockState.classHomeroomAssignments],
    [classSuccessions, mockState.classSuccessions],
    [classExamConfigurations, mockState.classExamConfigurations],
    [absenceControls, mockState.absenceControls],
    [teacherSubjects, mockState.teacherSubjects],
    [accountingCategories, mockState.accountingCategories],
    [accountingTariffs, mockState.accountingTariffs],
    [accountingScheduleTemplates, mockState.accountingScheduleTemplates],
    [accountingFeeDefinitions, mockState.accountingFeeDefinitions],
    [financialPayments, mockState.financialPayments],
  ]);
  return tableRows.get(table) ?? null;
};

const snapshotSchoolDeletionState = () => structuredClone({
  schools: mockState.schools,
  academicYears: mockState.academicYears,
  users: mockState.users,
  userSchools: mockState.userSchools,
  localAuths: mockState.localAuths,
  teachers: mockState.teachers,
  parents: mockState.parents,
  students: mockState.students,
  classes: mockState.classes,
  schoolClasses: mockState.schoolClasses,
  schoolSubjects: mockState.schoolSubjects,
  subjects: mockState.subjects,
  schoolTerms: mockState.schoolTerms,
  classTeachers: mockState.classTeachers,
  teacherClassSubjects: mockState.teacherClassSubjects,
  studentAcademicYearStatuses: mockState.studentAcademicYearStatuses,
  examResults: mockState.examResults,
  evaluations: mockState.evaluations,
  grades: mockState.grades,
  evaluationParticipations: mockState.evaluationParticipations,
  bulletins: mockState.bulletins,
  bulletinGenerations: mockState.bulletinGenerations,
  absences: mockState.absences,
  lateArrivals: mockState.lateArrivals,
  classHomeroomAssignments: mockState.classHomeroomAssignments,
  classSuccessions: mockState.classSuccessions,
  classExamConfigurations: mockState.classExamConfigurations,
  absenceControls: mockState.absenceControls,
  teacherSubjects: mockState.teacherSubjects,
  accountingCategories: mockState.accountingCategories,
  accountingTariffs: mockState.accountingTariffs,
  accountingScheduleTemplates: mockState.accountingScheduleTemplates,
  accountingFeeDefinitions: mockState.accountingFeeDefinitions,
  financialObligations: mockState.financialObligations,
  financialPayments: mockState.financialPayments,
  auditEvents: mockState.auditEvents,
});

const createBuilder = () => {
  const builder: any = {
    table: null as any,
    joins: [] as any[],
    conditions: [] as any[],
    limitValue: 0,
    from(table: any) {
      builder.table = table;
      return builder;
    },
    innerJoin(table: any) {
      builder.joins.push(table);
      return builder;
    },
    leftJoin(table: any) {
      builder.joins.push(table);
      return builder;
    },
    where(...conditions: any[]) {
      builder.conditions = conditions;
      return builder;
    },
    limit(value: number) {
      builder.limitValue = value;
      return builder;
    },
    orderBy() {
      return builder;
    },
    for() {
      return builder;
    },
    then(resolve: (value: any) => void) {
      const stateRows = getRowsForTable(builder.table);
      if (stateRows && !(builder.table === subjects && builder.joins.includes(schoolSubjects))) {
        const rows = stateRows.filter((row) => matchesConditions(row, builder.conditions));
        return Promise.resolve(builder.limitValue ? rows.slice(0, builder.limitValue) : rows).then(resolve);
      }
      if (builder.table === users) {
        const conditions = builder.conditions.flatMap((condition: any) => extractConditionPairs(condition));
        const rows = mockState.users.filter((row) => conditions.every((entry) => row[entry.column] === entry.value));
        return Promise.resolve(rows).then(resolve);
      }
      if (builder.table === userSchools || builder.table === teachers || builder.table === parents || builder.table === students
        || builder.table === classTeachers || builder.table === teacherClassSubjects) {
        const rows = builder.table === userSchools
          ? mockState.userSchools
          : builder.table === teachers
            ? mockState.teachers
            : builder.table === parents
              ? mockState.parents
              : builder.table === students
                ? mockState.students
                : builder.table === classTeachers
                  ? mockState.classTeachers
                  : mockState.teacherClassSubjects;
        const conditions = builder.conditions.flatMap((condition: any) => extractConditionPairs(condition));
        return Promise.resolve(rows.filter((row) => conditions.every((entry) => row[entry.column] === entry.value))).then(resolve);
      }
      if (builder.table === localAuths) {
        const conditions = builder.conditions.flatMap((condition: any) => extractConditionPairs(condition));
        const rows = mockState.localAuths.filter((row) => conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        return Promise.resolve(rows).then(resolve);
      }
      if (builder.table === academicYears) {
        return Promise.resolve(mockState.academicYears).then(resolve);
      }
      if (builder.table === schools) {
        return Promise.resolve(mockState.schools).then(resolve);
      }
      if (builder.table === financialObligations) {
        const conditions = builder.conditions.flatMap((condition: any) => extractConditionPairs(condition));
        const rows = mockState.financialObligations.filter((row) =>
          conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        return Promise.resolve(rows).then(resolve);
      }
      if (builder.table === classes) {
        const conditions = builder.conditions.flatMap((condition) => extractConditionPairs(condition));
        const rows = mockState.classes.filter((row) => conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        return Promise.resolve(rows).then(resolve);
      }
      if (builder.table === schoolClasses) {
        let rows = mockState.schoolClasses;
        if (builder.conditions.length > 0) {
          const conditions = builder.conditions.flatMap((condition) => extractConditionPairs(condition));
          rows = rows.filter((row) => conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        }
        return Promise.resolve(rows).then(resolve);
      }
      if (builder.table === schoolTerms || builder.table === schoolPeriodTypeApprovals || builder.table === cycles) {
        const rows = builder.table === schoolTerms
          ? mockState.schoolTerms
          : builder.table === schoolPeriodTypeApprovals
            ? mockState.periodApprovals
            : mockState.cycles;
        const conditions = builder.conditions.flatMap((condition: any) => extractConditionPairs(condition));
        const hasOrCondition = builder.conditions.some(conditionContainsOr);
        return Promise.resolve(rows.filter((row: any) => {
          const schoolCondition = builder.table === schoolTerms
            ? conditions.find((entry: any) => entry.column === 'schoolId')
            : undefined;
          return conditions
            .filter((entry: any) => entry !== schoolCondition)
            .every((entry: any) => row[entry.column] === entry.value)
            && (!schoolCondition
              || (hasOrCondition
                ? row.schoolId == null || row.schoolId === schoolCondition.value
                : row.schoolId === schoolCondition.value));
        })).then(resolve);
      }
      if (builder.table === schoolCycles) {
        const conditions = builder.conditions.flatMap((condition: any) => extractConditionPairs(condition));
        const assignments = mockState.schoolCycles.filter((row) => conditions
          .filter((entry: any) => entry.column in row)
          .every((entry: any) => row[entry.column as keyof typeof row] === entry.value));
        if (builder.joins.includes(cycles)) {
          const rows = assignments.flatMap((assignment) => {
            const cycle = mockState.cycles.find((item) => item.id === assignment.cycleId && item.isActive);
            return cycle ? [{ id: cycle.id, code: cycle.code }] : [];
          });

          return Promise.resolve(rows).then(resolve);
        }
        return Promise.resolve(assignments).then(resolve);
      }
      if (builder.table === subjects || builder.table === schoolSubjects) {
        const sourceRows = builder.table === subjects ? mockState.subjects : mockState.schoolSubjects;
        const conditions = builder.conditions.flatMap((condition) => extractConditionPairs(condition));
        if (builder.table === subjects && builder.joins.includes(schoolSubjects)) {
          const targetSchoolId = conditions.find((entry) => entry.column === 'schoolId')?.value;
          const rows = sourceRows.flatMap((subject: any) => {
            const association = mockState.schoolSubjects.find((row) => (
              row.schoolId === targetSchoolId && row.subjectId === subject.id
            ));
            if (subject.schoolId !== targetSchoolId && !association) return [];
            return [{
              ...subject,
              schoolId: subject.schoolId ?? null,
              status: association?.status ?? 'approved',
            }];
          });
          return Promise.resolve(rows).then(resolve);
        }
        const rows = sourceRows.filter((row) => conditions.every((entry) => row[entry.column as keyof typeof row] === entry.value));
        return Promise.resolve(rows).then(resolve);
      }
      return Promise.resolve([]).then(resolve);
    },
    catch(reject: (reason?: any) => void) {
      return Promise.resolve([]).catch(reject);
    },
    finally(cb: () => void) {
      return Promise.resolve([]).finally(cb);
    },
  };
  return builder;
};

const mockDb = {
  select: () => createBuilder(),
  insert: (table: any) => ({
    values: (values: any) => {
      if (table === schools) {
        const id = mockState.schools.length + 1;
        const schoolRow = { id, ...values };
        mockState.schools.push(schoolRow);
        return {
          returning: async () => [schoolRow],
        };
      }
      if (table === classes) {
        const id = mockState.classes.length + 100;
        const classRow = { id, ...values };
        mockState.classes.push(classRow);
        mockState.createdClasses.push(classRow);
        return {
          returning: async () => [classRow],
        };
      }
      if (table === schoolClasses) {
        const id = mockState.schoolClasses.length + 1;
        const schoolClassRow = { id, ...values };
        mockState.schoolClasses.push(schoolClassRow);
        return {
          returning: async () => [schoolClassRow],
        };
      }
      if (table === schoolSubjects) {
        const id = mockState.schoolSubjects.length + 1;
        const schoolSubjectRow = { id, ...values };
        mockState.schoolSubjects.push(schoolSubjectRow);
        return {
          returning: async () => [schoolSubjectRow],
        };
      }
      if (table === subjects) {
        const id = mockState.subjects.length + 1;
        const subjectRow = { id, ...values };
        mockState.subjects.push(subjectRow);
        return {
          returning: async () => [subjectRow],
        };
      }
      if (table === schoolTerms) {
        const term = { id: mockState.schoolTerms.length + 100, ...values };
        mockState.schoolTerms.push(term);
        return { returning: async () => [term] };
      }
      if (table === schoolPeriodTypeApprovals) {
        return {
          onConflictDoUpdate: async () => {
            const current = mockState.periodApprovals.find((item) => item.schoolId === values.schoolId && item.periodType === values.periodType);
            if (current) Object.assign(current, values);
            else mockState.periodApprovals.push({ id: mockState.periodApprovals.length + 1, ...values });
            return [];
          },
        };
      }
      if (table === auditEvents) {
        mockState.auditEvents.push({ id: mockState.auditEvents.length + 1, ...values });
      }
      return {
        returning: async () => [{ id: 1 }],
      };
    },
  }),
  update: (table: any) => ({
    set: (values: any) => ({
      where: (...conditions: any[]) => {
        const conditionPairs = conditions.flatMap((condition) => extractConditionPairs(condition));
        const updateRows = (rows: Array<Record<string, any>>) => {
          const updatedRows: Array<Record<string, any>> = [];
          const updated = rows.map((row) => {
            if (!conditionPairs.every((entry) => row[entry.column] === entry.value)) return row;
            const next = { ...row, ...values };
            updatedRows.push(next);
            return next;
          });
          return { updated, updatedRows };
        };
        if (table === users || table === parents || table === teachers || table === students) {
          const stateRows = table === users
            ? mockState.users
            : table === parents
              ? mockState.parents
              : table === teachers
                ? mockState.teachers
                : mockState.students;
          const result = updateRows(stateRows);
          if (table === users) mockState.users = result.updated;
          else if (table === parents) mockState.parents = result.updated;
          else if (table === teachers) mockState.teachers = result.updated;
          else mockState.students = result.updated;
          return {
            then(resolve: (value: any) => void) { return Promise.resolve(result.updatedRows).then(resolve); },
            returning: async () => result.updatedRows,
          };
        }
        if (table === schoolTerms) {
          const updatedRows: Array<Record<string, any>> = [];
          mockState.schoolTerms = mockState.schoolTerms.map((item) => {
            const matches = conditionPairs.every((entry) => item[entry.column] === entry.value);
            if (!matches) return item;
            const updated = { ...item, ...values };
            updatedRows.push(updated);
            return updated;
          });
          return {
            then(resolve: (value: any) => void) { return Promise.resolve(updatedRows).then(resolve); },
            returning: async () => updatedRows,
          };
        }
        if (table === schoolSubjects) {
          const updatedRows: Array<{ id: number; schoolId: number; subjectId: number; status: string }> = [];
          mockState.schoolSubjects = mockState.schoolSubjects.map((row) => {
            const matches = conditionPairs.every((entry) => row[entry.column as keyof typeof row] === entry.value);
            if (!matches) return row;
            updatedRows.push({ ...row, ...values });
            mockState.schoolSubjectUpdateCalls.push({ schoolId: row.schoolId, subjectId: row.subjectId });
            return { ...row, ...values };
          });
          return {
            then(resolve: (value: any) => void) { return Promise.resolve(updatedRows).then(resolve); },
            returning: async () => updatedRows,
          };
        }
        if (table === classes) {
          mockState.classes = mockState.classes.map((item) => (item.id === values.id ? { ...item, ...values } : item));
        }
        if (table === schools) {
          mockState.lastSchoolUpdate = values;
          if (!mockState.schoolUpdateError) {
            const conditionPairs = conditions.flatMap((condition) => extractConditionPairs(condition));
            mockState.schools = mockState.schools.map((item) => (
              conditionPairs.every((entry) => item[entry.column] === entry.value)
                ? { ...item, ...values }
                : item
            ));
          }
        }
        const result = table === schools
          ? mockState.schools.filter((item) => conditions.flatMap((condition) => extractConditionPairs(condition))
            .every((entry) => item[entry.column] === entry.value))
          : [{ id: 1, ...values }];
        return {
          then(resolve: (value: any) => void) {
            return Promise.resolve(result).then(resolve);
          },
          returning: async () => {
            if (table === schools && mockState.schoolUpdateError) throw mockState.schoolUpdateError;
            return result;
          },
        };
      },
    }),
  }),
  delete: (table: any) => ({
    where: async (...conditions: any[]) => {
      if (mockState.failOnDeleteTable === table) throw new Error('Simulated transactional delete failure');
      const filterRows = (rows: Array<Record<string, any>>) => conditions.length === 0
        ? rows
        : rows.filter((row) => !matchesConditions(row, conditions));
      if (table === schools) {
        const deletedSchoolIds = mockState.schools
          .filter((row) => matchesConditions(row, conditions))
          .map((row) => row.id);
        mockState.schools = mockState.schools.filter((row) => !matchesConditions(row, conditions));
        mockState.userSchools = mockState.userSchools.filter((row) => !deletedSchoolIds.includes(row.schoolId));
      }
      if (table === userSchools) mockState.userSchools = filterRows(mockState.userSchools);
      if (table === users) mockState.users = filterRows(mockState.users);
      if (table === teachers) mockState.teachers = filterRows(mockState.teachers);
      if (table === parents) mockState.parents = filterRows(mockState.parents);
      if (table === students) mockState.students = filterRows(mockState.students);
      if (table === classes && conditions.length > 0) {
        const deletedClassIds = mockState.classes
          .filter((row) => matchesConditions(row as Record<string, any>, conditions))
          .map((row) => row.id);
        mockState.classes = mockState.classes.filter((row) => !matchesConditions(row as Record<string, any>, conditions));
        mockState.classTeachers = mockState.classTeachers.filter((row) => !deletedClassIds.includes(row.classId));
        mockState.teacherClassSubjects = mockState.teacherClassSubjects.filter((row) => !deletedClassIds.includes(row.classId));
      }
      if (table === schoolTerms) {
        mockState.schoolTerms = filterRows(mockState.schoolTerms);
      }
      if (table === schoolCycles) mockState.schoolCycles = [];
      const genericRows = getRowsForTable(table);
      if (genericRows && ![schools, userSchools, users, teachers, parents, students, classes, schoolTerms, schoolCycles].includes(table)) {
        const remainingRows = filterRows(genericRows);
        genericRows.splice(0, genericRows.length, ...remainingRows);
      }
      return [];
    },
  }),
  execute: async (_sql: any) => [],
  transaction: async (run: (tx: any) => Promise<any>, options?: { isolationLevel?: string }) => {
    const snapshot = {
      ...structuredClone({ ...mockState, failOnDeleteTable: null, onTransactionLock: null }),
      failOnDeleteTable: mockState.failOnDeleteTable,
      onTransactionLock: mockState.onTransactionLock,
    };
    mockState.transactionIsolationLevels.push(options?.isolationLevel);
    try {
      return await run({
        ...mockDb,
        execute: async (query: any) => {
          if (query?.queryChunks?.some((chunk: any) => chunk?.value?.some?.((value: any) => (
            typeof value === 'string' && value.includes('LOCK TABLE user_schools')
          )))) {
            mockState.transactionLockTableCalls += 1;
            mockState.onTransactionLock?.();
          }
          return {
            rows: mockState.schools.map((school) => ({ id: school.id, is_suspended: Boolean((school as any).isSuspended) })),
          };
        },
      });
    } catch (error) {
      const concurrentMemberships = mockState.userSchools.filter((row) => (
        !snapshot.userSchools.some((snapshotRow: Record<string, any>) => snapshotRow.id === row.id)
      ));
      const isolationLevels = mockState.transactionIsolationLevels;
      const lockTableCalls = mockState.transactionLockTableCalls;
      Object.assign(mockState, snapshot);
      mockState.transactionIsolationLevels = isolationLevels;
      mockState.transactionLockTableCalls = lockTableCalls;
      mockState.userSchools.push(...concurrentMemberships);
      throw error;
    }
  },
};

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send(command: any) {
      return schoolLogoS3.send(command);
    }
  },
  DeleteObjectCommand: class { constructor(public input: any) {} },
  GetObjectCommand: class { constructor(public input: any) {} },
  PutObjectCommand: class { constructor(public input: any) {} },
}));

vi.mock('../src/db/index.ts', () => ({ db: mockDb }));
vi.mock('../src/db', () => ({ db: mockDb }));
vi.mock('src/db/index.ts', () => ({ db: mockDb }));
vi.mock('src/db', () => ({ db: mockDb }));

vi.mock('../src/middleware/auth.ts', async () => {
  const actual = await vi.importActual('../src/middleware/auth.ts');
  return {
    ...actual,
    requireAuth(req: any, _res: any, next: () => void) {
      if (!mockState.authenticated) return _res.status(401).json({ error: 'Unauthorized: Missing token' });
      req.user = {
        uid: 'sim-admin',
        email: 'admin@example.com',
        role: mockState.users[0]?.role ?? 'super_admin',
        schoolId: mockState.users[0]?.schoolId ?? null,
        id: 1,
        simulated: true,
      };
      next();
    },
  };
});
vi.mock('src/middleware/auth', async () => {
  const actual = await vi.importActual('../src/middleware/auth.ts');
  return {
    ...actual,
    requireAuth(req: any, _res: any, next: () => void) {
      if (!mockState.authenticated) return _res.status(401).json({ error: 'Unauthorized: Missing token' });
      req.user = {
        uid: 'sim-admin',
        email: 'admin@example.com',
        role: mockState.users[0]?.role ?? 'super_admin',
        schoolId: mockState.users[0]?.schoolId ?? null,
        id: 1,
        simulated: true,
      };
      next();
    },
  };
});

describe('POST /api/schools', () => {
  let app: any;
  const storageEnvKeys = ['NODE_ENV', 'FILE_STORAGE_PROVIDER', 'UPLOADS_DIR', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const originalStorageEnv = Object.fromEntries(storageEnvKeys.map((key) => [key, process.env[key]]));

  beforeAll(async () => {
    const serverModule = await import('../server.ts');
    app = await serverModule.createApp();
  });

  beforeEach(() => {
    for (const key of storageEnvKeys) {
      const original = originalStorageEnv[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    process.env.NODE_ENV = 'test';
    schoolLogoS3.objects.clear();
    schoolLogoS3.send.mockReset();
    schoolLogoS3.send.mockImplementation(async (command: any) => {
      const commandName = command.constructor.name;
      const { Bucket, Key, Body } = command.input;
      const objectKey = `${Bucket}/${Key}`;
      if (commandName === 'PutObjectCommand') {
        schoolLogoS3.objects.set(objectKey, Buffer.from(Body));
        return {};
      }
      if (commandName === 'GetObjectCommand') {
        const body = schoolLogoS3.objects.get(objectKey);
        if (!body) throw Object.assign(new Error('missing object'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => new Uint8Array(body) }, ContentType: 'image/png' };
      }
      if (commandName === 'DeleteObjectCommand') {
        schoolLogoS3.objects.delete(objectKey);
        return {};
      }
      throw new Error(`Unexpected S3 command: ${commandName}`);
    });
    mockState.users = [
      { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'super_admin', schoolId: null },
    ];
    mockState.userSchools = [];
    mockState.localAuths = [];
    mockState.teachers = [];
    mockState.parents = [];
    mockState.students = [];
    mockState.classTeachers = [];
    mockState.teacherClassSubjects = [];
    mockState.authenticated = true;
    mockState.academicYears = [
      { id: 1, name: '2024-2025', isActive: true, schoolId: null },
    ];
    mockState.schools = [];
    mockState.lastSchoolUpdate = null;
    mockState.schoolUpdateError = null;
    mockState.classes = [];
    mockState.schoolClasses = [];
    mockState.schoolSubjects = [];
    mockState.schoolSubjectUpdateCalls = [];
    mockState.schoolTerms = [];
    mockState.cycles = [
      { id: 1, code: 'college', isActive: true },
      { id: 2, code: 'lycee', isActive: true },
    ];
    mockState.schoolCycles = [];
    mockState.periodApprovals = [];
    mockState.subjects = [];
    mockState.createdClasses = [];
    mockState.financialObligations = [];
    mockState.financialPayments = [];
    mockState.evaluations = [];
    mockState.grades = [];
    mockState.evaluationParticipations = [];
    mockState.studentAcademicYearStatuses = [];
    mockState.examResults = [];
    mockState.bulletins = [];
    mockState.bulletinGenerations = [];
    mockState.absences = [];
    mockState.lateArrivals = [];
    mockState.classHomeroomAssignments = [];
    mockState.classSuccessions = [];
    mockState.classExamConfigurations = [];
    mockState.absenceControls = [];
    mockState.teacherSubjects = [];
    mockState.accountingCategories = [];
    mockState.accountingTariffs = [];
    mockState.accountingScheduleTemplates = [];
    mockState.accountingFeeDefinitions = [];
    mockState.auditEvents = [];
    mockState.failOnDeleteTable = null;
    mockState.transactionIsolationLevels = [];
    mockState.transactionLockTableCalls = 0;
    mockState.onTransactionLock = null;
  });

  it('refuses to delete a school that has an accounting obligation history', async () => {
    mockState.schools = [{ id: 1, name: 'École avec historique' }];
    setSuperAdminPassword();
    mockState.financialObligations = [{ id: 7, schoolId: 1 }];

    await request(app).delete('/api/schools/1').send({ password: 'unit-test-password' }).expect(409);
    expect(mockState.schools).toHaveLength(1);
  });

  it('rejects school deletion when the password is incorrect', async () => {
    mockState.schools = [{ id: 1, name: 'École à conserver' }];
    setSuperAdminPassword();

    await request(app).delete('/api/schools/1').send({ password: 'wrong-password' })
      .expect(401, { error: 'Mot de passe incorrect.' });
    expect(mockState.schools).toHaveLength(1);
  });

  it('does not permit an unauthenticated request even when it includes a password', async () => {
    mockState.schools = [{ id: 1, name: 'École à conserver' }];
    setSuperAdminPassword();
    mockState.authenticated = false;

    await request(app).delete('/api/schools/1').send({ password: 'unit-test-password' })
      .expect(401, { error: 'Unauthorized: Missing token' });
    expect(mockState.schools).toHaveLength(1);
  });

  it('does not permit an authenticated non-super-admin to delete a school with a correct password', async () => {
    mockState.schools = [{ id: 1, name: 'École à conserver' }];
    setSuperAdminPassword();
    mockState.users[0].role = 'school_admin';

    await request(app).delete('/api/schools/1').send({ password: 'unit-test-password' })
      .expect(403);
    expect(mockState.schools).toHaveLength(1);
  });

  it('deletes a school after the authenticated super-admin password is verified', async () => {
    mockState.schools = [{ id: 1, name: 'École autorisée' }];
    setSuperAdminPassword();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' })
      .expect(200, { message: 'School deleted successfully' });

    expect(mockState.schools).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('salt');
  });

  it('blocks school deletion while a Parent profile belongs to that school', async () => {
    mockState.schools = [{ id: 1, name: 'École unique' }];
    setSuperAdminPassword();
    mockState.users.push({ id: 2, uid: 'parent-only', role: 'parent', schoolId: 1 });
    mockState.userSchools = [{ id: 1, userId: 2, schoolId: 1, role: 'parent', isActive: true }];
    mockState.localAuths.push({ userId: 2, salt: 'parent-salt', passwordHash: 'parent-hash' });
    mockState.parents = [{ id: 20, userId: 2, schoolId: 1, phone: 'preserve' }];
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_HAS_LOCAL_PROFILES');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it('does not detach a shared Parent profile or remove memberships when deleting its school', async () => {
    mockState.schools = [{ id: 1, name: 'École supprimée' }, { id: 2, name: 'École conservée' }];
    setSuperAdminPassword();
    mockState.users.push({ id: 2, uid: 'shared-parent', role: 'parent', schoolId: 1 });
    mockState.userSchools = [
      { id: 1, userId: 2, schoolId: 1, role: 'parent', isActive: true },
      { id: 2, userId: 2, schoolId: 2, role: 'parent', isActive: false },
    ];
    mockState.parents = [{ id: 20, userId: 2, schoolId: 1 }];
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_HAS_LOCAL_PROFILES');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it('keeps a shared parent profile and links to students in the other school', async () => {
    mockState.schools = [{ id: 1, name: 'École supprimée' }, { id: 2, name: 'École conservée' }];
    setSuperAdminPassword();
    mockState.users.push({ id: 2, uid: 'parent-two-schools', role: 'parent', schoolId: 1 });
    mockState.userSchools = [
      { id: 1, userId: 2, schoolId: 1, role: 'parent', isActive: true },
      { id: 2, userId: 2, schoolId: 2, role: 'parent', isActive: null },
    ];
    mockState.parents = [{ id: 20, userId: 2, schoolId: 1 }];
    mockState.students = [
      { id: 30, schoolId: 1, parentId: 20 },
      { id: 31, schoolId: 2, parentId: 20 },
    ];
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_HAS_LOCAL_PROFILES');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it('blocks school deletion rather than transferring a Teacher profile to another school', async () => {
    mockState.schools = [{ id: 1, name: 'École supprimée' }, { id: 2, name: 'École conservée' }];
    setSuperAdminPassword();
    mockState.users.push({ id: 2, uid: 'teacher-two-schools', role: 'teacher', schoolId: 1 });
    mockState.userSchools = [
      { id: 1, userId: 2, schoolId: 1, role: 'teacher', isActive: true },
      { id: 2, userId: 2, schoolId: 2, role: 'teacher', isActive: null },
    ];
    mockState.teachers = [{ id: 20, userId: 2, schoolId: 1 }];
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_HAS_LOCAL_PROFILES');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it('blocks deletion when the school contains both Parent and Teacher profiles', async () => {
    mockState.schools = [{ id: 1, name: 'École multi-fonctions' }];
    setSuperAdminPassword();
    mockState.users.push({ id: 2, uid: 'parent-and-teacher', role: 'parent', schoolId: 1 });
    mockState.userSchools = [
      { id: 1, userId: 2, schoolId: 1, role: 'parent', isActive: true },
      { id: 2, userId: 2, schoolId: 1, role: 'teacher', isActive: true },
      { id: 3, userId: 2, schoolId: 2, role: 'parent', isActive: true },
    ];
    mockState.parents = [{ id: 20, userId: 2, schoolId: 1 }];
    mockState.teachers = [{ id: 21, userId: 2, schoolId: 1 }];

    await request(app).delete('/api/schools/1').send({ password: 'unit-test-password' }).expect(409);

    expect(mockState.schools).toHaveLength(1);
    expect(mockState.parents).toEqual([{ id: 20, userId: 2, schoolId: 1 }]);
    expect(mockState.teachers).toEqual([{ id: 21, userId: 2, schoolId: 1 }]);
    expect(mockState.userSchools).toHaveLength(3);
  });

  it('rolls back account and membership changes when school deletion fails mid-transaction', async () => {
    mockState.schools = [{ id: 1, name: 'École en suppression' }, { id: 2, name: 'École conservée' }];
    setSuperAdminPassword();
    mockState.users.push({ id: 2, uid: 'teacher-rollback', role: 'teacher', schoolId: 1 });
    mockState.userSchools = [
      { id: 1, userId: 2, schoolId: 1, role: 'teacher', isActive: true },
      { id: 2, userId: 2, schoolId: 2, role: 'teacher', isActive: true },
    ];
    mockState.failOnDeleteTable = classes;
    const before = snapshotSchoolDeletionState();

    await request(app).delete('/api/schools/1').send({ password: 'unit-test-password' }).expect(500);

    expect(snapshotSchoolDeletionState()).toEqual(before);
    expect(mockState.schools).toHaveLength(2);
    expect(mockState.users.find((user) => user.id === 2)?.schoolId).toBe(1);
    expect(mockState.userSchools).toHaveLength(2);
    expect(mockState.teachers).toEqual([]);
    expect(mockState.parents).toEqual([]);
  });

  it('refuses to delete a globally shared class associated with another school without changing any data', async () => {
    mockState.schools = [{ id: 1, name: 'École supprimée' }, { id: 2, name: 'École conservée' }];
    mockState.academicYears = [{ id: 11, name: '2024-2025', isActive: true, schoolId: 1 }];
    mockState.classes = [{ id: 101, name: 'Classe globale', schoolId: null, academicYearId: 11 }];
    mockState.schoolClasses = [
      { id: 1, schoolId: 1, classId: 101, status: 'approved' },
      { id: 2, schoolId: 2, classId: 101, status: 'approved' },
    ];
    setSuperAdminPassword();
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_SHARED_CLASS_DEPENDENCY');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it('refuses to delete a subject associated with another school without changing any data', async () => {
    mockState.schools = [{ id: 1, name: 'École supprimée' }, { id: 2, name: 'École conservée' }];
    mockState.subjects = [{ id: 201, name: 'Mathématiques', schoolId: 1 }];
    mockState.schoolSubjects = [
      { id: 1, schoolId: 1, subjectId: 201, status: 'approved' },
      { id: 2, schoolId: 2, subjectId: 201, status: 'approved' },
    ];
    setSuperAdminPassword();
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_SHARED_SUBJECT_DEPENDENCY');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it('refuses to delete an evaluation containing another school’s student history without changing any data', async () => {
    mockState.schools = [{ id: 1, name: 'École supprimée' }, { id: 2, name: 'École conservée' }];
    mockState.academicYears = [{ id: 11, name: '2024-2025', isActive: true, schoolId: 1 }];
    mockState.classes = [{ id: 101, name: 'Classe cible', schoolId: 1, academicYearId: 11 }];
    mockState.students = [{ id: 301, schoolId: 2, classId: null }];
    mockState.evaluations = [{ id: 401, schoolId: 1, classId: 101, subjectId: null, termId: null }];
    mockState.grades = [{ id: 501, evaluationId: 401, studentId: 301 }];
    setSuperAdminPassword();
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_SHARED_EVALUATION_DEPENDENCY');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it('refuses to delete a financial tariff referenced by another school without changing any data', async () => {
    mockState.schools = [{ id: 1, name: 'École supprimée' }, { id: 2, name: 'École conservée' }];
    mockState.accountingTariffs = [{ id: 701, schoolId: 1, academicYearId: 1, classId: null }];
    mockState.financialObligations = [{
      id: 801,
      schoolId: 2,
      studentId: 901,
      academicYearId: 902,
      classId: 903,
      categoryId: 904,
      tariffId: 701,
      feeDefinitionId: null,
    }];
    setSuperAdminPassword();
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_SHARED_FINANCIAL_DEPENDENCY');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it.each([true, false, null])(
    'blocks school deletion instead of transferring a Teacher profile with isActive=%s',
    async (isActive) => {
      mockState.schools = [{ id: 1, name: 'École supprimée' }, { id: 2, name: 'École conservée' }];
      mockState.users.push({ id: 2, uid: `teacher-active-${String(isActive)}`, role: 'teacher', schoolId: 1 });
      mockState.userSchools = [
        { id: 1, userId: 2, schoolId: 1, role: 'teacher', isActive: true },
        { id: 2, userId: 2, schoolId: 2, role: 'teacher', isActive },
      ];
      mockState.teachers = [{ id: 20, userId: 2, schoolId: 1 }];
      setSuperAdminPassword();

      const before = snapshotSchoolDeletionState();
      const response = await request(app).delete('/api/schools/1')
        .send({ password: 'unit-test-password' }).expect(409);

      expect(response.body.code).toBe('SCHOOL_HAS_LOCAL_PROFILES');
      expect(snapshotSchoolDeletionState()).toEqual(before);
    },
  );

  it.each([
    { remainingSchools: [] },
    { remainingSchools: [2, 3] },
  ])('blocks school deletion when a Teacher profile remains, regardless of other memberships', async ({ remainingSchools }) => {
    mockState.schools = [
      { id: 1, name: 'École supprimée' },
      ...remainingSchools.map((schoolId) => ({ id: schoolId, name: `École ${schoolId}` })),
    ];
    mockState.users.push({ id: 2, uid: 'teacher-invalid-destination', role: 'teacher', schoolId: 1 });
    mockState.userSchools = [
      { id: 1, userId: 2, schoolId: 1, role: 'teacher', isActive: true },
      ...remainingSchools.map((schoolId, index) => ({
        id: index + 2, userId: 2, schoolId, role: 'teacher', isActive: index === 0 ? false : null,
      })),
    ];
    mockState.teachers = [{ id: 20, userId: 2, schoolId: 1 }];
    setSuperAdminPassword();
    const before = snapshotSchoolDeletionState();

    const response = await request(app).delete('/api/schools/1')
      .send({ password: 'unit-test-password' }).expect(409);

    expect(response.body.code).toBe('SCHOOL_HAS_LOCAL_PROFILES');
    expect(snapshotSchoolDeletionState()).toEqual(before);
  });

  it('suspends and reopens a school idempotently without changing retained data', async () => {
    mockState.schools = [{
      id: 1,
      name: 'École à conserver',
      isSuspended: false,
    }];
    mockState.financialObligations = [{ id: 7, schoolId: 1 }];

    await request(app)
      .put('/api/schools/1/suspension')
      .send({ isSuspended: true })
      .expect(200, { id: 1, isSuspended: true });
    await request(app)
      .put('/api/schools/1/suspension')
      .send({ isSuspended: true })
      .expect(200, { id: 1, isSuspended: true });
    await request(app)
      .put('/api/schools/1/suspension')
      .send({ isSuspended: false })
      .expect(200, { id: 1, isSuspended: false });

    expect(mockState.schools).toEqual([{ id: 1, name: 'École à conserver', isSuspended: false }]);
    expect(mockState.financialObligations).toEqual([{ id: 7, schoolId: 1 }]);
    expect(mockState.auditEvents.map((event) => event.action)).toEqual(['suspend', 'reopen']);
  });

  it('blocks a school account from protected APIs while its school is suspended', async () => {
    mockState.users = [
      { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'school_admin', schoolId: 1 },
    ];
    mockState.schools = [{ id: 1, name: 'École suspendue', isSuspended: true }];

    const response = await request(app).get('/api/students').expect(423);
    expect(response.body.code).toBe('SCHOOL_SUSPENDED');
    expect(response.body.error).toContain('temporairement suspendu');
  });

  it('keeps suspension management restricted to super administrators', async () => {
    mockState.users = [
      { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'school_admin', schoolId: 1 },
    ];
    mockState.schools = [{ id: 1, name: 'École active', isSuspended: false }];

    await request(app)
      .put('/api/schools/1/suspension')
      .send({ isSuspended: true })
      .expect(403);
    expect(mockState.schools[0].isSuspended).toBe(false);
  });

  it('rejects creating a school without classNames', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', subjectNames: ['Mathématiques'] })
      .expect(400);

    expect(res.body.error).toContain('classNames must be a non-empty array');
  });

  it('rejects creating a school without subjectNames', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', classNames: ['6ème'] })
      .expect(400);

    expect(res.body.error).toContain('subjectNames must be a non-empty array');
  });

  it('creates a school when classNames and subjectNames are provided', async () => {
    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', ministryName: 'Ministère du Togo', principalName: 'Kossi AYISSOU', principalGender: 'M', classNames: ['6ème'], subjectNames: ['Mathématiques'] })
      .expect(201);

    expect(res.body).toMatchObject({ id: 1, ministryName: 'Ministère du Togo', principalName: 'Kossi AYISSOU', principalGender: 'M', promotionThreshold: '10.00' });
    expect((await request(app).get('/api/schools').expect(200)).body[0]).toMatchObject({ ministryName: 'Ministère du Togo', principalName: 'Kossi AYISSOU', principalGender: 'M' });
  });

  it('enregistre et modifie le seuil de passage de l école', async () => {
    const created = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Seuil', address: '', phone: '+228 90000000', promotionThreshold: 9, classNames: ['6ème'], subjectNames: ['Mathématiques'] })
      .expect(201);

    expect(created.body.promotionThreshold).toBe('9.00');

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Seuil', address: '', phone: '+228 90000000', promotionThreshold: 9.5 })
      .expect(200);

    expect(mockState.schools[0].promotionThreshold).toBe('9.50');
  });

  it('transmet ministryName lors de la modification d une école', async () => {
    mockState.schools = [{ id: 1, name: 'École du Lac', phone: '+228 90000000', ministryName: null }];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', ministryName: 'Ministère modifié' })
      .expect(200);

    expect(mockState.lastSchoolUpdate).toMatchObject({ ministryName: 'Ministère modifié' });
  });

  it('transmet principalName lors de la modification d une école', async () => {
    mockState.schools = [{ id: 1, name: 'École du Lac', phone: '+228 90000000', principalName: null }];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', principalName: 'Kossi AYISSOU' })
      .expect(200);

    expect(mockState.lastSchoolUpdate).toMatchObject({ principalName: 'Kossi AYISSOU' });
  });

  it('enregistre le genre explicite du responsable lors de la modification d une école', async () => {
    mockState.schools = [{ id: 1, name: 'École du Lac', phone: '+228 90000000', principalName: 'Kossi AYISSOU', principalGender: 'M' }];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', principalGender: 'F' })
      .expect(200);

    expect(mockState.lastSchoolUpdate).toMatchObject({ principalGender: 'F' });
  });

  it('preserves the current logoPath unless a new explicit logoPath is supplied', async () => {
    mockState.schools = [{ id: 1, name: 'École du Lac', phone: '+228 90000000', logoPath: 'school-logos/old-logo.png' }];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', principalName: 'Kossi AYISSOU' })
      .expect(200);

    expect(mockState.schools[0].logoPath).toBe('school-logos/old-logo.png');

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', logoPath: 'school-logos/new-logo.png' })
      .expect(200);

    expect(mockState.schools[0].logoPath).toBe('school-logos/new-logo.png');
  });

  it('uploads, reads, and replaces school logos in S3 without losing the old reference before replacement', async () => {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'school-logo-test';
    process.env.S3_REGION = 'eu-west-1';
    mockState.schools = [{ id: 1, name: 'École du Lac', logoPath: 'school-logos/old-logo.png' }];
    schoolLogoS3.objects.set('school-logo-test/school-logos/old-logo.png', Buffer.from('old logo'));

    const firstUpload = await request(app)
      .post('/api/schools/1/logo')
      .attach('logo', Buffer.from('first png logo'), { filename: 'logo.png', contentType: 'image/png' })
      .expect(200);

    expect(firstUpload.body.logoPath).toMatch(/^school-logos\/\d+-[a-f0-9]{16}-logo\.png$/);
    const firstReference = firstUpload.body.logoPath;
    expect(mockState.schools[0].logoPath).toBe(firstReference);
    expect(schoolLogoS3.objects.has(`school-logo-test/${firstReference}`)).toBe(true);
    expect(schoolLogoS3.objects.has('school-logo-test/school-logos/old-logo.png')).toBe(false);

    const logoResponse = await request(app).get('/api/schools/1/logo').expect(200);
    expect(logoResponse.headers['content-type']).toContain('image/png');
    expect(logoResponse.headers['cache-control']).toBe('private, no-cache');
    expect(logoResponse.body).toEqual(Buffer.from('first png logo'));

    const secondUpload = await request(app)
      .post('/api/schools/1/logo')
      .attach('logo', Buffer.from('replacement logo'), { filename: 'replacement.png', contentType: 'image/png' })
      .expect(200);

    expect(mockState.schools[0].logoPath).toBe(secondUpload.body.logoPath);
    expect(schoolLogoS3.objects.has(`school-logo-test/${firstReference}`)).toBe(false);
    expect(schoolLogoS3.objects.has(`school-logo-test/${secondUpload.body.logoPath}`)).toBe(true);
  });

  it('leaves the existing school logo reference intact when the S3 upload fails', async () => {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'school-logo-test';
    process.env.S3_REGION = 'eu-west-1';
    mockState.schools = [{ id: 1, name: 'École du Lac', logoPath: 'school-logos/old-logo.png' }];
    schoolLogoS3.send.mockRejectedValueOnce(new Error('S3 unavailable'));

    await request(app)
      .post('/api/schools/1/logo')
      .attach('logo', Buffer.from('new logo'), { filename: 'logo.png', contentType: 'image/png' })
      .expect(500);

    expect(mockState.schools[0].logoPath).toBe('school-logos/old-logo.png');
    expect(schoolLogoS3.objects.has('school-logo-test/school-logos/old-logo.png')).toBe(false);
  });

  it('cleans the newly uploaded S3 logo and preserves the DB reference when the school update fails', async () => {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'school-logo-test';
    process.env.S3_REGION = 'eu-west-1';
    mockState.schools = [{ id: 1, name: 'École du Lac', logoPath: 'school-logos/old-logo.png' }];
    mockState.schoolUpdateError = new Error('Database unavailable');

    await request(app)
      .post('/api/schools/1/logo')
      .attach('logo', Buffer.from('new logo'), { filename: 'logo.png', contentType: 'image/png' })
      .expect(500);

    expect(mockState.schools[0].logoPath).toBe('school-logos/old-logo.png');
    expect(schoolLogoS3.objects.size).toBe(0);
  });

  it('keeps local logo storage and access control behavior', async () => {
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ecoletrack-school-logo-'));
    process.env.FILE_STORAGE_PROVIDER = 'local';
    process.env.UPLOADS_DIR = localRoot;
    mockState.schools = [{ id: 1, name: 'École du Lac', logoPath: null }];

    try {
      const upload = await request(app)
        .post('/api/schools/1/logo')
        .attach('logo', Buffer.from('local logo'), { filename: 'logo.png', contentType: 'image/png' })
        .expect(200);
      expect(upload.body.logoPath).toMatch(/^school-logos\/\d+-[a-f0-9]{16}-logo\.png$/);
      expect(await fs.readFile(path.join(localRoot, upload.body.logoPath), 'utf8')).toBe('local logo');
      expect((await request(app).get('/api/schools/1/logo').expect(200)).body).toEqual(Buffer.from('local logo'));

      mockState.users[0] = { id: 1, uid: 'sim-admin', email: 'admin@example.com', role: 'school_admin', schoolId: 2 };
      await request(app).get('/api/schools/1/logo').expect(403);
    } finally {
      await fs.rm(localRoot, { recursive: true, force: true });
    }
  });

  it('reuses an existing global class instead of creating a duplicate class row', async () => {
    mockState.classes = [{ id: 10, name: '6ème', schoolId: null, academicYearId: 1 }];

    const res = await request(app)
      .post('/api/schools')
      .send({ name: 'École du Lac', address: '', phone: '+228 90000000', classNames: ['6ème'], subjectNames: ['Mathématiques'] })
      .expect(201);

    expect(res.body).toMatchObject({ id: 1 });
    expect(mockState.createdClasses).toHaveLength(0);
    expect(mockState.schoolClasses).toContainEqual(expect.objectContaining({ schoolId: 1, classId: 10 }));
  });

  it('creates a single global class and two school-class links for two schools', async () => {
    await request(app)
      .post('/api/schools')
      .send({ name: 'École A', address: '', phone: '+228 90000001', classNames: ['Tle A4 D 4'], subjectNames: ['Mathématiques'] })
      .expect(201);

    await request(app)
      .post('/api/schools')
      .send({ name: 'École B', address: '', phone: '+228 90000002', classNames: ['Tle A4 D 4'], subjectNames: ['Mathématiques'] })
      .expect(201);

    await request(app)
      .post('/api/classes')
      .send({ name: 'Tle A4 D 4', academicYearId: 1, schoolId: 1 })
      .expect(201);

    await request(app)
      .post('/api/classes')
      .send({ name: 'Tle A4 D 4', academicYearId: 1, schoolId: 2 })
      .expect(201);

    const globalClasses = mockState.classes.filter((item) => item.schoolId === null);
    const schoolClassLinks = mockState.schoolClasses.filter((item) => item.classId === globalClasses[0]?.id);

    expect(globalClasses).toHaveLength(1);
    expect(schoolClassLinks).toHaveLength(2);
  });

  it('adds new classes and subjects without removing existing school associations', async () => {
    mockState.schools = [{ id: 1, name: 'École A', phone: '+228 90000001' }];
    mockState.classes = [
      { id: 10, name: '4ème', schoolId: null, academicYearId: 1 },
      { id: 11, name: '5ème', schoolId: null, academicYearId: 1 },
      { id: 12, name: '3ème', schoolId: null, academicYearId: 1 },
    ];
    mockState.schoolClasses = [
      { id: 1, schoolId: 1, classId: 10, status: 'approved' },
      { id: 2, schoolId: 1, classId: 11, status: 'approved' },
    ];
    mockState.subjects = [
      { id: 20, name: 'Mathématiques', schoolId: null },
      { id: 21, name: 'Français', schoolId: null },
      { id: 22, name: 'Sciences', schoolId: null },
    ];
    mockState.schoolSubjects = [
      { id: 1, schoolId: 1, subjectId: 20, status: 'approved' },
      { id: 2, schoolId: 1, subjectId: 21, status: 'approved' },
    ];

    await request(app)
      .put('/api/schools/1')
      .send({ name: 'École A', classNames: ['3ème'], subjectNames: ['Sciences'] })
      .expect(200);

    expect(mockState.schoolClasses.map((row) => row.classId).sort()).toEqual([10, 11, 12]);
    expect(mockState.schoolSubjects.map((row) => row.subjectId).sort()).toEqual([20, 21, 22]);
  });

  it('reactivates only explicitly reassigned rejected subjects and preserves other association statuses', async () => {
    mockState.schools = [{ id: 1, name: 'École A', phone: '+228 90000001' }];
    mockState.subjects = [
      { id: 20, name: 'Mathématiques', schoolId: null },
      { id: 21, name: 'Français', schoolId: null },
      { id: 22, name: 'Sciences', schoolId: null },
      { id: 23, name: 'Histoire', schoolId: null },
      { id: 24, name: 'Latin', schoolId: null },
    ];
    mockState.schoolSubjects = [
      { id: 1, schoolId: 1, subjectId: 20, status: 'rejected' },
      { id: 2, schoolId: 1, subjectId: 21, status: 'approved' },
      { id: 3, schoolId: 1, subjectId: 22, status: 'pending' },
      { id: 4, schoolId: 1, subjectId: 24, status: 'rejected' },
      { id: 5, schoolId: 2, subjectId: 20, status: 'rejected' },
    ];

    await request(app)
      .put('/api/schools/1')
      .send({
        name: 'École A',
        subjectNames: ['Mathématiques', 'Français', 'Sciences', 'Histoire'],
      })
      .expect(200);

    const associationFor = (schoolId: number, subjectId: number) => (
      mockState.schoolSubjects.find((row) => row.schoolId === schoolId && row.subjectId === subjectId)
    );
    expect(associationFor(1, 20)).toMatchObject({ id: 1, status: 'approved' });
    expect(associationFor(1, 21)).toMatchObject({ id: 2, status: 'approved' });
    expect(associationFor(1, 22)).toMatchObject({ id: 3, status: 'pending' });
    expect(associationFor(1, 23)).toMatchObject({ status: 'approved' });
    expect(associationFor(1, 24)).toMatchObject({ id: 4, status: 'rejected' });
    expect(associationFor(2, 20)).toMatchObject({ id: 5, status: 'rejected' });
    expect(mockState.schoolSubjectUpdateCalls).toEqual([{ schoolId: 1, subjectId: 20 }]);
    expect(mockState.schoolSubjects.filter((row) => row.schoolId === 1 && row.subjectId === 20)).toHaveLength(1);
    expect(mockState.schoolSubjects.filter((row) => row.schoolId === 1 && row.subjectId === 23)).toHaveLength(1);

    mockState.users[0].role = 'school_admin';
    mockState.users[0].schoolId = 1;
    const subjectsResponse = await request(app).get('/api/subjects').expect(200);
    expect(subjectsResponse.body.find((subject: any) => subject.id === 20)).toMatchObject({
      schoolId: null,
      status: 'approved',
    });
    expect(subjectsResponse.body.find((subject: any) => subject.id === 24)).toMatchObject({
      status: 'rejected',
    });
  });

  describe('school-term catalogue permissions', () => {
    it('lists global and selected-school periods for the super admin, excluding other schools and years', async () => {
      mockState.classes = [{
        id: 10,
        name: '6e A',
        schoolId: 1,
        academicYearId: 1,
        cycleId: 1,
        cycleCode: 'college',
      }];
      mockState.schoolTerms = [
        { id: 20, schoolId: null, academicYearId: 1, name: 'Trimestre global', periodType: 'trimester', isActive: true },
        { id: 21, schoolId: 1, academicYearId: 1, name: 'Trimestre école A', periodType: 'trimester', isActive: true },
        { id: 22, schoolId: 2, academicYearId: 1, name: 'Trimestre école B', periodType: 'trimester', isActive: true },
        { id: 23, schoolId: null, academicYearId: 2, name: 'Trimestre année suivante', periodType: 'trimester', isActive: true },
      ];
      mockState.schoolCycles = [{ id: 1, schoolId: 1, cycleId: 1, isActive: true }];
      mockState.periodApprovals = [{ id: 1, schoolId: 1, periodType: 'trimester', status: 'approved' }];

      const response = await request(app)
        .get('/api/school-terms?schoolId=1&classId=10&academicYearId=1&availableOnly=true')
        .expect(200);

      expect(response.body.map((term: any) => term.id)).toEqual([20, 21]);
    });

    it('keeps school-admin available periods limited to their school and global periods', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      mockState.classes = [{
        id: 10,
        name: '6e A',
        schoolId: 1,
        academicYearId: 1,
        cycleId: 1,
        cycleCode: 'college',
      }];
      mockState.schoolTerms = [
        { id: 20, schoolId: null, academicYearId: 1, name: 'Trimestre global', periodType: 'trimester', isActive: true },
        { id: 21, schoolId: 1, academicYearId: 1, name: 'Trimestre école A', periodType: 'trimester', isActive: true },
        { id: 22, schoolId: 2, academicYearId: 1, name: 'Trimestre école B', periodType: 'trimester', isActive: true },
      ];
      mockState.schoolCycles = [{ id: 1, schoolId: 1, cycleId: 1, isActive: true }];
      mockState.periodApprovals = [{ id: 1, schoolId: 1, periodType: 'trimester', status: 'approved' }];

      const response = await request(app)
        .get('/api/school-terms?schoolId=2&classId=10&academicYearId=1&availableOnly=true')
        .expect(200);

      expect(response.body.map((term: any) => term.id)).toEqual([20, 21]);
    });

    it('allows only the Super Admin to create a global period', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app)
        .post('/api/school-terms')
        .send({ academicYearId: 1, name: 'Trimestre 1' })
        .expect(403);
      expect(mockState.schoolTerms).toHaveLength(0);

      mockState.users[0].role = 'super_admin';
      const created = await request(app)
        .post('/api/school-terms')
        .send({ academicYearId: 1, name: 'Trimestre 1', schoolId: 1 })
        .expect(201);

      expect(created.body.schoolId).toBeNull();
      expect(mockState.schoolTerms[0].schoolId).toBeNull();
    });

    it('allows only the Super Admin to modify a period', async () => {
      mockState.schoolTerms = [{ id: 10, schoolId: null, academicYearId: 1, name: 'Trimestre 1', startDate: null, endDate: null, cycleId: null }];
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app).put('/api/school-terms/10').send({ name: 'Trimestre modifié' }).expect(403);

      mockState.users[0].role = 'super_admin';
      const updated = await request(app).put('/api/school-terms/10').send({ name: 'Trimestre modifié' }).expect(200);
      expect(updated.body.name).toBe('Trimestre modifié');
    });

    it('allows only the Super Admin to delete a period', async () => {
      mockState.schoolTerms = [{ id: 10, schoolId: null, academicYearId: 1, name: 'Trimestre 1' }];
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app).delete('/api/school-terms/10').expect(403);
      expect(mockState.schoolTerms).toHaveLength(1);

      mockState.users[0].role = 'super_admin';
      await request(app).delete('/api/school-terms/10').expect(200);
      expect(mockState.schoolTerms).toHaveLength(0);
    });
  });

  describe('school period-type approvals', () => {
    it('allows a CEG school to approve trimesters and reject semesters', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      mockState.schoolCycles = [{ id: 1, schoolId: 1, cycleId: 1, isActive: true }];

      const initial = await request(app).get('/api/schools/1/period-type-approvals').expect(200);
      expect(initial.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ periodType: 'trimester', status: 'pending', cycleActive: true, available: false }),
        expect.objectContaining({ periodType: 'semester', status: 'pending', cycleActive: false, available: false }),
      ]));
      await request(app).post('/api/schools/1/period-types/trimester/approve').expect(200);
      const rejected = await request(app).post('/api/schools/1/period-types/semester/reject').expect(200);
      expect(rejected.body).toMatchObject({ periodType: 'semester', status: 'rejected', cycleActive: false, available: false });
    });

    it('allows a lycée school to approve semesters and reject trimesters', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      mockState.schoolCycles = [{ id: 1, schoolId: 1, cycleId: 2, isActive: true }];

      await request(app).post('/api/schools/1/period-types/semester/approve').expect(200);
      const rejected = await request(app).post('/api/schools/1/period-types/trimester/reject').expect(200);
      expect(rejected.body).toMatchObject({ periodType: 'trimester', status: 'rejected', cycleActive: false, available: false });
    });

    it('blocks approval without the matching active cycle but still permits rejection', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app).post('/api/schools/1/period-types/semester/approve').expect(409);

      const rejected = await request(app).post('/api/schools/1/period-types/semester/reject').expect(200);
      expect(rejected.body).toMatchObject({ periodType: 'semester', status: 'rejected', cycleActive: false, available: false });
    });

    it('keeps school-admin approval changes scoped to their own school', async () => {
      mockState.users[0].role = 'school_admin';
      mockState.users[0].schoolId = 1;
      await request(app).post('/api/schools/2/period-types/trimester/reject').expect(403);
      await request(app).get('/api/schools/2/period-type-approvals').expect(403);
    });
  });
});
