/*
  const id = parseInt(req.params.id);
  const { email, name, role, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, phone, specialization, gender, classIds, studentId } = req.body;

  // Parse incoming schoolId only when provided; do not overwrite existing school_id with null when omitted.
  const parsedSchoolId = rawSchoolId != null && rawSchoolId !== '' ? parseInt(rawSchoolId, 10) : undefined;
  const updatedValues: any = { email, name, role, gender: gender ?? null };
  if (parsedSchoolId !== undefined) {
        if (teacherProfileId != null) {
          // Clear previous class assignments for this teacher so the new set replaces them.
          console.log('Updating class assignments for teacher (admin update):', { teacherProfileId, classIds });
          // Update teacher.school_id only when a new schoolId was provided. If omitted, preserve existing teacher.school_id.
          const existingTeacherRow = await db.select().from(teachers).where(eq(teachers.id, teacherProfileId));
          const existingTeacherSchoolId = existingTeacherRow[0]?.schoolId ?? null;

          if (parsedSchoolId !== undefined) {
            await db.update(teachers).set({ schoolId: parsedSchoolId, phone: phone || '', specialization: normalizeSpecialization(specialization) || null }).where(eq(teachers.userId, id));
          } else {
            await db.update(teachers).set({ phone: phone || '', specialization: normalizeSpecialization(specialization) || null }).where(eq(teachers.userId, id));
*/
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index.ts';
import { seedDatabaseIfEmpty, ensureSchoolClassesTableExists, ensureUsersTableSchema, ensureUserSchoolsTableExists } from './src/db/helpers.ts';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import { validateGradeScore } from './src/lib/gradeValidation.ts';
import { getEmailUniquenessScope, normalizeEmail } from './src/lib/emailUniqueness.ts';
import { registerBulletinGenerateRoute } from './src/lib/bulletinSnapshotService.ts';
import { registerBulletinReadRoutes } from './src/lib/bulletinReadApi.ts';
import { registerBulletinPdfRoute } from './src/lib/bulletinPdfApi.ts';
import {
  schools,
  academicYears,
  users,
  userSchools,
  localAuths,
  teachers,
  parents,
  classes,
  classTeachers,
  students,
  subjects,
  schoolSubjects,
  schoolClasses,
  evaluations,
  grades,
  absences,
  notifications,
  auditEvents,
} from './src/db/schema.ts';
import { eq, and, or, sql, desc, notInArray, inArray } from 'drizzle-orm';

async function logIfTeacherUserMismatch(userId: number | null | undefined, teacherId: number | null | undefined) {
  try {
    if (!userId || !teacherId) return;
    const [u] = await db.select({ id: users.id, schoolId: users.schoolId }).from(users).where(eq(users.id, userId));
    const [t] = await db.select({ id: teachers.id, schoolId: teachers.schoolId }).from(teachers).where(eq(teachers.id, teacherId));
    if (!u || !t) return;
    // If teacher has schoolId but user doesn't, or they differ, warn.
    if (t.schoolId != null && (u.schoolId == null || u.schoolId !== t.schoolId)) {
      console.warn('DATA-INCONSISTENCY: users.school_id and teachers.school_id mismatch', { userId: u.id, users_schoolId: u.schoolId, teacherId: t.id, teachers_schoolId: t.schoolId });
    }
  } catch (e: any) {
    console.warn('DIAG: failed to verify teacher/user school_id consistency', { userId, teacherId, err: e?.message || e });
  }
}

async function findExistingUsersByEmail(email: string | null | undefined) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];

  return db.select().from(users).where(eq(sql`LOWER(${users.email})`, normalizedEmail));
}

// Find existing user by email AND schoolId (for per-school uniqueness)
async function findExistingUsersByEmailAndSchool(email: string | null | undefined, schoolId: number | null | undefined) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];
  
  if (schoolId == null) {
    // If no schoolId provided, return empty (can't check per-school uniqueness without school)
    return [];
  }

  return db.select().from(users).where(
    and(
      eq(sql`LOWER(${users.email})`, normalizedEmail),
      eq(users.schoolId, schoolId)
    )
  );
}

// Helper to resolve actor with fallback to simulated profile in dev
async function resolveActor(req: AuthRequest) {
  console.log('TRACE resolveActor enter', { userPresent: !!req.user, user: req.user && { uid: req.user.uid, email: req.user.email, role: req.user.role, schoolId: req.user.schoolId, simulated: req.user.simulated } });
  if (!req.user) return null;

  // In simulated mode, resolve a matching DB user first. If none exists yet,
  // fall back to the simulated profile so tokenless development flows still work.
  if (req.user.simulated) {
    // First try to resolve by uid. If not found, try to match by email (useful when
    // simulated uid differs from the DB uid for pre-existing seeded accounts).
    let dbUser: any = null;
    const rowsByUid = await db.select().from(users).where(eq(users.uid, req.user.uid));
    console.log('TRACE resolveActor lookup by uid', { uid: req.user.uid, rowsByUidLength: rowsByUid.length });
    if (rowsByUid.length > 0) dbUser = rowsByUid[0];

    if (!dbUser && req.user.email) {
      const rowsByEmail = await db.select().from(users).where(eq(users.email, req.user.email));
      console.log('TRACE resolveActor lookup by email', { email: req.user.email, rowsByEmailLength: rowsByEmail.length });
      if (rowsByEmail.length > 0) dbUser = rowsByEmail[0];
    }

    console.log('TRACE resolveActor dbUser final', { found: !!dbUser, dbUser: dbUser ? { id: dbUser.id, uid: dbUser.uid, email: dbUser.email, schoolId: dbUser.schoolId } : null });

    if (dbUser) {
      if (dbUser.schoolId == null && req.user.schoolId != null) {
        return { ...dbUser, schoolId: req.user.schoolId };
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
    const activeSchoolId = req.user.schoolId ?? null;
    if (activeSchoolId != null) {
      return { ...dbUser, schoolId: activeSchoolId };
    }
    return dbUser;
  }

  return null;
}

async function getUserSchoolMemberships(userId: number | null | undefined) {
  if (!userId) return [];

  const rows = await db.select({
    schoolId: userSchools.schoolId,
    isActive: userSchools.isActive,
  }).from(userSchools).where(eq(userSchools.userId, userId));

  return rows;
}

async function ensureUserSchoolMembership(userId: number | null | undefined, schoolId: number | null | undefined, requiredRole?: string | null) {
  if (!userId || schoolId == null) return null;

  const whereClause = requiredRole
    ? and(eq(userSchools.userId, userId), eq(userSchools.schoolId, schoolId), eq(userSchools.role, requiredRole))
    : and(eq(userSchools.userId, userId), eq(userSchools.schoolId, schoolId));

  const existing = await db.select().from(userSchools).where(whereClause);
  return existing[0] ?? null;
}

async function upsertUserSchoolMembership(userId: number | null | undefined, schoolId: number | null | undefined, role: string, isActive = true) {
  if (!userId || schoolId == null) return null;

  const existing = await ensureUserSchoolMembership(userId, schoolId);
  if (existing) {
    const updates: Record<string, any> = {};
    if (existing.role !== role) updates.role = role;
    if (existing.isActive !== isActive) updates.isActive = isActive;

    if (Object.keys(updates).length > 0) {
      const [updated] = await db.update(userSchools)
        .set(updates)
        .where(and(eq(userSchools.userId, userId), eq(userSchools.schoolId, schoolId)))
        .returning();
      return updated ?? existing;
    }

    return existing;
  }

  const [inserted] = await db.insert(userSchools).values({
    userId,
    schoolId,
    role,
    isActive,
  }).returning();

  return inserted ?? null;
}

async function repairMissingSchoolAdminMemberships() {
  const schoolAdmins = await db.select({
    id: users.id,
    schoolId: users.schoolId,
  }).from(users).where(and(eq(users.role, 'school_admin'), sql`${users.schoolId} IS NOT NULL`));

  for (const schoolAdmin of schoolAdmins) {
    if (schoolAdmin.schoolId == null) continue;
    const existing = await ensureUserSchoolMembership(schoolAdmin.id, schoolAdmin.schoolId);
    if (!existing) {
      await upsertUserSchoolMembership(schoolAdmin.id, schoolAdmin.schoolId, 'school_admin', true);
    }
  }
}

async function setActiveUserSchool(userId: number | null | undefined, schoolId: number | null | undefined) {
  if (!userId || schoolId == null) return null;

  const membership = await ensureUserSchoolMembership(userId, schoolId);
  if (!membership) return null;

  await db.update(userSchools).set({ isActive: false }).where(eq(userSchools.userId, userId));
  const updated = await db.update(userSchools).set({ isActive: true }).where(and(eq(userSchools.userId, userId), eq(userSchools.schoolId, schoolId))).returning();
  return updated[0] ?? null;
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

async function isApprovedClassForSchool(classId: number, targetSchoolId: number | null) {
  if (targetSchoolId == null) return false;
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) return false;
  if (cls.schoolId === targetSchoolId) return true;
  if (cls.schoolId != null) return false;
  const [schoolClass] = await db.select().from(schoolClasses).where(
    and(
      eq(schoolClasses.classId, classId),
      eq(schoolClasses.schoolId, targetSchoolId),
      eq(schoolClasses.status, 'approved')
    )
  );
  return !!schoolClass;
}

async function isApprovedSubjectForSchool(subjectName: string, targetSchoolId: number | null) {
  const normalizedSubject = String(subjectName || '').trim();
  console.log('DEBUG isApprovedSubjectForSchool enter', {
    subjectName,
    normalizedSubject,
    normalizedLength: normalizedSubject.length,
    targetSchoolId,
  });

  if (!normalizedSubject) {
    console.log('DEBUG isApprovedSubjectForSchool fail empty subject', { subjectName });
    return false;
  }

  const normalizedSubjectMatch = sql`LOWER(TRIM(${subjects.name})) = LOWER(TRIM(${normalizedSubject}))`;

  if (targetSchoolId != null) {
    const [sameSchoolSubject] = await db
      .select()
      .from(subjects)
      .where(
        and(
          eq(subjects.schoolId, targetSchoolId),
          normalizedSubjectMatch
        )
      );

    console.log('DEBUG isApprovedSubjectForSchool sameSchoolSubject query', {
      targetSchoolId,
      normalizedSubject,
      sameSchoolSubject,
    });

    if (sameSchoolSubject) {
      console.log('DEBUG isApprovedSubjectForSchool pass sameSchoolSubject', { targetSchoolId, normalizedSubject });
      return true;
    }

    const approvedSubjectRows = await db
      .select({
        subjectId: subjects.id,
        subjectName: subjects.name,
        subjectSchoolId: subjects.schoolId,
        schoolSubjectId: schoolSubjects.id,
        schoolSubjectSchoolId: schoolSubjects.schoolId,
        schoolSubjectStatus: schoolSubjects.status,
      })
      .from(subjects)
      .innerJoin(
        schoolSubjects,
        and(
          eq(subjects.id, schoolSubjects.subjectId),
          eq(schoolSubjects.schoolId, targetSchoolId),
          eq(schoolSubjects.status, 'approved')
        )
      )
      .where(normalizedSubjectMatch);

    console.log('DEBUG isApprovedSubjectForSchool approvedSubjectRows', {
      targetSchoolId,
      normalizedSubject,
      approvedSubjectRows,
    });

    const result = approvedSubjectRows.length > 0;
    console.log('DEBUG isApprovedSubjectForSchool result', {
      targetSchoolId,
      normalizedSubject,
      result,
      reason: result ? 'approvedSubjectRows match' : 'no approved subject match',
    });
    return result;
  }

  const globalSubjectRows = await db
    .select()
    .from(subjects)
    .where(
      and(
        sql`${subjects.schoolId} IS NULL`,
        normalizedSubjectMatch
      )
    );

  console.log('DEBUG isApprovedSubjectForSchool globalSubjectRows', {
    normalizedSubject,
    globalSubjectRows,
  });

  const result = globalSubjectRows.length > 0;
  console.log('DEBUG isApprovedSubjectForSchool result', {
    normalizedSubject,
    result,
    reason: result ? 'globalSubjectRows match' : 'no global subject match',
  });
  return result;
}

function formatUserUpdateDiff(targetUser: any, incoming: { email: string; name: string; role: string; schoolId?: any; phone?: string; specialization?: any }) {
  const changes: string[] = [];
  if (incoming.email !== targetUser.email) {
    changes.push(`email: "${targetUser.email}" → "${incoming.email}"`);
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

  // JSON parsing middleware
  app.use(express.json());

  // Global debug middleware for request/response tracing
  app.use((req, res, next) => {
    try {
      console.log('📡 REQUEST:', req.method, req.url);
      console.log('📦 BODY:', req.body);
    } catch (err) {
      console.error('Failed to log request debug data:', err);
    }

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    (res as any).json = function (data: any) {
      try {
        console.log('📤 RESPONSE:', res.statusCode, data);
      } catch (err) {
        console.error('Failed to log response JSON debug data:', err);
      }
      return originalJson(data);
    };

    res.on('finish', () => {
      try {
        console.log('📥 RESPONSE STATUS:', res.statusCode, req.method, req.url);
      } catch (err) {
        console.error('Failed to log response status:', err);
      }
    });

    next();
  });

  console.log('Verifying if database needs seeding...');
  try {
    await seedDatabaseIfEmpty();
    await ensureSchoolClassesTableExists();
    await ensureUsersTableSchema();
    await ensureUserSchoolsTableExists();
    await repairMissingSchoolAdminMemberships();
  } catch (error) {
    console.error('Database initialization failed, shutting down application.', error);
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

  registerBulletinGenerateRoute(app, { resolveActor });
  registerBulletinReadRoutes(app, { resolveActor });
  registerBulletinPdfRoute(app, { resolveActor });

  // Register POST /api/users/:userId/schools (manage multi-school memberships)
  app.post('/api/users/:userId/schools', requireAuth, async (req: AuthRequest, res) => {
    try {
      console.log('HANDLER ENTER /api/users/:userId/schools', { params: req.params, body: req.body, simulatedRole: req.headers['x-simulated-role'], hasAuth: !!req.headers.authorization });

      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actorRole = req.user?.role;
      if (!actorRole) return res.status(401).json({ error: 'Unauthenticated' });

      const userIdParam = parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(userIdParam)) return res.status(400).json({ error: 'Invalid userId' });

      const { schoolId, role } = req.body ?? {};
      const parsedSchoolId = typeof schoolId === 'number' ? schoolId : parseInt(String(schoolId), 10);
      if (!Number.isFinite(parsedSchoolId)) return res.status(400).json({ error: 'Invalid schoolId' });

      if (actorRole !== 'super_admin') {
        return res.status(403).json({ error: 'Forbidden: only super_admin can manage multi-school memberships' });
      }

      const [targetUser] = await db.select().from(users).where(eq(users.id, userIdParam)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'USER_NOT_FOUND' });

      if (!['teacher', 'parent'].includes(targetUser.role)) {
        return res.status(400).json({ error: 'Cannot add a school membership for school_admin or student accounts' });
      }

      const membershipRole = role ?? targetUser.role;
      if (membershipRole !== targetUser.role) {
        return res.status(400).json({ error: 'Membership role must match the user role for teacher and parent accounts' });
      }
      if (!['teacher', 'parent'].includes(membershipRole)) {
        return res.status(400).json({ error: 'Membership role must be teacher or parent' });
      }

      const [targetSchool] = await db.select().from(schools).where(eq(schools.id, parsedSchoolId)).limit(1);
      if (!targetSchool) return res.status(404).json({ error: 'SCHOOL_NOT_FOUND' });

      const existing = await db.select().from(userSchools).where(and(eq(userSchools.userId, userIdParam), eq(userSchools.schoolId, parsedSchoolId)));
      if (existing.length > 0) {
        return res.status(200).json({ message: 'Membership already exists', membership: existing[0] });
      }

      const inserted = await db.insert(userSchools).values({ userId: userIdParam, schoolId: parsedSchoolId, role: membershipRole }).returning();
      res.status(201).json(inserted[0] ?? null);
    } catch (err: any) {
      console.error('Error associating user with school:', err);
      res.status(500).json({ error: err?.message || 'Failed to associate user with school' });
    }
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
        // School admin sees only users linked to their school via membership.
        // Include same-school admins so the student creation form can assign a school admin account.
        filterConditions = and(
          filterConditions,
          or(eq(userSchools.schoolId, actor.schoolId), eq(users.schoolId, actor.schoolId)),
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
          teacherId: teachers.id,
          teacherPhone: teachers.phone,
          teacherSpecialization: teachers.specialization,
          parentPhone: parents.phone,
        })
        .from(users)
        .leftJoin(teachers, eq(teachers.userId, users.id))
        .leftJoin(parents, eq(parents.userId, users.id))
        .leftJoin(userSchools, eq(userSchools.userId, users.id))
        .where(filterConditions);

      const normalizedById = allUsers.reduce((acc: Record<number, any>, user: any) => {
        if (!acc[user.id]) {
          acc[user.id] = {
            id: user.id,
            uid: user.uid,
            email: user.email,
            name: user.name,
            role: user.role,
            schoolId: user.schoolId,
            academicYearId: user.academicYearId,
            isDeleted: user.isDeleted,
            createdAt: user.createdAt,
            phone: user.teacherPhone || user.parentPhone || null,
            specialization: user.teacherSpecialization || null,
            classIds: [],
            _teacherId: user.teacherId,
          };
        }
        return acc;
      }, {});

      const teacherIds = Object.values(normalizedById)
        .map((user: any) => user._teacherId)
        .filter((id: any) => id != null);

      if (teacherIds.length > 0) {
        const assignmentRows = await db
          .select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId })
          .from(classTeachers)
          .where(inArray(classTeachers.teacherId, teacherIds));

        const assignmentMap = new Map<number, number[]>();
        assignmentRows.forEach((item) => {
          const existing = assignmentMap.get(item.teacherId) || [];
          existing.push(item.classId);
          assignmentMap.set(item.teacherId, existing);
        });

        Object.values(normalizedById).forEach((user: any) => {
          if (user._teacherId != null) {
            user.classIds = assignmentMap.get(user._teacherId) || [];
          }
          delete user._teacherId;
        });
      } else {
        Object.values(normalizedById).forEach((user: any) => {
          delete user._teacherId;
        });
      }

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
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !name || !role) return res.status(400).json({ error: 'Missing required fields: email, name, role' });

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

      const existingByUid = await db.select().from(users).where(eq(users.uid, finalUid));
      if (existingByUid.length > 0) return res.status(409).json({ error: 'User with same uid already exists' });

      // Email uniqueness check:
      // - super_admin: globally unique (across all schools)
      // - others: unique per school
      let existingByEmail: any[] = [];
      if (role === 'super_admin') {
        existingByEmail = await findExistingUsersByEmail(normalizedEmail);
      } else {
        // For non-super_admin roles, check email uniqueness within the school
        existingByEmail = await findExistingUsersByEmailAndSchool(normalizedEmail, resolvedSchoolId);
      }
      
      if (existingByEmail.length > 0) {
        return res.status(409).json({ error: 'User with same email already exists' + (resolvedSchoolId && role !== 'super_admin' ? ' in this school' : '') });
      }

      const newUserRows = await db.insert(users).values({ uid: finalUid, email: normalizedEmail, name, role, schoolId: resolvedSchoolId, academicYearId, gender: gender ?? null }).returning();
      const createdUser = newUserRows[0];

      if (role === 'school_admin' && resolvedSchoolId != null) {
        await upsertUserSchoolMembership(createdUser.id, resolvedSchoolId, 'school_admin', true);
      }

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

        if (parentSchoolId != null) {
          await db.insert(userSchools).values({
            userId: createdUser.id,
            schoolId: parentSchoolId,
            role: 'parent',
            isActive: true,
          });
        }
      } else if (role === 'teacher') {
        const teacherResult = await db.insert(teachers)
          .values({ userId: createdUser.id, schoolId: resolvedSchoolId, phone: phone || '', specialization: normalizeSpecialization(specialization) || null })
          .returning();
        teacherProfile = teacherResult[0];

        if (resolvedSchoolId != null) {
          await db.insert(userSchools).values({
            userId: createdUser.id,
            schoolId: resolvedSchoolId,
            role: 'teacher',
            isActive: true,
          });
        }

        // Assign provided classes to this teacher when classIds are supplied
        if (Array.isArray(classIds) && classIds.length > 0) {
          console.log('Assigning classes to teacher (admin create):', { teacherId: teacherProfile?.id, classIds });
          for (const rawClassId of classIds) {
            const cid = Number(rawClassId);
            if (Number.isNaN(cid)) {
              console.log('DIAG admin create skip invalid id', { rawClassId, teacherId: teacherProfile?.id });
              continue;
            }
            const [cls] = await db.select().from(classes).where(eq(classes.id, cid));
            const [schoolClassRow] = resolvedSchoolId != null ? await db.select().from(schoolClasses).where(and(eq(schoolClasses.classId, cid), eq(schoolClasses.schoolId, resolvedSchoolId))) : [null];
            const approved = await isApprovedClassForSchool(cid, resolvedSchoolId);

            if (!cls) {
              console.log('DIAG admin create - ignored', { cid, teacherId: teacherProfile?.id, resolvedSchoolId, reason: 'class_not_found', cls: null, schoolClassRow, approved });
              continue;
            }

            if (resolvedSchoolId != null && cls.schoolId != null && cls.schoolId !== resolvedSchoolId) {
              console.log('DIAG admin create - ignored', { cid, teacherId: teacherProfile?.id, resolvedSchoolId, reason: 'class_school_mismatch', cls, schoolClassRow, approved });
              continue;
            }

            if (!approved) {
              console.log('DIAG admin create - ignored', { cid, teacherId: teacherProfile?.id, resolvedSchoolId, reason: 'not_approved_for_school', cls, schoolClassRow, approved });
              continue;
            }

            try {
              const existingAssignment = await db.select().from(classTeachers).where(and(eq(classTeachers.classId, cid), eq(classTeachers.teacherId, teacherProfile.id)));
              if (existingAssignment.length === 0) {
                await db.insert(classTeachers).values({ classId: cid, teacherId: teacherProfile.id });
                const insertedRows = await db.select().from(classTeachers).where(and(eq(classTeachers.classId, cid), eq(classTeachers.teacherId, teacherProfile.id)));
                console.log('DIAG admin create - inserted', { cid, teacherId: teacherProfile.id, insertedCount: insertedRows.length, cls, schoolClassRow, approved, resolvedSchoolId });
              } else {
                console.log('DIAG admin create - ignored', { cid, teacherId: teacherProfile.id, reason: 'already_assigned', existingCount: existingAssignment.length, cls, schoolClassRow, approved, resolvedSchoolId });
              }
            } catch (e: any) {
              console.warn('Failed to assign teacher to class', cid, e?.message || e);
            }
          }
        }
          // Ensure users.schoolId stays consistent with teachers.schoolId
        try {
          await db.update(users).set({ schoolId: resolvedSchoolId ?? null }).where(eq(users.id, createdUser.id));
        } catch (e: any) {
          console.warn('DIAG: failed to sync users.schoolId after teacher creation', { userId: createdUser.id, resolvedSchoolId, err: e?.message || e });
        }
        // Log if inconsistency exists after creation
        try {
          await logIfTeacherUserMismatch(createdUser.id, teacherProfile?.id);
        } catch (e) {
          /* ignore */
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

      // Build response with classIds for teachers
      const responseBody: any = {
        ...createdUser,
        specialization: role === 'teacher' ? (teacherProfile?.specialization || null) : null,
        phone: role === 'teacher' ? (teacherProfile?.phone || phone || '') : role === 'parent' ? phone || '' : undefined,
      };

      if (role === 'teacher' && teacherProfile?.id) {
        responseBody.teacherId = teacherProfile.id;
        const assignments = await db
          .select({ classId: classTeachers.classId })
          .from(classTeachers)
          .where(eq(classTeachers.teacherId, teacherProfile.id));
        responseBody.classIds = assignments.map((a) => a.classId);
      }

      res.status(201).json(responseBody);
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
      const { email, name, role, schoolId: incomingSchoolId, academicYearId: rawAcademicYearId, phone, specialization, gender, classIds, studentId } = req.body;
      // Only set parsedSchoolId when provided in the request. If omitted, preserve existing DB values.
      const parsedSchoolId = incomingSchoolId != null && incomingSchoolId !== '' ? parseInt(incomingSchoolId, 10) : undefined;
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
      if (targetUser.role === 'teacher' && role !== 'teacher') {
        return res.status(403).json({ error: 'Forbidden: cannot change role for teacher accounts' });
      }
      if (actor.role === 'school_admin' && actor.schoolId !== targetUser.schoolId) {
        // Teachers and parents may belong to multiple schools through userSchools.
        if (['teacher', 'parent'].includes(targetUser.role)) {
          const membership = await ensureUserSchoolMembership(targetUser.id, actor.schoolId, targetUser.role);
          if (!membership) {
            return res.status(403).json({ error: 'Forbidden: cannot modify users outside your school' });
          }
        } else {
          return res.status(403).json({ error: 'Forbidden: cannot modify users outside your school' });
        }
      }

      // Enforce hierarchy: school_admin cannot modify to super_admin or school_admin
      if (actor.role === 'school_admin' && ['super_admin', 'school_admin'].includes(role)) {
        return res.status(403).json({ error: 'Forbidden: school_admin cannot modify admin accounts' });
      }

      // school_admin cannot modify other admins even if in same school
      if (actor.role === 'school_admin' && ['super_admin', 'school_admin'].includes(targetUser.role)) {
        return res.status(403).json({ error: 'Forbidden: school_admin cannot modify admin accounts' });
      }

      // Email uniqueness check when changing email:
      // - Exclude the user being updated (id != ${id})
      // - For super_admin: globally unique
      // - For others: unique per school
      if (email !== targetUser.email) {
        // Email is being changed, check if new email is available
        const normalizedEmail = email.trim().toLowerCase();
        
        let emailConflicts: any[] = [];
        if (targetUser.role === 'super_admin' || role === 'super_admin') {
          // Super admin emails are globally unique
          emailConflicts = await db.select().from(users).where(
            and(
              eq(sql`LOWER(${users.email})`, normalizedEmail),
              sql`${users.id} != ${id}`
            )
          );
        } else {
          // For other roles: unique per school
          const schoolForCheck = parsedSchoolId !== undefined ? parsedSchoolId : targetUser.schoolId;
          if (schoolForCheck != null) {
            emailConflicts = await db.select().from(users).where(
              and(
                eq(sql`LOWER(${users.email})`, normalizedEmail),
                eq(users.schoolId, schoolForCheck),
                sql`${users.id} != ${id}`
              )
            );
          }
        }
        
        if (emailConflicts.length > 0) {
          const school = parsedSchoolId !== undefined ? parsedSchoolId : targetUser.schoolId;
          const msg = role === 'super_admin' || targetUser.role === 'super_admin' 
            ? 'Email already in use by another user'
            : (school ? 'Email already in use by another user in this school' : 'Email already in use by another user');
          return res.status(409).json({ error: msg });
        }
      }

      const updatedValues: any = { email, name, role, gender: gender ?? null };
      if (parsedSchoolId !== undefined) updatedValues.schoolId = parsedSchoolId;
      if (role === 'school_admin') {
        if (academicYearId == null) {
          return res.status(400).json({ error: 'Missing required field: academicYearId is required for school_admin role' });
        }
        const selectedSchoolId = incomingSchoolId ? parseInt(String(incomingSchoolId), 10) : null;
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

      const effectiveSchoolIdForMembership = role === 'school_admin'
        ? (parsedSchoolId !== undefined ? parsedSchoolId : targetUser.schoolId)
        : null;
      if (role === 'school_admin' && effectiveSchoolIdForMembership != null) {
        await upsertUserSchoolMembership(id, effectiveSchoolIdForMembership, 'school_admin', true);
      }

      if (role === 'teacher') {
        await db.delete(parents).where(eq(parents.userId, id));
        const existingTeacher = await db.select().from(teachers).where(eq(teachers.userId, id));
        let teacherProfileId: number | null = null;
        if (existingTeacher.length > 0) {
          teacherProfileId = existingTeacher[0].id;
          // Update teachers.school_id only if a new schoolId was provided in the request
          if (parsedSchoolId !== undefined) {
            await db.update(teachers).set({ schoolId: parsedSchoolId, phone: phone || '', specialization: normalizeSpecialization(specialization) || null }).where(eq(teachers.userId, id));
            // Keep users.school_id in sync
            try {
              await db.update(users).set({ schoolId: parsedSchoolId ?? null }).where(eq(users.id, id));
            } catch (e: any) {
              console.warn('DIAG: failed to sync users.schoolId during admin update', { userId: id, parsedSchoolId, err: e?.message || e });
            }
          } else {
            await db.update(teachers).set({ phone: phone || '', specialization: normalizeSpecialization(specialization) || null }).where(eq(teachers.userId, id));
          }
        } else {
          const [inserted] = await db.insert(teachers).values({ userId: id, schoolId: parsedSchoolId !== undefined ? parsedSchoolId : undefined, phone: phone || '', specialization: normalizeSpecialization(specialization) || null } as any).returning();
          teacherProfileId = inserted?.id ?? null;
          // Also ensure users.school_id is set when creating teacher profile
          if (parsedSchoolId !== undefined) {
            try {
              await db.update(users).set({ schoolId: parsedSchoolId ?? null }).where(eq(users.id, id));
            } catch (e: any) {
              console.warn('DIAG: failed to sync users.schoolId when inserting teacher profile', { userId: id, parsedSchoolId, err: e?.message || e });
            }
          }
        }

          if (teacherProfileId != null) {
          // Clear previous class assignments for this teacher so the new set replaces them.
          console.log('Updating class assignments for teacher (admin update):', { teacherProfileId, classIds });
          await db.delete(classTeachers).where(eq(classTeachers.teacherId, teacherProfileId));
          if (Array.isArray(classIds) && classIds.length > 0) {
            const assignmentSchoolId = incomingSchoolId ? parseInt(String(incomingSchoolId), 10) : (actor && actor.role === 'school_admin' && actor.schoolId != null ? actor.schoolId : targetUser.schoolId);
            for (const rawClassId of classIds) {
              const cid = parseInt(rawClassId, 10);
              if (Number.isNaN(cid)) {
                console.log('DIAG admin update skip invalid id', { rawClassId, teacherProfileId });
                continue;
              }
              const [cls] = await db.select().from(classes).where(eq(classes.id, cid));
              const [schoolClassRow] = assignmentSchoolId != null ? await db.select().from(schoolClasses).where(and(eq(schoolClasses.classId, cid), eq(schoolClasses.schoolId, assignmentSchoolId))) : [null];
              const approved = await isApprovedClassForSchool(cid, assignmentSchoolId);

              if (!cls) {
                console.log('DIAG admin update - ignored', { cid, teacherProfileId, assignmentSchoolId, reason: 'class_not_found', cls: null, schoolClassRow, approved });
                continue;
              }

              if (cls.schoolId != null && assignmentSchoolId != null && cls.schoolId !== assignmentSchoolId) {
                console.log('DIAG admin update - ignored', { cid, teacherProfileId, assignmentSchoolId, reason: 'class_school_mismatch', cls, schoolClassRow, approved });
                continue;
              }

              if (!approved) {
                console.log('DIAG admin update - ignored', { cid, teacherProfileId, assignmentSchoolId, reason: 'not_approved_for_school', cls, schoolClassRow, approved });
                continue;
              }

              try {
                await db.insert(classTeachers).values({ classId: cid, teacherId: teacherProfileId });
                const insertedRows = await db.select().from(classTeachers).where(and(eq(classTeachers.classId, cid), eq(classTeachers.teacherId, teacherProfileId)));
                console.log('DIAG admin update - inserted', { cid, teacherProfileId, insertedCount: insertedRows.length, cls, schoolClassRow, approved, assignmentSchoolId });
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
          schoolId: incomingSchoolId ? (Number.isNaN(Number(incomingSchoolId)) ? null : Number(incomingSchoolId)) : null,
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
      const diffDescription = formatUserUpdateDiff(targetUser, { email, name, role, schoolId: incomingSchoolId, phone, specialization });
      await logAuditEvent(actor, 'update', 'user', updatedUser.id, actor.schoolId ?? null, `${actor.role === 'school_admin' ? 'School admin' : 'Super admin'} ${actor.email || actor.uid} updated account ${updatedUser.email}. ${diffDescription}`);
      
      // If teacher role, include classIds in response
      if (role === 'teacher') {
        const existingTeacher = await db.select().from(teachers).where(eq(teachers.userId, id));
        let classIds: number[] = [];
        let teacherId: number | null = null;
        let phoneValue = phone || '';
        let specializationValue: string | string[] | null = normalizeSpecialization(specialization) || null;
        if (existingTeacher.length > 0) {
          teacherId = existingTeacher[0].id;
          phoneValue = existingTeacher[0].phone || phoneValue;
          specializationValue = existingTeacher[0].specialization || specializationValue;
          const assignments = await db
            .select({ classId: classTeachers.classId })
            .from(classTeachers)
            .where(eq(classTeachers.teacherId, existingTeacher[0].id));
          classIds = assignments.map((a) => a.classId);
        }
        try {
          await logIfTeacherUserMismatch(updatedUser.id, teacherId);
        } catch (e) {
          /* ignore */
        }
        res.json({ ...updatedUser, teacherId, classIds, phone: phoneValue, specialization: specializationValue });
      } else {
        res.json(updatedUser);
      }
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

  // Local login with email + password
  app.post('/api/auth/local-login', async (req, res) => {
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

  app.get('/api/auth/schools', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      // Get user school memberships from database (single source of truth)
      const memberships = await getUserSchoolMemberships(actor.id ?? null);
      
      let schoolsList = [] as any[];
      if (actor.role === 'super_admin') {
        // Super admins can access all schools
        schoolsList = await db.select().from(schools);
      } else {
        // Non-super-admin users: only return schools they are actually members of
        if (memberships.length === 0) {
          return res.json({ schools: [], activeSchoolId: null });
        }
        
        const schoolIds = memberships.map((membership) => membership.schoolId);
        schoolsList = await db.select().from(schools).where(inArray(schools.id, schoolIds));
      }

      // Find active school from memberships (for non-super-admin)
      const activeSchoolId = actor.role === 'super_admin' 
        ? null 
        : memberships.find((membership) => membership.isActive)?.schoolId ?? memberships[0]?.schoolId ?? null;
      
      res.json({ 
        schools: schoolsList.map((school) => ({ id: school.id, name: school.name })), 
        activeSchoolId 
      });
    } catch (err: any) {
      console.error('Error fetching user schools:', err);
      res.status(500).json({ error: err?.message || 'Failed to fetch user schools' });
    }
  });

  app.post('/api/auth/schools/active', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      
      const { schoolId } = req.body ?? {};
      const parsedSchoolId = typeof schoolId === 'number' ? schoolId : parseInt(String(schoolId), 10);
      if (!Number.isFinite(parsedSchoolId)) return res.status(400).json({ error: 'Invalid schoolId' });

      // Super admins can select any school
      if (actor.role === 'super_admin') {
        res.json({ schoolId: parsedSchoolId });
        return;
      }

      // For school_admin roles: strictly verify a school_admin membership exists in user_schools
      const membership = actor.role === 'school_admin'
        ? await ensureUserSchoolMembership(actor.id ?? null, parsedSchoolId, 'school_admin')
        : await ensureUserSchoolMembership(actor.id ?? null, parsedSchoolId);
      if (!membership) {
        console.warn('School selection denied: user has no membership for school', { 
          userId: actor.id, 
          schoolId: parsedSchoolId,
          userRole: actor.role 
        });
        return res.status(403).json({ error: 'School membership not found for this user' });
      }
      
      // Membership exists, set it as active
      await setActiveUserSchool(actor.id ?? null, parsedSchoolId);
      console.log('School activated successfully', { userId: actor.id, schoolId: parsedSchoolId });
      res.json({ schoolId: parsedSchoolId });
    } catch (err: any) {
      console.error('Error setting active school:', err);
      res.status(500).json({ error: err?.message || 'Failed to set active school' });
    }
  });

  // ==========================================
  // SECURE CUSTOMER OR CURRENT USER DATA
  // ==========================================

  // Sync logged in user or simulation context
  app.post('/api/auth/register-or-login', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthenticated' });
      }

      const { uid, email, name, role } = req.user;
      const normalizedEmail = normalizeEmail(email);

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

      if (normalizedEmail) {
        // Search for existing user by email
        // If user has a schoolId in context, search per-school; otherwise global
        let existingByEmail: any[] = [];
        if (req.user.schoolId) {
          // Per-school search
          existingByEmail = await db.select().from(users).where(
            and(
              eq(sql`LOWER(${users.email})`, normalizedEmail),
              eq(users.schoolId, req.user.schoolId)
            )
          );
        } else {
          // Global search (fallback)
          existingByEmail = await db.select().from(users).where(eq(sql`LOWER(${users.email})`, normalizedEmail));
        }
        
        if (existingByEmail.length > 0) {
          const existing = existingByEmail[0];
          if (req.user.schoolId && existing.schoolId !== req.user.schoolId) {
            await db.update(users).set({ schoolId: req.user.schoolId }).where(eq(users.id, existing.id));
            existing.schoolId = req.user.schoolId;
          }
          return res.json(existing);
        }
      }

      // If user is simulated or we need to auto-create, preserve known roles, otherwise default to parent
      const allowedRoles = ['super_admin', 'school_admin', 'teacher', 'parent'];
      const normalizedRole = String(role || '').trim();
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
        if (resolvedSchoolId != null) {
          try {
            await db.insert(userSchools).values({
              userId: createdUser.id,
              schoolId: resolvedSchoolId,
              role: 'parent',
              isActive: true,
            });
          } catch (e: any) {
            console.warn('Failed to insert user_schools for register-or-login parent', e?.message || e);
          }
        }
      } else if (finalRole === 'school_admin') {
        if (resolvedSchoolId != null) {
          try {
            await upsertUserSchoolMembership(createdUser.id, resolvedSchoolId, 'school_admin', true);
          } catch (e: any) {
            console.warn('Failed to insert user_schools for register-or-login school_admin', e?.message || e);
          }
        }
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
          try {
            await db.insert(userSchools).values({
              userId: createdUser.id,
              schoolId: defaultSchool[0].id,
              role: 'teacher',
              isActive: true,
            });
          } catch (e: any) {
            console.warn('Failed to insert user_schools for register-or-login teacher', e?.message || e);
          }
          // If a teacher profile was created in register-or-login flow, attempt to find it and log inconsistencies
          try {
            const createdTeacherRow = await db.select().from(teachers).where(eq(teachers.userId, createdUser.id));
            if (createdTeacherRow.length > 0) {
              await logIfTeacherUserMismatch(createdUser.id, createdTeacherRow[0].id);
            }
          } catch (e) {
            /* ignore */
          }
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

      let list;
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
      if (!user) {
        console.log('TRACE /api/evaluations about to return 404 after resolveActor', { reqUser: req.user });
        return res.status(404).json({ error: 'User not found' });
      }

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

      await db.transaction(async (tx) => {
        const schoolUserIds = (await tx.select({ id: users.id }).from(users).where(eq(users.schoolId, id))).map((u) => u.id);
        const classIds = (await tx.select({ id: classes.id }).from(classes).where(eq(classes.schoolId, id))).map((c) => c.id);
        const studentIds = (await tx.select({ id: students.id }).from(students).where(eq(students.schoolId, id))).map((s) => s.id);
        const academicYearIds = (await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.schoolId, id))).map((a) => a.id);
        const evaluationIds = classIds.length > 0
          ? (await tx.select({ id: evaluations.id }).from(evaluations).where(sql`${evaluations.classId} IN ${classIds}`)).map((e) => e.id)
          : [];

        console.log(`School deletion order for school=${id}: users=${schoolUserIds.length}, classes=${classIds.length}, students=${studentIds.length}, academicYears=${academicYearIds.length}, evaluations=${evaluationIds.length}`);

        if (schoolUserIds.length > 0) {
          console.log(`Step 1/10: delete notifications for users [${schoolUserIds.join(', ')}]`);
          await tx.delete(notifications).where(sql`${notifications.userId} IN ${schoolUserIds}`);
        }

        if (studentIds.length > 0) {
          console.log(`Step 2/10: delete absences for students [${studentIds.join(', ')}]`);
          await tx.delete(absences).where(sql`${absences.studentId} IN ${studentIds}`);
        }
        if (classIds.length > 0) {
          console.log(`Step 3/10: delete absences for classes [${classIds.join(', ')}]`);
          await tx.delete(absences).where(sql`${absences.classId} IN ${classIds}`);
        }

        if (studentIds.length > 0) {
          console.log(`Step 4/10: delete grades for students [${studentIds.join(', ')}]`);
          await tx.delete(grades).where(sql`${grades.studentId} IN ${studentIds}`);
        }
        if (evaluationIds.length > 0) {
          console.log(`Step 5/10: delete grades for evaluations [${evaluationIds.join(', ')}]`);
          await tx.delete(grades).where(sql`${grades.evaluationId} IN ${evaluationIds}`);
        }

        if (evaluationIds.length > 0) {
          console.log(`Step 6/10: delete evaluations [${evaluationIds.join(', ')}]`);
          await tx.delete(evaluations).where(sql`${evaluations.id} IN ${evaluationIds}`);
        }

        if (studentIds.length > 0) {
          console.log(`Step 7/10: delete students [${studentIds.join(', ')}]`);
          await tx.delete(students).where(sql`${students.id} IN ${studentIds}`);
        }

        if (schoolUserIds.length > 0) {
          console.log(`Step 8/10: delete parent profiles for users [${schoolUserIds.join(', ')}]`);
          await tx.delete(parents).where(sql`${parents.userId} IN ${schoolUserIds}`);
        }

        if (classIds.length > 0) {
          console.log(`Step 9/10: unset teacher assignments for classes [${classIds.join(', ')}]`);
          await tx.update(classes).set({ teacherId: null }).where(sql`${classes.id} IN ${classIds}`);
        }

        if (schoolUserIds.length > 0) {
          console.log(`Step 10/11: disconnect schoolAdminId and delete audit events for users [${schoolUserIds.join(', ')}]`);
          await tx.update(students).set({ schoolAdminId: null }).where(sql`${students.schoolAdminId} IN ${schoolUserIds}`);
          await tx.delete(auditEvents).where(sql`${auditEvents.actorUserId} IN ${schoolUserIds}`);
        }

        if (schoolUserIds.length > 0) {
          console.log(`Step 11/11: delete local auth entries for users [${schoolUserIds.join(', ')}]`);
          await tx.delete(localAuths).where(sql`${localAuths.userId} IN ${schoolUserIds}`);
        }

        console.log('Step 12/12: delete audit events linked directly to school');
        await tx.delete(auditEvents).where(eq(auditEvents.schoolId, id));

        console.log(`Deleting remaining teachers, classes, academic years and users for school=${id}`);
        await tx.delete(teachers).where(eq(teachers.schoolId, id));

        if (classIds.length > 0) {
          await tx.delete(classes).where(sql`${classes.id} IN ${classIds}`);
        }

        if (academicYearIds.length > 0) {
          await tx.delete(academicYears).where(sql`${academicYears.id} IN ${academicYearIds}`);
        }

        if (schoolUserIds.length > 0) {
          await tx.delete(users).where(sql`${users.id} IN ${schoolUserIds}`);
        }

        console.log('Final cleanup pass: delete any remaining school-linked entities by schoolId');
        await tx.delete(students).where(eq(students.schoolId, id));
        await tx.delete(classes).where(eq(classes.schoolId, id));
        await tx.delete(teachers).where(eq(teachers.schoolId, id));
        await tx.delete(academicYears).where(eq(academicYears.schoolId, id));
        await tx.delete(users).where(eq(users.schoolId, id));
        await tx.delete(auditEvents).where(eq(auditEvents.schoolId, id));

        await tx.delete(schools).where(eq(schools.id, id));
      });

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

      let list: any[];
      if (user.role === 'super_admin') {
        list = await db.select().from(academicYears);
      } else if (user.role === 'school_admin') {
        // School admin sees ONLY their assigned academic year
        if (user.academicYearId) {
          list = await db.select().from(academicYears).where(eq(academicYears.id, user.academicYearId));
        } else {
          // If no assigned year, return empty list (admin must have an assigned year)
          list = [];
        }
      } else {
        // Teachers and parents see global academic years plus any legacy school-specific ones
        list = await db.select().from(academicYears).where(
          or(
            sql`${academicYears.schoolId} IS NULL`,
            eq(academicYears.schoolId, user.schoolId)
          )
        );
      }

      res.json(list);
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

  // 3. Classes - Filtered by school
  app.get('/api/classes', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const schoolIdParam = req.query.schoolId ? Number(req.query.schoolId) : undefined;
      const approvedOnly = req.query.approvedOnly === 'true' || req.query.approvedOnly === '1';
      const targetSchoolId = actor.role === 'school_admin'
        ? actor.schoolId
        : actor.role === 'teacher'
          ? actor.schoolId
          : schoolIdParam;

      const baseSelect = {
        id: classes.id,
        name: classes.name,
        schoolId: classes.schoolId,
        academicYearId: classes.academicYearId,
        yearName: academicYears.name,
        teacherId: classes.teacherId,
        teacherName: users.name,
      };

      if (actor.role === 'teacher') {
        if (!targetSchoolId) {
          return res.status(403).json({ error: 'Teacher school context is required' });
        }

        const localClasses = await db
          .select(baseSelect)
          .from(classes)
          .leftJoin(teachers, and(eq(classes.teacherId, teachers.id), eq(teachers.schoolId, classes.schoolId)))
          .leftJoin(users, eq(teachers.userId, users.id))
          .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id))
          .where(eq(classes.schoolId, targetSchoolId));

        const approvedGlobalClasses = await db
          .select(baseSelect)
          .from(classes)
          .innerJoin(
            schoolClasses,
            and(
              eq(classes.id, schoolClasses.classId),
              eq(schoolClasses.schoolId, targetSchoolId),
              eq(schoolClasses.status, 'approved')
            )
          )
          .leftJoin(teachers, and(eq(classes.teacherId, teachers.id), eq(teachers.schoolId, classes.schoolId)))
          .leftJoin(users, eq(teachers.userId, users.id))
          .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id))
          .where(sql`${classes.schoolId} IS NULL`);

        const combined = [...localClasses, ...approvedGlobalClasses];
        const uniqueMap = new Map<number, typeof combined[number]>();
        combined.forEach((row) => uniqueMap.set(row.id, row));

        res.json(Array.from(uniqueMap.values()));
        return;
      }

      if (approvedOnly && !targetSchoolId) {
        if (actor.role === 'super_admin') {
          const approvedRows = await db
            .select(baseSelect)
            .from(classes)
            .innerJoin(
              schoolClasses,
              and(
                eq(classes.id, schoolClasses.classId),
                eq(schoolClasses.status, 'approved')
              )
            )
            .leftJoin(teachers, and(eq(classes.teacherId, teachers.id), eq(teachers.schoolId, classes.schoolId)))
            .leftJoin(users, eq(teachers.userId, users.id))
            .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id));

          res.json(approvedRows);
          return;
        }

        return res.status(403).json({ error: 'School context is required' });
      }

      let query = db
        .select(baseSelect)
        .from(classes)
        .leftJoin(teachers, and(eq(classes.teacherId, teachers.id), eq(teachers.schoolId, classes.schoolId)))
        .leftJoin(users, eq(teachers.userId, users.id))
        .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id));

      if (actor.role !== 'super_admin') {
        if (actor.schoolId != null) {
          query = query.where(or(eq(classes.schoolId, actor.schoolId), sql`${classes.schoolId} IS NULL`)) as any;
        } else {
          return res.json([]);
        }
      }

      const allClasses = await query;

      if (targetSchoolId) {
        const statusRows = await db.select().from(schoolClasses).where(eq(schoolClasses.schoolId, targetSchoolId));
        const statusMap = new Map(statusRows.map((row) => [row.classId, row.status]));

        let result = allClasses.map((klass) => ({
          ...klass,
          status: statusMap.get(klass.id) ?? (klass.schoolId === targetSchoolId ? 'approved' : 'pending'),
        }));

        if (approvedOnly) {
          result = result.filter((klass) => klass.status === 'approved');
        }

        console.log('✅ GET /api/classes RESPONSE', result);
        res.json(result);
        return;
      }

      console.log('✅ GET /api/classes RESPONSE', allClasses);
      res.json(allClasses);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve classes' });
    }
  });

  app.post('/api/classes', requireAuth, async (req: AuthRequest, res) => {
    try {
      console.log('POST /api/classes exécuté');
      console.log('🔥 RAW BODY RECEIVED =', req.body);
      console.log('BODY FULL =', JSON.stringify(req.body));
      console.log('name raw =', req.body?.name);
      console.log('academicYearId raw =', req.body?.academicYearId);
      console.log('type =', typeof req.body?.academicYearId);
      console.log('schoolId raw =', req.body?.schoolId);
      console.log('schoolId type =', typeof req.body?.schoolId);
      console.log('🔥 FULL KEYS =', Object.keys(req.body || {}));
      console.log('🔥 HIT POST /api/classes - NEW CODE');
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { name, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, teacherId } = req.body;
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      const academicYearId = rawAcademicYearId != null && rawAcademicYearId !== '' ? Number(rawAcademicYearId) : null;
      console.log('academicYearId parsed =', academicYearId, typeof academicYearId);
      if (rawAcademicYearId != null && rawAcademicYearId !== '' && Number.isNaN(academicYearId)) {
        return res.status(400).json({ error: 'Invalid academicYearId' });
      }

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      const parsedSchoolId = rawSchoolId != null && rawSchoolId !== '' && rawSchoolId !== 'undefined' && rawSchoolId !== 'null'
        ? Number(rawSchoolId)
        : null;
      console.log('🔥 parsedSchoolId =', parsedSchoolId);
      if (rawSchoolId != null && rawSchoolId !== '' && rawSchoolId !== 'undefined' && rawSchoolId !== 'null' && Number.isNaN(parsedSchoolId)) {
        return res.status(400).json({ error: 'Invalid schoolId' });
      }

      if (user.role !== 'super_admin' && user.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (user.role === 'school_admin' && !user.schoolId) {
        return res.status(403).json({ error: 'School admin must belong to a school' });
      }

      const resolvedSchoolId = user.role === 'super_admin' ? parsedSchoolId : null;
      const pendingSchoolId = user.role === 'school_admin' ? user.schoolId : null;

      // schoolId may be null for global classes; only name and academicYearId are required
      if (!trimmedName || academicYearId == null) {
        return res.status(400).json({ error: `Missing required parameters. Received: name=${trimmedName}, academicYearId=${academicYearId}` });
      }

      console.log('Attempting to create global class', { name: trimmedName, academicYearId, teacherId });

      // Defensive duplicate check to avoid DB unique constraint errors
      try {
        const duplicateCondition = resolvedSchoolId != null
          ? and(
            eq(classes.name, trimmedName),
            eq(classes.schoolId, Number(resolvedSchoolId)),
            eq(classes.academicYearId, Number(academicYearId))
          )
          : and(
            eq(classes.name, trimmedName),
            sql`${classes.schoolId} IS NULL`,
            eq(classes.academicYearId, Number(academicYearId))
          );

        const existing = await db.select().from(classes).where(duplicateCondition);
        if (existing && existing.length > 0) {
          return res.status(400).json({ error: `Classe déjà existante: ${trimmedName}` });
        }
      } catch (dupErr: any) {
        console.error('Error while checking duplicate class:', dupErr);
        // continue to attempt insert; server will return DB error if it fails
      }

      try {
        const [newClass] = await db.insert(classes).values({
          name: trimmedName,
          schoolId: resolvedSchoolId,
          academicYearId: Number(academicYearId),
          teacherId: teacherId ? Number(teacherId) : null,
        }).returning();

        if (pendingSchoolId) {
          await db.insert(schoolClasses).values({
            schoolId: pendingSchoolId,
            classId: newClass.id,
            status: 'pending',
          });
        }

        console.log('✅ CLASS CREATED:', newClass);
        console.log('✅ CREATED CLASS ID:', newClass.id);
        console.log('✅ CLASS CREATED SUCCESSFULLY');

        res.status(201).json({
          ...newClass,
          schoolId: newClass.schoolId ?? null,
          status: pendingSchoolId ? 'pending' : undefined,
        });
      } catch (insertErr: any) {
        console.error('ERROR OBJECT:', insertErr);
        if (insertErr instanceof Error) {
          console.error('MESSAGE:', insertErr.message);
          console.error('STACK:', insertErr.stack);
        }
        console.dir(insertErr, { depth: null });
        console.error('code:', insertErr?.code);
        console.error('detail:', insertErr?.detail);
        console.error('constraint:', insertErr?.constraint);
        console.error('table:', insertErr?.table);
        console.error('column:', insertErr?.column);

        // Postgres unique violation
        if (insertErr && insertErr.code === '23505') {
          return res.status(400).json({ error: `Classe déjà existante: ${trimmedName}` });
        }
        return res.status(500).json({ error: `Failed to create class: ${insertErr?.message || insertErr}` });
      }
    } catch (error: any) {
      console.error('POST /api/classes STACK:', error);
      console.error(error instanceof Error ? error.stack : error);

      return res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  app.post('/api/schools/:schoolId/classes/:classId/approve', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.role !== 'super_admin' && user.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = Number(req.params.schoolId);
      const classId = Number(req.params.classId);
      if (!schoolId || !classId) return res.status(400).json({ error: 'Invalid class or school ID' });

      if (user.role === 'school_admin' && user.schoolId !== schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const existing = await db.select().from(schoolClasses).where(and(eq(schoolClasses.schoolId, schoolId), eq(schoolClasses.classId, classId)));
      if (existing[0]) {
        const [updated] = await db.update(schoolClasses)
          .set({ status: 'approved', updatedAt: new Date() })
          .where(and(eq(schoolClasses.schoolId, schoolId), eq(schoolClasses.classId, classId)))
          .returning();
        return res.json(updated);
      }

      const [created] = await db.insert(schoolClasses).values({ schoolId, classId, status: 'approved' }).returning();
      res.status(201).json(created);
    } catch (err: any) {
      console.error('Error approving class:', err);
      res.status(500).json({ error: 'Failed to approve class' });
    }
  });

  app.post('/api/schools/:schoolId/classes/:classId/reject', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.role !== 'super_admin' && user.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = Number(req.params.schoolId);
      const classId = Number(req.params.classId);
      if (!schoolId || !classId) return res.status(400).json({ error: 'Invalid class or school ID' });

      if (user.role === 'school_admin' && user.schoolId !== schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const existing = await db.select().from(schoolClasses).where(and(eq(schoolClasses.schoolId, schoolId), eq(schoolClasses.classId, classId)));
      if (existing[0]) {
        const [updated] = await db.update(schoolClasses)
          .set({ status: 'rejected', updatedAt: new Date() })
          .where(and(eq(schoolClasses.schoolId, schoolId), eq(schoolClasses.classId, classId)))
          .returning();
        return res.json(updated);
      }

      const [created] = await db.insert(schoolClasses).values({ schoolId, classId, status: 'rejected' }).returning();
      res.status(201).json(created);
    } catch (err: any) {
      console.error('Error rejecting class:', err);
      res.status(500).json({ error: 'Failed to reject class' });
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
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const teacherProjection = {
        id: teachers.id,
        userId: teachers.userId,
        uid: users.uid,
        name: users.name,
        email: users.email,
        gender: users.gender,
        phone: teachers.phone,
        specialization: teachers.specialization,
        schoolId: teachers.schoolId,
      };

      const baseOldModel = db
        .select(teacherProjection)
        .from(teachers)
        .innerJoin(users, eq(teachers.userId, users.id));

      const baseNewModel = db
        .select({
          ...teacherProjection,
          schoolId: userSchools.schoolId,
        })
        .from(teachers)
        .innerJoin(users, eq(teachers.userId, users.id))
        .innerJoin(userSchools, and(eq(userSchools.userId, users.id), eq(userSchools.role, 'teacher')));

      let oldModelQuery = baseOldModel;
      let newModelQuery = baseNewModel;

      if (actor.role !== 'super_admin') {
        if (!actor.schoolId) {
          return res.json([]);
        }
        oldModelQuery = oldModelQuery.where(eq(teachers.schoolId, actor.schoolId)) as any;
        newModelQuery = newModelQuery.where(eq(userSchools.schoolId, actor.schoolId)) as any;
      }

      const [oldTeachers, newTeachers] = await Promise.all([
        oldModelQuery,
        newModelQuery,
      ]);

      const teacherById = new Map<number, any>();
      for (const teacher of oldTeachers) {
        teacherById.set(teacher.id, teacher);
      }
      for (const teacher of newTeachers) {
        if (!teacherById.has(teacher.id)) {
          teacherById.set(teacher.id, teacher);
        }
      }

      const teachersList = Array.from(teacherById.values());
      const teacherIds = teachersList.map((teacher) => teacher.id).filter(Boolean);

      let assignments: Array<{ teacherId: number; classId: number }> = [];
      if (teacherIds.length > 0) {
        assignments = await db
          .select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId })
          .from(classTeachers)
          .where(inArray(classTeachers.teacherId, teacherIds));
      }

      console.log('GET /api/teachers - assignments count:', assignments.length);
      const assignmentMap = new Map<number, number[]>();
      assignments.forEach((item) => {
        const existing = assignmentMap.get(item.teacherId) || [];
        existing.push(item.classId);
        assignmentMap.set(item.teacherId, existing);
      });
      const list = teachersList.map((teacher) => ({
        ...teacher,
        teacherId: teacher.id,
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
      const requestedClassIds = Array.isArray(classIds) ? classIds : [];
      const normalizedEmail = normalizeEmail(email);
      if (!name || !normalizedEmail || !schoolId) return res.status(400).json({ error: `Missing compulsory details. Received name=${name}, email=${email}, schoolId=${schoolId}` });

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      const parsedSchoolId = parseInt(String(schoolId), 10);

      // School admin can only create teachers in their own school
      if (user.role !== 'super_admin') {
        if (user.schoolId && parsedSchoolId !== user.schoolId) {
          return res.status(403).json({ error: 'Cannot create teacher in another school' });
        }
      }
      
      // Email uniqueness check: per-school (same email allowed in different schools)
      const existingTeacherEmail = await findExistingUsersByEmailAndSchool(normalizedEmail, parsedSchoolId);
      if (existingTeacherEmail.length > 0) {
        return res.status(409).json({ error: 'User with same email already exists in this school' });
      }

      // Create User entry first (fake uid for simulation unless logged in on firebase auth)
      const fakeUid = `sim_teacher_${Date.now()}`;
      const userResult = await db.insert(users).values({
        uid: fakeUid,
        email: normalizedEmail,
        name,
        role: 'teacher',
        schoolId: parsedSchoolId,
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
      if (parsedSchoolId != null) {
        try {
          await db.insert(userSchools).values({
            userId: createdUser.id,
            schoolId: parsedSchoolId,
            role: 'teacher',
            isActive: true,
          });
        } catch (e: any) {
          console.warn('Failed to insert user_schools for public teacher create', e?.message || e);
        }
      }

      // Log if inconsistency exists after public create
      try {
        await logIfTeacherUserMismatch(createdUser.id, createdTeacher?.id);
      } catch (e) {
        /* ignore */
      }

      // Assign provided classes to this teacher when classIds are supplied
      if (requestedClassIds.length > 0) {
        const parsedSchoolId = parseInt(schoolId, 10);
        console.log('Assigning classes to teacher (public create):', { teacherId: createdTeacher?.id, classIds: requestedClassIds });
        for (const rawId of requestedClassIds) {
          const cid = Number(rawId);
          if (Number.isNaN(cid)) {
            console.log('DIAG public create skip invalid id', { rawId, teacherId: createdTeacher?.id });
            continue;
          }
          const [cls] = await db.select().from(classes).where(eq(classes.id, cid));
          const [schoolClassRow] = parsedSchoolId != null ? await db.select().from(schoolClasses).where(and(eq(schoolClasses.classId, cid), eq(schoolClasses.schoolId, parsedSchoolId))) : [null];
          const approved = await isApprovedClassForSchool(cid, parsedSchoolId);

          if (!cls) {
            console.log('DIAG public create - ignored', { cid, teacherId: createdTeacher?.id, parsedSchoolId, reason: 'class_not_found', cls: null, schoolClassRow, approved });
            continue;
          }

          if (cls.schoolId != null && cls.schoolId !== parsedSchoolId) {
            console.log('DIAG public create - ignored', { cid, teacherId: createdTeacher?.id, parsedSchoolId, reason: 'class_school_mismatch', cls, schoolClassRow, approved });
            continue;
          }

          if (!approved) {
            console.log('DIAG public create - ignored', { cid, teacherId: createdTeacher?.id, parsedSchoolId, reason: 'not_approved_for_school', cls, schoolClassRow, approved });
            continue;
          }

          try {
            const existingAssignment = await db.select().from(classTeachers).where(and(eq(classTeachers.classId, cid), eq(classTeachers.teacherId, createdTeacher.id)));
            if (existingAssignment.length === 0) {
              await db.insert(classTeachers).values({ classId: cid, teacherId: createdTeacher.id });
              const insertedRows = await db.select().from(classTeachers).where(and(eq(classTeachers.classId, cid), eq(classTeachers.teacherId, createdTeacher.id)));
              console.log('DIAG public create - inserted', { cid, teacherId: createdTeacher.id, insertedCount: insertedRows.length, cls, schoolClassRow, approved, parsedSchoolId });
            } else {
              console.log('DIAG public create - ignored', { cid, teacherId: createdTeacher.id, reason: 'already_assigned', existingCount: existingAssignment.length, cls, schoolClassRow, approved, parsedSchoolId });
            }
          } catch (e: any) {
            console.error('Failed to assign teacher to class', cid, e?.message || e);
          }
        }
      }

      // Fetch classIds for the response
      let classIdsForResponse: number[] = [];
      if (createdTeacher?.id) {
        const assignments = await db
          .select({ classId: classTeachers.classId })
          .from(classTeachers)
          .where(eq(classTeachers.teacherId, createdTeacher.id));
        classIdsForResponse = assignments.map((a) => a.classId);
      }

      res.status(201).json({ 
        ...createdUser, 
        teacherId: createdTeacher.id, 
        phone, 
        specialization: normalizeSpecialization(specialization) || null,
        classIds: classIdsForResponse 
      });
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

      const parentProjection = {
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
      };

      const baseOldModel = db
        .select(parentProjection)
        .from(parents)
        .innerJoin(users, eq(parents.userId, users.id))
        .leftJoin(students, eq(students.parentId, parents.id))
        .leftJoin(classes, eq(students.classId, classes.id))
        .leftJoin(schools, eq(parents.schoolId, schools.id));

      const baseNewModel = db
        .select({
          ...parentProjection,
          schoolId: userSchools.schoolId,
        })
        .from(parents)
        .innerJoin(users, eq(parents.userId, users.id))
        .innerJoin(userSchools, and(eq(userSchools.userId, users.id), eq(userSchools.role, 'parent')))
        .leftJoin(students, eq(students.parentId, parents.id))
        .leftJoin(classes, eq(students.classId, classes.id))
        .leftJoin(schools, eq(userSchools.schoolId, schools.id));

      let oldModelQuery = baseOldModel;
      let newModelQuery = baseNewModel;

      if (filterSchoolId) {
        oldModelQuery = oldModelQuery.where(eq(parents.schoolId, filterSchoolId)) as any;
        newModelQuery = newModelQuery.where(eq(userSchools.schoolId, filterSchoolId)) as any;
      }
      if (filterClassId) {
        oldModelQuery = oldModelQuery.where(eq(students.classId, filterClassId)) as any;
        newModelQuery = newModelQuery.where(eq(students.classId, filterClassId)) as any;
      }

      if (actor.role !== 'super_admin') {
        if (!actor.schoolId) {
          return res.json([]);
        }
        oldModelQuery = oldModelQuery.where(eq(parents.schoolId, actor.schoolId)) as any;
        newModelQuery = newModelQuery.where(eq(userSchools.schoolId, actor.schoolId)) as any;
      }

      const [oldParents, newParents] = await Promise.all([
        oldModelQuery,
        newModelQuery,
      ]);

      const parentById = new Map<number, any>();
      for (const parent of oldParents) {
        parentById.set(parent.id, parent);
      }
      for (const parent of newParents) {
        if (!parentById.has(parent.id)) {
          parentById.set(parent.id, parent);
        }
      }

      const list = Array.from(parentById.values());
      console.debug('[api/parents] returning parents count:', list.length, 'requestedClassId=', filterClassId, 'requestedSchoolId=', filterSchoolId);
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
          const normalizedEmail = normalizeEmail(email);
          if (!name || !normalizedEmail) return res.status(400).json({ error: 'Name and Email are required' });

          // Load user and validate school permission
          const actor = await resolveActor(req);
          if (!actor) return res.status(404).json({ error: 'User not found' });

          const parsedStudentId = studentId != null && studentId !== '' ? parseInt(String(studentId), 10) : undefined;
          let resolvedSchoolId = schoolId != null && schoolId !== '' ? parseInt(String(schoolId), 10) : null;
          if (Number.isNaN(resolvedSchoolId as number)) resolvedSchoolId = null;

          if (parsedStudentId) {
            const [studentRow] = await db
              .select({ parentId: students.parentId, schoolId: students.schoolId })
              .from(students)
              .where(eq(students.id, parsedStudentId));

            if (!studentRow) {
              return res.status(400).json({ error: 'Student not found for provided studentId' });
            }

            if (studentRow.parentId != null) {
              return res.status(400).json({ error: 'Student is already linked to another parent' });
            }

            if (resolvedSchoolId == null && studentRow.schoolId != null) {
              resolvedSchoolId = studentRow.schoolId;
            }
          }

          const effectiveSchoolId = resolvedSchoolId ?? (actor.role !== 'super_admin' ? actor.schoolId : null);
          if (actor.role !== 'super_admin' && effectiveSchoolId != null && actor.schoolId != null && effectiveSchoolId !== actor.schoolId) {
            return res.status(403).json({ error: 'Cannot create parent in another school' });
          }

          // Email uniqueness check: per-school (same email allowed in different schools)
          const existingParentEmail = await findExistingUsersByEmailAndSchool(normalizedEmail, effectiveSchoolId);
          if (existingParentEmail.length > 0) {
            return res.status(409).json({ error: 'User with same email already exists in this school' });
          }

          const fakeUid = `sim_parent_${Date.now()}`;
          const userResult = await db.insert(users).values({
            uid: fakeUid,
            email: normalizedEmail,
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

          const createdParent = parentResult[0];
          if (parsedStudentId) {
            await db.update(students).set({ parentId: createdParent.id }).where(eq(students.id, parsedStudentId));
          }

          if (effectiveSchoolId != null) {
            await db.insert(userSchools).values({
              userId: createdUser.id,
              schoolId: effectiveSchoolId,
              role: 'parent',
              isActive: true,
            });
          }

          console.debug('[api/parents POST] parent inserted:', createdParent);
          res.status(201).json({
            ...createdUser,
            parentId: createdParent.id,
            phone,
            address,
            studentId: createdParent.studentId,
            schoolId: createdParent.schoolId ?? null,
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
        .leftJoin(students, and(eq(students.parentId, parents.id), eq(students.schoolId, parents.schoolId)))
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
        const normalizedEmail = normalizeEmail(r.email || '');
        const phone = (r.phone || '').trim();
        const address = (r.address || '').trim();
        const schoolId = r.schoolId ? parseInt(r.schoolId) : (actor.role === 'school_admin' ? actor.schoolId : null);

        if (!name || !normalizedEmail) {
          errors.push({ row: i, email: normalizedEmail || undefined, error: 'name and email are required' });
          continue;
        }

        // Check email uniqueness per-school (same email allowed in different schools)
        const existing = await findExistingUsersByEmailAndSchool(normalizedEmail, schoolId);
        if (existing && existing.length > 0) {
          errors.push({ row: i, email: normalizedEmail, error: 'duplicate email in this school' });
          continue;
        }

        // create user and parent profile
        const fakeUid = `sim_parent_${Date.now()}_${i}`;
        const userRes = await db.insert(users).values({ uid: fakeUid, email: normalizedEmail, name, role: 'parent', schoolId }).returning();
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
            errors.push({ row: i, email: normalizedEmail, error: `studentIds provided but no matching student found (${String(r.studentIds)})` });
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
            errors.push({ row: i, email: normalizedEmail, error: `studentNames provided but no matching student found (${String(r.studentNames)})` });
          }
        }

        const parentRes = await db.insert(parents).values({ userId: createdUser.id, phone: phone || null, address: address || null, studentId: linkedStudentId, schoolId: schoolId || null }).returning();
        try {
          if (schoolId != null) {
            await db.insert(userSchools).values({
              userId: createdUser.id,
              schoolId,
              role: 'parent',
              isActive: true,
            });
          }
        } catch (e: any) {
          console.warn('Failed to insert user_schools for imported parent', e?.message || e);
        }
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

          const ownedStudents = await db.select({ id: students.id }).from(students).where(eq(students.parentId, parentProfile.id));
          const childStudentIds = ownedStudents.map((s) => s.id).filter((id): id is number => id != null);

          if (childStudentIds.length === 0) {
            return res.json([]);
          }

          query = query.where(inArray(absences.studentId, childStudentIds)) as any;
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
      const [parentRecord] = await db.select().from(parents).where(eq(parents.id, student.parentId));
      if (parentRecord) {
        await db.insert(notifications).values({
          userId: parentRecord.userId,
          title: `Nouvelle absence pour ${student.firstName}`,
          body: `Une absence a été signalée pour ${student.firstName} le ${date} (Période: ${period}). Veuillez fournir un justificatif.`,
          type: 'absence',
        });
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
  // MODULE SUBJECTS (MATIÈRES) API
  // ==========================================

  // Get subjects for current school - restricted to super_admin & school_admin
  app.get('/api/subjects', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const schoolIdParam = req.query.schoolId ? Number(req.query.schoolId) : undefined;
      const approvedOnly = req.query.approvedOnly === 'true' || req.query.approvedOnly === '1';
      const targetSchoolId = user.role === 'school_admin'
        ? user.schoolId
        : user.role === 'teacher'
          ? user.schoolId
          : schoolIdParam;

      if (user.role === 'teacher') {
        if (!targetSchoolId) {
          return res.status(403).json({ error: 'Teacher school context is required' });
        }

        const approvedRows = await db
          .select({
            id: subjects.id,
            schoolId: subjects.schoolId,
            name: subjects.name,
            code: subjects.code,
            status: schoolSubjects.status,
            createdAt: subjects.createdAt,
            updatedAt: subjects.updatedAt,
          })
          .from(subjects)
          .innerJoin(
            schoolSubjects,
            and(
              eq(subjects.id, schoolSubjects.subjectId),
              eq(schoolSubjects.schoolId, targetSchoolId),
              eq(schoolSubjects.status, 'approved')
            )
          );

        res.json(approvedRows.map((subject) => ({
          ...subject,
          schoolId: subject.schoolId ?? null,
        })));
        return;
      }

      if (approvedOnly && !targetSchoolId) {
        if (user.role === 'super_admin') {
          const approvedRows = await db
            .select({
              id: subjects.id,
              schoolId: subjects.schoolId,
              name: subjects.name,
              code: subjects.code,
              status: schoolSubjects.status,
              createdAt: subjects.createdAt,
              updatedAt: subjects.updatedAt,
            })
            .from(subjects)
            .innerJoin(
              schoolSubjects,
              and(
                eq(subjects.id, schoolSubjects.subjectId),
                eq(schoolSubjects.status, 'approved')
              )
            );

          res.json(approvedRows.map((subject) => ({
            ...subject,
            schoolId: subject.schoolId ?? null,
          })));
          return;
        }

        return res.status(403).json({ error: 'School context is required' });
      }

      const allSubjects = await db.select().from(subjects);
      if (targetSchoolId) {
        const statusRows = await db.select().from(schoolSubjects).where(eq(schoolSubjects.schoolId, targetSchoolId));
        const statusMap = new Map(statusRows.map((row) => [row.subjectId, row.status]));
        let result = allSubjects.map((subject) => ({
          ...subject,
          schoolId: subject.schoolId ?? null,
          status: statusMap.get(subject.id) ?? 'pending',
        }));

        if (approvedOnly) {
          result = result.filter((subject) => subject.status === 'approved');
        }

        res.json(result);
        return;
      }

      res.json(allSubjects.map((subject) => ({
        ...subject,
        schoolId: subject.schoolId ?? null,
      })));
    } catch (err: any) {
      console.error('Error fetching subjects:', err);
      res.status(500).json({ error: 'Failed to fetch subjects' });
    }
  });

  // Create subject - restricted to super_admin & school_admin
  app.post('/api/subjects', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Only super_admin and school_admin can create subjects
      if (user.role !== 'super_admin' && user.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { name, code, schoolId: bodySchoolId } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Subject name is required' });
      }

      const finalSchoolId = user.role === 'super_admin' && bodySchoolId ? Number(bodySchoolId) : null;

      const [newSubject] = await db
        .insert(subjects)
        .values({
          schoolId: finalSchoolId,
          name: name.trim(),
          code: code ? code.trim() : undefined,
        })
        .returning();

      if (user.role === 'school_admin' && user.schoolId) {
        await db.insert(schoolSubjects).values({
          schoolId: user.schoolId,
          subjectId: newSubject.id,
          status: 'pending',
        });
      } else if (user.role === 'super_admin' && finalSchoolId) {
        await db.insert(schoolSubjects).values({
          schoolId: finalSchoolId,
          subjectId: newSubject.id,
          status: 'pending',
        });
      }

      res.status(201).json({
        ...newSubject,
        schoolId: newSubject.schoolId ?? null,
        status: user.role === 'school_admin' && user.schoolId ? 'pending' : undefined,
      });
    } catch (err: any) {
      console.error('Error creating subject:', err);
      res.status(500).json({ error: 'Failed to create subject' });
    }
  });

  // Update subject - restricted to super_admin & school_admin
  app.put('/api/subjects/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Only super_admin and school_admin can update subjects
      if (user.role !== 'super_admin' && user.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const subjectId = Number(req.params.id);
      if (!subjectId) return res.status(400).json({ error: 'Invalid subject ID' });

      const [subject] = await db.select().from(subjects).where(eq(subjects.id, subjectId));
      if (!subject) return res.status(404).json({ error: 'Subject not found' });

      // Check access: school_admin can only update subjects in their school
      if (user.role === 'school_admin' && subject.schoolId !== user.schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { name, code } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Subject name is required' });
      }

      const [updatedSubject] = await db
        .update(subjects)
        .set({
          name: name.trim(),
          code: code ? code.trim() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(subjects.id, subjectId))
        .returning();

      res.json(updatedSubject);
    } catch (err: any) {
      console.error('Error updating subject:', err);
      res.status(500).json({ error: 'Failed to update subject' });
    }
  });

  // Delete subject - restricted to super_admin & school_admin
  app.delete('/api/subjects/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Only super_admin and school_admin can delete subjects
      if (user.role !== 'super_admin' && user.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const subjectId = Number(req.params.id);
      if (!subjectId) return res.status(400).json({ error: 'Invalid subject ID' });

      const [subject] = await db.select().from(subjects).where(eq(subjects.id, subjectId));
      if (!subject) return res.status(404).json({ error: 'Subject not found' });

      // Check access: school_admin can only delete subjects in their school
      if (user.role === 'school_admin' && subject.schoolId !== user.schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await db.delete(schoolSubjects).where(eq(schoolSubjects.subjectId, subjectId));
      await db.delete(subjects).where(eq(subjects.id, subjectId));

      res.json({ success: true, message: 'Subject deleted' });
    } catch (err: any) {
      console.error('Error deleting subject:', err);
      res.status(500).json({ error: 'Failed to delete subject' });
    }
  });

  app.post('/api/schools/:schoolId/subjects/:subjectId/approve', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.role !== 'super_admin' && user.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = Number(req.params.schoolId);
      const subjectId = Number(req.params.subjectId);
      if (!schoolId || !subjectId) return res.status(400).json({ error: 'Invalid subject or school ID' });

      if (user.role === 'school_admin' && user.schoolId !== schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const existing = await db.select().from(schoolSubjects).where(and(eq(schoolSubjects.schoolId, schoolId), eq(schoolSubjects.subjectId, subjectId)));
      if (existing[0]) {
        const [updated] = await db.update(schoolSubjects)
          .set({ status: 'approved', updatedAt: new Date() })
          .where(and(eq(schoolSubjects.schoolId, schoolId), eq(schoolSubjects.subjectId, subjectId)))
          .returning();
        return res.json(updated);
      }

      const [created] = await db.insert(schoolSubjects).values({ schoolId, subjectId, status: 'approved' }).returning();
      res.status(201).json(created);
    } catch (err: any) {
      console.error('Error approving subject:', err);
      res.status(500).json({ error: 'Failed to approve subject' });
    }
  });

  app.post('/api/schools/:schoolId/subjects/:subjectId/reject', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.role !== 'super_admin' && user.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = Number(req.params.schoolId);
      const subjectId = Number(req.params.subjectId);
      if (!schoolId || !subjectId) return res.status(400).json({ error: 'Invalid subject or school ID' });

      if (user.role === 'school_admin' && user.schoolId !== schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const existing = await db.select().from(schoolSubjects).where(and(eq(schoolSubjects.schoolId, schoolId), eq(schoolSubjects.subjectId, subjectId)));
      if (existing[0]) {
        const [updated] = await db.update(schoolSubjects)
          .set({ status: 'rejected', updatedAt: new Date() })
          .where(and(eq(schoolSubjects.schoolId, schoolId), eq(schoolSubjects.subjectId, subjectId)))
          .returning();
        return res.json(updated);
      }

      const [created] = await db.insert(schoolSubjects).values({ schoolId, subjectId, status: 'rejected' }).returning();
      res.status(201).json(created);
    } catch (err: any) {
      console.error('Error rejecting subject:', err);
      res.status(500).json({ error: 'Failed to reject subject' });
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
          subject: evaluations.subject,
          title: evaluations.title,
          coefficient: evaluations.coefficient,
          maxScore: evaluations.maxScore,
          date: evaluations.date,
          createdAt: evaluations.createdAt,
          schoolId: classes.schoolId,
        })
        .from(evaluations)
        .innerJoin(classes, eq(evaluations.classId, classes.id))
        .innerJoin(teachers, eq(evaluations.teacherId, teachers.id))
        .innerJoin(users, eq(teachers.userId, users.id));

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
    console.log('TRACE /api/evaluations handler ENTRY', {
      path: req.path,
      method: req.method,
      headers: {
        'x-simulated-role': req.headers['x-simulated-role'],
        'x-simulated-uid': req.headers['x-simulated-uid'],
        'x-simulated-school-id': req.headers['x-simulated-school-id'],
        'content-type': req.headers['content-type'],
      },
    });

    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      // Prevent parents from creating evaluations
      const [requestingUser] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (requestingUser && requestingUser.role === 'parent') {
        return res.status(403).json({ error: 'Parents are not allowed to create evaluations' });
      }
      const { classId, teacherId, subject, title, coefficient, maxScore, date } = req.body;
      if (!classId || !subject || !title || !date) {
        return res.status(400).json({ error: 'Missing mandatory assessment data' });
      }

      // Load effective user context (including simulated header schoolId fallback when needed)
      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Load the class to check its school
      const [classRecord] = await db.select().from(classes).where(eq(classes.id, parseInt(classId)));
      if (!classRecord) return res.status(404).json({ error: 'Class not found' });

      // School admin can only create evaluations for classes in their own school
      if (user.role !== 'super_admin') {
        if (user.schoolId) {
          // Allow when class belongs to the same school, or when the class is a global class
          // that has been approved for this school (see isApprovedClassForSchool helper).
          const allowedForSchool = classRecord.schoolId === user.schoolId || await isApprovedClassForSchool(parseInt(classId), user.schoolId);
          if (!allowedForSchool) {
            return res.status(403).json({ error: 'Cannot create evaluation for class in another school' });
          }
        }
      }

      // Automatically determine teacher Id if not explicitly provided
      let resolvedTeacherId = teacherId ? parseInt(teacherId) : null;
      const [dbUser] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      console.log('TRACE /api/evaluations dbUser lookup result', { reqUser: req.user, dbUser });
      if (!dbUser) {
        console.log('TRACE /api/evaluations returning 404 at dbUser check', { reqUser: req.user });
        return res.status(404).json({ error: 'User not found' });
      }

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

      const normalizedSubject = String(subject).trim();
      let approvalSchoolId = classRecord.schoolId;
      let resolvedSchoolClassId: number | null = null;
      let resolvedSchoolClassSchoolId: number | null = null;
      let approvalSource = 'class';

      if (approvalSchoolId == null) {
        approvalSource = 'request';
        if (user.schoolId != null) {
          const [approvedClass] = await db.select().from(schoolClasses).where(
            and(
              eq(schoolClasses.classId, parseInt(classId)),
              eq(schoolClasses.schoolId, user.schoolId),
              eq(schoolClasses.status, 'approved')
            )
          );
          if (!approvedClass) {
            console.error('ERROR /api/evaluations invalid school context for class', {
              classId: parseInt(classId),
              userSchoolId: user.schoolId,
              note: 'No approved school_classes entry found for the current user school',
            });
            return res.status(403).json({ error: 'Invalid school context for this class' });
          }
          approvalSchoolId = user.schoolId;
          resolvedSchoolClassId = approvedClass.id;
          resolvedSchoolClassSchoolId = approvedClass.schoolId;
        } else {
          const approvedClasses = await db.select().from(schoolClasses).where(
            and(
              eq(schoolClasses.classId, parseInt(classId)),
              eq(schoolClasses.status, 'approved')
            )
          );
          if (approvedClasses.length === 0) {
            console.error('ERROR /api/evaluations missing approved school context for global class', {
              classId: parseInt(classId),
            });
            return res.status(403).json({ error: 'Cannot determine school context for this class' });
          }
          if (approvedClasses.length > 1) {
            console.error('ERROR /api/evaluations ambiguous school context for global class', {
              classId: parseInt(classId),
              approvedSchoolIds: approvedClasses.map((row) => row.schoolId),
            });
            return res.status(400).json({ error: 'Ambiguous school context for this class' });
          }
          const [approvedClass] = approvedClasses;
          approvalSchoolId = approvedClass.schoolId;
          resolvedSchoolClassId = approvedClass.id;
          resolvedSchoolClassSchoolId = approvedClass.schoolId;
        }
      }

      console.log('DEBUG /api/evaluations school context', {
        classId: parseInt(classId),
        subject: normalizedSubject,
        classSchoolId: classRecord.schoolId,
        resolvedSchoolClassId,
        resolvedSchoolClassSchoolId,
        userSchoolId: user.schoolId,
        approvalSchoolId,
        approvalSource,
      });

      const approvedSubject = await isApprovedSubjectForSchool(normalizedSubject, approvalSchoolId);

      if (!approvedSubject) {
        return res.status(400).json({ error: 'La matière n’est pas approuvée pour cette école' });
      }

      const result = await db.insert(evaluations).values({
        classId: parseInt(classId),
        teacherId: resolvedTeacherId,
        subject: normalizedSubject,
        title,
        coefficient: coefficient ? parseInt(coefficient) : 1,
        maxScore: maxScore ? parseInt(maxScore) : 20,
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
      
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
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

          query = query.where(eq(students.parentId, parentProfile.id)) as any;
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
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch grades list' });
    }
  });

  app.post('/api/grades', requireAuth, async (req: AuthRequest, res) => {
    try {
      console.log('POST /api/grades payload', req.body);
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      // Prevent parents from recording/updating grades
      const [requestingUser] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (requestingUser && requestingUser.role === 'parent') {
        return res.status(403).json({ error: 'Parents are not allowed to record or update grades' });
      }
      const { evaluationId, studentId, score, remarks } = req.body;
      if (!evaluationId || !studentId || score === undefined) {
        return res.status(400).json({ error: 'Missing grade details' });
      }

      const normalizedScore = typeof score === 'string' ? score.trim() : score;
      if (normalizedScore === '' || normalizedScore === null || normalizedScore === undefined) {
        return res.status(400).json({ error: 'La note est requise' });
      }

      // Load user and validate school permission
      const [user] = await db.select().from(users).where(eq(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Load the evaluation to verify permissions and existence
      const [evaluation] = await db.select().from(evaluations).where(eq(evaluations.id, parseInt(evaluationId)));
      if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });

      const scoreValidation = validateGradeScore(normalizedScore, evaluation.maxScore);
      if (!scoreValidation.isValid) {
        return res.status(400).json({ error: scoreValidation.error });
      }

      // Load the student to check their school
      const [student] = await db.select().from(students).where(eq(students.id, parseInt(studentId)));
      if (!student) return res.status(404).json({ error: 'Student not found' });
      console.log('Grade save details', {
        evaluationId,
        studentId,
        score,
        remarks,
        studentSchoolId: student.schoolId,
        userSchoolId: user.schoolId,
        evaluationSchoolId: evaluation.schoolId,
      });

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

      // Teachers can only record grades for their own evaluations and cannot edit existing grades
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
        const message = user.role === 'teacher'
          ? 'Cette note a déjà été saisie. Pour toute modification, veuillez contacter le school admin.'
          : 'Cette note a déjà été saisie. Pour toute modification, veuillez contacter le super admin.';
        return res.status(403).json({ error: message });
      }

      let savedGrade;
      if (existing.length > 0) {
        const updated = await db
          .update(grades)
          .set({ score: String(score), remarks, editCount: (existing[0].editCount ?? 0) })
          .where(eq(grades.id, existing[0].id))
          .returning();
        savedGrade = updated[0];
      } else {
        const inserted = await db.insert(grades).values({
          evaluationId: parseInt(evaluationId),
          studentId: parseInt(studentId),
          score: String(score),
          remarks,
          editCount: 0,
        }).returning();
        savedGrade = inserted[0];
      }

      // Create simulated push notification for parent of this student
      const [evaluationRecord] = await db.select().from(evaluations).where(eq(evaluations.id, parseInt(evaluationId)));
      if (evaluationRecord) {
        const [parentRecord] = student.parentId != null
          ? await db.select().from(parents).where(eq(parents.id, student.parentId))
          : [null];
        if (parentRecord) {
          await db.insert(notifications).values({
            userId: parentRecord.userId,
            title: `Nouvelle note pour ${student.firstName}`,
            body: `${student.firstName} a obtenu la note de ${score}/${evaluationRecord.maxScore} en ${evaluationRecord.subject} pour : ${evaluationRecord.title}.`,
            type: 'grade',
          });
        }
      }

      res.status(200).json(savedGrade);
    } catch (err: any) {
      console.error('POST /api/grades error:', err);
      console.error(err?.stack || err);
      res.status(500).json({ error: err?.message || 'Failed to record student grade' });
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
          .select({ id: parents.id })
          .from(parents)
          .where(eq(parents.userId, user.id));

        if (parentRows.length > 0) {
          const parentProfileId = parentRows[0].id;
          const ownedStudents = await db
            .select({ id: students.id })
            .from(students)
            .where(eq(students.parentId, parentProfileId));

          parentChildIds = ownedStudents.map((studentRow) => studentRow.id).filter((id): id is number => id != null);
        } else {
          parentChildIds = [];
        }
      }

      const normalizeGenderValue = (value: unknown): 'male' | 'female' | 'unknown' => {
        if (value == null) return 'unknown';
        const normalized = String(value).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (['m', 'male', 'masculin', 'homme', 'garcon', 'garcons', 'boy', 'boys'].includes(normalized)) return 'male';
        if (['f', 'female', 'feminin', 'feminine', 'femme', 'fille', 'filles', 'girl', 'girls'].includes(normalized)) return 'female';
        return 'unknown';
      };

      // Get stats
      let studentCountQuery = db.select({ count: sql<number>`count(*)::integer` }).from(students);
      let studentGenderQuery = db.select({ gender: students.gender }).from(students);
      let absenceCountQuery = db.select({ count: sql<number>`count(*)::integer` }).from(absences);
      let classCountQuery = db.select({ count: sql<number>`count(distinct ${classes.id})::integer` }).from(classes);
      let chartClassesQuery = db.select({ id: classes.id, name: classes.name }).from(classes);
      let chartStudentsQuery = db.select({ classId: students.classId }).from(students);
      let chartAbsencesQuery = db.select({ classId: absences.classId }).from(absences);

      if (user.role === 'parent') {
        if (!parentChildIds || parentChildIds.length === 0) {
          return res.json({ stats: { totalStudents: 0, totalAbsences: 0, totalClasses: 0, attendanceRate: 100, maleStudents: 0, femaleStudents: 0, unknownGenderStudents: 0 }, recentAbsences: [], recentGrades: [] });
        }

        studentCountQuery = studentCountQuery.where(inArray(students.id, parentChildIds)) as any;
        studentGenderQuery = studentGenderQuery.where(inArray(students.id, parentChildIds)) as any;
        chartStudentsQuery = chartStudentsQuery.where(inArray(students.id, parentChildIds)) as any;
        chartAbsencesQuery = chartAbsencesQuery.where(inArray(absences.studentId, parentChildIds)) as any;
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
        studentGenderQuery = studentGenderQuery.where(eq(students.schoolId, schoolFilter)) as any;
        chartClassesQuery = chartClassesQuery.where(eq(classes.schoolId, schoolFilter)) as any;
        chartStudentsQuery = chartStudentsQuery.where(eq(students.schoolId, schoolFilter)) as any;
        classCountQuery = classCountQuery.where(eq(classes.schoolId, schoolFilter)) as any;
        // For absences, filter through students
        absenceCountQuery = db
          .select({ count: sql<number>`count(*)::integer` })
          .from(absences)
          .innerJoin(students, eq(absences.studentId, students.id))
          .where(eq(students.schoolId, schoolFilter)) as any;
        chartAbsencesQuery = db
          .select({ classId: absences.classId })
          .from(absences)
          .innerJoin(students, eq(absences.studentId, students.id))
          .where(eq(students.schoolId, schoolFilter)) as any;
      }

      const studentCountResult = await studentCountQuery;
      const studentGenderRows = await studentGenderQuery;
      const absenceCountResult = await absenceCountQuery;
      const classCountResult = await classCountQuery;
      const chartClassesRows = await chartClassesQuery;
      const chartStudentsRows = await chartStudentsQuery;
      const chartAbsencesRows = await chartAbsencesQuery;

      console.log('Nombre d\'élèves :', studentCountResult[0]?.count || 0);
      console.log('Premier élève :', studentGenderRows[0]);
      console.log('Valeurs de genre observées :', studentGenderRows.slice(0, 10).map((row) => row.gender));

      const totalStudents = studentCountResult[0]?.count || 0;
      const genderCounts = studentGenderRows.reduce((acc, row) => {
        const normalized = normalizeGenderValue(row.gender);
        if (normalized === 'male') acc.maleStudents += 1;
        else if (normalized === 'female') acc.femaleStudents += 1;
        else acc.unknownGenderStudents += 1;
        return acc;
      }, { maleStudents: 0, femaleStudents: 0, unknownGenderStudents: 0 });
      const totalAbsences = absenceCountResult[0]?.count || 0;
      const totalClasses = classCountResult[0]?.count || 0;

      const studentsByClass = chartStudentsRows.reduce((acc: Map<number, number>, row: any) => {
        if (row.classId != null) {
          acc.set(row.classId, (acc.get(row.classId) || 0) + 1);
        }
        return acc;
      }, new Map<number, number>());

      const absencesByClass = chartAbsencesRows.reduce((acc: Map<number, number>, row: any) => {
        if (row.classId != null) {
          acc.set(row.classId, (acc.get(row.classId) || 0) + 1);
        }
        return acc;
      }, new Map<number, number>());

      const chartData = (chartClassesRows || []).map((classRow: any) => {
        const studentCount = studentsByClass.get(classRow.id) || 0;
        const absenceCount = absencesByClass.get(classRow.id) || 0;
        const taux = studentCount > 0 ? Math.max(0, 100 - (absenceCount / (studentCount * 20) * 100)) : 100;
        return { name: classRow.name, taux: Number((Math.round(taux * 100) / 100).toFixed(2)) };
      });

      console.log('Classes retournées :', chartClassesRows);
      console.log('Élèves par classe :', Array.from(studentsByClass.entries()));
      console.log('Données envoyées au graphique :', chartData);

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
        maleStudents: genderCounts.maleStudents,
        femaleStudents: genderCounts.femaleStudents,
        unknownGenderStudents: genderCounts.unknownGenderStudents,
      };

      console.log('Statistiques envoyées :', stats);

      res.json({
        stats,
        recentAbsences,
        recentGrades,
        chartData,
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
    // Print registered routes for debugging
    try {
      const routes: string[] = [];
      (app as any)._router.stack.forEach((middleware: any) => {
        if (middleware.route) {
          // routes registered directly on the app
          const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
          routes.push(`${methods} ${middleware.route.path}`);
        } else if (middleware.name === 'router' && middleware.handle && middleware.handle.stack) {
          // router middleware
          middleware.handle.stack.forEach((handler: any) => {
            const route = handler.route;
            if (route) {
              const methods = Object.keys(route.methods).join(',').toUpperCase();
              routes.push(`${methods} ${route.path}`);
            }
          });
        }
      });
      console.log('Registered routes:', routes.join(' | '));
    } catch (e) {
      console.error('Failed to list registered routes:', e);
    }
    console.log(`Server starting on http://localhost:${PORT}`);
  });
}

startServer();

