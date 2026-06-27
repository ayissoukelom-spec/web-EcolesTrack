import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index.ts';
import { ensureAuditEventsTableExists, ensureBulletinSnapshotTablesExist, ensureClassTeachersTableExists, ensureDefaultSchoolTermsExist, ensureEvaluationsBulletinColumns, ensureGradesTableSchema, ensureParentsTableSchema, ensureSchoolTermsTableExists, ensureStudentsTableSchema, ensureUsersTableSchema, seedDatabaseIfEmpty } from './src/db/helpers.ts';
import { requireAuth, requireOwnership, requireRole, AuthRequest, mapToAppRole } from './src/middleware/auth.ts';
import {
  schools,
  academicYears,
  users,
  localAuths,
  teachers,
  parents,
  classes,
  classTeachers,
  schoolTerms,
  students,
  evaluations,
  grades,
  absences,
  notifications,
  auditEvents,
  gradeHistory,
} from './src/db/schema.ts';
import { eq, and, or, sql, desc, notInArray, inArray } from 'drizzle-orm';
import { calculateStudentTermAverage } from './src/lib/bulletinService';
import { generateBulletinSnapshot } from './src/lib/bulletinSnapshotService.ts';
import { registerBulletinReadRoutes } from './src/lib/bulletinReadApi.ts';
import { registerBulletinPdfRoute } from './src/lib/bulletinPdfApi.ts';
import * as dotenv from 'dotenv';

// Load env variables
dotenv.config();

// Helper to resolve actor with fallback to simulated profile in dev
async function resolveActor(req: AuthRequest) {
  if (!req.user) return null;

  // In simulated mode, resolve a matching DB user first. If none exists yet,
  // fall back to the simulated profile so tokenless development flows still work.
  if (req.user.simulated) {
    // First try to resolve by uid. If not found, try to match by email (useful when
    // simulated uid differs from the DB uid for pre-existing seeded accounts).
    let dbUser: any = null;
    const rowsByUid = await db.select().from(users).where(eq(users.uid, req.user.uid));
    if (rowsByUid.length > 0) dbUser = rowsByUid[0];

    if (!dbUser && req.user.email) {
      const rowsByEmail = await db.select().from(users).where(eq(users.email, req.user.email));
      if (rowsByEmail.length > 0) dbUser = rowsByEmail[0];
    }

    if (dbUser) {
      if (dbUser.schoolId == null && req.user.schoolId != null) {
        await db.update(users).set({ schoolId: req.user.schoolId }).where(eq(users.id, dbUser.id));
        dbUser.schoolId = req.user.schoolId;
      }
      return dbUser;
    }

    return {
      uid: req.user.uid,
      role: req.user.role,
      schoolId: req.user.schoolId,
      email: req.user.email,
      name: req.user.name,
    } as any;
  }

  // Otherwise, load from DB for real authenticated users.
  const [dbUser] = await db.select().from(users).where(eq(users.uid, req.user.uid));
  if (dbUser) {
    return {
      ...dbUser,
      appRole: mapToAppRole(dbUser.role),
    } as any;
  }

  return null;
}

function normalizeSpecialization(value: any) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim() !== '').join(', ');
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function normalizeStudentGender(value: any): 'male' | 'female' | 'unknown' {
  if (typeof value !== 'string') return 'unknown';

  const cleaned = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!cleaned) return 'unknown';

  if (['m', 'male', 'masculin', 'masculine', 'garcon', 'homme', 'boy'].includes(cleaned)) {
    return 'male';
  }

  if (['f', 'female', 'feminin', 'feminine', 'fille', 'femme', 'girl'].includes(cleaned)) {
    return 'female';
  }

  return 'unknown';
}

function formatUserUpdateDiff(targetUser: any, incoming: { email: string; name: string; role: string; schoolId?: any; phone?: string; specialization?: any }) {
  const changes: string[] = [];
  if (incoming.email !== targetUser.email) {
    changes.push(`email: "${targetUser.email}" → "${incoming.email}"`);
  }
  if (incoming.name !== targetUser.name) {
    changes.push(`name: "${targetUser.name}" → "${incoming.name}"`);
  }
  if (incoming.role !== targetUser.role) {
    changes.push(`role: "${targetUser.role}" → "${incoming.role}"`);
  }

  const oldSchoolId = targetUser.schoolId != null ? String(targetUser.schoolId) : 'null';
  const newSchoolId = incoming.schoolId != null && incoming.schoolId !== '' ? String(incoming.schoolId) : 'null';
  if (oldSchoolId !== newSchoolId) {
    changes.push(`schoolId: ${oldSchoolId} → ${newSchoolId}`);
  }
  if (incoming.phone != null && incoming.phone !== '' && incoming.phone !== targetUser.phone) {
    changes.push(`phone: "${targetUser.phone ?? ''}" → "${incoming.phone}"`);
  }
  const normalizedIncomingSpecialization = normalizeSpecialization(incoming.specialization);
  const existingSpecialization = typeof targetUser.specialization === 'string'
    ? targetUser.specialization
    : Array.isArray(targetUser.specialization)
      ? targetUser.specialization.join(', ')
      : '';
  if (normalizedIncomingSpecialization !== '' && normalizedIncomingSpecialization !== existingSpecialization) {
    changes.push(`specialization: "${existingSpecialization}" → "${normalizedIncomingSpecialization}"`);
  }

  return changes.length > 0 ? `Champs modifiés: ${changes.join('; ')}` : 'Aucun champ modifié détecté.';
}

function deriveGradeModificationState(grade: any) {
  const createdAt = grade?.createdAt ? new Date(grade.createdAt) : null;
  const updatedAt = grade?.updatedAt ? new Date(grade.updatedAt) : null;

  const hasLaterUpdate = createdAt && updatedAt
    && !Number.isNaN(createdAt.getTime())
    && !Number.isNaN(updatedAt.getTime())
    && updatedAt.getTime() > createdAt.getTime();

  return hasLaterUpdate || (grade?.editCount ?? 0) > 0;
}

async function logAuditEvent(actor: any, action: string, resourceType: string, resourceId: number | null, schoolId: number | null, description: string) {
  try {
    const result = await db.insert(auditEvents).values({
      actorUserId: actor?.id ?? null,
      actorRole: actor?.role ?? 'unknown',
      actorEmail: actor?.email ?? null,
      actorName: actor?.name ?? null,
      action,
      resourceType,
      resourceId,
      schoolId,
      description,
    }).returning();

    console.log('Audit event stored:', JSON.stringify(result[0]));
  } catch (err: any) {
    console.error('Failed to write audit event:', err?.message || err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  const isProductionProxyEnvironment = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  if (isProductionProxyEnvironment) {
    app.set('trust proxy', 1);
  }

  registerBulletinReadRoutes(app, {
    resolveActor,
  });

  registerBulletinPdfRoute(app, {
    resolveActor,
    template: {
      logoFilePath: process.env.BULLETIN_LOGO_PATH,
    },
  });

  // JSON parsing middleware
  app.use(express.json());

  // Simple request logger to help debug routing issues
  app.use((req, res, next) => {
    try {
      console.log(`[REQ] ${req.method} ${req.path} headers=${JSON.stringify({ 'x-simulated-role': req.headers['x-simulated-role'], 'content-type': req.headers['content-type'] })}`);
    } catch (e) {
      // ignore logging errors
    }
    next();
  });

  // 1. Ensure audit table exists and initialise database seed if empty on startup
  console.log('Ensuring audit_events table exists...');
  try {
    await ensureAuditEventsTableExists();
  } catch (error) {
    console.error('Failed to ensure audit_events table exists, shutting down application.', error);
    process.exit(1);
  }

  console.log('Ensuring parents table schema is up to date...');
  try {
    await ensureParentsTableSchema();
  } catch (error) {
    console.error('Failed to ensure parents table schema, shutting down application.', error);
    process.exit(1);
  }

  console.log('Ensuring class teacher assignments table exists...');
  try {
    await ensureClassTeachersTableExists();
  } catch (error) {
    console.error('Failed to ensure class_teachers table exists, shutting down application.', error);
    process.exit(1);
  }

  console.log('Ensuring school terms table exists...');
  try {
    await ensureSchoolTermsTableExists();
  } catch (error) {
    console.error('Failed to ensure school_terms table exists, shutting down application.', error);
    process.exit(1);
  }

  console.log('Ensuring evaluation bulletin columns exist...');
  try {
    await ensureEvaluationsBulletinColumns();
  } catch (error) {
    console.error('Failed to ensure evaluations bulletin columns, shutting down application.', error);
    process.exit(1);
  }

  console.log('Ensuring bulletin snapshot tables exist...');
  try {
    await ensureBulletinSnapshotTablesExist();
  } catch (error) {
    console.error('Failed to ensure bulletin snapshot tables exist, shutting down application.', error);
    process.exit(1);
  }

  console.log('Ensuring students table schema is up to date...');
  try {
    await ensureStudentsTableSchema();
  } catch (error) {
    console.error('Failed to ensure students table schema, shutting down application.', error);
    process.exit(1);
  }

  console.log('Ensuring users table schema is up to date...');
  try {
    await ensureUsersTableSchema();
  } catch (error) {
    console.error('Failed to ensure users table schema, shutting down application.', error);
    process.exit(1);
  }

  console.log('Verifying if database needs seeding...');
  try {
    await seedDatabaseIfEmpty();
  } catch (error) {
    console.error('Database initialization failed, shutting down application.', error);
    process.exit(1);
  }

  console.log('Ensuring default school terms exist...');
  try {
    await ensureDefaultSchoolTermsExist();
  } catch (error) {
    console.error('Failed to ensure default school terms, shutting down application.', error);
    process.exit(1);
  }

  // CORS or Security Headers can be set if needed
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Allow embedding inside Google AI Studio
    next();
  });

  // ==========================================
  // AUTH GATE: Require authentication for non-API routes
  // ==========================================
  app.use((req, res, next) => {
    // Allow API routes, login, assets, Vite dev paths, node_modules, static/source files, and SPA root
    if (
      req.path === '/' ||
      req.path.startsWith('/api') ||
      req.path === '/login' ||
      req.path.startsWith('/assets') ||
      req.path.startsWith('/@') ||
      req.path.startsWith('/node_modules') ||
      /\.(ico|png|jpg|jpeg|gif|svg|css|js|jsx|ts|tsx|json|mjs)$/i.test(req.path)
    ) {
      return next();
    }

    // For non-API routes, require authentication
    requireAuth(req as AuthRequest, res as any, (err?: any) => {
      if (res.headersSent) return;
      const r = req as AuthRequest;
      if (err || !r.user) {
        return res.redirect('/login');
      }
      return next();
    });
  });

  // ==========================================
  // PUBLIC & SIMULATION API ROUTES
  // ==========================================

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Get available users for profile switcher/simulation with proper access control
  app.get('/api/simulation/users', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthenticated' });

      // Build filter conditions
      let filterConditions: any = eq(users.isDeleted, false);

      // Apply role-based filtering
      if (actor.role === 'school_admin' && actor.schoolId) {
        // School admin sees only users in their school.
        // Include same-school admins so the student creation form can assign a school admin account.
        filterConditions = and(
          filterConditions,
          eq(users.schoolId, actor.schoolId),
          notInArray(users.role, ['super_admin'])
        );
      } else if (actor.role === 'super_admin') {
        // Super admin sees all users (only filter by isDeleted)
      } else if (actor.role === 'parent') {
        // Parents may query their own public profile if needed.
        if (!actor.id) {
          return res.json([]);
        }
        filterConditions = and(filterConditions, eq(users.id, actor.id));
      } else if (actor.role === 'teacher') {
        // Teachers are not allowed to list simulation users (they can only view students)
        return res.status(403).json({ error: 'Forbidden' });
      } else {
        // Other roles cannot access this list
        return res.status(403).json({ error: 'Forbidden' });
      }

      const allUsers = await db
        .select({
          id: users.id,
          uid: users.uid,
          email: users.email,
          name: users.name,
          role: users.role,
          schoolId: users.schoolId,
          academicYearId: users.academicYearId,
          isDeleted: users.isDeleted,
          createdAt: users.createdAt,
          teacherPhone: teachers.phone,
          teacherSpecialization: teachers.specialization,
          parentPhone: parents.phone,
        })
        .from(users)
        .leftJoin(teachers, eq(teachers.userId, users.id))
        .leftJoin(parents, eq(parents.userId, users.id))
        .where(filterConditions);

      const normalizedById = allUsers.reduce((acc: Record<number, any>, user: any) => {
        if (!acc[user.id]) {
          acc[user.id] = {
            ...user,
            phone: user.teacherPhone || user.parentPhone || null,
            specialization: user.teacherSpecialization || null,
          };
        }
        return acc;
      }, {});

      res.json(Object.values(normalizedById));
    } catch (err: any) {
      console.error('Failed to retrieve simulation users:', err);
      res.status(500).json({ error: 'Failed to retrieve simulation users' });
    }
  });

  // Debug endpoint: show resolved simulated actor and linked DB records
  app.get('/api/debug/sim-profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const simHeaders = {
        uid: req.headers['x-simulated-uid'] || null,
        email: req.headers['x-simulated-email'] || null,
        role: req.headers['x-simulated-role'] || null,
        schoolId: req.headers['x-simulated-school-id'] || null,
      };

      const resolved = await resolveActor(req);

      // Try to find a DB user by resolved actor id/uid/email
      let dbUser: any = null;
      if (resolved && (resolved as any).id) {
        dbUser = resolved;
      } else if (req.user && req.user.email) {
        const rows = await db.select().from(users).where(eq(users.email, req.user.email));
        dbUser = rows.length > 0 ? rows[0] : null;
      } else if (req.user && req.user.uid) {
        const rows = await db.select().from(users).where(eq(users.uid, req.user.uid));
        dbUser = rows.length > 0 ? rows[0] : null;
      }

      let teacherRow: any = null;
      let classRows: any[] = [];
      let studentRows: any[] = [];

      if (dbUser && dbUser.id) {
        const t = await db.select().from(teachers).where(eq(teachers.userId, dbUser.id));
        teacherRow = t.length > 0 ? t[0] : null;
        if (teacherRow && teacherRow.id) {
          const assignmentRows = await db.select({ classId: classTeachers.classId }).from(classTeachers).where(eq(classTeachers.teacherId, teacherRow.id));
          const classIds = assignmentRows.map((a) => a.classId);
          if (classIds.length > 0) {
            classRows = await db.select().from(classes).where(sql`${classes.id} IN ${classIds}`);
          }
          for (const c of classRows) {
            const s = await db.select().from(students).where(eq(students.classId, c.id));
            studentRows = studentRows.concat(s);
          }
        }
      }

      res.json({ simHeaders, resolvedActor: resolved, dbUser, teacherRow, classCount: classRows.length, classes: classRows, studentCount: studentRows.length, students: studentRows });
    } catch (err: any) {
      console.error('Debug sim-profile failed:', err);
      res.status(500).json({ error: err?.message || 'Failed to run debug' });
    }
  });

  // Admin endpoint: create user account (super_admin only)
  app.post('/api/admin/users', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      let actor = await resolveActor(req);
      console.log('DEBUG /api/admin/users create request', {
        reqUser: req.user,
        actor: actor ? { id: actor.id, uid: actor.uid, role: actor.role, schoolId: actor.schoolId, email: actor.email } : null,
        body: req.body,
      });
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });

      // If the simulated actor exists in DB without a schoolId, fall back to header schoolId.
      if (actor.role === 'school_admin' && actor.schoolId == null && req.user.schoolId != null) {
        actor = { ...actor, schoolId: req.user.schoolId } as any;
      }

      const { uid, email, name, role, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, phone, specialization, gender, password, classIds, studentId } = req.body;
      console.log('DEBUG /api/admin/users create body', { email, role, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, gender, classIds, passwordPresent: typeof password === 'string' && password.length > 0 });
      if (!email || !name || !role) return res.status(400).json({ error: 'Missing required fields: email, name, role' });

      // Ensure role is one of allowed
      const allowed = ['super_admin', 'school_admin', 'teacher', 'parent'];
      if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });

      const schoolId = rawSchoolId != null && rawSchoolId !== '' ? parseInt(rawSchoolId, 10) : undefined;
      if (rawSchoolId != null && rawSchoolId !== '' && Number.isNaN(schoolId)) {
        return res.status(400).json({ error: 'Invalid schoolId' });
      }

      const academicYearId = rawAcademicYearId != null && rawAcademicYearId !== '' ? parseInt(rawAcademicYearId, 10) : undefined;
      if (rawAcademicYearId != null && rawAcademicYearId !== '' && Number.isNaN(academicYearId)) {
        return res.status(400).json({ error: 'Invalid academicYearId' });
      }

      // Enforce hierarchy: school_admin cannot create super_admin or school_admin
      if (actor.role === 'school_admin' && ['super_admin', 'school_admin'].includes(role)) {
        return res.status(403).json({ error: 'Forbidden: school_admin cannot create admin accounts' });
      }

      // school_admin role requires a schoolId to be specified when creating another school_admin
      if (role === 'school_admin' && (schoolId == null)) {
        return res.status(400).json({ error: 'Missing required field: schoolId is required for school_admin role' });
      }

      // Ensure teacher and parent accounts have a local password when created through admin APIs
      if (['teacher', 'parent'].includes(role) && (!password || typeof password !== 'string' || !password.trim())) {
        return res.status(400).json({ error: 'Password is required for teacher and parent accounts' });
      }

      // Check if school_admin is creating a user for a different school
      if (actor.role === 'school_admin' && schoolId != null && schoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Forbidden: cannot create users for other schools' });
      }

      const resolvedSchoolId = schoolId != null ? schoolId : actor.role === 'school_admin' ? actor.schoolId : null;

      if (role === 'school_admin' && academicYearId == null) {
        return res.status(400).json({ error: 'Missing required field: academicYearId is required for school_admin role' });
      }
      if (academicYearId != null) {
        const [yearRow] = await db.select().from(academicYears).where(eq(academicYears.id, academicYearId));
        if (!yearRow || (yearRow.schoolId !== null && yearRow.schoolId !== resolvedSchoolId)) {
          return res.status(400).json({ error: 'Invalid academicYearId for selected school' });
        }
      }

      // Generate a uid if none provided
      const finalUid = uid || `${role}_${Date.now()}`;

      // Check existing by uid or email
      const exists = await db.select().from(users).where(sql`(uid = ${finalUid} OR email = ${email})`);
      if (exists.length > 0) return res.status(409).json({ error: 'User with same uid or email already exists' });

      const newUserRows = await db.insert(users).values({ uid: finalUid, email, name, role, schoolId: resolvedSchoolId, academicYearId, gender: gender ?? null }).returning();
      const createdUser = newUserRows[0];

      // Create linked profile for teacher/parent
      let teacherProfile: any = null;
      if (role === 'parent') {
        const normalizedStudentId = studentId != null && studentId !== '' ? parseInt(studentId, 10) : undefined;
        const parentStudentId = Number.isNaN(normalizedStudentId as number) ? undefined : normalizedStudentId;
        let parentSchoolId = resolvedSchoolId ?? null;

        if (parentStudentId) {
          const [studentRow] = await db
            .select({ schoolId: students.schoolId })
            .from(students)
            .where(eq(students.id, parentStudentId));
          if (studentRow && parentSchoolId == null && studentRow.schoolId != null) {
            parentSchoolId = studentRow.schoolId;
          }
        }

        if (actor.role !== 'super_admin' && parentSchoolId != null && actor.schoolId != null && parentSchoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Forbidden: cannot create parent for another school' });
        }

        await db.insert(parents).values({
          userId: createdUser.id,
          phone: phone || '',
          address: '',
          studentId: parentStudentId || undefined,
          schoolId: parentSchoolId,
        });
      } else if (role === 'teacher') {
        const teacherResult = await db.insert(teachers)
          .values({ userId: createdUser.id, schoolId: resolvedSchoolId, phone: phone || '', specialization: normalizeSpecialization(specialization) || null })
          .returning();
        teacherProfile = teacherResult[0];

        // Assign provided classes to this teacher when classIds are supplied
        if (Array.isArray(classIds) && classIds.length > 0) {
          console.log('Assigning classes to teacher (admin create):', { teacherId: teacherProfile?.id, classIds });
          for (const rawClassId of classIds) {
            const cid = Number(rawClassId);
            if (Number.isNaN(cid)) continue;
            const [cls] = await db.select().from(classes).where(eq(classes.id, cid));
            if (!cls) continue;
            if (resolvedSchoolId != null && cid && cls.schoolId !== resolvedSchoolId) continue;
            try {
              const existingAssignment = await db.select().from(classTeachers).where(and(eq(classTeachers.classId, cid), eq(classTeachers.teacherId, teacherProfile.id)));
              if (existingAssignment.length === 0) {
                await db.insert(classTeachers).values({ classId: cid, teacherId: teacherProfile.id });
              }
            } catch (e: any) {
              console.warn('Failed to assign teacher to class', cid, e?.message || e);
            }
          }
        }
      }

      // Create local auth credentials when password is provided
      if (password && typeof password === 'string') {
        const crypto = await import('node:crypto');
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
        const existingLocal = await db.select().from(localAuths).where(eq(localAuths.userId, createdUser.id));
        if (existingLocal.length > 0) {
          await db.update(localAuths).set({ passwordHash: hash, salt }).where(eq(localAuths.userId, createdUser.id));
        } else {
          await db.insert(localAuths).values({ userId: createdUser.id, passwordHash: hash, salt }).returning();
        }
      }

      await logAuditEvent(actor, 'create', 'user', createdUser.id, actor.schoolId ?? null, `${actor.role === 'school_admin' ? 'School admin' : 'Super admin'} ${actor.email || actor.uid} created ${role} account ${createdUser.email}`);

      res.status(201).json({
        ...createdUser,
        specialization: role === 'teacher' ? (teacherProfile?.specialization || null) : null,
        phone: role === 'teacher' ? (teacherProfile?.phone || phone || '') : role === 'parent' ? phone || '' : undefined,
      });
    } catch (err: any) {
      console.error('Error creating admin user:', err);
      res.status(500).json({ error: err?.message || 'Failed to create user' });
    }
  });

  // Admin: update user account (super_admin or school_admin for same school)
  app.put('/api/admin/users/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });

      const id = parseInt(req.params.id);
      const { email, name, role, schoolId, academicYearId: rawAcademicYearId, phone, specialization, gender, classIds, studentId } = req.body;
      if (!email || !name || !role) return res.status(400).json({ error: 'Missing required fields: email, name, role' });

      const academicYearId = rawAcademicYearId != null && rawAcademicYearId !== '' ? parseInt(rawAcademicYearId, 10) : undefined;
      if (rawAcademicYearId != null && rawAcademicYearId !== '' && Number.isNaN(academicYearId)) {
        return res.status(400).json({ error: 'Invalid academicYearId' });
      }

      const allowed = ['super_admin', 'school_admin', 'teacher', 'parent'];
      if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });

      // Check if school_admin is modifying a user outside their school
      const [targetUser] = await db.select().from(users).where(eq(users.id, id));
      console.log('DEBUG delete: actor=', { uid: actor?.uid, role: actor?.role, schoolId: actor?.schoolId }, 'targetId=', id, 'targetUser=', targetUser ? { id: targetUser.id, role: targetUser.role, schoolId: targetUser.schoolId } : null);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'school_admin' && actor.schoolId !== targetUser.schoolId) {
        return res.status(403).json({ error: 'Forbidden: cannot modify users outside your school' });
      }

      // Enforce hierarchy: school_admin cannot modify to super_admin or school_admin
      if (actor.role === 'school_admin' && ['super_admin', 'school_admin'].includes(role)) {
        return res.status(403).json({ error: 'Forbidden: school_admin cannot modify admin accounts' });
      }

      // school_admin cannot modify other admins even if in same school
      if (actor.role === 'school_admin' && ['super_admin', 'school_admin'].includes(targetUser.role)) {
        return res.status(403).json({ error: 'Forbidden: school_admin cannot modify admin accounts' });
      }

      const existingSameEmail = await db.select().from(users).where(sql`email = ${email} AND id != ${id}`);
      if (existingSameEmail.length > 0) return res.status(409).json({ error: 'Email already in use by another user' });

      const updatedValues: any = { email, name, role, schoolId: schoolId ? parseInt(schoolId, 10) : null, gender: gender ?? null };
      if (role === 'school_admin') {
        if (academicYearId == null) {
          return res.status(400).json({ error: 'Missing required field: academicYearId is required for school_admin role' });
        }
        const selectedSchoolId = schoolId ? parseInt(schoolId) : null;
        const [yearRow] = await db.select().from(academicYears).where(eq(academicYears.id, academicYearId));
        if (!yearRow || (yearRow.schoolId !== null && yearRow.schoolId !== selectedSchoolId)) {
          return res.status(400).json({ error: 'Invalid academicYearId for selected school' });
        }
        updatedValues.academicYearId = academicYearId;
      } else {
        updatedValues.academicYearId = null;
      }

      const updatedUsers = await db.update(users)
        .set(updatedValues)
        .where(eq(users.id, id))
        .returning();

      if (updatedUsers.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (role === 'teacher') {
        await db.delete(parents).where(eq(parents.userId, id));
        const existingTeacher = await db.select().from(teachers).where(eq(teachers.userId, id));
        let teacherProfileId: number | null = null;
        if (existingTeacher.length > 0) {
          teacherProfileId = existingTeacher[0].id;
          await db.update(teachers).set({ schoolId: schoolId ? parseInt(schoolId, 10) : existingTeacher[0].schoolId, phone: phone || '', specialization: normalizeSpecialization(specialization) || null }).where(eq(teachers.userId, id));
        } else {
          const resolvedTeacherSchoolId = schoolId ? parseInt(schoolId, 10) : actor.schoolId;
          if (resolvedTeacherSchoolId == null) {
            return res.status(400).json({ error: 'Missing schoolId for teacher profile' });
          }
          const [inserted] = await db.insert(teachers).values({ userId: id, schoolId: resolvedTeacherSchoolId, phone: phone || '', specialization: normalizeSpecialization(specialization) || null }).returning();
          teacherProfileId = inserted?.id ?? null;
        }

        if (teacherProfileId != null) {
          // Clear previous class assignments for this teacher so the new set replaces them.
          console.log('Updating class assignments for teacher (admin update):', { teacherProfileId, classIds });
          await db.delete(classTeachers).where(eq(classTeachers.teacherId, teacherProfileId));
          if (Array.isArray(classIds) && classIds.length > 0) {
            for (const rawClassId of classIds) {
              const cid = parseInt(rawClassId, 10);
              if (Number.isNaN(cid)) continue;
              const [cls] = await db.select().from(classes).where(eq(classes.id, cid));
              if (!cls) continue;
              if (schoolId && cls.schoolId !== parseInt(schoolId)) continue;
              try {
                await db.insert(classTeachers).values({ classId: cid, teacherId: teacherProfileId });
              } catch (e: any) {
                console.warn('Failed to insert classTeachers during admin update', { cid, teacherProfileId, err: e?.message || e });
              }
            }
          }
        }
      } else if (role === 'parent') {
        const existingTeacher = await db.select().from(teachers).where(eq(teachers.userId, id));
        if (existingTeacher.length > 0) {
          await db.delete(classTeachers).where(eq(classTeachers.teacherId, existingTeacher[0].id));
        }
        await db.delete(teachers).where(eq(teachers.userId, id));
        const normalizedStudentId = studentId != null && studentId !== '' ? parseInt(String(studentId), 10) : undefined;
        const resolvedStudentId = Number.isNaN(normalizedStudentId as number) ? undefined : normalizedStudentId;
        const existingParent = await db.select().from(parents).where(eq(parents.userId, id));
        const parentValues: any = {
          phone: phone || '',
          address: '',
          schoolId: schoolId ? (Number.isNaN(Number(schoolId)) ? null : Number(schoolId)) : null,
        };
        if (resolvedStudentId != null) parentValues.studentId = resolvedStudentId;
        if (existingParent.length > 0) {
          await db.update(parents).set(parentValues).where(eq(parents.userId, id));
        } else {
          await db.insert(parents).values({ userId: id, ...parentValues });
        }
      } else {
        const existingTeacher = await db.select().from(teachers).where(eq(teachers.userId, id));
        if (existingTeacher.length > 0) {
          await db.delete(classTeachers).where(eq(classTeachers.teacherId, existingTeacher[0].id));
        }
        await db.delete(teachers).where(eq(teachers.userId, id));
        await db.delete(parents).where(eq(parents.userId, id));
      }

      const [updatedUser] = await db.select().from(users).where(eq(users.id, id));
      const diffDescription = formatUserUpdateDiff(targetUser, { email, name, role, schoolId, phone, specialization });
      await logAuditEvent(actor, 'update', 'user', updatedUser.id, actor.schoolId ?? null, `${actor.role === 'school_admin' ? 'School admin' : 'Super admin'} ${actor.email || actor.uid} updated account ${updatedUser.email}. ${diffDescription}`);
      res.json(updatedUser);
    } catch (err: any) {
      console.error('Error updating admin user:', err);
      res.status(500).json({ error: err?.message || 'Failed to update user' });
    }
  });

  // Admin: delete user account (super_admin only) - soft delete
  app.delete('/api/admin/users/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor || actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Forbidden: only super_admin can delete user accounts' });
      }

      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid user id' });
      }

      const [targetUser] = await db.select().from(users).where(eq(users.id, id));
      if (!targetUser) return res.status(404).json({ error: 'User not found' });

      // Soft delete: mark user as deleted (preserves all related data)
      await db.update(users).set({ isDeleted: true }).where(eq(users.id, id));

      await logAuditEvent(
        actor,
        'delete',
        'user',
        id,
        actor.schoolId ?? null,
        `Super admin ${actor.name} deactivated user account ${targetUser.name} (${targetUser.email})`
      );

      res.json({ success: true, id });
    } catch (err: any) {
      console.error('Error deleting user:', err);
      res.status(500).json({ error: err?.message || 'Failed to delete user' });
    }
  });

  // Audit events are visible only to super_admin
  app.get('/api/audit/events', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor || actor.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

      const events = await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt));
      res.json(events);
    } catch (err: any) {
      console.error('Failed fetching audit events:', err);
      res.status(500).json({ error: 'Failed to retrieve audit events' });
    }
  });

  // Admin: set password for a user (super_admin or school_admin for own school)
  app.post('/api/admin/set-password', requireAuth, async (req: AuthRequest, res) => {
    try {
      console.log('DEBUG /api/admin/set-password headers', {
        simulatedRole: req.headers['x-simulated-role'],
        simulatedSchoolId: req.headers['x-simulated-school-id'],
        contentType: req.headers['content-type'],
      });
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      console.log('DEBUG /api/admin/set-password actor', actor);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });

      const { userId, password } = req.body;
      console.log('DEBUG /api/admin/set-password body', { userId, passwordPresent: !!password });
      if (!userId || !password) return res.status(400).json({ error: 'Missing userId or password' });

      const [targetUser] = await db.select().from(users).where(eq(users.id, parseInt(userId)));
      console.log('DEBUG /api/admin/set-password targetUser', targetUser);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
      if (targetUser.role === 'student') return res.status(403).json({ error: 'Cannot set password for student profile' });
      if (actor.role === 'school_admin') {
        if (targetUser.schoolId !== actor.schoolId) {
          console.log('DEBUG /api/admin/set-password forbidden school mismatch', { actorSchoolId: actor.schoolId, targetSchoolId: targetUser.schoolId });
          return res.status(403).json({ error: 'Forbidden: cannot set password for users outside your school' });
        }
        if (['super_admin', 'school_admin'].includes(targetUser.role)) {
          return res.status(403).json({ error: 'Forbidden: cannot set password for admin accounts' });
        }
      }

      // simple PBKDF2 hashing
      const crypto = await import('node:crypto');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');

      const exists = await db.select().from(localAuths).where(eq(localAuths.userId, parseInt(userId)));
      if (exists.length > 0) {
        await db.update(localAuths).set({ passwordHash: hash, salt }).where(eq(localAuths.userId, parseInt(userId)));
      } else {
        await db.insert(localAuths).values({ userId: parseInt(userId), passwordHash: hash, salt }).returning();
      }

      res.json({ success: true, userId });
    } catch (err: any) {
      console.error('Error setting password:', err);
      res.status(500).json({ error: err?.message || 'Failed to set password' });
    }
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
  });

  // Local login with email + password
  app.post('/api/auth/local-login', authLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

      const normalizedEmail = email.trim().toLowerCase();
      const usersFound = await db.select().from(users).where(eq(sql`LOWER(${users.email})`, normalizedEmail));
      if (usersFound.length === 0) return res.status(401).json({ error: 'Email ou mot de passe invalide' });
      const userRecord = usersFound[0];
      if (userRecord.role === 'student') return res.status(401).json({ error: 'Connexion non autorisée pour un compte élève' });

      const authRows = await db.select().from(localAuths).where(eq(localAuths.userId, userRecord.id));
      if (authRows.length === 0) return res.status(401).json({ error: 'Aucun mot de passe enregistré pour cet utilisateur' });
      const { passwordHash, salt } = authRows[0] as any;

      const crypto = await import('node:crypto');
      const verifyHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
      if (verifyHash !== passwordHash) return res.status(401).json({ error: 'Mot de passe incorrect' });

      // On success return user profile
      res.json(userRecord);
    } catch (err: any) {
      console.error('Local login error:', err);
      res.status(500).json({ error: err?.message || 'Login failed' });
    }
  });

  // Local logout (no-op server-side for stateless simulation, returns success)
  app.post('/api/auth/logout', async (req, res) => {
    try {
      // Nothing to clear server-side in stateless setup; client should clear local simulation keys
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to logout' });
    }
  });

  // ==========================================
  // SECURE CUSTOMER OR CURRENT USER DATA
  // ==========================================

  // Sync logged in user or simulation context
  app.post('/api/auth/register-or-login', authLimiter, requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthenticated' });
      }

      if (req.body && typeof req.body === 'object' && 'role' in req.body) {
        return res.status(400).json({ error: 'Forbidden: role cannot be provided by client on this route' });
      }

      const { uid, email, name, role } = req.user;

      // Find if user already exists
      const existingUser = await db.select().from(users).where(eq(users.uid, uid));

      if (existingUser.length > 0) {
        const existing = existingUser[0];
        if (req.user.schoolId && existing.schoolId !== req.user.schoolId) {
          await db.update(users).set({ schoolId: req.user.schoolId }).where(eq(users.uid, uid));
          existing.schoolId = req.user.schoolId;
        }
        return res.json(existing);
      }

      // This endpoint must never auto-provision administrative accounts.
      const adminRoles = ['super_admin', 'school_admin', 'admin'];
      const normalizedRole = String(role || '').trim();
      if (adminRoles.includes(normalizedRole)) {
        return res.status(403).json({ error: 'Forbidden: admin accounts cannot be auto-provisioned via this route' });
      }

      const allowedRoles = ['teacher', 'parent'];
      const finalRole = allowedRoles.includes(normalizedRole) ? normalizedRole : 'parent';

      let resolvedSchoolId = req.user.schoolId ?? null;
      if (req.user.simulated && !resolvedSchoolId && finalRole !== 'super_admin') {
        const defaultSchool = await db.select().from(schools).limit(1);
        if (defaultSchool.length > 0) {
          resolvedSchoolId = defaultSchool[0].id;
        }
      }

      const newUserResult = await db.insert(users).values({
        uid,
        email: email || 'user@schooltrack.fr',
        name: name || 'Nouvel Utilisateur',
        role: finalRole,
        schoolId: resolvedSchoolId,
      }).returning();

      const createdUser = newUserResult[0];

      // Create linked profile type
      if (finalRole === 'parent') {
        await db.insert(parents).values({
          userId: createdUser.id,
          phone: '',
          address: '',
        });
      } else if (finalRole === 'teacher') {
        // Find default school if exists
        const defaultSchool = await db.select().from(schools).limit(1);
        if (defaultSchool.length > 0) {
          await db.insert(teachers).values({
            userId: createdUser.id,
            schoolId: defaultSchool[0].id,
            phone: '',
            specialization: 'Général',
          });
        }
      }

      res.json(createdUser);

      return;
    } catch (err: any) {
      console.error('Error in register-or-login:', err);
      res.status(500).json({ error: 'Failed to register or login' });
    }
  });

  // ==========================================
  // MODULE ADMINISTRATION ENDPOINTS (CRUD)
  // ==========================================

  // 1. Schools - Super Admin sees all, School Admin sees all schools (but can only manage their own)
  app.get('/api/schools', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      // Load user from database to get school_id (with simulated fallback)
      const user = await resolveActor(req);
      if (!user) return res.status(401).json({ error: 'Unauthenticated' });

      let list: any[] = [];
      if (user.role === 'super_admin') {
        // Super admin can see all schools
        list = await db.select().from(schools);
      } else if ((user.role === 'school_admin' || user.role === 'parent' || user.role === 'teacher') && user.schoolId) {
        // School admin and parent see only their assigned school
        list = await db.select().from(schools).where(eq(schools.id, user.schoolId));
      } else {
        // Other roles cannot access schools list, or user without assigned school
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve schools' });
    }
  });

  app.post('/api/schools', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { name, address, phone, classNames } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });

      // Load user and validate permission
      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Only super_admin can create schools
      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admin can create schools' });
      }

      const result = await db.insert(schools).values({ name, address, phone }).returning();
      const createdSchool = result[0];

      // If classNames are provided, create them using the global academic year
      if (Array.isArray(classNames) && classNames.length > 0) {
        try {
          const [globalActiveYear] = await db.select().from(academicYears).where(
            and(eq(academicYears.isActive, true), sql`${academicYears.schoolId} IS NULL`)
          ).limit(1);
          let yearId = globalActiveYear?.id;

          if (!yearId) {
            const [globalYear] = await db.select().from(academicYears).where(sql`${academicYears.schoolId} IS NULL`).orderBy(desc(academicYears.id)).limit(1);
            yearId = globalYear?.id;
          }

          if (!yearId) {
            const [anyYear] = await db.select().from(academicYears).orderBy(desc(academicYears.id)).limit(1);
            yearId = anyYear?.id;
          }

          if (!yearId) {
            console.warn('No academic years exist yet; skipped class creation for school because no global year was available.');
          } else {
            for (const className of classNames) {
              const trimmedClassName = String(className || '').trim();
              if (!trimmedClassName) continue;

              try {
                await db.insert(classes).values({
                  name: trimmedClassName,
                  schoolId: createdSchool.id,
                  academicYearId: yearId,
                }).returning();
              } catch (classErr: any) {
                console.warn(`Warning: Could not create class "${trimmedClassName}":`, classErr?.message);
              }
            }
          }
        } catch (classCreationErr: any) {
          console.warn('Warning: Could not create classes for school:', classCreationErr?.message);
        }
      }

      res.status(201).json(createdSchool);
    } catch (err: any) {
      console.error('Error creating school:', err);
      res.status(500).json({ error: err.message || 'Failed to create school' });
    }
  });

  app.put('/api/schools/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);
      const { name, address, phone, classNames } = req.body;

      // Load user and validate school permission
      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Only super_admin can modify schools (school_admin should not be able to modify school info)
      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admin can modify school information' });
      }

      // Fetch existing school to track changes
      const [existingSchool] = await db.select().from(schools).where(eq(schools.id, id));
      if (!existingSchool) {
        return res.status(404).json({ error: 'School not found' });
      }

      const result = await db.update(schools)
        .set({ name, address, phone })
        .where(eq(schools.id, id))
        .returning();
      
      if (result.length === 0) {
        return res.status(404).json({ error: 'School not found' });
      }

      // If classNames are provided, create them using the global academic year
      if (Array.isArray(classNames) && classNames.length > 0) {
        try {
          const [globalActiveYear] = await db.select().from(academicYears).where(
            and(eq(academicYears.isActive, true), sql`${academicYears.schoolId} IS NULL`)
          ).limit(1);
          let yearId = globalActiveYear?.id;

          if (!yearId) {
            const [globalYear] = await db.select().from(academicYears).where(sql`${academicYears.schoolId} IS NULL`).orderBy(desc(academicYears.id)).limit(1);
            yearId = globalYear?.id;
          }

          if (!yearId) {
            const [anyYear] = await db.select().from(academicYears).orderBy(desc(academicYears.id)).limit(1);
            yearId = anyYear?.id;
          }

          if (!yearId) {
            console.warn('No academic years exist yet; skipped class creation during school update because no global year was available.');
          } else {
            for (const className of classNames) {
              const trimmedClassName = String(className || '').trim();
              if (!trimmedClassName) continue;

              const existingClass = await db.select().from(classes).where(
                and(
                  eq(classes.schoolId, id),
                  eq(classes.academicYearId, yearId),
                  eq(classes.name, trimmedClassName)
                )
              ).limit(1);

              if (existingClass.length > 0) continue;

              try {
                await db.insert(classes).values({
                  name: trimmedClassName,
                  schoolId: id,
                  academicYearId: yearId,
                }).returning();
              } catch (classErr: any) {
                console.warn(`Warning: Could not create class "${trimmedClassName}" during school update:`, classErr?.message);
              }
            }
          }
        } catch (classCreationErr: any) {
          console.warn('Warning: Could not create classes during school update:', classCreationErr?.message);
        }
      }

      // Track changes for audit
      const changes: string[] = [];
      if (name && name !== existingSchool.name) {
        changes.push(`name: "${existingSchool.name}" → "${name}"`);
      }
      if (address && address !== existingSchool.address) {
        changes.push(`address: "${existingSchool.address || ''}" → "${address}"`);
      }
      if (phone && phone !== existingSchool.phone) {
        changes.push(`phone: "${existingSchool.phone || ''}" → "${phone}"`);
      }
      if (Array.isArray(classNames) && classNames.length > 0) {
        const addedNames = classNames.map((n: any) => String(n || '').trim()).filter((n: string) => n);
        if (addedNames.length > 0) {
          changes.push(`classes ajoutées: ${addedNames.join(', ')}`);
        }
      }

      const diffDescription = changes.length > 0 ? `Champs modifiés: ${changes.join('; ')}` : 'Aucun champ modifié détecté.';
      await logAuditEvent(user, 'update', 'school', id, id, `Super admin ${user.email || user.uid} updated school "${existingSchool.name}". ${diffDescription}`);
      
      res.json(result[0]);
    } catch (err: any) {
      console.error('Error updating school:', err);
      res.status(500).json({ error: 'Failed to update school' });
    }
  });

  // Get a single school by id (allowed for super_admin or users belonging to that school)
  app.get('/api/schools/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid school id' });

      const user = await resolveActor(req);
      if (!user) return res.status(401).json({ error: 'Unauthenticated' });

      const [schoolRow] = await db.select().from(schools).where(eq(schools.id, id));
      if (!schoolRow) return res.status(404).json({ error: 'École introuvable' });

      if (user.role === 'super_admin' || (user.schoolId && Number(user.schoolId) === id)) {
        return res.json(schoolRow);
      }

      return res.status(403).json({ error: 'Forbidden' });
    } catch (err: any) {
      console.error('Failed to fetch school by id:', err);
      res.status(500).json({ error: 'Failed to retrieve school' });
    }
  });

  // Endpoint to download an Excel template for batch student creation
  app.get('/api/students/template', async (req, res) => {
    try {
      // generate a small workbook with headers matching expected fields
      // lazy-import xlsx so server starts even if dependency not installed yet
      const XLSX = await import('xlsx');
      const rows = [
        // Headers: prefer both IDs and helpful parent contact fields for convenience
        ['firstName', 'lastName', 'birthDate', 'schoolId', 'classId', 'parentId', 'parentName', 'parentEmail', 'parentPhone', 'academicYearId', 'teacherId', 'schoolAdminId'],
        // Example rows
        ['Lucas', 'Dubois', '2008-04-12', 1, 1, 1, 'Marie Dubois', 'marie.dubois@example.com', '90000001', 1, 2, 1],
        ['Chloe', 'Dubois', '2010-09-25', 1, 1, 1, 'Paul Dubois', 'paul.dubois@example.com', '90000002', 1, 3, 1],
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'students');
      const buf: ArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="students_template.xlsx"');
      res.send(Buffer.from(buf));
    } catch (err: any) {
      console.error('Failed to generate Excel template', err);
      res.status(500).json({ error: 'Failed to generate students template' });
    }
  });

  // Batch import students (expects JSON array of student objects)
  app.post('/api/students/batch', requireAuth, async (req: AuthRequest, res) => {
    try {
      console.log('Received students batch import request', { headers: req.headers && { 'x-simulated-role': req.headers['x-simulated-role'], 'content-type': req.headers['content-type'] } });
      console.log('Batch request body preview:', typeof req.body === 'object' ? (Array.isArray(req.body) ? `array(${req.body.length})` : 'object') : typeof req.body);
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const userRows = await db.select().from(users).where(eq(users.uid, req.user.uid));
      let userRecord = userRows[0];
      // Dev helper: if using simulated super_admin header but no user row exists, allow for testing
      if (!userRecord && req.user.simulated && req.user.role === 'super_admin') {
        console.log('Simulated super_admin detected and no DB profile found; bypassing user lookup for dev.');
        userRecord = { uid: req.user.uid, role: 'super_admin' } as any;
      }
      if (!userRecord) return res.status(404).json({ error: 'User profile not found' });

      // Only super_admin or school_admin may import students
      if (!['super_admin', 'school_admin'].includes(userRecord.role)) {
        return res.status(403).json({ error: 'Permission denied' });
      }

      const payload = req.body;
      if (!Array.isArray(payload)) return res.status(400).json({ error: 'Expected an array of students' });

      // Pre-validate referenced IDs to provide clear errors instead of DB constraint failures
      const schoolIds = Array.from(new Set(payload.map((p: any) => p.schoolId).filter(Boolean).map((v: any) => parseInt(v))));
      const classIds = Array.from(new Set(payload.map((p: any) => p.classId).filter(Boolean).map((v: any) => parseInt(v))));
      const parentIds = Array.from(new Set(payload.map((p: any) => p.parentId).filter(Boolean).map((v: any) => parseInt(v))));

      if (userRecord.role === 'school_admin' && userRecord.schoolId) {
        schoolIds.push(userRecord.schoolId);
      }

      const existingSchoolRows = schoolIds.length > 0 ? await db.select({ id: schools.id }).from(schools).where(sql`${schools.id} IN ${schoolIds}`) : [];
      const existingClassRows = classIds.length > 0 ? await db.select({ id: classes.id }).from(classes).where(sql`${classes.id} IN ${classIds}`) : [];
      const existingParentRows = parentIds.length > 0 ? await db.select({ id: parents.id }).from(parents).where(sql`${parents.id} IN ${parentIds}`) : [];

      const existingSchoolIds = new Set(existingSchoolRows.map((r: any) => r.id));
      const existingClassIds = new Set(existingClassRows.map((r: any) => r.id));
      const existingParentIds = new Set(existingParentRows.map((r: any) => r.id));

      const inserted: any[] = [];
      const errors: any[] = [];

      for (let i = 0; i < payload.length; i++) {
        const s = payload[i];
        const firstName = s.firstName?.trim();
        const lastName = s.lastName?.trim();
        const birthDate = s.birthDate?.trim() || '';
        const resolvedSchoolId = userRecord.role === 'school_admin' ? userRecord.schoolId : s.schoolId;
        const schoolId = resolvedSchoolId ? parseInt(resolvedSchoolId) : null;
        const classId = s.classId ? parseInt(s.classId) : null;
        const parentId = s.parentId ? parseInt(s.parentId) : null;

        if (!firstName || !lastName) {
          errors.push({ row: i, reason: 'Missing firstName or lastName', data: s });
          continue;
        }
        if (!schoolId || !existingSchoolIds.has(schoolId)) {
          errors.push({ row: i, reason: `Invalid or missing schoolId: ${schoolId}`, data: s });
          continue;
        }
        if (!classId || !existingClassIds.has(classId)) {
          errors.push({ row: i, reason: `Invalid or missing classId: ${classId}`, data: s });
          continue;
        }
        if (!parentId || !existingParentIds.has(parentId)) {
          errors.push({ row: i, reason: `Invalid or missing parentId: ${parentId}`, data: s });
          continue;
        }

        try {
          const resolvedSchoolAdminId = await (async () => {
            if (userRecord.role === 'school_admin') {
              return userRecord.id;
            }

            const explicitAdminId = s.schoolAdminId ? parseInt(s.schoolAdminId) : undefined;
            if (explicitAdminId) {
              const [assignedAdmin] = await db
                .select()
                .from(users)
                .where(
                  and(
                    eq(users.id, explicitAdminId),
                    eq(users.role, 'school_admin'),
                    eq(users.schoolId, schoolId)
                  )
                );

              if (!assignedAdmin) {
                throw new Error('Invalid schoolAdminId for this school');
              }

              return assignedAdmin.id;
            }

            const admins = await db
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.role, 'school_admin'), eq(users.schoolId, schoolId)));

            if (admins.length === 1) {
              return admins[0].id;
            }

            if (admins.length === 0) {
              throw new Error('No school admin found for this school');
            }

            throw new Error('Multiple school admins found for this school. Please specify schoolAdminId in the import file.');
          })();

          const result = await db.insert(students).values({
            firstName,
            lastName,
            birthDate,
            schoolId,
            classId,
            parentId,
            schoolAdminId: resolvedSchoolAdminId,
          }).returning();
          inserted.push(result[0]);
        } catch (e: any) {
          console.error('Insert student failed for row', i, e?.message || e);
          errors.push({ row: i, reason: e?.message || 'Insert failed', data: s });
        }
      }

      res.json({ insertedCount: inserted.length, inserted, errors });
    } catch (err: any) {
      console.error('Error in students batch import:', err);
      res.status(500).json({ error: err?.message || 'Failed to import students' });
    }
  });
  
    

  app.delete('/api/schools/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!req.user) {
        return res.status(401).json({ error: 'Utilisateur non authentifié.' });
      }

      const user = await resolveActor(req);
      if (!user) {
        return res.status(404).json({ error: 'Profil utilisateur introuvable.' });
      }

      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Seul un super administrateur peut supprimer un établissement.' });
      }

      const [school] = await db.select().from(schools).where(eq(schools.id, id));
      if (!school) {
        return res.status(404).json({ error: 'École introuvable.' });
      }

      const schoolUserIds = (await db.select({ id: users.id }).from(users).where(eq(users.schoolId, id))).map((u) => u.id);
      const classIds = (await db.select({ id: classes.id }).from(classes).where(eq(classes.schoolId, id))).map((c) => c.id);
      const studentIds = (await db.select({ id: students.id }).from(students).where(eq(students.schoolId, id))).map((s) => s.id);
      const academicYearIds = (await db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.schoolId, id))).map((a) => a.id);
      const evaluationIds = classIds.length > 0
        ? (await db.select({ id: evaluations.id }).from(evaluations).where(sql`${evaluations.classId} IN ${classIds}`)).map((e) => e.id)
        : [];

      console.log(`School deletion order for school=${id}: users=${schoolUserIds.length}, classes=${classIds.length}, students=${studentIds.length}, academicYears=${academicYearIds.length}, evaluations=${evaluationIds.length}`);

      if (schoolUserIds.length > 0) {
        console.log(`Step 1/10: delete notifications for users [${schoolUserIds.join(', ')}]`);
        await db.delete(notifications).where(sql`${notifications.userId} IN ${schoolUserIds}`);
      }

      if (studentIds.length > 0) {
        console.log(`Step 2/10: delete absences for students [${studentIds.join(', ')}]`);
        await db.delete(absences).where(sql`${absences.studentId} IN ${studentIds}`);
      }
      if (classIds.length > 0) {
        console.log(`Step 3/10: delete absences for classes [${classIds.join(', ')}]`);
        await db.delete(absences).where(sql`${absences.classId} IN ${classIds}`);
      }

      if (studentIds.length > 0) {
        console.log(`Step 4/10: delete grades for students [${studentIds.join(', ')}]`);
        await db.delete(grades).where(sql`${grades.studentId} IN ${studentIds}`);
      }
      if (evaluationIds.length > 0) {
        console.log(`Step 5/10: delete grades for evaluations [${evaluationIds.join(', ')}]`);
        await db.delete(grades).where(sql`${grades.evaluationId} IN ${evaluationIds}`);
      }

      if (evaluationIds.length > 0) {
        console.log(`Step 6/10: delete evaluations [${evaluationIds.join(', ')}]`);
        await db.delete(evaluations).where(sql`${evaluations.id} IN ${evaluationIds}`);
      }

      if (studentIds.length > 0) {
        console.log(`Step 7/10: delete students [${studentIds.join(', ')}]`);
        await db.delete(students).where(sql`${students.id} IN ${studentIds}`);
      }

      if (schoolUserIds.length > 0) {
        console.log(`Step 8/10: delete parent profiles for users [${schoolUserIds.join(', ')}]`);
        await db.delete(parents).where(sql`${parents.userId} IN ${schoolUserIds}`);
      }

      if (classIds.length > 0) {
        console.log(`Step 9/10: unset teacher assignments for classes [${classIds.join(', ')}]`);
        await db.update(classes).set({ teacherId: null }).where(sql`${classes.id} IN ${classIds}`);
      }

      if (schoolUserIds.length > 0) {
        console.log(`Step 10/11: disconnect schoolAdminId and delete audit events for users [${schoolUserIds.join(', ')}]`);
        await db.update(students).set({ schoolAdminId: null }).where(sql`${students.schoolAdminId} IN ${schoolUserIds}`);
        await db.delete(auditEvents).where(sql`${auditEvents.actorUserId} IN ${schoolUserIds}`);
      }

      if (schoolUserIds.length > 0) {
        console.log(`Step 11/11: delete local auth entries for users [${schoolUserIds.join(', ')}]`);
        await db.delete(localAuths).where(sql`${localAuths.userId} IN ${schoolUserIds}`);
      }

      console.log('Step 12/12: delete audit events linked directly to school');
      await db.delete(auditEvents).where(eq(auditEvents.schoolId, id));

      console.log(`Deleting remaining teachers, classes, academic years and users for school=${id}`);
      await db.delete(teachers).where(eq(teachers.schoolId, id));

      if (classIds.length > 0) {
        await db.delete(classes).where(sql`${classes.id} IN ${classIds}`);
      }

      if (academicYearIds.length > 0) {
        await db.delete(academicYears).where(sql`${academicYears.id} IN ${academicYearIds}`);
      }

      if (schoolUserIds.length > 0) {
        await db.delete(users).where(sql`${users.id} IN ${schoolUserIds}`);
      }

      console.log('Final cleanup pass: delete any remaining school-linked entities by schoolId');
      await db.delete(students).where(eq(students.schoolId, id));
      await db.delete(classes).where(eq(classes.schoolId, id));
      await db.delete(teachers).where(eq(teachers.schoolId, id));
      await db.delete(academicYears).where(eq(academicYears.schoolId, id));
      await db.delete(users).where(eq(users.schoolId, id));
      await db.delete(auditEvents).where(eq(auditEvents.schoolId, id));

      await db.delete(schools).where(eq(schools.id, id));
      res.json({ message: 'School deleted successfully' });
    } catch (err: any) {
      console.error('Error deleting school:', err);
      const errorMessage = err?.message && (err.message.includes('constraint') || err.message.includes('foreign key'))
        ? 'Impossible de supprimer cette école car elle contient des données liées. Supprimez d’abord les éléments associés.'
        : err?.message || 'Impossible de supprimer l’école.';
      res.status(500).json({ error: errorMessage });
    }
  });

  // 2. Academic Years - Filtered by school
  app.get('/api/academic-years', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.role === 'super_admin') {
        return res.json(await db.select().from(academicYears));
      }

      if (user.role === 'school_admin') {
        // School admin sees ONLY their assigned academic year
        if (user.academicYearId) {
          return res.json(await db.select().from(academicYears).where(eq(academicYears.id, user.academicYearId)));
        }
        // If no assigned year, return empty list (admin must have an assigned year)
        return res.json([]);
      }

      // Teachers and parents see global academic years plus any legacy school-specific ones
      if (user.schoolId == null) {
        return res.json(await db.select().from(academicYears).where(sql`${academicYears.schoolId} IS NULL`));
      }

      return res.json(
        await db.select().from(academicYears).where(
          or(
            sql`${academicYears.schoolId} IS NULL`,
            eq(academicYears.schoolId, user.schoolId)
          )
        )
      );
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch academic years' });
    }
  });

  app.post('/api/academic-years', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { name, isActive } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });

      // Load user and validate permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admin can create academic years' });
      }

      // If making active, deactivate all other academic years globally
      if (isActive) {
        await db.update(academicYears).set({ isActive: false });
      }

      const result = await db.insert(academicYears).values({
        name,
        schoolId: null,
        isActive: isActive ?? true,
      }).returning();
      res.status(201).json(result[0]);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to write academic year' });
    }
  });

  // 2b. School Terms - Filtered by school / academic year
  app.get('/api/school-terms', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: schoolTerms.id,
          schoolId: schoolTerms.schoolId,
          academicYearId: schoolTerms.academicYearId,
          academicYearName: academicYears.name,
          name: schoolTerms.name,
          startDate: schoolTerms.startDate,
          endDate: schoolTerms.endDate,
          orderIndex: schoolTerms.orderIndex,
          isActive: schoolTerms.isActive,
          createdAt: schoolTerms.createdAt,
        })
        .from(schoolTerms)
        .leftJoin(academicYears, eq(schoolTerms.academicYearId, academicYears.id));

      if (actor.role !== 'super_admin') {
        if (actor.schoolId) {
          query = query.where(or(eq(schoolTerms.schoolId, actor.schoolId), sql`${schoolTerms.schoolId} IS NULL`)) as any;
        } else {
          return res.json([]);
        }
      }

      const list = await query;
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch school terms' });
    }
  });

  app.post('/api/school-terms', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const { schoolId, academicYearId, name, startDate, endDate, orderIndex, isActive } = req.body;
      if (!academicYearId || !name) {
        return res.status(400).json({ error: 'Missing mandatory term parameters' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      if (actor.role !== 'super_admin') {
        if (!actor.schoolId || (schoolId && Number(schoolId) !== actor.schoolId)) {
          return res.status(403).json({ error: 'Cannot create term for another school' });
        }
      }

      const [yearRow] = await db.select().from(academicYears).where(eq(academicYears.id, parseInt(String(academicYearId), 10)));
      if (!yearRow) return res.status(404).json({ error: 'Academic year not found' });

      if (actor.role !== 'super_admin' && actor.schoolId && yearRow.schoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Cannot create term for another school year' });
      }

      const result = await db.insert(schoolTerms).values({
        schoolId: schoolId ? parseInt(String(schoolId), 10) : yearRow.schoolId ?? null,
        academicYearId: parseInt(String(academicYearId), 10),
        name,
        startDate: startDate || null,
        endDate: endDate || null,
        orderIndex: orderIndex ? parseInt(String(orderIndex), 10) : 1,
        isActive: isActive ?? true,
      }).returning();

      res.status(201).json(result[0]);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create school term' });
    }
  });

  // 3. Classes - Filtered by school
  app.get('/api/classes', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: classes.id,
          name: classes.name,
          schoolId: classes.schoolId,
          academicYearId: classes.academicYearId,
          yearName: academicYears.name,
          teacherId: classes.teacherId,
          teacherName: users.name,
        })
        .from(classes)
        .leftJoin(teachers, eq(classes.teacherId, teachers.id))
        .leftJoin(users, eq(teachers.userId, users.id))
        .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id));

      if (actor.role !== 'super_admin') {
        // School admin, teacher, and parent see only their school's classes
        if (actor.schoolId) {
          query = query.where(eq(classes.schoolId, actor.schoolId)) as any;
        } else {
          return res.json([]);
        }
      }

      const list = await query;
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve classes' });
    }
  });

  app.post('/api/classes', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { name, schoolId, academicYearId, teacherId } = req.body;
      const trimmedName = typeof name === 'string' ? name.trim() : '';

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      const effectiveSchoolId = user.role === 'school_admin'
        ? user.schoolId
        : schoolId != null
          ? Number(schoolId)
          : undefined;

      if (!trimmedName || !effectiveSchoolId || !academicYearId) {
        return res.status(400).json({ error: `Missing required parameters. Received: name=${trimmedName}, schoolId=${effectiveSchoolId}, academicYearId=${academicYearId}` });
      }

      // Only super_admin can create classes
      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admin can create classes' });
      }

      console.log('Attempting to create class', { name: trimmedName, schoolId: effectiveSchoolId, academicYearId, teacherId });

      // Defensive duplicate check to avoid DB unique constraint errors
      try {
        const existing = await db.select().from(classes).where(and(
          eq(classes.name, trimmedName),
          eq(classes.schoolId, Number(effectiveSchoolId)),
          eq(classes.academicYearId, Number(academicYearId))
        ));
        if (existing && existing.length > 0) {
          return res.status(400).json({ error: `Classe déjà existante: ${trimmedName}` });
        }
      } catch (dupErr: any) {
        console.error('Error while checking duplicate class:', dupErr);
        // continue to attempt insert; server will return DB error if it fails
      }

      try {
        const result = await db.insert(classes).values({
          name: trimmedName,
          schoolId: Number(effectiveSchoolId),
          academicYearId: Number(academicYearId),
          teacherId: teacherId ? Number(teacherId) : null,
        }).returning();
        res.status(201).json(result[0]);
      } catch (insertErr: any) {
        console.error('DB insert error for classes:', insertErr?.message || insertErr, insertErr);
        // Postgres unique violation
        if (insertErr && insertErr.code === '23505') {
          return res.status(400).json({ error: `Classe déjà existante: ${trimmedName}` });
        }
        return res.status(500).json({ error: `Failed to create class: ${insertErr?.message || insertErr}` });
      }
    } catch (err: any) {
      console.error('Error in classes POST:', err);
      res.status(500).json({ error: `Failed to create class: ${err.message}` });
    }
  });

  app.delete('/api/classes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Load the class to check its school
      const [classToDelete] = await db.select().from(classes).where(eq(classes.id, id));
      if (!classToDelete) return res.status(404).json({ error: 'Class not found' });

      // School admin can only delete classes in their own school
      if (user.role !== 'super_admin') {
        if (user.schoolId && classToDelete.schoolId !== user.schoolId) {
          return res.status(403).json({ error: 'Cannot delete class in another school' });
        }
      }

      await db.delete(classes).where(eq(classes.id, id));
      res.json({ message: 'Class deleted successfully' });
    } catch (err: any) {
      res.status(500).json({ error: 'Cannot delete class due to linked data (absence / marks)' });
    }
  });

  // 4. Teachers - Filtered by school
  app.get('/api/teachers', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: teachers.id,
          userId: teachers.userId,
          name: users.name,
          email: users.email,
          gender: users.gender,
          phone: teachers.phone,
          specialization: teachers.specialization,
          schoolId: teachers.schoolId,
        })
        .from(teachers)
        .innerJoin(users, eq(teachers.userId, users.id));

      if (user.role !== 'super_admin') {
        // School admin and others see only their school's teachers
        if (user.schoolId) {
          query = query.where(eq(teachers.schoolId, user.schoolId)) as any;
        } else {
          return res.json([]);
        }
      }

      const teachersList = await query;
      const assignments = await db.select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId }).from(classTeachers);
      console.log('GET /api/teachers - assignments count:', assignments.length);
      const assignmentMap = new Map<number, number[]>();
      assignments.forEach((item) => {
        const existing = assignmentMap.get(item.teacherId) || [];
        existing.push(item.classId);
        assignmentMap.set(item.teacherId, existing);
      });
      const list = teachersList.map((teacher) => ({
        ...teacher,
        classIds: assignmentMap.get(teacher.id) || [],
      }));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve teachers list' });
    }
  });

  app.post('/api/teachers', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { name, email, phone, specialization, schoolId, classIds, gender } = req.body;
      if (!name || !email || !schoolId) return res.status(400).json({ error: `Missing compulsory details. Received name=${name}, email=${email}, schoolId=${schoolId}` });

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // School admin can only create teachers in their own school
      if (user.role !== 'super_admin') {
        if (user.schoolId && parseInt(schoolId) !== user.schoolId) {
          return res.status(403).json({ error: 'Cannot create teacher in another school' });
        }
      }

      // Create User entry first (fake uid for simulation unless logged in on firebase auth)
      const fakeUid = `sim_teacher_${Date.now()}`;
      const userResult = await db.insert(users).values({
        uid: fakeUid,
        email,
        name,
        role: 'teacher',
        schoolId: parseInt(schoolId),
        gender: gender ?? null,
      }).returning();

      const createdUser = userResult[0];

      const teacherResult = await db.insert(teachers).values({
        userId: createdUser.id,
        schoolId: parseInt(schoolId),
        phone,
        specialization: normalizeSpecialization(specialization) || null,
      }).returning();

      const createdTeacher = teacherResult[0];

      // Assign provided classes to this teacher when classIds are supplied
      if (Array.isArray(classIds) && classIds.length > 0) {
        console.log('Assigning classes to teacher (public create):', { teacherId: createdTeacher?.id, classIds });
        for (const rawId of classIds) {
          const cid = Number(rawId);
          if (Number.isNaN(cid)) continue;
          const [cls] = await db.select().from(classes).where(eq(classes.id, cid));
          if (!cls) continue;
          // ensure same school
          if (parseInt(schoolId) !== cls.schoolId) continue;
          try {
            const existingAssignment = await db.select().from(classTeachers).where(and(eq(classTeachers.classId, cid), eq(classTeachers.teacherId, createdTeacher.id)));
            if (existingAssignment.length === 0) {
              await db.insert(classTeachers).values({ classId: cid, teacherId: createdTeacher.id });
            }
          } catch (e: any) {
            console.error('Failed to assign teacher to class', cid, e?.message || e);
          }
        }
      }

      res.status(201).json({ ...createdUser, teacherId: createdTeacher.id, phone, specialization: normalizeSpecialization(specialization) || null });
    } catch (err: any) {
      console.error('Error creating teacher profile:', err);
      res.status(500).json({ error: `Failed to register teacher profile: ${err.message}` });
    }
  });

  // 5. Parents - Filtered by school
  app.get('/api/parents', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      if (actor.role === 'teacher') return res.status(403).json({ error: 'Forbidden' });

      // accept optional filters from query params
      const filterSchoolId = req.query.schoolId ? parseInt(String(req.query.schoolId)) : null;
      const filterClassId = req.query.classId ? parseInt(String(req.query.classId)) : null;

      // if non-super_admin requests a specific school, ensure they belong to it
      if (actor.role !== 'super_admin' && filterSchoolId && actor.schoolId && filterSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Cannot request parents for another school' });
      }

      let query = db
        .select({
          id: parents.id,
          userId: parents.userId,
          name: users.name,
          email: users.email,
          gender: users.gender,
          phone: parents.phone,
          address: parents.address,
          studentId: parents.studentId,
          studentFirstName: students.firstName,
          studentLastName: students.lastName,
          studentClassId: students.classId,
          studentSchoolId: students.schoolId,
          schoolId: parents.schoolId,
          className: classes.name,
          schoolName: schools.name,
        })
        .from(parents)
        .innerJoin(users, eq(parents.userId, users.id))
        .leftJoin(students, or(eq(parents.studentId, students.id), eq(students.parentId, parents.id)))
        .leftJoin(classes, eq(students.classId, classes.id))
        .leftJoin(schools, eq(parents.schoolId, schools.id));

      // apply query filters if provided (filter on student class/school when no parent class exists)
      console.debug('[api/parents] incoming filters:', { filterSchoolId, filterClassId, actor: actor?.role });
      if (filterSchoolId) {
        query = query.where(or(eq(parents.schoolId, filterSchoolId), eq(students.schoolId, filterSchoolId))) as any;
      }
      if (filterClassId) {
        query = query.where(eq(students.classId, filterClassId)) as any;
      }

      if (actor.role !== 'super_admin') {
        if (actor.schoolId) {
          query = query.where(or(eq(parents.schoolId, actor.schoolId), eq(students.schoolId, actor.schoolId))) as any;
        } else {
          return res.json([]);
        }
      }

      const list = await query;
      console.debug('[api/parents] returning parents count:', Array.isArray(list) ? list.length : 0, 'requestedClassId=', filterClassId, 'requestedSchoolId=', filterSchoolId);
      res.json(list);
    } catch (err: any) {
      console.error('Error fetching parents:', err);
      res.status(500).json({ error: `Failed to fetch parents list: ${err.message}` });
    }
  });

  app.post('/api/parents', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      console.debug('[api/parents POST] body received:', req.body);
          const { name, email, phone, address, schoolId, studentId, gender } = req.body;
          if (!name || !email) return res.status(400).json({ error: 'Name and Email are required' });

          // Load user and validate school permission
          const actor = await resolveActor(req);
          if (!actor) return res.status(404).json({ error: 'User not found' });

          const parsedStudentId = studentId != null && studentId !== '' ? parseInt(String(studentId), 10) : undefined;
          let resolvedSchoolId = schoolId != null && schoolId !== '' ? parseInt(String(schoolId), 10) : null;
          if (Number.isNaN(resolvedSchoolId as number)) resolvedSchoolId = null;

          if (parsedStudentId && resolvedSchoolId == null) {
            const [studentRow] = await db
              .select({ schoolId: students.schoolId })
              .from(students)
              .where(eq(students.id, parsedStudentId));
            if (studentRow && studentRow.schoolId != null) {
              resolvedSchoolId = studentRow.schoolId;
            }
          }

          const effectiveSchoolId = resolvedSchoolId ?? (actor.role !== 'super_admin' ? actor.schoolId : null);
          if (actor.role !== 'super_admin' && effectiveSchoolId != null && actor.schoolId != null && effectiveSchoolId !== actor.schoolId) {
            return res.status(403).json({ error: 'Cannot create parent in another school' });
          }

          const fakeUid = `sim_parent_${Date.now()}`;
          const userResult = await db.insert(users).values({
            uid: fakeUid,
            email,
            name,
            role: 'parent',
            schoolId: effectiveSchoolId,
            gender: gender ?? null,
          }).returning();

          const createdUser = userResult[0];
          const parentResult = await db.insert(parents).values({
            userId: createdUser.id,
            phone,
            address,
            studentId: parsedStudentId ?? null,
            schoolId: effectiveSchoolId ?? null,
          }).returning();

          console.debug('[api/parents POST] parent inserted:', parentResult[0]);
          res.status(201).json({
            ...createdUser,
            parentId: parentResult[0].id,
            phone,
            address,
            studentId: parentResult[0].studentId,
            schoolId: parentResult[0].schoolId ?? null,
          });
        } catch (err: any) {
          console.error('Error recording parent info:', err);
          res.status(500).json({ error: `Failed to record parent info: ${err.message}` });
        }
      });

  // Get single parent by id (for debugging/details)
  app.get('/api/parents/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid parent id' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthenticated' });

      const rows = await db
        .select({
          id: parents.id,
          userId: parents.userId,
          name: users.name,
          email: users.email,
          phone: parents.phone,
          address: parents.address,
          studentId: parents.studentId,
          studentClassId: students.classId,
          studentSchoolId: students.schoolId,
          schoolId: parents.schoolId,
          className: classes.name,
          schoolName: schools.name,
        })
        .from(parents)
        .leftJoin(users, eq(parents.userId, users.id))
        .leftJoin(students, eq(parents.studentId, students.id))
        .leftJoin(classes, eq(students.classId, classes.id))
        .leftJoin(schools, eq(parents.schoolId, schools.id))
        .where(eq(parents.id, id));

      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Parent not found' });
      res.json(rows[0]);
    } catch (err: any) {
      console.error('Failed to fetch parent by id:', err);
      res.status(500).json({ error: 'Failed to fetch parent' });
    }
  });

  // Return CSV template for parents (public - no auth required)
  app.get('/api/parents/template', async (req, res) => {
    try {
      const headers = ['name', 'email', 'phone', 'address', 'schoolId', 'studentEmails'];
      const csv = headers.join(',') + '\n' + '\n';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="parents_template.csv"');
      res.send(csv);
    } catch (err: any) {
      console.error('Error generating parents template:', err);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  });

  // Batch import parents - accepts JSON array of rows
  app.post('/api/parents/batch', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });

      const rows: any[] = Array.isArray(req.body) ? req.body : req.body.rows;
      if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'Invalid payload: expected array of rows' });

      const errors: { row: number; email?: string; error: string }[] = [];
      const inserted: any[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        const name = (r.name || r.fullName || '').trim();
        const email = (r.email || '').trim().toLowerCase();
        const phone = (r.phone || '').trim();
        const address = (r.address || '').trim();
        const schoolId = r.schoolId ? parseInt(r.schoolId) : (actor.role === 'school_admin' ? actor.schoolId : null);

        if (!name || !email) {
          errors.push({ row: i, email: email || undefined, error: 'name and email are required' });
          continue;
        }

        // duplicate check by email
        const existing = await db.select().from(users).where(eq(users.email, email));
        if (existing && existing.length > 0) {
          errors.push({ row: i, email, error: 'duplicate email' });
          continue;
        }

        // create user and parent profile
        const fakeUid = `sim_parent_${Date.now()}_${i}`;
        const userRes = await db.insert(users).values({ uid: fakeUid, email, name, role: 'parent', schoolId }).returning();
        const createdUser = userRes[0];

        // option: link to student by studentIds or studentNames
        let linkedStudentId: number | null = null;
        if (r.studentIds) {
          const ids = String(r.studentIds).split(/[,;]+/).map((s: string) => parseInt(s.trim())).filter((n) => !isNaN(n));
          for (const sid of ids) {
            const [srow] = await db.select().from(students).where(eq(students.id, sid));
            if (srow) { linkedStudentId = srow.id; break; }
          }
          if (ids.length > 0 && !linkedStudentId) {
            errors.push({ row: i, email, error: `studentIds provided but no matching student found (${String(r.studentIds)})` });
          }
        } else if (r.studentNames) {
          const names = String(r.studentNames).split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
          for (const nm of names) {
            const parts = nm.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
              const first = parts[0];
              const last = parts.slice(1).join(' ');
              const [srow] = await db.select().from(students).where(and(eq(sql`LOWER(${students.firstName})`, first.toLowerCase()), eq(sql`LOWER(${students.lastName})`, last.toLowerCase())));
              if (srow) { linkedStudentId = srow.id; break; }
            }
          }
          if (names.length > 0 && !linkedStudentId) {
            errors.push({ row: i, email, error: `studentNames provided but no matching student found (${String(r.studentNames)})` });
          }
        }

        const parentRes = await db.insert(parents).values({ userId: createdUser.id, phone: phone || null, address: address || null, studentId: linkedStudentId, schoolId: schoolId || null }).returning();
        inserted.push({ user: createdUser, parentId: parentRes[0].id });
      }

      // audit
      await logAuditEvent(actor, 'import', 'parents_batch', null, actor.schoolId ?? null, `Imported ${inserted.length} parents, ${errors.length} errors`);

      res.json({ insertedCount: inserted.length, errors, inserted });
    } catch (err: any) {
      console.error('Error importing parents batch:', err);
      res.status(500).json({ error: err?.message || 'Failed to import parents' });
    }
  });

  // 6. Students - Filtered by school
  app.get('/api/students', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: students.id,
          firstName: students.firstName,
          lastName: students.lastName,
          birthDate: students.birthDate,
          schoolId: students.schoolId,
          classId: students.classId,
          className: classes.name,
          yearId: academicYears.id,
          yearName: academicYears.name,
          parentId: students.parentId,
          parentName: users.name,
          schoolAdminId: students.schoolAdminId,
          enrolledAt: students.enrolledAt,
        })
        .from(students)
        .innerJoin(classes, eq(students.classId, classes.id))
        .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id))
        .leftJoin(parents, eq(students.parentId, parents.id))
        .leftJoin(users, eq(parents.userId, users.id));

      if (actor.role === 'school_admin') {
        if (actor.schoolId) {
          query = query.where(eq(students.schoolId, actor.schoolId)) as any;
        } else {
          return res.json([]);
        }
      } else if (actor.role !== 'super_admin') {
        if (actor.schoolId) {
          query = query.where(eq(students.schoolId, actor.schoolId)) as any;
        } else {
          return res.json([]);
        }
      }

      const list = await query;
      res.json(list);
    } catch (err: any) {
      console.error('Error fetching students:', err);
      res.status(500).json({ error: `Failed to retrieve students: ${err.message}` });
    }
  });

  app.post('/api/students', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { firstName, lastName, birthDate, schoolId, classId, parentId, schoolAdminId, gender, enrolledAt } = req.body;
      const parsedSchoolId = schoolId !== undefined && schoolId !== null && String(schoolId).trim() !== '' ? parseInt(String(schoolId)) : null;
      const parsedClassId = classId !== undefined && classId !== null && String(classId).trim() !== '' ? parseInt(String(classId)) : null;
      const parsedParentId = parentId !== undefined && parentId !== null && String(parentId).trim() !== '' ? parseInt(String(parentId)) : null;
      const parsedSchoolAdminId = schoolAdminId !== undefined && schoolAdminId !== null && String(schoolAdminId).trim() !== '' ? parseInt(String(schoolAdminId)) : null;
      const parsedEnrolledAt = enrolledAt ? new Date(enrolledAt) : new Date();

      // Load user and validate school permission
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const effectiveSchoolId = actor.role === 'school_admin' ? actor.schoolId : parsedSchoolId;

      if (!firstName || !lastName || !effectiveSchoolId || !parsedClassId) {
        return res.status(400).json({ error: `Missing compulsory student parameters. Received firstName=${firstName}, lastName=${lastName}, schoolId=${schoolId}, classId=${classId}` });
      }

      // School admin can only create students in their own school
      if (actor.role !== 'super_admin') {
        if (!actor.schoolId || effectiveSchoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Cannot create student in another school' });
        }
      }

      const resolvedSchoolAdminId = await (async () => {
        if (actor.role === 'school_admin') {
          return actor.id;
        }

        const explicitAdminId = schoolAdminId ? parseInt(schoolAdminId) : undefined;
        const targetSchoolId = parseInt(schoolId);

        if (explicitAdminId) {
          const [assignedAdmin] = await db
            .select()
            .from(users)
            .where(
              and(
                eq(users.id, explicitAdminId),
                eq(users.role, 'school_admin'),
                eq(users.schoolId, targetSchoolId)
              )
            );

          if (!assignedAdmin) {
            throw new Error('Invalid schoolAdminId: the selected admin is not a school admin for this school.');
          }

          return assignedAdmin.id;
        }

        const admins = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'school_admin'), eq(users.schoolId, targetSchoolId)));

        if (admins.length === 1) {
          return admins[0].id;
        }

        if (admins.length === 0) {
          throw new Error('Chaque élève doit être lié à un admin école. Aucune admin école n’est trouvé pour cette école.');
        }

        throw new Error('Plusieurs admins école existent pour cette école. Veuillez sélectionner explicitement un compte Admin École.');
      })();

      const result = await db.insert(students).values({
        firstName,
        lastName,
        birthDate,
        gender: gender ?? null,
        schoolId: effectiveSchoolId,
        classId: parsedClassId,
        parentId: parsedParentId,
        schoolAdminId: resolvedSchoolAdminId,
        enrolledAt: parsedEnrolledAt,
      }).returning();

      res.status(201).json(result[0]);
    } catch (err: any) {
      console.error('Error creating student profile:', err);
      res.status(500).json({ error: `Failed to record student profile: ${err.message}` });
    }
  });

  // Update student
  app.put('/api/students/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const studentId = parseInt(req.params.id);
      const { firstName, lastName, birthDate, schoolId, classId, parentId, academicYearId, teacherId, schoolAdminId, gender } = req.body;

      if (!firstName || !lastName || !classId || !parentId) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Get user and check permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Only super_admin can update students
      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super_admin can update students' });
      }

      // Get existing student
      const [existingStudent] = await db.select().from(students).where(eq(students.id, studentId));
      if (!existingStudent) return res.status(404).json({ error: 'Student not found' });

      // Normalize incoming numeric values
      const newSchoolId = schoolId !== undefined && schoolId !== null && String(schoolId) !== '' ? parseInt(String(schoolId)) : existingStudent.schoolId;
      const newClassId = parseInt(String(classId));
      const newParentId = parseInt(String(parentId));
      const newSchoolAdminId = schoolAdminId !== undefined && schoolAdminId !== null && String(schoolAdminId) !== '' ? parseInt(String(schoolAdminId)) : (existingStudent.schoolAdminId ?? null);
      const newGender = gender !== undefined && gender !== null && String(gender).trim() !== '' ? String(gender) : existingStudent.gender;

      // Build diff description
      const changes: string[] = [];
      if (existingStudent.firstName !== firstName) changes.push(`firstName: "${existingStudent.firstName}" → "${firstName}"`);
      if (existingStudent.lastName !== lastName) changes.push(`lastName: "${existingStudent.lastName}" → "${lastName}"`);
      if (existingStudent.birthDate !== birthDate) changes.push(`birthDate: "${existingStudent.birthDate}" → "${birthDate}"`);
      if (existingStudent.gender !== newGender) changes.push(`gender: "${existingStudent.gender ?? ''}" → "${newGender ?? ''}"`);
      if (existingStudent.schoolId !== newSchoolId) changes.push(`schoolId: ${existingStudent.schoolId} → ${newSchoolId}`);
      if (existingStudent.classId !== newClassId) changes.push(`classId: ${existingStudent.classId} → ${newClassId}`);
      if (existingStudent.parentId !== newParentId) changes.push(`parentId: ${existingStudent.parentId} → ${newParentId}`);
      if ((existingStudent.schoolAdminId ?? null) !== newSchoolAdminId) changes.push(`schoolAdminId: ${existingStudent.schoolAdminId ?? 'null'} → ${newSchoolAdminId}`);

      if (changes.length === 0) {
        return res.status(200).json(existingStudent);
      }

      // Update student
      const result = await db
        .update(students)
        .set({ firstName, lastName, birthDate, gender: newGender, schoolId: newSchoolId, classId: newClassId, parentId: newParentId, schoolAdminId: newSchoolAdminId })
        .where(eq(students.id, studentId))
        .returning();

      // Log audit event (use the helper that accepts actor + params)
      await logAuditEvent(
        user,
        'UPDATE',
        'student',
        studentId,
        existingStudent.schoolId ?? null,
        `Student updated: ${changes.join('; ')}`
      );

      res.status(200).json(result[0]);
    } catch (err: any) {
      console.error('Error updating student:', err);
      res.status(500).json({ error: `Failed to update student: ${err.message}` });
    }
  });

  // ==========================================
  // MODULE ABSENCES API
  // ==========================================

  app.get('/api/absences', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: absences.id,
          studentId: absences.studentId,
          studentName: sql<string>`concat(${students.firstName}, ' ', ${students.lastName})`,
          classId: absences.classId,
          className: classes.name,
          date: absences.date,
          period: absences.period,
          isJustified: absences.isJustified,
          justificationReason: absences.justificationReason,
          parentId: students.parentId,
          parentUserId: parents.userId,
          schoolId: students.schoolId,
        })
        .from(absences)
        .innerJoin(students, eq(absences.studentId, students.id))
        .innerJoin(classes, eq(absences.classId, classes.id))
        .innerJoin(parents, eq(students.parentId, parents.id));

      if (actor.role !== 'super_admin') {
        if (actor.role === 'parent') {
          const [parentProfile] = await db.select().from(parents).where(eq(parents.userId, actor.id));
          if (!parentProfile) {
            return res.json([]);
          }

          const childStudentIds = new Set<number>();
          if (parentProfile.studentId) {
            childStudentIds.add(parentProfile.studentId);
          }

          const ownedStudents = await db.select({ id: students.id }).from(students).where(eq(students.parentId, parentProfile.id));
          ownedStudents.forEach((s) => {
            if (s.id != null) {
              childStudentIds.add(s.id);
            }
          });

          if (childStudentIds.size === 0) {
            return res.json([]);
          }

          query = query.where(inArray(absences.studentId, Array.from(childStudentIds))) as any;
        } else {
          // School admin and teacher see only their school's absences
          if (actor.schoolId) {
            query = query.where(eq(students.schoolId, actor.schoolId)) as any;
          } else {
            return res.json([]);
          }
        }
      }

      const list = await query;
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load absences' });
    }
  });

  app.post('/api/absences', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { studentId, classId, date, period, isJustified, justificationReason } = req.body;
      if (!studentId || !classId || !date || !period) {
        return res.status(400).json({ error: 'Missing mandatory absence parameters' });
      }

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Load the student and class to check school
      const [student] = await db.select().from(students).where(eq(students.id, parseInt(studentId)));
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const [classRecord] = await db.select().from(classes).where(eq(classes.id, parseInt(classId)));
      if (!classRecord) return res.status(404).json({ error: 'Class not found' });

      // School admin can only record absences for students in their own school
      if (user.role !== 'super_admin') {
        if (user.schoolId && (student.schoolId !== user.schoolId || classRecord.schoolId !== user.schoolId)) {
          return res.status(403).json({ error: 'Cannot record absence for student in another school' });
        }
      }

      const result = await db.insert(absences).values({
        studentId: parseInt(studentId),
        classId: parseInt(classId),
        date,
        period,
        isJustified: isJustified || false,
        justificationReason,
      }).returning();

      // Automatically create a simulated notification for the Parent of this student
      const parentId = student.parentId;
      if (parentId != null) {
        const [parentRecord] = await db.select().from(parents).where(eq(parents.id, parentId));
        if (parentRecord) {
        await db.insert(notifications).values({
          userId: parentRecord.userId,
          title: `Nouvelle absence pour ${student.firstName}`,
          body: `Une absence a été signalée pour ${student.firstName} le ${date} (Période: ${period}). Veuillez fournir un justificatif.`,
          type: 'absence',
        });
        }
      }

      res.status(201).json(result[0]);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to record absence' });
    }
  });

  // Justify a pending absence
  app.put('/api/absences/:id/justify', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);
      const { justificationReason } = req.body;
      if (!justificationReason) {
        return res.status(400).json({ error: 'Please specify a reasons for justification' });
      }

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Load the absence to check its school
      const [absence] = await db
        .select()
        .from(absences)
        .innerJoin(students, eq(absences.studentId, students.id))
        .where(eq(absences.id, id));
      
      if (!absence) return res.status(404).json({ error: 'Absence not found' });

      // School admin can only justify absences in their own school
      if (user.role !== 'super_admin') {
        if (user.schoolId && absence.students.schoolId !== user.schoolId) {
          return res.status(403).json({ error: 'Cannot justify absence in another school' });
        }
      }

      const updated = await db.update(absences)
        .set({
          isJustified: true,
          justificationReason,
        })
        .where(eq(absences.id, id))
        .returning();

      res.json(updated[0]);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to validate absence justification' });
    }
  });

  // ==========================================
  // MODULE NOTES (EVALUATIONS & GRADES) API
  // ==========================================

  // Evaluations list - Filtered by school
  app.get('/api/evaluations', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: evaluations.id,
          classId: evaluations.classId,
          className: classes.name,
          teacherId: evaluations.teacherId,
          teacherName: users.name,
          termId: evaluations.termId,
          termName: schoolTerms.name,
          subject: evaluations.subject,
          title: evaluations.title,
          coefficient: evaluations.coefficient,
          maxScore: evaluations.maxScore,
          countInBulletin: evaluations.countInBulletin,
          date: evaluations.date,
          createdAt: evaluations.createdAt,
          schoolId: classes.schoolId,
        })
        .from(evaluations)
        .innerJoin(classes, eq(evaluations.classId, classes.id))
        .innerJoin(teachers, eq(evaluations.teacherId, teachers.id))
        .innerJoin(users, eq(teachers.userId, users.id))
        .leftJoin(schoolTerms, eq(evaluations.termId, schoolTerms.id));

      if (actor.role !== 'super_admin') {
        // School admin, teacher, and others see only their school's evaluations
        if (actor.schoolId) {
          query = query.where(eq(classes.schoolId, actor.schoolId)) as any;
        } else {
          return res.json([]);
        }

        if (actor.role === 'teacher') {
          if (actor.id == null) {
            return res.json([]);
          }
          query = query.where(eq(teachers.userId, actor.id)) as any;
        }
      }

      const list = await query;
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load evaluations list' });
    }
  });

  app.post('/api/evaluations', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      // Prevent parents from creating evaluations
      const [requestingUser] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (requestingUser && requestingUser.role === 'parent') {
        return res.status(403).json({ error: 'Parents are not allowed to create evaluations' });
      }
      const { classId, teacherId, subject, title, coefficient, maxScore, date, termId, countInBulletin } = req.body;
      if (!classId || !subject || !title || !date) {
        return res.status(400).json({ error: 'Missing mandatory assessment data' });
      }

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Load the class to check its school
      const [classRecord] = await db.select().from(classes).where(eq(classes.id, parseInt(classId)));
      if (!classRecord) return res.status(404).json({ error: 'Class not found' });

      let termRecord: any = null;
      if (termId !== undefined && termId !== null && String(termId).trim() !== '') {
        const [termRow] = await db.select().from(schoolTerms).where(eq(schoolTerms.id, parseInt(String(termId), 10)));
        if (!termRow) return res.status(404).json({ error: 'School term not found' });
        if (termRow.academicYearId !== classRecord.academicYearId) {
          return res.status(400).json({ error: 'The selected term does not belong to the class academic year' });
        }
        if (user.role !== 'super_admin' && user.schoolId && termRow.schoolId !== null && termRow.schoolId !== user.schoolId) {
          return res.status(403).json({ error: 'Cannot assign term from another school' });
        }
        termRecord = termRow;
      }

      // School admin can only create evaluations for classes in their own school
      if (user.role !== 'super_admin') {
        if (user.schoolId && classRecord.schoolId !== user.schoolId) {
          return res.status(403).json({ error: 'Cannot create evaluation for class in another school' });
        }
      }

      // Automatically determine teacher Id if not explicitly provided
      let resolvedTeacherId = teacherId ? parseInt(teacherId) : null;
      const [dbUser] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!dbUser) return res.status(404).json({ error: 'User not found' });

      if (user.role === 'teacher') {
        const [teacherProfile] = await db.select().from(teachers).where(eq(teachers.userId, dbUser.id));
        if (!teacherProfile) {
          return res.status(403).json({ error: 'Teacher profile not found for the current user' });
        }

        const [assignment] = await db.select().from(classTeachers).where(and(eq(classTeachers.classId, parseInt(classId)), eq(classTeachers.teacherId, teacherProfile.id)));
        if (!assignment) {
          return res.status(403).json({ error: 'Un enseignant ne peut créer une évaluation que pour une classe qui lui est assignée' });
        }

        resolvedTeacherId = teacherProfile.id;
      }

      if (!resolvedTeacherId) {
        if (classRecord.teacherId) {
          resolvedTeacherId = classRecord.teacherId;
        }
      }

      if (!resolvedTeacherId) {
        return res.status(400).json({ error: 'Must specify a valid Teacher ID for this evaluation' });
      }

      const result = await db.insert(evaluations).values({
        classId: parseInt(classId),
        teacherId: resolvedTeacherId,
        termId: termRecord ? termRecord.id : null,
        subject,
        title,
        coefficient: coefficient ? parseInt(coefficient) : 1,
        maxScore: maxScore ? parseInt(maxScore) : 20,
        countInBulletin: countInBulletin === undefined ? true : Boolean(countInBulletin),
        date,
      }).returning();

      const [createdEvaluation] = result;
      const classStudentParents = await db
        .select({ parentUserId: parents.userId })
        .from(students)
        .leftJoin(parents, eq(students.parentId, parents.id))
        .where(eq(students.classId, parseInt(classId)));

      const uniqueParentIds = Array.from(
        new Set(
          classStudentParents
            .map((row) => row.parentUserId)
            .filter((parentUserId): parentUserId is number => parentUserId !== null && parentUserId !== undefined)
        )
      );

      if (uniqueParentIds.length > 0) {
        const notificationsToInsert = uniqueParentIds.map((parentUserId) => ({
          userId: parentUserId,
          title: `Nouveau devoir publié : ${title}`,
          body: `Un nouveau devoir en ${subject} a été publié pour la classe ${classRecord.name} le ${date}. Encouragez votre enfant à se préparer !`,
          type: 'grade',
        }));
        await db.insert(notifications).values(notificationsToInsert);
      }

      res.status(201).json(createdEvaluation);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create assessment' });
    }
  });

  // Grades entry or update - Filtered by school
  app.get('/api/grades', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: grades.id,
          evaluationId: grades.evaluationId,
          evaluationTitle: evaluations.title,
          subject: evaluations.subject,
          studentId: grades.studentId,
          studentName: sql<string>`concat(${students.firstName}, ' ', ${students.lastName})`,
          score: grades.score,
          remarks: grades.remarks,
          editCount: grades.editCount,
          createdAt: grades.createdAt,
          updatedAt: grades.updatedAt,
          parentId: students.parentId,
          schoolId: students.schoolId,
        })
        .from(grades)
        .innerJoin(students, eq(grades.studentId, students.id))
        .innerJoin(evaluations, eq(grades.evaluationId, evaluations.id));

      if (user.role !== 'super_admin') {
        if (user.role === 'parent') {
          const [parentProfile] = await db.select().from(parents).where(eq(parents.userId, user.id));
          if (!parentProfile) {
            return res.json([]);
          }

          const parentStudentId = parentProfile.studentId;
          query = parentStudentId != null
            ? (query.where(
                or(
                  eq(students.parentId, parentProfile.id),
                  eq(students.id, parentStudentId)
                )
              ) as any)
            : (query.where(eq(students.parentId, parentProfile.id)) as any);
        } else {
          // School admin and other staff see only their school's grades
          if (user.schoolId) {
            query = query.where(eq(students.schoolId, user.schoolId)) as any;
          } else {
            return res.json([]);
          }
        }
      }

      const list = await query;
      res.json(list.map((grade) => ({
        ...grade,
        isModified: deriveGradeModificationState(grade),
      })));
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch grades list' });
    }
  });

  app.get('/api/bulletins/term-average', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const { termId, studentId } = req.query;
      const parsedTermId = Number(termId);
      const parsedStudentId = Number(studentId);

      if (!Number.isInteger(parsedTermId) || !Number.isInteger(parsedStudentId)) {
        return res.status(400).json({ error: 'termId and studentId are required' });
      }

      const [termRow] = await db.select().from(schoolTerms).where(eq(schoolTerms.id, parsedTermId));
      if (!termRow) return res.status(404).json({ error: 'School term not found' });

      const [studentRow] = await db.select().from(students).where(eq(students.id, parsedStudentId));
      if (!studentRow) return res.status(404).json({ error: 'Student not found' });

      if (actor.role !== 'super_admin') {
        if (actor.schoolId == null || studentRow.schoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      const [termEvaluations, studentGrades] = await Promise.all([
        db.select().from(evaluations).where(eq(evaluations.termId, parsedTermId)),
        db.select().from(grades).where(eq(grades.studentId, parsedStudentId)),
      ]);

      const result = calculateStudentTermAverage({
        term: { id: termRow.id },
        student: {
          id: studentRow.id,
          schoolId: studentRow.schoolId,
          classId: studentRow.classId,
          firstName: studentRow.firstName,
          lastName: studentRow.lastName,
        },
        evaluations: termEvaluations.map((evaluation) => ({
          id: evaluation.id,
          classId: evaluation.classId,
          termId: evaluation.termId,
          subject: evaluation.subject,
          title: evaluation.title,
          coefficient: evaluation.coefficient,
          maxScore: evaluation.maxScore,
          countInBulletin: evaluation.countInBulletin,
        })),
        grades: studentGrades.map((grade) => ({
          id: grade.id,
          evaluationId: grade.evaluationId,
          studentId: grade.studentId,
          score: grade.score,
        })),
      });

      res.json(result);
    } catch (err: any) {
      console.error('Failed to compute bulletin term average:', err);
      res.status(500).json({ error: 'Failed to compute bulletin term average' });
    }
  });

  app.post('/api/grades', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      // Prevent parents from recording/updating grades
      const requestingUser = await resolveActor(req);
      if (requestingUser && requestingUser.role === 'parent') {
        return res.status(403).json({ error: 'Parents are not allowed to record or update grades' });
      }
      const { evaluationId, studentId, score, remarks } = req.body;
      if (!evaluationId || !studentId || score === undefined) {
        return res.status(400).json({ error: 'Missing grade details' });
      }

      // Load user and validate school permission
      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Load the evaluation to verify permissions and existence
      const [evaluation] = await db.select().from(evaluations).where(eq(evaluations.id, parseInt(evaluationId)));
      if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });

      // Load the student to check their school
      const [student] = await db.select().from(students).where(eq(students.id, parseInt(studentId)));
      if (!student) return res.status(404).json({ error: 'Student not found' });

      // Validate that student was enrolled in the class before or at the evaluation timestamp.
      // Prefer the evaluation.createdAt timestamp if available, otherwise fall back to evaluation.date.
      if (student.enrolledAt && (evaluation.createdAt || evaluation.date)) {
        const enrollmentDate = new Date(student.enrolledAt);
        const evaluationTimestamp = new Date(evaluation.createdAt || evaluation.date);
        if (Number.isNaN(evaluationTimestamp.getTime())) {
          return res.status(400).json({ error: 'Evaluation timestamp invalide' });
        }

        if (enrollmentDate.getTime() > evaluationTimestamp.getTime()) {
          return res.status(400).json({ 
            error: `Impossible de créer une note pour ${student.firstName} ${student.lastName}: cet élève n'était pas encore inscrit au moment de la création du devoir (${evaluation.createdAt || evaluation.date})` 
          });
        }
      }

      // School admin can only record grades for students in their own school
      if (user.role === 'school_admin') {
        if (user.schoolId && student.schoolId !== user.schoolId) {
          return res.status(403).json({ error: 'Cannot record grade for student in another school' });
        }
      }

      // Teachers can only record grades for their own evaluations and cannot edit existing grades.
      // School admins can edit a grade once, while super admins can edit without limits.
      if (user.role === 'teacher') {
        const [teacherProfile] = await db.select().from(teachers).where(eq(teachers.userId, user.id));
        if (!teacherProfile) {
          return res.status(403).json({ error: 'Profile enseignant introuvable' });
        }
        if (evaluation.teacherId !== teacherProfile.id) {
          return res.status(403).json({ error: 'Vous ne pouvez pas modifier une note d’une évaluation qui ne vous appartient pas' });
        }
        if (user.schoolId && student.schoolId !== user.schoolId) {
          return res.status(403).json({ error: 'Cannot record grade for student in another school' });
        }
      }

      // Check if grade already exists for this evaluation/student
      const existing = await db
        .select()
        .from(grades)
        .where(
          and(
            eq(grades.evaluationId, parseInt(evaluationId)),
            eq(grades.studentId, parseInt(studentId))
          )
        );

      if (existing.length > 0) {
        if (user.role === 'teacher') {
          return res.status(403).json({ error: 'Les enseignants ne peuvent pas modifier une note déjà enregistrée.' });
        }

        if (user.role === 'school_admin') {
          const currentEditCount = existing[0].editCount ?? 0;
          if (currentEditCount >= 1) {
            return res.status(403).json({ error: 'Cette note a déjà été modifiée une fois par un school admin.' });
          }
        }
      } else if (user.role === 'school_admin') {
        return res.status(403).json({ error: 'Un school admin ne peut pas créer une nouvelle note. Il peut uniquement modifier une note existante une seule fois.' });
      }

      let savedGrade;
      if (existing.length > 0) {
        const previousValue = existing[0].score;
        const updated = await db
          .update(grades)
          .set({
            score: String(score),
            remarks,
            editCount: (existing[0].editCount ?? 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(grades.id, existing[0].id))
          .returning();
        savedGrade = updated[0];

        await db.insert(gradeHistory).values({
          gradeId: savedGrade.id,
          oldValue: String(previousValue),
          newValue: String(score),
          changedBy: user.id,
          changedAt: new Date(),
        });
      } else {
        const inserted = await db.insert(grades).values({
          evaluationId: parseInt(evaluationId),
          studentId: parseInt(studentId),
          score: String(score),
          remarks,
          editCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();
        savedGrade = inserted[0];
      }

      // Create simulated push notification for parent of this student
      const [evaluationRecord] = await db.select().from(evaluations).where(eq(evaluations.id, parseInt(evaluationId)));
      if (evaluationRecord) {
        const parentId = student.parentId;
        if (parentId != null) {
          const [parentRecord] = await db.select().from(parents).where(eq(parents.id, parentId));
          if (parentRecord) {
          await db.insert(notifications).values({
            userId: parentRecord.userId,
            title: `Nouvelle note pour ${student.firstName}`,
            body: `${student.firstName} a obtenu la note de ${score}/${evaluationRecord.maxScore} en ${evaluationRecord.subject} pour : ${evaluationRecord.title}.`,
            type: 'grade',
          });
          }
        }
      }

      res.status(200).json({
        ...savedGrade,
        isModified: deriveGradeModificationState(savedGrade),
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: 'Failed to record student grade' });
    }
  });

  app.post('/api/bulletins/generate', requireAuth, requireRole(['admin']), async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'parent') {
        return res.status(403).json({ error: 'Parents are not allowed to generate bulletins' });
      }

      const studentId = Number(req.body?.studentId);
      const termId = Number(req.body?.termId);
      if (!Number.isInteger(studentId) || !Number.isInteger(termId)) {
        return res.status(400).json({ error: 'studentId and termId are required' });
      }

      const [studentRow] = await db.select({
        id: students.id,
        schoolId: students.schoolId,
      }).from(students).where(eq(students.id, studentId));
      if (!studentRow) {
        return res.status(404).json({ error: 'Student not found' });
      }

      if (actor.role !== 'super_admin' && actor.schoolId !== studentRow.schoolId) {
        return res.status(403).json({ error: 'Forbidden: cannot generate bulletin outside your school' });
      }

      const snapshot = await generateBulletinSnapshot(studentId, termId);
      res.status(201).json(snapshot);
    } catch (err: any) {
      const message = err?.message || 'Failed to generate bulletin snapshot';
      console.error('Error generating bulletin snapshot:', err);
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/evaluations', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

      let evaluationIds: number[] = [];
      if (actor.role === 'super_admin') {
        const rows = await db.select({ id: evaluations.id }).from(evaluations);
        evaluationIds = rows.map((row) => row.id);
      } else if (actor.role === 'school_admin') {
        const rows = await db
          .select({ id: evaluations.id })
          .from(evaluations)
          .innerJoin(classes, eq(evaluations.classId, classes.id))
          .where(eq(classes.schoolId, actor.schoolId));
        evaluationIds = rows.map((row) => row.id);
      }

      if (evaluationIds.length === 0) {
        return res.json({ deletedEvaluations: 0, deletedGrades: 0 });
      }

      const deletedGrades = await db.delete(grades).where(sql`${grades.evaluationId} IN ${evaluationIds}`);
      const deletedEvaluations = await db.delete(evaluations).where(sql`${evaluations.id} IN ${evaluationIds}`);

      res.json({ deletedEvaluations: evaluationIds.length, deletedGrades: deletedGrades.rowCount ?? 0 });
    } catch (err: any) {
      console.error('Failed to delete evaluations and grades:', err);
      res.status(500).json({ error: 'Failed to delete evaluations' });
    }
  });

  // ==========================================
  // DASHBOARD API
  // ==========================================

  // Dashboard summary - Filtered by school
  app.get('/api/dashboard/summary', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Build filter condition based on user role
      let schoolFilter: any = undefined;
      let parentChildIds: number[] | null = null;
      if (user.role !== 'super_admin' && user.schoolId) {
        schoolFilter = user.schoolId;
      }

      let parentProfile: { id: number; studentId?: number | null } | null = null;
      if (user.role === 'parent') {
        const parentRows = await db
          .select({ id: parents.id, studentId: parents.studentId })
          .from(parents)
          .where(eq(parents.userId, user.id));

        if (parentRows.length > 0) {
          parentProfile = parentRows[0];
          const studentIds = new Set<number>();
          if (parentProfile.studentId) {
            studentIds.add(parentProfile.studentId);
          }

          const ownedStudents = await db
            .select({ id: students.id })
            .from(students)
            .where(eq(students.parentId, parentProfile.id));

          ownedStudents.forEach((studentRow) => {
            if (studentRow.id != null) {
              studentIds.add(studentRow.id);
            }
          });

          parentChildIds = Array.from(studentIds);
        } else {
          parentChildIds = [];
        }
      }

      // Get stats
      let studentCountQuery = db.select({ count: sql<number>`count(*)::integer` }).from(students);
      let absenceCountQuery = db.select({ count: sql<number>`count(*)::integer` }).from(absences);
      let classCountQuery = db.select({ count: sql<number>`count(distinct ${classes.id})::integer` }).from(classes);

      if (user.role === 'parent') {
        if (!parentChildIds || parentChildIds.length === 0) {
          return res.json({
            stats: {
              totalStudents: 0,
              totalAbsences: 0,
              totalClasses: 0,
              attendanceRate: 100,
              maleStudents: 0,
              femaleStudents: 0,
              unknownGenderStudents: 0,
            },
            recentAbsences: [],
            recentGrades: [],
          });
        }

        studentCountQuery = studentCountQuery.where(inArray(students.id, parentChildIds)) as any;
        classCountQuery = db
          .select({ count: sql<number>`count(distinct ${classes.id})::integer` })
          .from(classes)
          .innerJoin(students, eq(classes.id, students.classId))
          .where(inArray(students.id, parentChildIds)) as any;
        absenceCountQuery = db
          .select({ count: sql<number>`count(*)::integer` })
          .from(absences)
          .where(inArray(absences.studentId, parentChildIds)) as any;
      } else if (schoolFilter) {
        studentCountQuery = studentCountQuery.where(eq(students.schoolId, schoolFilter)) as any;
        classCountQuery = classCountQuery.where(eq(classes.schoolId, schoolFilter)) as any;
        // For absences, filter through students
        absenceCountQuery = db
          .select({ count: sql<number>`count(*)::integer` })
          .from(absences)
          .innerJoin(students, eq(absences.studentId, students.id))
          .where(eq(students.schoolId, schoolFilter)) as any;
      }

      const studentCountResult = await studentCountQuery;
      const absenceCountResult = await absenceCountQuery;
      const classCountResult = await classCountQuery;

      const totalStudents = studentCountResult[0]?.count || 0;
      const totalAbsences = absenceCountResult[0]?.count || 0;
      const totalClasses = classCountResult[0]?.count || 0;

      let genderQuery = db
        .select({ gender: students.gender })
        .from(students);

      if (user.role === 'parent') {
        genderQuery = genderQuery.where(inArray(students.id, parentChildIds || [])) as any;
      } else if (schoolFilter) {
        genderQuery = genderQuery.where(eq(students.schoolId, schoolFilter)) as any;
      }

      const genderRows = await genderQuery;
      let maleStudents = 0;
      let femaleStudents = 0;
      let unknownGenderStudents = 0;

      for (const row of genderRows) {
        const normalizedGender = normalizeStudentGender(row.gender);
        if (normalizedGender === 'male') maleStudents += 1;
        else if (normalizedGender === 'female') femaleStudents += 1;
        else unknownGenderStudents += 1;
      }

      // Calculate attendance rate (simplified)
      const attendanceRate = totalStudents > 0 && totalAbsences > 0 ? 
        Math.max(0, 100 - (totalAbsences / (totalStudents * 20) * 100)) : 100;

      // Get recent absences
      let recentAbsencesQuery = db
        .select({
          id: absences.id,
          studentId: absences.studentId,
          studentName: sql<string>`concat(${students.firstName}, ' ', ${students.lastName})`,
          date: absences.date,
          isJustified: absences.isJustified,
          period: absences.period,
          className: classes.name,
        })
        .from(absences)
        .innerJoin(students, eq(absences.studentId, students.id))
        .innerJoin(classes, eq(absences.classId, classes.id))
        .orderBy(desc(absences.date))
        .limit(5);

      if (user.role === 'parent') {
        recentAbsencesQuery = recentAbsencesQuery.where(inArray(absences.studentId, parentChildIds || [])) as any;
      } else if (schoolFilter) {
        recentAbsencesQuery = recentAbsencesQuery.where(eq(students.schoolId, schoolFilter)) as any;
      }

      const recentAbsences = await recentAbsencesQuery;

      // Get recent grades
      let recentGradesQuery = db
        .select({
          id: grades.id,
          studentId: grades.studentId,
          studentName: sql<string>`concat(${students.firstName}, ' ', ${students.lastName})`,
          evaluationTitle: evaluations.title,
          score: grades.score,
          date: evaluations.date,
        })
        .from(grades)
        .innerJoin(students, eq(grades.studentId, students.id))
        .innerJoin(evaluations, eq(grades.evaluationId, evaluations.id))
        .orderBy(desc(evaluations.date))
        .limit(5);

      if (user.role === 'parent') {
        recentGradesQuery = recentGradesQuery.where(inArray(grades.studentId, parentChildIds || [])) as any;
      } else if (schoolFilter) {
        recentGradesQuery = recentGradesQuery.where(eq(students.schoolId, schoolFilter)) as any;
      }

      const recentGrades = await recentGradesQuery;

      const stats = {
        totalStudents,
        totalAbsences,
        totalClasses,
        attendanceRate: Math.round(attendanceRate * 100) / 100,
        maleStudents,
        femaleStudents,
        unknownGenderStudents,
      };

      console.log('[TMP-GENDER-DEBUG][BACKEND] dashboard summary stats', {
        role: user.role,
        userSchoolId: user.schoolId ?? null,
        appliedSchoolFilter: schoolFilter ?? null,
        totalStudents,
        genderRowsCount: genderRows.length,
        maleStudents,
        femaleStudents,
        unknownGenderStudents,
      });

      res.json({
        stats,
        recentAbsences,
        recentGrades,
      });
    } catch (err: any) {
      console.error('Error loading dashboard summary:', err);
      res.status(500).json({ error: 'Failed to load dashboard summary' });
    }
  });

  // ==========================================
  // MODULE NOTIFICATIONS API
  // ==========================================

  // Get notifications for current user
  app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      // Match dynamic userId
      const [dbUser] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!dbUser) return res.json([]);

      if (dbUser.role === 'teacher') return res.status(403).json({ error: 'Forbidden' });

      const userNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, dbUser.id))
        .orderBy(desc(notifications.id));

      res.json(userNotifications);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load notifications feed' });
    }
  });

  // Mark all user notifications as read
  app.put('/api/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const [dbUser] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (dbUser) {
        await db
          .update(notifications)
          .set({ isRead: true })
          .where(eq(notifications.userId, dbUser.id));
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to clean notifications status' });
    }
  });

  // Send system-wide / simulated push notice
  app.post('/api/notifications/send', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { title, body, type, userId } = req.body;
      if (!title || !body || !type) return res.status(400).json({ error: 'Missing keys' });

      // Load user and validate permission
      const [actor] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let targetUserIds: number[] = [];

      if (userId) {
        // Sending to specific user - validate school permission if school_admin
        const [targetUser] = await db.select().from(users).where(eq(users.id, parseInt(userId)));
        if (!targetUser) return res.status(404).json({ error: 'Target user not found' });
        
        if (actor.role !== 'super_admin') {
          if (actor.schoolId && targetUser.schoolId !== actor.schoolId) {
            return res.status(403).json({ error: 'Cannot send notification to user in another school' });
          }
        }
        
        targetUserIds.push(targetUser.id);
      } else {
        // Send to all parents (or all parents in school if school_admin)
        let query = db.select().from(parents).innerJoin(users, eq(parents.userId, users.id));
        
        if (actor.role !== 'super_admin' && actor.schoolId) {
          // School admin can only send to parents in their school
          query = query.where(eq(users.schoolId, actor.schoolId)) as any;
        }
        
        const parentsList = await query;
        targetUserIds = parentsList.map(p => p.users.id);
      }

      for (const id of targetUserIds) {
        await db.insert(notifications).values({
          userId: id,
          title,
          body,
          type,
        });
      }

      res.json({ success: true, message: `Notification successfully routed to ${targetUserIds.length} users.` });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to dispatch notifications' });
    }
  });


  // ==========================================
  // VITE DEVELOPMENT ENVIRONMENT MIDDLEWARE
  // ==========================================
  // The `/login` route is handled by the SPA (React) in client-side routing.

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
    });
    // Use Vite as middleware for everything except /api
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      vite.middlewares(req, res, next);
    });
    // Fallback: serve index.html for SPA routes that don't match any file
    app.use((req, res) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not found' });
      }
      // For all other routes, check if it's a file extension
      if (/\.\w+$/i.test(req.path)) {
        // It's a file but not found
        return res.status(404).send('Not found');
      }
      // It's an SPA route - serve index.html
      const indexPath = path.join(process.cwd(), 'index.html');
      res.sendFile(indexPath, (err) => {
        if (err) {
          res.status(500).send('Error serving index.html');
        }
      });
    });
  } else {
    // Production serving static files
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server starting on http://localhost:${PORT}`);
  });
}

startServer();

