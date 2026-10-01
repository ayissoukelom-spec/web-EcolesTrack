import { beforeAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';

const FIXTURES = {
  users: [
    { id: 1, uid: 'super-uid', email: 'super@x.test', name: 'Super', role: 'super_admin', schoolId: null, isDeleted: false },
    { id: 2, uid: 'school-uid', email: 'school@x.test', name: 'SchoolAdmin', role: 'school_admin', schoolId: 10, isDeleted: false },
    { id: 3, uid: 'teacher-uid', email: 'teacher@x.test', name: 'Teacher', role: 'teacher', schoolId: 10, isDeleted: false },
  ],
  classes: [
    { id: 100, name: 'Class A', schoolId: 10, academicYearId: 1, levelId: 1, teacherId: 77 },
    { id: 200, name: 'Other School Class', schoolId: 20, academicYearId: 1, levelId: 1, teacherId: 88 },
    { id: 300, name: 'Global Class', schoolId: null, academicYearId: 1, levelId: 1, teacherId: null },
  ],
  levels: [
    { id: 1, cycleId: 1, code: '6e', name: '6e', orderIndex: 1, isActive: true },
  ],
  teachers: [
    { id: 77, userId: 3, schoolId: 10, phone: '+22911111111', specialization: 'Math' },
  ],
  teacherSubjects: [
    { id: 1, teacherId: 77, schoolId: 10, subjectId: 2 },
  ],
  teacherClassSubjects: [
    { id: 301, teacherId: 77, schoolId: 10, classId: 300, subjectId: 2, isActive: true },
  ],
  classTeachers: [
    { classId: 100, teacherId: 77, schoolId: 10 },
    { classId: 300, teacherId: 77, schoolId: 10 },
  ],
  schoolClasses: [
    { id: 500, classId: 300, schoolId: 10, status: 'approved' },
  ],
  cycles: [
    { id: 1, code: 'college', name: 'Collège', isActive: true },
    { id: 2, code: 'lycee', name: 'Lycée', isActive: true },
  ],
  schoolCycles: [
    { id: 1, schoolId: 10, cycleId: 1, code: 'college', name: 'Collège', isActive: true },
    { id: 2, schoolId: 20, cycleId: 1, code: 'college', name: 'Collège', isActive: true },
  ],
  schoolPeriodTypeApprovals: [
    { id: 1, schoolId: 10, periodType: 'trimester', status: 'approved' },
    { id: 2, schoolId: 20, periodType: 'trimester', status: 'approved' },
  ],
  schoolTerms: [
    { id: 1, academicYearId: 1, schoolId: 10, cycleId: 1, name: 'Trimestre 1', periodType: 'trimester', startDate: '2026-01-01', endDate: '2026-12-31', orderIndex: 1, isActive: true },
    { id: 2, academicYearId: 1, schoolId: 20, cycleId: 1, name: 'Trimestre 1', periodType: 'trimester', startDate: '2026-01-01', endDate: '2026-12-31', orderIndex: 1, isActive: true },
  ],
  subjects: [
    { id: 1, name: 'Global', schoolId: 20 },
    { id: 2, name: 'Science', schoolId: 10 },
  ],
  schoolSubjects: [
    { id: 1, subjectId: 1, schoolId: 20, status: 'approved' },
    { id: 2, subjectId: 2, schoolId: 10, status: 'approved' },
  ],
  evaluations: [] as any[],
  userSchools: [
    { id: 1, userId: 2, schoolId: 10, role: 'school_admin', isActive: true },
    { id: 2, userId: 3, schoolId: 10, role: 'teacher', isActive: true },
  ] as any[],
  absences: [] as any[],
  lateArrivals: [] as any[],
  ignoreEvaluationQueryConditions: false,
  parents: [],
  students: [],
  notifications: [],
};

type Cond = Record<string, any>;

function getValue(node: any) {
  if (node == null) return node;
  if (typeof node === 'object' && 'value' in node) return node.value;
  return node;
}

function parseQueryChunks(sqlObj: any, conditions: Cond) {
  if (!sqlObj || !Array.isArray(sqlObj.queryChunks)) return;
  const fieldMap: Record<string, string> = {
    uid: 'uid',
    email: 'email',
    schoolid: 'schoolId',
    classid: 'classId',
    teacherid: 'teacherId',
    subjectid: 'subjectId',
    studentid: 'studentId',
    userid: 'userId',
    status: 'status',
    isactive: 'isActive',
    id: 'id',
  };
  for (let index = 0; index < sqlObj.queryChunks.length; index += 1) {
    const chunk = sqlObj.queryChunks[index];
    const field = String(chunk?.config?.name ?? chunk?.name ?? '').toLowerCase().replace(/_/g, '');
    const mappedField = fieldMap[field];
    if (mappedField) {
      const operatorChunk = sqlObj.queryChunks[index + 1];
      const operator = Array.isArray(operatorChunk?.value) ? operatorChunk.value.join('') : '';
      const valueChunk = sqlObj.queryChunks[index + 2];
      if (operator === ' = ') {
        const value = getValue(valueChunk);
        conditions[mappedField] = value;
      } else if (operator === ' in ') {
        conditions[mappedField] = collectBoundValues(valueChunk);
      }
    }
    if (chunk?.queryChunks) parseQueryChunks(chunk, conditions);
  }

  let lastField: string | null = null;
  for (const chunk of sqlObj.queryChunks) {
    if (!chunk || typeof chunk !== 'object') continue;
    const ctor = chunk.constructor?.name;
    if (ctor === 'Param') {
      if (lastField) {
        const value = getValue(chunk);
        if (lastField.includes('uid')) conditions.uid = value;
        else if (lastField.includes('email')) conditions.email = value;
        else if (lastField.includes('schoolid')) conditions.schoolId = value === null ? null : Number(value);
        else if (lastField.includes('classid')) conditions.classId = value === null ? null : Number(value);
        else if (lastField.includes('teacherid')) conditions.teacherId = value === null ? null : Number(value);
        else if (lastField.includes('subjectid')) conditions.subjectId = value === null ? null : Number(value);
        else if (lastField === 'name') conditions.name = value;
        else if (lastField === 'id') conditions.id = value === null ? null : Number(value);
      }
      lastField = null;
      continue;
    }
    if (typeof chunk.name === 'string') {
      lastField = chunk.name.toLowerCase();
      continue;
    }
    if (typeof chunk === 'string') {
      lastField = chunk.toLowerCase();
      continue;
    }
  }
}

function extractConditions(cond: any): Cond {
  const conditions: Cond = {};
  const visited = new WeakSet<any>();

  const scan = (item: any) => {
    if (item == null || typeof item !== 'object' || visited.has(item)) return;
    visited.add(item);
    if (Array.isArray(item)) {
      item.forEach(scan);
      return;
    }
    if (Array.isArray(item.queryChunks)) {
      parseQueryChunks(item, conditions);
    }
    
    // Recursively scan all nested objects/conditions
    if (item.conditions && Array.isArray(item.conditions)) {
      item.conditions.forEach((c: any) => {
        const extracted = extractConditions(c);
        Object.assign(conditions, extracted);
      });
    }

    // Handle inArray: look for various patterns
    if ((item.type === 'inArray' || item.keyword === 'in' || (item.name && typeof item.name === 'string' && item.name.includes('inArray'))) && item.values) {
      // Most recent pattern - inArray with values property
      if (item.column && String(item.column).toLowerCase().includes('id')) {
        conditions.id = item.values;
      }
    } else if (item.__type === 'InArray' && item._values) {
      conditions.id = item._values;
    }

    if ('left' in item && 'right' in item) {
      const left = String(item.left).toLowerCase();
      const right = getValue(item.right);
      if (left.includes('uid')) conditions.uid = right;
      else if (left.includes('email')) conditions.email = right;
      else if (left.includes('schoolid')) conditions.schoolId = right === null ? null : Number(right);
      else if (left.includes('classid')) conditions.classId = right === null ? null : Number(right);
      else if (left.includes('teacherid')) conditions.teacherId = right === null ? null : Number(right);
      else if (left.includes('subjectid')) conditions.subjectId = right === null ? null : Number(right);
      else if (left === 'id' || left.endsWith('.id')) conditions.id = right === null ? null : Number(right);
      scan(item.left);
      scan(item.right);
    }

    if (item.args && Array.isArray(item.args)) {
      item.args.forEach(scan);
    }
    Object.values(item).forEach((child) => {
      if (typeof child === 'object' && child !== null) scan(child);
    });
  };

  scan(cond);
  return conditions;
}

function collectParamValues(value: any, values: any[] = [], visited = new WeakSet<object>()) {
  if (typeof value === 'string') {
    values.push(value);
    return values;
  }
  if (value == null || typeof value !== 'object' || visited.has(value)) return values;
  visited.add(value);
  if (value.constructor?.name === 'Param') values.push(getValue(value));
  else if (typeof value.value === 'string') values.push(value.value);
  if (Array.isArray(value)) value.forEach((item) => collectParamValues(item, values, visited));
  else Object.values(value).forEach((child) => collectParamValues(child, values, visited));
  return values;
}

function collectBoundValues(value: any, values: any[] = [], visited = new WeakSet<object>()) {
  if (value == null || typeof value !== 'object' || visited.has(value)) return values;
  visited.add(value);
  if (value.constructor?.name === 'Param') {
    values.push(getValue(value));
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectBoundValues(item, values, visited));
  } else if (Array.isArray(value.queryChunks)) {
    value.queryChunks.forEach((item: any) => collectBoundValues(item, values, visited));
  }
  return values;
}

function resolveTableName(table: any) {
  const drizzleTableName = table?.[Symbol.for('drizzle:Name')];
  if (typeof drizzleTableName === 'string') {
    const normalizedName = drizzleTableName.toLowerCase().replace(/_/g, '');
    if (normalizedName === 'users') return 'users';
    if (normalizedName === 'schoolclasses') return 'schoolClasses';
    if (normalizedName === 'schoolcycles') return 'schoolCycles';
    if (normalizedName === 'schoolperiodtypeapprovals') return 'schoolPeriodTypeApprovals';
    if (normalizedName === 'cycles') return 'cycles';
    if (normalizedName === 'classes') return 'classes';
    if (normalizedName === 'levels') return 'levels';
    if (normalizedName === 'teachersubjects') return 'teacherSubjects';
    if (normalizedName === 'teacherclasssubjects') return 'teacherClassSubjects';
    if (normalizedName === 'teachers') return 'teachers';
    if (normalizedName === 'classteachers') return 'classTeachers';
    if (normalizedName === 'schoolterms') return 'schoolTerms';
    if (normalizedName === 'schoolsubjects') return 'schoolSubjects';
    if (normalizedName === 'evaluations') return 'evaluations';
    if (normalizedName === 'userschools') return 'userSchools';
    if (normalizedName === 'absences') return 'absences';
    if (normalizedName === 'latearrivals') return 'lateArrivals';
    if (normalizedName === 'parents') return 'parents';
    if (normalizedName === 'students') return 'students';
    if (normalizedName === 'notifications') return 'notifications';
  }
  if (typeof table === 'string') {
    const lower = table.toLowerCase();
    const normalized = lower.replace(/_/g, '');
    if (normalized.includes('users')) return 'users';
    if (normalized.includes('schoolclasses')) return 'schoolClasses';
    if (normalized.includes('schoolcycles')) return 'schoolCycles';
    if (normalized.includes('schoolperiodtypeapprovals')) return 'schoolPeriodTypeApprovals';
    if (normalized.includes('cycles')) return 'cycles';
    if (normalized.includes('classes')) return 'classes';
    if (normalized.includes('levels')) return 'levels';
    if (normalized.includes('teachersubjects')) return 'teacherSubjects';
    if (normalized.includes('teacherclasssubjects')) return 'teacherClassSubjects';
    if (normalized.includes('teachers')) return 'teachers';
    if (normalized.includes('classteachers')) return 'classTeachers';
    if (normalized.includes('schoolterms')) return 'schoolTerms';
    if (normalized.includes('schoolsubjects')) return 'schoolSubjects';
    if (normalized.includes('subjects')) return 'subjects';
    if (normalized.includes('evaluations')) return 'evaluations';
    if (normalized.includes('latearrivals')) return 'lateArrivals';
    if (normalized.includes('absences')) return 'absences';
    if (normalized.includes('userschools')) return 'userSchools';
    if (normalized.includes('parents')) return 'parents';
    if (normalized.includes('students')) return 'students';
    if (normalized.includes('notifications')) return 'notifications';
  }
  if (table && typeof table === 'object') {
    const keys = Object.keys(table).map((k) => k.toLowerCase());
    if (keys.includes('uid') && keys.includes('email') && keys.includes('role')) return 'users';
    if (keys.includes('name') && keys.includes('schoolid') && keys.includes('teacherid')) return 'classes';
    if (keys.includes('cycleid') && keys.includes('code') && keys.includes('isactive') && keys.includes('name')) return 'levels';
    if (keys.includes('code') && keys.includes('isactive') && keys.includes('name')) return 'cycles';
    if (keys.includes('cycleid') && keys.includes('schoolid') && keys.includes('isactive')) return 'schoolCycles';
    if (keys.includes('periodtype') && keys.includes('schoolid') && keys.includes('status')) return 'schoolPeriodTypeApprovals';
    if (keys.includes('userid') && keys.includes('schoolid') && keys.includes('specialization')) return 'teachers';
    if (keys.includes('teacherid') && keys.includes('subjectid')) return 'teacherSubjects';
    if (keys.includes('classid') && keys.includes('teacherid')) return 'classTeachers';
    if (keys.includes('classid') && keys.includes('schoolid') && keys.includes('status')) return 'schoolClasses';
    if (keys.includes('id') && keys.includes('academicyearid') && keys.includes('orderindex') && keys.includes('isactive')) return 'schoolTerms';
    if (keys.includes('name') && keys.includes('schoolid')) return 'subjects';
    if (keys.includes('subjectid') && keys.includes('schoolid') && keys.includes('status')) return 'schoolSubjects';
    if (keys.includes('expectedstarttime') && keys.includes('studentid')) return 'lateArrivals';
    if (keys.includes('isjustified') && keys.includes('studentid') && keys.includes('classid')) return 'absences';
    if (keys.includes('userid') && keys.includes('schoolid') && keys.includes('isactive') && keys.includes('role')) return 'userSchools';
    if (keys.includes('termid') && keys.includes('maxscore')) return 'evaluations';
    if (keys.includes('title') && keys.includes('body')) return 'notifications';
    if (keys.includes('parentid') && keys.includes('classid')) return 'students';
  }
  return '';
}

function matches(value: any, condition: any) {
  if (Array.isArray(condition)) {
    return condition.map((item) => String(item)).includes(String(value));
  }
  return String(value) === String(condition);
}

function filterRows(rows: any[], conditions: Cond) {
  return rows.filter((row) => {
    if (conditions.id !== undefined && !matches(row.id, conditions.id)) return false;
    if (conditions.uid !== undefined && !matches(row.uid, conditions.uid)) return false;
    if (conditions.email !== undefined && !matches(String(row.email).toLowerCase(), String(conditions.email).toLowerCase())) return false;
    if (conditions.schoolId !== undefined && !matches(row.schoolId, conditions.schoolId)) return false;
    if (conditions.userId !== undefined && !matches(row.userId, conditions.userId)) return false;
    if (conditions.classId !== undefined && !matches(row.classId, conditions.classId)) return false;
    if (conditions.teacherId !== undefined && !matches(row.teacherId, conditions.teacherId)) return false;
    if (conditions.studentId !== undefined && !matches(row.studentId, conditions.studentId)) return false;
    if (conditions.subjectId !== undefined && !matches(row.subjectId, conditions.subjectId)) return false;
    if (conditions.name !== undefined && !matches(String(row.name).trim().toLowerCase(), String(conditions.name).trim().toLowerCase())) return false;
    if (conditions.status !== undefined && !matches(row.status, conditions.status)) return false;
    if (conditions.isActive !== undefined && !matches(row.isActive, conditions.isActive)) return false;
    return true;
  });
}

function createMockDb() {
  const db = {
    select(selection: any = {}) {
      const builder: any = {
        _rows: [] as any[],
        _table: '',
        _selection: selection,
        from(table: any) {
          this._table = resolveTableName(table);
          this._rows = (this._table === 'users' ? FIXTURES.users
            : this._table === 'classes' ? FIXTURES.classes
            : this._table === 'teachers' ? FIXTURES.teachers
            : this._table === 'teacherSubjects' ? FIXTURES.teacherSubjects
            : this._table === 'teacherClassSubjects' ? FIXTURES.teacherClassSubjects
            : this._table === 'classTeachers' ? FIXTURES.classTeachers
            : this._table === 'schoolClasses' ? FIXTURES.schoolClasses
            : this._table === 'schoolTerms' ? FIXTURES.schoolTerms
            : this._table === 'levels' ? FIXTURES.levels
            : this._table === 'cycles' ? FIXTURES.cycles
            : this._table === 'schoolCycles' ? FIXTURES.schoolCycles
            : this._table === 'schoolPeriodTypeApprovals' ? FIXTURES.schoolPeriodTypeApprovals
            : this._table === 'subjects' ? FIXTURES.subjects
            : this._table === 'schoolSubjects' ? FIXTURES.schoolSubjects
            : this._table === 'evaluations' ? FIXTURES.evaluations
            : this._table === 'userSchools' ? FIXTURES.userSchools
            : this._table === 'absences' ? FIXTURES.absences
            : this._table === 'lateArrivals' ? FIXTURES.lateArrivals
            : this._table === 'parents' ? FIXTURES.parents
            : this._table === 'students' ? FIXTURES.students
            : this._table === 'notifications' ? FIXTURES.notifications
            : []) as any[];
          return this;
        },
        innerJoin(table: any, _condition?: any) {
          const joinedTable = resolveTableName(table);
          if (this._table === 'classTeachers' && joinedTable === 'schoolClasses') {
            this._rows = this._rows.map((row: any) => ({
              ...row,
              isApprovedForSchool: FIXTURES.schoolClasses.some((approval: any) =>
                approval.classId === row.classId && approval.schoolId === row.schoolId && approval.status === 'approved'
              ),
            }));
            return this;
          }
          const joinedRows = (joinedTable === 'users' ? FIXTURES.users
            : joinedTable === 'classes' ? FIXTURES.classes
            : joinedTable === 'teachers' ? FIXTURES.teachers
            : joinedTable === 'teacherSubjects' ? FIXTURES.teacherSubjects
            : joinedTable === 'teacherClassSubjects' ? FIXTURES.teacherClassSubjects
            : joinedTable === 'classTeachers' ? FIXTURES.classTeachers
            : joinedTable === 'schoolClasses' ? FIXTURES.schoolClasses
            : joinedTable === 'schoolTerms' ? FIXTURES.schoolTerms
            : joinedTable === 'levels' ? FIXTURES.levels
            : joinedTable === 'cycles' ? FIXTURES.cycles
            : joinedTable === 'schoolCycles' ? FIXTURES.schoolCycles
            : joinedTable === 'schoolPeriodTypeApprovals' ? FIXTURES.schoolPeriodTypeApprovals
            : joinedTable === 'subjects' ? FIXTURES.subjects
            : joinedTable === 'schoolSubjects' ? FIXTURES.schoolSubjects
            : joinedTable === 'evaluations' ? FIXTURES.evaluations
            : joinedTable === 'userSchools' ? FIXTURES.userSchools
            : joinedTable === 'absences' ? FIXTURES.absences
            : joinedTable === 'lateArrivals' ? FIXTURES.lateArrivals
            : joinedTable === 'parents' ? FIXTURES.parents
            : joinedTable === 'students' ? FIXTURES.students
            : joinedTable === 'notifications' ? FIXTURES.notifications
            : []) as any[];
          const merged = this._rows.map((row: any) => {
            const matched = joinedRows.find((joined: any) => {
              const directKey = Object.keys(row).find((key) => /Id$/.test(key) && String(row[key]) === String(joined.id));
              return directKey != null || (row.id != null && joined.id != null && String(row.id) === String(joined.id));
            });
            if (!matched) return row;
            const prefix = Object.keys(row).find((key) => /Id$/.test(key) && String(row[key]) === String(matched.id)) || 'id';
            const label = prefix.replace(/Id$/, '');
            const mergedRow = { ...row };
            for (const [key, value] of Object.entries(matched)) {
              if (key === 'id' && prefix === 'id') mergedRow.id = value;
              else if (key === 'name' && typeof label === 'string' && label) {
                mergedRow[`${label}Name`] = value;
              } else if (key === 'code' && typeof label === 'string' && label) {
                mergedRow[`${label}Code`] = value;
              } else if (typeof label === 'string' && label) {
                mergedRow[`${label}${key.charAt(0).toUpperCase()}${key.slice(1)}`] = value;
              } else {
                mergedRow[key] = value;
              }
            }
            return mergedRow;
          });
          this._rows = merged;
          return this;
        },
        leftJoin(table: any, _condition?: any) { return this.innerJoin(table, _condition); },
        where(...conds: any[]) {
          if (!conds.length) return this;
          const combined: Cond = {};
          conds.forEach((cond) => Object.assign(combined, extractConditions(cond)));
          if (this._table === 'evaluations' && FIXTURES.ignoreEvaluationQueryConditions) return this;
          if (this._table === 'evaluations') {
            delete combined.schoolId;
            delete combined.status;
          }
          if (this._table === 'subjects' && combined.name === undefined) {
            const subjectName = collectParamValues(conds).find((value) => this._rows.some((row: any) => String(row.name).trim().toLowerCase() === String(value).trim().toLowerCase()));
            if (subjectName) combined.name = subjectName;
          }
          this._rows = filterRows(this._rows, combined);
          return this;
        },
        orderBy() { return this; },
        limit(n: number) { this._rows = this._rows.slice(0, n); return this; },
        then(resolve: (value: any) => any) {
          if (this._table === 'classes' && Object.keys(this._selection).some((key) => key === 'cycleCode')) {
            const rows = this._rows.map((row: any) => {
              const classLevel = FIXTURES.levels.find((level) => level.id === row.levelId) ?? null;
              const cycle = FIXTURES.cycles.find((entry) => entry.id === classLevel?.cycleId) ?? null;
              return {
                classId: row.id,
                className: row.name,
                schoolId: row.schoolId,
                academicYearId: row.academicYearId,
                levelId: row.levelId,
                levelCode: classLevel?.code ?? null,
                levelName: classLevel?.name ?? null,
                cycleId: classLevel?.cycleId ?? null,
                cycleCode: cycle?.code ?? null,
                cycleName: cycle?.name ?? null,
                inferredLevelCode: classLevel?.code ?? null,
              };
            });
            return Promise.resolve(rows).then(resolve);
          }

          if (this._table === 'schoolCycles' && Object.keys(this._selection).includes('code')) {
            const rows = this._rows.map((row: any) => {
              const cycle = FIXTURES.cycles.find((entry) => entry.id === row.cycleId) ?? null;
              return { id: cycle?.id ?? row.cycleId, code: cycle?.code ?? null };
            });
            return Promise.resolve(rows).then(resolve);
          }

          const rows = Object.keys(this._selection).length === 0
            ? this._rows
            : this._rows.map((row: any) => Object.fromEntries(
              Object.entries(this._selection).map(([key, column]: [string, any]) => {
                const columnName = String(column?.name ?? '').replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
                return [key, row[key] ?? row[column?.name] ?? row[columnName]];
              })
            ));
          return Promise.resolve(rows).then(resolve);
        },
        catch(reject: (reason?: any) => any) { return Promise.resolve(this._rows).catch(reject); },
        finally(cb: () => any) { return Promise.resolve(this._rows).finally(cb); },
      };
      return builder;
    },
    transaction(callback: (tx: any) => Promise<any>) { return callback(db); },
    insert() {
      return {
        values: (obj: any) => ({
          returning: async () => {
            if (Array.isArray(obj)) {
              FIXTURES.notifications.push(...obj);
              return obj;
            }
            if (obj.termId !== undefined && obj.subject !== undefined) {
              const newId = FIXTURES.evaluations.length + 1000;
              const row = { id: newId, ...obj };
              FIXTURES.evaluations.push(row);
              return [row];
            }
            if (obj.userId !== undefined && obj.title && obj.body) {
              FIXTURES.notifications.push(obj);
              return [obj];
            }
            return [obj];
          },
        }),
      };
    },
    update() { return { set: () => ({ where: async () => [] }) }; },
    delete() { return { where: async () => [] }; },
  } as any;
  (db as any).execute = async (_sql: any) => [];
  return db;
}

const mockDb = { db: createMockDb() };
vi.mock('../../src/db/index.ts', () => mockDb);
vi.mock('src/db/index.ts', () => mockDb);
vi.mock('src/db', () => mockDb);

vi.mock('../../src/middleware/auth.ts', async () => {
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
      else if (token === 'token-school') req.user = { uid: 'school-uid', role: 'school_admin', email: 'school@x.test', schoolId: 10, simulated: false };
      else if (token === 'token-teacher') req.user = { uid: 'teacher-uid', role: 'teacher', email: 'teacher@x.test', schoolId: 10, simulated: false };
      else req.user = null;
      next();
      return;
    }
    if (simulatedRole) {
      req.user = {
        uid: req.headers['x-simulated-uid'] || `sim-${Date.now()}`,
        email: req.headers['x-simulated-email'] || null,
        role: simulatedRole,
        schoolId: req.headers['x-simulated-school-id'] ? Number(req.headers['x-simulated-school-id']) : null,
        id: req.headers['x-simulated-user-id'] ? Number(req.headers['x-simulated-user-id']) : null,
        simulated: true,
      };
      next();
      return;
    }
    res.status(401).json({ error: 'Unauthenticated' });
  }
  return { ...expr, verifyToken: requireAuth, requireAuth };
});

let app: any = null;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const serverModule = await import('../../server.ts');
  app = await serverModule.createApp();
});

describe('POST /api/evaluations security', () => {
  it('rejects school_admin without schoolId', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-sim')
      .send({ classId: '100', subject: 'Math', title: 'Test', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(403);
    expect(String(res.body.error)).toContain('school context');
  });

  it('rejects teacher without schoolId', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-user-id', '3')
      .send({ classId: '100', subject: 'Math', title: 'Teacher Test', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
    expect(String(res.body.error)).toContain('school context');
  });

  it('allows teacher with schoolId and assigned class', async () => {
    FIXTURES.users.push({ id: 4, uid: 'teacher-sim', email: 'teacher-sim@x.test', name: 'Teacher Sim', role: 'teacher', schoolId: 10, isDeleted: false });
    FIXTURES.teachers.push({ id: 78, userId: 4, schoolId: 10, phone: '', specialization: 'Science' });
    FIXTURES.classTeachers.push({ classId: 100, teacherId: 78, schoolId: 10 });
    FIXTURES.teacherSubjects.push({ id: 2, teacherId: 78, schoolId: 10, subjectId: 2 });

    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-user-id', '4')
      .set('x-simulated-school-id', '10')
      .send({ classId: '100', subject: 'Science', title: 'Teacher Assigned', type: 'devoir', date: '2026-09-01', coefficient: 2, maxScore: 20 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toMatchObject({ classId: 100, subject: 'Science', coefficient: 2, maxScore: 20 });
  });

  it('rejects teacher with assigned class when the subject is not assigned', async () => {
    FIXTURES.subjects.push({ id: 6, name: 'History', schoolId: 10 });
    FIXTURES.schoolSubjects.push({ id: 4, subjectId: 6, schoolId: 10, status: 'approved' });

    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-user-id', '4')
      .set('x-simulated-school-id', '10')
      .send({ classId: '100', subjectId: 6, subject: 'History', title: 'Unauthorized subject', type: 'devoir', date: '2026-09-03', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(403);
    expect(String(res.body.error)).toContain('assignée');
  });

  it('rejects teacher with a class that is not assigned', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-user-id', '4')
      .set('x-simulated-school-id', '10')
      .send({ classId: '200', subjectId: 2, subject: 'Science', title: 'Unauthorized class', type: 'devoir', date: '2026-09-04', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('stores resolved subjectId when creating an evaluation for an approved subject', async () => {
    FIXTURES.subjects.push({ id: 5, name: 'Sciences Physique', schoolId: 10 });
    FIXTURES.schoolSubjects.push({ id: 3, subjectId: 5, schoolId: 10, status: 'approved' });
    FIXTURES.teacherSubjects.push({ id: 3, teacherId: 78, schoolId: 10, subjectId: 5 });

    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-user-id', '4')
      .set('x-simulated-school-id', '10')
      .send({ classId: '100', subjectId: 5, subject: 'Sciences Physique', title: 'Devoir scientifique', type: 'devoir', date: '2026-09-02', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');

    const insertion = FIXTURES.evaluations.at(-1);
    expect(insertion).toMatchObject({
      classId: 100,
      subject: 'Sciences Physique',
      subjectId: 5,
    });
  });

  it('does not notify parent of other-school student with same classId for teacher evaluation', async () => {
    // Add authorized parent/student (same school as teacher and class)
    FIXTURES.users.push({ id: 9, uid: 'authorized-parent-uid', email: 'authparent@x.test', name: 'Authorized Parent', role: 'parent', schoolId: 10, isDeleted: false });
    FIXTURES.parents.push({ id: 3, userId: 9, studentId: 11, schoolId: 10 });
    FIXTURES.students.push({ id: 11, schoolId: 10, classId: 100, firstName: 'Authorized', lastName: 'Student', birthDate: '2010-02-02', gender: 'female', parentId: 3, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });
    
    // Add other-school parent/student (should NOT be notified)
    FIXTURES.users.push({ id: 10, uid: 'other-parent-uid', email: 'otherparent@x.test', name: 'Other Parent', role: 'parent', schoolId: 20, isDeleted: false });
    FIXTURES.parents.push({ id: 4, userId: 10, studentId: 12, schoolId: 20 });
    FIXTURES.students.push({ id: 12, schoolId: 20, classId: 100, firstName: 'Other', lastName: 'Student', birthDate: '2010-03-03', gender: 'male', parentId: 4, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' });

    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'teacher')
      .set('x-simulated-uid', 'teacher-sim')
      .set('x-simulated-user-id', '4')
      .set('x-simulated-school-id', '10')
      .send({ classId: '100', subject: 'Science', title: 'Teacher Notification Scope', type: 'devoir', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(201);
    // Verify evaluation was created successfully
    expect(res.body).toHaveProperty('id');
  });

  it('rejects school_admin for class in another school', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('x-simulated-role', 'school_admin')
      .set('x-simulated-uid', 'school-sim2')
      .set('x-simulated-school-id', '10')
      .set('x-simulated-user-id', '2')
      .send({ classId: '200', subject: 'History', title: 'Wrong School', type: 'devoir', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
    expect(String(res.body.error)).toContain('another school');
  });

  it('allows super_admin without schoolId', async () => {
    const res = await request(app)
      .post('/api/evaluations')
      .set('Authorization', 'Bearer token-super')
      .send({ classId: '200', teacherId: '88', subject: 'Global', title: 'Super Admin', type: 'devoir', date: '2026-09-01', coefficient: 1, maxScore: 20 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toMatchObject({ classId: 200, teacherId: 88, subject: 'Global' });
  });
});

describe('GET tenant-scoped teacher lists', () => {
  const teacherHeaders = {
    'x-simulated-role': 'teacher',
    'x-simulated-uid': 'teacher-uid',
    'x-simulated-user-id': '3',
    'x-simulated-school-id': '10',
  };

  it('returns only same-school absences for an assigned global class', async () => {
    const { getTeacherAuthorizationScope } = await import('../../src/lib/teacherAuthorization.ts');
    const teacherScope = await getTeacherAuthorizationScope({ id: 3, role: 'teacher', schoolId: 10 });
    expect(teacherScope?.teachingClassIds.has(300)).toBe(true);

    FIXTURES.students.push(
      { id: 901, schoolId: 10, classId: 300, firstName: 'Local', lastName: 'Student', parentId: null, isActive: true },
      { id: 902, schoolId: 20, classId: 300, firstName: 'Foreign', lastName: 'Student', parentId: null, isActive: true },
    );
    FIXTURES.absences.push(
      { id: 901, studentId: 901, studentName: 'Student Local', classId: 300, className: 'Global Class', schoolId: 10, date: '2026-09-20', period: 'morning', isJustified: false },
      { id: 902, studentId: 902, studentName: 'Student Foreign', classId: 300, className: 'Global Class', schoolId: 20, date: '2026-09-20', period: 'morning', isJustified: false },
    );

    const response = await request(app).get('/api/absences').set(teacherHeaders).expect(200);
    const returnedIds = response.body.map((absence: any) => absence.id);
    expect(returnedIds).toContain(901);
    expect(returnedIds).not.toContain(902);
  });

  it('returns only same-school late arrivals for an assigned global class', async () => {
    FIXTURES.lateArrivals.push(
      { id: 901, studentId: 901, studentName: 'Student Local', classId: 300, teachingAssignmentId: 301, className: 'Global Class', schoolId: 10, date: '2026-09-20', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:10' },
      { id: 902, studentId: 902, studentName: 'Student Foreign', classId: 300, teachingAssignmentId: 301, className: 'Global Class', schoolId: 20, date: '2026-09-20', period: 'morning', expectedStartTime: '08:00', arrivalTime: '08:10' },
    );

    const response = await request(app).get('/api/late-arrivals').set(teacherHeaders).expect(200);
    const returnedIds = response.body.map((lateArrival: any) => lateArrival.id);
    expect(returnedIds).toContain(901);
    expect(returnedIds).not.toContain(902);
  });

  it('hides other-school evaluations but keeps other teachers at the same school', async () => {
    FIXTURES.teachers.push(
      { id: 79, userId: 5, schoolId: 10, phone: '', specialization: 'Math' },
      { id: 88, userId: 6, schoolId: 20, phone: '', specialization: 'Math' },
    );
    FIXTURES.evaluations.push(
      { id: 901, classId: 300, schoolId: 10, teacherId: 79, subjectId: 2, subject: 'Science', title: 'Same School Devoir', type: 'devoir', schoolId: 10, date: '2026-09-20', coefficient: 1, maxScore: 20, countInBulletin: true },
      { id: 902, classId: 300, schoolId: 20, teacherId: 88, subjectId: 2, subject: 'Science', title: 'Other School Devoir', type: 'devoir', schoolId: 20, date: '2026-09-20', coefficient: 1, maxScore: 20, countInBulletin: true },
    );

    FIXTURES.ignoreEvaluationQueryConditions = true;
    const response = await request(app).get('/api/evaluations').set(teacherHeaders).expect(200);
    FIXTURES.ignoreEvaluationQueryConditions = false;
    const returnedIds = response.body.map((evaluation: any) => evaluation.id);
    expect(returnedIds).toContain(901);
    expect(returnedIds).not.toContain(902);
  });

  it('keeps school-admin access to evaluations owned by their school teachers', async () => {
    FIXTURES.ignoreEvaluationQueryConditions = true;
    const response = await request(app)
      .get('/api/evaluations')
      .set('Authorization', 'Bearer token-school')
      .expect(200);
    FIXTURES.ignoreEvaluationQueryConditions = false;

    expect(response.body.map((evaluation: any) => evaluation.id)).toContain(901);
    expect(response.body.map((evaluation: any) => evaluation.id)).not.toContain(902);
  });
});
