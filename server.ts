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
const fetch = globalThis.fetch;
import path from 'path';
import { promises as fsPromises } from 'fs';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import rateLimit from 'express-rate-limit';
import { db } from './src/db/index.ts';
import { seedDatabaseIfEmpty, ensureEducationStructureSchema, ensureSchoolClassesTableExists, ensureClassHomeroomAssignmentsTableExists, ensureUsersTableSchema, ensureUserSchoolsTableExists, ensureSchoolsTableSchema, ensureTokenBlacklistTableExists, ensureStudentAcademicYearStatusesTableExists, ensureStudentMatriculesSchema, ensureAbsenceDeclarationsSchema, ensureAbsenceTeachingAssignmentsSchema } from './src/db/helpers.ts';
import { requireAuth, AuthRequest, assertSimulatedAuthConfiguration } from './src/middleware/auth.ts';
import { canonicalizeUserPhone, handleLocalLogin } from './src/lib/localLogin.ts';
import { getNewPasswordPolicyError } from './src/lib/passwordPolicy.ts';
import { getJwtSecret, verifyJwt } from './src/lib/jwt.ts';
import { calculateEvaluationScoreBounds, validateGradeScore } from './src/lib/gradeValidation.ts';
import { buildGradeNotificationMessage } from './src/lib/buildGradeNotificationMessage.ts';
import { getGradeNotificationDedupeKey } from './src/lib/gradeNotification.ts';
import { getEmailUniquenessScope, normalizeEmail } from './src/lib/emailUniqueness.ts';
import { generateTemporaryLocalPassword, hashLocalPassword } from './src/lib/localPassword.ts';
import { registerBulletinGenerateRoute } from './src/lib/bulletinSnapshotService.ts';
import { registerBulletinReadRoutes } from './src/lib/bulletinReadApi.ts';
import { registerBulletinPdfRoute } from './src/lib/bulletinPdfApi.ts';
import { registerClassRankingRoute } from './src/lib/classRankingApi.ts';
import { registerClassSubjectPivotRoute } from './src/lib/classSubjectPivotApi.ts';
import { registerParentSchoolAdminWhatsAppRoute } from './src/lib/parentSchoolAdminWhatsAppApi.ts';
import { registerAccountingRoutes } from './src/lib/accountingApi.ts';
import {
  schools,
  academicYears,
  users,
  userSchools,
  localAuths,
  tokenBlacklist,
  teachers,
  teacherSubjects,
  classHomeroomAssignments,
  parents,
  classes,
  classTeachers,
  teacherClassSubjects,
  students,
  studentAcademicYearStatuses,
  subjectTypes,
  subjects,
  schoolSubjects,
  schoolClasses,
  schoolPeriodTypeApprovals,
  classSuccessions,
  classProgressions,
  classExamConfigurations,
  examResults,
  bulletins,
  bulletinLines,
  evaluations,
  grades,
  absences,
  absenceDeclarations,
  lateArrivals,
  absenceJustifications,
  absenceControls,
  notificationAttachments,
  notifications,
  auditEvents,
  accountingCategories,
  accountingFeeDefinitions,
  accountingScheduleTemplates,
  accountingTariffs,
  financialObligations,
  financialPayments,
  schoolTerms,
  levels,
  cycles,
  schoolCycles,
  cyclePeriodTemplates,
  evaluationParticipations,
  userLoginEvents,
} from './src/db/schema.ts';
import { eq, and, or, sql, desc, notInArray, inArray, ilike, ne } from 'drizzle-orm';
import studentAccess from './src/lib/studentAccess.ts';
import { getTeacherHomeroomScopes, getTeacherReadableClassIds, getTeacherReadableStudentIds } from './src/lib/homeroomAccess.ts';
import { canTeacherReadEvaluation, canTeacherWriteEvaluation, getTeacherAuthorizationScope, getTeacherReadableStudentIds as getScopedTeacherReadableStudentIds } from './src/lib/teacherAuthorization.ts';
import { resolveClassCreationSchoolId } from './src/lib/classSchoolValidation.ts';
import { getFallbackSchoolIdsForActor } from './src/lib/authSchoolMembership.ts';
import { isStudentAcademicYearStatus } from './src/lib/studentAcademicYearStatus.ts';
import { filterAvailableSchoolTerms, getPeriodTypeShortName, getSchoolPeriodTypeStates, inferLevelCodeFromClassName, resolveCycleForClass, resolveSchoolTermForClass, validateSchoolCycle } from './src/lib/educationStructure.ts';
import { PARENT_IMPORT_HEADERS, validateParentImportRow } from './src/lib/parentImportValidation.ts';
import { normalizeClassProgressionCode } from './src/lib/classProgression.ts';
import { isExamResultStatus, isExamType } from './src/lib/examDecision.ts';
import { selectPreferredClassExamConfiguration } from './src/lib/classExamConfiguration.ts';
import { normalizeFirstName } from './src/lib/studentImport.ts';
import { canTeacherAccessAbsence } from './src/lib/absenceTeachingAccess.ts';
import { getParentChildStudentIds } from './src/lib/parentStudentAccess.ts';
import { deleteStoredFile, getFileStorageConfig, persistUploadedFile, readStoredFile, resolveStoredLocalPath, sanitizeFileName, streamStoredFileToResponse } from './src/lib/fileStorage.ts';

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const findActiveClassExamConfiguration = async ({
  classId,
  academicYearId,
  examType,
  schoolId,
}: {
  classId: number;
  academicYearId: number;
  examType: string;
  schoolId?: number | null;
}) => {
  const schoolCondition = schoolId == null
    ? sql`${classExamConfigurations.schoolId} IS NULL`
    : or(eq(classExamConfigurations.schoolId, schoolId), sql`${classExamConfigurations.schoolId} IS NULL`);
  const configurations = await db
    .select()
    .from(classExamConfigurations)
    .where(and(
      eq(classExamConfigurations.classId, classId),
      eq(classExamConfigurations.academicYearId, academicYearId),
      eq(classExamConfigurations.examType, examType),
      eq(classExamConfigurations.isActive, true),
      schoolCondition,
    ))
  return selectPreferredClassExamConfiguration(configurations, schoolId)[0] ?? null;
};

export const SCHOOL_LOGO_MAX_SIZE = 5 * 1024 * 1024;

export const isSupportedSchoolLogo = (file: { mimetype?: string; originalname?: string }): boolean => {
  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  const mimetype = String(file.mimetype || '');
  return (mimetype === 'image/png' && extension === '.png')
    || (mimetype === 'image/jpeg' && (extension === '.jpg' || extension === '.jpeg'));
};

export const buildSchoolLogoRelativePath = (fileName: string): string => path.posix.join('school-logos', path.basename(fileName));

export function resolveAbsenceJustificationStorageDirs() {
  const config = getFileStorageConfig();
  const configuredUploadRoot = (process.env.UPLOADS_DIR || '').trim();
  const primaryRoot = configuredUploadRoot ? path.resolve(configuredUploadRoot) : config.localRoot;
  const primaryDir = path.resolve(primaryRoot, 'absence-justifications');
  const legacyDir = path.resolve(process.cwd(), 'uploads', 'absence-justifications');
  const candidates = Array.from(new Set([primaryDir, legacyDir].filter(Boolean)));
  return { primaryDir, legacyDir, candidates, storageMode: config.mode };
}

export async function resolveAbsenceJustificationFilePath(fileName: string): Promise<string | null> {
  const safeFileName = path.basename(String(fileName || ''));
  if (!safeFileName) return null;

  const normalizedCandidates = resolveAbsenceJustificationStorageDirs().candidates;
  for (const dir of normalizedCandidates) {
    const candidate = path.resolve(dir, safeFileName);
    const rootDir = path.resolve(dir);
    const insideRoot = candidate === rootDir || candidate.startsWith(rootDir + path.sep);
    if (!insideRoot) continue;

    try {
      await fsPromises.access(candidate);
      return candidate;
    } catch {
      // Keep trying the remaining fallback locations.
    }
  }

  const legacyFallback = await resolveStoredLocalPath('absence-justifications', safeFileName);
  return legacyFallback ?? null;
}

function toUserDto(user: any) {
  return {
    id: user.id,
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    schoolId: user.schoolId,
    academicYearId: user.academicYearId,
    phone: user.phone,
    gender: user.gender,
  };
}

async function logIfTeacherUserMismatch(userId: number | null | undefined, teacherId: number | null | undefined) {
  try {
    if (!userId || !teacherId) return;
    const [u] = await db.select({ id: users.id, schoolId: users.schoolId }).from(users).where(eq(users.id, userId));
    const [t] = await db.select({ id: teachers.id, schoolId: teachers.schoolId }).from(teachers).where(eq(teachers.id, teacherId));
    if (!u || !t) return;
    if (t.schoolId != null && (u.schoolId == null || u.schoolId !== t.schoolId)) {
      console.warn('Teacher/user school mismatch detected.');
    }
  } catch {
    console.warn('Teacher/user school mismatch verification failed.');
  }
}

async function findExistingUsersByEmail(email: string | null | undefined) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];

  const allUsers = await db.select().from(users);
  return allUsers.filter((row: any) => normalizeEmail(row.email) === normalizedEmail);
}

// Find existing user by email AND schoolId (for per-school uniqueness)
async function findExistingUsersByEmailAndSchool(email: string | null | undefined, schoolId: number | null | undefined) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || schoolId == null) return [];

  const allUsers = await db.select().from(users);
  return allUsers.filter((row: any) => normalizeEmail(row.email) === normalizedEmail && Number(row.schoolId) === Number(schoolId));
}

const DUPLICATE_EMAIL_ERROR = {
  code: 'EMAIL_ALREADY_IN_USE',
  message: 'Cette adresse e-mail est déjà utilisée. Veuillez utiliser une autre adresse e-mail.',
};

function isUsersEmailUniqueViolation(error: any) {
  if (error?.code !== '23505' && error?.cause?.code !== '23505') return false;
  const constraint = String(error?.constraint || error?.cause?.constraint || '').toLowerCase();
  const detail = String(error?.detail || error?.cause?.detail || '').toLowerCase();
  return constraint.includes('email') || (detail.includes('users') && detail.includes('email'));
}

function sendDuplicateEmailResponse(res: any) {
  return res.status(409).json({ error: DUPLICATE_EMAIL_ERROR.message, code: DUPLICATE_EMAIL_ERROR.code });
}

const DUPLICATE_PHONE_ERROR = {
  code: 'PHONE_ALREADY_IN_USE',
  message: 'Ce numéro de téléphone est déjà utilisé par un autre compte.',
};

function isUsersPhoneUniqueViolation(error: any) {
  if (error?.code !== '23505' && error?.cause?.code !== '23505') return false;
  const constraint = String(error?.constraint || error?.cause?.constraint || '').toLowerCase();
  const detail = String(error?.detail || error?.cause?.detail || '').toLowerCase();
  return constraint.includes('phone') || (detail.includes('users') && detail.includes('phone'));
}

function sendDuplicatePhoneResponse(res: any) {
  return res.status(409).json({ error: DUPLICATE_PHONE_ERROR.message, code: DUPLICATE_PHONE_ERROR.code });
}

function sendInvalidPhoneResponse(res: any) {
  return res.status(400).json({ error: 'Un numéro de téléphone valide est obligatoire.', code: 'PHONE_REQUIRED' });
}

async function findExistingUsersByPhone(phone: string, excludeUserId?: number) {
  const canonicalPhone = canonicalizeUserPhone(phone);
  if (!canonicalPhone) return [];

  const matchingUsers = await db.select().from(users).where(eq(users.phone, canonicalPhone));
  return matchingUsers.filter((row: any) => (
    (excludeUserId == null || Number(row.id) !== excludeUserId)
  ));
}

// Resolved actor shape used by business routes.
type ResolvedActorRole = 'super_admin' | 'school_admin' | 'teacher' | 'parent' | 'surveillant' | string;

interface ResolvedActor {
  id?: number | null;
  uid: string;
  email?: string | null;
  name?: string | null;
  role: ResolvedActorRole;
  schoolId: number | null;
  academicYearId?: number | null;
  simulated?: boolean;
}

// Helper to resolve actor with fallback to simulated profile in dev
export function hasSchoolTermDateOverlap(startDateA: string | null | undefined, endDateA: string | null | undefined, startDateB: string | null | undefined, endDateB: string | null | undefined): boolean {
  if (!startDateA || !endDateA || !startDateB || !endDateB) return false;
  return startDateA <= endDateB && endDateA >= startDateB;
}

export function findConflictingSchoolTerm(existingTerms: Array<{ id?: number | null; academicYearId?: number | null; schoolId?: number | null; cycleId?: number | null; startDate?: string | null; endDate?: string | null }>, candidate: { id?: number | null; academicYearId?: number | null; schoolId?: number | null; cycleId?: number | null; startDate?: string | null; endDate?: string | null }, ignoreId?: number | null) {
  return existingTerms.find((term) => {
    if (ignoreId != null && term.id != null && term.id === ignoreId) return false;
    if (term.academicYearId != null && candidate.academicYearId != null && term.academicYearId !== candidate.academicYearId) return false;
    if (term.schoolId != null && candidate.schoolId != null && term.schoolId !== candidate.schoolId) return false;
    if (term.schoolId == null && candidate.schoolId != null) return false;
    if (term.schoolId != null && candidate.schoolId == null) return false;
    if (term.cycleId != null && candidate.cycleId != null && term.cycleId !== candidate.cycleId) return false;
    if (term.cycleId == null && candidate.cycleId != null) return false;
    if (term.cycleId != null && candidate.cycleId == null) return false;
    return hasSchoolTermDateOverlap(candidate.startDate ?? null, candidate.endDate ?? null, term.startDate ?? null, term.endDate ?? null);
  }) ?? null;
}

export async function resolveActor(req: AuthRequest): Promise<ResolvedActor | null> {
  if (!req.user) return null;

  const role = req.user.role;
  if (!role) return null;
  const uid = req.user.uid;

  // In simulated mode, resolve a matching DB user first. If none exists yet,
  // fall back to the simulated profile so tokenless development flows still work.
  if (req.user.simulated) {
    let dbUser: any = null;
    const rowsByUid = await db.select().from(users).where(eq(users.uid, uid));
    if (rowsByUid.length > 0) dbUser = rowsByUid[0];

    if (!dbUser && req.user.email) {
      const rowsByEmail = await db.select().from(users).where(eq(users.email, req.user.email));
      if (rowsByEmail.length > 0) dbUser = rowsByEmail[0];
    }

    if (dbUser) {
      const resolvedSchoolId = req.user.schoolId ?? dbUser.schoolId ?? null;
      return { ...dbUser, role, schoolId: resolvedSchoolId, simulated: true } as ResolvedActor;
    }

    const simulatedActor: ResolvedActor = {
      uid,
      role,
      email: req.user.email ?? null,
      name: req.user.name ?? null,
      schoolId: req.user.schoolId ?? null,
      simulated: true,
    };

    if (simulatedActor.role === 'school_admin' && simulatedActor.schoolId == null) {
      return null;
    }

    return simulatedActor;
  }

  const [dbUser] = await db.select().from(users).where(eq(users.uid, uid));
  if (dbUser) {
    const resolvedSchoolId = await getActiveUserSchoolId(dbUser.id);
    const effectiveSchoolId = resolvedSchoolId ?? (role === 'teacher' ? dbUser.schoolId ?? null : null);
    if (role === 'school_admin' && effectiveSchoolId == null) {
      return null;
    }
    return { ...dbUser, role, schoolId: effectiveSchoolId } as ResolvedActor;
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

async function getActiveUserSchoolId(userId: number | null | undefined) {
  if (!userId) return null;

  const [row] = await db.select({ schoolId: userSchools.schoolId })
    .from(userSchools)
    .where(and(eq(userSchools.userId, userId), eq(userSchools.isActive, true)))
    .limit(1);

  return row?.schoolId ?? null;
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

async function syncTeacherSubjectAssignments(teacherId: number, schoolId: number, subjectIds: unknown) {
  if (!Array.isArray(subjectIds)) return null;
  const requestedIds = Array.from(new Set(subjectIds
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)));
  const approvedSubjects = requestedIds.length === 0
    ? []
    : await db.select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .leftJoin(schoolSubjects, and(
        eq(schoolSubjects.subjectId, subjects.id),
        eq(schoolSubjects.schoolId, schoolId),
        eq(schoolSubjects.status, 'approved'),
      ))
      .where(and(
        inArray(subjects.id, requestedIds),
        or(
          eq(subjects.schoolId, schoolId),
          eq(schoolSubjects.subjectId, subjects.id),
        ),
      ));

  await db.delete(teacherSubjects).where(and(
    eq(teacherSubjects.teacherId, teacherId),
    eq(teacherSubjects.schoolId, schoolId),
  ));
  if (approvedSubjects.length > 0) {
    await db.insert(teacherSubjects).values(approvedSubjects.map((subject) => ({
      teacherId,
      schoolId,
      subjectId: subject.id,
    })));
  }
  return approvedSubjects;
}

async function getTeacherTeachingClassIds(actor: AuthRequest['user'] & { schoolId?: number | null }): Promise<number[]> {
  const scope = await getTeacherAuthorizationScope(actor as any);
  return scope ? Array.from(scope.teachingClassIds) : [];
}

async function getTeacherReadableScopedClassIds(actor: AuthRequest['user'] & { schoolId?: number | null }): Promise<number[]> {
  const scope = await getTeacherAuthorizationScope(actor as any);
  return scope
    ? Array.from(new Set([...scope.teachingClassIds, ...scope.homeroomClassIds]))
    : [];
}

async function getTeacherTeachingAssignmentContext(actor: ResolvedActor) {
  const scope = await getTeacherAuthorizationScope(actor as any);
  if (!scope) return null;
  const assignments = await db.select().from(teacherClassSubjects).where(and(
    eq(teacherClassSubjects.teacherId, scope.teacherId),
    eq(teacherClassSubjects.schoolId, scope.schoolId),
    eq(teacherClassSubjects.isActive, true),
  ));
  return { ...scope, assignments };
}

async function ensureTeacherTeachingAssignment(
  actor: ResolvedActor,
  classId: number,
  subjectId: number,
  requestedAssignmentId?: number | null,
) {
  const context = await getTeacherTeachingAssignmentContext(actor);
  if (!context || !context.teachingClassIds.has(classId) || !context.subjectIds.has(subjectId)) return null;

  const existingActive = context.assignments.find((assignment) =>
    assignment.classId === classId && assignment.subjectId === subjectId,
  );
  if (existingActive) {
    return requestedAssignmentId == null || existingActive.id === requestedAssignmentId ? existingActive : null;
  }

  const [existing] = await db.select().from(teacherClassSubjects).where(and(
    eq(teacherClassSubjects.teacherId, context.teacherId),
    eq(teacherClassSubjects.schoolId, context.schoolId),
    eq(teacherClassSubjects.classId, classId),
    eq(teacherClassSubjects.subjectId, subjectId),
  ));
  if (existing) return null;

  if (requestedAssignmentId != null) return null;

  await db.insert(teacherClassSubjects).values({
    teacherId: context.teacherId,
    schoolId: context.schoolId,
    classId,
    subjectId,
    isActive: true,
  }).onConflictDoNothing({
    target: [
      teacherClassSubjects.teacherId,
      teacherClassSubjects.schoolId,
      teacherClassSubjects.classId,
      teacherClassSubjects.subjectId,
    ],
  });

  const [createdOrExisting] = await db.select().from(teacherClassSubjects).where(and(
    eq(teacherClassSubjects.teacherId, context.teacherId),
    eq(teacherClassSubjects.schoolId, context.schoolId),
    eq(teacherClassSubjects.classId, classId),
    eq(teacherClassSubjects.subjectId, subjectId),
  ));
  if (!createdOrExisting?.isActive) return null;
  return requestedAssignmentId == null || createdOrExisting.id === requestedAssignmentId
    ? createdOrExisting
    : null;
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

async function validateTeacherClassSubjectAssignments(schoolId: number, requested: unknown) {
  if (!Array.isArray(requested)) return null;
  const pairs = new Map<string, { classId: number; subjectId: number }>();
  for (const item of requested) {
    const classId = parsePositiveInteger((item as any)?.classId);
    const subjectId = parsePositiveInteger((item as any)?.subjectId);
    if (classId == null || subjectId == null || !(await isApprovedClassForSchool(classId, schoolId))) return null;
    const [subject] = await db.select({ id: subjects.id }).from(subjects)
      .leftJoin(schoolSubjects, and(
        eq(schoolSubjects.subjectId, subjects.id),
        eq(schoolSubjects.schoolId, schoolId),
        eq(schoolSubjects.status, 'approved'),
      ))
      .where(and(
        eq(subjects.id, subjectId),
        or(eq(subjects.schoolId, schoolId), eq(schoolSubjects.status, 'approved')),
      ));
    if (!subject) return null;
    pairs.set(`${classId}:${subjectId}`, { classId, subjectId });
  }
  return Array.from(pairs.values());
}

async function syncTeacherClassSubjectAssignments(
  teacherId: number,
  schoolId: number,
  assignments: Array<{ classId: number; subjectId: number }>,
) {
  const now = new Date();
  await db.update(teacherClassSubjects).set({ isActive: false, updatedAt: now }).where(and(
    eq(teacherClassSubjects.teacherId, teacherId),
    eq(teacherClassSubjects.schoolId, schoolId),
  ));
  for (const assignment of assignments) {
    const where = and(
      eq(teacherClassSubjects.teacherId, teacherId),
      eq(teacherClassSubjects.schoolId, schoolId),
      eq(teacherClassSubjects.classId, assignment.classId),
      eq(teacherClassSubjects.subjectId, assignment.subjectId),
    );
    const [existing] = await db.select().from(teacherClassSubjects).where(where);
    if (existing) {
      await db.update(teacherClassSubjects).set({ isActive: true, updatedAt: now }).where(eq(teacherClassSubjects.id, existing.id));
    } else {
      await db.insert(teacherClassSubjects).values({
        teacherId,
        schoolId,
        classId: assignment.classId,
        subjectId: assignment.subjectId,
        isActive: true,
        updatedAt: now,
      });
    }
  }
}

async function resolveApprovedSubjectForSchool(subjectName: string, targetSchoolId: number | null): Promise<{ subjectId: number; subjectName: string } | null> {
  const normalizedSubject = String(subjectName || '').trim();

  if (!normalizedSubject) {
    return null;
  }

  const normalizedSubjectMatch = sql`LOWER(TRIM(${subjects.name})) = LOWER(TRIM(${normalizedSubject}))`;

  if (targetSchoolId != null) {
    const [sameSchoolSubject] = await db
      .select({
        subjectId: subjects.id,
        subjectName: subjects.name,
      })
      .from(subjects)
      .where(
        and(
          eq(subjects.schoolId, targetSchoolId),
          normalizedSubjectMatch
        )
      );

    if (sameSchoolSubject) {
      return {
        subjectId: sameSchoolSubject.subjectId,
        subjectName: sameSchoolSubject.subjectName,
      };
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

    const result = approvedSubjectRows[0] ?? null;
    return result ? { subjectId: result.subjectId, subjectName: result.subjectName } : null;
  }

  const globalSubjectRows = await db
    .select({
      subjectId: subjects.id,
      subjectName: subjects.name,
    })
    .from(subjects)
    .where(
      and(
        sql`${subjects.schoolId} IS NULL`,
        normalizedSubjectMatch
      )
    );

  const result = globalSubjectRows[0] ?? null;
  return result ? { subjectId: result.subjectId, subjectName: result.subjectName } : null;
}

async function isApprovedSubjectForSchool(subjectName: string, targetSchoolId: number | null, subjectId?: number | null) {
  if (subjectId != null && targetSchoolId != null) {
    const [subject] = await db.select({ id: subjects.id, schoolId: subjects.schoolId })
      .from(subjects)
      .where(eq(subjects.id, subjectId));
    if (!subject) return false;
    if (subject.schoolId === targetSchoolId) return true;

    const [approval] = await db.select({ id: schoolSubjects.id })
      .from(schoolSubjects)
      .where(and(
        eq(schoolSubjects.subjectId, subjectId),
        eq(schoolSubjects.schoolId, targetSchoolId),
        eq(schoolSubjects.status, 'approved'),
      ));
    return !!approval;
  }
  const approvedSubject = await resolveApprovedSubjectForSchool(subjectName, targetSchoolId);
  return !!approvedSubject;
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
    await db.insert(auditEvents).values({
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

    console.log('Audit event persisted successfully.');
  } catch {
    console.error('Failed to persist audit event.');
  }
}

/**
 * Sign payload for internal server-to-server communication
 * Used for /api/internal/* endpoints
 * Returns: { signature: string, timestamp: string }
 */
function signInternalPayload(payload: any): { signature: string; timestamp: string } {
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
  if (!INTERNAL_SECRET || !INTERNAL_SECRET.trim()) {
    throw new Error('INTERNAL_SECRET environment variable is required for internal endpoint communication');
  }

  const timestamp = Date.now().toString();
  const body = JSON.stringify(payload);
  const messageToSign = `${body}${timestamp}`;
  const hmac = crypto.createHmac('sha256', INTERNAL_SECRET);
  hmac.update(messageToSign);
  const signature = hmac.digest('hex');
  return { signature, timestamp };
}

function verifyInternalJustificationAuth(req: any, res: any, next: any) {
  const signature = req.headers['x-internal-signature'];
  const timestamp = req.headers['x-internal-timestamp'];
  const internalSecret = process.env.INTERNAL_SECRET;
  const uploadedFile = req.file;

  if (!internalSecret || !internalSecret.trim() || typeof signature !== 'string' || typeof timestamp !== 'string') {
    return res.status(401).json({ error: 'Invalid internal authentication' });
  }

  const requestTime = Number(timestamp);
  if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'Expired internal authentication' });
  }

  if (!uploadedFile) {
    return res.status(400).json({ error: 'Missing justification file' });
  }

  const payload = {
    absenceId: String(req.body?.absenceId ?? ''),
    parentId: String(req.body?.parentId ?? ''),
    justificationReason: String(req.body?.justificationReason ?? ''),
    fileName: String(req.body?.fileName ?? ''),
    fileMimeType: String(req.body?.fileMimeType ?? ''),
    fileSize: String(req.body?.fileSize ?? ''),
    fileSha256: String(req.body?.fileSha256 ?? ''),
  };
  const actualFileSha256 = crypto.createHash('sha256').update(uploadedFile.buffer).digest('hex');
  if (
    payload.fileName !== uploadedFile.originalname ||
    payload.fileMimeType !== uploadedFile.mimetype ||
    payload.fileSize !== String(uploadedFile.size) ||
    payload.fileSha256 !== actualFileSha256
  ) {
    return res.status(401).json({ error: 'Invalid internal payload' });
  }

  const hmac = crypto.createHmac('sha256', internalSecret);
  hmac.update(`${JSON.stringify(payload)}${timestamp}`);
  const expectedSignature = hmac.digest('hex');
  if (signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return res.status(401).json({ error: 'Invalid internal authentication' });
  }

  return next();
}

function verifyInternalNotificationAttachmentRequest(req: any, res: any): boolean {
  const signature = req.headers['x-internal-signature'];
  const timestamp = req.headers['x-internal-timestamp'];
  const internalSecret = process.env.INTERNAL_SECRET;
  const attachmentId = String(req.params.attachmentId ?? '');

  if (!internalSecret || !internalSecret.trim() || typeof signature !== 'string' || typeof timestamp !== 'string') {
    res.status(401).json({ error: 'Invalid internal authentication' });
    return false;
  }

  const requestTime = Number(timestamp);
  if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) {
    res.status(401).json({ error: 'Expired internal authentication' });
    return false;
  }

  const payload = JSON.stringify({ attachmentId });
  const hmac = crypto.createHmac('sha256', internalSecret);
  hmac.update(`${payload}${timestamp}`);
  const expectedSignature = hmac.digest('hex');
  if (signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    res.status(401).json({ error: 'Invalid internal authentication' });
    return false;
  }

  return true;
}

export async function createApp() {
  assertSimulatedAuthConfiguration();
  const app = express();
  app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

  // JSON parsing middleware
  app.use(express.json());

  const storageConfig = getFileStorageConfig();
  const { primaryDir: uploadStorageDir, legacyDir: legacyUploadStorageDir, candidates: uploadStorageDirCandidates } = resolveAbsenceJustificationStorageDirs();
  const notificationUploadStorageDir = path.join(storageConfig.localRoot, 'notification-attachments');
  const schoolLogoUploadStorageDir = path.join(storageConfig.localRoot, 'school-logos');

  console.log('[uploads] storage initialized', {
    provider: storageConfig.mode,
    uploadEnv: process.env.UPLOADS_DIR || '(default)',
    fileStorageProvider: process.env.FILE_STORAGE_PROVIDER || '(default)',
    primaryDir: uploadStorageDir,
    legacyDir: legacyUploadStorageDir,
    candidates: uploadStorageDirCandidates,
    bucket: storageConfig.bucket || '(local-only)',
  });

  await fsPromises.mkdir(uploadStorageDir, { recursive: true });
  if (legacyUploadStorageDir !== uploadStorageDir) {
    await fsPromises.mkdir(legacyUploadStorageDir, { recursive: true }).catch((mkdirErr: any) => {
      console.warn('[uploads] could not create legacy absence justification directory', {
        legacyDir: legacyUploadStorageDir,
        error: mkdirErr?.message || String(mkdirErr),
      });
    });
  }
  await fsPromises.mkdir(notificationUploadStorageDir, { recursive: true });
  if (storageConfig.mode === 'local') {
    await fsPromises.mkdir(schoolLogoUploadStorageDir, { recursive: true });
  }

  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'production') {
    try {
      await ensureTokenBlacklistTableExists();
    } catch (err: any) {
      console.error('Failed to initialize token_blacklist table in test or production environment:', err?.message || err);
      throw err;
    }
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadStorageDir,
      filename: (_req, file, cb) => {
        const randomSuffix = crypto.randomBytes(16).toString('hex');
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${randomSuffix}-${safeName}`);
      },
    }),
    limits: {
      fileSize: 5 * 1024 * 1024, // 5Mo
    },
    fileFilter: (_req, file, cb) => {
      const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
      if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error('Unsupported file type'));
      }
      cb(null, true);
    },
  });

  const schoolLogoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: SCHOOL_LOGO_MAX_SIZE },
    fileFilter: (_req, file, cb) => {
      if (!isSupportedSchoolLogo(file)) {
        return cb(new Error('Only PNG and JPG/JPEG school logos are allowed'));
      }
      cb(null, true);
    },
  });

  const persistFilesToConfiguredStorage = async (files: any[], kind: 'absence-justifications' | 'notification-attachments') => {
    if (getFileStorageConfig().mode !== 's3') {
      return files;
    }

    const persistedFiles: any[] = [];
    try {
      for (const file of files) {
        if (!file) continue;
        const persisted = await persistUploadedFile(file, kind);
        persistedFiles.push({
          ...file,
          filename: persisted.storedReference,
          path: persisted.localPath || file.path,
          storageReference: persisted.storedReference,
          storageMode: 's3',
        });
      }
      return persistedFiles;
    } catch (error) {
      const cleanupResults = await Promise.allSettled([
        ...persistedFiles.map((file) => deleteStoredFile(file.storageReference, kind)),
        ...files.map((file: any) => file?.path ? fsPromises.rm(file.path, { force: true }) : Promise.resolve()),
      ]);
      cleanupResults.forEach((result) => {
        if (result.status === 'rejected') console.warn('Failed to clean partial uploaded file:', result.reason);
      });
      throw error;
    }
  };

  const handleJustificationUpload = (req: any, res: any, next: any) => {
    upload.array('files', 5)(req, res, async (err: any) => {
      if (!err) {
        const uploadedFiles = Array.isArray(req.files) ? req.files : [];
        console.log('Absence justification upload received', {
          contentType: req.headers['content-type'] || null,
          uploadedFilesCount: uploadedFiles.length,
          totalSize: uploadedFiles.reduce((sum: number, f: any) => sum + Number(f?.size || 0), 0),
        });

        try {
          req.justificationFiles = await persistFilesToConfiguredStorage(uploadedFiles, 'absence-justifications');
        } catch (storageError: any) {
          console.error('Failed to persist absence justification upload:', storageError?.message || storageError);
          return res.status(503).json({ error: 'File storage is temporarily unavailable' });
        }
        return next();
      }

      if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
        console.warn('⚠️ Expected files[] field not found; trying legacy single file field', { message: err.message });
        return upload.single('file')(req, res, async (legacyErr: any) => {
          if (legacyErr) {
            console.error('❌ Multer error for absence justification upload:', legacyErr);
            return res.status(400).json({ error: legacyErr.message || 'Invalid file upload' });
          }

          const uploadedFiles = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];
          console.log('📎 Legacy file upload request', {
            contentType: req.headers['content-type'] || null,
            bodyKeys: Object.keys(req.body || {}),
            uploadedFilesCount: uploadedFiles.length,
            fileNames: uploadedFiles.map((f: any) => f?.originalname || '(unknown)'),
            totalSize: uploadedFiles.reduce((sum: number, f: any) => sum + Number(f?.size || 0), 0),
          });

          try {
            req.justificationFiles = await persistFilesToConfiguredStorage(uploadedFiles, 'absence-justifications');
          } catch (storageError: any) {
            console.error('Failed to persist absence justification upload:', storageError?.message || storageError);
            return res.status(503).json({ error: 'File storage is temporarily unavailable' });
          }
          return next();
        });
      }

      console.error('❌ Multer error for absence justification upload:', err);
      return res.status(400).json({ error: err.message || 'Invalid file upload' });
    });
  };

  const internalJustificationUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
      if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error('Unsupported file type'));
      }
      cb(null, true);
    },
  });

  const handleInternalJustificationUpload = (req: any, res: any, next: any) => {
    internalJustificationUpload.single('file')(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Invalid file upload' });
      }
      return next();
    });
  };

  app.get('/api/internal/notification-attachment/:attachmentId', async (req: any, res: any) => {
    if (!verifyInternalNotificationAttachmentRequest(req, res)) return;

    const attachmentId = parseInt(req.params.attachmentId, 10);
    if (!Number.isInteger(attachmentId)) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    try {
      const [attachment] = await db
        .select()
        .from(notificationAttachments)
        .where(eq(notificationAttachments.id, attachmentId));
      if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

      const storedReference = String(attachment.filePath || '');
      const routed = await streamStoredFileToResponse(storedReference, 'notification-attachments', attachment.fileName, attachment.mimeType, res as any);
      if (!routed) {
        return res.status(404).json({ error: 'Attachment file not found on disk' });
      }
      return undefined;
    } catch (err: any) {
      console.error('Failed to serve internal notification attachment:', err?.message || err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  const notificationUpload = multer({
    storage: multer.diskStorage({
      destination: notificationUploadStorageDir,
      filename: (_req, file, cb) => {
        const randomSuffix = crypto.randomBytes(16).toString('hex');
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${randomSuffix}-${safeName}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowedExtensionsByMime: Record<string, string[]> = {
        'application/pdf': ['.pdf'],
        'image/png': ['.png'],
        'image/jpeg': ['.jpg', '.jpeg'],
      };
      const allowedExtensions = allowedExtensionsByMime[file.mimetype];
      const extension = path.extname(file.originalname).toLowerCase();
      if (!allowedExtensions || !allowedExtensions.includes(extension)) {
        return cb(new Error('Unsupported file type'));
      }
      cb(null, true);
    },
  });

  const handleNotificationUpload = (req: any, res: any, next: any) => {
    notificationUpload.array('files', 5)(req, res, async (err: any) => {
      if (!err) {
        const uploadedFiles = Array.isArray(req.files) ? req.files : [];
        console.log('📎 Notification attachment upload request', {
          contentType: req.headers['content-type'] || null,
          bodyKeys: Object.keys(req.body || {}),
          uploadedFilesCount: uploadedFiles.length,
          fileNames: uploadedFiles.map((f: any) => f?.originalname || '(unknown)'),
          totalSize: uploadedFiles.reduce((sum: number, f: any) => sum + Number(f?.size || 0), 0),
        });
        try {
          req.notificationFiles = await persistFilesToConfiguredStorage(uploadedFiles, 'notification-attachments');
        } catch (storageError: any) {
          console.error('Failed to persist notification attachment upload:', storageError?.message || storageError);
          return res.status(503).json({ error: 'File storage is temporarily unavailable' });
        }
        return next();
      }

      if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
        console.warn('⚠️ Expected files[] field not found for notification upload; trying legacy single file field', { message: err.message });
        return notificationUpload.single('file')(req, res, async (legacyErr: any) => {
          if (legacyErr) {
            void cleanupUploadedNotificationFiles(Array.isArray(req.files) ? req.files : req.file ? [req.file] : [])
              .finally(() => {
                console.error('❌ Multer error for notification attachment upload:', legacyErr);
                res.status(400).json({ error: legacyErr.message || 'Invalid file upload' });
              });
            return;
          }
          const uploadedFiles = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];
          try {
            req.notificationFiles = await persistFilesToConfiguredStorage(uploadedFiles, 'notification-attachments');
          } catch (storageError: any) {
            console.error('Failed to persist notification attachment upload:', storageError?.message || storageError);
            return res.status(503).json({ error: 'File storage is temporarily unavailable' });
          }
          return next();
        });
      }

      void cleanupUploadedNotificationFiles(Array.isArray(req.files) ? req.files : req.file ? [req.file] : [])
        .finally(() => {
          console.error('❌ Multer error for notification attachment upload:', err);
          res.status(400).json({ error: err.message || 'Invalid file upload' });
        });
    });
  };

  const cleanupUploadedNotificationFiles = async (uploadedFiles: any[] = [], kind: 'absence-justifications' | 'notification-attachments' = 'notification-attachments') => {
    if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) return;

    const cleanupResults = await Promise.allSettled(
      uploadedFiles.map(async (file: any) => {
        if (file?.storageMode === 's3' && file.storageReference) {
          await deleteStoredFile(file.storageReference, kind);
          return;
        }
        if (!file || !file.path) return;
        try {
          await fsPromises.rm(file.path, { force: true });
        } catch (cleanupErr) {
          console.warn('Failed to clean uploaded notification file after DB failure:', {
            path: file.path,
            error: cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
          });
        }
      })
    );
    cleanupResults.forEach((result) => {
      if (result.status === 'rejected') console.warn('Failed to clean uploaded notification file:', result.reason);
    });
  };

  // Global debug middleware for request/response tracing
  app.use((req, res, next) => {
    try {
      console.log('Request received', { method: req.method, hasBody: Boolean(req.body), contentType: req.headers['content-type'] || null });
    } catch (err) {
      console.error('Failed to log request debug data:', err);
    }

    const originalJson = res.json.bind(res);

    (res as any).json = function (data: any) {
      try {
        console.log('Response sent', { statusCode: res.statusCode, method: req.method, hasBody: data != null, bodyType: typeof data });
      } catch (err) {
        console.error('Failed to log response JSON debug data:', err);
      }
      return originalJson(data);
    };

    res.on('finish', () => {
      try {
        console.log('Response status', { statusCode: res.statusCode, method: req.method });
      } catch (err) {
        console.error('Failed to log response status:', err);
      }
    });

    next();
  });

  // Note: database seeding/initialization is performed by startServer(),
  // not by createApp(). Tests should call `createApp()` and use the
  // returned Express application via Supertest to avoid starting a real
  // network listener or running DB initialization side-effects.

  // CORS or Security Headers can be set if needed
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Allow embedding inside Google AI Studio
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
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
      req.path === '/politique-confidentialite' ||
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
  registerClassRankingRoute(app, { resolveActor });
  registerClassSubjectPivotRoute(app, { resolveActor });
  registerParentSchoolAdminWhatsAppRoute(app, { resolveActor });
  app.use('/api/accounting', requireAuth);
  registerAccountingRoutes(app, { resolveActor, isApprovedClassForSchool });

  // Register POST /api/users/:userId/schools (manage multi-school memberships)
  app.post('/api/users/:userId/schools', requireAuth, async (req: AuthRequest, res) => {
    try {

      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor || actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Forbidden: only super_admin can manage multi-school memberships' });
      }

      const userIdParam = parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(userIdParam)) return res.status(400).json({ error: 'Invalid userId' });

      const { schoolId, role } = req.body ?? {};
      const parsedSchoolId = typeof schoolId === 'number' ? schoolId : parseInt(String(schoolId), 10);
      if (!Number.isFinite(parsedSchoolId)) return res.status(400).json({ error: 'Invalid schoolId' });

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
      res.status(500).json({ error: 'Internal server error' });
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
      } else if (actor.role === 'teacher' || actor.role === 'surveillant') {
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
          userPhone: users.phone,
          teacherId: teachers.id,
          teacherPhone: teachers.phone,
          teacherSpecialization: teachers.specialization,
          parentPhone: parents.phone,
          userSchoolId: userSchools.schoolId,
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
            schoolIds: user.schoolId != null ? [user.schoolId] : [],
            academicYearId: user.academicYearId,
            isDeleted: user.isDeleted,
            createdAt: user.createdAt,
            phone: user.userPhone || user.teacherPhone || user.parentPhone || null,
            specialization: user.teacherSpecialization || null,
            classIds: [],
            _teacherId: user.teacherId,
          };
        }
        if (user.userSchoolId != null) {
          const existingSchoolIds = acc[user.id].schoolIds || [];
          if (!existingSchoolIds.includes(user.userSchoolId)) {
            existingSchoolIds.push(user.userSchoolId);
            acc[user.id].schoolIds = existingSchoolIds;
          }
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
      if (!resolved || resolved.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

      // Try to find a DB user by resolved actor id/uid/email
      let dbUser: any = null;
      if (resolved && (resolved as any).id) {
        dbUser = resolved;
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
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Admin endpoint: create user account (super_admin only)
  app.post('/api/admin/users', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      let actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });

      const { uid, email, name, lastName, firstNames, role, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, phone, specialization, subjectIds, gender, classIds, teachingAssignments, studentId } = req.body;
      const normalizedEmail = normalizeEmail(email);
      if (!role) return res.status(400).json({ error: 'Missing required field: role' });
      if (role !== 'parent' && !normalizedEmail) return res.status(400).json({ error: 'Missing required field: email' });
      if (role === 'teacher' && (!String(lastName ?? '').trim() || !String(firstNames ?? '').trim())) {
        return res.status(400).json({ error: 'Missing required fields: lastName and firstNames' });
      }
      const teacherDisplayName = role === 'teacher'
        ? `${String(lastName).trim()} ${String(firstNames).trim()}`
        : String(name ?? '').trim();
      if (!teacherDisplayName) return res.status(400).json({ error: 'Missing required name' });

      // Ensure role is one of allowed
      const allowed = ['super_admin', 'school_admin', 'teacher', 'surveillant', 'parent'];
      if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });

      const schoolId = rawSchoolId != null && rawSchoolId !== '' ? parseInt(rawSchoolId, 10) : undefined;
      if (rawSchoolId != null && rawSchoolId !== '' && Number.isNaN(schoolId)) {
        return res.status(400).json({ error: 'Invalid schoolId' });
      }

      if (role === 'surveillant') {
        if (actor.role === 'super_admin' && (rawSchoolId == null || String(rawSchoolId).trim() === '')) {
          return res.status(400).json({ error: 'schoolId is required for surveillant role' });
        }
        if (rawSchoolId != null && String(rawSchoolId).trim() !== '') {
          const parsedSchoolId = Number(String(rawSchoolId).trim());
          if (!Number.isInteger(parsedSchoolId)) {
            return res.status(400).json({ error: 'Invalid schoolId' });
          }
        }
        if (actor.role === 'school_admin' && actor.schoolId == null) {
          return res.status(400).json({ error: 'School admin must be attached to a school' });
        }
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

      if ((role === 'teacher' || role === 'surveillant') && (schoolId == null) && actor.role === 'school_admin' && actor.schoolId == null) {
        return res.status(400).json({ error: 'Missing required field: schoolId is required for teacher and surveillant roles' });
      }

      // Check if school_admin is creating a user for a different school
      if (actor.role === 'school_admin' && schoolId != null && schoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Forbidden: cannot create users for other schools' });
      }

      const resolvedSchoolId = schoolId != null ? schoolId : actor.role === 'school_admin' ? actor.schoolId : null;
      if (role === 'teacher' && resolvedSchoolId == null) {
        return res.status(400).json({ error: 'Missing required field: schoolId is required for teacher role' });
      }
      const normalizedTeachingAssignments = role === 'teacher' && Array.isArray(teachingAssignments)
        ? await validateTeacherClassSubjectAssignments(resolvedSchoolId!, teachingAssignments)
        : null;
      if (role === 'teacher' && Array.isArray(teachingAssignments) && !normalizedTeachingAssignments) {
        return res.status(400).json({ error: 'Invalid teacher class and subject assignment' });
      }
      const effectiveClassIds = role === 'teacher' && normalizedTeachingAssignments
        ? Array.from(new Set(normalizedTeachingAssignments.map((assignment) => assignment.classId)))
        : classIds;
      const effectiveSubjectIds = role === 'teacher' && normalizedTeachingAssignments
        ? Array.from(new Set(normalizedTeachingAssignments.map((assignment) => assignment.subjectId)))
        : subjectIds;

      if (role === 'surveillant') {
        if (resolvedSchoolId == null) {
          return res.status(400).json({ error: 'schoolId is required for surveillant role' });
        }
        if (actor.role === 'super_admin' || actor.role === 'school_admin') {
          const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, resolvedSchoolId)).limit(1);
          if (!school) {
            return res.status(400).json({ error: 'Invalid schoolId: school not found' });
          }
        }
      }

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
        return sendDuplicateEmailResponse(res);
      }

      const canonicalPhone = canonicalizeUserPhone(phone);
      if (!canonicalPhone) return sendInvalidPhoneResponse(res);
      const existingByPhone = await findExistingUsersByPhone(canonicalPhone);
      if (existingByPhone.length > 0) return sendDuplicatePhoneResponse(res);

      let requestedParentStudentId: number | undefined;
      let requestedParentStudent: { schoolId: number; isActive: boolean; parentId: number | null } | undefined;
      if (role === 'parent' && studentId != null && String(studentId).trim() !== '') {
        requestedParentStudentId = parsePositiveInteger(studentId) ?? undefined;
        if (requestedParentStudentId == null) return res.status(400).json({ error: 'Invalid studentId' });
        [requestedParentStudent] = await db.select({ schoolId: students.schoolId, isActive: students.isActive, parentId: students.parentId }).from(students).where(eq(students.id, requestedParentStudentId));
        if (!requestedParentStudent || requestedParentStudent.isActive !== true) {
          return res.status(400).json({ error: 'Only an active student can be linked to a new parent account' });
        }
        if (requestedParentStudent.parentId != null) {
          return res.status(409).json({ error: 'Student is already linked to another parent' });
        }
        if (resolvedSchoolId != null && requestedParentStudent.schoolId !== resolvedSchoolId) {
          return res.status(400).json({ error: 'Student does not belong to the selected parent school' });
        }
        if (actor.role === 'school_admin' && requestedParentStudent.schoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Cannot link a student from another school' });
        }
      }

      const parentSchoolId = role === 'parent'
        ? resolvedSchoolId ?? requestedParentStudent?.schoolId ?? null
        : null;
      if (role === 'parent' && actor.role !== 'super_admin' && parentSchoolId != null && parentSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Forbidden: cannot create parent for another school' });
      }

      const temporaryCredential = generateTemporaryLocalPassword();
      const createdUser = await db.transaction(async (tx) => {
        const [newUser] = await tx.insert(users).values({
          uid: finalUid,
          email: normalizedEmail,
          name: teacherDisplayName,
          lastName: role === 'teacher' ? String(lastName).trim().toUpperCase() : null,
          firstNames: role === 'teacher' ? String(firstNames).trim() : null,
          role,
          schoolId: resolvedSchoolId,
          academicYearId,
          gender: gender ?? null,
          phone: canonicalPhone,
        }).returning();
        await tx.insert(localAuths).values({
          userId: newUser.id,
          passwordHash: temporaryCredential.passwordHash,
          salt: temporaryCredential.salt,
          mustReset: true,
        });

        let newParent: typeof parents.$inferSelect | null = null;
        if (role === 'parent') {
          [newParent] = await tx.insert(parents).values({
            userId: newUser.id,
            phone: canonicalPhone,
            address: '',
            studentId: requestedParentStudentId || undefined,
            schoolId: parentSchoolId,
          }).returning();

          if (requestedParentStudentId != null) {
            const studentConditions = [
              eq(students.id, requestedParentStudentId),
              sql`${students.parentId} IS NULL`,
            ];
            if (parentSchoolId != null) studentConditions.push(eq(students.schoolId, parentSchoolId));
            const linkedStudents = await tx.update(students)
              .set({ parentId: newParent.id })
              .where(and(...studentConditions))
              .returning({ id: students.id });
            if (linkedStudents.length === 0) {
              throw new Error('Parent student link could not be created');
            }
          }

          if (parentSchoolId != null) {
            await tx.insert(userSchools).values({
              userId: newUser.id,
              schoolId: parentSchoolId,
              role: 'parent',
              isActive: true,
            });
          }
        }

        return newUser;
      });

      if (role === 'school_admin' && resolvedSchoolId != null) {
        await upsertUserSchoolMembership(createdUser.id, resolvedSchoolId, 'school_admin', true);
      }
      if (role === 'surveillant' && resolvedSchoolId != null) {
        await upsertUserSchoolMembership(createdUser.id, resolvedSchoolId, 'surveillant', true);
      }

      // Create linked profile for teacher/parent
      let teacherProfile: any = null;
      if (role === 'teacher' && resolvedSchoolId == null) {
        return res.status(400).json({ error: 'Missing required field: schoolId is required for teacher role' });
      }

      if (role === 'teacher') {
        const teacherResult = await db.insert(teachers)
          .values({ userId: createdUser.id, schoolId: resolvedSchoolId ?? 0, phone: phone || '', specialization: normalizeSpecialization(specialization) || null })
          .returning();
        teacherProfile = teacherResult[0];

        if (Array.isArray(effectiveSubjectIds) && resolvedSchoolId != null) {
          await syncTeacherSubjectAssignments(teacherProfile.id, resolvedSchoolId, effectiveSubjectIds);
        }
        if (normalizedTeachingAssignments && resolvedSchoolId != null) {
          await syncTeacherClassSubjectAssignments(teacherProfile.id, resolvedSchoolId, normalizedTeachingAssignments);
        }

        if (resolvedSchoolId != null) {
          await db.insert(userSchools).values({
            userId: createdUser.id,
            schoolId: resolvedSchoolId,
            role: 'teacher',
            isActive: true,
          });
        }

        // Assign provided classes to this teacher when classIds are supplied
        if (Array.isArray(effectiveClassIds) && effectiveClassIds.length > 0) {
          for (const rawClassId of effectiveClassIds) {
            const cid = Number(rawClassId);
            if (Number.isNaN(cid)) {
              continue;
            }
            const [cls] = await db.select().from(classes).where(eq(classes.id, cid));
            const [schoolClassRow] = resolvedSchoolId != null ? await db.select().from(schoolClasses).where(and(eq(schoolClasses.classId, cid), eq(schoolClasses.schoolId, resolvedSchoolId))) : [null];
            const approved = await isApprovedClassForSchool(cid, resolvedSchoolId);

            if (!cls) {
              continue;
            }

            if (resolvedSchoolId != null && cls.schoolId != null && cls.schoolId !== resolvedSchoolId) {
              continue;
            }

            if (!approved) {
              continue;
            }

            try {
              const existingAssignment = await db.select().from(classTeachers).where(and(
                eq(classTeachers.classId, cid),
                eq(classTeachers.teacherId, teacherProfile.id),
                eq(classTeachers.schoolId, resolvedSchoolId),
              ));
              if (existingAssignment.length === 0) {
                await db.insert(classTeachers).values({ classId: cid, teacherId: teacherProfile.id, schoolId: resolvedSchoolId });
              }
            } catch (e: any) {
              console.warn('Failed to assign teacher to class');
            }
          }
        }
          // Ensure users.schoolId stays consistent with teachers.schoolId
        try {
          await db.update(users).set({ schoolId: resolvedSchoolId ?? null }).where(eq(users.id, createdUser.id));
        } catch (e: any) {
          console.warn('Failed to sync teacher and user school association');
        }
        // Log if inconsistency exists after creation
        try {
          await logIfTeacherUserMismatch(createdUser.id, teacherProfile?.id);
        } catch (e) {
          /* ignore */
        }
      }

      await logAuditEvent(actor, 'create', 'user', createdUser.id, actor.schoolId ?? null, `${actor.role === 'school_admin' ? 'School admin' : 'Super admin'} ${actor.email || actor.uid} created ${role} account ${createdUser.email}`);

      // Build response with classIds for teachers
      const responseBody: any = {
        ...createdUser,
        temporaryPassword: temporaryCredential.temporaryPassword,
        specialization: role === 'teacher' ? (teacherProfile?.specialization || null) : null,
        phone: role === 'teacher' ? (teacherProfile?.phone || phone || '') : role === 'parent' ? canonicalPhone : createdUser.phone ?? null,
      };

      if (role === 'teacher' && teacherProfile?.id) {
        responseBody.teacherId = teacherProfile.id;
        const assignments = await db
          .select({ classId: classTeachers.classId })
          .from(classTeachers)
          .where(and(
            eq(classTeachers.teacherId, teacherProfile.id),
            eq(classTeachers.schoolId, resolvedSchoolId),
          ));
        responseBody.classIds = assignments.map((a) => a.classId);
      }

      res.status(201).json(responseBody);
    } catch (err: any) {
      console.error('Error creating admin user:', err);
      if (isUsersPhoneUniqueViolation(err)) return sendDuplicatePhoneResponse(res);
      if (isUsersEmailUniqueViolation(err)) return sendDuplicateEmailResponse(res);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Admin: update user account (super_admin or school_admin for same school)
  app.put('/api/admin/users/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });

      const id = parseInt(req.params.id);
      const { email, name, lastName, firstNames, role, schoolId: incomingSchoolId, academicYearId: rawAcademicYearId, phone, specialization, subjectIds, gender, classIds, teachingAssignments, studentId } = req.body;
      // Only set parsedSchoolId when provided in the request. If omitted, preserve existing DB values.
      const parsedSchoolId = incomingSchoolId != null && incomingSchoolId !== '' ? parseInt(incomingSchoolId, 10) : undefined;
      if (!role) return res.status(400).json({ error: 'Missing required field: role' });
      if (role !== 'parent' && !email) return res.status(400).json({ error: 'Missing required field: email' });
      const teacherIdentityProvided = role === 'teacher' && (lastName !== undefined || firstNames !== undefined);
      const normalizedTeacherLastName = teacherIdentityProvided ? String(lastName ?? '').trim().toUpperCase() : '';
      const normalizedTeacherFirstNames = teacherIdentityProvided ? String(firstNames ?? '').trim() : '';
      if (teacherIdentityProvided && (!normalizedTeacherLastName || !normalizedTeacherFirstNames)) {
        return res.status(400).json({ error: 'lastName and firstNames must be provided together' });
      }
      const teacherDisplayName = teacherIdentityProvided
        ? `${normalizedTeacherLastName} ${normalizedTeacherFirstNames}`
        : String(name ?? '').trim();
      if (!teacherDisplayName) return res.status(400).json({ error: 'Missing required name' });

      const academicYearId = rawAcademicYearId != null && rawAcademicYearId !== '' ? parseInt(rawAcademicYearId, 10) : undefined;
      if (rawAcademicYearId != null && rawAcademicYearId !== '' && Number.isNaN(academicYearId)) {
        return res.status(400).json({ error: 'Invalid academicYearId' });
      }

      const allowed = ['super_admin', 'school_admin', 'teacher', 'surveillant', 'parent'];
      if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });

      // Check if school_admin is modifying a user outside their school
      const [targetUser] = await db.select().from(users).where(eq(users.id, id));
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
      const teachingAssignmentSchoolId = actor.role === 'school_admin'
        ? actor.schoolId
        : parsedSchoolId ?? targetUser.schoolId;
      const normalizedTeachingAssignments = role === 'teacher' && Array.isArray(teachingAssignments) && teachingAssignmentSchoolId != null
        ? await validateTeacherClassSubjectAssignments(teachingAssignmentSchoolId, teachingAssignments)
        : null;
      if (role === 'teacher' && Array.isArray(teachingAssignments)
        && (teachingAssignmentSchoolId == null || !normalizedTeachingAssignments)) {
        return res.status(400).json({ error: 'Invalid teacher class and subject assignment' });
      }
      const effectiveClassIds = normalizedTeachingAssignments
        ? Array.from(new Set(normalizedTeachingAssignments.map((assignment) => assignment.classId)))
        : classIds;
      const effectiveSubjectIds = normalizedTeachingAssignments
        ? Array.from(new Set(normalizedTeachingAssignments.map((assignment) => assignment.subjectId)))
        : subjectIds;
      const [existingParentForUpdate] = targetUser.role === 'parent'
        ? await db.select({ id: parents.id, studentId: parents.studentId, schoolId: parents.schoolId }).from(parents).where(eq(parents.userId, id))
        : [undefined];
      if ((targetUser.role === 'teacher' || targetUser.role === 'surveillant') && role !== targetUser.role) {
        return res.status(403).json({ error: 'Forbidden: cannot change role for teacher accounts' });
      }
      if (actor.role === 'school_admin' && actor.schoolId !== targetUser.schoolId) {
        // Teachers and parents may belong to multiple schools through userSchools.
        if (['teacher', 'parent'].includes(targetUser.role)) {
          const [membership] = await db.select({ id: userSchools.id }).from(userSchools).where(and(
            eq(userSchools.userId, targetUser.id),
            eq(userSchools.schoolId, actor.schoolId!),
            eq(userSchools.role, targetUser.role),
            eq(userSchools.isActive, true),
          ));
          if (!membership) {
            return res.status(403).json({ error: 'Forbidden: cannot modify users outside your school' });
          }
        } else {
          return res.status(403).json({ error: 'Forbidden: cannot modify users outside your school' });
        }
      }

      if (actor.role === 'school_admin' && parsedSchoolId !== undefined && parsedSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Forbidden: cannot move user to another school' });
      }

      const parentStudentIdProvided = Object.prototype.hasOwnProperty.call(req.body, 'studentId');
      const requestedParentStudentId = parentStudentIdProvided && studentId != null && String(studentId).trim() !== ''
        ? parsePositiveInteger(studentId)
        : null;
      const parentStudentLinkChanged = parentStudentIdProvided
        && requestedParentStudentId !== (existingParentForUpdate?.studentId ?? null);
      if (role === 'parent' && parentStudentIdProvided && studentId != null && String(studentId).trim() !== '' && requestedParentStudentId == null) {
        return res.status(400).json({ error: 'Invalid studentId' });
      }
      if (role === 'parent' && parentStudentLinkChanged && requestedParentStudentId != null) {
        const [student] = await db.select({ parentId: students.parentId, schoolId: students.schoolId, isActive: students.isActive })
          .from(students).where(eq(students.id, requestedParentStudentId));
        if (!student || student.isActive !== true) return res.status(400).json({ error: 'Only an active student can be linked to a parent account' });
        if (student.parentId != null && student.parentId !== existingParentForUpdate?.id) {
          return res.status(409).json({ error: 'Student is already linked to another parent' });
        }
        const parentSchoolId = parsedSchoolId ?? existingParentForUpdate?.schoolId ?? targetUser.schoolId;
        if (parentSchoolId == null || student.schoolId !== parentSchoolId) {
          return res.status(400).json({ error: 'Student does not belong to the selected parent school' });
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
      const normalizedIncomingEmail = normalizeEmail(email);
      const emailChanged = normalizedIncomingEmail !== normalizeEmail(targetUser.email);
      if (emailChanged) {
        if (role !== 'parent' && !normalizedIncomingEmail) {
          return res.status(400).json({ error: 'Missing required field: email' });
        }

        let emailConflicts: any[] = [];
        if (normalizedIncomingEmail == null) {
          // Parent accounts may intentionally have no email; skip duplicate checks.
          emailConflicts = [];
        } else if (targetUser.role === 'super_admin' || role === 'super_admin') {
          // Super admin emails are globally unique
          emailConflicts = await db.select().from(users).where(
            and(
              eq(sql`LOWER(${users.email})`, normalizedIncomingEmail),
              sql`${users.id} != ${id}`
            )
          );
        } else {
          // For other roles: unique per school
          const schoolForCheck = parsedSchoolId !== undefined ? parsedSchoolId : targetUser.schoolId;
          if (schoolForCheck != null) {
            emailConflicts = await db.select().from(users).where(
              and(
                eq(sql`LOWER(${users.email})`, normalizedIncomingEmail),
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

      let canonicalPhoneForUpdate = canonicalizeUserPhone(targetUser.phone);
      if (phone !== undefined) {
        canonicalPhoneForUpdate = canonicalizeUserPhone(phone);
        if (!canonicalPhoneForUpdate) return sendInvalidPhoneResponse(res);
        if (canonicalPhoneForUpdate !== canonicalizeUserPhone(targetUser.phone)) {
          const phoneConflicts = await findExistingUsersByPhone(canonicalPhoneForUpdate, id);
          if (phoneConflicts.length > 0) return sendDuplicatePhoneResponse(res);
        }
      }
      if (role !== targetUser.role && !canonicalPhoneForUpdate) return sendInvalidPhoneResponse(res);

      const updatedValues: any = { email: normalizedIncomingEmail, name: teacherDisplayName, role, gender: gender ?? null };
      if (teacherIdentityProvided) {
        updatedValues.lastName = normalizedTeacherLastName;
        updatedValues.firstNames = normalizedTeacherFirstNames;
      }
      if (parsedSchoolId !== undefined) updatedValues.schoolId = parsedSchoolId;
      if (phone !== undefined) updatedValues.phone = canonicalPhoneForUpdate;
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
        const teacherPhone = phone !== undefined
          ? canonicalPhoneForUpdate ?? ''
          : existingTeacher[0]?.phone || canonicalPhoneForUpdate || '';
        if (existingTeacher.length > 0) {
          teacherProfileId = existingTeacher[0].id;
          // Update teachers.school_id only if a new schoolId was provided in the request
          if (parsedSchoolId !== undefined) {
            await db.update(teachers).set({ schoolId: parsedSchoolId, phone: teacherPhone, specialization: normalizeSpecialization(specialization) || null }).where(eq(teachers.userId, id));
            // Keep users.school_id in sync
            try {
              await db.update(users).set({ schoolId: parsedSchoolId ?? null }).where(eq(users.id, id));
            } catch (e: any) {
              console.warn('DIAG: failed to sync users.schoolId during admin update', { userId: id, parsedSchoolId, err: e?.message || e });
            }
          } else {
            await db.update(teachers).set({ phone: teacherPhone, specialization: normalizeSpecialization(specialization) || null }).where(eq(teachers.userId, id));
          }
        } else {
          const [inserted] = await db.insert(teachers).values({ userId: id, schoolId: parsedSchoolId !== undefined ? parsedSchoolId : undefined, phone: teacherPhone, specialization: normalizeSpecialization(specialization) || null } as any).returning();
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

        const assignmentSchoolId = actor.role === 'school_admin'
          ? actor.schoolId
          : parsedSchoolId ?? targetUser.schoolId;
        if (teacherProfileId != null && assignmentSchoolId != null && normalizedTeachingAssignments) {
          await syncTeacherClassSubjectAssignments(teacherProfileId, assignmentSchoolId, normalizedTeachingAssignments);
        }
        if (teacherProfileId != null && assignmentSchoolId != null && Array.isArray(effectiveSubjectIds)) {
          await syncTeacherSubjectAssignments(teacherProfileId, assignmentSchoolId, effectiveSubjectIds);
        }

        if (teacherProfileId != null && assignmentSchoolId != null && Array.isArray(effectiveClassIds)) {
          console.log('Updating class assignments for teacher (admin update):', { teacherProfileId, classIds: effectiveClassIds });
          await db.delete(classTeachers).where(and(
            eq(classTeachers.teacherId, teacherProfileId),
            eq(classTeachers.schoolId, assignmentSchoolId),
          ));
          if (effectiveClassIds.length > 0) {
            for (const rawClassId of effectiveClassIds) {
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
                await db.insert(classTeachers).values({ classId: cid, teacherId: teacherProfileId, schoolId: assignmentSchoolId });
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
        const existingParent = await db.select().from(parents).where(eq(parents.userId, id));
        const parentValues: any = {
          phone: phone !== undefined ? canonicalPhoneForUpdate ?? '' : existingParent[0]?.phone || canonicalPhoneForUpdate || '',
          address: typeof req.body.address === 'string' ? req.body.address : existingParent[0]?.address || '',
          schoolId: parsedSchoolId ?? existingParent[0]?.schoolId ?? targetUser.schoolId ?? null,
        };
        if (parentStudentIdProvided) parentValues.studentId = requestedParentStudentId;
        let parentProfileId = existingParent[0]?.id ?? null;
        if (existingParent.length > 0) {
          const [updatedParent] = await db.update(parents).set(parentValues).where(eq(parents.userId, id)).returning();
          parentProfileId = updatedParent?.id ?? parentProfileId;
        } else {
          const [createdParent] = await db.insert(parents).values({ userId: id, ...parentValues }).returning();
          parentProfileId = createdParent?.id ?? null;
        }
        if (parentStudentLinkChanged && parentProfileId != null) {
          const previousStudentId = existingParent[0]?.studentId;
          if (previousStudentId != null && previousStudentId !== requestedParentStudentId) {
            await db.update(students).set({ parentId: null }).where(and(
              eq(students.id, previousStudentId),
              eq(students.parentId, parentProfileId),
            ));
          }
          if (requestedParentStudentId != null) {
            await db.update(students).set({ parentId: parentProfileId }).where(and(
              eq(students.id, requestedParentStudentId),
              eq(students.schoolId, parentValues.schoolId),
              or(sql`${students.parentId} IS NULL`, eq(students.parentId, parentProfileId)),
            ));
          }
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
            .where(and(
              eq(classTeachers.teacherId, existingTeacher[0].id),
              actor.role === 'super_admin'
                ? eq(classTeachers.schoolId, existingTeacher[0].schoolId)
                : eq(classTeachers.schoolId, actor.schoolId!),
            ));
          classIds = assignments.map((a) => a.classId);
        }
        try {
          await logIfTeacherUserMismatch(updatedUser.id, teacherId);
        } catch (e) {
          /* ignore */
        }
        res.json({ ...updatedUser, teacherId, classIds, phone: phoneValue, specialization: specializationValue });
      } else {
        res.json(toUserDto(updatedUser));
      }
    } catch (err: any) {
      console.error('Error updating admin user:', err);
      if (isUsersPhoneUniqueViolation(err)) return sendDuplicatePhoneResponse(res);
      res.status(500).json({ error: 'Internal server error' });
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
      res.status(500).json({ error: 'Internal server error' });
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
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });

      const userId = Number(req.body?.userId);
      if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid userId' });

      const [targetUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
      if (targetUser.role === 'student') return res.status(403).json({ error: 'Cannot set password for student profile' });
      if (actor.role === 'school_admin') {
        if (targetUser.schoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Forbidden: cannot set password for users outside your school' });
        }
        if (['super_admin', 'school_admin'].includes(targetUser.role)) {
          return res.status(403).json({ error: 'Forbidden: cannot set password for admin accounts' });
        }
      }

      const [existingLocalAuth] = await db.select().from(localAuths).where(eq(localAuths.userId, userId));
      if (!existingLocalAuth) {
        return res.status(409).json({ error: 'This account does not use local password authentication' });
      }

      const temporaryCredential = generateTemporaryLocalPassword();
      await db.update(localAuths).set({
        passwordHash: temporaryCredential.passwordHash,
        salt: temporaryCredential.salt,
        mustReset: true,
      }).where(eq(localAuths.userId, userId));

      res.json({ success: true, userId, temporaryPassword: temporaryCredential.temporaryPassword, mustReset: true });
    } catch (err: any) {
      console.error('Error resetting local password:', err?.message || err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Self: update own profile (or admins updating other users)
  console.log('REGISTER ROUTE: PUT /api/users/:id');
  app.put('/api/users/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });

      const [targetUser] = await db.select().from(users).where(eq(users.id, id));
      if (!targetUser) return res.status(404).json({ error: 'User not found' });

      if (!actor) return res.status(403).json({ error: 'Forbidden' });
      const actorIsOwner = actor.id && Number(actor.id) === id;
      if (!(actorIsOwner || ['super_admin', 'school_admin'].includes(actor.role))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (!actorIsOwner && actor.role === 'school_admin') {
        if (['super_admin', 'school_admin'].includes(targetUser.role)) {
          return res.status(403).json({ error: 'Forbidden: cannot modify admin accounts' });
        }

        if (actor.schoolId !== targetUser.schoolId) {
          const membership = await ensureUserSchoolMembership(targetUser.id, actor.schoolId, targetUser.role);
          if (!membership) {
            return res.status(403).json({ error: 'Forbidden: cannot modify users outside your school' });
          }
        }
      }

      const { firstName, lastName, firstNames, name, phone, address } = req.body as any;
      const isTeacher = targetUser.role === 'teacher';
      let displayName = name;
      if (isTeacher && lastName && firstNames) displayName = `${String(lastName).trim()} ${String(firstNames).trim()}`;
      if (!isTeacher && !displayName && (firstName || lastName)) displayName = [firstName || '', lastName || ''].filter(Boolean).join(' ');

      const updatedFields: any = {};
      if (displayName) updatedFields.name = displayName;
      if (isTeacher && lastName && firstNames) {
        updatedFields.lastName = String(lastName).trim().toUpperCase();
        updatedFields.firstNames = String(firstNames).trim();
      }
      let canonicalPhoneForUpdate: string | null = null;
      if (phone !== undefined) {
        canonicalPhoneForUpdate = canonicalizeUserPhone(phone);
        if (!canonicalPhoneForUpdate) return sendInvalidPhoneResponse(res);
        if (canonicalPhoneForUpdate !== canonicalizeUserPhone(targetUser.phone)) {
          const phoneConflicts = await findExistingUsersByPhone(canonicalPhoneForUpdate, id);
          if (phoneConflicts.length > 0) return sendDuplicatePhoneResponse(res);
        }
        updatedFields.phone = canonicalPhoneForUpdate;
      }

      if (Object.keys(updatedFields).length > 0) {
        await db.update(users).set(updatedFields).where(eq(users.id, id));
      }

      // If the user is a parent, persist phone/address in parents table
      const [updatedUserCandidate] = await db.select().from(users).where(eq(users.id, id));
      if (updatedUserCandidate && updatedUserCandidate.role === 'parent') {
        const existingParent = await db.select().from(parents).where(eq(parents.userId, id));
        const parentValues: any = {
          phone: phone !== undefined ? canonicalPhoneForUpdate ?? '' : existingParent[0]?.phone || canonicalizeUserPhone(updatedUserCandidate.phone) || '',
          address: typeof address === 'string' ? address : existingParent[0]?.address || '',
        };
        if (existingParent.length > 0) {
          await db.update(parents).set(parentValues).where(eq(parents.userId, id));
        } else {
          await db.insert(parents).values({ userId: id, ...parentValues });
        }
      }

      const [updatedUser] = await db.select().from(users).where(eq(users.id, id));

      await logAuditEvent(actor, 'update', 'user', updatedUser.id, actor.schoolId ?? null, `${actor.role === 'school_admin' ? 'School admin' : actor.role === 'super_admin' ? 'Super admin' : 'User'} ${actor.email || actor.uid} updated account ${updatedUser.email}`);

      res.json(toUserDto(updatedUser));
    } catch (err: any) {
      console.error('Error in self-update user:', err);
      if (isUsersPhoneUniqueViolation(err)) return sendDuplicatePhoneResponse(res);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Local login with email + password
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // max 5 attempts
    message: { error: 'Too many login attempts, please try again later' },
    standardHeaders: false,
    legacyHeaders: false,
  });
  app.post('/api/auth/local-login', loginLimiter, handleLocalLogin);

  // Local logout now revokes the current JWT access token server-side
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
      }

      const token = authHeader.split('Bearer ')[1];
      const secret = getJwtSecret({ isProduction: process.env.NODE_ENV === 'production' });
      if (!secret) {
        return res.status(500).json({ error: 'Server configuration error' });
      }

      const decoded = verifyJwt(token, secret);
      const uid = decoded?.uid;
      const tokenType = decoded?.type;
      const jti = decoded?.jti;
      const exp = decoded?.exp;

      if (!uid || tokenType !== 'access' || !jti || !exp) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.uid, uid));
      const expiresAt = new Date(exp * 1000);

      try {
        await db.insert(tokenBlacklist).values({
          token,
          tokenJti: jti,
          userId: dbUser?.id ?? undefined,
          expiresAt,
        });
      } catch (err: any) {
        if (!String(err?.message || '').toLowerCase().includes('duplicate')) {
          throw err;
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error('Logout error:', err);
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  });

  // Change password for a user (current password required)
  app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { email, currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Missing fields' });
      const authenticatedUserId = req.user?.id;
      if (typeof authenticatedUserId !== 'number' || !Number.isInteger(authenticatedUserId)) {
        return res.status(401).json({ error: 'Unauthenticated' });
      }
      const [userRecord] = await db.select().from(users).where(eq(users.id, authenticatedUserId));
      if (!userRecord) return res.status(404).json({ error: 'Utilisateur non trouvé' });

      if (email != null && String(email).trim()) {
        const requestedEmail = normalizeEmail(email);
        if (!userRecord.email || requestedEmail !== normalizeEmail(userRecord.email)) {
          return res.status(403).json({ error: 'Forbidden: authenticated user does not match requested email' });
        }
      }

      const authRows = await db.select().from(localAuths).where(eq(localAuths.userId, userRecord.id));
      if (authRows.length === 0) return res.status(400).json({ error: 'Aucun mot de passe enregistré pour cet utilisateur' });
      const { passwordHash, salt, mustReset } = authRows[0] as any;

      const crypto = await import('node:crypto');
      const verifyHash = crypto.pbkdf2Sync(currentPassword, salt, 310000, 64, 'sha512').toString('hex');
      if (verifyHash !== passwordHash) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

      if (mustReset && hashLocalPassword(String(newPassword), salt) === passwordHash) {
        return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent du mot de passe actuel.' });
      }

      const passwordPolicyError = getNewPasswordPolicyError(String(newPassword));
      if (passwordPolicyError) return res.status(400).json({ error: passwordPolicyError });

      // Hash new password and clear mustReset
      const newSalt = crypto.randomBytes(16).toString('hex');
      const newHash = hashLocalPassword(newPassword, newSalt);

      await db.update(localAuths).set({ passwordHash: newHash, salt: newSalt, mustReset: false }).where(eq(localAuths.userId, userRecord.id));

      res.json({ success: true });
    } catch (err: any) {
      console.error('change-password error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/auth/schools', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let memberships = await getUserSchoolMemberships(actor.id ?? null);
      let schoolsList = [] as any[];

      if (actor.role === 'super_admin') {
        schoolsList = await db.select().from(schools);
      } else {
        const schoolIds = memberships.map((membership) => membership.schoolId).filter((id): id is number => id != null);
        if (schoolIds.length > 0) {
          schoolsList = await db.select().from(schools).where(inArray(schools.id, schoolIds));
        } else {
          const fallbackIds = getFallbackSchoolIdsForActor(actor, {
            teacherSchoolId: actor.role === 'teacher' ? (actor as any).teacherSchoolId ?? null : null,
            parentSchoolIds: actor.role === 'parent' ? [] : [],
          });

          if (fallbackIds.length > 0) {
            for (const fallbackSchoolId of fallbackIds) {
              const hasMembership = await ensureUserSchoolMembership(actor.id ?? null, fallbackSchoolId, actor.role === 'school_admin' ? 'school_admin' : undefined);
              if (!hasMembership) {
                await upsertUserSchoolMembership(actor.id ?? null, fallbackSchoolId, actor.role === 'school_admin' ? 'school_admin' : (actor.role || 'teacher'), true);
              }
            }
            memberships = await getUserSchoolMemberships(actor.id ?? null);
            const refreshedSchoolIds = memberships.map((membership) => membership.schoolId).filter((id): id is number => id != null);
            if (refreshedSchoolIds.length > 0) {
              schoolsList = await db.select().from(schools).where(inArray(schools.id, refreshedSchoolIds));
            }
          }
        }
      }

      const activeSchoolId = actor.role === 'super_admin'
        ? null
        : memberships.find((membership) => membership.isActive)?.schoolId
          ?? null;

      res.json({
        schools: schoolsList.map((school) => ({ id: school.id, name: school.name })),
        activeSchoolId,
      });
    } catch (err: any) {
      console.error('Error fetching user schools:', err);
      res.status(500).json({ error: 'Internal server error' });
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

      // For other roles: check if membership exists or can be auto-created from fallback sources
      let membership = actor.role === 'school_admin'
        ? await ensureUserSchoolMembership(actor.id ?? null, parsedSchoolId, 'school_admin')
        : await ensureUserSchoolMembership(actor.id ?? null, parsedSchoolId);

      if (!membership && actor.id) {
        try {
          const fallbackIds = getFallbackSchoolIdsForActor(actor, {
            teacherSchoolId: actor.role === 'teacher' ? (actor as any).teacherSchoolId ?? null : null,
            parentSchoolIds: actor.role === 'parent' ? [] : [],
          });

          if (fallbackIds.includes(parsedSchoolId)) {
            await upsertUserSchoolMembership(actor.id, parsedSchoolId, actor.role === 'school_admin' ? 'school_admin' : (actor.role || 'teacher'), true);
            membership = await ensureUserSchoolMembership(actor.id, parsedSchoolId);
            console.log('Auto-created user_schools membership from fallback school context', { userId: actor.id, schoolId: parsedSchoolId, role: actor.role });
          }
        } catch (e: any) {
          console.warn('Failed to auto-create fallback membership:', e?.message || e);
        }
      }

      // If membership not found, try to auto-create it for parent from fallback sources
      if (!membership && actor.role === 'parent' && actor.id) {
        try {
          const parentRows = await db.select({ id: parents.id, schoolId: parents.schoolId })
            .from(parents)
            .where(eq(parents.userId, actor.id));

          let canCreate = parentRows.some((row) => row.schoolId === parsedSchoolId);
          if (!canCreate && parentRows.length > 0) {
            const linkedStudents = await db.select({ id: students.id })
              .from(students)
              .innerJoin(parents, and(
                eq(students.parentId, parents.id),
                eq(students.schoolId, parents.schoolId),
              ))
              .where(and(
                eq(parents.userId, actor.id),
                eq(parents.schoolId, parsedSchoolId),
                eq(students.schoolId, parsedSchoolId),
              ));
            canCreate = linkedStudents.length > 0;
          }

          if (canCreate) {
            await upsertUserSchoolMembership(actor.id, parsedSchoolId, 'parent', true);
            membership = await ensureUserSchoolMembership(actor.id, parsedSchoolId);
            console.log('Auto-created user_schools membership for parent', { userId: actor.id, schoolId: parsedSchoolId });
          }
        } catch (e: any) {
          console.warn('Failed to auto-create parent membership:', e?.message || e);
        }
      }

      // If membership not found and actor has no ID, reject early
      if (!membership && !actor.id) {
        console.warn('School selection rejected: actor has no ID', {
          schoolId: parsedSchoolId,
          userRole: actor.role,
          actorHasId: !!actor.id
        });
        return res.status(403).json({ error: 'User identity cannot be verified' });
      }

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
      res.status(500).json({ error: 'Internal server error' });
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

      const actor = await resolveActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Unauthenticated' });
      }

      const { uid, email, name, role, schoolId } = actor;
      const normalizedEmail = normalizeEmail(email);

      // Find if user already exists
      const existingUser = await db.select().from(users).where(eq(users.uid, uid));

      if (existingUser.length > 0) {
        const existing = existingUser[0];
        if (schoolId && existing.schoolId !== schoolId) {
          await db.update(users).set({ schoolId }).where(eq(users.uid, uid));
          existing.schoolId = schoolId;
        }
        return res.json(existing);
      }

      if (normalizedEmail) {
        // Search for existing user by email
        // If user has a schoolId in context, search per-school; otherwise global
        let existingByEmail: any[] = [];
        if (schoolId) {
          // Per-school search
          existingByEmail = await db.select().from(users).where(
            and(
              eq(sql`LOWER(${users.email})`, normalizedEmail),
              eq(users.schoolId, schoolId)
            )
          );
        } else {
          // Global search (fallback)
          existingByEmail = await db.select().from(users).where(eq(sql`LOWER(${users.email})`, normalizedEmail));
        }
        
        if (existingByEmail.length > 0) {
          const existing = existingByEmail[0];
          if (schoolId && existing.schoolId !== schoolId) {
            await db.update(users).set({ schoolId }).where(eq(users.id, existing.id));
            existing.schoolId = schoolId;
          }
          return res.json(existing);
        }
      }

      // If user is simulated or we need to auto-create, preserve known roles, otherwise default to parent
      const allowedRoles = ['super_admin', 'school_admin', 'teacher', 'surveillant', 'parent'];
      const normalizedRole = String(role || '').trim();
      const finalRole = allowedRoles.includes(normalizedRole) ? normalizedRole : 'parent';

      let resolvedSchoolId = schoolId ?? null;
      if (actor.simulated && !resolvedSchoolId && finalRole !== 'super_admin') {
        const defaultSchool = await db.select().from(schools).limit(1);
        if (defaultSchool.length > 0) {
          resolvedSchoolId = defaultSchool[0].id;
        }
      }

      const canonicalPhone = canonicalizeUserPhone(req.body?.phone ?? (req.user as any).phone);
      if (!canonicalPhone) return sendInvalidPhoneResponse(res);
      const existingByPhone = await findExistingUsersByPhone(canonicalPhone);
      if (existingByPhone.length > 0) return sendDuplicatePhoneResponse(res);

      const createdUser = await db.transaction(async (tx) => {
        const [newUser] = await tx.insert(users).values({
          uid,
          email: email || 'user@schooltrack.fr',
          name: name || 'Nouvel Utilisateur',
          role: finalRole,
          schoolId: resolvedSchoolId,
          phone: canonicalPhone,
        }).returning();

        if (finalRole === 'parent') {
          await tx.insert(parents).values({
            userId: newUser.id,
            phone: canonicalPhone,
            address: '',
          });
          if (resolvedSchoolId != null) {
            await tx.insert(userSchools).values({
              userId: newUser.id,
              schoolId: resolvedSchoolId,
              role: 'parent',
              isActive: true,
            });
          }
        }

        return newUser;
      });

      // Create linked profile type
      if (finalRole === 'school_admin') {
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
      } else if (finalRole === 'surveillant') {
        if (resolvedSchoolId != null) {
          try {
            await upsertUserSchoolMembership(createdUser.id, resolvedSchoolId, 'surveillant', true);
          } catch (e: any) {
            console.warn('Failed to insert user_schools for register-or-login surveillant', e?.message || e);
          }
        }
      }

      res.json(toUserDto(createdUser));

      return;
    } catch (err: any) {
      console.error('Error in register-or-login:', err);
      if (isUsersPhoneUniqueViolation(err)) return sendDuplicatePhoneResponse(res);
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
      
      // Load actor from database to get school_id (with simulated fallback)
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthenticated' });

      let list;
      if (actor.role === 'super_admin') {
        // Super admin can see all schools
        list = await db.select().from(schools);
      } else if ((actor.role === 'school_admin' || actor.role === 'parent' || actor.role === 'teacher') && actor.schoolId) {
        // School admin and parent see only their assigned school
        list = await db.select().from(schools).where(eq(schools.id, actor.schoolId));
      } else {
        // Other roles cannot access schools list, or actor without assigned school
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
      const name = String(req.body?.name || '').trim();
      const address = req.body?.address != null ? String(req.body.address).trim() : '';
      const phone = String(req.body?.phone || '').trim();
      const phone2 = req.body?.phone2 != null ? String(req.body.phone2).trim() : null;
      const officialName = req.body?.officialName != null ? String(req.body.officialName).trim() : null;
      const abbreviation = req.body?.abbreviation != null ? String(req.body.abbreviation).trim() : null;
      const motto = req.body?.motto != null ? String(req.body.motto).trim() : null;
      const postalBox = req.body?.postalBox != null ? String(req.body.postalBox).trim() : null;
      const email = req.body?.email != null ? String(req.body.email).trim() : null;
      const city = req.body?.city != null ? String(req.body.city).trim() : null;
      const region = req.body?.region != null ? String(req.body.region).trim() : null;
      const educationDirection = req.body?.educationDirection != null ? String(req.body.educationDirection).trim() : null;
      const ministryName = req.body?.ministryName != null ? String(req.body.ministryName).trim() : null;
      const principalName = req.body?.principalName != null ? String(req.body.principalName).trim() : null;
      const principalGenderRaw = req.body?.principalGender;
      const principalGender = principalGenderRaw == null || principalGenderRaw === '' ? null : String(principalGenderRaw).trim().toUpperCase();
      const promotionThresholdRaw = req.body?.promotionThreshold;
      const promotionThreshold = promotionThresholdRaw == null || promotionThresholdRaw === ''
        ? 10
        : Number(promotionThresholdRaw);
      const classNames = req.body?.classNames;
      const subjectNames = req.body?.subjectNames;

      if (!name) return res.status(400).json({ error: 'Name is required' });
      if (!phone) return res.status(400).json({ error: 'Phone is required' });
      if (principalGender != null && !['M', 'F'].includes(principalGender)) return res.status(400).json({ error: 'principalGender must be M or F' });
      if (!Number.isFinite(promotionThreshold) || promotionThreshold < 0 || promotionThreshold > 20) {
        return res.status(400).json({ error: 'promotionThreshold must be between 0 and 20' });
      }
      if (!/^\+228\s[0-9]{8}$/.test(phone)) {
        return res.status(400).json({ error: 'Phone must be in the format +228 12345678' });
      }
      if (phone2 && !/^\+228\s[0-9]{8}$/.test(phone2)) {
        return res.status(400).json({ error: 'Phone 2 must be in the format +228 12345678' });
      }
      if (!Array.isArray(classNames) || classNames.length === 0) {
        return res.status(400).json({ error: 'classNames must be a non-empty array' });
      }
      if (classNames.some((item: any) => typeof item !== 'string' || !String(item).trim())) {
        return res.status(400).json({ error: 'classNames must contain only non-empty strings' });
      }
      if (!Array.isArray(subjectNames) || subjectNames.length === 0) {
        return res.status(400).json({ error: 'subjectNames must be a non-empty array' });
      }
      if (subjectNames.some((item: any) => typeof item !== 'string' || !String(item).trim())) {
        return res.status(400).json({ error: 'subjectNames must contain only non-empty strings' });
      }

      // Load actor and validate permission
      const actor = await resolveActor(req);
      if (!actor) {
        console.log('TRACE /api/evaluations about to return 404 after resolveActor', { actor: null });
        return res.status(404).json({ error: 'User not found' });
      }

      // Only super_admin can create schools
      if (actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admin can create schools' });
      }

      const result = await db.insert(schools).values({ name, address, phone, phone2, officialName, abbreviation, motto, postalBox, email, city, region, educationDirection, ministryName, principalName, principalGender, promotionThreshold: promotionThreshold.toFixed(2) }).returning();
      const createdSchool = result[0];

      if (Array.isArray(classNames) && classNames.length > 0) {
        try {
          const normalizedClassNames = Array.from(
            new Set(
              classNames
                .map((className: any) => String(className || '').trim())
                .filter((name: string) => name)
            )
          );

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
            for (const trimmedClassName of normalizedClassNames) {
              const [globalClass] = await db.select().from(classes).where(
                and(
                  sql`${classes.schoolId} IS NULL`,
                  eq(classes.name, trimmedClassName)
                )
              ).limit(1);

              if (globalClass) {
                const [existingSchoolClass] = await db.select().from(schoolClasses).where(
                  and(
                    eq(schoolClasses.schoolId, createdSchool.id),
                    eq(schoolClasses.classId, globalClass.id)
                  )
                ).limit(1);

                if (!existingSchoolClass) {
                  await db.insert(schoolClasses).values({
                    schoolId: createdSchool.id,
                    classId: globalClass.id,
                    status: 'approved',
                  });
                }
                continue;
              }

              const [existingLocalClass] = await db.select().from(classes).where(
                and(
                  sql`${classes.schoolId} IS NOT NULL`,
                  eq(classes.academicYearId, yearId),
                  eq(classes.name, trimmedClassName)
                )
              ).limit(1);

              if (existingLocalClass) {
                const originalSchoolId = existingLocalClass.schoolId;
                await db.update(classes).set({ schoolId: null }).where(eq(classes.id, existingLocalClass.id));

                const [existingSchoolClass] = await db.select().from(schoolClasses).where(
                  and(
                    eq(schoolClasses.schoolId, createdSchool.id),
                    eq(schoolClasses.classId, existingLocalClass.id)
                  )
                ).limit(1);

                if (!existingSchoolClass) {
                  await db.insert(schoolClasses).values({
                    schoolId: createdSchool.id,
                    classId: existingLocalClass.id,
                    status: 'approved',
                  });
                }

                if (originalSchoolId != null && originalSchoolId !== createdSchool.id) {
                  const [existingOriginalSchoolClass] = await db.select().from(schoolClasses).where(
                    and(
                      eq(schoolClasses.schoolId, originalSchoolId),
                      eq(schoolClasses.classId, existingLocalClass.id)
                    )
                  ).limit(1);

                  if (!existingOriginalSchoolClass) {
                    await db.insert(schoolClasses).values({
                      schoolId: originalSchoolId,
                      classId: existingLocalClass.id,
                      status: 'approved',
                    });
                  }
                }
                continue;
              }

              try {
                const [newClass] = await db.insert(classes).values({
                  name: trimmedClassName,
                  schoolId: null,
                  academicYearId: yearId,
                  progressionCode: normalizeClassProgressionCode(trimmedClassName),
                }).returning();

                await db.insert(schoolClasses).values({
                  schoolId: createdSchool.id,
                  classId: newClass.id,
                  status: 'approved',
                });
              } catch (classErr: any) {
                console.warn(`Warning: Could not create class "${trimmedClassName}":`, classErr?.message);
              }
            }
          }
        } catch (classCreationErr: any) {
          console.warn('Warning: Could not create classes for school:', classCreationErr?.message);
        }
      }

      if (Array.isArray(subjectNames) && subjectNames.length > 0) {
        try {
          for (const subjectName of subjectNames) {
            const trimmedSubjectName = String(subjectName || '').trim();
            if (!trimmedSubjectName) continue;

            const [existingSubject] = await db.select().from(subjects).where(
              and(sql`${subjects.schoolId} IS NULL`, eq(subjects.name, trimmedSubjectName))
            ).limit(1);

            let subjectId: number;
            if (existingSubject) {
              subjectId = existingSubject.id;
            } else {
              const [createdSubject] = await db.insert(subjects).values({
                name: trimmedSubjectName,
              }).returning({ id: subjects.id });
              subjectId = createdSubject.id;
            }

            const existingSchoolSubject = await db.select().from(schoolSubjects).where(
              and(
                eq(schoolSubjects.schoolId, createdSchool.id),
                eq(schoolSubjects.subjectId, subjectId)
              )
            ).limit(1);
            if (existingSchoolSubject.length > 0) continue;

            await db.insert(schoolSubjects).values({
              schoolId: createdSchool.id,
              subjectId,
              status: 'approved',
            });
          }
        } catch (subjectCreationErr: any) {
          console.warn('Warning: Could not create school subjects for school:', subjectCreationErr?.message);
        }
      }

      res.status(201).json(createdSchool);
    } catch (err: any) {
      console.error('Error creating school:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/schools/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);
      // Detect a special-case update that only toggles the students creation lock.
      const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
      const lockKeyNames = ['students_creation_locked', 'studentsCreationLocked'];
      const isOnlyLockToggle = bodyKeys.length === 1 && lockKeyNames.includes(bodyKeys[0]);

      // If the request only contains the lock toggle, handle it here and
      // avoid requiring `name` so callers can perform a partial update.
      if (isOnlyLockToggle) {
        const studentsCreationLockedRaw = req.body?.students_creation_locked ?? req.body?.studentsCreationLocked;
        const val = Boolean(studentsCreationLockedRaw);

        const actor = await resolveActor(req);
        if (!actor) return res.status(404).json({ error: 'User not found' });
        if (actor.role !== 'super_admin') {
          return res.status(403).json({ error: 'Only super admin can modify school information' });
        }

        const [existingSchool] = await db.select().from(schools).where(eq(schools.id, id));
        if (!existingSchool) {
          return res.status(404).json({ error: 'School not found' });
        }

        const result = await db.update(schools)
          .set({ studentsCreationLocked: val })
          .where(eq(schools.id, id))
          .returning();

        // Log audit event for lock/unlock
        try {
          await logAuditEvent(actor, val ? 'lock_student_creation' : 'unlock_student_creation', 'school', id, id, `students_creation_locked: "${existingSchool.studentsCreationLocked ?? false}" → "${val}"`);
        } catch (e: any) {
          console.error('Audit log failed for school lock toggle:', e?.message || e);
        }

        return res.status(200).json(result[0]);
      }

      const name = String(req.body?.name || '').trim();
      const address = req.body?.address != null ? String(req.body.address).trim() : undefined;
      const phoneRaw = req.body?.phone;
      const phone = phoneRaw != null ? String(phoneRaw).trim() : undefined;
      const phone2Raw = req.body?.phone2;
      const phone2 = phone2Raw != null ? String(phone2Raw).trim() : undefined;
      const administrativeFields = ['officialName', 'abbreviation', 'motto', 'postalBox', 'email', 'city', 'region', 'educationDirection', 'ministryName', 'principalName'] as const;
      const principalGenderRaw = req.body?.principalGender;
      const principalGender = principalGenderRaw == null || principalGenderRaw === '' ? null : String(principalGenderRaw).trim().toUpperCase();
      const promotionThresholdRaw = req.body?.promotionThreshold;
      const logoPathRaw = req.body?.logoPath;
      const logoPath = logoPathRaw == null ? undefined : String(logoPathRaw).trim() || null;
      const classNames = req.body?.classNames;
      const subjectNames = req.body?.subjectNames;

      if (!name) return res.status(400).json({ error: 'Name is required' });
      if (principalGenderRaw !== undefined && principalGender != null && !['M', 'F'].includes(principalGender)) {
        return res.status(400).json({ error: 'principalGender must be M or F' });
      }
      if (phone !== undefined) {
        if (!phone) {
          return res.status(400).json({ error: 'Phone is required' });
        }
        if (!/^\+228\s[0-9]{8}$/.test(phone)) {
          return res.status(400).json({ error: 'Phone must be in the format +228 12345678' });
        }
      }
      if (phone2 !== undefined && phone2 !== '' && !/^\+228\s[0-9]{8}$/.test(phone2)) {
        return res.status(400).json({ error: 'Phone 2 must be in the format +228 12345678' });
      }
      if (promotionThresholdRaw !== undefined && (!Number.isFinite(Number(promotionThresholdRaw)) || Number(promotionThresholdRaw) < 0 || Number(promotionThresholdRaw) > 20)) {
        return res.status(400).json({ error: 'promotionThreshold must be between 0 and 20' });
      }
      if (classNames != null) {
        if (!Array.isArray(classNames)) {
          return res.status(400).json({ error: 'classNames must be an array' });
        }
        if (classNames.some((item: any) => typeof item !== 'string' || !String(item).trim())) {
          return res.status(400).json({ error: 'classNames must contain only non-empty strings' });
        }
      }
      if (subjectNames != null) {
        if (!Array.isArray(subjectNames)) {
          return res.status(400).json({ error: 'subjectNames must be an array' });
        }
        if (subjectNames.some((item: any) => typeof item !== 'string' || !String(item).trim())) {
          return res.status(400).json({ error: 'subjectNames must contain only non-empty strings' });
        }
      }

      // Load actor and validate school permission
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Only school administrators can modify school information' });
      }
      if (actor.role === 'school_admin' && actor.schoolId !== id) {
        return res.status(403).json({ error: 'Cannot modify another school' });
      }

      // Fetch existing school to track changes
      const [existingSchool] = await db.select().from(schools).where(eq(schools.id, id));
      if (!existingSchool) {
        return res.status(404).json({ error: 'School not found' });
      }

      const updatePayload: any = { name };
      if (address !== undefined) updatePayload.address = address;
      if (phone !== undefined) updatePayload.phone = phone;
      if (phone2 !== undefined) updatePayload.phone2 = phone2 || null;
      administrativeFields.forEach((field) => {
        if (req.body?.[field] !== undefined) updatePayload[field] = req.body[field] == null ? null : String(req.body[field]).trim() || null;
      });
      if (principalGenderRaw !== undefined) updatePayload.principalGender = principalGender;
      if (promotionThresholdRaw !== undefined) updatePayload.promotionThreshold = Number(promotionThresholdRaw).toFixed(2);
      if (logoPathRaw !== undefined) {
        updatePayload.logoPath = logoPath == null ? null : buildSchoolLogoRelativePath(path.basename(logoPath));
      }
      // Track changes for audit
      const changes: string[] = [];

      // allow updating the student creation lock (accept snake_case or camelCase)
      const studentsCreationLockedRaw = req.body?.students_creation_locked ?? req.body?.studentsCreationLocked;
      if (studentsCreationLockedRaw !== undefined) {
        const val = Boolean(studentsCreationLockedRaw);
        updatePayload.studentsCreationLocked = val;
        if ((existingSchool.studentsCreationLocked ?? false) !== val) {
          changes.push(`students_creation_locked: "${existingSchool.studentsCreationLocked ?? false}" → "${val}"`);
        }
      }

      const result = await db.update(schools)
        .set(updatePayload)
        .where(eq(schools.id, id))
        .returning();
      
      if (result.length === 0) {
        return res.status(404).json({ error: 'School not found' });
      }

      if (Array.isArray(classNames) && classNames.length > 0) {
        try {
          const normalizedClassNames = Array.from(
            new Set(
              classNames
                .map((className: any) => String(className || '').trim())
                .filter((name: string) => name)
            )
          );

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
            for (const trimmedClassName of normalizedClassNames) {
              const [globalClass] = await db.select().from(classes).where(
                and(
                  sql`${classes.schoolId} IS NULL`,
                  eq(classes.name, trimmedClassName)
                )
              ).limit(1);

              if (globalClass) {
                const [existingSchoolClass] = await db.select().from(schoolClasses).where(
                  and(
                    eq(schoolClasses.schoolId, id),
                    eq(schoolClasses.classId, globalClass.id)
                  )
                ).limit(1);

                if (!existingSchoolClass) {
                  await db.insert(schoolClasses).values({
                    schoolId: id,
                    classId: globalClass.id,
                    status: 'approved',
                  });
                }
                continue;
              }

              const [existingLocalClass] = await db.select().from(classes).where(
                and(
                  sql`${classes.schoolId} IS NOT NULL`,
                  eq(classes.academicYearId, yearId),
                  eq(classes.name, trimmedClassName)
                )
              ).limit(1);

              if (existingLocalClass) {
                const originalSchoolId = existingLocalClass.schoolId;
                await db.update(classes).set({ schoolId: null }).where(eq(classes.id, existingLocalClass.id));

                const [existingSchoolClass] = await db.select().from(schoolClasses).where(
                  and(
                    eq(schoolClasses.schoolId, id),
                    eq(schoolClasses.classId, existingLocalClass.id)
                  )
                ).limit(1);

                if (!existingSchoolClass) {
                  await db.insert(schoolClasses).values({
                    schoolId: id,
                    classId: existingLocalClass.id,
                    status: 'approved',
                  });
                }

                if (originalSchoolId != null && originalSchoolId !== id) {
                  const [existingOriginalSchoolClass] = await db.select().from(schoolClasses).where(
                    and(
                      eq(schoolClasses.schoolId, originalSchoolId),
                      eq(schoolClasses.classId, existingLocalClass.id)
                    )
                  ).limit(1);

                  if (!existingOriginalSchoolClass) {
                    await db.insert(schoolClasses).values({
                      schoolId: originalSchoolId,
                      classId: existingLocalClass.id,
                      status: 'approved',
                    });
                  }
                }
                continue;
              }

              try {
                const [newClass] = await db.insert(classes).values({
                  name: trimmedClassName,
                  schoolId: null,
                  academicYearId: yearId,
                  progressionCode: normalizeClassProgressionCode(trimmedClassName),
                }).returning();

                await db.insert(schoolClasses).values({
                  schoolId: id,
                  classId: newClass.id,
                  status: 'approved',
                });
              } catch (classErr: any) {
                console.warn(`Warning: Could not create class "${trimmedClassName}" during school update:`, classErr?.message);
              }
            }
          }
        } catch (classCreationErr: any) {
          console.warn('Warning: Could not create classes during school update:', classCreationErr?.message);
        }
      }

      if (Array.isArray(subjectNames) && subjectNames.length > 0) {
        try {
          for (const subjectName of subjectNames) {
            const trimmedSubjectName = String(subjectName || '').trim();
            if (!trimmedSubjectName) continue;

            const [globalSubject] = await db.select().from(subjects).where(
              and(sql`${subjects.schoolId} IS NULL`, eq(subjects.name, trimmedSubjectName))
            ).limit(1);

            if (globalSubject) {
              const subjectId = globalSubject.id;
              const existingSchoolSubject = await db.select().from(schoolSubjects).where(
                and(
                  eq(schoolSubjects.schoolId, id),
                  eq(schoolSubjects.subjectId, subjectId)
                )
              ).limit(1);
              if (existingSchoolSubject.length > 0) continue;

              await db.insert(schoolSubjects).values({
                schoolId: id,
                subjectId,
                status: 'approved',
              });
              continue;
            }

            const existingSubject = await db.select().from(subjects).where(and(eq(subjects.schoolId, id), eq(subjects.name, trimmedSubjectName))).limit(1);
            if (existingSubject.length > 0) continue;

            await db.insert(subjects).values({
              name: trimmedSubjectName,
              schoolId: id,
            });
          }
        } catch (subjectCreationErr: any) {
          console.warn('Warning: Could not create subjects during school update:', subjectCreationErr?.message);
        }
      }

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
      await logAuditEvent(actor, 'update', 'school', id, id, `Super admin ${actor.email || actor.uid} updated school "${existingSchool.name}". ${diffDescription}`);
      
      res.json(result[0]);
    } catch (err: any) {
      console.error('Error updating school:', err);
      res.status(500).json({ error: 'Failed to update school' });
    }
  });

  app.post('/api/schools/:id/logo', requireAuth, async (req: AuthRequest, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid school id' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ error: 'User not found' });
    if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
      return res.status(403).json({ error: 'Only school administrators can modify school information' });
    }
    if (actor.role === 'school_admin' && actor.schoolId !== id) {
      return res.status(403).json({ error: 'Cannot modify another school' });
    }
    const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, id));
    if (!school) return res.status(404).json({ error: 'School not found' });

    schoolLogoUpload.single('logo')(req, res, (err: any) => {
      if (err) return res.status(400).json({ error: err.message || 'Invalid school logo upload' });
      next();
    });
  }, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid school id' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Only school administrators can modify school information' });
      }
      if (actor.role === 'school_admin' && actor.schoolId !== id) {
        return res.status(403).json({ error: 'Cannot modify another school' });
      }

      const [existingSchool] = await db.select({ id: schools.id, logoPath: schools.logoPath }).from(schools).where(eq(schools.id, id));
      if (!existingSchool) return res.status(404).json({ error: 'School not found' });

      const uploadedFile = (req as any).file as Express.Multer.File | undefined;
      if (!uploadedFile) return res.status(400).json({ error: 'A PNG or JPG/JPEG logo file is required' });

      let newLogoPath: string | null = null;
      try {
        const persistedLogo = await persistUploadedFile({
          originalname: uploadedFile.originalname,
          buffer: uploadedFile.buffer,
          mimetype: uploadedFile.mimetype,
          size: uploadedFile.size,
        }, 'school-logos');
        newLogoPath = buildSchoolLogoRelativePath(persistedLogo.storedReference);

        const [updatedSchool] = await db.update(schools)
          .set({ logoPath: newLogoPath })
          .where(eq(schools.id, id))
          .returning();

        if (!updatedSchool) {
          throw new Error('School logo reference was not updated.');
        }

        if (existingSchool.logoPath && existingSchool.logoPath !== newLogoPath) {
          await deleteStoredFile(existingSchool.logoPath, 'school-logos').catch((cleanupError: any) => {
            console.warn('Failed to remove replaced school logo:', cleanupError?.message || cleanupError);
          });
        }

        await logAuditEvent(actor, 'update', 'school_logo', id, id, `Updated school logo for school ${id}`);
        return res.status(200).json({ id: updatedSchool.id, logoPath: updatedSchool.logoPath });
      } catch (error) {
        if (newLogoPath) {
          await deleteStoredFile(newLogoPath, 'school-logos').catch((cleanupError: any) => {
            console.warn('Failed to clean unreferenced school logo after upload failure:', cleanupError?.message || cleanupError);
          });
        }
        throw error;
      }
    } catch (err: any) {
      console.error('Failed to upload school logo:', err);
      return res.status(500).json({ error: 'Failed to upload school logo' });
    }
  });

  app.get('/api/schools/:id/logo', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid school id' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
      const [school] = await db.select({ id: schools.id, schoolId: schools.id, logoPath: schools.logoPath }).from(schools).where(eq(schools.id, id));
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (actor.role !== 'super_admin' && actor.schoolId !== school.schoolId) return res.status(403).json({ error: 'Forbidden' });
      if (!school.logoPath) return res.status(404).json({ error: 'No school logo configured' });

      const logoFileName = sanitizeFileName(path.basename(school.logoPath));
      const logoContent = await readStoredFile('school-logos', school.logoPath);
      if (!logoContent) return res.status(404).json({ error: 'School logo file not found' });
      const extension = path.extname(logoFileName).toLowerCase();
      const contentType = extension === '.png' ? 'image/png' : 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${logoFileName}"`);
      res.setHeader('Cache-Control', 'private, no-cache');
      return res.send(logoContent);
    } catch (err: any) {
      console.error('Failed to retrieve school logo:', err);
      return res.status(500).json({ error: 'Failed to retrieve school logo' });
    }
  });

  // Get a single school by id (allowed for super_admin or users belonging to that school)
  app.get('/api/schools/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid school id' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthenticated' });

      const [schoolRow] = await db.select().from(schools).where(eq(schools.id, id));
      if (!schoolRow) return res.status(404).json({ error: 'École introuvable' });

      if (actor.role === 'super_admin' || (actor.schoolId && Number(actor.schoolId) === id)) {
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
      const rows = [
        ['firstName', 'lastName', 'birthDate', 'schoolId', 'classId', 'parentId', 'parentName', 'parentEmail', 'parentPhonePrefix', 'parentPhone', 'academicYearId', 'studentStatus', 'teacherId', 'schoolAdminId', 'gender'],
        ['Lucas', 'Dubois', '2008-04-12', 1, 1, '', 'Marie Dubois', 'marie.dubois@example.com', '+228', '90000001', 1, '', 2, 1, 'Masculin'],
        ['Chloe', 'Dubois', '2010-09-25', 1, 1, '', 'Paul Dubois', '', '', '+22890000002', 1, '', 3, 1, 'Féminin'],
      ];
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('students').addRows(rows);
      const instructions = [
        ['Identification du parent'],
        ['Renseigner au moins une des colonnes parentId, parentPhone ou parentEmail.'],
        ['parentId est l’identifiant du profil parents.id. parentEmail reste accepté pour les anciens fichiers.'],
        ['Pour un numéro local, saisir le préfixe dans parentPhonePrefix et le numéro local dans parentPhone.'],
        ['Pour un numéro complet, laisser parentPhonePrefix vide et saisir le numéro dans parentPhone.'],
        ['Exemples', 'parentPhonePrefix', 'parentPhone', 'Résultat canonique'],
        ['Numéro local', '228', '90121212', '+22890121212'],
        ['Numéro local', '+228', '90121212', '+22890121212'],
        ['Numéro complet', '', '+22890121212', '+22890121212'],
        ['Numéro complet', '', '0022890121212', '+22890121212'],
        ['Numéro complet', '', '228 90121212', '+22890121212'],
        ['En cas de parent introuvable, ambigu ou de clés contradictoires, la ligne est rejetée.'],
      ];
      wb.addWorksheet('instructions').addRows(instructions);
      const buf = await wb.xlsx.writeBuffer();
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
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User profile not found' });
      const userRecord: any = actor;
      if (!actor.id && actor.simulated && actor.role === 'super_admin') {
        console.log('Simulated super_admin detected and no DB profile found; bypassing user lookup for dev.');
      }

      // Only super_admin or school_admin may import students
      if (!['super_admin', 'school_admin'].includes(userRecord.role)) {
        return res.status(403).json({ error: 'Permission denied' });
      }

      const payload = req.body;
      if (!Array.isArray(payload)) return res.status(400).json({ error: 'Expected an array of students' });

      const validGenderValues = ['M', 'F', 'Masculin', 'Féminin', 'Feminin', 'm', 'f', 'male', 'female', 'masculin', 'feminin', 'homme', 'femme', 'garcon', 'fille'];

      // Pre-validate referenced IDs to provide clear errors instead of DB constraint failures
      const schoolIds = Array.from(new Set(payload.map((p: any) => p.schoolId).filter(Boolean).map((v: any) => parseInt(v))));
      const classIds = Array.from(new Set(payload.map((p: any) => p.classId).filter(Boolean).map((v: any) => parseInt(v))));
      const parentIds = Array.from(new Set(payload.map((p: any) => p.parentId).filter(Boolean).map((v: any) => parseInt(v))));
      const parentEmails = Array.from(new Set(payload
        .map((p: any) => normalizeEmail(p.parentEmail))
        .filter((email): email is string => Boolean(email))));
      const parentPhoneInputs = payload.map((p: any) => ({
        phone: typeof p.parentPhone === 'string' ? p.parentPhone.trim() : '',
        prefix: typeof p.parentPhonePrefix === 'string' ? p.parentPhonePrefix.trim() : '',
      }));
      const canonicalParentPhones = parentPhoneInputs
        .map(({ phone, prefix }) => phone ? canonicalizeUserPhone(phone, prefix || undefined) : null)
        .filter((phone): phone is string => Boolean(phone));

      if (userRecord.role === 'school_admin' && userRecord.schoolId) {
        schoolIds.push(userRecord.schoolId);
      }

      const existingSchoolRows = schoolIds.length > 0 ? await db.select().from(schools).where(sql`${schools.id} IN ${schoolIds}`) : [];
      const existingClassRows = classIds.length > 0 ? await db.select({ id: classes.id, schoolId: classes.schoolId, academicYearId: classes.academicYearId }).from(classes).where(sql`${classes.id} IN ${classIds}`) : [];
      const parentLookupRows = parentIds.length > 0 || parentEmails.length > 0 || canonicalParentPhones.length > 0
        ? await db.select({ id: parents.id, userId: parents.userId, schoolId: parents.schoolId }).from(parents)
        : [];
      const existingParentRows = parentLookupRows;
      const contactParentRows = parentLookupRows;
      const contactParentUserIds = Array.from(new Set(contactParentRows.map((parent: any) => parent.userId).filter(Boolean)));
      const contactParentUsers = contactParentUserIds.length > 0
        ? await db.select({ id: users.id, email: users.email, phone: users.phone }).from(users)
        : [];
      const parentEmailById = new Map<number, string>();
      const userEmailById = new Map<number, string>();
      const parentPhoneById = new Map<number, string>();
      const userPhoneById = new Map<number, string>();
      for (const user of contactParentUsers) {
        const normalizedEmail = normalizeEmail(user.email);
        if (normalizedEmail) userEmailById.set(Number(user.id), normalizedEmail);
        const canonicalPhone = canonicalizeUserPhone(user.phone);
        if (canonicalPhone) userPhoneById.set(Number(user.id), canonicalPhone);
      }
      for (const parent of contactParentRows) {
        const normalizedEmail = userEmailById.get(Number(parent.userId));
        if (normalizedEmail) parentEmailById.set(Number(parent.id), normalizedEmail);
        const canonicalPhone = userPhoneById.get(Number(parent.userId));
        if (canonicalPhone) parentPhoneById.set(Number(parent.id), canonicalPhone);
      }

      const existingSchoolIds = new Set(existingSchoolRows.map((r: any) => r.id));
      const existingClassIds = new Set(existingClassRows.map((r: any) => r.id));
      const existingParentIds = new Set(existingParentRows.map((r: any) => r.id));

      if (userRecord.role === 'school_admin') {
        const lockedSchool = existingSchoolRows.find((r: any) => r.studentsCreationLocked === true);
        if (lockedSchool) {
          return res.status(403).json({ error: "L'import d'élèves est impossible : la création d'élèves est verrouillée pour cet établissement." });
        }
      }

      const inserted: any[] = [];
      const errors: any[] = [];
      const parentEmailResolutionCache = new Map<number, Map<string, { parent: any }[]>>();
      const parentPhoneResolutionCache = new Map<number, Map<string, { parent: any }[]>>();

      const resolveParentsByEmail = async (email: string, schoolId: number) => {
        let schoolCache = parentEmailResolutionCache.get(schoolId);
        if (!schoolCache) {
          schoolCache = new Map();
          parentEmailResolutionCache.set(schoolId, schoolCache);
        }
        const cached = schoolCache.get(email);
        if (cached) return cached;

        const candidates = contactParentRows.filter((parent: any) => parentEmailById.get(Number(parent.id)) === email);
        const authorizedCandidates: { parent: any }[] = [];
        for (const parent of candidates) {
          if (parent.schoolId === schoolId || await ensureUserSchoolMembership(parent.userId, schoolId, 'parent')) {
            authorizedCandidates.push({ parent });
          }
        }
        schoolCache.set(email, authorizedCandidates);
        return schoolCache.get(email) || [];
      };
      const resolveParentsByPhone = async (phone: string, schoolId: number) => {
        let schoolCache = parentPhoneResolutionCache.get(schoolId);
        if (!schoolCache) {
          schoolCache = new Map();
          parentPhoneResolutionCache.set(schoolId, schoolCache);
        }
        const cached = schoolCache.get(phone);
        if (cached) return cached;

        const candidates = contactParentRows.filter((parent: any) => parentPhoneById.get(Number(parent.id)) === phone);
        const authorizedCandidates: { parent: any }[] = [];
        for (const parent of candidates) {
          if (parent.schoolId === schoolId || await ensureUserSchoolMembership(parent.userId, schoolId, 'parent')) {
            authorizedCandidates.push({ parent });
          }
        }
        schoolCache.set(phone, authorizedCandidates);
        return schoolCache.get(phone) || [];
      };

      for (let i = 0; i < payload.length; i++) {
        const s = payload[i];
        const firstName = normalizeFirstName(s.firstName);
        const lastName = s.lastName?.trim().toUpperCase();
        const birthDate = s.birthDate?.trim() || '';
        const rawAcademicYearId = s.academicYearId !== undefined && s.academicYearId !== null && String(s.academicYearId).trim() !== ''
          ? String(s.academicYearId).trim()
          : null;
        const parsedAcademicYearId = rawAcademicYearId !== null ? Number(rawAcademicYearId) : null;
        const normalizedStudentStatus = s.studentStatus !== undefined && s.studentStatus !== null && String(s.studentStatus).trim() !== ''
          ? String(s.studentStatus).trim()
          : null;
        const resolvedSchoolId = userRecord.role === 'school_admin' ? userRecord.schoolId : s.schoolId;
        const schoolId = resolvedSchoolId ? parseInt(resolvedSchoolId) : null;
        const classId = s.classId ? parseInt(s.classId) : null;
        const hasParentId = s.parentId !== undefined && s.parentId !== null && String(s.parentId).trim() !== '';
        const parentIdText = hasParentId ? String(s.parentId).trim() : '';
        const hasParentPhone = s.parentPhone !== undefined && s.parentPhone !== null && String(s.parentPhone).trim() !== '';
        const normalizedParentPhone = hasParentPhone
          ? canonicalizeUserPhone(String(s.parentPhone), typeof s.parentPhonePrefix === 'string' ? s.parentPhonePrefix : undefined)
          : null;
        const hasParentEmail = s.parentEmail !== undefined && s.parentEmail !== null && String(s.parentEmail).trim() !== '';
        const normalizedParentEmail = normalizeEmail(s.parentEmail);
        let parentId = hasParentId ? Number(parentIdText) : null;
        const gender = s.gender != null && s.gender !== '' ? String(s.gender).trim() : null;

        if (!firstName || !lastName) {
          errors.push({ row: i, reason: 'Missing firstName or lastName', data: s });
          continue;
        }
        if (!gender) {
          errors.push({ row: i, reason: 'Gender is required for each student', data: s });
          continue;
        }
        const normalizedGenderKey = gender.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!validGenderValues.includes(gender) && !validGenderValues.includes(normalizedGenderKey)) {
          errors.push({ row: i, reason: 'Invalid gender value. Use M or F / Masculin or Féminin.', data: s });
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
        if (hasParentId && (!/^\d+$/.test(parentIdText) || parentId === null || parentId <= 0)) {
          errors.push({ row: i, reason: `Invalid parentId: ${parentIdText}`, data: s });
          continue;
        }
        if (!hasParentId && !hasParentPhone && !hasParentEmail) {
          errors.push({ row: i, reason: 'Parent non identifiable : fournissez parentId, parentPhone ou parentEmail', data: s });
          continue;
        }
        if (hasParentPhone && !normalizedParentPhone) {
          errors.push({ row: i, reason: 'parentPhone invalide ou impossible à normaliser', data: s });
          continue;
        }
        if (hasParentEmail && !normalizedParentEmail) {
          errors.push({ row: i, reason: 'parentEmail invalide', data: s });
          continue;
        }
        const parentLookupSchoolId = schoolId;
        if (!parentLookupSchoolId) {
          errors.push({ row: i, reason: 'Établissement invalide pour rechercher le parent', data: s });
          continue;
        }

        const requestedParentRow = hasParentId
          ? existingParentRows.find((parent: any) => Number(parent.id) === parentId)
          : null;
        if (hasParentId && !requestedParentRow) {
          errors.push({ row: i, reason: `Invalid or missing parentId: ${parentId}`, data: s });
          continue;
        }

        const phoneMatches = normalizedParentPhone
          ? await resolveParentsByPhone(normalizedParentPhone, parentLookupSchoolId)
          : [];
        const emailMatches = normalizedParentEmail
          ? await resolveParentsByEmail(normalizedParentEmail, parentLookupSchoolId)
          : [];
        const resolveContactMatch = (matches: { parent: any }[], contact: string, kind: 'phone' | 'email') => {
          if (matches.length === 0) {
            return { error: kind === 'phone'
              ? `Parent introuvable pour le téléphone ${contact} dans cet établissement`
              : `Parent introuvable pour l'email ${contact} dans cet établissement` };
          }
          if (matches.length > 1) {
            return { error: kind === 'phone'
              ? `Plusieurs parents correspondent au téléphone ${contact}`
              : `Plusieurs parents correspondent à l'email ${contact}` };
          }
          return { parent: matches[0].parent };
        };

        if (normalizedParentPhone) {
          const result = resolveContactMatch(phoneMatches, normalizedParentPhone, 'phone');
          if ('error' in result) {
            errors.push({ row: i, reason: result.error, data: s });
            continue;
          }
          if (hasParentId && Number(result.parent.id) !== Number(parentId)) {
            errors.push({ row: i, reason: 'Le parentId fourni ne correspond pas au parentPhone fourni', data: s });
            continue;
          }
          if (!hasParentId) parentId = Number(result.parent.id);
        }
        if (normalizedParentEmail) {
          const result = resolveContactMatch(emailMatches, normalizedParentEmail, 'email');
          if ('error' in result) {
            errors.push({ row: i, reason: result.error, data: s });
            continue;
          }
          if (parentId !== null && Number(result.parent.id) !== Number(parentId)) {
            errors.push({ row: i, reason: hasParentId
              ? 'Le parentId fourni ne correspond pas au parentEmail fourni'
              : 'Le parentPhone fourni ne correspond pas au parentEmail fourni', data: s });
            continue;
          }
          if (!hasParentId && !normalizedParentPhone) parentId = Number(result.parent.id);
        }
        if (!parentId || !existingParentIds.has(parentId)) {
          errors.push({ row: i, reason: `Invalid or missing parentId: ${parentId}`, data: s });
          continue;
        }

        const classRow = existingClassRows.find((c: any) => c.id === classId);
        if (!classRow) {
          errors.push({ row: i, reason: `Class not found: ${classId}`, data: s });
          continue;
        }
        if (normalizedStudentStatus !== null && !isStudentAcademicYearStatus(normalizedStudentStatus)) {
          errors.push({ row: i, reason: `studentStatus invalide: ${normalizedStudentStatus}`, data: s });
          continue;
        }
        if (parsedAcademicYearId !== null && (!Number.isInteger(parsedAcademicYearId) || parsedAcademicYearId <= 0 || parsedAcademicYearId !== classRow.academicYearId)) {
          errors.push({ row: i, reason: `academicYearId ${parsedAcademicYearId} ne correspond pas à l'année de la classe ${classRow.academicYearId}`, data: s });
          continue;
        }
        if (classRow.schoolId !== schoolId) {
          const classAllowed = classRow.schoolId == null && await isApprovedClassForSchool(classId, schoolId);
          if (!classAllowed) {
            errors.push({ row: i, reason: `Class ${classId} does not belong to school ${schoolId}`, data: s });
            continue;
          }
        }

        const parentRow = existingParentRows.find((p: any) => p.id === parentId);
        const resolvedParentRow = parentRow || contactParentRows.find((p: any) => p.id === parentId);
        if (!resolvedParentRow) {
          errors.push({ row: i, reason: `Parent not found: ${parentId}`, data: s });
          continue;
        }
        if (resolvedParentRow.schoolId !== schoolId) {
          const membership = await ensureUserSchoolMembership(resolvedParentRow.userId, schoolId, 'parent');
          if (!membership) {
            errors.push({ row: i, reason: `Parent ${parentId} does not belong to school ${schoolId}`, data: s });
            continue;
          }
        }
        if (normalizedParentEmail && parentEmailById.get(Number(resolvedParentRow.id)) !== normalizedParentEmail) {
          errors.push({ row: i, reason: 'Le parentId fourni ne correspond pas au parentEmail fourni', data: s });
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

          const result = await db.transaction(async (tx) => {
            const createdStudents = await tx.insert(students).values({
              firstName,
              lastName,
              birthDate,
              schoolId,
              classId,
              parentId,
              schoolAdminId: resolvedSchoolAdminId,
              gender,
            }).returning();

            const selectedAcademicYearId = parsedAcademicYearId ?? classRow.academicYearId;
            if (normalizedStudentStatus !== null) {
              await tx.insert(studentAcademicYearStatuses).values({
                studentId: createdStudents[0].id,
                academicYearId: selectedAcademicYearId,
                status: normalizedStudentStatus,
              });
            }

            return createdStudents[0];
          });

          inserted.push(result);
        } catch (e: any) {
          console.error('Insert student failed for row', i, e?.message || e);
          errors.push({ row: i, reason: e?.message || 'Insert failed', data: s });
        }
      }

      res.json({ insertedCount: inserted.length, inserted, errors });
    } catch (err: any) {
      console.error('Error in students batch import:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
    

  app.delete('/api/schools/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!req.user) {
        return res.status(401).json({ error: 'Utilisateur non authentifié.' });
      }

      const actor = await resolveActor(req);
      if (!actor) {
        return res.status(404).json({ error: 'Profil utilisateur introuvable.' });
      }

      if (actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Seul un super administrateur peut supprimer un établissement.' });
      }

      const [school] = await db.select().from(schools).where(eq(schools.id, id));
      if (!school) {
        return res.status(404).json({ error: 'École introuvable.' });
      }

      const [financialHistory] = await db.select({ id: financialObligations.id })
        .from(financialObligations)
        .where(eq(financialObligations.schoolId, id))
        .limit(1);
      const [paymentHistory] = await db.select({ id: financialPayments.id })
        .from(financialPayments)
        .where(eq(financialPayments.schoolId, id))
        .limit(1);
      if (financialHistory || paymentHistory) {
        return res.status(409).json({
          error: 'Cette école possède un historique comptable et ne peut pas être supprimée.',
        });
      }

      await db.transaction(async (tx) => {
        const schoolUserIds = (await tx.select({ id: users.id }).from(users).where(eq(users.schoolId, id))).map((u) => u.id);
        const classIds = (await tx.select({ id: classes.id }).from(classes).where(eq(classes.schoolId, id))).map((c) => c.id);
        const studentIds = (await tx.select({ id: students.id }).from(students).where(eq(students.schoolId, id))).map((s) => s.id);
        const academicYearIds = (await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.schoolId, id))).map((a) => a.id);
        const evaluationIds = classIds.length > 0
          ? (await tx.select({ id: evaluations.id }).from(evaluations).where(sql`${evaluations.classId} IN ${classIds}`)).map((e) => e.id)
          : [];

        console.log('School deletion transaction started');

        await tx.delete(accountingScheduleTemplates).where(eq(accountingScheduleTemplates.schoolId, id));
        await tx.delete(accountingTariffs).where(eq(accountingTariffs.schoolId, id));
        await tx.delete(accountingFeeDefinitions).where(eq(accountingFeeDefinitions.schoolId, id));
        await tx.delete(accountingCategories).where(eq(accountingCategories.schoolId, id));

        if (schoolUserIds.length > 0) {
          console.log('Deleting school notifications');
          await tx.delete(notifications).where(sql`${notifications.userId} IN ${schoolUserIds}`);
        }

        if (studentIds.length > 0) {
          console.log('Deleting school student absences');
          await tx.delete(absences).where(sql`${absences.studentId} IN ${studentIds}`);
        }
        if (classIds.length > 0) {
          console.log('Deleting school class absences');
          await tx.delete(absences).where(sql`${absences.classId} IN ${classIds}`);
        }

        if (studentIds.length > 0) {
          console.log('Deleting school student grades');
          await tx.delete(grades).where(sql`${grades.studentId} IN ${studentIds}`);
        }
        if (evaluationIds.length > 0) {
          console.log('Deleting school evaluation grades');
          await tx.delete(grades).where(sql`${grades.evaluationId} IN ${evaluationIds}`);
        }

        if (evaluationIds.length > 0) {
          console.log('Deleting school evaluations');
          await tx.delete(evaluations).where(sql`${evaluations.id} IN ${evaluationIds}`);
        }

        if (studentIds.length > 0) {
          console.log('Deleting school students');
          await tx.delete(students).where(sql`${students.id} IN ${studentIds}`);
        }

        if (schoolUserIds.length > 0) {
          console.log('Deleting school parent profiles');
          await tx.delete(parents).where(sql`${parents.userId} IN ${schoolUserIds}`);
        }

        if (classIds.length > 0) {
          console.log('Clearing school class teacher assignments');
          await tx.update(classes).set({ teacherId: null }).where(sql`${classes.id} IN ${classIds}`);
        }

        if (schoolUserIds.length > 0) {
          console.log('Removing school administrator associations and user audit events');
          await tx.update(students).set({ schoolAdminId: null }).where(sql`${students.schoolAdminId} IN ${schoolUserIds}`);
          await tx.delete(auditEvents).where(sql`${auditEvents.actorUserId} IN ${schoolUserIds}`);
        }

        if (schoolUserIds.length > 0) {
          console.log('Deleting school local authentication records');
          await tx.delete(localAuths).where(sql`${localAuths.userId} IN ${schoolUserIds}`);
        }

        console.log('Step 12/12: delete audit events linked directly to school');
        await tx.delete(auditEvents).where(eq(auditEvents.schoolId, id));

        console.log('Deleting remaining school records');
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
      // Log the underlying error server-side for diagnostics, but do not expose details to clients.
      const errorMessage = err?.message && (err.message.includes('constraint') || err.message.includes('foreign key'))
        ? 'Impossible de supprimer cette école car elle contient des données liées. Supprimez d’abord les éléments associés.'
        : err?.message || 'Impossible de supprimer l’école.';
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 2. Academic Years - Filtered by school
  app.get('/api/academic-years', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let list: any[];
      if (actor.role === 'super_admin') {
        list = await db.select().from(academicYears);
      } else if (actor.role === 'school_admin') {
        // School admin sees ONLY their assigned academic year
        if (actor.academicYearId) {
          list = await db.select().from(academicYears).where(eq(academicYears.id, actor.academicYearId));
        } else {
          // If no assigned year, return empty list (admin must have an assigned year)
          list = [];
        }
      } else {
        // Teachers and parents see global academic years plus any legacy school-specific ones
        list = await db.select().from(academicYears).where(
          or(
            sql`${academicYears.schoolId} IS NULL`,
            eq(academicYears.schoolId, actor.schoolId)
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

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      if (actor.role !== 'super_admin') {
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

  app.put('/api/academic-years/:id/activate', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid academic year id' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admin can set active academic year' });
      }

      const [targetYear] = await db.select().from(academicYears).where(eq(academicYears.id, id));
      if (!targetYear) return res.status(404).json({ error: 'Academic year not found' });

      await db.update(academicYears).set({ isActive: false });
      await db.update(academicYears).set({ isActive: true }).where(eq(academicYears.id, id));

      const [updated] = await db.select().from(academicYears).where(eq(academicYears.id, id));
      res.json(updated);
    } catch (err: any) {
      console.error('Failed to activate academic year:', err);
      res.status(500).json({ error: 'Failed to activate academic year' });
    }
  });

  app.delete('/api/academic-years/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid academic year id' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admin can delete academic years' });
      }

      const [targetYear] = await db.select().from(academicYears).where(eq(academicYears.id, id));
      if (!targetYear) return res.status(404).json({ error: 'Academic year not found' });

      await db.delete(academicYears).where(eq(academicYears.id, id));
      res.json({ success: true });
    } catch (err: any) {
      console.error('Failed to delete academic year:', err);
      if (err?.code === '23503' || err?.cause?.code === '23503') {
        return res.status(409).json({ error: 'Impossible de supprimer cette année: elle est utilisée par des classes, trimestres ou utilisateurs.' });
      }
      res.status(500).json({ error: 'Failed to delete academic year' });
    }
  });

  // Global education structure and school cycle assignments
  app.get('/api/education/cycles', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const rows = await db.select().from(cycles).where(eq(cycles.isActive, true));
      return res.json(rows);
    } catch (err) {
      console.error('Failed to fetch education cycles:', err);
      return res.status(500).json({ error: 'Failed to fetch education cycles' });
    }
  });

  app.get('/api/education/levels', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const rows = await db.select().from(levels).where(eq(levels.isActive, true)).orderBy(levels.orderIndex);
      return res.json(rows);
    } catch (err) {
      console.error('Failed to fetch education levels:', err);
      return res.status(500).json({ error: 'Failed to fetch education levels' });
    }
  });

  app.get('/api/education/cycle-period-templates', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const rows = await db.select().from(cyclePeriodTemplates).where(eq(cyclePeriodTemplates.isActive, true)).orderBy(cyclePeriodTemplates.orderIndex);
      return res.json(rows);
    } catch (err) {
      console.error('Failed to fetch cycle period templates:', err);
      return res.status(500).json({ error: 'Failed to fetch cycle period templates' });
    }
  });

  app.get('/api/schools/:schoolId/cycles', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const schoolId = Number(req.params.schoolId);
      if (!Number.isInteger(schoolId) || schoolId <= 0) return res.status(400).json({ error: 'Invalid schoolId' });
      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });
      const rows = await db.select().from(schoolCycles).where(eq(schoolCycles.schoolId, schoolId));
      return res.json(rows);
    } catch (err) {
      console.error('Failed to fetch school cycles:', err);
      return res.status(500).json({ error: 'Failed to fetch school cycles' });
    }
  });

  app.put('/api/schools/:schoolId/cycles', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const schoolId = Number(req.params.schoolId);
      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });
      const requestedCodes = Array.isArray(req.body?.cycleCodes) ? req.body.cycleCodes.map((value: unknown) => String(value)) : [];
      const availableCycles = await db.select().from(cycles).where(eq(cycles.isActive, true));
      const selectedCycles = availableCycles.filter((cycle) => requestedCodes.includes(cycle.code));
      if (selectedCycles.length !== requestedCodes.length) return res.status(400).json({ error: 'Unknown education cycle' });
      await db.delete(schoolCycles).where(eq(schoolCycles.schoolId, schoolId));
      if (selectedCycles.length > 0) {
        await db.insert(schoolCycles).values(selectedCycles.map((cycle) => ({ schoolId, cycleId: cycle.id, isActive: true })));
      }
      return res.json(await db.select().from(schoolCycles).where(eq(schoolCycles.schoolId, schoolId)));
    } catch (err) {
      console.error('Failed to update school cycles:', err);
      return res.status(500).json({ error: 'Failed to update school cycles' });
    }
  });

  app.get('/api/schools/:schoolId/period-type-approvals', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      const schoolId = parsePositiveInteger(req.params.schoolId);
      if (!actor || schoolId == null) return res.status(403).json({ error: 'Forbidden' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });
      return res.json(await getSchoolPeriodTypeStates(schoolId));
    } catch (error) {
      console.error('Failed to list school period type approvals:', error);
      return res.status(500).json({ error: 'Failed to list period type approvals' });
    }
  });

  app.post('/api/schools/:schoolId/period-types/:periodType/:decision', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      const schoolId = parsePositiveInteger(req.params.schoolId);
      const periodType = String(req.params.periodType);
      const decision = String(req.params.decision);
      if (!actor || schoolId == null) return res.status(403).json({ error: 'Forbidden' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });
      if (!['trimester', 'semester'].includes(periodType)) return res.status(400).json({ error: 'Invalid period type' });
      if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Invalid period type decision' });

      const states = await getSchoolPeriodTypeStates(schoolId);
      const current = states.find((state) => state.periodType === periodType);
      if (decision === 'approve' && !current?.cycleActive) {
        return res.status(409).json({ error: 'The matching education cycle must be active before approving this period type' });
      }

      const status = decision === 'approve' ? 'approved' : 'rejected';
      await db.insert(schoolPeriodTypeApprovals)
        .values({ schoolId, periodType, status, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schoolPeriodTypeApprovals.schoolId, schoolPeriodTypeApprovals.periodType],
          set: { status, updatedAt: new Date() },
        });
      return res.json((await getSchoolPeriodTypeStates(schoolId)).find((state) => state.periodType === periodType));
    } catch (error) {
      console.error('Failed to update school period type approval:', error);
      return res.status(500).json({ error: 'Failed to update period type approval' });
    }
  });

  // School Terms (operational periods) - CRUD
  app.get('/api/school-terms', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const academicYearId = req.query.academicYearId ? Number(req.query.academicYearId) : undefined;
      const schoolIdParam = req.query.schoolId ? Number(req.query.schoolId) : undefined;
      const availableOnly = req.query.availableOnly === 'true' || req.query.availableOnly === '1';
      const globalOnly = req.query.globalOnly === 'true' || req.query.globalOnly === '1';

      let rows: any[] = [];
      if (actor.role === 'super_admin') {
        if (globalOnly && academicYearId != null) {
          rows = await db.select().from(schoolTerms).where(and(
            sql`${schoolTerms.schoolId} IS NULL`,
            eq(schoolTerms.academicYearId, academicYearId),
          ));
        } else if (globalOnly) {
          rows = await db.select().from(schoolTerms).where(sql`${schoolTerms.schoolId} IS NULL`);
        } else if (availableOnly && schoolIdParam != null) {
          const conditions = [
            or(sql`${schoolTerms.schoolId} IS NULL`, eq(schoolTerms.schoolId, schoolIdParam)),
          ];
          if (academicYearId != null) conditions.push(eq(schoolTerms.academicYearId, academicYearId));
          rows = await db.select().from(schoolTerms).where(and(...conditions));
        } else if (academicYearId != null) {
          rows = await db.select().from(schoolTerms).where(eq(schoolTerms.academicYearId, academicYearId));
        } else if (schoolIdParam != null) {
          rows = await db.select().from(schoolTerms).where(eq(schoolTerms.schoolId, schoolIdParam));
        } else {
          rows = await db.select().from(schoolTerms);
        }
      } else if (actor.role === 'school_admin') {
        const targetSchoolId = actor.schoolId;
        if (!targetSchoolId) return res.status(403).json({ error: 'School context required' });
        if (academicYearId != null) {
          rows = await db.select().from(schoolTerms).where(
            and(
              or(sql`${schoolTerms.schoolId} IS NULL`, eq(schoolTerms.schoolId, targetSchoolId)),
              eq(schoolTerms.academicYearId, academicYearId),
            ),
          );
        } else {
          rows = await db.select().from(schoolTerms).where(
            or(sql`${schoolTerms.schoolId} IS NULL`, eq(schoolTerms.schoolId, targetSchoolId)),
          );
        }
      } else {
        // teacher/parent: show global terms plus school-specific ones
        const schoolId = actor.schoolId;
        if (schoolId == null) return res.json([]);
        if (academicYearId != null) {
          rows = await db.select().from(schoolTerms).where(and(or(sql`${schoolTerms.schoolId} IS NULL`, eq(schoolTerms.schoolId, schoolId)), eq(schoolTerms.academicYearId, academicYearId)));
        } else {
          rows = await db.select().from(schoolTerms).where(or(sql`${schoolTerms.schoolId} IS NULL`, eq(schoolTerms.schoolId, schoolId)));
        }
      }

      if (availableOnly) {
        const targetSchoolId = actor.role === 'super_admin' ? schoolIdParam : actor.schoolId;
        if (targetSchoolId == null) return res.status(400).json({ error: 'schoolId is required to list available periods' });
        const states = await getSchoolPeriodTypeStates(targetSchoolId);
        const classIdParam = req.query.classId == null ? null : Number(req.query.classId);
        if (classIdParam != null && (!Number.isInteger(classIdParam) || classIdParam <= 0)) {
          return res.status(400).json({ error: 'Invalid classId' });
        }
        const education = classIdParam == null ? null : await resolveCycleForClass(classIdParam);
        if (classIdParam != null && !education) return res.status(404).json({ error: 'Class not found' });
        rows = filterAvailableSchoolTerms(rows, states, education);
      }

      res.json(rows);
    } catch (err: any) {
      console.error('Failed to fetch school terms:', err);
      res.status(500).json({ error: 'Failed to fetch school terms' });
    }
  });

  app.post('/api/school-terms', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

      const { academicYearId, cycleId, periodType, templateId, name, startDate, endDate, orderIndex, isActive } = req.body as any;
      if (!academicYearId || !name) return res.status(400).json({ error: 'academicYearId and name are required' });

      const targetSchoolId: number | null = null;

      const vals: any = {
        academicYearId: Number(academicYearId),
        cycleId: cycleId != null && cycleId !== '' ? Number(cycleId) : null,
        templateId: templateId != null && templateId !== '' ? Number(templateId) : null,
        periodType: periodType ?? null,
        name: String(name),
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        orderIndex: Number(orderIndex) || 1,
        isActive: isActive != null ? !!isActive : true,
        schoolId: targetSchoolId,
      };

      const sameContextTerms = await db.select().from(schoolTerms).where(and(
        eq(schoolTerms.academicYearId, vals.academicYearId),
        targetSchoolId == null ? sql`${schoolTerms.schoolId} IS NULL` : eq(schoolTerms.schoolId, targetSchoolId),
        vals.cycleId == null ? sql`${schoolTerms.cycleId} IS NULL` : eq(schoolTerms.cycleId, vals.cycleId),
      ));
      const conflictingTerm = findConflictingSchoolTerm(sameContextTerms, {
        academicYearId: vals.academicYearId,
        schoolId: targetSchoolId,
        cycleId: vals.cycleId,
        startDate: vals.startDate ?? null,
        endDate: vals.endDate ?? null,
      });
      if (conflictingTerm) return res.status(409).json({ error: 'A period with the same school year, cycle and overlapping dates already exists' });

      const inserted = await db.insert(schoolTerms).values(vals).returning();
      res.status(201).json(inserted[0]);
    } catch (err: any) {
      console.error('Failed to create school term:', err);
      if (err?.cause?.code === '23503') {
        return res.status(400).json({ error: 'Année académique introuvable. Choisissez une année valide.' });
      }
      res.status(500).json({ error: 'Failed to create school term' });
    }
  });

  app.put('/api/school-terms/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

      const [existing] = await db.select().from(schoolTerms).where(eq(schoolTerms.id, id));
      if (!existing) return res.status(404).json({ error: 'Term not found' });

      const { name, startDate, endDate, orderIndex, isActive, cycleId, periodType, templateId } = req.body as any;
      const updates: any = {};
      if (name != null) updates.name = String(name);
      if (cycleId != null) updates.cycleId = Number(cycleId);
      if (periodType != null) updates.periodType = String(periodType);
      if (templateId != null) updates.templateId = Number(templateId);
      const nextStartDate = startDate != null ? String(startDate) : existing.startDate;
      const nextEndDate = endDate != null ? String(endDate) : existing.endDate;
      const isValidDate = (value: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      };
      if (nextStartDate && !isValidDate(nextStartDate)) {
        return res.status(400).json({ error: 'Invalid start date' });
      }
      if (nextEndDate && !isValidDate(nextEndDate)) {
        return res.status(400).json({ error: 'Invalid end date' });
      }
      if (nextStartDate && nextEndDate && nextStartDate > nextEndDate) {
        return res.status(400).json({ error: 'End date must be greater than or equal to start date' });
      }
      if (startDate != null) updates.startDate = startDate;
      if (endDate != null) updates.endDate = endDate;
      if (orderIndex != null) updates.orderIndex = Number(orderIndex);
      if (isActive != null) updates.isActive = !!isActive;

      const nextEffectiveStartDate = updates.startDate ?? existing.startDate;
      const nextEffectiveEndDate = updates.endDate ?? existing.endDate;
      const nextEffectiveCycleId = updates.cycleId ?? existing.cycleId;
      const nextEffectiveSchoolId = existing.schoolId;
      const nextEffectiveAcademicYearId = existing.academicYearId;
      if (nextEffectiveStartDate && nextEffectiveEndDate) {
        const sameContextTerms = await db.select().from(schoolTerms).where(and(
          eq(schoolTerms.academicYearId, nextEffectiveAcademicYearId),
          nextEffectiveSchoolId == null ? sql`${schoolTerms.schoolId} IS NULL` : eq(schoolTerms.schoolId, nextEffectiveSchoolId),
          nextEffectiveCycleId == null ? sql`${schoolTerms.cycleId} IS NULL` : eq(schoolTerms.cycleId, nextEffectiveCycleId),
        ));
        const conflictingTerm = findConflictingSchoolTerm(sameContextTerms, {
          id,
          academicYearId: nextEffectiveAcademicYearId,
          schoolId: nextEffectiveSchoolId,
          cycleId: nextEffectiveCycleId,
          startDate: nextEffectiveStartDate,
          endDate: nextEffectiveEndDate,
        }, id);
        if (conflictingTerm) {
          return res.status(409).json({ error: 'This period overlaps with another period of the same school, year and cycle' });
        }
      }

      await db.update(schoolTerms).set(updates).where(eq(schoolTerms.id, id));
      const [row] = await db.select().from(schoolTerms).where(eq(schoolTerms.id, id));
      res.json(row);
    } catch (err: any) {
      console.error('Failed to update school term:', err);
      res.status(500).json({ error: 'Failed to update school term' });
    }
  });

  app.delete('/api/school-terms/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

      const [existing] = await db.select().from(schoolTerms).where(eq(schoolTerms.id, id));
      if (!existing) return res.status(404).json({ error: 'Term not found' });
      await db.delete(schoolTerms).where(eq(schoolTerms.id, id));
      res.json({ success: true });
    } catch (err: any) {
      console.error('Failed to delete school term:', err);
      res.status(500).json({ error: 'Failed to delete school term' });
    }
  });

  app.get('/api/class-progression-catalog', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const academicYearId = Number(req.query.academicYearId);
      if (!Number.isInteger(academicYearId) || academicYearId <= 0) return res.status(400).json({ error: 'academicYearId is required' });

      const catalog = await db.select({
        id: classes.id,
        name: classes.name,
        progressionCode: classes.progressionCode,
        levelId: classes.levelId,
        academicYearId: classes.academicYearId,
      })
        .from(classes)
        .where(and(eq(classes.academicYearId, academicYearId), sql`${classes.schoolId} IS NULL`))
        .orderBy(classes.name);

      return res.json(catalog.map((item) => ({
        ...item,
        progressionCode: item.progressionCode || normalizeClassProgressionCode(item.name),
      })));
    } catch (err) {
      console.error('Failed to retrieve global class progression catalog:', err);
      return res.status(500).json({ error: 'Failed to retrieve global class progression catalog' });
    }
  });

  app.get('/api/class-progressions', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const academicYearId = Number(req.query.academicYearId);
      const rows = await db.select().from(classProgressions).where(eq(classProgressions.isActive, true));
      if (!Number.isInteger(academicYearId) || academicYearId <= 0) return res.json(rows);

      const catalog = await db.select({ name: classes.name, progressionCode: classes.progressionCode })
        .from(classes)
        .where(and(eq(classes.academicYearId, academicYearId), sql`${classes.schoolId} IS NULL`));
      const namesByCode = new Map<string, string>();
      for (const item of catalog) namesByCode.set(item.progressionCode || normalizeClassProgressionCode(item.name), item.name);

      return res.json(rows.map((row) => ({
        ...row,
        sourceClassName: namesByCode.get(row.sourceCode) ?? null,
        targetClassName: namesByCode.get(row.targetCode) ?? null,
      })));
    } catch (err) {
      console.error('Failed to retrieve global class progressions:', err);
      return res.status(500).json({ error: 'Failed to retrieve global class progressions' });
    }
  });

  app.put('/api/class-progressions', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
      const sourceCode = normalizeClassProgressionCode(req.body?.sourceCode);
      const targetCode = normalizeClassProgressionCode(req.body?.targetCode);
      const cycleId = req.body?.cycleId == null || req.body.cycleId === '' ? null : Number(req.body.cycleId);
      if (!sourceCode || !targetCode || sourceCode === targetCode || (cycleId != null && (!Number.isInteger(cycleId) || cycleId <= 0))) {
        return res.status(400).json({ error: 'Valid distinct sourceCode and targetCode are required' });
      }

      const existingRows = await db.select({ id: classProgressions.id })
        .from(classProgressions)
        .where(and(
          eq(classProgressions.sourceCode, sourceCode),
          cycleId == null ? sql`${classProgressions.cycleId} IS NULL` : eq(classProgressions.cycleId, cycleId),
        ));
      const [saved] = existingRows.length > 0
        ? await db.update(classProgressions).set({ targetCode, isActive: true, updatedAt: new Date() }).where(eq(classProgressions.id, existingRows[0].id)).returning()
        : await db.insert(classProgressions).values({ sourceCode, targetCode, cycleId, isActive: true }).returning();
      return res.json(saved);
    } catch (err) {
      console.error('Failed to save global class progression:', err);
      return res.status(500).json({ error: 'Failed to save global class progression' });
    }
  });

  app.delete('/api/class-progressions/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
      const id = Number(req.params.id);
      await db.update(classProgressions).set({ isActive: false, updatedAt: new Date() }).where(eq(classProgressions.id, id));
      return res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete global class progression:', err);
      return res.status(500).json({ error: 'Failed to delete global class progression' });
    }
  });

  app.get('/api/class-successions', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const schoolId = Number(req.query.schoolId ?? actor.schoolId);
      const academicYearId = Number(req.query.academicYearId);
      if (!Number.isInteger(schoolId) || schoolId <= 0 || !Number.isInteger(academicYearId) || academicYearId <= 0) {
        return res.status(400).json({ error: 'schoolId and academicYearId are required' });
      }
      if (actor.role !== 'super_admin' && actor.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });

      const rows = await db.select().from(classSuccessions).where(and(eq(classSuccessions.schoolId, schoolId), eq(classSuccessions.academicYearId, academicYearId)));
      const classIds = Array.from(new Set(rows.flatMap((row) => [row.sourceClassId, row.targetClassId])));
      const classRows = classIds.length > 0 ? await db.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, classIds)) : [];
      const classNames = new Map(classRows.map((row) => [row.id, row.name]));
      return res.json(rows.map((row) => ({
        ...row,
        sourceClassName: classNames.get(row.sourceClassId) ?? null,
        targetClassName: classNames.get(row.targetClassId) ?? null,
      })));
    } catch (err) {
      console.error('Failed to retrieve class successions:', err);
      return res.status(500).json({ error: 'Failed to retrieve class successions' });
    }
  });

  app.put('/api/class-successions', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const schoolId = Number(req.body?.schoolId ?? actor.schoolId);
      const academicYearId = Number(req.body?.academicYearId);
      const sourceClassId = Number(req.body?.sourceClassId);
      const targetClassId = Number(req.body?.targetClassId);
      if (![schoolId, academicYearId, sourceClassId, targetClassId].every((value) => Number.isInteger(value) && value > 0) || sourceClassId === targetClassId) {
        return res.status(400).json({ error: 'Valid school, academic year, source class and target class are required' });
      }
      if (actor.role !== 'super_admin' && actor.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });

      const classRows = await db.select({ id: classes.id, academicYearId: classes.academicYearId, schoolId: classes.schoolId }).from(classes).where(inArray(classes.id, [sourceClassId, targetClassId]));
      const approvedLinks = await db.select({ classId: schoolClasses.classId }).from(schoolClasses).where(and(eq(schoolClasses.schoolId, schoolId), eq(schoolClasses.status, 'approved'), inArray(schoolClasses.classId, [sourceClassId, targetClassId])));
      const approvedClassIds = new Set(approvedLinks.map((row) => row.classId));
      if (classRows.length !== 2 || classRows.some((row) => row.academicYearId !== academicYearId || (row.schoolId !== schoolId && !approvedClassIds.has(row.id)))) {
        return res.status(400).json({ error: 'Both classes must belong to the selected academic year' });
      }

      const [saved] = await db.insert(classSuccessions).values({ schoolId, academicYearId, sourceClassId, targetClassId }).onConflictDoUpdate({
        target: [classSuccessions.schoolId, classSuccessions.academicYearId, classSuccessions.sourceClassId],
        set: { targetClassId, updatedAt: new Date() },
      }).returning();
      return res.json(saved);
    } catch (err) {
      console.error('Failed to save class succession:', err);
      return res.status(500).json({ error: 'Failed to save class succession' });
    }
  });

  app.delete('/api/class-successions/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const id = Number(req.params.id);
      const [row] = await db.select({ id: classSuccessions.id, schoolId: classSuccessions.schoolId }).from(classSuccessions).where(eq(classSuccessions.id, id));
      if (!row) return res.status(404).json({ error: 'Class succession not found' });
      if (actor.role !== 'super_admin' && actor.schoolId !== row.schoolId) return res.status(403).json({ error: 'Forbidden' });
      await db.delete(classSuccessions).where(eq(classSuccessions.id, id));
      return res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete class succession:', err);
      return res.status(500).json({ error: 'Failed to delete class succession' });
    }
  });

  // Exam configurations and official student results.
  app.get('/api/class-exam-configurations', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const requestedSchoolId = parsePositiveInteger(req.query.schoolId);
      const requestedYearId = parsePositiveInteger(req.query.academicYearId);
      const schoolId = actor.role === 'school_admin' ? actor.schoolId : requestedSchoolId;
      if (actor.role === 'school_admin' && schoolId == null) return res.status(403).json({ error: 'School context required' });
      const conditions = [] as any[];
      if (schoolId != null) {
        conditions.push(or(eq(classExamConfigurations.schoolId, schoolId), sql`${classExamConfigurations.schoolId} IS NULL`));
      }
      if (requestedYearId != null) conditions.push(eq(classExamConfigurations.academicYearId, requestedYearId));
      conditions.push(eq(classExamConfigurations.isActive, true));
      const rows = await db.select().from(classExamConfigurations).where(and(...conditions));
      if (schoolId != null) {
        rows.sort((left, right) => Number(right.schoolId === schoolId) - Number(left.schoolId === schoolId));
      }
      return res.json(rows);
    } catch (error) {
      console.error('Failed to list class exam configurations:', error);
      return res.status(500).json({ error: 'Failed to list class exam configurations' });
    }
  });

  app.post('/api/class-exam-configurations', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const classId = parsePositiveInteger(req.body?.classId);
      const academicYearId = parsePositiveInteger(req.body?.academicYearId);
      const requestedSchoolId = parsePositiveInteger(req.body?.schoolId);
      const schoolId = actor.role === 'school_admin' ? actor.schoolId : requestedSchoolId;
      const examType = req.body?.examType;
      if (classId == null || academicYearId == null || !isExamType(examType)) return res.status(400).json({ error: 'classId, academicYearId and a valid examType are required' });
      if (actor.role === 'school_admin' && schoolId == null) return res.status(403).json({ error: 'School context required' });
      if (actor.role === 'school_admin' && schoolId !== actor.schoolId) return res.status(403).json({ error: 'Forbidden' });

      const [classRow] = await db.select({ id: classes.id, schoolId: classes.schoolId, academicYearId: classes.academicYearId }).from(classes).where(eq(classes.id, classId));
      if (!classRow || classRow.academicYearId !== academicYearId) return res.status(400).json({ error: 'Class and academic year do not match' });
      if (schoolId != null && classRow.schoolId !== schoolId) {
        const [approved] = await db.select({ id: schoolClasses.id }).from(schoolClasses).where(and(eq(schoolClasses.schoolId, schoolId), eq(schoolClasses.classId, classId), eq(schoolClasses.status, 'approved')));
        if (!approved) return res.status(403).json({ error: 'Class is not approved for this school' });
      }
      const existingRows = await db.select({ id: classExamConfigurations.id })
        .from(classExamConfigurations)
        .where(and(
          eq(classExamConfigurations.classId, classId),
          eq(classExamConfigurations.academicYearId, academicYearId),
          eq(classExamConfigurations.examType, examType),
          schoolId == null
            ? sql`${classExamConfigurations.schoolId} IS NULL`
            : eq(classExamConfigurations.schoolId, schoolId),
        ));
      const [saved] = existingRows.length > 0
        ? await db.update(classExamConfigurations)
          .set({ examType, isActive: true, updatedAt: new Date() })
          .where(eq(classExamConfigurations.id, existingRows[0].id))
          .returning()
        : await db.insert(classExamConfigurations)
          .values({ classId, schoolId, academicYearId, examType, isActive: true, updatedAt: new Date() })
          .returning();
      return res.status(201).json(saved);
    } catch (error) {
      console.error('Failed to save class exam configuration:', error);
      return res.status(500).json({ error: 'Failed to save class exam configuration' });
    }
  });

  app.delete('/api/class-exam-configurations/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      const id = parsePositiveInteger(req.params.id);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role) || id == null) return res.status(403).json({ error: 'Forbidden' });
      const [configuration] = await db.select().from(classExamConfigurations).where(eq(classExamConfigurations.id, id));
      if (!configuration) return res.status(404).json({ error: 'Exam configuration not found' });
      if (actor.role === 'school_admin' && configuration.schoolId !== actor.schoolId) return res.status(403).json({ error: 'Forbidden' });
      await db.update(classExamConfigurations).set({ isActive: false, updatedAt: new Date() }).where(eq(classExamConfigurations.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete class exam configuration:', error);
      return res.status(500).json({ error: 'Failed to delete class exam configuration' });
    }
  });

  app.get('/api/exam-results', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const classId = parsePositiveInteger(req.query.classId);
      const studentId = parsePositiveInteger(req.query.studentId);
      const academicYearId = parsePositiveInteger(req.query.academicYearId);
      const examType = req.query.examType;
      if (studentId != null) {
        const [student] = await db.select({ id: students.id, schoolId: students.schoolId }).from(students).where(eq(students.id, studentId));
        if (!student) return res.status(404).json({ error: 'Student not found' });
        if (actor.role === 'school_admin' && student.schoolId !== actor.schoolId) return res.status(403).json({ error: 'Forbidden' });
        const historyConditions = [eq(examResults.studentId, studentId)];
        if (academicYearId != null) historyConditions.push(eq(examResults.academicYearId, academicYearId));
        if (isExamType(examType)) historyConditions.push(eq(examResults.examType, examType));
        const historyRows = await db.select().from(examResults).where(and(...historyConditions));
        return res.json(historyRows);
      }
      if (classId == null || academicYearId == null || !isExamType(examType)) return res.status(400).json({ error: 'classId, academicYearId and a valid examType are required' });
      const requestedSchoolId = parsePositiveInteger(req.query.schoolId);
      const effectiveSchoolId = actor.role === 'school_admin' ? actor.schoolId : requestedSchoolId;
      const configuration = await findActiveClassExamConfiguration({ classId, academicYearId, examType: String(examType), schoolId: effectiveSchoolId });
      if (!configuration || (actor.role === 'school_admin' && configuration.schoolId != null && configuration.schoolId !== actor.schoolId)) return res.status(403).json({ error: 'Active exam configuration not found for this school' });
      const studentRows = await db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, schoolId: students.schoolId, classId: students.classId }).from(students).where(and(eq(students.classId, classId), eq(students.isActive, true)));
      if (actor.role === 'school_admin' && studentRows.some((row) => row.schoolId !== actor.schoolId)) return res.status(403).json({ error: 'Forbidden' });
      const rows = studentRows.length > 0
        ? await db.select().from(examResults).where(and(eq(examResults.academicYearId, academicYearId), eq(examResults.examType, examType), inArray(examResults.studentId, studentRows.map((row) => row.id))))
        : [];
      return res.json(studentRows.map((student) => ({ ...student, result: rows.find((row) => row.studentId === student.id) ?? null })));
    } catch (error) {
      console.error('Failed to list exam results:', error);
      return res.status(500).json({ error: 'Failed to list exam results' });
    }
  });

  app.delete('/api/exam-results/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      const id = parsePositiveInteger(req.params.id);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role) || id == null) return res.status(403).json({ error: 'Forbidden' });
      const [row] = await db.select({ id: examResults.id, studentSchoolId: students.schoolId, studentIsActive: students.isActive }).from(examResults).innerJoin(students, eq(examResults.studentId, students.id)).where(eq(examResults.id, id));
      if (!row) return res.status(404).json({ error: 'Exam result not found' });
      if (actor.role === 'school_admin' && row.studentSchoolId !== actor.schoolId) return res.status(403).json({ error: 'Forbidden' });
      if (row.studentIsActive !== true) return res.status(409).json({ error: 'Historical exam results for former students cannot be deleted' });
      await db.delete(examResults).where(eq(examResults.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete exam result:', error);
      return res.status(500).json({ error: 'Failed to delete exam result' });
    }
  });

  app.put('/api/exam-results/batch', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor || !['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      const classId = parsePositiveInteger(req.body?.classId);
      const academicYearId = parsePositiveInteger(req.body?.academicYearId);
      const examType = req.body?.examType;
      const entries = Array.isArray(req.body?.results) ? req.body.results : [];
      if (classId == null || academicYearId == null || !isExamType(examType) || entries.length === 0) return res.status(400).json({ error: 'classId, academicYearId, examType and results are required' });
      const requestedSchoolId = parsePositiveInteger(req.body?.schoolId);
      const effectiveSchoolId = actor.role === 'school_admin' ? actor.schoolId : requestedSchoolId;
      const configuration = await findActiveClassExamConfiguration({ classId, academicYearId, examType: String(examType), schoolId: effectiveSchoolId });
      if (!configuration || (actor.role === 'school_admin' && configuration.schoolId != null && configuration.schoolId !== actor.schoolId)) return res.status(403).json({ error: 'Active exam configuration not found for this school' });
      const studentIds = entries.map((entry: any) => parsePositiveInteger(entry.studentId)).filter((id: number | null): id is number => id != null);
      const studentRows = await db.select({ id: students.id, classId: students.classId, schoolId: students.schoolId, isActive: students.isActive }).from(students).where(inArray(students.id, studentIds));
      if (studentRows.length !== studentIds.length || studentRows.some((student) => student.isActive !== true || student.classId !== classId || (actor.role === 'school_admin' && student.schoolId !== actor.schoolId))) return res.status(403).json({ error: 'Every student must be active and belong to the configured class and school' });
      const saved = [];
      for (const entry of entries) {
        const studentId = parsePositiveInteger(entry.studentId);
        if (studentId == null || !isExamResultStatus(entry.resultStatus)) return res.status(400).json({ error: 'Invalid studentId or resultStatus' });
        const [row] = await db.insert(examResults).values({ studentId, academicYearId, examType, resultStatus: entry.resultStatus, examSession: entry.examSession ? String(entry.examSession) : null, recordedBy: actor.id ?? null, updatedAt: new Date() }).onConflictDoUpdate({
          target: [examResults.studentId, examResults.academicYearId, examResults.examType],
          set: { resultStatus: entry.resultStatus, examSession: entry.examSession ? String(entry.examSession) : null, recordedBy: actor.id ?? null, updatedAt: new Date() },
        }).returning();
        saved.push(row);
      }
      return res.json(saved);
    } catch (error) {
      console.error('Failed to save exam results:', error);
      return res.status(500).json({ error: 'Failed to save exam results' });
    }
  });

  app.get('/api/my-homeroom-classes', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'teacher') return res.status(403).json({ error: 'Teacher role required' });

      const scopes = await getTeacherHomeroomScopes(actor);
      if (scopes.length === 0) return res.json([]);
      const classIds = scopes.map((scope) => scope.classId);
      const rows = await db.select({
        id: classes.id,
        name: classes.name,
        schoolId: classHomeroomAssignments.schoolId,
        schoolName: schools.name,
        academicYearId: classes.academicYearId,
        yearName: academicYears.name,
        levelId: classes.levelId,
        levelName: levels.name,
        teacherId: classHomeroomAssignments.teacherId,
        teacherName: users.name,
      })
        .from(classHomeroomAssignments)
        .innerJoin(classes, eq(classes.id, classHomeroomAssignments.classId))
        .innerJoin(schools, eq(schools.id, classHomeroomAssignments.schoolId))
        .innerJoin(academicYears, eq(academicYears.id, classes.academicYearId))
        .leftJoin(levels, eq(levels.id, classes.levelId))
        .innerJoin(teachers, eq(teachers.id, classHomeroomAssignments.teacherId))
        .innerJoin(users, eq(users.id, teachers.userId))
        .where(and(
          inArray(classes.id, classIds),
          eq(classHomeroomAssignments.schoolId, actor.schoolId!),
        ));
      res.set('Cache-Control', 'no-store');
      return res.json(rows);
    } catch (error) {
      console.error('Failed to list teacher homeroom classes:', error);
      return res.status(500).json({ error: 'Failed to list homeroom classes' });
    }
  });

  app.get('/api/my-homeroom-classes/:classId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'teacher') return res.status(403).json({ error: 'Teacher role required' });
      const classId = parsePositiveInteger(req.params.classId);
      if (classId == null) return res.status(400).json({ error: 'Invalid class id' });

      const scopes = await getTeacherHomeroomScopes(actor);
      const scope = scopes.find((item) => item.classId === classId);
      if (!scope) return res.status(404).json({ error: 'Homeroom class not found' });

      const [classInfo] = await db.select({
        id: classes.id,
        name: classes.name,
        schoolId: classHomeroomAssignments.schoolId,
        schoolName: schools.name,
        schoolAddress: schools.address,
        schoolPhone: schools.phone,
        academicYearId: classes.academicYearId,
        yearName: academicYears.name,
        levelId: classes.levelId,
        levelName: levels.name,
        cycleCode: cycles.code,
        teacherId: classHomeroomAssignments.teacherId,
        teacherName: users.name,
      })
        .from(classHomeroomAssignments)
        .innerJoin(classes, eq(classes.id, classHomeroomAssignments.classId))
        .innerJoin(schools, eq(schools.id, classHomeroomAssignments.schoolId))
        .innerJoin(academicYears, eq(academicYears.id, classes.academicYearId))
        .leftJoin(levels, eq(levels.id, classes.levelId))
        .leftJoin(cycles, eq(cycles.id, levels.cycleId))
        .innerJoin(teachers, eq(teachers.id, classHomeroomAssignments.teacherId))
        .innerJoin(users, eq(users.id, teachers.userId))
        .where(and(
          eq(classHomeroomAssignments.classId, classId),
          eq(classHomeroomAssignments.schoolId, scope.schoolId),
          eq(classHomeroomAssignments.teacherId, scope.teacherId),
        ));
      if (!classInfo) return res.status(404).json({ error: 'Homeroom class not found' });

      const schoolId = scope.schoolId;
      const roster = await db.select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        birthDate: students.birthDate,
        gender: students.gender,
        isActive: students.isActive,
        withdrawnAt: students.withdrawnAt,
        enrolledAt: students.enrolledAt,
        parentId: parents.id,
        parentName: users.name,
        parentEmail: users.email,
        parentPhone: parents.phone,
        parentAddress: parents.address,
      })
        .from(students)
        .leftJoin(parents, eq(parents.id, students.parentId))
        .leftJoin(users, eq(users.id, parents.userId))
        .where(and(eq(students.classId, classId), eq(students.schoolId, schoolId)))
        .orderBy(students.lastName, students.firstName);
      const rosterIds = roster.map((student) => student.id);
      const statusRows = rosterIds.length > 0
        ? await db.select({ studentId: studentAcademicYearStatuses.studentId, status: studentAcademicYearStatuses.status })
          .from(studentAcademicYearStatuses)
          .where(and(
            inArray(studentAcademicYearStatuses.studentId, rosterIds),
            eq(studentAcademicYearStatuses.academicYearId, classInfo.academicYearId),
          ))
        : [];
      const statusByStudent = new Map(statusRows.map((row) => [row.studentId, row.status]));

      const classEvaluations = await db.select({
        id: evaluations.id,
        classId: evaluations.classId,
        teacherId: evaluations.teacherId,
        teacherName: users.name,
        termId: evaluations.termId,
        termName: schoolTerms.name,
        periodType: schoolTerms.periodType,
        orderIndex: schoolTerms.orderIndex,
        subjectId: evaluations.subjectId,
        subject: sql<string>`COALESCE(${subjects.name}, ${evaluations.subject})`,
        title: evaluations.title,
        type: evaluations.type,
        coefficient: evaluations.coefficient,
        maxScore: evaluations.maxScore,
        date: evaluations.date,
      })
        .from(evaluations)
        .innerJoin(teachers, eq(teachers.id, evaluations.teacherId))
        .innerJoin(users, eq(users.id, teachers.userId))
        .leftJoin(subjects, eq(subjects.id, evaluations.subjectId))
        .leftJoin(schoolTerms, eq(schoolTerms.id, evaluations.termId))
        .where(and(eq(evaluations.classId, classId), eq(teachers.schoolId, schoolId)))
        .orderBy(desc(evaluations.date));
      const evaluationIds = classEvaluations.map((evaluation) => evaluation.id);
      const classGrades = evaluationIds.length > 0
        ? await db.select({
          id: grades.id,
          evaluationId: grades.evaluationId,
          studentId: grades.studentId,
          studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
          subject: sql<string>`COALESCE(${subjects.name}, ${evaluations.subject})`,
          evaluationTitle: evaluations.title,
          evaluationDate: evaluations.date,
          evaluationSchoolId: evaluations.schoolId,
          score: grades.score,
          remarks: grades.remarks,
        })
          .from(grades)
          .innerJoin(evaluations, eq(evaluations.id, grades.evaluationId))
          .innerJoin(teachers, eq(teachers.id, evaluations.teacherId))
          .innerJoin(students, eq(students.id, grades.studentId))
          .leftJoin(subjects, eq(subjects.id, evaluations.subjectId))
          .where(and(
            inArray(grades.evaluationId, evaluationIds),
            eq(teachers.schoolId, schoolId),
            eq(students.schoolId, schoolId),
          ))
          .orderBy(desc(evaluations.date))
        : [];

      const classAbsences = await db.select({
        id: absences.id,
        studentId: absences.studentId,
        studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
        date: absences.date,
        period: absences.period,
        subjectName: subjects.name,
        isJustified: absences.isJustified,
        justificationStatus: absences.justificationStatus,
        justificationReason: absences.justificationReason,
      })
        .from(absences)
        .innerJoin(students, eq(students.id, absences.studentId))
        .leftJoin(subjects, eq(subjects.id, absences.subjectId))
        .where(and(eq(absences.classId, classId), eq(students.schoolId, schoolId)))
        .orderBy(desc(absences.date));
      const classLateArrivals = await db.select({
        id: lateArrivals.id,
        studentId: lateArrivals.studentId,
        teachingAssignmentId: lateArrivals.teachingAssignmentId,
        studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
        date: lateArrivals.date,
        period: lateArrivals.period,
        expectedStartTime: lateArrivals.expectedStartTime,
        arrivalTime: lateArrivals.arrivalTime,
        lateMinutes: lateArrivals.lateMinutes,
        reason: lateArrivals.reason,
      })
        .from(lateArrivals)
        .innerJoin(students, eq(students.id, lateArrivals.studentId))
        .where(and(eq(lateArrivals.classId, classId), eq(students.schoolId, schoolId)))
        .orderBy(desc(lateArrivals.date));

      const classBulletins = await db.select({
        id: bulletins.id,
        studentId: bulletins.studentId,
        studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
        schoolYearId: bulletins.schoolYearId,
        schoolYearName: academicYears.name,
        termId: bulletins.termId,
        termName: schoolTerms.name,
        average: bulletins.average,
        rank: bulletins.rank,
        mention: bulletins.mention,
        appreciation: bulletins.appreciation,
        generatedAt: bulletins.generatedAt,
      })
        .from(bulletins)
        .innerJoin(students, eq(students.id, bulletins.studentId))
        .innerJoin(classes, eq(classes.id, bulletins.classId))
        .innerJoin(academicYears, eq(academicYears.id, bulletins.schoolYearId))
        .leftJoin(schoolTerms, eq(schoolTerms.id, bulletins.termId))
        .where(and(
          eq(bulletins.classId, classId),
          eq(students.schoolId, schoolId),
          or(eq(classes.schoolId, schoolId), sql`${bulletins.schoolScopeVersion} >= 1`),
        ))
        .orderBy(desc(bulletins.generatedAt));
      const bulletinIds = classBulletins.map((bulletin) => bulletin.id);
      const bulletinLineRows = bulletinIds.length > 0
        ? await db.select({
          id: bulletinLines.id,
          bulletinId: bulletinLines.bulletinId,
          subjectName: bulletinLines.subjectName,
          coefficient: bulletinLines.coefficient,
          average: bulletinLines.average,
          teacherComment: bulletinLines.teacherComment,
          rank: bulletinLines.rank,
        }).from(bulletinLines).where(inArray(bulletinLines.bulletinId, bulletinIds))
        : [];
      const linesByBulletin = new Map<number, typeof bulletinLineRows>();
      for (const line of bulletinLineRows) {
        const current = linesByBulletin.get(line.bulletinId) || [];
        current.push(line);
        linesByBulletin.set(line.bulletinId, current);
      }

      const currentRosterIds = roster.map((student) => student.id);
      const classExamResults = currentRosterIds.length > 0
        ? await db.select({
          id: examResults.id,
          studentId: examResults.studentId,
          studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
          academicYearId: examResults.academicYearId,
          examType: examResults.examType,
          resultStatus: examResults.resultStatus,
          examSession: examResults.examSession,
        })
          .from(examResults)
          .innerJoin(students, eq(students.id, examResults.studentId))
          .where(and(
            inArray(examResults.studentId, currentRosterIds),
            eq(examResults.academicYearId, classInfo.academicYearId),
            eq(students.schoolId, schoolId),
          ))
        : [];

      res.set('Cache-Control', 'no-store');
      return res.json({
        class: classInfo,
        students: roster.map((student) => ({ ...student, studentStatus: statusByStudent.get(student.id) ?? null })),
        evaluations: classEvaluations,
        grades: classGrades,
        absences: classAbsences,
        lateArrivals: classLateArrivals,
        bulletins: classBulletins.map((bulletin) => ({ ...bulletin, lines: linesByBulletin.get(bulletin.id) || [] })),
        examResults: classExamResults,
      });
    } catch (error) {
      console.error('Failed to read teacher homeroom class:', error);
      return res.status(500).json({ error: 'Failed to read homeroom class' });
    }
  });

  app.get('/api/schools/:schoolId/homeroom-assignments', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      const schoolId = parsePositiveInteger(req.params.schoolId);
      if (!actor || schoolId == null) return res.status(403).json({ error: 'Forbidden' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) return res.status(403).json({ error: 'Forbidden' });

      const rows = await db.select({
        classId: classHomeroomAssignments.classId,
        teacherId: classHomeroomAssignments.teacherId,
        teacherName: users.name,
      })
        .from(classHomeroomAssignments)
        .innerJoin(classes, eq(classes.id, classHomeroomAssignments.classId))
        .innerJoin(teachers, eq(teachers.id, classHomeroomAssignments.teacherId))
        .innerJoin(users, eq(users.id, teachers.userId))
        .leftJoin(schoolClasses, and(
          eq(schoolClasses.schoolId, classHomeroomAssignments.schoolId),
          eq(schoolClasses.classId, classHomeroomAssignments.classId),
        ))
        .where(and(
          eq(classHomeroomAssignments.schoolId, schoolId),
          or(
            eq(classes.schoolId, schoolId),
            and(sql`${classes.schoolId} IS NULL`, eq(schoolClasses.status, 'approved')),
          ),
        ));
      return res.json(rows);
    } catch (error) {
      console.error('Failed to list homeroom assignments:', error);
      return res.status(500).json({ error: 'Failed to list homeroom assignments' });
    }
  });

  // 3. Classes - Filtered by school
  app.get('/api/classes', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      if (req.user.role === 'school_admin' && req.user.schoolId == null) {
        return res.status(403).json({ error: 'School admin school context is required' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'school_admin' && actor.schoolId == null) {
        return res.status(403).json({ error: 'School admin school context is required' });
      }

      const schoolIdParam = req.query.schoolId ? Number(req.query.schoolId) : undefined;
      const approvedOnly = req.query.approvedOnly === 'true' || req.query.approvedOnly === '1';
      const targetSchoolId = actor.role === 'school_admin' || actor.role === 'surveillant'
        ? actor.schoolId
        : actor.role === 'teacher'
          ? actor.schoolId
          : actor.role === 'parent'
            ? actor.schoolId ?? null
            : schoolIdParam;

      const baseSelect = {
        id: classes.id,
        name: classes.name,
        schoolId: classes.schoolId,
        academicYearId: classes.academicYearId,
        levelId: classes.levelId,
        progressionCode: classes.progressionCode,
        yearName: academicYears.name,
        teacherId: classes.teacherId,
        teacherName: users.name,
      };
      const schoolScopedSelect = {
        ...baseSelect,
        status: schoolClasses.status,
      };
      const resolveClassesForSchool = async (classRows: any[], schoolId: number | null | undefined) => {
        let assignmentByClassId = new Map<number, any>();
        if (schoolId != null && classRows.length > 0) {
          const assignmentRows = await db.select({
            classId: classHomeroomAssignments.classId,
            teacherId: classHomeroomAssignments.teacherId,
            teacherName: users.name,
          })
            .from(classHomeroomAssignments)
            .innerJoin(teachers, eq(teachers.id, classHomeroomAssignments.teacherId))
            .innerJoin(users, eq(users.id, teachers.userId))
            .where(and(
              eq(classHomeroomAssignments.schoolId, schoolId),
              inArray(classHomeroomAssignments.classId, classRows.map((klass: any) => klass.id)),
            ));

          assignmentByClassId = new Map(assignmentRows.map((assignment) => [assignment.classId, assignment]));
        }

        return classRows.map((klass: any) => {
          const assignment = assignmentByClassId.get(klass.id);
          if (klass.schoolId == null) {
            return {
              ...klass,
              teacherId: assignment?.teacherId ?? null,
              teacherName: assignment?.teacherName ?? null,
            };
          }
          return assignment
            ? { ...klass, teacherId: assignment.teacherId, teacherName: assignment.teacherName }
            : klass;
        });
      };

      if (actor.role === 'teacher') {
        if (!targetSchoolId) {
          return res.status(403).json({ error: 'Teacher school context is required' });
        }
        if (!actor.id) {
          return res.status(403).json({ error: 'Teacher identity is required' });
        }

        const classIds = await getTeacherReadableScopedClassIds(actor);
        if (classIds.length === 0) {
          res.json([]);
          return;
        }

        const assignedClasses = await db
          .select(baseSelect)
          .from(classes)
          .leftJoin(teachers, eq(classes.teacherId, teachers.id))
          .leftJoin(users, eq(teachers.userId, users.id))
          .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id))
          .where(inArray(classes.id, classIds));

        const schoolClassRows = await db
          .select({ classId: schoolClasses.classId, status: schoolClasses.status })
          .from(schoolClasses)
          .where(and(
            eq(schoolClasses.schoolId, targetSchoolId),
            inArray(schoolClasses.classId, classIds),
          ));
        const schoolClassStatus = new Map(schoolClassRows.map((row) => [row.classId, row.status]));
        const scopedAssignedClasses = assignedClasses
          .map((klass) => ({
            ...klass,
            status: klass.schoolId === targetSchoolId
              ? 'approved'
              : schoolClassStatus.get(klass.id) ?? 'pending',
          }))
          .filter((klass) => (
            klass.schoolId === targetSchoolId
            || (klass.schoolId == null && klass.status === 'approved')
          ));

        const classesForTeacher = await resolveClassesForSchool(scopedAssignedClasses, targetSchoolId);
        res.set('Cache-Control', 'no-store');
        res.json(classesForTeacher);
        return;
      }

      if (approvedOnly && !targetSchoolId) {
        if (actor.role === 'super_admin') {
          const approvedRows = await db
            .select(schoolScopedSelect)
            .from(classes)
            .innerJoin(
              schoolClasses,
              and(
                eq(classes.id, schoolClasses.classId),
                eq(schoolClasses.status, 'approved')
              )
            )
            .leftJoin(teachers, eq(classes.teacherId, teachers.id))
            .leftJoin(users, eq(teachers.userId, users.id))
            .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id));

          res.json(await resolveClassesForSchool(approvedRows, null));
          return;
        }

        return res.status(403).json({ error: 'School context is required' });
      }

      let query = db
        .select(schoolScopedSelect)
        .from(classes)
        .leftJoin(
          schoolClasses,
          schoolIdParam != null
            ? and(
              eq(schoolClasses.classId, classes.id),
              eq(schoolClasses.schoolId, schoolIdParam),
              eq(schoolClasses.status, 'approved'),
            )
            : sql`false`,
        )
        .leftJoin(teachers, eq(classes.teacherId, teachers.id))
        .leftJoin(users, eq(teachers.userId, users.id))
        .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id));

      if (actor.role !== 'super_admin') {
        if (actor.role === 'parent') {
          const childStudentIds = await getParentChildStudentIds(actor.id);
          if (childStudentIds.length === 0) {
            return res.json([]);
          }

          const childClassRows = await db
            .select({ classId: students.classId })
            .from(students)
            .where(inArray(students.id, childStudentIds));

          const childClassIds = Array.from(new Set(childClassRows
            .map((row: any) => row.classId)
            .filter((id): id is number => id != null)));

          if (childClassIds.length === 0) {
            return res.json([]);
          }

          query = query.where(inArray(classes.id, childClassIds)) as any;
        } else if (actor.schoolId != null) {
          query = query.where(or(eq(classes.schoolId, actor.schoolId), sql`${classes.schoolId} IS NULL`)) as any;
        } else {
          return res.json([]);
        }
      } else if (schoolIdParam != null) {
        query = query
          .where(or(
            eq(classes.schoolId, schoolIdParam),
            sql`${classes.schoolId} IS NULL AND ${schoolClasses.id} IS NOT NULL`,
          )) as any;
      }

      const allClasses = await query;
      const classesForSchool = await resolveClassesForSchool(allClasses, targetSchoolId);

      if (actor.role === 'parent') {
        res.json(classesForSchool);
        return;
      }

      // Fill missing teacherName values by querying teachers->users for teacherIds
      try {
        const missingTeacherIds = Array.from(new Set(classesForSchool.filter((c: any) => c.teacherId != null && !c.teacherName).map((c: any) => c.teacherId)));
        if (missingTeacherIds.length > 0) {
          const teacherRows = await db
            .select({ id: teachers.id, userId: teachers.userId, name: users.name })
            .from(teachers)
            .leftJoin(users, eq(teachers.userId, users.id))
            .where(inArray(teachers.id, missingTeacherIds as number[]));

          const nameByTeacherId = new Map<number, string>();
          for (const tr of teacherRows) {
            if (tr.id != null && tr.name) nameByTeacherId.set(tr.id, tr.name);
          }

          for (const cls of classesForSchool) {
            if (cls.teacherId != null && !cls.teacherName) {
              const n = nameByTeacherId.get(cls.teacherId as number);
              if (n) cls.teacherName = n;
            }
          }
        }
      } catch (e: any) {
        console.warn('Failed to fill missing teacher names', e?.message || e);
      }

      if (targetSchoolId) {
        const statusRows = await db.select().from(schoolClasses).where(eq(schoolClasses.schoolId, targetSchoolId));
        const statusMap = new Map(statusRows.map((row) => [row.classId, row.status]));

        let result = classesForSchool.map((klass) => ({
          ...klass,
          status: statusMap.get(klass.id) ?? (klass.schoolId === targetSchoolId ? 'approved' : 'pending'),
        }));

        // Only return classes that belong to the requested school OR global classes
        // that have been approved for that school. This keeps the client-side
        // schoolId-based filters working without frontend changes.
        result = result.filter((klass) => (
          klass.schoolId === targetSchoolId || (klass.schoolId == null && klass.status === 'approved')
        ));

        if (approvedOnly) {
          result = result.filter((klass) => klass.status === 'approved');
        }

        res.json(result);
        return;
      }

      res.json(classesForSchool);
    } catch (err: any) {
      console.error('GET /api/classes failed:', err);
      res.status(500).json({ error: 'Failed to retrieve classes' });
    }
  });

  app.post('/api/classes', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const { name, levelId: rawLevelId, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, teacherId } = req.body;
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      const academicYearId = rawAcademicYearId != null && rawAcademicYearId !== '' ? Number(rawAcademicYearId) : null;
      if (rawAcademicYearId != null && rawAcademicYearId !== '' && Number.isNaN(academicYearId)) {
        return res.status(400).json({ error: 'Invalid academicYearId' });
      }

      const validation = resolveClassCreationSchoolId({
        actorRole: actor.role,
        requestedSchoolId: rawSchoolId,
        actorSchoolId: actor.schoolId,
      });

      if (validation.error) {
        return res.status(400).json({ error: validation.error });
      }

      const parsedSchoolId = validation.schoolId;

      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (actor.role === 'school_admin' && !actor.schoolId) {
        return res.status(403).json({ error: 'School admin must belong to a school' });
      }

      const resolvedSchoolId = parsedSchoolId;

      if (actor.role === 'school_admin' && resolvedSchoolId == null) {
        return res.status(400).json({ error: 'schoolId is required to create a class' });
      }

      if (!trimmedName || academicYearId == null) {
        return res.status(400).json({ error: `Missing required parameters. Received: name=${trimmedName}, academicYearId=${academicYearId}` });
      }

      const requestedLevelId = rawLevelId != null && rawLevelId !== '' ? Number(rawLevelId) : null;
      let resolvedLevelId = requestedLevelId;
      if (requestedLevelId != null && (!Number.isInteger(requestedLevelId) || requestedLevelId <= 0)) {
        return res.status(400).json({ error: 'Invalid levelId' });
      }
      if (resolvedLevelId == null) {
        const inferredCode = inferLevelCodeFromClassName(trimmedName);
        if (inferredCode) {
          const [inferredLevel] = await db.select({ id: levels.id }).from(levels).where(eq(levels.code, inferredCode));
          resolvedLevelId = inferredLevel?.id ?? null;
        }
      }

      if (resolvedSchoolId != null && resolvedLevelId != null) {
        const [level] = await db.select({ cycleId: levels.cycleId }).from(levels).where(eq(levels.id, resolvedLevelId));
        if (!level) return res.status(400).json({ error: 'Unknown levelId' });
        const configuredCycles = await db.select({ id: schoolCycles.id }).from(schoolCycles).where(eq(schoolCycles.schoolId, Number(resolvedSchoolId)));
        if (configuredCycles.length > 0 && !(await validateSchoolCycle(Number(resolvedSchoolId), level.cycleId))) {
          return res.status(403).json({ error: 'The selected level cycle is not enabled for this school' });
        }
      }

      try {
        const [existingGlobalClass] = await db.select().from(classes).where(
          and(
            eq(classes.name, trimmedName),
            sql`${classes.schoolId} IS NULL`,
            eq(classes.academicYearId, Number(academicYearId))
          )
        ).limit(1);

        let classRow = existingGlobalClass;

        if (!classRow) {
          const [createdClass] = await db.insert(classes).values({
            name: trimmedName,
            schoolId: null,
            academicYearId: Number(academicYearId),
            levelId: resolvedLevelId,
            progressionCode: normalizeClassProgressionCode(trimmedName),
            teacherId: null,
          }).returning();
          classRow = createdClass;
        } else if (classRow.levelId == null && resolvedLevelId != null) {
          const [updatedClass] = await db.update(classes).set({ levelId: resolvedLevelId }).where(eq(classes.id, classRow.id)).returning();
          classRow = updatedClass;
        } else if (resolvedLevelId != null && classRow.levelId != null && classRow.levelId !== resolvedLevelId) {
          return res.status(409).json({ error: 'Class level conflicts with the existing global class' });
        }

        if (classRow && resolvedSchoolId != null) {
          const normalizedSchoolId = Number(resolvedSchoolId);
          const [existingSchoolClass] = await db.select().from(schoolClasses).where(
            and(
              eq(schoolClasses.schoolId, normalizedSchoolId),
              eq(schoolClasses.classId, classRow.id)
            )
          ).limit(1);

          if (!existingSchoolClass) {
            await db.insert(schoolClasses).values({
              schoolId: normalizedSchoolId,
              classId: classRow.id,
              status: 'approved',
            });
          }
        }

        res.status(201).json({
          ...classRow,
          schoolId: classRow.schoolId ?? null,
          status: 'approved',
        });
      } catch (insertErr: any) {
        // Postgres unique violation
        if (insertErr && insertErr.code === '23505') {
          return res.status(400).json({ error: `Classe déjà existante: ${trimmedName}` });
        }
        console.error('Class creation failed', { errorCode: insertErr?.code ?? 'unknown' });
        return res.status(500).json({ error: 'Internal server error' });
      }
    } catch (error: any) {
      console.error('Class creation request failed');

      // Do not expose internal error message or stack to client; keep server logs for diagnostics.
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/schools/:schoolId/classes/:classId/approve', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = Number(req.params.schoolId);
      const classId = Number(req.params.classId);
      if (!schoolId || !classId) return res.status(400).json({ error: 'Invalid class or school ID' });

      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const [classRow] = await db.select().from(classes).where(eq(classes.id, classId));
      if (!classRow) {
        return res.status(404).json({ error: 'Class not found' });
      }

      if (classRow.schoolId != null && classRow.schoolId !== schoolId) {
        return res.status(409).json({ error: 'Class already belongs to another school' });
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

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = Number(req.params.schoolId);
      const classId = Number(req.params.classId);
      if (!schoolId || !classId) return res.status(400).json({ error: 'Invalid class or school ID' });

      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const [classRow] = await db.select({ id: classes.id, schoolId: classes.schoolId }).from(classes).where(eq(classes.id, classId));
      if (!classRow) return res.status(404).json({ error: 'Class not found' });
      if (classRow.schoolId != null && classRow.schoolId !== schoolId) {
        return res.status(409).json({ error: 'Class belongs to another school' });
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

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      // Load the class to check its school
      const [classToDelete] = await db.select().from(classes).where(eq(classes.id, id));
      if (!classToDelete) return res.status(404).json({ error: 'Class not found' });

      // Only super_admin or school_admin may delete classes.
      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden: only super_admin or school_admin can delete classes' });
      }

      if (actor.role === 'school_admin') {
        if (!actor.schoolId) {
          return res.status(403).json({ error: 'Forbidden: school_admin must have a schoolId' });
        }
        if (classToDelete.schoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Cannot delete class in another school' });
        }
      }

      const [accountingHistory] = await db.select({ id: financialObligations.id })
        .from(financialObligations)
        .where(eq(financialObligations.classId, id))
        .limit(1);
      const [accountingTariff] = await db.select({ id: accountingTariffs.id })
        .from(accountingTariffs)
        .where(or(
          eq(accountingTariffs.classId, id),
          eq(accountingTariffs.classFromId, id),
          eq(accountingTariffs.classToId, id),
        ))
        .limit(1);
      const [accountingFee] = await db.select({ id: accountingFeeDefinitions.id })
        .from(accountingFeeDefinitions)
        .where(eq(accountingFeeDefinitions.classId, id))
        .limit(1);
      if (accountingHistory || accountingTariff || accountingFee) {
        return res.status(409).json({
          error: 'Cette classe est référencée par des données comptables et ne peut pas être supprimée.',
        });
      }

      await db.delete(classes).where(eq(classes.id, id));
      res.json({ message: 'Class deleted successfully' });
    } catch (err: any) {
      res.status(500).json({ error: 'Cannot delete class due to linked data (absence / marks)' });
    }
  });

  // PUT /api/classes/:id - Update class principal teacher
  app.put('/api/classes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);
      const { teacherId } = req.body;

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      // Load the class to check its school
      const [classToUpdate] = await db.select().from(classes).where(eq(classes.id, id));
      if (!classToUpdate) return res.status(404).json({ error: 'Class not found' });

      // School admin can only update classes in their own school
      if (actor.role !== 'super_admin') {
        if (actor.role !== 'school_admin') {
          return res.status(403).json({ error: 'Only super_admin or school_admin can update classes' });
        }
        if (actor.schoolId == null) return res.status(403).json({ error: 'School admin school context is required' });
        const classBelongsToSchool = classToUpdate.schoolId === actor.schoolId;
        const classIsApprovedForSchool = classToUpdate.schoolId == null
          && await isApprovedClassForSchool(classToUpdate.id, actor.schoolId);

        if (!classBelongsToSchool && !classIsApprovedForSchool) {
          return res.status(403).json({ error: 'Cannot update class in another school' });
        }
      }

      if (classToUpdate.schoolId == null) {
        return res.status(400).json({ error: 'Use the school-scoped homeroom assignment endpoint for a global class' });
      }

      // If teacherId is provided, validate it exists and belongs to the same school
      if (teacherId != null) {
        const parsedTeacherId = parseInt(String(teacherId), 10);
        if (Number.isNaN(parsedTeacherId)) {
          return res.status(400).json({ error: 'Invalid teacherId' });
        }

        const [teacher] = await db.select().from(teachers).where(eq(teachers.id, parsedTeacherId));
        if (!teacher) {
          return res.status(404).json({ error: 'Teacher not found' });
        }

        // Verify teacher belongs to the same school through either teachers.schoolId or user_schools membership.
        let teacherMatchesSchool = classToUpdate.schoolId != null && teacher.schoolId === classToUpdate.schoolId;
        if (!teacherMatchesSchool && classToUpdate.schoolId != null) {
          const [membership] = await db.select().from(userSchools).where(
            and(
              eq(userSchools.userId, teacher.userId),
              eq(userSchools.role, 'teacher'),
              eq(userSchools.schoolId, classToUpdate.schoolId),
              eq(userSchools.isActive, true),
            ),
          );
          teacherMatchesSchool = Boolean(membership);
        }
        if (classToUpdate.schoolId != null && !teacherMatchesSchool) {
          return res.status(400).json({ error: 'Teacher does not belong to the same school as the class' });
        }

        // Update class with new teacher
        const [updated] = await db.update(classes).set({ teacherId: parsedTeacherId }).where(eq(classes.id, id)).returning();
        const [existingHomeroom] = await db.select({ id: classHomeroomAssignments.id })
          .from(classHomeroomAssignments)
          .where(and(
            eq(classHomeroomAssignments.classId, id),
            eq(classHomeroomAssignments.schoolId, classToUpdate.schoolId),
          ));
        if (existingHomeroom) {
          await db.update(classHomeroomAssignments).set({ teacherId: parsedTeacherId, updatedAt: new Date() })
            .where(eq(classHomeroomAssignments.id, existingHomeroom.id));
        } else {
          await db.insert(classHomeroomAssignments).values({
            schoolId: classToUpdate.schoolId,
            classId: id,
            teacherId: parsedTeacherId,
            updatedAt: new Date(),
          });
        }
        return res.json(updated);
      } else {
        // Clear the teacher assignment if teacherId is null/undefined
        const [updated] = await db.update(classes).set({ teacherId: null }).where(eq(classes.id, id)).returning();
        await db.delete(classHomeroomAssignments).where(and(
          eq(classHomeroomAssignments.classId, id),
          eq(classHomeroomAssignments.schoolId, classToUpdate.schoolId),
        ));
        return res.json(updated);
      }
    } catch (err: any) {
      console.error('Error updating class:', err);
      res.status(500).json({ error: 'Failed to update class' });
    }
  });

  app.put('/api/schools/:schoolId/classes/:classId/homeroom', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      const schoolId = parsePositiveInteger(req.params.schoolId);
      const classId = parsePositiveInteger(req.params.classId);
      if (!actor || schoolId == null || classId == null) return res.status(403).json({ error: 'Forbidden' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });
      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) return res.status(403).json({ error: 'Cannot assign a homeroom teacher outside your school' });

      const requestedTeacherId = req.body?.teacherId == null || req.body.teacherId === ''
        ? null
        : parsePositiveInteger(req.body.teacherId);
      if (req.body?.teacherId != null && req.body.teacherId !== '' && requestedTeacherId == null) {
        return res.status(400).json({ error: 'Invalid teacherId' });
      }

      const [classRow] = await db.select({ id: classes.id, schoolId: classes.schoolId })
        .from(classes)
        .where(eq(classes.id, classId));
      if (!classRow) return res.status(404).json({ error: 'Class not found' });
      if (classRow.schoolId !== schoolId) {
        if (classRow.schoolId != null) return res.status(403).json({ error: 'Class belongs to another school' });
        const [approvedClass] = await db.select({ id: schoolClasses.id }).from(schoolClasses).where(and(
          eq(schoolClasses.classId, classId),
          eq(schoolClasses.schoolId, schoolId),
          eq(schoolClasses.status, 'approved'),
        ));
        if (!approvedClass) return res.status(403).json({ error: 'Global class is not approved for this school' });
      }

      let teacherProfile: { id: number; userId: number; schoolId: number } | undefined;
      if (requestedTeacherId != null) {
        [teacherProfile] = await db.select({ id: teachers.id, userId: teachers.userId, schoolId: teachers.schoolId })
          .from(teachers)
          .where(eq(teachers.id, requestedTeacherId));
        if (!teacherProfile) return res.status(404).json({ error: 'Teacher not found' });
        if (teacherProfile.schoolId !== schoolId) {
          const [membership] = await db.select({ id: userSchools.id }).from(userSchools).where(and(
            eq(userSchools.userId, teacherProfile.userId),
            eq(userSchools.schoolId, schoolId),
            eq(userSchools.role, 'teacher'),
            eq(userSchools.isActive, true),
          ));
          if (!membership) return res.status(403).json({ error: 'Teacher is not active in this school' });
        }
      }

      const [existingAssignment] = await db.select().from(classHomeroomAssignments).where(and(
        eq(classHomeroomAssignments.schoolId, schoolId),
        eq(classHomeroomAssignments.classId, classId),
      ));
      if (requestedTeacherId == null) {
        await db.delete(classHomeroomAssignments).where(and(
          eq(classHomeroomAssignments.schoolId, schoolId),
          eq(classHomeroomAssignments.classId, classId),
        ));
        if (classRow.schoolId === schoolId && existingAssignment && classRow.id != null) {
          await db.update(classes).set({ teacherId: null }).where(and(
            eq(classes.id, classId),
            eq(classes.teacherId, existingAssignment.teacherId),
          ));
        }
      } else {
        const values = { schoolId, classId, teacherId: requestedTeacherId, updatedAt: new Date() };
        if (existingAssignment) {
          await db.update(classHomeroomAssignments).set(values).where(eq(classHomeroomAssignments.id, existingAssignment.id));
        } else {
          await db.insert(classHomeroomAssignments).values(values);
        }
        if (classRow.schoolId === schoolId) {
          await db.update(classes).set({ teacherId: requestedTeacherId }).where(eq(classes.id, classId));
        }
      }

      await logAuditEvent(actor, 'update', 'class_homeroom_assignment', classId, schoolId,
        requestedTeacherId == null ? 'Homeroom teacher removed' : `Homeroom teacher set to ${requestedTeacherId}`);
      return res.json({ classId, schoolId, teacherId: requestedTeacherId });
    } catch (error) {
      console.error('Failed to update homeroom assignment:', error);
      return res.status(500).json({ error: 'Failed to update homeroom assignment' });
    }
  });

  // 4. Teachers - Filtered by school
  app.get('/api/teachers', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const filterSchoolId = req.query.schoolId ? parseInt(String(req.query.schoolId), 10) : null;
      if (actor.role !== 'super_admin' && filterSchoolId && actor.schoolId && filterSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Cannot request teachers for another school' });
      }

      const teacherProjection = {
        id: teachers.id,
        userId: teachers.userId,
        uid: users.uid,
        name: users.name,
        lastName: users.lastName,
        firstNames: users.firstNames,
        lastName: users.lastName,
        firstNames: users.firstNames,
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
        .innerJoin(userSchools, and(
          eq(userSchools.userId, users.id),
          eq(userSchools.role, 'teacher'),
          eq(userSchools.isActive, true),
        ));

      let oldModelQuery = baseOldModel;
      let newModelQuery = baseNewModel;

      if (filterSchoolId) {
        oldModelQuery = oldModelQuery.where(eq(teachers.schoolId, filterSchoolId)) as any;
        newModelQuery = newModelQuery.where(eq(userSchools.schoolId, filterSchoolId)) as any;
      }

      if (actor.role !== 'super_admin') {
        if (!actor.schoolId) {
          return res.json([]);
        }
        oldModelQuery = oldModelQuery.where(eq(teachers.schoolId, actor.schoolId)) as any;
        newModelQuery = newModelQuery.where(eq(userSchools.schoolId, actor.schoolId)) as any;
      }

      if (actor.role === 'teacher') {
        if (!actor.id) {
          return res.json([]);
        }
        oldModelQuery = oldModelQuery.where(eq(teachers.userId, actor.id)) as any;
        newModelQuery = newModelQuery.where(eq(teachers.userId, actor.id)) as any;
      }

      const [oldTeachers, newTeachers] = await Promise.all([
        oldModelQuery,
        newModelQuery,
      ]);

      const teacherById = new Map<number, any>();
      for (const teacher of oldTeachers) {
        teacherById.set(teacher.id, {
          ...teacher,
          schoolIds: teacher.schoolId != null ? [teacher.schoolId] : [],
        });
      }
      for (const teacher of newTeachers) {
        const existing = teacherById.get(teacher.id);
        if (existing) {
          const mergedSchoolIds = Array.from(new Set([...(existing.schoolIds || []), teacher.schoolId].filter((id) => id != null)));
          teacherById.set(teacher.id, {
            ...existing,
            ...teacher,
            schoolId: existing.schoolId ?? teacher.schoolId,
            schoolIds: mergedSchoolIds,
          });
        } else {
          teacherById.set(teacher.id, {
            ...teacher,
            schoolIds: teacher.schoolId != null ? [teacher.schoolId] : [],
          });
        }
      }

      const teachersList = Array.from(teacherById.values());
      const teacherIds = teachersList.map((teacher) => teacher.id).filter(Boolean);

      const subjectAssignments = teacherIds.length > 0
        ? await db.select({ teacherId: teacherSubjects.teacherId, subjectId: teacherSubjects.subjectId, subjectName: subjects.name })
          .from(teacherSubjects)
          .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
          .where(actor.role === 'super_admin'
            ? inArray(teacherSubjects.teacherId, teacherIds)
            : and(inArray(teacherSubjects.teacherId, teacherIds), eq(teacherSubjects.schoolId, actor.schoolId!)))
        : [];
      const subjectAssignmentMap = new Map<number, Array<{ id: number; name: string }>>();
      for (const assignment of subjectAssignments) {
        const existing = subjectAssignmentMap.get(assignment.teacherId) ?? [];
        existing.push({ id: assignment.subjectId, name: assignment.subjectName });
        subjectAssignmentMap.set(assignment.teacherId, existing);
      }

      let assignments: Array<{ teacherId: number; classId: number }> = [];
      if (teacherIds.length > 0) {
        assignments = await db
          .select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId })
          .from(classTeachers)
          .where(actor.role === 'super_admin'
            ? inArray(classTeachers.teacherId, teacherIds)
            : and(inArray(classTeachers.teacherId, teacherIds), eq(classTeachers.schoolId, actor.schoolId!)));
      }

      console.log('GET /api/teachers - assignments count:', assignments.length);
      const assignmentMap = new Map<number, number[]>();
      assignments.forEach((item) => {
        const existing = assignmentMap.get(item.teacherId) || [];
        existing.push(item.classId);
        assignmentMap.set(item.teacherId, existing);
      });
      const teachingAssignmentConditions = [
        inArray(teacherClassSubjects.teacherId, teacherIds),
        eq(teacherClassSubjects.isActive, true),
      ];
      if (actor.role !== 'super_admin') {
        teachingAssignmentConditions.push(eq(teacherClassSubjects.schoolId, actor.schoolId!));
      } else if (filterSchoolId != null) {
        teachingAssignmentConditions.push(eq(teacherClassSubjects.schoolId, filterSchoolId));
      }
      const teachingAssignmentRows = teacherIds.length > 0
        ? await db.select({
            id: teacherClassSubjects.id,
            teacherId: teacherClassSubjects.teacherId,
            classId: teacherClassSubjects.classId,
            subjectId: teacherClassSubjects.subjectId,
            isActive: teacherClassSubjects.isActive,
          }).from(teacherClassSubjects).where(and(...teachingAssignmentConditions))
        : [];
      const teachingAssignmentMap = new Map<number, Array<{ id: number; classId: number; subjectId: number; isActive: boolean }>>();
      teachingAssignmentRows.forEach((assignment) => {
        const existing = teachingAssignmentMap.get(assignment.teacherId) ?? [];
        existing.push({ id: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId, isActive: assignment.isActive });
        teachingAssignmentMap.set(assignment.teacherId, existing);
      });
      const list = teachersList.map((teacher) => ({
        ...teacher,
        teacherId: teacher.id,
        subjectIds: (subjectAssignmentMap.get(teacher.id) ?? []).map((subject) => subject.id),
        assignedSubjects: subjectAssignmentMap.get(teacher.id) ?? [],
        ...(subjectAssignmentMap.has(teacher.id)
          ? { specialization: (subjectAssignmentMap.get(teacher.id) ?? []).map((subject) => subject.name).join(', ') }
          : {}),
        classIds: assignmentMap.get(teacher.id) || [],
        teachingAssignments: teachingAssignmentMap.get(teacher.id) || [],
      }));
      if (actor.role === 'teacher') {
        res.set('Cache-Control', 'no-store');
      }
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve teachers list' });
    }
  });

  app.post('/api/teachers', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) {
        return res.status(403).json({ error: 'Forbidden: only admin roles can create teachers' });
      }

      const { name, lastName, firstNames, email, phone, specialization, subjectIds, schoolId, classIds, teachingAssignments, gender } = req.body;
      const requestedClassIds = Array.isArray(classIds) ? classIds : [];
      const normalizedEmail = normalizeEmail(email);

      const fallbackName = typeof name === 'string' ? name.trim() : '';
      const derivedLastName = String(lastName ?? '').trim() || (fallbackName ? fallbackName.split(/\s+/).filter(Boolean)[0] ?? '' : '');
      const derivedFirstNames = String(firstNames ?? '').trim() || (fallbackName ? fallbackName.split(/\s+/).filter(Boolean).slice(1).join(' ') || fallbackName : '');
      const resolvedSchoolId = schoolId != null && schoolId !== '' ? parseInt(String(schoolId), 10) : actor.role === 'school_admin' ? actor.schoolId : null;

      if (!derivedLastName || !derivedFirstNames || !normalizedEmail || !resolvedSchoolId) {
        return res.status(400).json({ error: 'Missing compulsory details: lastName, firstNames, email and schoolId are required' });
      }
      const displayName = `${derivedLastName} ${derivedFirstNames}`.trim();

      const parsedSchoolId = parseInt(String(resolvedSchoolId), 10);
      const normalizedTeachingAssignments = Array.isArray(teachingAssignments)
        ? await validateTeacherClassSubjectAssignments(parsedSchoolId, teachingAssignments)
        : null;
      if (Array.isArray(teachingAssignments) && !normalizedTeachingAssignments) {
        return res.status(400).json({ error: 'Invalid teacher class and subject assignment' });
      }
      const effectiveClassIds = normalizedTeachingAssignments
        ? Array.from(new Set(normalizedTeachingAssignments.map((assignment) => assignment.classId)))
        : requestedClassIds;
      const effectiveSubjectIds = normalizedTeachingAssignments
        ? Array.from(new Set(normalizedTeachingAssignments.map((assignment) => assignment.subjectId)))
        : subjectIds;

      if (actor.role === 'school_admin') {
        if (actor.schoolId == null) {
          return res.status(403).json({ error: 'Forbidden: missing school context' });
        }
        if (parsedSchoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Cannot create teacher in another school' });
        }
      }
      
      // Email uniqueness check: per-school (same email allowed in different schools)
      const existingTeacherEmail = await findExistingUsersByEmailAndSchool(normalizedEmail, parsedSchoolId);
      if (existingTeacherEmail.length > 0) {
        return res.status(409).json({ error: 'User with same email already exists in this school' });
      }

      const canonicalPhone = canonicalizeUserPhone(phone);
      if (!canonicalPhone) return sendInvalidPhoneResponse(res);
      const existingByPhone = await findExistingUsersByPhone(canonicalPhone);
      if (existingByPhone.length > 0) return sendDuplicatePhoneResponse(res);

      // Create User entry first (fake uid for simulation unless logged in on firebase auth)
      const fakeUid = `sim_teacher_${Date.now()}`;
      const userResult = await db.insert(users).values({
        uid: fakeUid,
        email: normalizedEmail,
        name: displayName,
        lastName: String(lastName).trim().toUpperCase(),
        firstNames: String(firstNames).trim(),
        role: 'teacher',
        schoolId: parsedSchoolId,
        phone: canonicalPhone,
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
      if (Array.isArray(effectiveSubjectIds)) {
        await syncTeacherSubjectAssignments(createdTeacher.id, parsedSchoolId, effectiveSubjectIds);
      }
      if (normalizedTeachingAssignments) {
        await syncTeacherClassSubjectAssignments(createdTeacher.id, parsedSchoolId, normalizedTeachingAssignments);
      }
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
      if (effectiveClassIds.length > 0) {
        const parsedSchoolId = parseInt(schoolId, 10);
        console.log('Assigning classes to teacher (public create):', { teacherId: createdTeacher?.id, classIds: effectiveClassIds });
        for (const rawId of effectiveClassIds) {
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
              const existingAssignment = await db.select().from(classTeachers).where(and(
                eq(classTeachers.classId, cid),
                eq(classTeachers.teacherId, createdTeacher.id),
                eq(classTeachers.schoolId, parsedSchoolId),
              ));
            if (existingAssignment.length === 0) {
              await db.insert(classTeachers).values({ classId: cid, teacherId: createdTeacher.id, schoolId: parsedSchoolId });
                const insertedRows = await db.select().from(classTeachers).where(and(
                  eq(classTeachers.classId, cid),
                  eq(classTeachers.teacherId, createdTeacher.id),
                  eq(classTeachers.schoolId, parsedSchoolId),
                ));
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
          .where(and(
            eq(classTeachers.teacherId, createdTeacher.id),
            eq(classTeachers.schoolId, parsedSchoolId),
          ));
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
      if (isUsersPhoneUniqueViolation(err)) return sendDuplicatePhoneResponse(res);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 5. Parents - Filtered by school
  app.get('/api/parents', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      // accept optional filters from query params
      const filterSchoolId = req.query.schoolId ? parseInt(String(req.query.schoolId)) : null;
      const filterClassId = req.query.classId ? parseInt(String(req.query.classId)) : null;
      const searchQuery = String(req.query.q || '').trim();

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
        studentId: students.id,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        studentClassId: students.classId,
        studentSchoolId: students.schoolId,
        schoolId: parents.schoolId,
        className: classes.name,
        schoolName: schools.name,
        lastLoginAt: users.lastLoginAt,
      };

      if (actor.role === 'parent') {
        if (actor.id == null) return res.json([]);
        if (filterSchoolId != null && actor.schoolId != null && filterSchoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Cannot request parent data for another school' });
        }

        const childStudentIds = await getParentChildStudentIds(actor.id);
        const childClassRows = childStudentIds.length > 0
          ? await db.selectDistinct({ classId: students.classId }).from(students)
            .where(inArray(students.id, childStudentIds))
          : [];
        const childClassIds = childClassRows.map((row) => row.classId).filter((id): id is number => id != null);
        if (filterClassId != null && !childClassIds.includes(filterClassId)) return res.json([]);

        const ownParentConditions = [eq(parents.userId, actor.id)];
        if (filterClassId != null) ownParentConditions.push(eq(students.classId, filterClassId));
        if (searchQuery) {
          const searchPattern = `%${searchQuery}%`;
          ownParentConditions.push(or(
            ilike(users.name, searchPattern),
            ilike(users.email, searchPattern),
            ilike(students.firstName, searchPattern),
            ilike(students.lastName, searchPattern),
          ) as any);
        }

        const ownParentRows = await db.select({
          id: parents.id,
          userId: parents.userId,
          name: users.name,
          email: users.email,
          gender: users.gender,
          phone: parents.phone,
          address: parents.address,
          studentId: students.id,
          studentFirstName: students.firstName,
          studentLastName: students.lastName,
          studentClassId: students.classId,
          studentSchoolId: students.schoolId,
          schoolId: parents.schoolId,
          className: classes.name,
          schoolName: schools.name,
          lastLoginAt: users.lastLoginAt,
        }).from(parents)
          .innerJoin(users, eq(parents.userId, users.id))
          .leftJoin(students, and(
            eq(students.parentId, parents.id),
            childStudentIds.length > 0 ? inArray(students.id, childStudentIds) : sql`false`,
          ))
          .leftJoin(classes, eq(students.classId, classes.id))
          .leftJoin(schools, eq(parents.schoolId, schools.id))
          .where(and(...ownParentConditions));

        return res.json(ownParentRows);
      }

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

      if (actor.role === 'teacher') {
        // Allow teachers to view parents, but only for students in their active same-school classes.
        if (!actor.id) return res.json([]);
        if (actor.schoolId == null) return res.json([]);

        const teacherRow = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.userId, actor.id));
        const teacherId = teacherRow[0]?.id ?? null;
        if (teacherId == null) return res.json([]);

        const teacherAssignments = await db.select({ classId: classTeachers.classId }).from(classTeachers).where(and(
          eq(classTeachers.teacherId, teacherId),
          eq(classTeachers.schoolId, actor.schoolId),
        ));
        const teacherClassIds = Array.from(new Set(teacherAssignments
          .map((row: any) => Number(row.classId))
          .filter((id) => Number.isInteger(id))));
        const classRows = await db.select().from(classes);
        const sameSchoolTeacherClassIds = classRows
          .filter((row: any) => Number(row.schoolId) === Number(actor.schoolId) && teacherClassIds.includes(Number(row.id)))
          .map((row: any) => Number(row.id));
        const readableClassIds = Array.from(new Set([
          ...sameSchoolTeacherClassIds,
          ...(await getTeacherReadableClassIds(actor)),
        ]));

        if (filterClassId != null && !readableClassIds.includes(filterClassId)) {
          return res.status(403).json({ error: 'Teacher cannot request parents for an unauthorized class' });
        }

        const classScope = filterClassId != null ? [filterClassId] : readableClassIds;
        const allStudents = await db.select().from(students);
        const authorizedStudentIds = allStudents
          .filter((row: any) => classScope.includes(Number(row.classId))
            && Number(row.schoolId) === Number(actor.schoolId)
            && row.isActive === true)
          .map((row: any) => Number(row.id));

        if (!authorizedStudentIds.length) return res.json([]);

        oldModelQuery = oldModelQuery.where(inArray(students.id, authorizedStudentIds)) as any;
        newModelQuery = newModelQuery.where(inArray(students.id, authorizedStudentIds)) as any;
      }

      if (filterSchoolId) {
        oldModelQuery = oldModelQuery.where(eq(parents.schoolId, filterSchoolId)) as any;
        newModelQuery = newModelQuery.where(eq(userSchools.schoolId, filterSchoolId)) as any;
      }
      if (filterClassId) {
        oldModelQuery = oldModelQuery.where(eq(students.classId, filterClassId)) as any;
        newModelQuery = newModelQuery.where(eq(students.classId, filterClassId)) as any;
      }
      if (searchQuery) {
        const searchPattern = `%${searchQuery}%`;
        const searchCondition = or(
          ilike(users.name, searchPattern),
          ilike(students.firstName, searchPattern),
          ilike(students.lastName, searchPattern),
          sql`concat_ws(' ', ${users.name}, ${students.firstName}, ${students.lastName}) ILIKE ${searchPattern}`,
        );
        oldModelQuery = oldModelQuery.where(searchCondition) as any;
        newModelQuery = newModelQuery.where(searchCondition) as any;
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
        parentById.set(parent.id, {
          ...parent,
          schoolIds: parent.schoolId != null ? [parent.schoolId] : [],
        });
      }
      for (const parent of newParents) {
        const existing = parentById.get(parent.id);
        if (existing) {
          const mergedSchoolIds = Array.from(
            new Set([...(existing.schoolIds || []), parent.schoolId].filter((id) => id != null)),
          );
          parentById.set(parent.id, {
            ...existing,
            ...parent,
            schoolId: existing.schoolId ?? parent.schoolId,
            schoolIds: mergedSchoolIds,
          });
        } else {
          parentById.set(parent.id, {
            ...parent,
            schoolIds: parent.schoolId != null ? [parent.schoolId] : [],
          });
        }
      }

      const list = Array.from(parentById.values()).slice(0, searchQuery ? 25 : undefined);
      console.debug('[api/parents] returning parents count:', list.length, 'requestedClassId=', filterClassId, 'requestedSchoolId=', filterSchoolId, 'hasSearch=', Boolean(searchQuery));
      res.json(list);
    } catch (err: any) {
      console.error('Error fetching parents:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/parents', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
          const { name, email, phone, address, schoolId, studentId, gender } = req.body;
          const normalizedEmail = normalizeEmail(email);
          if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });

          // Load user and validate school permission
          const actor = await resolveActor(req);
          if (!actor) return res.status(404).json({ error: 'User not found' });
          if (!['super_admin', 'school_admin'].includes(actor.role)) {
            return res.status(403).json({ error: 'Forbidden: only admin roles can create parents' });
          }
          if (actor.role === 'school_admin' && actor.schoolId == null) {
            return res.status(403).json({ error: 'Forbidden: missing school context' });
          }

          const parsedStudentId = studentId != null && studentId !== '' ? parseInt(String(studentId), 10) : undefined;
          let resolvedSchoolId = schoolId != null && schoolId !== '' ? parseInt(String(schoolId), 10) : null;
          if (Number.isNaN(resolvedSchoolId as number)) resolvedSchoolId = null;

          if (parsedStudentId) {
            const [studentRow] = await db
              .select({ parentId: students.parentId, schoolId: students.schoolId, isActive: students.isActive })
              .from(students)
              .where(eq(students.id, parsedStudentId));

            if (!studentRow) {
              return res.status(400).json({ error: 'Student not found for provided studentId' });
            }

            if (studentRow.isActive !== true) {
              return res.status(400).json({ error: 'Only an active student can be linked to a parent account' });
            }

            if (studentRow.parentId != null) {
              return res.status(400).json({ error: 'Student is already linked to another parent' });
            }

            const expectedStudentSchoolId = resolvedSchoolId ?? actor.schoolId;
            if (expectedStudentSchoolId != null && studentRow.schoolId !== expectedStudentSchoolId) {
              return res.status(403).json({ error: 'Student does not belong to the selected parent school' });
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
            return sendDuplicateEmailResponse(res);
          }

          const canonicalPhone = canonicalizeUserPhone(phone);
          if (!canonicalPhone) return sendInvalidPhoneResponse(res);
          const existingByPhone = await findExistingUsersByPhone(canonicalPhone);
          if (existingByPhone.length > 0) return sendDuplicatePhoneResponse(res);

          const fakeUid = `sim_parent_${Date.now()}`;
          const { createdUser, createdParent } = await db.transaction(async (tx) => {
            const [newUser] = await tx.insert(users).values({
              uid: fakeUid,
              email: normalizedEmail,
              name,
              role: 'parent',
              schoolId: effectiveSchoolId,
              phone: canonicalPhone,
              gender: gender ?? null,
            }).returning();

            const [newParent] = await tx.insert(parents).values({
              userId: newUser.id,
              phone: canonicalPhone,
              address,
              studentId: parsedStudentId ?? null,
              schoolId: effectiveSchoolId ?? null,
            }).returning();

            if (parsedStudentId != null) {
              const linkConditions = [
                eq(students.id, parsedStudentId),
                eq(students.isActive, true),
                sql`${students.parentId} IS NULL`,
              ];
              if (effectiveSchoolId != null) linkConditions.push(eq(students.schoolId, effectiveSchoolId));
              const linkedStudents = await tx.update(students)
                .set({ parentId: newParent.id })
                .where(and(...linkConditions))
                .returning({ id: students.id });
              if (linkedStudents.length === 0) {
                throw new Error('Parent student link could not be created');
              }
            }

            if (effectiveSchoolId != null) {
              await tx.insert(userSchools).values({
                userId: newUser.id,
                schoolId: effectiveSchoolId,
                role: 'parent',
                isActive: true,
              });
            }

            return { createdUser: newUser, createdParent: newParent };
          });

          res.status(201).json({
            ...createdUser,
            parentId: createdParent.id,
            phone: canonicalPhone,
            address,
            studentId: createdParent.studentId,
            schoolId: createdParent.schoolId ?? null,
          });
        } catch (err: any) {
          console.error('Parent creation failed');
          if (isUsersEmailUniqueViolation(err)) return sendDuplicateEmailResponse(res);
          if (isUsersPhoneUniqueViolation(err)) return sendDuplicatePhoneResponse(res);
          res.status(500).json({ error: 'Internal server error' });
        }
      });

  // Return an Excel template for parents (public - no auth required)
  app.get('/api/parents/template', async (req, res) => {
    try {
      const headers = [...PARENT_IMPORT_HEADERS];
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('parents');
      worksheet.addRow(headers);
      worksheet.columns = headers.map((_, index) => ({ width: index === 0 ? 24 : 18 }));
      worksheet.views = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }];
      worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        };
      });
      const instructions = [
        ['Colonne', 'Format attendu', 'Exemple'],
        ['phonePrefix', 'Indicatif togolais 228, +228 ou 00228. Facultatif : +228 est utilisé par défaut.', '228'],
        ['phone', '8 chiffres locaux, ou numéro complet +228..., 00228... ou 228...; espaces et séparateurs sont ignorés.', '90121212'],
        ['Combinaison', 'Avec un numéro local, phonePrefix est ajouté une seule fois. Avec un numéro complet, phonePrefix peut être vide ou 228; il n’est jamais ajouté une deuxième fois.', '228 + 90121212 → +22890121212'],
        ['Numéro complet', 'Un indicatif déjà présent est reconnu et normalisé en +228; aucun double indicatif n’est ajouté.', '00228 90121212 → +22890121212'],
      ];
      const instructionsWorksheet = workbook.addWorksheet('Instructions');
      instructionsWorksheet.addRows(instructions);
      instructionsWorksheet.columns = [{ width: 20 }, { width: 86 }, { width: 38 }];
      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="parents_template.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error('Error generating parents template:', err);
      res.status(500).json({ error: 'Failed to generate template' });
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
          studentId: students.id,
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
      const parent = rows[0];

      if (actor.role === 'super_admin') {
        return res.json(parent);
      }

      if (actor.role === 'parent') {
        if (actor.id === parent.userId) {
          const childStudentIds = await getParentChildStudentIds(actor.id);
          return res.json({
            ...parent,
            studentId: parent.studentId != null && childStudentIds.includes(parent.studentId) ? parent.studentId : null,
          });
        }
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (actor.role === 'school_admin') {
        if (actor.schoolId === parent.schoolId) {
          return res.json(parent);
        }
        const membership = await ensureUserSchoolMembership(parent.userId, actor.schoolId, 'parent');
        if (membership) {
          return res.json(parent);
        }
        return res.status(403).json({ error: 'Forbidden' });
      }

      return res.status(403).json({ error: 'Forbidden' });
    } catch (err: any) {
      console.error('Failed to fetch parent by id:', err);
      res.status(500).json({ error: 'Failed to fetch parent' });
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

      const errors: { row: number; name?: string; email?: string; error: string }[] = [];
      const inserted: any[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        const requestedSchoolId = r.schoolId != null && r.schoolId !== '' ? parseInt(String(r.schoolId), 10) : null;
        const rawName = typeof r.name === 'string' ? r.name.trim() : '';
        const hasSeparateNames = r.Nom != null && r['Prénoms'] != null;

        if (!hasSeparateNames && rawName) {
          const parts = rawName.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) {
            r.Nom = parts[0];
            r['Prénoms'] = parts.slice(1).join(' ');
          } else {
            r.Nom = rawName;
            r['Prénoms'] = '';
          }
        }

        let schoolId = null;
        if (actor.role === 'school_admin') {
          if (actor.schoolId == null) {
            const rowName = (typeof r.name === 'string' ? r.name : '').trim();
            errors.push({ row: i + 2, name: rowName || undefined, email: normalizeEmail(r.email || '') || undefined, error: 'Forbidden: missing school context' });
            continue;
          }
          if (requestedSchoolId != null && requestedSchoolId !== actor.schoolId) {
            const rowName = (typeof r.name === 'string' ? r.name : '').trim();
            errors.push({ row: i + 2, name: rowName || undefined, email: normalizeEmail(r.email || '') || undefined, error: 'Cannot import parent for another school' });
            continue;
          }
          schoolId = actor.schoolId;
        } else {
          schoolId = requestedSchoolId;
        }

        const validation = validateParentImportRow(r, { requireSchoolId: actor.role === 'super_admin' });
        const normalizedRow = validation.normalized;
        const name = (normalizedRow.name || '').trim();
        const normalizedEmail = normalizeEmail(normalizedRow.email || '');
        const phone = normalizedRow.phone;
        const address = normalizedRow.address || '';
        const gender = normalizedRow.gender || null;
        const addRowError = (error: string) => errors.push({ row: i + 2, name: name || undefined, email: normalizedEmail || undefined, error });

        if (!name && !hasSeparateNames && !rawName) {
          addRowError('Les colonnes Nom et Prénoms sont obligatoires');
          continue;
        }

        if (validation.errors.length > 0) {
          addRowError(validation.errors.join('; '));
          continue;
        }

        // Check email uniqueness per-school (same email allowed in different schools)
        const existing = await findExistingUsersByEmailAndSchool(normalizedEmail, schoolId);
        if (existing && existing.length > 0) {
          addRowError('duplicate email in this school');
          continue;
        }

        const existingGlobal = await findExistingUsersByEmail(normalizedEmail);
        if (existingGlobal.length > 0) {
          addRowError('Cet email est déjà utilisé et ne peut pas être importé dans cet établissement');
          continue;
        }

        const canonicalPhone = canonicalizeUserPhone(phone);
        if (!canonicalPhone) {
          addRowError('Un numéro de téléphone valide est obligatoire');
          continue;
        }
        const existingByPhone = await findExistingUsersByPhone(canonicalPhone);
        if (existingByPhone.length > 0) {
          addRowError(DUPLICATE_PHONE_ERROR.message);
          continue;
        }

        // option: link to student by studentIds or studentNames
        let linkedStudentId: number | null = null;
        const errorsBeforeStudentLookup = errors.length;
        if (normalizedRow.studentId) {
          const requestedStudentId = parseInt(normalizedRow.studentId, 10);
          const [srow] = await db.select().from(students).where(eq(students.id, requestedStudentId));
          if (srow && srow.isActive === true && srow.parentId == null && (schoolId == null || srow.schoolId === schoolId)) {
            linkedStudentId = srow.id;
          } else if (!existing || existing.length === 0) {
            addRowError(`studentId absent, inactif, déjà rattaché ou hors établissement: ${normalizedRow.studentId}`);
          }
        } else if (r.studentIds) {
          const ids = String(r.studentIds).split(/[,;]+/).map((s: string) => parseInt(s.trim())).filter((n) => !isNaN(n));
          for (const sid of ids) {
            const [srow] = await db.select().from(students).where(eq(students.id, sid));
            if (srow && srow.isActive === true && srow.parentId == null && (schoolId == null || srow.schoolId === schoolId)) { linkedStudentId = srow.id; break; }
          }
          if (ids.length > 0 && !linkedStudentId) {
            addRowError(`studentIds provided but no unlinked active student found in this school (${String(r.studentIds)})`);
          }
        } else if (r.studentNames) {
          const names = String(r.studentNames).split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
          for (const nm of names) {
            const parts = nm.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
              const first = parts[0];
              const last = parts.slice(1).join(' ');
              const nameConditions = [eq(sql`LOWER(${students.firstName})`, first.toLowerCase()), eq(sql`LOWER(${students.lastName})`, last.toLowerCase()), eq(students.isActive, true), sql`${students.parentId} IS NULL`];
              if (schoolId != null) nameConditions.push(eq(students.schoolId, schoolId));
              const [srow] = await db.select().from(students).where(and(...nameConditions));
              if (srow) { linkedStudentId = srow.id; break; }
            }
          }
          if (names.length > 0 && !linkedStudentId) {
            addRowError(`studentNames provided but no matching student found (${String(r.studentNames)})`);
          }
        }

        if (errors.length > errorsBeforeStudentLookup) continue;

        const fakeUid = `sim_parent_${Date.now()}_${i}`;
        const temporaryCredential = generateTemporaryLocalPassword();
        let createdUser: typeof users.$inferSelect;
        let parentId: number;
        try {
          ({ createdUser, parentId } = await db.transaction(async (tx) => {
            const [newUser] = await tx.insert(users).values({
              uid: fakeUid,
              email: normalizedEmail,
              name,
              role: 'parent',
              schoolId,
              gender,
              phone: canonicalPhone,
            }).returning();
            await tx.insert(localAuths).values({
              userId: newUser.id,
              passwordHash: temporaryCredential.passwordHash,
              salt: temporaryCredential.salt,
              mustReset: true,
            });
            const [newParent] = await tx.insert(parents).values({
              userId: newUser.id,
              phone: canonicalPhone,
              address: address || null,
              studentId: linkedStudentId,
              schoolId: schoolId || null,
            }).returning();
            if (linkedStudentId != null) {
              const linkConditions = [
                eq(students.id, linkedStudentId),
                sql`${students.parentId} IS NULL`,
                eq(students.isActive, true),
              ];
              if (schoolId != null) linkConditions.push(eq(students.schoolId, schoolId));
              const linkedStudents = await tx.update(students)
                .set({ parentId: newParent.id })
                .where(and(...linkConditions))
                .returning({ id: students.id });
              if (linkedStudents.length === 0) {
                throw new Error('Parent student link could not be created');
              }
            }
            if (schoolId != null) {
              await tx.insert(userSchools).values({
                userId: newUser.id,
                schoolId,
                role: 'parent',
                isActive: true,
              });
            }
            return { createdUser: newUser, parentId: newParent.id };
          }));
        } catch (err: any) {
          if (isUsersPhoneUniqueViolation(err)) {
            addRowError(DUPLICATE_PHONE_ERROR.message);
            continue;
          }
          throw err;
        }

        inserted.push({
          user: createdUser,
          parentId,
          temporaryPassword: temporaryCredential.temporaryPassword,
        });
      }

      // audit
      await logAuditEvent(actor, 'import', 'parents_batch', null, actor.schoolId ?? null, `Imported ${inserted.length} parents, ${errors.length} errors`);

      res.json({ insertedCount: inserted.length, errors, inserted });
    } catch (err: any) {
      console.error('Error importing parents batch:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 6. Students - Filtered by school
  app.get('/api/students', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      const includeFormer = req.query.includeFormer === 'true';

      let query = db
        .select({
          id: students.id,
          firstName: students.firstName,
          lastName: students.lastName,
          birthDate: students.birthDate,
          gender: students.gender,
          schoolId: students.schoolId,
          classId: students.classId,
          isActive: students.isActive,
          withdrawnAt: students.withdrawnAt,
          matricule: students.matricule,
          className: classes.name,
          yearId: academicYears.id,
          yearName: academicYears.name,
          parentId: students.parentId,
          parentName: users.name,
          schoolAdminId: students.schoolAdminId,
          enrolledAt: students.enrolledAt,
        })
        .from(students)
        .leftJoin(classes, eq(students.classId, classes.id))
        .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id))
        .leftJoin(parents, eq(students.parentId, parents.id))
        .leftJoin(users, eq(parents.userId, users.id));
      const queryConditions: Array<ReturnType<typeof eq>> = [];

      if (actor.role === 'teacher') {
          // Robust checks: teacher must have an id and belong to a school to access students
          if (!actor.id) return res.json([]);
          if (actor.schoolId == null) return res.json([]);

          const teacherScope = await getTeacherAuthorizationScope(actor);
          if (!teacherScope) return res.json([]);
          const authorizedIds = await getScopedTeacherReadableStudentIds(teacherScope);
          if (!authorizedIds || authorizedIds.length === 0) return res.json([]);

          queryConditions.push(inArray(students.id, authorizedIds));
      } else if (actor.role === 'school_admin') {
        if (actor.schoolId) {
          queryConditions.push(eq(students.schoolId, actor.schoolId));
        } else {
          return res.json([]);
        }
      } else if (actor.role !== 'super_admin') {
        if (actor.role === 'parent') {
          const childStudentIds = await getParentChildStudentIds(actor.id);
          if (childStudentIds.length === 0) {
            return res.json([]);
          }
          queryConditions.push(inArray(students.id, childStudentIds));
        } else if (actor.schoolId) {
          queryConditions.push(eq(students.schoolId, actor.schoolId));
        } else {
          return res.json([]);
        }
      }

      if (!includeFormer) queryConditions.push(eq(students.isActive, true));
      if (queryConditions.length > 0) query = query.where(and(...queryConditions)) as any;

      const list = await query;
      const studentIds = list.map((student: any) => student.id).filter((id: any): id is number => Number.isInteger(id));
      const statusRows = studentIds.length > 0
        ? await db
          .select({ studentId: studentAcademicYearStatuses.studentId, academicYearId: studentAcademicYearStatuses.academicYearId, status: studentAcademicYearStatuses.status })
          .from(studentAcademicYearStatuses)
          .where(inArray(studentAcademicYearStatuses.studentId, studentIds))
        : [];
      const statusesByStudent = new Map<number, Array<{ academicYearId: number; status: string | null }>>();
      for (const row of statusRows) {
        const existing = statusesByStudent.get(row.studentId) || [];
        existing.push({ academicYearId: row.academicYearId, status: row.status });
        statusesByStudent.set(row.studentId, existing);
      }
      res.json(list.map((student: any) => ({
        ...student,
        studentStatus: statusesByStudent.get(student.id)?.find((entry) => entry.academicYearId === student.yearId)?.status ?? null,
        academicYearStatuses: statusesByStudent.get(student.id) || [],
      })));
    } catch (err: any) {
      console.error('Error fetching students:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/students', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { firstName, lastName, birthDate, schoolId, classId, parentId, schoolAdminId, gender, enrolledAt, academicYearId, studentStatus } = req.body;
      const normalizedFirstName = normalizeFirstName(firstName);
      const normalizedLastName = typeof lastName === 'string' ? lastName.toUpperCase() : lastName;
      const parsedSchoolId = schoolId !== undefined && schoolId !== null && String(schoolId).trim() !== '' ? parseInt(String(schoolId)) : null;
      const parsedClassId = classId !== undefined && classId !== null && String(classId).trim() !== '' ? parseInt(String(classId)) : null;
      const parsedParentId = parentId !== undefined && parentId !== null && String(parentId).trim() !== '' ? parseInt(String(parentId)) : null;
      const parsedSchoolAdminId = schoolAdminId !== undefined && schoolAdminId !== null && String(schoolAdminId).trim() !== '' ? parseInt(String(schoolAdminId)) : null;
      const parsedEnrolledAt = enrolledAt ? new Date(enrolledAt) : new Date();

      // Load user and validate school permission
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) {
        return res.status(403).json({ error: 'Only super_admin or school_admin can create students' });
      }
      if (actor.role === 'school_admin' && actor.schoolId == null) {
        return res.status(403).json({ error: 'Forbidden: missing school context' });
      }

      const effectiveSchoolId = actor.role === 'school_admin' ? actor.schoolId : parsedSchoolId;

      if (!normalizedFirstName || !lastName || !effectiveSchoolId || !parsedClassId) {
        return res.status(400).json({ error: `Missing compulsory student parameters. Received firstName=${firstName}, lastName=${lastName}, schoolId=${schoolId}, classId=${classId}` });
      }

      const normalizedGender = typeof gender === 'string' ? gender.trim() : '';
      if (!normalizedGender) {
        return res.status(400).json({ error: 'Gender is required when creating a student.' });
      }

      const validGenderValues = ['M', 'F', 'Masculin', 'Féminin', 'Feminin', 'm', 'f', 'male', 'female', 'masculin', 'feminin', 'homme', 'femme', 'garcon', 'fille'];
      const normalizedGenderKey = normalizedGender.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (!validGenderValues.includes(normalizedGender) && !validGenderValues.includes(normalizedGenderKey)) {
        return res.status(400).json({ error: 'Invalid gender value. Use M or F / Masculin or Féminin.' });
      }

      const [classRecord] = await db.select({ id: classes.id, schoolId: classes.schoolId, academicYearId: classes.academicYearId }).from(classes).where(eq(classes.id, parsedClassId));
      if (!classRecord) {
        return res.status(404).json({ error: 'Class not found' });
      }

      const targetSchoolId = effectiveSchoolId as number;
      const selectedAcademicYearId = academicYearId !== undefined && academicYearId !== null && String(academicYearId).trim() !== ''
        ? parseInt(String(academicYearId), 10)
        : classRecord.academicYearId;
      if (!Number.isInteger(selectedAcademicYearId) || selectedAcademicYearId <= 0) {
        return res.status(400).json({ error: 'Invalid academicYearId' });
      }
      const normalizedStudentStatus = studentStatus !== undefined && studentStatus !== null && String(studentStatus).trim() !== ''
        ? String(studentStatus).trim()
        : null;
      if (normalizedStudentStatus !== null && !isStudentAcademicYearStatus(normalizedStudentStatus)) {
        return res.status(400).json({ error: 'Invalid student status' });
      }
      // Enforce per-school student creation lock: school_admins cannot create when locked
      const [schoolRow] = await db.select().from(schools).where(eq(schools.id, targetSchoolId));
      if (schoolRow && (schoolRow.studentsCreationLocked ?? false) && actor.role === 'school_admin') {
        return res.status(403).json({ error: 'La création d\'élèves est temporairement verrouillée par le Super Admin pour cet établissement.' });
      }
      if (classRecord.schoolId !== targetSchoolId) {
        const classAllowed = classRecord.schoolId == null && await isApprovedClassForSchool(parsedClassId, targetSchoolId);
        if (!classAllowed) {
          return res.status(403).json({ error: 'Class does not belong to the selected school' });
        }
      }

      if (parsedParentId) {
        const [parentRecord] = await db.select({ id: parents.id, userId: parents.userId, schoolId: parents.schoolId }).from(parents).where(eq(parents.id, parsedParentId));
        if (!parentRecord) {
          return res.status(404).json({ error: 'Parent not found' });
        }
        if (actor.role !== 'super_admin' && parentRecord.schoolId !== targetSchoolId) {
          const membership = await ensureUserSchoolMembership(parentRecord.userId, targetSchoolId, 'parent');
          if (!membership) {
            return res.status(403).json({ error: 'Parent does not belong to the selected school' });
          }
        }
      }

      // School admin can only create students in their own school
      if (actor.role === 'school_admin' && effectiveSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Cannot create student in another school' });
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

      const createdStudent = await db.transaction(async (tx) => {
        const [student] = await tx.insert(students).values({
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
          birthDate,
          gender: normalizedGender,
          schoolId: effectiveSchoolId,
          classId: parsedClassId,
          parentId: parsedParentId,
          schoolAdminId: resolvedSchoolAdminId,
          enrolledAt: parsedEnrolledAt,
        }).returning();

        await tx.insert(studentAcademicYearStatuses).values({
          studentId: student.id,
          academicYearId: selectedAcademicYearId,
          status: normalizedStudentStatus,
        });

        return student;
      });

      res.status(201).json(createdStudent);
    } catch (err: any) {
      console.error('Error creating student profile:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update student
  app.put('/api/students/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const studentId = parseInt(req.params.id, 10);
      const { firstName, lastName, birthDate, schoolId, classId, parentId, academicYearId, teacherId, schoolAdminId, gender, studentStatus } = req.body;
      const normalizedFirstName = normalizeFirstName(firstName);
      const normalizedLastName = typeof lastName === 'string' ? lastName.toUpperCase() : lastName;

      if (!studentId) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin'].includes(actor.role)) {
        return res.status(403).json({ error: 'Only super_admin or school_admin can update students' });
      }

      const [existingStudent] = await db.select().from(students).where(eq(students.id, studentId));
      if (!existingStudent) return res.status(404).json({ error: 'Student not found' });

      if (classId === null && Object.keys(req.body).length === 1) {
        if (actor.role === 'school_admin' && (actor.schoolId == null || existingStudent.schoolId !== actor.schoolId)) {
          return res.status(403).json({ error: 'You can only update students from your school' });
        }
        if (existingStudent.classId == null) return res.status(200).json(existingStudent);

        const [detachedStudent] = await db
          .update(students)
          .set({ classId: null, isActive: false, withdrawnAt: new Date() })
          .where(eq(students.id, studentId))
          .returning();
        await logAuditEvent(actor, 'update', 'student', studentId, existingStudent.schoolId, 'Student removed from current class');
        return res.status(200).json(detachedStudent);
      }

      if (!normalizedFirstName || !lastName || parentId == null) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const requestedSchoolId = schoolId !== undefined && schoolId !== null && String(schoolId).trim() !== '' ? parseInt(String(schoolId), 10) : existingStudent.schoolId;
      if (schoolId !== undefined && schoolId !== null && String(schoolId).trim() !== '' && Number.isNaN(requestedSchoolId)) {
        return res.status(400).json({ error: 'Invalid schoolId' });
      }
      if (requestedSchoolId != null && requestedSchoolId <= 0) {
        return res.status(400).json({ error: 'Invalid schoolId' });
      }

      if (actor.role === 'school_admin' && actor.schoolId != null) {
        if (existingStudent.schoolId != null && actor.schoolId !== existingStudent.schoolId) {
          return res.status(403).json({ error: 'You can only update students from your school' });
        }
        if (requestedSchoolId != null && requestedSchoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Cannot move student to another school' });
        }
      }

      const classWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'classId');
      if (!classWasProvided) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const parsedClassId = classId !== undefined && classId !== null && String(classId).trim() !== ''
        ? parseInt(String(classId), 10)
        : null;
      if (existingStudent.isActive === false && parsedClassId != null) {
        return res.status(409).json({ error: 'An exited student cannot be assigned to a class without an explicit re-enrollment workflow' });
      }
      const parsedParentId = parseInt(String(parentId), 10);
      const parsedSchoolAdminId = schoolAdminId !== undefined && schoolAdminId !== null && String(schoolAdminId).trim() !== '' ? parseInt(String(schoolAdminId), 10) : (existingStudent.schoolAdminId ?? null);
      const newGender = gender !== undefined && gender !== null && String(gender).trim() !== '' ? String(gender) : existingStudent.gender;

      if (classWasProvided && classId !== null && String(classId).trim() !== '' && parsedClassId != null && (Number.isNaN(parsedClassId) || parsedClassId <= 0)) {
        return res.status(400).json({ error: 'Invalid classId' });
      }
      if (Number.isNaN(parsedParentId) || parsedParentId <= 0) {
        return res.status(400).json({ error: 'Invalid parentId' });
      }
      if (parsedSchoolAdminId != null && Number.isNaN(parsedSchoolAdminId)) {
        return res.status(400).json({ error: 'Invalid schoolAdminId' });
      }

      let classRecord: { id: number; schoolId: number | null; academicYearId: number } | undefined;
      if (parsedClassId != null) {
        [classRecord] = await db
          .select({ id: classes.id, schoolId: classes.schoolId, academicYearId: classes.academicYearId })
          .from(classes)
          .where(eq(classes.id, parsedClassId));
        if (!classRecord) return res.status(404).json({ error: 'Class not found' });
      }

      const resolvedSchoolId = requestedSchoolId ?? classRecord?.schoolId ?? existingStudent.schoolId;
      if (existingStudent.isActive === false && (
        resolvedSchoolId !== existingStudent.schoolId
        || parsedParentId !== (existingStudent.parentId ?? null)
      )) {
        return res.status(409).json({ error: 'School and parent links for former students cannot be changed without an explicit re-enrollment workflow' });
      }
      if (existingStudent.isActive === true && existingStudent.classId != null && parsedClassId == null) {
        return res.status(409).json({ error: 'Use the student withdrawal action to remove an active student from their class' });
      }
      const selectedAcademicYearId = academicYearId !== undefined && academicYearId !== null && String(academicYearId).trim() !== ''
        ? parseInt(String(academicYearId), 10)
        : classRecord?.academicYearId ?? null;
      if (selectedAcademicYearId == null || !Number.isInteger(selectedAcademicYearId) || selectedAcademicYearId <= 0) {
        return res.status(400).json({ error: 'Invalid academicYearId' });
      }
      const statusWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'studentStatus');
      const [existingStatusRow] = await db
        .select({ status: studentAcademicYearStatuses.status })
        .from(studentAcademicYearStatuses)
        .where(and(
          eq(studentAcademicYearStatuses.studentId, studentId),
          eq(studentAcademicYearStatuses.academicYearId, selectedAcademicYearId),
        ));
      const newStudentStatus = statusWasProvided
        ? (studentStatus !== undefined && studentStatus !== null && String(studentStatus).trim() !== '' ? String(studentStatus).trim() : null)
        : existingStatusRow?.status ?? null;
      if (newStudentStatus !== null && !isStudentAcademicYearStatus(newStudentStatus)) {
        return res.status(400).json({ error: 'Invalid student status' });
      }
      if (actor.role === 'school_admin' && actor.schoolId != null && resolvedSchoolId != null && resolvedSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Cannot assign student to another school' });
      }

      if (parsedClassId != null && classRecord && classRecord.schoolId !== resolvedSchoolId) {
        const classAllowed = classRecord.schoolId == null && await isApprovedClassForSchool(parsedClassId, resolvedSchoolId);
        if (!classAllowed) {
          return res.status(403).json({ error: 'Class does not belong to the selected school' });
        }
      }

      const [parentRecord] = await db
        .select({ id: parents.id, userId: parents.userId, schoolId: parents.schoolId })
        .from(parents)
        .where(eq(parents.id, parsedParentId));
      if (!parentRecord) return res.status(404).json({ error: 'Parent not found' });

      if (actor.role !== 'super_admin' && resolvedSchoolId != null && parentRecord.schoolId !== resolvedSchoolId) {
        const membership = await ensureUserSchoolMembership(parentRecord.userId, resolvedSchoolId, 'parent');
        if (!membership) {
          return res.status(403).json({ error: 'Parent does not belong to the selected school' });
        }
      }

      if (parsedSchoolAdminId != null) {
        const [assignedAdmin] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, parsedSchoolAdminId), eq(users.role, 'school_admin')));
        if (!assignedAdmin) {
          return res.status(400).json({ error: 'Invalid schoolAdminId' });
        }
        if (resolvedSchoolId != null && assignedAdmin.schoolId !== resolvedSchoolId) {
          return res.status(400).json({ error: 'schoolAdminId does not belong to the selected school' });
        }
      }

      const changes: string[] = [];
      if (existingStudent.firstName !== normalizedFirstName) changes.push(`firstName: "${existingStudent.firstName}" → "${normalizedFirstName}"`);
      if (existingStudent.lastName !== normalizedLastName) changes.push(`lastName: "${existingStudent.lastName}" → "${normalizedLastName}"`);
      if (existingStudent.birthDate !== birthDate) changes.push(`birthDate: "${existingStudent.birthDate}" → "${birthDate}"`);
      if (existingStudent.gender !== newGender) changes.push(`gender: "${existingStudent.gender ?? ''}" → "${newGender ?? ''}"`);
      if (existingStudent.schoolId !== resolvedSchoolId) changes.push(`schoolId: ${existingStudent.schoolId} → ${resolvedSchoolId}`);
      if (existingStudent.classId !== parsedClassId) changes.push(`classId: ${existingStudent.classId ?? 'null'} → ${parsedClassId ?? 'null'}`);
      if (existingStudent.parentId !== parsedParentId) changes.push(`parentId: ${existingStudent.parentId} → ${parsedParentId}`);
      if ((existingStudent.schoolAdminId ?? null) !== parsedSchoolAdminId) changes.push(`schoolAdminId: ${existingStudent.schoolAdminId ?? 'null'} → ${parsedSchoolAdminId}`);
      if (statusWasProvided && (existingStatusRow?.status ?? null) !== newStudentStatus) changes.push(`studentStatus: "${existingStatusRow?.status ?? ''}" → "${newStudentStatus ?? ''}"`);

      if (changes.length === 0) {
        return res.status(200).json(existingStudent);
      }

      const studentValues = {
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        birthDate,
        gender: newGender,
        schoolId: resolvedSchoolId,
        classId: parsedClassId,
        parentId: parsedParentId,
        schoolAdminId: parsedSchoolAdminId,
      };
      const updateStudent = async (executor: typeof db) => executor
        .update(students)
        .set(studentValues)
        .where(eq(students.id, studentId))
        .returning();
      const result = statusWasProvided
        ? await db.transaction(async (tx) => {
          const updated = await updateStudent(tx);
          await tx.insert(studentAcademicYearStatuses).values({
            studentId,
            academicYearId: selectedAcademicYearId,
            status: newStudentStatus,
          }).onConflictDoUpdate({
            target: [studentAcademicYearStatuses.studentId, studentAcademicYearStatuses.academicYearId],
            set: { status: newStudentStatus, updatedAt: new Date() },
          });
          return updated;
        })
        : await updateStudent(db);

      await logAuditEvent(
        actor,
        'update',
        'student',
        studentId,
        resolvedSchoolId ?? null,
        `Student updated: ${changes.join('; ')}`
      );

      res.status(200).json(result[0]);
    } catch (err: any) {
      console.error('Error updating student:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================
  // MODULE ABSENCES API
  // ==========================================

  const isDeclarationDate = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const isDeclarationTime = (value: unknown) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const todayIsoDate = () => new Date().toISOString().slice(0, 10);

  const notifyAbsenceDeclarationParent = async (parentUserId: number, title: string, message: string, metadata: Record<string, unknown>) => {
    await db.insert(notifications).values({ userId: parentUserId, title, body: message, type: 'absence' });
    try {
      const payload = {
        parentId: parentUserId,
        title,
        message,
        category: 'absence',
        metadata: { target: 'absence', ...metadata },
        dedupeKey: `absence-declaration-${String(metadata.declarationId)}-${String(metadata.status || 'received')}-${Date.now()}`,
      };
      const { signature, timestamp } = signInternalPayload(payload);
      await fetch(`${process.env.API_URL || 'http://localhost:3001'}/api/internal/absence-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Signature': signature,
          'X-Internal-Timestamp': timestamp,
        },
        body: JSON.stringify(payload),
      });
    } catch (error: any) {
      console.error('Failed to dispatch absence declaration notification:', error?.message || error);
    }
  };

  const runParentDeclarationAction = async (
    parentUserId: number,
    action: string,
    input: any,
  ): Promise<{ status: number; body: any }> => {
    const [parentRecord] = await db.select({ id: parents.id }).from(parents).where(eq(parents.userId, parentUserId));
    if (!parentRecord) return { status: 404, body: { error: 'Parent profile not found' } };
    const childStudentIds = await getParentChildStudentIds(parentUserId);

    if (action === 'list') {
      if (childStudentIds.length === 0) return { status: 200, body: [] };
      const rows = await db.select({
        id: absenceDeclarations.id,
        studentId: absenceDeclarations.studentId,
        studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
        classId: students.classId,
        className: classes.name,
        schoolId: students.schoolId,
        date: absenceDeclarations.date,
        startTime: absenceDeclarations.startTime,
        endTime: absenceDeclarations.endTime,
        reason: absenceDeclarations.reason,
        status: absenceDeclarations.status,
        rejectionReason: absenceDeclarations.rejectionReason,
        reviewedBy: absenceDeclarations.reviewedBy,
        reviewedAt: absenceDeclarations.reviewedAt,
      }).from(absenceDeclarations)
        .innerJoin(students, eq(students.id, absenceDeclarations.studentId))
        .leftJoin(classes, eq(classes.id, students.classId))
        .where(and(
          eq(absenceDeclarations.parentId, parentRecord.id),
          inArray(absenceDeclarations.studentId, childStudentIds),
        ))
        .orderBy(desc(absenceDeclarations.date), desc(absenceDeclarations.createdAt));
      return { status: 200, body: rows };
    }

    const studentId = Number(input?.studentId);
    const date = input?.date;
    const startTime = typeof input?.startTime === 'string' ? input.startTime.trim() : '';
    const endTime = typeof input?.endTime === 'string' ? input.endTime.trim() : '';
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if ((action === 'create' || action === 'update') && !reason) {
      return { status: 400, body: { error: 'Le motif de la déclaration est obligatoire.' } };
    }
    if (action !== 'cancel' && (
      !Number.isInteger(studentId) || studentId <= 0 ||
      !isDeclarationDate(date) || date < todayIsoDate() ||
      !isDeclarationTime(startTime) || !isDeclarationTime(endTime) || startTime >= endTime
    )) {
      return { status: 400, body: { error: 'Invalid absence declaration details' } };
    }
    if (action !== 'cancel' && !childStudentIds.includes(studentId)) {
      return { status: 403, body: { error: 'Cannot declare an absence for a student you do not represent' } };
    }

    if (action === 'create') {
      const [created] = await db.insert(absenceDeclarations).values({
        studentId,
        parentId: parentRecord.id,
        date,
        startTime,
        endTime,
        reason: reason || null,
        status: 'RECEIVED',
      }).returning();
      if (date <= todayIsoDate()) {
        await db.update(absences).set({ declarationId: created.id }).where(and(
          eq(absences.studentId, studentId),
          eq(absences.date, date),
          sql`${absences.declarationId} IS NULL`,
          sql`${absences.startTime} < ${endTime}`,
          sql`${absences.endTime} > ${startTime}`,
        ));
      }
      return { status: 201, body: created };
    }

    const declarationId = Number(input?.id);
    if (!Number.isInteger(declarationId) || declarationId <= 0) {
      return { status: 400, body: { error: 'Invalid declaration id' } };
    }
    const [declaration] = await db.select().from(absenceDeclarations).where(and(
      eq(absenceDeclarations.id, declarationId),
      eq(absenceDeclarations.parentId, parentRecord.id),
    ));
    if (!declaration) return { status: 404, body: { error: 'Declaration not found' } };
    if (!childStudentIds.includes(declaration.studentId)) {
      return { status: 403, body: { error: 'Declaration student is no longer currently linked to this parent' } };
    }
    if (declaration.date < todayIsoDate()) {
      return { status: 409, body: { error: 'A past declaration cannot be changed' } };
    }
    const linkedAbsence = await db.select({ id: absences.id }).from(absences)
      .where(eq(absences.declarationId, declarationId)).limit(1);
    if (linkedAbsence.length > 0) {
      return { status: 409, body: { error: 'A declaration linked to a recorded absence cannot be changed' } };
    }

    if (action === 'update') {
      if (!['RECEIVED', 'ACCEPTED'].includes(declaration.status)) {
        return { status: 409, body: { error: 'This declaration can no longer be changed' } };
      }
      const [updated] = await db.update(absenceDeclarations).set({
        studentId,
        date,
        startTime,
        endTime,
        reason: reason || null,
        status: declaration.status === 'ACCEPTED' ? 'RECEIVED' : declaration.status,
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      }).where(eq(absenceDeclarations.id, declarationId)).returning();
      return { status: 200, body: updated };
    }

    if (action === 'cancel') {
      if (!['RECEIVED', 'ACCEPTED'].includes(declaration.status)) {
        return { status: 409, body: { error: 'This declaration can no longer be cancelled' } };
      }
      const [cancelled] = await db.update(absenceDeclarations).set({
        status: 'CANCELLED',
        updatedAt: new Date(),
      }).where(eq(absenceDeclarations.id, declarationId)).returning();
      return { status: 200, body: cancelled };
    }

    return { status: 400, body: { error: 'Unsupported declaration action' } };
  };

  app.get('/api/absence-declarations', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'parent') {
        if (!actor.id) return res.json([]);
        const result: any = await runParentDeclarationAction(actor.id, 'list', {});
        return res.status(result.status).json(result.body);
      }
      if (!['super_admin', 'school_admin', 'surveillant', 'teacher'].includes(actor.role)) {
        return res.status(403).json({ error: 'Not authorized to view absence declarations' });
      }
      if (actor.role === 'teacher') return res.json([]);

      let query = db.select({
        id: absenceDeclarations.id,
        studentId: absenceDeclarations.studentId,
        studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
        parentName: users.name,
        classId: students.classId,
        className: classes.name,
        schoolId: students.schoolId,
        date: absenceDeclarations.date,
        startTime: absenceDeclarations.startTime,
        endTime: absenceDeclarations.endTime,
        reason: absenceDeclarations.reason,
        status: absenceDeclarations.status,
        rejectionReason: absenceDeclarations.rejectionReason,
        reviewedBy: absenceDeclarations.reviewedBy,
        reviewedAt: absenceDeclarations.reviewedAt,
        createdAt: absenceDeclarations.createdAt,
      }).from(absenceDeclarations)
        .innerJoin(students, eq(students.id, absenceDeclarations.studentId))
        .innerJoin(parents, eq(parents.id, absenceDeclarations.parentId))
        .innerJoin(users, eq(users.id, parents.userId))
        .leftJoin(classes, eq(classes.id, students.classId));

      if (actor.role !== 'super_admin') {
        if (actor.schoolId == null) return res.json([]);
        if (actor.role === 'teacher') {
          const classIds = await getTeacherReadableScopedClassIds(actor);
          if (!classIds.length) return res.json([]);
          query = query.where(and(
            eq(students.schoolId, actor.schoolId),
            inArray(students.classId, classIds),
          )) as any;
        } else {
          query = query.where(eq(students.schoolId, actor.schoolId)) as any;
        }
      }
      return res.json(await query.orderBy(desc(absenceDeclarations.date), desc(absenceDeclarations.createdAt)));
    } catch (error: any) {
      console.error('Failed to load absence declarations:', error?.message || error);
      return res.status(500).json({ error: 'Failed to load absence declarations' });
    }
  });

  app.post('/api/absence-declarations', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'parent' || !actor.id) return res.status(403).json({ error: 'Only parents may declare future absences' });
      const result: any = await runParentDeclarationAction(actor.id, 'create', req.body);
      if (result.status === 201) {
        await notifyAbsenceDeclarationParent(actor.id, 'Déclaration d’absence reçue', 'Votre déclaration d’absence a été transmise à l’établissement.', {
          declarationId: result.body.id,
          studentId: result.body.studentId,
          status: 'RECEIVED',
        });
      }
      return res.status(result.status).json(result.body);
    } catch (error: any) {
      console.error('Failed to create absence declaration:', error?.message || error);
      return res.status(500).json({ error: 'Failed to create absence declaration' });
    }
  });

  app.put('/api/absence-declarations/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'parent' || !actor.id) return res.status(403).json({ error: 'Only parents may change their declarations' });
      const result: any = await runParentDeclarationAction(actor.id, 'update', { ...req.body, id: req.params.id });
      return res.status(result.status).json(result.body);
    } catch (error: any) {
      console.error('Failed to update absence declaration:', error?.message || error);
      return res.status(500).json({ error: 'Failed to update absence declaration' });
    }
  });

  app.put('/api/absence-declarations/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'parent' || !actor.id) return res.status(403).json({ error: 'Only parents may cancel their declarations' });
      const result: any = await runParentDeclarationAction(actor.id, 'cancel', { id: req.params.id });
      return res.status(result.status).json(result.body);
    } catch (error: any) {
      console.error('Failed to cancel absence declaration:', error?.message || error);
      return res.status(500).json({ error: 'Failed to cancel absence declaration' });
    }
  });

  app.post('/api/internal/absence-declarations', async (req: any, res) => {
    const signature = req.headers['x-internal-signature'];
    const timestamp = req.headers['x-internal-timestamp'];
    const internalSecret = process.env.INTERNAL_SECRET;
    if (!internalSecret || !internalSecret.trim() || typeof signature !== 'string' || typeof timestamp !== 'string') {
      return res.status(401).json({ error: 'Invalid internal authentication' });
    }
    const requestTime = Number(timestamp);
    if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) {
      return res.status(401).json({ error: 'Expired internal authentication' });
    }
    const hmac = crypto.createHmac('sha256', internalSecret);
    hmac.update(`${JSON.stringify(req.body)}${timestamp}`);
    const expectedSignature = hmac.digest('hex');
    if (signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return res.status(401).json({ error: 'Invalid internal authentication' });
    }

    try {
      const parentUserId = Number(req.body?.parentUserId);
      if (!Number.isInteger(parentUserId) || parentUserId <= 0) return res.status(400).json({ error: 'Invalid parent identity' });
      const [parentUser] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, parentUserId));
      if (!parentUser || parentUser.role !== 'parent') return res.status(403).json({ error: 'Parent account required' });
      const action = String(req.body?.action || '');
      const result: any = await runParentDeclarationAction(parentUserId, action, req.body?.input || {});
      if (action === 'create' && result.status === 201) {
        await notifyAbsenceDeclarationParent(parentUserId, 'Déclaration d’absence reçue', 'Votre déclaration d’absence a été transmise à l’établissement.', {
          declarationId: result.body.id,
          studentId: result.body.studentId,
          status: 'RECEIVED',
        });
      }
      return res.status(result.status).json(result.body);
    } catch (error: any) {
      console.error('Internal absence declaration request failed:', error?.message || error);
      return res.status(500).json({ error: 'Internal absence declaration request failed' });
    }
  });

  const getAuthorizedDeclarationStudent = async (actor: any, declaration: any) => {
    const [student] = await db.select({ id: students.id, schoolId: students.schoolId, classId: students.classId })
      .from(students).where(eq(students.id, declaration.studentId));
    if (!student) return null;
    if (actor.role === 'super_admin') return student;
    if (actor.schoolId == null || student.schoolId !== actor.schoolId) return null;
    if (actor.role === 'teacher') return null;
    if (actor.role === 'school_admin' || actor.role === 'surveillant') {
      if (student.classId == null) return student;
      return (await isApprovedClassForSchool(student.classId, actor.schoolId)) ||
        (await db.select({ id: classes.id }).from(classes).where(and(
          eq(classes.id, student.classId),
          eq(classes.schoolId, actor.schoolId),
        ))).length > 0 ? student : null;
    }
    return null;
  };

  app.put('/api/absence-declarations/:id/review', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['teacher', 'school_admin', 'surveillant', 'super_admin'].includes(actor.role)) {
        return res.status(403).json({ error: 'Not authorized to review absence declarations' });
      }
      const id = Number(req.params.id);
      const status = typeof req.body?.status === 'string' ? req.body.status.trim().toUpperCase() : '';
      const rejectionReason = typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason.trim() : '';
      if (!Number.isInteger(id) || !['ACCEPTED', 'REFUSED'].includes(status)) return res.status(400).json({ error: 'Invalid declaration review request' });
      if (status === 'REFUSED' && !rejectionReason) return res.status(400).json({ error: 'A rejection reason is required' });
      const [declaration] = await db.select().from(absenceDeclarations).where(eq(absenceDeclarations.id, id));
      if (!declaration) return res.status(404).json({ error: 'Declaration not found' });
      const student = await getAuthorizedDeclarationStudent(actor, declaration);
      if (!student) return res.status(403).json({ error: 'Declaration is outside the actor scope' });
      if (declaration.status !== 'RECEIVED') return res.status(409).json({ error: 'This declaration has already been processed' });
      const reviewedAt = new Date();
      const [updated] = await db.update(absenceDeclarations).set({
        status,
        rejectionReason: status === 'REFUSED' ? rejectionReason : null,
        reviewedBy: actor.id ?? null,
        reviewedAt,
        updatedAt: reviewedAt,
      }).where(eq(absenceDeclarations.id, id)).returning();

      if (declaration.date <= todayIsoDate()) {
        await db.update(absences).set({ declarationId: declaration.id }).where(and(
          eq(absences.studentId, declaration.studentId),
          eq(absences.date, declaration.date),
          sql`${absences.declarationId} IS NULL`,
          sql`${absences.startTime} < ${declaration.endTime}`,
          sql`${absences.endTime} > ${declaration.startTime}`,
        ));
      }

      const [parent] = await db.select({ userId: parents.userId }).from(parents).where(eq(parents.id, declaration.parentId));
      if (parent?.userId) {
        const title = status === 'ACCEPTED' ? 'Déclaration d’absence acceptée' : 'Déclaration d’absence refusée';
        const message = status === 'ACCEPTED'
          ? 'L’établissement a accepté votre déclaration d’absence.'
          : `L’établissement a refusé votre déclaration d’absence. Motif : ${rejectionReason}`;
        await notifyAbsenceDeclarationParent(parent.userId, title, message, { declarationId: id, studentId: declaration.studentId, status });
      }
      return res.json(updated);
    } catch (error: any) {
      console.error('Failed to review absence declaration:', error?.message || error);
      return res.status(500).json({ error: 'Failed to review absence declaration' });
    }
  });

  app.put('/api/absence-declarations/:id/not-realized', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['teacher', 'school_admin', 'surveillant', 'super_admin'].includes(actor.role)) {
        return res.status(403).json({ error: 'Not authorized to close absence declarations' });
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid declaration id' });
      const [declaration] = await db.select().from(absenceDeclarations).where(eq(absenceDeclarations.id, id));
      if (!declaration) return res.status(404).json({ error: 'Declaration not found' });
      const student = await getAuthorizedDeclarationStudent(actor, declaration);
      if (!student) return res.status(403).json({ error: 'Declaration is outside the actor scope' });
      if (declaration.date > todayIsoDate() || !['RECEIVED', 'ACCEPTED'].includes(declaration.status)) {
        return res.status(409).json({ error: 'This declaration cannot be closed as not realized' });
      }
      const linkedAbsence = await db.select({ id: absences.id }).from(absences).where(eq(absences.declarationId, id)).limit(1);
      if (linkedAbsence.length > 0) return res.status(409).json({ error: 'A declaration linked to a recorded absence cannot be closed as not realized' });
      const reviewedAt = new Date();
      const [updated] = await db.update(absenceDeclarations).set({
        status: 'NOT_REALIZED',
        reviewedBy: actor.id ?? null,
        reviewedAt,
        updatedAt: reviewedAt,
      }).where(eq(absenceDeclarations.id, id)).returning();
      const [parent] = await db.select({ userId: parents.userId }).from(parents).where(eq(parents.id, declaration.parentId));
      if (parent?.userId) {
        await notifyAbsenceDeclarationParent(parent.userId, 'Déclaration clôturée', 'L’établissement a clôturé cette déclaration comme non réalisée.', {
          declarationId: id,
          studentId: declaration.studentId,
          status: 'NOT_REALIZED',
        });
      }
      return res.json(updated);
    } catch (error: any) {
      console.error('Failed to close absence declaration:', error?.message || error);
      return res.status(500).json({ error: 'Failed to close absence declaration' });
    }
  });

  app.get('/api/absence-controls', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'parent') return res.status(403).json({ error: 'Parents cannot view school absence controls' });

      let query = db.select().from(absenceControls);
      if (actor.role !== 'super_admin') {
        if (actor.schoolId == null) return res.json([]);

        if (actor.role === 'teacher') {
          const scope = await getTeacherAuthorizationScope(actor);
          if (!scope) return res.json([]);
          const readableClassIds = Array.from(new Set([...scope.teachingClassIds, ...scope.homeroomClassIds]));
          if (readableClassIds.length === 0) return res.json([]);

          query = query.where(and(
            eq(absenceControls.schoolId, actor.schoolId),
            inArray(absenceControls.classId, readableClassIds),
            eq(absenceControls.teacherId, scope.teacherId),
          )) as any;
        } else if (actor.role === 'surveillant') {
          query = query.where(eq(absenceControls.schoolId, actor.schoolId)) as any;
        } else {
          query = query.where(eq(absenceControls.schoolId, actor.schoolId)) as any;
        }
      }

      let rows = await query.orderBy(desc(absenceControls.createdAt));
      if (actor.role === 'teacher') {
        const scope = await getTeacherAuthorizationScope(actor);
        if (!scope) return res.json([]);
        rows = rows.filter((row) => row.teacherId === scope.teacherId);
      }
      return res.json(rows);
    } catch (error: any) {
      console.error('❌ GET /api/absence-controls ERROR:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/absence-controls', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'teacher') {
        return res.status(403).json({ error: 'Only teachers may create an absence-control none record' });
      }
      if (!actor.id || actor.schoolId == null) {
        return res.status(403).json({ error: 'Teacher identity or school is missing' });
      }

      const { classId, date, period, subjectId, startTime, endTime, controlType } = req.body;
      const normalClassId = Number(classId);
      const parsedDate = typeof date === 'string' ? date : '';
      if (!normalClassId || !parsedDate || controlType !== 'none') {
        return res.status(400).json({ error: 'Missing mandatory absence-control parameters' });
      }

      const normalizedSubjectId = subjectId != null && subjectId !== '' ? Number(subjectId) : null;
      const normalizedStartTime = typeof startTime === 'string' && startTime.trim() ? startTime.trim() : null;
      const normalizedEndTime = typeof endTime === 'string' && endTime.trim() ? endTime.trim() : null;
      const normalizedPeriod = typeof period === 'string' && period.trim()
        ? period.trim()
        : normalizedStartTime && normalizedEndTime
          ? (() => {
            const [startHour] = normalizedStartTime.split(':').map(Number);
            const [endHour] = normalizedEndTime.split(':').map(Number);
            if (startHour < 12 && endHour > 14) return 'all_day';
            return startHour >= 12 ? 'afternoon' : 'morning';
          })()
          : null;

      const [teacherRow] = await db.select({ id: teachers.id, schoolId: teachers.schoolId }).from(teachers).where(eq(teachers.userId, actor.id));
      if (!teacherRow) {
        return res.status(403).json({ error: 'Teacher profile not found for the authenticated user' });
      }

      const scope = await getTeacherAuthorizationScope(actor);
      if (!scope || !scope.teachingClassIds.has(normalClassId)) {
        return res.status(403).json({ error: 'Teacher is not authorized for this class in this school' });
      }
      if (normalizedSubjectId != null && !scope.subjectIds.has(normalizedSubjectId)) {
        return res.status(403).json({ error: 'Teacher is not assigned to this subject' });
      }

      const [classRecord] = await db.select({ id: classes.id, schoolId: classes.schoolId }).from(classes).where(eq(classes.id, normalClassId));
      if (!classRecord) {
        return res.status(404).json({ error: 'Class not found' });
      }

      if (!(await isApprovedClassForSchool(normalClassId, actor.schoolId))) {
        return res.status(403).json({ error: 'Teacher cannot control a class outside authenticated school scope' });
      }

      const existingDuplicate = await db.select().from(absenceControls).where(and(
        eq(absenceControls.schoolId, actor.schoolId),
        eq(absenceControls.classId, normalClassId),
        eq(absenceControls.date, parsedDate),
        eq(absenceControls.controlType, 'none'),
        normalizedSubjectId != null ? eq(absenceControls.subjectId, normalizedSubjectId) : sql`${absenceControls.subjectId} IS NULL`,
        normalizedPeriod ? eq(absenceControls.period, normalizedPeriod) : sql`${absenceControls.period} IS NULL`,
        normalizedStartTime ? eq(absenceControls.startTime, normalizedStartTime) : sql`${absenceControls.startTime} IS NULL`,
        normalizedEndTime ? eq(absenceControls.endTime, normalizedEndTime) : sql`${absenceControls.endTime} IS NULL`,
      ));
      if (existingDuplicate.length > 0) {
        return res.status(409).json({ error: 'Duplicate absence-control none already exists for this context' });
      }

      const conflictingAbsence = await db.select({ id: absences.id }).from(absences)
        .innerJoin(students, eq(students.id, absences.studentId))
        .where(and(
        eq(students.schoolId, actor.schoolId),
        eq(absences.classId, normalClassId),
        eq(absences.date, parsedDate),
        normalizedSubjectId != null ? eq(absences.subjectId, normalizedSubjectId) : sql`${absences.subjectId} IS NULL`,
        normalizedStartTime ? eq(absences.startTime, normalizedStartTime) : sql`${absences.startTime} IS NULL`,
        normalizedEndTime ? eq(absences.endTime, normalizedEndTime) : sql`${absences.endTime} IS NULL`,
        normalizedPeriod ? eq(absences.period, normalizedPeriod) : sql`${absences.period} IS NULL`,
      ));
      if (conflictingAbsence.length > 0) {
        return res.status(409).json({ error: 'An absence already exists for the same context; no contradictory absence-control record can be created' });
      }

      const [inserted] = await db.insert(absenceControls).values({
        schoolId: actor.schoolId,
        classId: normalClassId,
        teacherId: teacherRow.id,
        date: parsedDate,
        period: normalizedPeriod,
        subjectId: normalizedSubjectId,
        startTime: normalizedStartTime,
        endTime: normalizedEndTime,
        controlType: 'none',
      }).returning();

      await logAuditEvent(actor, 'create', 'absence_control', inserted.id, actor.schoolId ?? null, `Teacher registered absence-control none for class=${normalClassId} date=${parsedDate}`);
      return res.status(201).json(inserted);
    } catch (error: any) {
      console.error('❌ POST /api/absence-controls ERROR:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  const parseLateArrivalTime = (value: unknown) => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())) return null;
    const [hours, minutes] = value.trim().split(':').map(Number);
    return hours * 60 + minutes;
  };

  const isValidLateArrivalDate = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };

  const calculateLateMinutes = (expectedStartTime: string, arrivalTime: string) => {
    const expectedMinutes = parseLateArrivalTime(expectedStartTime);
    const arrivalMinutes = parseLateArrivalTime(arrivalTime);
    if (expectedMinutes == null || arrivalMinutes == null) return null;
    return Math.max(0, arrivalMinutes - expectedMinutes);
  };

  const canManageLateArrival = async (actor: any, studentId: number, classId: number) => {
    const [student] = await db.select().from(students).where(eq(students.id, studentId));
    const [classRecord] = await db.select().from(classes).where(eq(classes.id, classId));
    if (!student || !classRecord || student.isActive !== true || student.classId !== classId || actor.role === 'parent') return false;
    if (actor.role === 'super_admin') return true;

    const classBelongsToSchool = classRecord.schoolId === actor.schoolId || await isApprovedClassForSchool(classId, actor.schoolId);
    if (actor.schoolId == null || student.schoolId !== actor.schoolId || !classBelongsToSchool) return false;
    if (actor.role !== 'teacher') return true;

    const teacherClassIds = await getTeacherTeachingClassIds(actor);
    return teacherClassIds.includes(classId) && student.schoolId === actor.schoolId;
  };

  const getTeacherLateArrivalAssignment = async (actor: ResolvedActor, lateArrival: {
    teachingAssignmentId?: number | null;
    classId: number;
  }) => {
    if (lateArrival.teachingAssignmentId == null) return null;
    const context = await getTeacherTeachingAssignmentContext(actor);
    if (!context) return null;
    return context.assignments.find((assignment) =>
      assignment.id === lateArrival.teachingAssignmentId
        && assignment.classId === lateArrival.classId
        && assignment.schoolId === context.schoolId,
    ) ?? null;
  };

  app.get('/api/late-arrivals', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: lateArrivals.id,
          studentId: lateArrivals.studentId,
          studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
          classId: lateArrivals.classId,
          className: classes.name,
          date: lateArrivals.date,
          period: lateArrivals.period,
          expectedStartTime: lateArrivals.expectedStartTime,
          arrivalTime: lateArrivals.arrivalTime,
          lateMinutes: lateArrivals.lateMinutes,
          reason: lateArrivals.reason,
          createdBy: lateArrivals.createdBy,
          createdAt: lateArrivals.createdAt,
          updatedAt: lateArrivals.updatedAt,
          schoolId: students.schoolId,
        })
        .from(lateArrivals)
        .innerJoin(students, eq(lateArrivals.studentId, students.id))
        .innerJoin(classes, eq(lateArrivals.classId, classes.id));

      if (actor.role !== 'super_admin') {
        if (actor.role === 'parent') {
          const childStudentIds = await getParentChildStudentIds(actor.id);
          if (childStudentIds.length === 0) return res.json([]);
          query = query.where(inArray(lateArrivals.studentId, childStudentIds)) as any;
        } else if (actor.role === 'teacher') {
          if (actor.schoolId == null) return res.json([]);
          const assignmentContext = await getTeacherTeachingAssignmentContext(actor);
          const teacherAssignmentIds = assignmentContext?.assignments.map((assignment) => assignment.id) ?? [];
          if (teacherAssignmentIds.length === 0) return res.json([]);
          query = query.where(and(
            eq(students.schoolId, actor.schoolId),
            inArray(lateArrivals.teachingAssignmentId, teacherAssignmentIds),
          )) as any;
        } else {
          if (actor.schoolId) {
            query = query.where(eq(students.schoolId, actor.schoolId)) as any;
          } else {
            return res.json([]);
          }
        }
      }

      const rows = await query.orderBy(desc(lateArrivals.createdAt));
      return res.json(rows);
    } catch (error: any) {
      console.error('❌ GET /api/late-arrivals ERROR:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/late-arrivals', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const { studentId, classId, date, period, expectedStartTime, arrivalTime, reason, subjectId } = req.body;
      const parsedStudentId = Number(studentId);
      const parsedClassId = Number(classId);
      const parsedSubjectId = subjectId != null && subjectId !== '' ? Number(subjectId) : undefined;
      const parsedDate = typeof date === 'string' ? date.trim() : '';
      const normalizedExpectedStartTime = typeof expectedStartTime === 'string' ? expectedStartTime.trim() : '';
      const normalizedArrivalTime = typeof arrivalTime === 'string' ? arrivalTime.trim() : '';
      const normalizedPeriod = typeof period === 'string' ? period.trim() : '';
      const lateMinutes = calculateLateMinutes(normalizedExpectedStartTime, normalizedArrivalTime);

      if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0 || !Number.isInteger(parsedClassId) || parsedClassId <= 0 || !isValidLateArrivalDate(parsedDate) || !['morning', 'afternoon', 'all_day'].includes(normalizedPeriod) || parseLateArrivalTime(normalizedExpectedStartTime) == null || parseLateArrivalTime(normalizedArrivalTime) == null) {
        return res.status(400).json({ error: 'Missing mandatory late-arrival parameters' });
      }

      if (actor.role === 'parent') {
        return res.status(403).json({ error: 'Parents are not allowed to record late arrivals' });
      }
      if (!['super_admin', 'school_admin', 'teacher', 'surveillant'].includes(actor.role)) {
        return res.status(403).json({ error: 'Not authorized to record late arrivals' });
      }
      if (actor.role === 'teacher' && (!Number.isInteger(parsedSubjectId) || parsedSubjectId! <= 0)) {
        return res.status(400).json({ error: 'A valid subject is required to record a teacher late arrival' });
      }

      const [student] = await db.select().from(students).where(eq(students.id, parsedStudentId));
      if (!student) return res.status(404).json({ error: 'Student not found' });
      if (student.isActive !== true) return res.status(400).json({ error: 'Cannot record a late arrival for an inactive student' });

      const [classRecord] = await db.select().from(classes).where(eq(classes.id, parsedClassId));
      if (!classRecord) return res.status(404).json({ error: 'Class not found' });
      if (student.classId !== parsedClassId) return res.status(400).json({ error: 'Student does not belong to the selected class' });

      const classBelongsToSchool = classRecord.schoolId === actor.schoolId || await isApprovedClassForSchool(parsedClassId, actor.schoolId);
      if (actor.role !== 'super_admin' && (actor.schoolId == null || student.schoolId !== actor.schoolId || !classBelongsToSchool)) {
        return res.status(403).json({ error: 'Cannot record a late arrival outside the actor school scope' });
      }

      const canonicalTeachingAssignment = actor.role === 'teacher'
        ? await ensureTeacherTeachingAssignment(actor, parsedClassId, parsedSubjectId!)
        : null;
      if (actor.role === 'teacher' && (!canonicalTeachingAssignment
        || canonicalTeachingAssignment.schoolId !== student.schoolId)) {
        return res.status(403).json({ error: 'Teacher is not assigned to this class and subject combination' });
      }

      const existingDuplicate = await db.select().from(lateArrivals).where(and(
        eq(lateArrivals.studentId, parsedStudentId),
        eq(lateArrivals.classId, parsedClassId),
        eq(lateArrivals.date, parsedDate),
        eq(lateArrivals.period, normalizedPeriod),
      ));
      if (existingDuplicate.length > 0) {
        return res.status(409).json({ error: 'A late arrival already exists for this student/class/date/period' });
      }

      const [inserted] = await db.insert(lateArrivals).values({
        studentId: parsedStudentId,
        classId: parsedClassId,
        teachingAssignmentId: canonicalTeachingAssignment?.id ?? null,
        date: parsedDate,
        period: normalizedPeriod,
        expectedStartTime: normalizedExpectedStartTime,
        arrivalTime: normalizedArrivalTime,
        lateMinutes,
        reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
        createdBy: actor.id ?? null,
      }).returning();

      let subjectName: string | undefined;
      if (parsedSubjectId != null && Number.isInteger(parsedSubjectId) && parsedSubjectId > 0) {
        const [subject] = await db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, parsedSubjectId));
        subjectName = subject?.name;
      }

      const [parentRecord] = student.parentId != null
        ? await db.select({ userId: parents.userId }).from(parents).where(eq(parents.id, student.parentId))
        : [null];

      if (parentRecord?.userId) {
        const notificationTitle = `Retard enregistré pour ${student.firstName}`;
        const periodName = inserted.period === 'morning'
          ? 'Matin'
          : inserted.period === 'afternoon'
            ? 'Après-midi'
            : inserted.period === 'all_day'
              ? 'Toute la journée'
              : inserted.period;
        const periodPhrase = periodName === 'Matin'
          ? 'la matinée'
          : periodName === 'Après-midi'
            ? "l'après-midi"
            : periodName.toLowerCase();
        const subjectText = subjectName ? ` en ${subjectName}` : '';
        const lateDurationText = inserted.lateMinutes != null ? ` de ${inserted.lateMinutes} minutes` : '';
        const notificationBody = `Votre enfant ${student.firstName} a été enregistré en retard${lateDurationText}${subjectText}, le ${inserted.date}, pendant ${periodPhrase}.`;

        try {
          await db.insert(notifications).values({
            userId: parentRecord.userId,
            title: notificationTitle,
            body: notificationBody,
            type: 'absence',
          });
        } catch (notificationInsertError) {
          console.error('Failed to insert late-arrival notification:', notificationInsertError);
        }

        try {
          const notificationPayload = {
            parentId: String(parentRecord.userId),
            title: notificationTitle,
            message: notificationBody,
            category: 'absence',
            metadata: {
              target: 'late-arrival',
              lateArrivalId: inserted.id,
              studentId: inserted.studentId,
              classId: inserted.classId,
              date: inserted.date,
              period: inserted.period,
              lateMinutes: inserted.lateMinutes,
              subjectId: parsedSubjectId ?? null,
              subjectName: subjectName ?? null,
            },
            dedupeKey: `late-arrival-${inserted.id}`,
          };

          const { signature, timestamp } = signInternalPayload(notificationPayload);
          await fetch(`${process.env.API_URL || 'http://localhost:3001'}/api/internal/absence-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-Signature': signature,
              'X-Internal-Timestamp': timestamp,
            },
            body: JSON.stringify(notificationPayload),
          });
        } catch (pushNotificationError) {
          console.error('Failed to dispatch late-arrival push notification:', pushNotificationError);
        }
      }

      return res.status(201).json(inserted);
    } catch (error: any) {
      console.error('❌ POST /api/late-arrivals ERROR:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/late-arrivals/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid late-arrival id' });

      const [existing] = await db.select().from(lateArrivals).where(eq(lateArrivals.id, id));
      if (!existing) return res.status(404).json({ error: 'Late arrival not found' });

      if (actor.role !== 'super_admin' && actor.role !== 'school_admin' && actor.role !== 'teacher' && actor.role !== 'surveillant') {
        return res.status(403).json({ error: 'Not authorized to update late arrivals' });
      }
      if (!await canManageLateArrival(actor, existing.studentId, existing.classId)) {
        return res.status(403).json({ error: 'Cannot update a late arrival outside the actor scope' });
      }
      if (actor.role === 'teacher' && !await getTeacherLateArrivalAssignment(actor, existing)) {
        return res.status(403).json({ error: 'Cannot update a late arrival outside your active teaching assignment' });
      }

      const { expectedStartTime, arrivalTime, reason } = req.body ?? {};
      const nextExpectedStartTime = typeof expectedStartTime === 'string' ? expectedStartTime.trim() : existing.expectedStartTime;
      const nextArrivalTime = typeof arrivalTime === 'string' ? arrivalTime.trim() : existing.arrivalTime;
      const nextReason = typeof reason === 'string' ? (reason.trim() || null) : existing.reason;
      const nextLateMinutes = calculateLateMinutes(nextExpectedStartTime, nextArrivalTime);

      if (parseLateArrivalTime(nextExpectedStartTime) == null || parseLateArrivalTime(nextArrivalTime) == null) {
        return res.status(400).json({ error: 'Expected start time and arrival time must use HH:mm format' });
      }

      const [updated] = await db.update(lateArrivals).set({
        expectedStartTime: nextExpectedStartTime,
        arrivalTime: nextArrivalTime,
        lateMinutes: nextLateMinutes,
        reason: nextReason,
        updatedAt: new Date(),
      }).where(eq(lateArrivals.id, id)).returning();

      return res.json(updated);
    } catch (error: any) {
      console.error('❌ PUT /api/late-arrivals/:id ERROR:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/late-arrivals/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (!['super_admin', 'school_admin', 'teacher', 'surveillant'].includes(actor.role)) {
        return res.status(403).json({ error: 'Not authorized to delete late arrivals' });
      }

      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid late-arrival id' });

      const [existing] = await db.select().from(lateArrivals).where(eq(lateArrivals.id, id));
      if (!existing) return res.status(404).json({ error: 'Late arrival not found' });
      if (!await canManageLateArrival(actor, existing.studentId, existing.classId)) {
        return res.status(403).json({ error: 'Cannot delete a late arrival outside the actor scope' });
      }
      if (actor.role === 'teacher' && !await getTeacherLateArrivalAssignment(actor, existing)) {
        return res.status(403).json({ error: 'Cannot delete a late arrival outside your active teaching assignment' });
      }

      await db.delete(lateArrivals).where(eq(lateArrivals.id, id));
      return res.status(204).send();
    } catch (error: any) {
      console.error('❌ DELETE /api/late-arrivals/:id ERROR:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/absences', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      let query = db
        .select({
          id: absences.id,
          studentId: absences.studentId,
          teachingAssignmentId: absences.teachingAssignmentId,
          studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
          classId: absences.classId,
          className: classes.name,
          date: absences.date,
          period: absences.period,
          subjectId: absences.subjectId,
          subjectName: subjects.name,
          startTime: absences.startTime,
          endTime: absences.endTime,
          isJustified: absences.isJustified,
          declarationId: absences.declarationId,
          justificationReason: absences.justificationReason,
          justificationStatus: sql<string | null>`coalesce(${absences.justificationStatus}, case when ${absences.isJustified} = true then 'APPROVED' else null end)`,
          rejectionReason: absences.rejectionReason,
          reviewedBy: absences.reviewedBy,
          reviewedAt: absences.reviewedAt,
          justificationFileId: sql<number>`(
            select id from ${absenceJustifications}
            where ${absenceJustifications.absenceId} = ${absences.id}
            order by ${absenceJustifications.uploadedAt} desc
            limit 1
          )`,
          justificationFileName: sql<string>`(
            select file_name from ${absenceJustifications}
            where ${absenceJustifications.absenceId} = ${absences.id}
            order by ${absenceJustifications.uploadedAt} desc
            limit 1
          )`,
          parentId: students.parentId,
          parentUserId: parents.userId,
          schoolId: students.schoolId,
        })
        .from(absences)
        .innerJoin(students, eq(absences.studentId, students.id))
        .innerJoin(classes, eq(absences.classId, classes.id))
        .leftJoin(subjects, eq(absences.subjectId, subjects.id))
        .innerJoin(parents, eq(students.parentId, parents.id));

      if (actor.role !== 'super_admin') {
        if (actor.role === 'parent') {
          const childStudentIds = await getParentChildStudentIds(actor.id);

          if (childStudentIds.length === 0) {
            return res.json([]);
          }

          query = query.where(inArray(absences.studentId, childStudentIds)) as any;
        } else if (actor.role === 'teacher') {
          if (actor.schoolId == null) return res.json([]);
          const assignmentContext = await getTeacherTeachingAssignmentContext(actor);
          const assignmentIds = assignmentContext?.assignments.map((assignment) => assignment.id) ?? [];
          const teacherClassIds = assignmentContext
            ? (await db.select({ classId: classTeachers.classId }).from(classTeachers).where(and(
              eq(classTeachers.teacherId, assignmentContext.teacherId),
              eq(classTeachers.schoolId, actor.schoolId),
            )))
              .map((row: any) => Number(row.classId))
              .filter((id) => Number.isInteger(id))
            : [];
          const permittedAbsenceClassIds = Array.from(new Set([
            ...teacherClassIds,
            ...(assignmentContext?.assignments ?? []).map((assignment) => assignment.classId).filter((id): id is number => Number.isInteger(id)),
          ]));
          if (permittedAbsenceClassIds.length === 0) return res.json([]);
          query = query.where(and(
            eq(students.schoolId, actor.schoolId),
            inArray(absences.classId, permittedAbsenceClassIds),
          )) as any;
        } else if (actor.role === 'surveillant') {
          if (actor.schoolId) {
            query = query.where(eq(students.schoolId, actor.schoolId)) as any;
          } else {
            return res.json([]);
          }
        } else {
          if (actor.schoolId) {
            query = query.where(eq(students.schoolId, actor.schoolId)) as any;
          } else {
            return res.json([]);
          }
        }
      }

      query = query.orderBy(
        desc(absences.date),
        sql`CASE WHEN ${absences.startTime} IS NULL THEN 1 ELSE 0 END`,
        desc(absences.startTime),
        desc(absences.id),
      ) as any;
      let list = await query;
      if (actor.role === 'teacher') {
        const assignmentContext = await getTeacherTeachingAssignmentContext(actor);
        if (!assignmentContext) return res.json([]);
        list = list.filter((absence) => canTeacherAccessAbsence(
          absence,
          assignmentContext.teacherId,
          assignmentContext.assignments,
        ));
      }
      const studentIds = list.map((student: any) => student.id).filter((id: any): id is number => Number.isInteger(id));
      const statusRows = studentIds.length > 0
        ? await db
          .select({ studentId: studentAcademicYearStatuses.studentId, academicYearId: studentAcademicYearStatuses.academicYearId, status: studentAcademicYearStatuses.status })
          .from(studentAcademicYearStatuses)
          .where(inArray(studentAcademicYearStatuses.studentId, studentIds))
        : [];
      const statusesByStudent = new Map<number, Array<{ academicYearId: number; status: string | null }>>();
      for (const row of statusRows) {
        const existing = statusesByStudent.get(row.studentId) || [];
        existing.push({ academicYearId: row.academicYearId, status: row.status });
        statusesByStudent.set(row.studentId, existing);
      }
      res.json(list.map((student: any) => ({
        ...student,
        studentStatus: statusesByStudent.get(student.id)?.find((entry) => entry.academicYearId === student.yearId)?.status ?? null,
        academicYearStatuses: statusesByStudent.get(student.id) || [],
      })));
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load absences' });
    }
  });

  app.post('/api/absences', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const { studentId, classId, date, period, subjectId, teachingAssignmentId, startTime, endTime, isJustified, justificationReason } = req.body;
      const normalizedSubjectId = subjectId != null ? Number(subjectId) : undefined;
      const normalizedSubjectIds = normalizedSubjectId != null && !Number.isNaN(normalizedSubjectId) ? [normalizedSubjectId] : [];
      const normalizedStartTime = typeof startTime === 'string' ? startTime : '';
      const normalizedEndTime = typeof endTime === 'string' ? endTime : '';

      const derivedPeriod = (() => {
        if (period) return period;
        if (!normalizedStartTime || !normalizedEndTime) return 'morning';
        const [startHour] = normalizedStartTime.split(':').map(Number);
        const [endHour] = normalizedEndTime.split(':').map(Number);
        if (startHour < 12 && endHour > 14) return 'all_day';
        return startHour >= 12 ? 'afternoon' : 'morning';
      })();

      if (!studentId || !classId || !date || !normalizedStartTime || !normalizedEndTime || normalizedSubjectIds.length === 0) {
        return res.status(400).json({ error: 'Missing mandatory absence parameters' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      let canonicalTeachingAssignment: any = null;

      // Load the student and class to check school
      const [student] = await db.select().from(students).where(eq(students.id, parseInt(studentId)));
      if (!student) return res.status(404).json({ error: 'Student not found' });
      if (student.isActive !== true || student.classId !== parseInt(classId, 10)) {
        return res.status(400).json({ error: 'Student must be active and belong to the selected class' });
      }

      const [classRecord] = await db.select().from(classes).where(eq(classes.id, parseInt(classId)));
      if (!classRecord) return res.status(404).json({ error: 'Class not found' });

      if (actor.role === 'parent') {
        return res.status(403).json({ error: 'Parents are not allowed to record absences' });
      }

      const classBelongsToSchool = classRecord.schoolId === actor.schoolId
        || await isApprovedClassForSchool(parseInt(classId), actor.schoolId);
      if (actor.role !== 'super_admin' && (
        actor.schoolId == null
        || student.schoolId !== actor.schoolId
        || !classBelongsToSchool
      )) {
        return res.status(403).json({ error: 'Cannot record absence outside the actor school scope' });
      }

      if (actor.role === 'surveillant') {
        if (actor.schoolId == null) {
          return res.status(403).json({ error: 'Surveillant school context is missing' });
        }
        if (student.schoolId !== actor.schoolId || !classBelongsToSchool) {
          return res.status(403).json({ error: 'Cannot record absence outside the surveillant school' });
        }
      }

      if (actor.role === 'teacher') {
        const assignmentId = parsePositiveInteger(teachingAssignmentId);
        const requestedClassId = parsePositiveInteger(classId);
        const requestedSubjectId = normalizedSubjectIds.length === 1
          ? parsePositiveInteger(normalizedSubjectIds[0])
          : null;
        canonicalTeachingAssignment = requestedClassId != null
          && requestedSubjectId != null
          && (teachingAssignmentId == null || assignmentId != null)
          ? await ensureTeacherTeachingAssignment(
              actor,
              requestedClassId,
              requestedSubjectId,
              teachingAssignmentId == null ? null : assignmentId,
            )
          : null;
        if (!canonicalTeachingAssignment
          || canonicalTeachingAssignment.classId !== student.classId
          || canonicalTeachingAssignment.subjectId !== requestedSubjectId
          || canonicalTeachingAssignment.schoolId !== student.schoolId
          || canonicalTeachingAssignment.classId !== requestedClassId) {
          return res.status(403).json({ error: 'Teacher is not assigned to this class and subject combination' });
        }
      } else if (actor.role !== 'super_admin') {
        if (actor.schoolId && (student.schoolId !== actor.schoolId || !classBelongsToSchool)) {
          return res.status(403).json({ error: 'Cannot record absence for student in another school' });
        }
      }

      const [matchedDeclaration] = typeof date === 'string' && date <= todayIsoDate()
        ? await db.select().from(absenceDeclarations).where(and(
          eq(absenceDeclarations.studentId, parseInt(studentId, 10)),
          eq(absenceDeclarations.date, date),
          inArray(absenceDeclarations.status, ['RECEIVED', 'ACCEPTED', 'REFUSED']),
          sql`${absenceDeclarations.startTime} < ${normalizedEndTime}`,
          sql`${absenceDeclarations.endTime} > ${normalizedStartTime}`,
        )).limit(1)
        : [];

      const result = await db.insert(absences).values({
        studentId: parseInt(studentId),
        classId: canonicalTeachingAssignment?.classId ?? parseInt(classId),
        teachingAssignmentId: canonicalTeachingAssignment?.id ?? null,
        date,
        period: derivedPeriod,
        subjectId: canonicalTeachingAssignment?.subjectId ?? normalizedSubjectIds[0],
        startTime: normalizedStartTime,
        endTime: normalizedEndTime,
        isJustified: isJustified || false,
        justificationReason,
        declarationId: matchedDeclaration?.id,
      }).returning();

      // Automatically create a simulated notification for the Parent of this student
      const [parentRecord] = await db.select().from(parents).where(eq(parents.id, student.parentId));
      if (parentRecord) {
        // Build a user-friendly message using start/end times and subject when available.
        const formatDateSafe = (dateStr: string) => {
          if (!dateStr) return '';
          const opts = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;
          if (dateStr.includes('T')) return new Date(dateStr).toLocaleDateString('fr-FR', opts);
          const parts = String(dateStr).split('-');
          if (parts.length === 3) {
            const y = Number(parts[0]);
            const m = Number(parts[1]) - 1;
            const d = Number(parts[2]);
            return new Date(y, m, d).toLocaleDateString('fr-FR', opts);
          }
          return new Date(dateStr).toLocaleDateString('fr-FR', opts);
        };
        const formattedDate = formatDateSafe(date);

        // Prefer any subject name provided in the incoming request to avoid an extra query.
        const providedSubjectName = typeof (req.body as any).subjectName === 'string' && (req.body as any).subjectName.trim()
          ? (req.body as any).subjectName.trim()
          : undefined;

        let subjectName: string | undefined = providedSubjectName;

        // If no subject name provided but a subjectId exists, fetch the name from DB.
        if (!subjectName && normalizedSubjectIds.length > 0) {
          try {
            const [sub] = await db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, normalizedSubjectIds[0]));
            subjectName = sub?.name;
          } catch (e) {
            console.warn('Failed to resolve subject for absence notification');
          }
        }

        const timeRange = normalizedStartTime && normalizedEndTime ? ` de ${normalizedStartTime} à ${normalizedEndTime}` : '';
        const subjectText = subjectName ? ` en ${subjectName}` : '';

        // Fallback to derivedPeriod (humanized) if no time range or subject available
        const humanizedPeriod = derivedPeriod === 'morning' ? 'Matin' : derivedPeriod === 'afternoon' ? 'Après‑midi' : derivedPeriod === 'all_day' ? 'Toute la journée' : derivedPeriod;
        const periodFallback = !timeRange && !subjectText ? ` (${humanizedPeriod})` : '';

        const messageBody = matchedDeclaration
          ? `L’absence constatée pour ${student.firstName} le ${formattedDate}${timeRange}${subjectText} est rattachée à une déclaration parentale.`
          : `Une absence a été signalée pour ${student.firstName} le ${formattedDate}${timeRange}${subjectText}${periodFallback}. Veuillez fournir un justificatif.`;

        // Insert the notification in DB using the same human-readable message
        await db.insert(notifications).values({
          userId: parentRecord.userId,
          title: `Nouvelle absence pour ${student.firstName}`,
          body: messageBody,
          type: 'absence',
        });

        const notificationUrl = `${process.env.API_URL || "http://localhost:3001"}/api/internal/absence-notification`;
        const notificationPayload = {
          parentId: parentRecord.userId,
          title: `Nouvelle absence pour ${student.firstName}`,
          message: messageBody,
          category: "absence",
          metadata: {
            target: "absence",
            absenceId: result[0].id,
            declarationId: matchedDeclaration?.id,
            studentId,
            classId,
            period: derivedPeriod,
            startTime: normalizedStartTime,
            endTime: normalizedEndTime,
            subjectId: normalizedSubjectIds.length > 0 ? normalizedSubjectIds[0] : undefined,
            subjectName: subjectName,
          },
          dedupeKey: `absence-${result[0].id}`,
        };
        try {
          const { signature, timestamp } = signInternalPayload(notificationPayload);
          const notificationResponse = await fetch(notificationUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Signature": signature,
              "X-Internal-Timestamp": timestamp,
            },
            body: JSON.stringify(notificationPayload),
          });
          if (!notificationResponse.ok) console.warn('Absence notification service returned an unsuccessful response');
        } catch {
          console.error('Absence notification delivery failed');
        }
      }

      res.status(201).json(result[0]);
    } catch (error: any) {
      console.error('Absence creation failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  const rejectedJustificationMessage = 'Cette justification a déjà été rejetée. Veuillez vous rapprocher de l’établissement avec les justificatifs nécessaires.';
  const respondJustificationAlreadyRejected = (res: any) => res.status(409).json({
    error: rejectedJustificationMessage,
    code: 'JUSTIFICATION_ALREADY_REJECTED',
  });
  const requireParentJustificationActor = async (req: AuthRequest, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'parent') {
        return res.status(403).json({
          error: 'Only parents may create absence justifications',
          code: 'JUSTIFICATION_PARENT_ONLY',
        });
      }

      (req as any).absenceJustificationActor = actor;
      return next();
    } catch (error: any) {
      console.error('Failed to authorize absence justification:', error?.message || error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
  const cleanupUploadedJustificationFiles = async (files: Array<{ path?: string }>) => {
    await Promise.all(files.map((file: any) => file?.storageMode === 's3' && file.storageReference
      ? deleteStoredFile(file.storageReference, 'absence-justifications').catch((error: any) => {
        console.error('Failed to remove rejected S3 justification upload:', error?.message || error);
      })
      : file.path
      ? fsPromises.unlink(file.path).catch((error: any) => {
        if (error?.code !== 'ENOENT') console.error('Failed to remove rejected justification upload:', error?.message || error);
      })
      : Promise.resolve()));
  };

  // Justify a pending absence
  app.put('/api/absences/:id/justify', requireAuth, requireParentJustificationActor, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);
      const { justificationReason } = req.body;
      if (!justificationReason) {
        return res.status(400).json({ error: 'Please specify a reasons for justification' });
      }

      const actor = (req as any).absenceJustificationActor;

      // Load the absence to check its student and school
      const [absence] = await db
        .select()
        .from(absences)
        .where(eq(absences.id, id));

      if (!absence) return res.status(404).json({ error: 'Absence not found' });

      const [absenceStudent] = await db
        .select({ id: students.id, schoolId: students.schoolId })
        .from(students)
        .where(eq(students.id, absence.studentId));

      if (!absenceStudent) return res.status(404).json({ error: 'Student not found' });

      const childStudentIds = await getParentChildStudentIds(actor.id);
      if (!childStudentIds.includes(absenceStudent.id)) {
        return res.status(403).json({ error: 'Cannot justify absence for student you do not represent' });
      }

      if (absence.justificationStatus === 'REJECTED') {
        return respondJustificationAlreadyRejected(res);
      }

      const updated = await db.update(absences)
        .set({
          isJustified: false,
          justificationReason,
          justificationStatus: 'PENDING',
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
        })
        .where(and(
          eq(absences.id, id),
          sql`${absences.justificationStatus} IS DISTINCT FROM 'REJECTED'`,
        ))
        .returning();

      if (!updated[0]) {
        const [latestAbsence] = await db.select({ justificationStatus: absences.justificationStatus })
          .from(absences)
          .where(eq(absences.id, id));
        if (latestAbsence?.justificationStatus === 'REJECTED') {
          return respondJustificationAlreadyRejected(res);
        }
        return res.status(404).json({ error: 'Absence not found' });
      }

      res.json(updated[0]);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to validate absence justification' });
    }
  });

  app.put('/api/absences/:id/justification/review', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid absence id' });

      const status = typeof req.body?.status === 'string' ? req.body.status.trim().toUpperCase() : '';
      const rejectionReason = typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason.trim() : '';
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid justification review status' });
      }
      if (status === 'REJECTED' && !rejectionReason) {
        return res.status(400).json({ error: 'A rejection reason is required' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'parent') return res.status(403).json({ error: 'Parents cannot review justifications' });

      const [absence] = await db.select().from(absences).where(eq(absences.id, id));
      if (!absence) return res.status(404).json({ error: 'Absence not found' });
      const [student] = await db.select({
        id: students.id,
        schoolId: students.schoolId,
        firstName: students.firstName,
        parentId: students.parentId,
      }).from(students).where(eq(students.id, absence.studentId));
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const [classRecord] = await db.select().from(classes).where(eq(classes.id, absence.classId));
      if (!classRecord) return res.status(404).json({ error: 'Class not found' });

      if (actor.role === 'teacher') {
        const assignmentContext = await getTeacherTeachingAssignmentContext(actor);
        if (!assignmentContext || student.schoolId !== assignmentContext.schoolId
          || !canTeacherAccessAbsence(absence, assignmentContext.teacherId, assignmentContext.assignments)) {
          return res.status(403).json({ error: 'Teacher is not assigned to this absence teaching assignment' });
        }
      } else if (actor.role === 'school_admin' || actor.role === 'surveillant') {
        if (actor.schoolId == null || student.schoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Actor is outside the student school' });
        }
        const classInScope = classRecord.schoolId === actor.schoolId || await isApprovedClassForSchool(absence.classId, actor.schoolId);
        if (!classInScope) return res.status(403).json({ error: 'Class is outside the actor school' });
      } else if (actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Not authorized to review justifications' });
      }

      const isAlreadyFinalAndEquivalent =
        absence.justificationStatus === status &&
        (
          status === 'APPROVED' ||
          (absence.rejectionReason ?? '') === (rejectionReason || '')
        );

      if (isAlreadyFinalAndEquivalent) {
        return res.json(absence);
      }

      const updated = await db.update(absences).set({
        justificationStatus: status,
        isJustified: status === 'APPROVED',
        rejectionReason: status === 'REJECTED' ? rejectionReason : null,
        reviewedBy: actor.id ?? null,
        reviewedAt: new Date(),
      }).where(eq(absences.id, id)).returning();

      const reviewedAbsence = updated[0] ?? absence;
      const studentName = student.firstName || 'l\'élève';

      const reviewTitle = status === 'APPROVED'
        ? "Justification d'absence validée"
        : "Justification d'absence rejetée";

      const rejectionSuffix = status === 'REJECTED' && rejectionReason
        ? ` Motif : ${rejectionReason}`
        : '';

      const reviewMessage = status === 'APPROVED'
        ? `La justification de l'absence de ${studentName} a été validée par l'établissement.`
        : `La justification de l'absence de ${studentName} a été rejetée. Veuillez passer dans l'établissement afin de fournir les justificatifs nécessaires.${rejectionSuffix}`;

      const [parentRecord] = student.parentId != null
        ? await db.select({ userId: parents.userId }).from(parents).where(eq(parents.id, student.parentId))
        : [null];

      if (parentRecord?.userId) {
        try {
          await db.insert(notifications).values({
            userId: parentRecord.userId,
            title: reviewTitle,
            body: reviewMessage,
            type: 'absence',
          });
        } catch (notificationInsertError) {
          console.error('Failed to insert absence justification review notification:', notificationInsertError);
        }

        try {
          const dedupeReason = status === 'REJECTED'
            ? String(rejectionReason || 'rejected').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)
            : 'approved';

          const notificationPayload = {
            parentId: String(parentRecord.userId),
            title: reviewTitle,
            message: reviewMessage,
            category: 'absence',
            metadata: {
              target: 'absence',
              absenceId: reviewedAbsence.id,
              studentId: student.id,
              classId: absence.classId,
              status,
              rejectionReason: status === 'REJECTED' ? rejectionReason : null,
            },
            dedupeKey: `absence-justification-review-${reviewedAbsence.id}-${status}-${dedupeReason}`,
          };

          const { signature, timestamp } = signInternalPayload(notificationPayload);
          await fetch(`${process.env.API_URL || 'http://localhost:3001'}/api/internal/absence-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-Signature': signature,
              'X-Internal-Timestamp': timestamp,
            },
            body: JSON.stringify(notificationPayload),
          });
        } catch (pushNotificationError) {
          console.error('Failed to dispatch absence justification review push notification:', pushNotificationError);
        }
      }

      return res.json(reviewedAbsence);
    } catch (error: any) {
      console.error('Failed to review absence justification:', error);
      return res.status(500).json({ error: 'Failed to review absence justification' });
    }
  });

  app.post('/api/internal/absence-justification', handleInternalJustificationUpload, verifyInternalJustificationAuth, async (req: any, res) => {
    const absenceId = parseInt(String(req.body?.absenceId ?? ''), 10);
    const parentId = parseInt(String(req.body?.parentId ?? ''), 10);
    const justificationReason = typeof req.body?.justificationReason === 'string'
      ? req.body.justificationReason.trim()
      : '';
    const uploadedFile = req.file as Express.Multer.File | undefined;

    if (!Number.isFinite(absenceId) || !Number.isFinite(parentId) || !justificationReason || !uploadedFile) {
      return res.status(400).json({ error: 'Invalid internal justification request' });
    }

    try {
      const [parent] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, parentId), eq(users.isDeleted, false)));
      if (!parent) return res.status(403).json({ error: 'Invalid parent identity' });
      if (parent.role !== 'parent') {
        return res.status(403).json({
          error: 'Only parents may create absence justifications',
          code: 'JUSTIFICATION_PARENT_ONLY',
        });
      }

      const [absence] = await db
        .select()
        .from(absences)
        .where(eq(absences.id, absenceId));
      if (!absence) return res.status(404).json({ error: 'Absence not found' });

      const [absenceStudent] = await db
        .select({ id: students.id })
        .from(students)
        .where(eq(students.id, absence.studentId));
      if (!absenceStudent) return res.status(404).json({ error: 'Student not found' });

      const childStudentIds = await getParentChildStudentIds(parentId);
      if (!childStudentIds.includes(absenceStudent.id)) {
        return res.status(403).json({ error: 'Cannot justify absence for student you do not represent' });
      }

      if (absence.justificationStatus === 'REJECTED') {
        return respondJustificationAlreadyRejected(res);
      }

      const persistedUpload = await persistUploadedFile(
        {
          originalname: uploadedFile.originalname,
          filename: uploadedFile.originalname,
          buffer: uploadedFile.buffer,
          mimetype: uploadedFile.mimetype,
          size: uploadedFile.size,
        },
        'absence-justifications',
      );
      const storedFileName = persistedUpload.storedReference;
      let persisted = false;

      try {
        const updated = await db.update(absences)
          .set({ isJustified: false, justificationReason, justificationStatus: 'PENDING', rejectionReason: null, reviewedBy: null, reviewedAt: null })
          .where(and(
            eq(absences.id, absenceId),
            sql`${absences.justificationStatus} IS DISTINCT FROM 'REJECTED'`,
          ))
          .returning();

        if (!updated[0]) {
          const [latestAbsence] = await db.select({ justificationStatus: absences.justificationStatus })
            .from(absences)
            .where(eq(absences.id, absenceId));
          await deleteStoredFile(storedFileName, 'absence-justifications').catch((cleanupError) => {
            console.warn('Failed to clean unreferenced internal justification upload:', cleanupError);
          });
          if (latestAbsence?.justificationStatus === 'REJECTED') {
            return respondJustificationAlreadyRejected(res);
          }
          return res.status(404).json({ error: 'Absence not found' });
        }

        const inserted = await db.insert(absenceJustifications).values({
          absenceId,
          fileName: uploadedFile.originalname,
          filePath: storedFileName,
          mimeType: uploadedFile.mimetype,
          fileSize: Number(uploadedFile.size),
          uploadedBy: parentId,
        }).returning();
        persisted = true;

        const actor = {
          ...parent,
          uid: parent.uid,
          role: parent.role,
          schoolId: parent.schoolId ?? null,
        } as any;
        await logAuditEvent(
          actor,
          'create',
          'absence_justification',
          absenceId,
          parent.schoolId ?? null,
          `Uploaded justification file ${uploadedFile.originalname} for absence ${absenceId}`,
        );

        return res.status(201).json({
          ...updated[0],
          justificationFileId: inserted[0]?.id ?? null,
          justificationFileName: inserted[0]?.fileName ?? null,
          justificationFilesCount: inserted.length,
        });
      } catch (error) {
        if (!persisted) {
          await deleteStoredFile(storedFileName, 'absence-justifications').catch((cleanupError) => {
            console.warn('Failed to clean unreferenced internal justification upload:', cleanupError);
          });
        }
        throw error;
      }
    } catch (err: any) {
      console.error('Failed to receive internal absence justification:', err?.message || err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/absences/:id/justifications', requireAuth, requireParentJustificationActor, handleJustificationUpload, async (req: AuthRequest, res) => {
    const uploadedFiles = Array.isArray((req as any).justificationFiles)
      ? (req as any).justificationFiles as any[]
      : [];
    let justificationRowsCommitted = false;
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid absence id' });
      }

      const justificationReason = typeof req.body.justificationReason === 'string'
        ? req.body.justificationReason.trim()
        : '';
      if (!justificationReason) {
        return res.status(400).json({ error: 'Please specify a reason for justification' });
      }

      const fileList = uploadedFiles.length > 0 ? uploadedFiles : [];
      if (fileList.length === 0) {
        return res.status(400).json({ error: 'Please upload at least one justification file' });
      }

      const actor = (req as any).absenceJustificationActor;

      const [absence] = await db
        .select()
        .from(absences)
        .where(eq(absences.id, id));

      if (!absence) return res.status(404).json({ error: 'Absence not found' });

      const [absenceStudent] = await db
        .select({ id: students.id, schoolId: students.schoolId })
        .from(students)
        .where(eq(students.id, absence.studentId));

      if (!absenceStudent) return res.status(404).json({ error: 'Student not found' });

      if (actor.role === 'teacher') {
        const teacherClassIds = await getTeacherTeachingClassIds(actor);
        const authorizedStudentIds = await studentAccess.getAuthorizedStudentIds(actor as any, { classIds: teacherClassIds });
        if (!authorizedStudentIds.includes(absenceStudent.id)) {
          return res.status(403).json({ error: 'Cannot justify absence for student outside your assigned classes' });
        }
      } else if (actor.role === 'parent') {
        const childStudentIds = await getParentChildStudentIds(actor.id);
        if (!childStudentIds.includes(absenceStudent.id)) {
          return res.status(403).json({ error: 'Cannot justify absence for student you do not represent' });
        }
      } else if (actor.role !== 'super_admin' && actor.schoolId && absenceStudent.schoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Cannot justify absence in another school' });
      }

      if (absence.justificationStatus === 'REJECTED') {
        await cleanupUploadedJustificationFiles(fileList);
        return respondJustificationAlreadyRejected(res);
      }

      const updated = await db.update(absences)
        .set({
          isJustified: false,
          justificationReason,
          justificationStatus: 'PENDING',
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
        })
        .where(and(
          eq(absences.id, id),
          sql`${absences.justificationStatus} IS DISTINCT FROM 'REJECTED'`,
        ))
        .returning();

      if (!updated[0]) {
        const [latestAbsence] = await db.select({ justificationStatus: absences.justificationStatus })
          .from(absences)
          .where(eq(absences.id, id));
        await cleanupUploadedJustificationFiles(fileList);
        if (latestAbsence?.justificationStatus === 'REJECTED') {
          return respondJustificationAlreadyRejected(res);
        }
        return res.status(404).json({ error: 'Absence not found' });
      }

      const inserted = await db.insert(absenceJustifications).values(
        fileList.map((file: any) => ({
          absenceId: id,
          fileName: file.originalname,
          filePath: file.filename,
          mimeType: file.mimetype,
          fileSize: Number(file.size),
          uploadedBy: req.user!.id!,
        }))
      ).returning();
      justificationRowsCommitted = inserted.length > 0;

      const auditText = fileList.map((file: any) => file.originalname).join(', ');
      await logAuditEvent(
        actor,
        'create',
        'absence_justification',
        id,
        actor.schoolId ?? null,
        `Uploaded justification files ${auditText} for absence ${id}`,
      );

      res.status(201).json({
        ...updated[0],
        justificationFileId: inserted[0]?.id ?? null,
        justificationFileName: inserted[0]?.fileName ?? null,
        justificationFilesCount: inserted.length,
      });
    } catch (err: any) {
      console.error('Failed to upload absence justification:', err);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      if (!justificationRowsCommitted) {
        await cleanupUploadedJustificationFiles(uploadedFiles);
      }
    }
  });

  app.get('/api/absences/:id/justification/download', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid absence id' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const [absence] = await db
        .select()
        .from(absences)
        .where(eq(absences.id, id));

      if (!absence) return res.status(404).json({ error: 'Absence not found' });

      const [absenceStudent] = await db
        .select({ id: students.id, schoolId: students.schoolId })
        .from(students)
        .where(eq(students.id, absence.studentId));

      if (!absenceStudent) return res.status(404).json({ error: 'Student not found' });
      if (actor.role === 'teacher') {
        const assignmentContext = await getTeacherTeachingAssignmentContext(actor);
        if (!assignmentContext || absenceStudent.schoolId !== assignmentContext.schoolId) {
          return res.status(403).json({ error: 'Cannot access absence justification for this student' });
        }
        if (!canTeacherAccessAbsence(absence, assignmentContext.teacherId, assignmentContext.assignments)) {
          return res.status(403).json({ error: 'Cannot access absence justification for student outside your assigned classes' });
        }
      } else if (actor.role === 'parent') {
        const childStudentIds = await getParentChildStudentIds(actor.id);
        if (!childStudentIds.includes(absenceStudent.id)) {
          return res.status(403).json({ error: 'Cannot access absence justification for student you do not represent' });
        }
      } else if (actor.role !== 'super_admin' && actor.schoolId && absenceStudent.schoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Cannot access absence justification in another school' });
      }

      const [justification] = await db.select().from(absenceJustifications)
        .where(eq(absenceJustifications.absenceId, id))
        .orderBy(desc(absenceJustifications.uploadedAt))
        .limit(1);

      if (!justification) {
        return res.status(404).json({ error: 'No justification file found' });
      }

      const safeFileName = String(justification.filePath || '');
      const sent = await streamStoredFileToResponse(safeFileName, 'absence-justifications', justification.fileName, justification.mimeType || 'application/octet-stream', res as any);
      if (!sent) {
        console.warn('[uploads] absence justification file missing during download', {
          absenceId: id,
          fileName: safeFileName,
          checkedDirs: uploadStorageDirCandidates,
        });
        return res.status(404).json({ error: 'Justification file not found on disk' });
      }
      return undefined;
    } catch (err: any) {
      console.error('Failed to download justification file:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================
  // MODULE SUBJECTS (MATIÈRES) API
  // ==========================================

  app.get('/api/subject-types', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const rows = await db.select().from(subjectTypes).orderBy(subjectTypes.sortOrder, subjectTypes.id);
      res.json(rows);
    } catch (err: any) {
      console.error('Error fetching subject types:', err);
      res.status(500).json({ error: 'Failed to fetch subject types' });
    }
  });

  app.post('/api/subject-types', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { name, description, sortOrder } = req.body ?? {};
      const normalizedName = typeof name === 'string' ? name.trim() : '';
      if (!normalizedName) {
        return res.status(400).json({ error: 'name is required' });
      }
      if (sortOrder !== undefined && (!Number.isInteger(Number(sortOrder)) || Number(sortOrder) < 0)) {
        return res.status(400).json({ error: 'Invalid sortOrder' });
      }

      const [duplicate] = await db.select({ id: subjectTypes.id })
        .from(subjectTypes)
        .where(eq(subjectTypes.name, normalizedName));
      if (duplicate) return res.status(409).json({ error: 'Subject type already exists' });

      const [created] = await db.insert(subjectTypes).values({
        name: normalizedName,
        description: description == null ? null : String(description).trim(),
        sortOrder: sortOrder === undefined ? undefined : Number(sortOrder),
      }).returning();

      await logAuditEvent(actor, 'create', 'subject_type', created.id, null, `Created subject type "${created.name}"`);
      res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ error: 'Subject type already exists' });
      console.error('Error creating subject type:', err);
      res.status(500).json({ error: 'Failed to create subject type' });
    }
  });

  app.put('/api/subject-types/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const subjectTypeId = Number(req.params.id);
      if (!Number.isInteger(subjectTypeId) || subjectTypeId <= 0) {
        return res.status(400).json({ error: 'Invalid subject type ID' });
      }

      const [existing] = await db.select().from(subjectTypes).where(eq(subjectTypes.id, subjectTypeId));
      if (!existing) return res.status(404).json({ error: 'Subject type not found' });

      const { name, description, sortOrder } = req.body ?? {};
      const nextName = name === undefined ? existing.name : (typeof name === 'string' ? name.trim() : '');
      if (!nextName) return res.status(400).json({ error: 'Invalid name' });
      if (sortOrder !== undefined && (!Number.isInteger(Number(sortOrder)) || Number(sortOrder) < 0)) {
        return res.status(400).json({ error: 'Invalid sortOrder' });
      }

      const [duplicate] = await db.select({ id: subjectTypes.id })
        .from(subjectTypes)
        .where(and(
          eq(subjectTypes.name, nextName),
          sql`${subjectTypes.id} <> ${subjectTypeId}`,
        ));
      if (duplicate) return res.status(409).json({ error: 'Subject type already exists' });

      const [updated] = await db.update(subjectTypes)
        .set({
          name: nextName,
          description: description === undefined ? existing.description : (description == null ? null : String(description).trim()),
          sortOrder: sortOrder === undefined ? existing.sortOrder : Number(sortOrder),
          updatedAt: new Date(),
        })
        .where(eq(subjectTypes.id, subjectTypeId))
        .returning();

      await logAuditEvent(actor, 'update', 'subject_type', subjectTypeId, null, `Updated subject type "${updated.name}"`);
      res.json(updated);
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ error: 'Subject type already exists' });
      console.error('Error updating subject type:', err);
      res.status(500).json({ error: 'Failed to update subject type' });
    }
  });

  app.delete('/api/subject-types/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const subjectTypeId = Number(req.params.id);
      if (!Number.isInteger(subjectTypeId) || subjectTypeId <= 0) {
        return res.status(400).json({ error: 'Invalid subject type ID' });
      }

      const [existing] = await db.select().from(subjectTypes).where(eq(subjectTypes.id, subjectTypeId));
      if (!existing) return res.status(404).json({ error: 'Subject type not found' });

      const [subjectUsage] = await db.select({ count: sql<number>`count(*)::int` })
        .from(subjects)
        .where(eq(subjects.subjectTypeId, subjectTypeId));
      const [schoolSubjectUsage] = await db.select({ count: sql<number>`count(*)::int` })
        .from(schoolSubjects)
        .where(eq(schoolSubjects.subjectTypeId, subjectTypeId));
      if (Number(subjectUsage?.count ?? 0) > 0 || Number(schoolSubjectUsage?.count ?? 0) > 0) {
        return res.status(409).json({ error: 'Subject type is used by existing subjects' });
      }

      await db.delete(subjectTypes).where(eq(subjectTypes.id, subjectTypeId));
      await logAuditEvent(actor, 'delete', 'subject_type', subjectTypeId, null, `Deleted subject type "${existing.name}"`);
      res.json({ success: true, message: 'Subject type deleted' });
    } catch (err: any) {
      console.error('Error deleting subject type:', err);
      res.status(500).json({ error: 'Failed to delete subject type' });
    }
  });

  // Get subjects for current school - restricted to super_admin & school_admin
  app.get('/api/subjects', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      const schoolIdParam = req.query.schoolId ? Number(req.query.schoolId) : undefined;
      const approvedOnly = req.query.approvedOnly === 'true' || req.query.approvedOnly === '1';
      const targetSchoolId = actor.role === 'school_admin' || actor.role === 'surveillant'
        ? actor.schoolId
        : actor.role === 'teacher'
          ? actor.schoolId
          : schoolIdParam;

      if (actor.role === 'teacher') {
        if (!targetSchoolId) {
          return res.status(403).json({ error: 'Teacher school context is required' });
        }

        const schoolRows = await db
          .select({
            id: subjects.id,
            schoolId: subjects.schoolId,
            subjectTypeId: sql<number | null>`CASE WHEN ${schoolSubjects.id} IS NOT NULL THEN NULLIF(to_jsonb(${schoolSubjects}) ->> 'subject_type_id', '')::integer ELSE ${subjects.subjectTypeId} END`,
            name: subjects.name,
            code: subjects.code,
            status: sql`COALESCE(${schoolSubjects.status}, 'approved')`,
            createdAt: subjects.createdAt,
            updatedAt: subjects.updatedAt,
          })
          .from(subjects)
          .leftJoin(
            schoolSubjects,
            and(
              eq(subjects.id, schoolSubjects.subjectId),
              eq(schoolSubjects.schoolId, targetSchoolId)
            )
          )
          .where(
            or(
              eq(subjects.schoolId, targetSchoolId),
              eq(schoolSubjects.schoolId, targetSchoolId)
            )
          );

        let result = schoolRows.map((subject) => ({
          ...subject,
          schoolId: subject.schoolId ?? null,
        }));

        if (approvedOnly) {
          result = result.filter((subject) => subject.status === 'approved');
        }

        res.json(result);
        return;
      }

      if (actor.role === 'school_admin') {
        if (!targetSchoolId) {
          return res.status(403).json({ error: 'School context is required' });
        }

        const schoolRows = await db
          .select({
            id: subjects.id,
            schoolId: subjects.schoolId,
            subjectTypeId: sql<number | null>`CASE WHEN ${schoolSubjects.id} IS NOT NULL THEN NULLIF(to_jsonb(${schoolSubjects}) ->> 'subject_type_id', '')::integer ELSE ${subjects.subjectTypeId} END`,
            name: subjects.name,
            code: subjects.code,
            status: sql`COALESCE(${schoolSubjects.status}, 'approved')`,
            createdAt: subjects.createdAt,
            updatedAt: subjects.updatedAt,
          })
          .from(subjects)
          .leftJoin(
            schoolSubjects,
            and(
              eq(subjects.id, schoolSubjects.subjectId),
              eq(schoolSubjects.schoolId, targetSchoolId)
            )
          )
          .where(
            or(
              eq(subjects.schoolId, targetSchoolId),
              eq(schoolSubjects.schoolId, targetSchoolId)
            )
          );

        let result = schoolRows.map((subject) => ({
          ...subject,
          schoolId: subject.schoolId ?? null,
        }));

        if (approvedOnly) {
          result = result.filter((subject) => subject.status === 'approved');
        }

        res.json(result);
        return;
      }

      if (approvedOnly && !targetSchoolId) {
        if (actor.role === 'super_admin') {
          const approvedRows = await db
            .select({
              id: subjects.id,
              schoolId: subjects.schoolId,
              subjectTypeId: sql<number | null>`CASE WHEN ${schoolSubjects.id} IS NOT NULL THEN NULLIF(to_jsonb(${schoolSubjects}) ->> 'subject_type_id', '')::integer ELSE ${subjects.subjectTypeId} END`,
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
        const typeMap = new Map(statusRows.map((row) => [row.subjectId, row.subjectTypeId]));
        let result = allSubjects.map((subject) => {
          const hasSchoolSpecificAssignment = typeMap.has(subject.id);
          const effectiveSubjectTypeId = hasSchoolSpecificAssignment
            ? typeMap.get(subject.id) ?? null
            : subject.subjectTypeId ?? null;

          return {
            ...subject,
            schoolId: subject.schoolId ?? null,
            subjectTypeId: effectiveSubjectTypeId,
            status: subject.schoolId === targetSchoolId ? 'approved' : (statusMap.get(subject.id) ?? 'pending'),
          };
        });

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

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      // Only super_admin and school_admin can create subjects
      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { name, code, schoolId: bodySchoolId, subjectTypeId: bodySubjectTypeId } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Subject name is required' });
      }

      const requestedSchoolId = bodySchoolId == null || bodySchoolId === '' ? null : Number(bodySchoolId);
      if (bodySchoolId != null && bodySchoolId !== '' && Number.isNaN(requestedSchoolId)) {
        return res.status(400).json({ error: 'Invalid schoolId' });
      }

      let finalSchoolId: number | null = null;
      if (actor.role === 'school_admin') {
        const validation = resolveClassCreationSchoolId({
          actorRole: actor.role,
          requestedSchoolId: bodySchoolId,
          actorSchoolId: actor.schoolId,
        });
        if (validation.error) {
          return res.status(400).json({ error: validation.error });
        }
        finalSchoolId = validation.schoolId;
      } else {
        finalSchoolId = requestedSchoolId;
      }

      let finalSubjectTypeId: number | null | undefined;
      if (bodySubjectTypeId !== undefined && bodySubjectTypeId !== null && bodySubjectTypeId !== '') {
        finalSubjectTypeId = Number(bodySubjectTypeId);
        if (!Number.isInteger(finalSubjectTypeId) || finalSubjectTypeId <= 0) {
          return res.status(400).json({ error: 'Invalid subjectTypeId' });
        }

        const [subjectType] = await db.select({ id: subjectTypes.id })
          .from(subjectTypes)
          .where(eq(subjectTypes.id, finalSubjectTypeId));
        if (!subjectType) return res.status(404).json({ error: 'Subject type not found' });
      } else if (bodySubjectTypeId === null) {
        finalSubjectTypeId = null;
      }

      const [newSubject] = await db
        .insert(subjects)
        .values({
          schoolId: finalSchoolId != null ? Number(finalSchoolId) : null,
          subjectTypeId: finalSubjectTypeId,
          name: name.trim(),
          code: code ? code.trim() : undefined,
        })
        .returning();

      res.status(201).json({
        ...newSubject,
        schoolId: newSubject.schoolId ?? null,
        status: 'approved',
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

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      // Only super_admin and school_admin can update subjects
      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const subjectId = Number(req.params.id);
      if (!subjectId) return res.status(400).json({ error: 'Invalid subject ID' });

      const [subject] = await db.select().from(subjects).where(eq(subjects.id, subjectId));
      if (!subject) return res.status(404).json({ error: 'Subject not found' });

      if (actor.role === 'school_admin') {
        if (actor.schoolId == null) return res.status(403).json({ error: 'School context is required' });
        if (subject.schoolId != null && subject.schoolId !== actor.schoolId) return res.status(403).json({ error: 'Forbidden' });
        const requestedName = req.body?.name === undefined ? undefined : String(req.body.name).trim();
        const requestedCode = req.body?.code === undefined ? undefined : String(req.body.code ?? '').trim() || null;
        const changesGlobalName = requestedName !== undefined && requestedName !== subject.name;
        const changesGlobalCode = requestedCode !== undefined && requestedCode !== (subject.code ?? null);
        if (changesGlobalName || changesGlobalCode) {
          return res.status(403).json({ error: subject.schoolId == null
            ? 'Global subject names can only be changed by a super admin'
            : 'School admins cannot change subject names or codes' });
        }
      }

      const { name, code, subjectTypeId: bodySubjectTypeId } = req.body;
      const hasSubjectTypeId = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'subjectTypeId');
      if (!hasSubjectTypeId && (!name || !name.trim())) {
        return res.status(400).json({ error: 'Subject name is required' });
      }
      if (name !== undefined && (!name || !name.trim())) {
        return res.status(400).json({ error: 'Subject name is required' });
      }

      const updateValues: {
        name?: string;
        code?: string;
        subjectTypeId?: number | null;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };
      if (name !== undefined && actor.role !== 'school_admin') {
        updateValues.name = name.trim();
      }
      if (code !== undefined && actor.role !== 'school_admin') {
        updateValues.code = String(code ?? '').trim() || null;
      }

      if (hasSubjectTypeId) {
        if (actor.role === 'school_admin') {
          const targetSchoolId = actor.schoolId;
          if (!targetSchoolId) {
            return res.status(403).json({ error: 'School context is required' });
          }

          const [relation] = await db.select().from(schoolSubjects).where(and(
            eq(schoolSubjects.schoolId, targetSchoolId),
            eq(schoolSubjects.subjectId, subjectId),
            eq(schoolSubjects.status, 'approved'),
          ));

          if (subject.schoolId === null && !relation) {
            return res.status(403).json({ error: 'Global subject is not assigned to your school' });
          }

          if (subject.schoolId != null && subject.schoolId !== targetSchoolId) {
            return res.status(403).json({ error: 'Forbidden' });
          }

          if (bodySubjectTypeId === null || bodySubjectTypeId === '') {
            if (subject.schoolId === null) {
              if (relation) {
                await db.update(schoolSubjects)
                  .set({ subjectTypeId: null, updatedAt: new Date() })
                  .where(and(eq(schoolSubjects.schoolId, targetSchoolId), eq(schoolSubjects.subjectId, subjectId)));
              }
              res.json({ ...subject, subjectTypeId: null, schoolId: subject.schoolId ?? null, status: relation?.status ?? 'approved' });
              return;
            }
            updateValues.subjectTypeId = null;
          } else {
            const parsedSubjectTypeId = Number(bodySubjectTypeId);
            if (!Number.isInteger(parsedSubjectTypeId) || parsedSubjectTypeId <= 0) {
              return res.status(400).json({ error: 'Invalid subjectTypeId' });
            }

            const [subjectType] = await db.select({ id: subjectTypes.id })
              .from(subjectTypes)
              .where(eq(subjectTypes.id, parsedSubjectTypeId));
            if (!subjectType) return res.status(404).json({ error: 'Subject type not found' });

            if (subject.schoolId === null) {
              if (relation) {
                await db.update(schoolSubjects)
                  .set({ subjectTypeId: parsedSubjectTypeId, updatedAt: new Date() })
                  .where(and(eq(schoolSubjects.schoolId, targetSchoolId), eq(schoolSubjects.subjectId, subjectId)));
              } else {
                return res.status(403).json({ error: 'Global subject is not approved for your school' });
              }
              res.json({ ...subject, subjectTypeId: parsedSubjectTypeId, schoolId: subject.schoolId ?? null, status: relation?.status ?? 'approved' });
              return;
            }
            updateValues.subjectTypeId = parsedSubjectTypeId;
          }
        } else if (actor.role === 'super_admin') {
          if (bodySubjectTypeId === null || bodySubjectTypeId === '') {
            updateValues.subjectTypeId = null;
          } else {
            const parsedSubjectTypeId = Number(bodySubjectTypeId);
            if (!Number.isInteger(parsedSubjectTypeId) || parsedSubjectTypeId <= 0) {
              return res.status(400).json({ error: 'Invalid subjectTypeId' });
            }

            const [subjectType] = await db.select({ id: subjectTypes.id })
              .from(subjectTypes)
              .where(eq(subjectTypes.id, parsedSubjectTypeId));
            if (!subjectType) return res.status(404).json({ error: 'Subject type not found' });
            updateValues.subjectTypeId = parsedSubjectTypeId;
          }
        }
      }

      if (subject.schoolId === null && actor.role === 'school_admin' && !hasSubjectTypeId) {
        const [relation] = await db.select().from(schoolSubjects).where(and(
          eq(schoolSubjects.schoolId, actor.schoolId),
          eq(schoolSubjects.subjectId, subjectId),
        ));
        if (!relation) {
          return res.status(403).json({ error: 'Global subject is not assigned to your school' });
        }
      }

      const [updatedSubject] = await db
        .update(subjects)
        .set(updateValues)
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

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      // Only super_admin and school_admin can delete subjects
      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const subjectId = Number(req.params.id);
      if (!subjectId) return res.status(400).json({ error: 'Invalid subject ID' });

      const [subject] = await db.select().from(subjects).where(eq(subjects.id, subjectId));
      if (!subject) return res.status(404).json({ error: 'Subject not found' });

      // Check access: school_admin can only delete subjects in their school
      if (actor.role === 'school_admin' && subject.schoolId !== actor.schoolId) {
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

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = Number(req.params.schoolId);
      const subjectId = Number(req.params.subjectId);
      if (!schoolId || !subjectId) return res.status(400).json({ error: 'Invalid subject or school ID' });

      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const [subjectRow] = await db.select().from(subjects).where(eq(subjects.id, subjectId));
      if (!subjectRow) {
        return res.status(404).json({ error: 'Subject not found' });
      }

      if (subjectRow.schoolId != null && subjectRow.schoolId !== schoolId) {
        return res.status(409).json({ error: 'Subject already belongs to another school' });
      }

      if (subjectRow.schoolId != null && subjectRow.schoolId !== schoolId) {
        return res.status(409).json({ error: 'Subject belongs to another school' });
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

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schoolId = Number(req.params.schoolId);
      const subjectId = Number(req.params.subjectId);
      if (!schoolId || !subjectId) return res.status(400).json({ error: 'Invalid subject or school ID' });

      if (actor.role === 'school_admin' && actor.schoolId !== schoolId) {
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
      if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });

      let query = db
        .select({
          id: evaluations.id,
          classId: evaluations.classId,
          className: classes.name,
          teacherId: evaluations.teacherId,
          teacherName: users.name,
          termId: evaluations.termId,
          subjectId: evaluations.subjectId,
          subject: sql<string>`COALESCE(${subjects.name}, ${evaluations.subject})`,
          type: evaluations.type,
          title: evaluations.title,
          coefficient: evaluations.coefficient,
          maxScore: evaluations.maxScore,
          countInBulletin: evaluations.countInBulletin,
          date: evaluations.date,
          createdAt: evaluations.createdAt,
          schoolId: evaluations.schoolId,
        })
        .from(evaluations)
        .innerJoin(classes, eq(evaluations.classId, classes.id))
        .innerJoin(teachers, eq(evaluations.teacherId, teachers.id))
        .innerJoin(users, eq(teachers.userId, users.id))
        .leftJoin(subjects, eq(evaluations.subjectId, subjects.id));

      if (actor.role !== 'super_admin') {
        // School admin, teacher, and others see only their school's evaluations.
        // Also allow global classes (classes.schoolId IS NULL) that have been
        // explicitly approved for this school via `school_classes`.
        if (actor.role === 'parent') {
          const childStudentIds = await getParentChildStudentIds(actor.id);
          if (childStudentIds.length === 0) {
            return res.json([]);
          }

          const childClassRows = await db
            .selectDistinct({ classId: students.classId, schoolId: students.schoolId })
            .from(students)
            .where(inArray(students.id, childStudentIds));

          const childClassIds = childClassRows.map((row) => row.classId).filter((id): id is number => id != null);
          const childSchoolIds = Array.from(new Set(childClassRows.map((row) => row.schoolId)));
          if (childClassIds.length === 0) {
            return res.json([]);
          }

          query = query.where(and(
            inArray(evaluations.classId, childClassIds),
            inArray(evaluations.schoolId, childSchoolIds),
          )) as any;
        } else if (actor.schoolId != null) {
          query = query.where(and(
            eq(evaluations.schoolId, actor.schoolId),
            or(
              eq(classes.schoolId, actor.schoolId),
              and(
                sql`${classes.schoolId} IS NULL`,
                sql`EXISTS (SELECT 1 FROM school_classes sc WHERE sc.class_id = ${classes.id} AND sc.school_id = ${actor.schoolId} AND sc.status = 'approved')`
              )
            ),
          )) as any;
        } else {
          return res.json([]);
        }

      }

      let list = await query;
      if ((actor.role === 'school_admin' || actor.role === 'teacher') && actor.schoolId != null) {
        const classApprovalById = new Map<number, Promise<boolean>>();
        const inSchoolScope = await Promise.all(list.map(async (evaluation) => {
          if (evaluation.schoolId !== actor.schoolId) return false;
          let approval = classApprovalById.get(evaluation.classId);
          if (!approval) {
            approval = isApprovedClassForSchool(evaluation.classId, actor.schoolId);
            classApprovalById.set(evaluation.classId, approval);
          }
          return approval;
        }));
        list = list.filter((_evaluation, index) => inSchoolScope[index]);
      }
      if (actor.role === 'teacher') {
        const scope = await getTeacherAuthorizationScope(actor);
        if (!scope) return res.json([]);
        list = list.filter((evaluation) => canTeacherReadEvaluation(scope, evaluation));
      }
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load evaluations list' });
    }
  });

  app.put('/api/evaluations/:id/bulletin-status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });
      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') {
        return res.status(403).json({ error: 'Only school administrators can validate evaluations' });
      }

      const evaluationId = Number(req.params.id);
      const countInBulletin = req.body?.countInBulletin;
      if (!Number.isInteger(evaluationId) || evaluationId <= 0 || typeof countInBulletin !== 'boolean') {
        return res.status(400).json({ error: 'evaluation id and countInBulletin are required' });
      }

      const [evaluation] = await db.select({ id: evaluations.id, classId: evaluations.classId, schoolId: evaluations.schoolId })
        .from(evaluations).where(eq(evaluations.id, evaluationId));
      if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });

      if (actor.role === 'school_admin') {
        if (actor.schoolId == null || evaluation.schoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Cannot validate an evaluation for another school' });
        }
        if (!(await isApprovedClassForSchool(evaluation.classId, actor.schoolId))) {
          return res.status(403).json({ error: 'Evaluation class is outside the school scope' });
        }
      }

      const [updated] = await db.update(evaluations)
        .set({ countInBulletin })
        .where(eq(evaluations.id, evaluationId))
        .returning({ id: evaluations.id, countInBulletin: evaluations.countInBulletin });
      return res.json(updated);
    } catch (err: any) {
      console.error('PUT /api/evaluations/:id/bulletin-status error:', err);
      return res.status(500).json({ error: 'Failed to update evaluation bulletin status' });
    }
  });

  app.post('/api/evaluations', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) {
        if (req.user && req.user.role !== 'super_admin') {
          return res.status(403).json({ error: 'Forbidden: missing or invalid school context' });
        }
        return res.status(404).json({ error: 'User not found' });
      }
      if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });
      if (actor.role !== 'super_admin' && actor.schoolId == null) {
        return res.status(403).json({ error: 'Forbidden: missing or invalid school context' });
      }
      if (actor.role === 'parent') {
        return res.status(403).json({ error: 'Parents are not allowed to create evaluations' });
      }
      const { classId, teacherId, termId, subject, subjectId, type, coefficient, maxScore, date, schoolId: requestedSchoolId } = req.body;
      if (!classId || !subject || !type || !date) {
        return res.status(400).json({ error: 'Missing mandatory assessment data' });
      }

      // Validate evaluation type
      const validTypes = ['interrogation', 'devoir', 'composition'];
      const normalizedType = String(type).toLowerCase().trim();
      if (!validTypes.includes(normalizedType)) {
        return res.status(400).json({ error: `Invalid evaluation type. Must be one of: ${validTypes.join(', ')}` });
      }

      // Load the class to check its school
      const [classRecord] = await db.select().from(classes).where(eq(classes.id, parseInt(classId)));
      if (!classRecord) return res.status(404).json({ error: 'Class not found' });

      // School admin can only create evaluations for classes in their own school
      if (actor.role !== 'super_admin') {
        if (actor.schoolId) {
          // Allow when class belongs to the same school, or when the class is a global class
          // that has been approved for this school (see isApprovedClassForSchool helper).
          const allowedForSchool = classRecord.schoolId === actor.schoolId || await isApprovedClassForSchool(parseInt(classId), actor.schoolId);
          if (!allowedForSchool) {
            return res.status(403).json({ error: 'Cannot create evaluation for class in another school' });
          }
        }
      }

      let teacherScope: Awaited<ReturnType<typeof getTeacherAuthorizationScope>> = null;

      // Automatically determine teacher Id if not explicitly provided
      let resolvedTeacherId = teacherId ? parseInt(teacherId) : null;
      let teacherProfileId: number | null = null;
      const dbUser = actor.id ? actor : null;
      if (!dbUser && actor.role === 'teacher') {
        return res.status(404).json({ error: 'User not found' });
      }

      if (actor.role === 'teacher') {
        teacherScope = await getTeacherAuthorizationScope(actor);
        if (!teacherScope) {
          return res.status(403).json({ error: 'Teacher profile not found for the current user' });
        }
        teacherProfileId = teacherScope.teacherId;
        if (!teacherScope.teachingClassIds.has(parseInt(classId))) {
          return res.status(403).json({ error: 'Un enseignant ne peut créer une évaluation que pour une classe qui lui est assignée' });
        }

        resolvedTeacherId = teacherScope.teacherId;
      }

      if (!resolvedTeacherId) {
        if (classRecord.teacherId) {
          resolvedTeacherId = classRecord.teacherId;
        }
      }

      if (!resolvedTeacherId) {
        return res.status(400).json({ error: 'Must specify a valid Teacher ID for this evaluation' });
      }

      if (actor.role === 'school_admin') {
        const [evaluationTeacher] = await db.select({ id: teachers.id, userId: teachers.userId, schoolId: teachers.schoolId })
          .from(teachers).where(eq(teachers.id, resolvedTeacherId));
        if (!evaluationTeacher) return res.status(400).json({ error: 'Invalid teacherId' });
        if (evaluationTeacher.schoolId !== actor.schoolId) {
          const [membership] = await db.select({ id: userSchools.id }).from(userSchools).where(and(
            eq(userSchools.userId, evaluationTeacher.userId),
            eq(userSchools.schoolId, actor.schoolId!),
            eq(userSchools.role, 'teacher'),
            eq(userSchools.isActive, true),
          ));
          if (!membership) return res.status(403).json({ error: 'Evaluation teacher is not active in this school' });
        }
      }

      const evaluationDate = String(date || '');
      const parsedEvaluationDate = new Date(evaluationDate);
      if (!evaluationDate || Number.isNaN(parsedEvaluationDate.getTime())) {
        return res.status(400).json({ error: 'Invalid evaluation date format. Expected YYYY-MM-DD' });
      }

      let resolvedTermId: number | null = null;
      let evaluationSchoolId = actor.role === 'super_admin'
        ? (requestedSchoolId != null && requestedSchoolId !== '' ? parsePositiveInteger(requestedSchoolId) : classRecord.schoolId)
        : actor.schoolId;
      if (requestedSchoolId != null && requestedSchoolId !== '' && parsePositiveInteger(requestedSchoolId) == null) {
        return res.status(400).json({ error: 'Invalid schoolId' });
      }
      if (evaluationSchoolId == null) {
        const approvedSchoolClasses = await db.select({ schoolId: schoolClasses.schoolId }).from(schoolClasses).where(and(
          eq(schoolClasses.classId, parseInt(classId)),
          eq(schoolClasses.status, 'approved'),
        ));
        const approvedSchoolIds = Array.from(new Set(approvedSchoolClasses.map((row) => row.schoolId)));
        if (approvedSchoolIds.length > 1) {
          return res.status(400).json({ error: 'schoolId is required for a class shared by multiple schools' });
        }
        if (approvedSchoolIds.length !== 1) {
          return res.status(400).json({ error: 'Cannot determine a unique school context for this class' });
        }
        evaluationSchoolId = approvedSchoolIds[0];
      }
      if (actor.role !== 'super_admin' && evaluationSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: 'Cannot create an evaluation outside the actor school' });
      }
      if (!(await isApprovedClassForSchool(parseInt(classId), evaluationSchoolId))) {
        return res.status(403).json({ error: 'Class is not approved for the evaluation school' });
      }
      const resolvedTerm = await resolveSchoolTermForClass({
        classId: parseInt(classId),
        academicYearId: classRecord.academicYearId,
        schoolId: evaluationSchoolId,
        date: evaluationDate,
        requestedTermId: termId != null && termId !== '' ? Number(termId) : null,
      });
      if ('error' in resolvedTerm) return res.status(400).json({ error: resolvedTerm.error });
      resolvedTermId = resolvedTerm.term.id;

      if (!resolvedTermId) {
        return res.status(400).json({ error: 'Unable to resolve a compatible term for this evaluation. Please select a term explicitly.' });
      }

      const normalizedSubject = String(subject).trim();
      const requestedSubjectId = subjectId == null || subjectId === '' ? null : Number(subjectId);
      if (requestedSubjectId != null && (!Number.isInteger(requestedSubjectId) || requestedSubjectId <= 0)) {
        return res.status(400).json({ error: 'Invalid subjectId' });
      }
      let approvalSchoolId = classRecord.schoolId;
      let resolvedSchoolClassId: number | null = null;
      let resolvedSchoolClassSchoolId: number | null = null;
      let approvalSource = 'class';

      if (approvalSchoolId == null) {
        approvalSource = 'request';
        if (actor.schoolId != null) {
          const [approvedClass] = await db.select().from(schoolClasses).where(
            and(
              eq(schoolClasses.classId, parseInt(classId)),
              eq(schoolClasses.schoolId, actor.schoolId),
              eq(schoolClasses.status, 'approved')
            )
          );
          if (!approvedClass) {
            console.error('ERROR /api/evaluations invalid school context for class', {
              classId: parseInt(classId),
              userSchoolId: actor.schoolId,
              note: 'No approved school_classes entry found for the current user school',
            });
            return res.status(403).json({ error: 'Invalid school context for this class' });
          }
          approvalSchoolId = actor.schoolId;
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
        userSchoolId: actor.schoolId,
        approvalSchoolId,
        approvalSource,
      });

      let approvedSubject: { subjectId: number; subjectName: string } | null = null;
      if (requestedSubjectId != null) {
        const [subjectRecord] = await db.select({ id: subjects.id, name: subjects.name })
          .from(subjects)
          .where(eq(subjects.id, requestedSubjectId));
        if (subjectRecord) {
          const resolvedById = await resolveApprovedSubjectForSchool(subjectRecord.name, approvalSchoolId);
          if (resolvedById?.subjectId === requestedSubjectId) {
            approvedSubject = resolvedById;
          }
        }
      } else {
        approvedSubject = await resolveApprovedSubjectForSchool(normalizedSubject, approvalSchoolId);
      }

      if (!approvedSubject) {
        return res.status(400).json({ error: 'La matière n’est pas approuvée pour cette école' });
      }

      const resolvedSubjectId = approvedSubject.subjectId;
      const resolvedSubjectName = approvedSubject.subjectName;

      if (actor.role === 'teacher' && teacherProfileId != null) {
        if (!teacherScope || !teacherScope.subjectIds.has(resolvedSubjectId)) {
          return res.status(403).json({ error: 'Cette matière n’est pas assignée à cet enseignant' });
        }
      }

      // Generate sequence number for this (termId, classId) combination
      // Using a transaction to avoid race conditions
      const sequenceNumber = await db.transaction(async (tx) => {
        // Get the maximum sequence number for this (termId, classId)
        const existingSequences = await tx
          .select({ maxSeq: sql<number>`MAX(${evaluations.sequenceNumber})` })
          .from(evaluations)
          .where(and(
            eq(evaluations.termId, resolvedTermId),
            eq(evaluations.classId, parseInt(classId)),
            eq(evaluations.schoolId, approvalSchoolId),
          ));

        const maxSeq = existingSequences[0]?.maxSeq ?? 0;
        const nextSequenceNumber = (maxSeq || 0) + 1;

        console.log('DEBUG sequence generation', {
          termId: resolvedTermId,
          classId: parseInt(classId),
          maxSeq,
          nextSequenceNumber,
        });

        return nextSequenceNumber;
      });

      // Get the short term name for display
      const [selectedTermInfo] = await db
        .select({ name: schoolTerms.name, orderIndex: schoolTerms.orderIndex, periodType: schoolTerms.periodType })
        .from(schoolTerms)
        .where(eq(schoolTerms.id, resolvedTermId));

      const termShortName = getPeriodTypeShortName(selectedTermInfo?.periodType, selectedTermInfo?.orderIndex || 1, selectedTermInfo?.name);
      const generatedName = `${normalizedType.charAt(0).toUpperCase()}${normalizedType.slice(1)} ${termShortName}.${sequenceNumber}`;

      const result = await db.insert(evaluations).values({
        classId: parseInt(classId),
        schoolId: approvalSchoolId,
        teacherId: resolvedTeacherId,
        termId: resolvedTermId,
        subjectId: resolvedSubjectId,
        subject: resolvedSubjectName,
        title: generatedName,
        type: normalizedType,
        sequenceNumber,
        generatedName,
        coefficient: coefficient ? parseInt(coefficient) : 1,
        maxScore: maxScore ? parseInt(maxScore) : 20,
        countInBulletin: false,
        date,
      }).returning();

      const [createdEvaluation] = result;
      const baseClassStudentParentsQuery = db
        .select({ parentUserId: parents.userId })
        .from(students)
        .leftJoin(parents, eq(students.parentId, parents.id));

      // Restrict parent notifications to authorized students only
      let classStudentParentsRows: any[] = [];
      if (actor.role === 'super_admin') {
        classStudentParentsRows = await baseClassStudentParentsQuery.where(and(eq(students.classId, parseInt(classId)), eq(students.isActive, true)));
      } else if (actor.role === 'teacher') {
        const authorizedIds = await (async () => {
          try {
            return await (await import('./src/lib/studentAccess.ts')).default.getAuthorizedStudentIds({ id: actor.id, role: actor.role, schoolId: actor.schoolId } as any, { classIds: [parseInt(classId)] });
          } catch (e) {
            return [] as number[];
          }
        })();
        if (authorizedIds.length === 0) {
          classStudentParentsRows = [];
        } else {
          classStudentParentsRows = await baseClassStudentParentsQuery.where(inArray(students.id, authorizedIds));
        }
      } else if (actor.role === 'school_admin') {
        classStudentParentsRows = await baseClassStudentParentsQuery.where(and(eq(students.classId, parseInt(classId)), eq(students.schoolId, actor.schoolId), eq(students.isActive, true)));
      } else {
        classStudentParentsRows = await baseClassStudentParentsQuery.where(and(eq(students.classId, parseInt(classId)), eq(students.isActive, true)));
      }
      const uniqueParentIds = Array.from(
        new Set(
          classStudentParentsRows
            .map((row: any) => row.parentUserId)
            .filter((parentUserId: any): parentUserId is number => parentUserId !== null && parentUserId !== undefined)
        )
      );

      const formattedDate = new Date(date).toLocaleString("fr-FR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const evaluationMessage = `Un nouveau devoir en ${resolvedSubjectName} a été programmé pour la classe de ${classRecord.name} sur le ${formattedDate}. Encouragez votre enfant à se préparer !`;

if (uniqueParentIds.length > 0) {
  const notificationsToInsert = uniqueParentIds.map((parentUserId) => ({
    userId: parentUserId,
    evaluationId: createdEvaluation.id,
    title: `Nouveau devoir publié : ${generatedName}`,
    body: evaluationMessage,
    type: 'grade',
  }));

  await db.insert(notifications).values(notificationsToInsert);
        
        for (const parentUserId of uniqueParentIds) {
  try {
    const evaluationNotificationPayload = {
      parentId: parentUserId,
      title: `Nouveau devoir à venir : ${generatedName}`,
      message: evaluationMessage,
      category: "evaluation",
      metadata: {
        target: "homework",
        evaluationId: createdEvaluation.id,
        subject: resolvedSubjectName,
        title: generatedName,
        classId,
      },
      dedupeKey: `evaluation-${createdEvaluation.id}-${parentUserId}`,
    };
    const { signature, timestamp } = signInternalPayload(evaluationNotificationPayload);
    await fetch(`${process.env.API_URL || "http://localhost:3001"}/api/internal/evaluation-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Signature": signature,
        "X-Internal-Timestamp": timestamp,
      },
      body: JSON.stringify(evaluationNotificationPayload),
    });
  } catch {
    console.error('Evaluation notification delivery failed');
  }
}
      }

      res.status(201).json(createdEvaluation);
    } catch (err: any) {
      console.error('Evaluation creation failed');
      res.status(500).json({ error: 'Failed to create assessment' });
    }
  });

  app.post('/api/evaluation-participations', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });
      if (!['super_admin', 'school_admin', 'teacher'].includes(actor.role)) return res.status(403).json({ error: 'Forbidden' });

      const { evaluationId, studentId, status } = req.body ?? {};
      const parsedEvaluationId = Number(evaluationId);
      const parsedStudentId = Number(studentId);
      const normalizedStatus = typeof status === 'string' ? status : 'pending';

      if (!Number.isFinite(parsedEvaluationId) || !Number.isFinite(parsedStudentId)) {
        return res.status(400).json({ error: 'evaluationId and studentId are required' });
      }

      const [evaluation] = await db.select().from(evaluations).where(eq(evaluations.id, parsedEvaluationId));
      if (!evaluation) {
        return res.status(404).json({ error: 'Evaluation not found' });
      }

      const [student] = await db.select({ id: students.id, classId: students.classId, schoolId: students.schoolId, isActive: students.isActive }).from(students).where(eq(students.id, parsedStudentId));
      if (!student || student.isActive !== true || student.classId !== evaluation.classId) {
        return res.status(403).json({ error: 'Student must be active and belong to the evaluation class' });
      }
      if (actor.role !== 'super_admin' && (actor.schoolId == null || student.schoolId !== actor.schoolId || evaluation.schoolId !== actor.schoolId)) {
        return res.status(403).json({ error: 'Participation is outside the actor school scope' });
      }
      if (actor.role !== 'super_admin' && !(await isApprovedSubjectForSchool(evaluation.subject, actor.schoolId!, evaluation.subjectId ?? null))) {
        return res.status(403).json({ error: 'Evaluation subject is outside the actor school scope' });
      }
      if (actor.role !== 'super_admin' && !(await isApprovedClassForSchool(evaluation.classId, actor.schoolId))) {
        return res.status(403).json({ error: 'Evaluation class is outside the actor school scope' });
      }
      if (actor.role === 'teacher') {
        const scope = await getTeacherAuthorizationScope(actor);
        if (!scope || !canTeacherWriteEvaluation(scope, evaluation)) {
          return res.status(403).json({ error: 'Teacher is not authorized for this evaluation' });
        }
      }

      await db.execute(sql`
        INSERT INTO evaluation_participations (evaluation_id, student_id, status, created_at, updated_at)
        VALUES (${parsedEvaluationId}, ${parsedStudentId}, ${normalizedStatus}, NOW(), NOW())
        ON CONFLICT (evaluation_id, student_id)
        DO UPDATE SET status = ${normalizedStatus}, updated_at = NOW()
      `);

      const studentRows = await db.select().from(students).where(and(
        eq(students.classId, evaluation.classId),
        eq(students.schoolId, evaluation.schoolId!),
        eq(students.isActive, true),
      ));
      const participationRows = await db.select().from(evaluationParticipations).where(eq(evaluationParticipations.evaluationId, parsedEvaluationId));
      const completedCount = participationRows.filter((row: any) => row.status === 'graded' || row.status === 'absent').length;
      const eligibleCount = studentRows.length;

      if (eligibleCount > 0 && completedCount >= eligibleCount) {
        await db.delete(notifications).where(
          and(
            eq(notifications.evaluationId, parsedEvaluationId),
            eq(notifications.type, 'info')
          ) as any
        );
      }

      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('ERROR /api/evaluation-participations', err);
      return res.status(500).json({ error: 'Failed to update evaluation participation' });
    }
  });

  // Grades entry or update - Filtered by school
  app.get('/api/grades', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });

      let childStudentIds: number[] = [];
      let query = db
        .select({
          id: grades.id,
          evaluationId: grades.evaluationId,
          classId: evaluations.classId,
          evaluationSchoolId: evaluations.schoolId,
          evaluationTitle: evaluations.title,
          evaluationDate: evaluations.date,
          subjectId: evaluations.subjectId,
          subject: sql<string>`COALESCE(${subjects.name}, ${evaluations.subject})`,
          studentId: grades.studentId,
          studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
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
        .innerJoin(evaluations, eq(grades.evaluationId, evaluations.id))
        .leftJoin(subjects, eq(evaluations.subjectId, subjects.id));

      if (actor.role !== 'super_admin') {
        if (actor.role === 'parent') {
          childStudentIds = await getParentChildStudentIds(actor.id);
          if (childStudentIds.length === 0) {
            return res.json([]);
          }

          query = query.where(inArray(grades.studentId, childStudentIds)) as any;
        } else if (actor.role === 'teacher') {
          const scope = await getTeacherAuthorizationScope(actor);
          if (!scope) return res.json([]);
          const readableClassIds = Array.from(new Set([...scope.teachingClassIds, ...scope.homeroomClassIds]));
          if (readableClassIds.length === 0) return res.json([]);
          query = query.where(and(
            eq(students.schoolId, scope.schoolId),
            eq(evaluations.schoolId, scope.schoolId),
            inArray(evaluations.classId, readableClassIds),
          )) as any;
        } else {
          if (actor.role !== 'school_admin' || actor.schoolId == null) return res.json([]);
          query = query.where(and(
            eq(students.schoolId, actor.schoolId),
            eq(evaluations.schoolId, actor.schoolId),
          )) as any;
        }
      }

      let list = await query;
      if (actor.role === 'teacher') {
        const scope = await getTeacherAuthorizationScope(actor);
        if (!scope) return res.json([]);
        list = list.filter((grade) => canTeacherReadEvaluation(scope, {
          schoolId: grade.evaluationSchoolId,
          classId: grade.classId,
          subjectId: grade.subjectId,
          subject: grade.subject,
        }));
      }
      if (actor.role !== 'parent' || list.length === 0) {
        return res.json(list);
      }

      const evaluationIds = Array.from(new Set(list.map((grade) => grade.evaluationId)));
      const evaluationScoreRows = await db
        .select({
          evaluationId: grades.evaluationId,
          score: grades.score,
          maxScore: evaluations.maxScore,
        })
        .from(grades)
        .innerJoin(evaluations, eq(grades.evaluationId, evaluations.id))
        .where(inArray(grades.evaluationId, evaluationIds));
      const scoreBounds = calculateEvaluationScoreBounds(evaluationScoreRows);

      return res.json(list.map((grade) => ({
        ...grade,
        evaluationMinimumScore: scoreBounds.get(grade.evaluationId)?.minimum ?? null,
        evaluationMaximumScore: scoreBounds.get(grade.evaluationId)?.maximum ?? null,
      })));
    } catch (err: any) {
      console.error('Error fetching grades list:', err);
      res.status(500).json({ error: 'Failed to fetch grades list' });
    }
  });

  app.post('/api/grades', requireAuth, async (req: AuthRequest, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });
      if (actor.role === 'parent') {
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
      let isGradeModification = false;

      // Load the evaluation to verify permissions and existence
      const [evaluation] = await db.select().from(evaluations).where(eq(evaluations.id, parseInt(evaluationId)));
      if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });
      if (actor.role !== 'super_admin' && (actor.schoolId == null || evaluation.schoolId !== actor.schoolId)) {
        return res.status(403).json({ error: 'Evaluation is outside the actor school scope' });
      }

      const evaluationDate = String(evaluation.date || '');
      const plannedDate = new Date(evaluationDate);
      if (evaluationDate && Number.isNaN(plannedDate.getTime())) {
        return res.status(400).json({ error: 'Date du devoir invalide' });
      }
      if (evaluationDate && plannedDate.getTime() > Date.now()) {
        return res.status(400).json({ error: `La saisie des notes n'est pas encore possible : la date prévue du devoir (${evaluationDate}) n'est pas atteinte.` });
      }

      const scoreValidation = validateGradeScore(normalizedScore, evaluation.maxScore);
      if (!scoreValidation.isValid) {
        return res.status(400).json({ error: scoreValidation.error });
      }

      // Load the student to check their school
      const [student] = await db.select().from(students).where(eq(students.id, parseInt(studentId)));
      if (!student) return res.status(404).json({ error: 'Student not found' });
      if (student.isActive !== true || student.classId !== evaluation.classId) {
        return res.status(403).json({ error: 'Student must be active and belong to the evaluation class' });
      }
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
            error: `Impossible de créer une note pour ${student.lastName} ${student.firstName}: cet élève n'était pas encore inscrit au moment de la création du devoir (${evaluation.createdAt || evaluation.date})`
          });
        }
      }

      // School admin can only record grades for students in their own school
      if (actor.role === 'school_admin') {
        if (actor.schoolId == null || student.schoolId !== actor.schoolId) {
          return res.status(403).json({ error: 'Cannot record grade for student in another school' });
        }
      }

      // Teachers can record grades only for an assigned class and matching subject.
      if (actor.role === 'teacher') {
        const scope = await getTeacherAuthorizationScope(actor);
        if (!scope || !canTeacherWriteEvaluation(scope, evaluation)) {
          return res.status(403).json({ error: 'Vous n’êtes pas autorisé à noter cette évaluation' });
        }
        if (student.classId !== evaluation.classId) {
          return res.status(403).json({ error: 'Vous ne pouvez pas noter un élève d’une autre classe' });
        }
        if (actor.schoolId == null || student.schoolId !== actor.schoolId) {
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

      let savedGrade;
      if (existing.length > 0) {
        if (actor.role === 'teacher') {
          const message = 'Cette note a déjà été saisie. Pour toute modification, veuillez contacter le school admin.';
          return res.status(403).json({ error: message });
        }
        isGradeModification = true;

        const updated = await db
          .update(grades)
          .set({ score: String(score), remarks, editCount: (existing[0].editCount ?? 0) + 1 })
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

      // Notification mobile parent après création de la note
      try {
        const [studentRecord] = await db
          .select()
          .from(students)
          .where(eq(students.id, parseInt(studentId)));

        if (studentRecord?.parentId) {
          const [parentRecord] = await db
            .select()
            .from(parents)
            .where(eq(parents.id, studentRecord.parentId));

          if (parentRecord?.userId) {
            const gradeNotificationPayload = {
              parentId: parentRecord.userId,
              title: isGradeModification
                ? "Note modifiée"
                : "Nouvelle note disponible",
              message: buildGradeNotificationMessage({
                studentName: studentRecord.firstName,
                score,
                maxScore: evaluation.maxScore,
                subjectName: evaluation.subject.toLowerCase(),
                evaluationName: evaluation.title,
              }),
              category: "grade",
              metadata: {
                target: "notes",
                gradeId: savedGrade.id,
                eventVersion: savedGrade.editCount ?? 0,
                studentId,
                evaluationId,
                isGradeModification,
              },
              dedupeKey: getGradeNotificationDedupeKey(savedGrade.id, savedGrade.editCount ?? 0),
            };
            const { signature, timestamp } = signInternalPayload(gradeNotificationPayload);
            const response = await fetch(`${process.env.API_URL || "http://localhost:3001"}/api/internal/grade-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Internal-Signature": signature,
                "X-Internal-Timestamp": timestamp,
              },
              body: JSON.stringify(gradeNotificationPayload),
            });
            if (!response.ok) {
              throw new Error(`Grade notification service returned HTTP ${response.status}`);
            }
          }
        }
      } catch (notificationError) {
        console.error('Grade notification delivery failed');
      }

      let totalStudentsInClass: Array<{ count: number }>; 
      if (actor.role === 'super_admin') {
        totalStudentsInClass = await db
          .select({ count: sql<number>`count(*)::integer` })
          .from(students)
          .where(eq(students.classId, evaluation.classId));
      } else if (actor.role === 'teacher') {
        const authorizedIds = await studentAccess.getAuthorizedStudentIds(actor as any, { classIds: [evaluation.classId] });
        if (!authorizedIds || authorizedIds.length === 0) {
          totalStudentsInClass = [{ count: 0 }];
        } else {
          totalStudentsInClass = await db
            .select({ count: sql<number>`count(*)::integer` })
            .from(students)
            .where(inArray(students.id, authorizedIds));
        }
      } else if (actor.role === 'school_admin') {
        totalStudentsInClass = await db
          .select({ count: sql<number>`count(*)::integer` })
          .from(students)
          .where(and(eq(students.classId, evaluation.classId), eq(students.schoolId, actor.schoolId)));
      } else {
        totalStudentsInClass = await db
          .select({ count: sql<number>`count(*)::integer` })
          .from(students)
          .where(eq(students.classId, evaluation.classId));
      }

      const totalGradesForEvaluation = await db
        .select({ count: sql<number>`count(*)::integer` })
        .from(grades)
        .where(eq(grades.evaluationId, parseInt(evaluationId)));

      if (
        totalStudentsInClass[0]?.count != null &&
        totalGradesForEvaluation[0]?.count != null &&
        totalGradesForEvaluation[0].count === totalStudentsInClass[0].count
      ) {
        await db.delete(notifications).where(
          and(
            eq(notifications.evaluationId, parseInt(evaluationId)),
            eq(notifications.type, 'grade')
          )
        );
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
        title: isGradeModification
          ? `Note modifiée pour ${student.firstName}`
          : `Nouvelle note pour ${student.firstName}`,

        body: buildGradeNotificationMessage({
              studentName: student.firstName,
              score,
              maxScore: evaluationRecord.maxScore,
              subjectName: evaluationRecord.subject,
              evaluationName: evaluationRecord.title,
            }),
        type: 'grade',
      });
        }
      }

      res.status(200).json(savedGrade);
    } catch (err: any) {
      console.error('POST /api/grades error:', err);
      console.error(err?.stack || err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/evaluations', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'parent' || actor.role === 'teacher') return res.status(403).json({ error: 'Forbidden' });
      if (actor.role !== 'super_admin' && actor.role !== 'school_admin') return res.status(403).json({ error: 'Forbidden' });

      let evaluationIds: number[] = [];
      if (actor.role === 'super_admin') {
        const rows = await db.select({ id: evaluations.id }).from(evaluations);
        evaluationIds = rows.map((row) => row.id);
      } else if (actor.role === 'school_admin') {
        const rows = await db
          .select({ id: evaluations.id })
          .from(evaluations)
          .where(eq(evaluations.schoolId, actor.schoolId!));
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

  app.get('/api/admin/login-stats', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor || actor.role !== 'super_admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const [totalsRows, dailyResult, roleRows] = await Promise.all([
        db.select({
          totalLogins: sql<number>`count(*)::integer`,
          uniqueUsers: sql<number>`count(distinct ${userLoginEvents.userId})::integer`,
          webLogins: sql<number>`count(*) filter (where ${userLoginEvents.clientType} = 'web')::integer`,
          androidLogins: sql<number>`count(*) filter (where ${userLoginEvents.clientType} = 'android')::integer`,
        }).from(userLoginEvents).where(sql`${userLoginEvents.loginAt} >= current_date - interval '29 days'`),
        db.execute(sql`
          with daily as (
            select
              ${userLoginEvents.loginAt}::date as login_date,
              count(*)::integer as total,
              count(*) filter (where ${userLoginEvents.clientType} = 'web')::integer as web,
              count(*) filter (where ${userLoginEvents.clientType} = 'android')::integer as android
            from ${userLoginEvents}
            where ${userLoginEvents.loginAt} >= current_date - interval '29 days'
            group by ${userLoginEvents.loginAt}::date
          )
          select
            to_char(days.day::date, 'YYYY-MM-DD') as date,
            coalesce(daily.total, 0)::integer as total,
            coalesce(daily.web, 0)::integer as web,
            coalesce(daily.android, 0)::integer as android
          from generate_series(
            current_date - interval '29 days',
            current_date,
            interval '1 day'
          ) as days(day)
          left join daily on daily.login_date = days.day::date
          order by days.day
        `),
        db.select({
          role: userLoginEvents.role,
          total: sql<number>`count(*)::integer`,
        }).from(userLoginEvents)
          .where(sql`${userLoginEvents.loginAt} >= current_date - interval '29 days'`)
          .groupBy(userLoginEvents.role)
          .orderBy(userLoginEvents.role),
      ]);

      const totals = totalsRows[0] ?? { totalLogins: 0, uniqueUsers: 0, webLogins: 0, androidLogins: 0 };
      res.json({
        totalLogins: Number(totals.totalLogins ?? 0),
        uniqueUsers: Number(totals.uniqueUsers ?? 0),
        webLogins: Number(totals.webLogins ?? 0),
        androidLogins: Number(totals.androidLogins ?? 0),
        loginsByDay: dailyResult.rows.map((row: any) => ({
          date: String(row.date),
          total: Number(row.total ?? 0),
          web: Number(row.web ?? 0),
          android: Number(row.android ?? 0),
        })),
        loginsByRole: roleRows.map((row) => ({
          role: row.role,
          total: Number(row.total ?? 0),
        })),
      });
    } catch (err: any) {
      console.error('Failed fetching login statistics:', err?.message || err);
      res.status(500).json({ error: 'Failed to retrieve login statistics' });
    }
  });

  // Dashboard summary - Filtered by school
  app.get('/api/dashboard/summary', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });

      // Build filter condition based on user role
      let schoolFilter: any = undefined;
      let parentChildIds: number[] | null = null;
      let teacherClassIds: number[] | null = null;
      let teacherScope: Awaited<ReturnType<typeof getTeacherAuthorizationScope>> = null;
      let teacherAssignmentIds: number[] = [];
      if (actor.role !== 'super_admin' && actor.schoolId) {
        schoolFilter = actor.schoolId;
      }

      if (actor.role === 'teacher') {
        teacherScope = await getTeacherAuthorizationScope(actor);
        teacherClassIds = teacherScope
          ? Array.from(new Set([...teacherScope.teachingClassIds, ...teacherScope.homeroomClassIds]))
          : [];
        const assignmentContext = await getTeacherTeachingAssignmentContext(actor);
        teacherAssignmentIds = assignmentContext?.assignments.map((assignment) => assignment.id) ?? [];
      }

      let parentProfile: { id: number; studentId?: number | null } | null = null;
      if (actor.role === 'parent') {
        parentChildIds = await getParentChildStudentIds(actor.id);
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

      if (actor.role === 'parent') {
        if (!parentChildIds || parentChildIds.length === 0) {
          return res.json({ stats: { totalStudents: 0, totalAbsences: 0, totalClasses: 0, attendanceRate: 100, maleStudents: 0, femaleStudents: 0 }, recentAbsences: [], recentGrades: [], absenceStatusCounts: { justified: 0, unjustified: 0, pending: 0, declared: 0 } });
        }

        studentCountQuery = studentCountQuery.where(and(eq(students.isActive, true), inArray(students.id, parentChildIds))) as any;
        studentGenderQuery = studentGenderQuery.where(and(eq(students.isActive, true), inArray(students.id, parentChildIds))) as any;
        chartStudentsQuery = chartStudentsQuery.where(inArray(students.id, parentChildIds)) as any;
        chartClassesQuery = db
          .selectDistinct({ id: classes.id, name: classes.name })
          .from(classes)
          .innerJoin(students, eq(classes.id, students.classId))
          .where(inArray(students.id, parentChildIds)) as any;
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
      } else if (actor.role === 'teacher') {
        if (!teacherClassIds || teacherClassIds.length === 0) {
          return res.json({ stats: { totalStudents: 0, totalAbsences: 0, totalClasses: 0, attendanceRate: 100, maleStudents: 0, femaleStudents: 0 }, recentAbsences: [], recentGrades: [], absenceStatusCounts: { justified: 0, unjustified: 0, pending: 0, declared: 0 } });
        }

        const authorizedStudentIds = teacherScope
          ? await getScopedTeacherReadableStudentIds(teacherScope, teacherClassIds)
          : [];
        if (authorizedStudentIds.length === 0) {
          return res.json({ stats: { totalStudents: 0, totalAbsences: 0, totalClasses: 0, attendanceRate: 100, maleStudents: 0, femaleStudents: 0 }, recentAbsences: [], recentGrades: [], absenceStatusCounts: { justified: 0, unjustified: 0, pending: 0, declared: 0 } });
        }

        studentCountQuery = studentCountQuery.where(and(eq(students.isActive, true), inArray(students.id, authorizedStudentIds))) as any;
        studentGenderQuery = studentGenderQuery.where(and(eq(students.isActive, true), inArray(students.id, authorizedStudentIds))) as any;
        chartStudentsQuery = chartStudentsQuery.where(inArray(students.id, authorizedStudentIds)) as any;
        chartAbsencesQuery = db
          .select({ classId: absences.classId })
          .from(absences)
          .innerJoin(students, eq(absences.studentId, students.id))
          .where(and(
            teacherAssignmentIds.length > 0
              ? inArray(absences.teachingAssignmentId, teacherAssignmentIds)
              : sql`false`,
            eq(students.schoolId, actor.schoolId!),
          )) as any;
        classCountQuery = db
          .select({ count: sql<number>`count(*)::integer` })
          .from(classes)
          .where(inArray(classes.id, teacherClassIds)) as any;
        chartClassesQuery = db
          .select({ id: classes.id, name: classes.name })
          .from(classes)
          .where(inArray(classes.id, teacherClassIds)) as any;
        absenceCountQuery = db
          .select({ count: sql<number>`count(*)::integer` })
          .from(absences)
          .innerJoin(students, eq(absences.studentId, students.id))
          .where(and(
            teacherAssignmentIds.length > 0
              ? inArray(absences.teachingAssignmentId, teacherAssignmentIds)
              : sql`false`,
            eq(students.schoolId, actor.schoolId!),
          )) as any;
      } else if (schoolFilter) {
        studentCountQuery = studentCountQuery.where(and(eq(students.isActive, true), eq(students.schoolId, schoolFilter))) as any;
        studentGenderQuery = studentGenderQuery.where(and(eq(students.isActive, true), eq(students.schoolId, schoolFilter))) as any;
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
      } else {
        studentCountQuery = studentCountQuery.where(eq(students.isActive, true)) as any;
        studentGenderQuery = studentGenderQuery.where(eq(students.isActive, true)) as any;
      }

      const studentCountResult = await studentCountQuery;
      const studentGenderRows = await studentGenderQuery;
      const absenceCountResult = await absenceCountQuery;
      const classCountResult = await classCountQuery;
      const chartClassesRows = await chartClassesQuery;
      const chartStudentsRows = await chartStudentsQuery;
      const chartAbsencesRows = await chartAbsencesQuery;

      let absenceStatusCountsQuery = db
        .select({
          justified: sql<number>`count(case when ${absences.justificationStatus} = 'APPROVED' or (${absences.justificationStatus} is null and ${absences.isJustified} = true) then 1 end)::integer`,
          unjustified: sql<number>`count(case when ${absences.justificationStatus} = 'REJECTED' or (${absences.justificationStatus} is null and ${absences.isJustified} = false and ${absences.declarationId} is null) then 1 end)::integer`,
          pending: sql<number>`count(case when ${absences.justificationStatus} = 'PENDING' then 1 end)::integer`,
          declared: sql<number>`count(case when ${absences.declarationId} is not null and ${absences.justificationStatus} is null and ${absences.isJustified} = false then 1 end)::integer`,
        })
        .from(absences);

      if (actor.role === 'parent') {
        if (!parentChildIds || parentChildIds.length === 0) {
          absenceStatusCountsQuery = db.select({ justified: sql<number>`0::integer`, unjustified: sql<number>`0::integer`, pending: sql<number>`0::integer`, declared: sql<number>`0::integer` }) as any;
        } else {
          absenceStatusCountsQuery = absenceStatusCountsQuery.where(inArray(absences.studentId, parentChildIds)) as any;
        }
      } else if (actor.role === 'teacher') {
        if (teacherAssignmentIds.length === 0) {
          absenceStatusCountsQuery = db.select({ justified: sql<number>`0::integer`, unjustified: sql<number>`0::integer`, pending: sql<number>`0::integer`, declared: sql<number>`0::integer` }) as any;
        } else {
          absenceStatusCountsQuery = db
            .select({
              justified: sql<number>`count(case when ${absences.justificationStatus} = 'APPROVED' or (${absences.justificationStatus} is null and ${absences.isJustified} = true) then 1 end)::integer`,
              unjustified: sql<number>`count(case when ${absences.justificationStatus} = 'REJECTED' or (${absences.justificationStatus} is null and ${absences.isJustified} = false and ${absences.declarationId} is null) then 1 end)::integer`,
              pending: sql<number>`count(case when ${absences.justificationStatus} = 'PENDING' then 1 end)::integer`,
              declared: sql<number>`count(case when ${absences.declarationId} is not null and ${absences.justificationStatus} is null and ${absences.isJustified} = false then 1 end)::integer`,
            })
            .from(absences)
            .innerJoin(students, eq(absences.studentId, students.id))
            .where(and(
              inArray(absences.teachingAssignmentId, teacherAssignmentIds),
              eq(students.schoolId, actor.schoolId!),
            )) as any;
        }
      } else if (schoolFilter) {
        absenceStatusCountsQuery = db
          .select({
            justified: sql<number>`count(case when ${absences.justificationStatus} = 'APPROVED' or (${absences.justificationStatus} is null and ${absences.isJustified} = true) then 1 end)::integer`,
            unjustified: sql<number>`count(case when ${absences.justificationStatus} = 'REJECTED' or (${absences.justificationStatus} is null and ${absences.isJustified} = false and ${absences.declarationId} is null) then 1 end)::integer`,
            pending: sql<number>`count(case when ${absences.justificationStatus} = 'PENDING' then 1 end)::integer`,
            declared: sql<number>`count(case when ${absences.declarationId} is not null and ${absences.justificationStatus} is null and ${absences.isJustified} = false then 1 end)::integer`,
          })
          .from(absences)
          .innerJoin(students, eq(absences.studentId, students.id))
          .where(eq(students.schoolId, schoolFilter)) as any;
      }

      const absenceStatusCountsResult = await absenceStatusCountsQuery;
      const absenceStatusCounts = {
        justified: Number(absenceStatusCountsResult[0]?.justified || 0),
        unjustified: Number(absenceStatusCountsResult[0]?.unjustified || 0),
        pending: Number(absenceStatusCountsResult[0]?.pending || 0),
        declared: Number(absenceStatusCountsResult[0]?.declared || 0),
      };

      const totalStudents = studentCountResult[0]?.count || 0;
      const genderCounts = studentGenderRows.reduce((acc, row) => {
        const normalized = normalizeGenderValue(row.gender);
        if (normalized === 'male') acc.maleStudents += 1;
        else if (normalized === 'female') acc.femaleStudents += 1;
        return acc;
      }, { maleStudents: 0, femaleStudents: 0 });
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

      // Calculate attendance rate (simplified)
      const attendanceRate = totalStudents > 0 && totalAbsences > 0 ? 
        Math.max(0, 100 - (totalAbsences / (totalStudents * 20) * 100)) : 100;

      // Get recent absences
      let recentAbsencesQuery = db
        .select({
          id: absences.id,
          studentId: absences.studentId,
          studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
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

      if (actor.role === 'parent') {
        recentAbsencesQuery = recentAbsencesQuery.where(inArray(absences.studentId, parentChildIds || [])) as any;
      } else if (actor.role === 'teacher') {
        recentAbsencesQuery = recentAbsencesQuery.where(and(
          teacherAssignmentIds.length > 0
            ? inArray(absences.teachingAssignmentId, teacherAssignmentIds)
            : sql`false`,
          eq(students.schoolId, actor.schoolId!),
        )) as any;
      } else if (schoolFilter) {
        recentAbsencesQuery = recentAbsencesQuery.where(eq(students.schoolId, schoolFilter)) as any;
      }

      const recentAbsences = await recentAbsencesQuery;

      // Get recent grades
      let recentGradesQuery = db
        .select({
          id: grades.id,
          studentId: grades.studentId,
          studentName: sql<string>`concat(${students.lastName}, ' ', ${students.firstName})`,
          evaluationTitle: evaluations.title,
          classId: evaluations.classId,
          schoolId: students.schoolId,
          subjectId: evaluations.subjectId,
          subject: evaluations.subject,
          score: grades.score,
          date: evaluations.date,
        })
        .from(grades)
        .innerJoin(students, eq(grades.studentId, students.id))
        .innerJoin(evaluations, eq(grades.evaluationId, evaluations.id))
        .orderBy(desc(evaluations.date))
        .limit(5);

      if (actor.role === 'parent') {
        recentGradesQuery = recentGradesQuery.where(inArray(grades.studentId, parentChildIds || [])) as any;
      } else if (actor.role === 'teacher') {
        const authorizedStudentIds = teacherScope
          ? await getScopedTeacherReadableStudentIds(teacherScope, teacherClassIds || [])
          : [];
        recentGradesQuery = recentGradesQuery.where(and(
          inArray(grades.studentId, authorizedStudentIds),
          eq(students.schoolId, actor.schoolId!),
        )) as any;
      } else if (schoolFilter) {
        recentGradesQuery = recentGradesQuery.where(eq(students.schoolId, schoolFilter)) as any;
      }

      let recentGrades = await recentGradesQuery;
      if (schoolFilter != null) {
        recentGrades = recentGrades.filter((grade) => grade.schoolId === schoolFilter);
      }
      if (actor.role === 'teacher' && teacherScope) {
        recentGrades = recentGrades.filter((grade) => canTeacherReadEvaluation(teacherScope!, grade));
      }

      const stats = {
        totalStudents,
        totalAbsences,
        totalClasses,
        attendanceRate: Math.round(attendanceRate * 100) / 100,
        maleStudents: genderCounts.maleStudents,
        femaleStudents: genderCounts.femaleStudents,
      };

      res.json({
        stats,
        recentAbsences,
        recentGrades,
        chartData,
        absenceStatusCounts,
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

      const actor = await resolveActor(req);
      if (!actor) return res.json([]);

      if (actor.role === 'teacher' || actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });

      const userNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, actor.id))
        .orderBy(desc(notifications.id));

      if (userNotifications.length === 0) {
        return res.json([]);
      }

      const notificationIds = userNotifications.map((notification) => notification.id);
      const attachmentRows = notificationIds.length > 0
        ? await db.select().from(notificationAttachments).where(inArray(notificationAttachments.notificationId, notificationIds))
        : [];

      const attachmentsByNotificationId = attachmentRows.reduce((acc: Record<number, any[]>, attachment) => {
        const key = Number(attachment.notificationId);
        if (!acc[key]) acc[key] = [];
        acc[key].push({
          id: attachment.id,
          notificationId: attachment.notificationId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: attachment.fileSize,
          uploadedBy: attachment.uploadedBy,
          uploadedAt: attachment.uploadedAt,
        });
        return acc;
      }, {} as Record<number, any[]>);

      res.json(userNotifications.map((notification) => ({
        ...notification,
        attachments: attachmentsByNotificationId[notification.id] ?? [],
      })));
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load notifications feed' });
    }
  });

  app.get('/api/notifications/:notificationId/attachments/:attachmentId', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const notificationId = parseInt(req.params.notificationId, 10);
      const attachmentId = parseInt(req.params.attachmentId, 10);
      if (!Number.isFinite(notificationId) || !Number.isFinite(attachmentId)) {
        return res.status(400).json({ error: 'Invalid notification or attachment id' });
      }

      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });

      const [notification] = await db.select().from(notifications).where(eq(notifications.id, notificationId));
      if (!notification) return res.status(404).json({ error: 'Notification not found' });

      const [attachment] = await db.select().from(notificationAttachments)
        .where(and(eq(notificationAttachments.id, attachmentId), eq(notificationAttachments.notificationId, notificationId)));
      if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

      const [recipient] = await db.select({ id: users.id, schoolId: users.schoolId }).from(users).where(eq(users.id, notification.userId));
      const isOwner = notification.userId === actor.id;
      const isSchoolAdminAllowed = actor.role === 'school_admin' && actor.schoolId != null && recipient?.schoolId === actor.schoolId;
      const isSuperAdminAllowed = actor.role === 'super_admin';
      if (!isOwner && !isSchoolAdminAllowed && !isSuperAdminAllowed) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const storedReference = String(attachment.filePath || '');
      const sent = await streamStoredFileToResponse(storedReference, 'notification-attachments', attachment.fileName, attachment.mimeType || 'application/octet-stream', res as any);
      if (!sent) {
        return res.status(404).json({ error: 'Attachment file not found on disk' });
      }
      return undefined;
    } catch (err: any) {
      console.error('Failed to download notification attachment:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Mark all user notifications as read
  app.put('/api/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

      const actor = await resolveActor(req);
      if (actor) {
        if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });
        await db
          .update(notifications)
          .set({ isRead: true })
          .where(eq(notifications.userId, actor.id));
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to clean notifications status' });
    }
  });

  // Mark a single notification as read (only for the owning user)
  app.put('/api/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const id = parseInt(req.params.id);
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: 'User not found' });
      if (actor.role === 'surveillant') return res.status(403).json({ error: 'Forbidden' });

      // Only allow marking notifications that belong to the actor
      const updated = await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.id, id), eq(notifications.userId, actor.id)));

      res.json({ success: true, updated: (updated ?? 0) });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  // Send system-wide / simulated push notice
  app.post('/api/notifications/send', requireAuth, handleNotificationUpload, async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const rawBody = req.body ?? {};
      const { title, body, type, userId, classId } = rawBody;
      if (!title || !body || !type) return res.status(400).json({ error: 'Missing keys' });

      const uploadedFiles = Array.isArray((req as any).notificationFiles) ? (req as any).notificationFiles as any[] : [];
      let notificationAttachmentsCommitted = false;

      const cleanupAndRethrow = async (err: any) => {
        if (!notificationAttachmentsCommitted) {
          try {
            await cleanupUploadedNotificationFiles(uploadedFiles);
          } catch (cleanupErr) {
            console.warn('Notification attachment cleanup failed after DB error:', cleanupErr);
          }
        }
        throw err;
      };

      const rejectAfterUpload = async (status: number, error: string) => {
        await cleanupUploadedNotificationFiles(uploadedFiles);
        return res.status(status).json({ error });
      };

      const actor = await resolveActor(req);
      if (!actor) return rejectAfterUpload(404, 'User not found');
      if (!['super_admin', 'school_admin'].includes(actor.role)) return rejectAfterUpload(403, 'Forbidden');
      if (actor.role === 'school_admin' && actor.schoolId == null) {
        return rejectAfterUpload(403, 'Forbidden: missing school context');
      }

      let targetUserIds: number[] = [];

      const resolveActiveParentUserIds = async (options?: { classId?: number; schoolId?: number }) => {
        const conditions = [eq(students.isActive, true)];
        if (options?.classId != null) conditions.push(eq(students.classId, options.classId));
        if (options?.schoolId != null) conditions.push(eq(students.schoolId, options.schoolId));
        const activeParents = await db
          .selectDistinct({ userId: parents.userId })
          .from(students)
          .innerJoin(parents, and(
            eq(students.parentId, parents.id),
            eq(students.schoolId, parents.schoolId),
          ))
          .where(and(...conditions));
        return Array.from(new Set(activeParents.map((parent) => parent.userId)));
      };

      if (userId && classId) return rejectAfterUpload(400, 'Choose either a parent or a class, not both');

      if (userId) {
        // Sending to specific user - validate school permission if school_admin
        const [targetUser] = await db.select().from(users).where(eq(users.id, parseInt(userId)));
        if (!targetUser) return rejectAfterUpload(404, 'Target user not found');
        
        if (actor.role === 'school_admin') {
          if (targetUser.schoolId !== actor.schoolId) {
            const membership = await ensureUserSchoolMembership(targetUser.id, actor.schoolId, targetUser.role);
            if (!membership) {
              return rejectAfterUpload(403, 'Cannot send notification to user in another school');
            }
          }
        }

        if (targetUser.role === 'parent') {
          const activeParentUserIds = await resolveActiveParentUserIds(actor.role === 'school_admin' ? { schoolId: actor.schoolId! } : undefined);
          if (!activeParentUserIds.includes(targetUser.id)) return rejectAfterUpload(403, 'Parent has no active students in this school');
        }

        targetUserIds.push(targetUser.id);
      } else if (classId) {
        const parsedClassId = parseInt(String(classId), 10);
        if (!Number.isInteger(parsedClassId)) return rejectAfterUpload(400, 'Invalid class');

        targetUserIds = await resolveActiveParentUserIds({
          classId: parsedClassId,
          ...(actor.role === 'school_admin' ? { schoolId: actor.schoolId! } : {}),
        });
      } else {
        // Send to all parents (or all parents in school if school_admin)
        targetUserIds = await resolveActiveParentUserIds(actor.role === 'school_admin' ? { schoolId: actor.schoolId! } : undefined);
      }

      try {
        for (const id of targetUserIds) {
          const [insertedNotification] = await db.insert(notifications).values({
            userId: id,
            title,
            body,
            type,
          }).returning();

          let notificationAttachmentMetadata: Array<{
            attachmentId: number;
            fileName: string;
            mimeType: string;
            fileSize: number;
          }> = [];

          if (uploadedFiles.length > 0) {
            const insertedAttachments = await db.insert(notificationAttachments).values(
              uploadedFiles.map((file: any) => ({
                notificationId: insertedNotification.id,
                fileName: file.originalname,
                filePath: file.filename,
                mimeType: file.mimetype,
                fileSize: Number(file.size),
                uploadedBy: req.user!.id!,
              }))
            ).returning({
              id: notificationAttachments.id,
              fileName: notificationAttachments.fileName,
              mimeType: notificationAttachments.mimeType,
              fileSize: notificationAttachments.fileSize,
            });
            notificationAttachmentsCommitted = insertedAttachments.length > 0;

            notificationAttachmentMetadata = insertedAttachments.map((attachment) => ({
              attachmentId: attachment.id,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              fileSize: Number(attachment.fileSize),
            }));
          }

          const infoNotificationPayload = {
            parentId: String(id),
            title,
            message: body,
            category: "info",
            metadata: {
              target: "announcement",
              notificationId: insertedNotification.id,
              attachmentCount: notificationAttachmentMetadata.length,
              attachments: notificationAttachmentMetadata,
              deepLink: "ecoletrack://dashboard",
            },
            dedupeKey: `info-${Date.now()}-${id}`,
          };
          const { signature, timestamp } = signInternalPayload(infoNotificationPayload);
          await fetch(`${process.env.API_URL || "http://localhost:3001"}/api/internal/info-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Signature": signature,
              "X-Internal-Timestamp": timestamp,
            },
            body: JSON.stringify(infoNotificationPayload),
          });
        }
      } catch (err: any) {
        await cleanupAndRethrow(err);
      }

      if (!notificationAttachmentsCommitted) {
        await cleanupUploadedNotificationFiles(uploadedFiles);
      }
      res.json({ success: true, message: `Notification successfully routed to ${targetUserIds.length} users.` });
  } catch (err: any) {
    console.error("❌ ERREUR ENVOI INFORMATION :", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // ==========================================
  // VITE DEVELOPMENT ENVIRONMENT MIDDLEWARE
  // ==========================================
  // The `/login` route is handled by the SPA (React) in client-side routing.

  if (process.env.NODE_ENV === 'development') {
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

  return app;
}

export async function startServer() {
  const PORT = 3000;
  const app = await createApp();

  console.log('Verifying if database needs seeding...');
  try {
    await ensureEducationStructureSchema();
    if (process.env.DISABLE_DEMO_SEED !== 'true') {
      await seedDatabaseIfEmpty();
    } else {
      console.log('Demo seed disabled.');
    }
    await ensureAbsenceDeclarationsSchema();
    await ensureAbsenceTeachingAssignmentsSchema();
    await ensureSchoolsTableSchema();
    await ensureStudentMatriculesSchema();
    await ensureStudentAcademicYearStatusesTableExists();
    await ensureSchoolClassesTableExists();
    await ensureClassHomeroomAssignmentsTableExists();
    await ensureUsersTableSchema();
    await ensureUserSchoolsTableExists();
    await repairMissingSchoolAdminMemberships();
  } catch (error) {
    console.error('Database initialization failed, shutting down application.', error);
    process.exit(1);
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

// Start the server automatically except during tests. Tests should import
// and use `createApp()` directly to avoid binding to network ports.
if (process.env.NODE_ENV !== 'test') {
  startServer();
}
