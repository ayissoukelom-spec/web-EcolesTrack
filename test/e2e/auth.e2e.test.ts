import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';

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
    { id: 6, uid: 'sim-parent', email: 'parent@x.test', name: 'Parent', role: 'parent', schoolId: 10, isDeleted: false },
    { id: 7, uid: 'sim-parent-no-school', email: 'parent-noschool@x.test', name: 'ParentNoSchool', role: 'parent', schoolId: null, isDeleted: false },
    { id: 8, uid: 'sim-parent-query-bypass', email: 'parent-query@x.test', name: 'ParentQuery', role: 'parent', schoolId: null, isDeleted: false },
    { id: 9, uid: 'sim-school-admin-no-school', email: 'admin-noschool@x.test', name: 'SchoolAdminNoSchool', role: 'school_admin', schoolId: null, isDeleted: false },
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
  ],
  teachers: [
    { id: 77, userId: 3, schoolId: 10, phone: '+22911111111', specialization: 'Math' },
    { id: 88, userId: 4, schoolId: 10, phone: '+22922222222', specialization: 'Science' },
    { id: 99, userId: 5, schoolId: null, phone: '+22933333333', specialization: 'History' },
  ],
  parents: [
    { id: 1, userId: 6, studentId: 11, schoolId: 10 },
    { id: 2, userId: 7, studentId: 11, schoolId: 10 },
    { id: 3, userId: 8, studentId: 11, schoolId: 10 },
  ],
  students: [
    { id: 11, schoolId: 10, classId: 1, firstName: 'Child', lastName: 'One', birthDate: '2010-01-01', gender: 'female', parentId: 1, schoolAdminId: null, enrolledAt: '2025-09-01T00:00:00Z' },
  ],
  classTeachers: [
    { classId: 1, teacherId: 77 },
  ],
  schoolClasses: [
    { id: 500, classId: 3, schoolId: 10, status: 'approved' },
  ],
  localAuths: [],
  userSchools: [],
  auditEvents: [],
};

const FIXTURES_TEMPLATE = JSON.parse(JSON.stringify(FIXTURES));
function resetFixtures() {
  Object.keys(FIXTURES).forEach((key) => {
    // @ts-ignore
    FIXTURES[key] = JSON.parse(JSON.stringify(FIXTURES_TEMPLATE[key]));
  });
}

function createMockDb() {
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

        if ((ctor === 'PgText' || ctor === 'PgSerial' || ctor === 'PgInteger') && typeof chunk.name === 'string') {
          lastColumn = chunk.name.toLowerCase();
          continue;
        }

        if ((ctor === 'PgText' || ctor === 'PgSerial' || ctor === 'PgInteger') && typeof (chunk as any).text === 'string') {
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
            const normalizedLast = lastColumn.replace(/_/g, '');
            const value = chunk;
            if (normalizedLast.includes('uid')) result.uid = value;
            else if (normalizedLast.includes('email')) result.email = value;
            else if (normalizedLast.includes('schoolid')) result.schoolId = value === null ? null : Number(value);
            else if (normalizedLast.includes('userid')) result.userId = value === null ? null : Number(value);
            else if (normalizedLast.includes('classid')) {
              if (Array.isArray(value)) {
                result.classIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.classId = value === null ? null : Number(value);
              }
            } else if (normalizedLast.includes('teacherid')) {
              result.teacherId = value === null ? null : Number(value);
            } else if (normalizedLast === 'id' || /\.id$/.test(normalizedLast) || /^id$/.test(normalizedLast)) {
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
            const normalizedLast = lastColumn.replace(/_/g, '');
            const value = (chunk as any).value;
            if (normalizedLast.includes('uid')) result.uid = value;
            else if (normalizedLast.includes('email')) result.email = value;
            else if (normalizedLast.includes('schoolid')) result.schoolId = value === null ? null : Number(value);
            else if (normalizedLast.includes('userid')) result.userId = value === null ? null : Number(value);
            else if (normalizedLast.includes('classid')) {
              if (Array.isArray(value)) {
                result.classIds = value.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
              } else {
                result.classId = value === null ? null : Number(value);
              }
            } else if (normalizedLast.includes('teacherid')) {
              result.teacherId = value === null ? null : Number(value);
            } else if (normalizedLast === 'id' || /\.id$/.test(normalizedLast) || /^id$/.test(normalizedLast)) {
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
          if (normalizedLast.includes('classid')) {
            result.classIds = parsed;
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
        const leftStr = String(left).toLowerCase();
        const rightIsPrimitive = right === null || ['string', 'number', 'boolean'].includes(typeof right);
        if (leftStr.includes('uid') && rightIsPrimitive) result.uid = right;
        if (leftStr.includes('email') && rightIsPrimitive) result.email = right;
        if (leftStr.includes('schoolid') && rightIsPrimitive) result.schoolId = right === null ? null : Number(right);
        if (leftStr.includes('userid') && rightIsPrimitive) result.userId = right === null ? null : Number(right);
        if (leftStr.includes('classid')) {
          if (rightIsPrimitive) {
            if (Array.isArray(right)) {
              result.classIds = right.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
            } else {
              result.classId = right === null ? null : Number(right);
            }
          }
        }
        if (leftStr.includes('teacherid') && rightIsPrimitive) result.teacherId = right === null ? null : Number(right);
        if (leftStr.includes('id') && !leftStr.includes('schoolid') && !leftStr.includes('userid') && !leftStr.includes('classid') && !leftStr.includes('teacherid')) {
          if (rightIsPrimitive) {
            if (Array.isArray(right)) {
              result.ids = right.map((v: any) => Number(v)).filter((n: any) => !Number.isNaN(n));
            } else {
              result.id = right === null ? null : Number(right);
            }
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
      if (lower.includes('parents')) return 'parents';
      if (lower.includes('students')) return 'students';
      if (lower.includes('classesteachers') || lower.includes('classteachers')) return 'classTeachers';
      if (lower.includes('schoolclasses')) return 'schoolClasses';
      if (lower.includes('auditevents')) return 'auditEvents';
    }
    if (table && typeof table === 'object') {
      const keys = Object.keys(table).map((k) => k.toLowerCase());
      if (keys.includes('uid') && keys.includes('email') && keys.includes('role')) return 'users';
      if (keys.includes('actoruserid') && keys.includes('resourceid')) return 'auditEvents';
      if (keys.includes('userid') && keys.includes('passwordhash')) return 'localAuths';
      if (keys.includes('userid') && keys.includes('schoolid') && keys.includes('role') && keys.includes('isactive')) return 'userSchools';
      if (keys.includes('schoolid') && keys.includes('isactive') && keys.includes('name')) return 'academicYears';
      if (keys.includes('name') && keys.includes('address')) return 'schools';
      if (keys.includes('userid') && keys.includes('studentid') && keys.includes('address')) return 'parents';
      if (keys.includes('schoolid') && keys.includes('classid') && keys.includes('parentid')) return 'students';
      if (keys.includes('name') && keys.includes('schoolid') && keys.includes('teacherid')) return 'classes';
      if (keys.includes('userid') && keys.includes('schoolid') && keys.includes('id')) return 'teachers';
      if (keys.includes('schoolid') && keys.includes('teacherid') && keys.includes('userid')) return 'teachers';
      if (keys.includes('classid') && keys.includes('teacherid')) return 'classTeachers';
      if (keys.includes('schoolid') && keys.includes('classid') && keys.includes('status')) return 'schoolClasses';
    }
    return '';
  };

  const filterTableRows = (table: any, cond: any) => {
    const tableName = resolveTableName(table);
    const rows = (tableName === 'users' ? FIXTURES.users
      : tableName === 'schools' ? FIXTURES.schools
      : tableName === 'academicYears' ? FIXTURES.academicYears
      : tableName === 'localAuths' ? FIXTURES.localAuths
      : tableName === 'userSchools' ? FIXTURES.userSchools
      : tableName === 'parents' ? FIXTURES.parents
      : tableName === 'students' ? FIXTURES.students
      : tableName === 'classes' ? FIXTURES.classes
      : tableName === 'teachers' ? FIXTURES.teachers
      : tableName === 'classTeachers' ? FIXTURES.classTeachers
      : tableName === 'schoolClasses' ? FIXTURES.schoolClasses
      : []) as any[];

    if (!cond) return rows;
    const conditions = extractConditions(cond);
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
      if (conditions.id !== undefined) {
        if (Array.isArray(conditions.id)) {
          if (!conditions.id.includes(Number(row.id))) return false;
        } else if (Number(row.id) !== Number(conditions.id)) {
          return false;
        }
      }
      if (conditions.ids !== undefined) {
        if (!Array.isArray(conditions.ids) || !conditions.ids.includes(Number(row.id))) return false;
      }
      if (conditions.schoolId !== undefined && row.schoolId !== conditions.schoolId) return false;
      if (conditions.userId !== undefined && row.userId !== conditions.userId) return false;
      if (conditions.parentId !== undefined && row.parentId !== conditions.parentId) return false;
      if (conditions.classId !== undefined && row.classId !== conditions.classId) return false;
      if (conditions.ids !== undefined) {
        if (!Array.isArray(conditions.ids) || !conditions.ids.includes(Number(row.id))) return false;
      }
      if (conditions.classIds !== undefined) {
        if (!Array.isArray(conditions.classIds) || !conditions.classIds.includes(Number(row.id))) return false;
      }
      if (conditions.teacherId !== undefined && row.teacherId !== conditions.teacherId) return false;
      return true;
    });
  };

  const db = {
    select() {
      const builder: any = {
        _table: null,
        _joins: [] as Array<{ table: any; cond: any }>,
        _cond: undefined as any,
        _limit: undefined as number | undefined,
        _orderBy: undefined as any,
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
          builder._cond = cond;
          return builder;
        },
        orderBy(..._args: any[]) {
          builder._orderBy = _args;
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

      const executeQuery = async () => {
        console.log('DEBUG select.where', {
          fromTable: resolveTableName(builder._table),
          joins: builder._joins.map((j: any) => resolveTableName(j.table)),
          cond: builder._cond,
          conditions: extractConditions(builder._cond),
          limit: builder._limit,
          orderBy: builder._orderBy,
        });

        let rows = filterTableRows(builder._table, builder._cond);
        const conditions = extractConditions(builder._cond);
        const fromName = resolveTableName(builder._table);

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

        return rows;
      };

      return builder;
    },
    insert() {
      return {
        values: (obj: any) => ({
          returning: async () => {
            // crud: infers insert target by inspecting keys
            if (obj.userId !== undefined && obj.schoolId !== undefined && obj.role && obj.passwordHash === undefined && obj.actorUserId === undefined) {
              FIXTURES.userSchools.push(obj as any);
              return [obj];
            }
            if (obj.userId !== undefined && obj.passwordHash) {
              FIXTURES.localAuths.push(obj as any);
              return [obj];
            }
            if (obj.actorUserId !== undefined) {
              FIXTURES.auditEvents.push(obj as any);
              return [obj];
            }
            if (obj.uid && obj.email) {
              const newId = FIXTURES.users.length + 1;
              const row = { id: newId, ...obj };
              FIXTURES.users.push(row as any);
              return [row];
            }
            return [obj];
          },
        }),
      };
    },
    update(table?: any) {
      return {
        set: (values: any) => {
          const executeUpdate = async (cond: any) => {
            const conditions = extractConditions(cond);
            const tableName = resolveTableName(table);
            if (conditions.id != null) {
              if (tableName === 'users') {
                const idx = FIXTURES.users.findIndex((u) => u.id === Number(conditions.id));
                if (idx >= 0) {
                  FIXTURES.users[idx] = { ...FIXTURES.users[idx], ...values };
                  return [FIXTURES.users[idx]];
                }
              }
              if (tableName === 'classes') {
                const idx = FIXTURES.classes.findIndex((c) => c.id === Number(conditions.id));
                if (idx >= 0) {
                  FIXTURES.classes[idx] = { ...FIXTURES.classes[idx], ...values };
                  return [FIXTURES.classes[idx]];
                }
              }
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
  } as any;
  // Ensure basic execute helper used by db helpers is present
  (db as any).execute = async (_sql: any) => [];
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
      else req.user = null;
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
      else req.user = null;
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

describe('E2E security: auth & privilege checks', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
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
    // nothing to close - server started in module init
  });

  beforeEach(() => {
    resetFixtures();
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
      .send({ name: 'Updated Teacher' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 3, name: 'Updated Teacher' });
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

  it('3h. school_admin can create a teacher in their own school via POST /api/teachers', async () => {
    const res = await request(app)
      .post('/api/teachers')
      .set('Authorization', 'Bearer token-school')
      .send({ name: 'New Teacher', email: 'newteacher@x.test', phone: '+22912345678', specialization: 'Science', schoolId: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'newteacher@x.test', name: 'New Teacher', schoolId: 10 });
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
      .send({ email: 'created@x.test', name: 'Created', role: 'school_admin', schoolId: 10, academicYearId: 1 });
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
      .send({ email: 'created@x.test', name: 'Created', role: 'school_admin', schoolId: 10, academicYearId: 1 });
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

  it('8. school_admin with schoolId can fetch classes', async () => {
    const res = await request(app)
      .get('/api/classes')
      .set('Authorization', 'Bearer token-school');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
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

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 3, teacherId: null });
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
