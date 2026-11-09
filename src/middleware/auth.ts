import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.ts';
import { localAuths, schools, userSchools, users } from '../db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { normalizeEmail, normalizedEmailSql } from '../lib/emailUniqueness.ts';
import {
  TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE,
  TEACHER_CONTROL_TEACHER_DOCUMENT_PATH,
} from '../lib/teacherControl/security.ts';
import { validateGenerationBoundAccessSession } from '../server/accessContextValidation.ts';
import { mapAccessSessionFailure, validateAccessJwtSession } from '../server/accessJwtContract.ts';
import {
  accessJwtSigner,
  generationAwareAccessSessionStore,
} from '../server/accessSessionRuntime.ts';
import type { AccessJwtClaims } from '../server/accessJwtContract.ts';
import type { VerifiedAccessContext } from '../server/verifiedAccessContext.ts';
import type { LocalSchoolRole } from '../lib/localSchoolRoles.ts';
import { isLocalSchoolRole } from '../lib/localSchoolRoles.ts';
import type { ServerResolvedContextAuthorization } from '../server/accessSessionLifecycle.ts';

export type AppRole = 'super_admin' | 'school_admin' | 'teacher' | 'parent' | 'surveillant' | 'student';

export function assertSimulatedAuthConfiguration(): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_AUTH === 'true') {
    throw new Error('ALLOW_SIMULATED_AUTH=true is not allowed when NODE_ENV=production.');
  }
}

export const mapToAppRole = (rawRole?: string | null): AppRole | undefined => {
  if (!rawRole) return undefined;
  if (
    rawRole === 'super_admin'
    || rawRole === 'school_admin'
    || rawRole === 'teacher'
    || rawRole === 'surveillant'
    || rawRole === 'parent'
    || rawRole === 'student'
  ) return rawRole;
  return undefined;
};

export interface AuthRequest extends Request {
  user?: {
    id?: number;
    uid: string;
    email?: string;
    name?: string;
    role?: string;
    appRole?: AppRole;
    schoolId?: number | null;
    accessContext?: VerifiedAccessContext | null;
    accessClaims?: AccessJwtClaims;
    simulated?: boolean;
  };
}

function isContextSelectionRequest(request: AuthRequest): boolean {
  return request.method === 'GET' && request.path === '/api/auth/schools'
    || request.method === 'POST' && (
      request.path === '/api/auth/context/active'
      || request.path === '/api/auth/schools/active'
    )
    || request.method === 'POST' && request.path === '/api/auth/change-password'
    || request.method === 'POST' && request.path === '/api/auth/logout';
}

function isContextTransitionRequest(request: AuthRequest): boolean {
  return request.method === 'GET' && request.path === '/api/auth/schools'
    || request.method === 'POST' && (
      request.path === '/api/auth/context/active'
      || request.path === '/api/auth/schools/active'
    );
}

function teacherDocumentCookieToken(request: AuthRequest): string | null {
  if (request.method !== 'GET' || request.path !== TEACHER_CONTROL_TEACHER_DOCUMENT_PATH) return null;
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return null;
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE.length + 1)) || null;
  } catch {
    return null;
  }
}

function clearTeacherDocumentCookie(response: Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.append('Set-Cookie', [
    `${TEACHER_CONTROL_DOCUMENT_AUTH_COOKIE}=`,
    `Path=${TEACHER_CONTROL_TEACHER_DOCUMENT_PATH}`,
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
  ].join('; ') + secure);
}

export const verifyToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowSimulatedAuth = !isProduction
    && (process.env.NODE_ENV === 'test' || process.env.ALLOW_SIMULATED_AUTH === 'true');
  const authHeader = req.headers.authorization;
  const documentCookieToken = authHeader ? null : teacherDocumentCookieToken(req);
  if (documentCookieToken) clearTeacherDocumentCookie(res);
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : documentCookieToken;

  const simulatedRoleHeader = req.headers['x-simulated-role'];
  const simulatedRole = typeof simulatedRoleHeader === 'string'
    ? simulatedRoleHeader
    : Array.isArray(simulatedRoleHeader)
      ? simulatedRoleHeader[0]
      : undefined;
  const simulatedUidHeader = req.headers['x-simulated-uid'];
  const simulatedUid = typeof simulatedUidHeader === 'string'
    ? simulatedUidHeader
    : Array.isArray(simulatedUidHeader)
      ? simulatedUidHeader[0]
      : undefined;
  const simulatedEmailHeader = req.headers['x-simulated-email'];
  const simulatedEmail = typeof simulatedEmailHeader === 'string'
    ? simulatedEmailHeader
    : Array.isArray(simulatedEmailHeader)
      ? simulatedEmailHeader[0]
      : undefined;
  const simulatedNameHeader = req.headers['x-simulated-name'];
  const simulatedName = typeof simulatedNameHeader === 'string'
    ? simulatedNameHeader
    : Array.isArray(simulatedNameHeader)
      ? simulatedNameHeader[0]
      : undefined;
  const simulatedSchoolIdHeader = req.headers['x-simulated-school-id'];
  const simulatedSchoolId = typeof simulatedSchoolIdHeader === 'string'
    ? Number(simulatedSchoolIdHeader)
    : Array.isArray(simulatedSchoolIdHeader)
      ? Number(simulatedSchoolIdHeader[0])
      : null;

  if (!token) {
    if (!allowSimulatedAuth) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    if (simulatedRole) {
      const simulatedUid = simulatedUidHeader
        ? Array.isArray(simulatedUidHeader) ? simulatedUidHeader[0] : simulatedUidHeader
        : `sim_${simulatedRole}_123`;
      const [simulatedUidUser] = await db.select({ id: users.id, isDeleted: users.isDeleted })
        .from(users)
        .where(eq(users.uid, simulatedUid));
      const normalizedSimulatedEmail = normalizeEmail(simulatedEmail);
      const [simulatedEmailUser] = normalizedSimulatedEmail
        ? await db.select({ id: users.id, isDeleted: users.isDeleted })
          .from(users)
          .where(eq(normalizedEmailSql(users.email), normalizedSimulatedEmail))
        : [];
      if (simulatedUidUser?.isDeleted || simulatedEmailUser?.isDeleted) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      req.user = {
        uid: simulatedUid,
        email: simulatedEmail || `${simulatedRole}@ecoletrack.fr`,
        name: simulatedName || 'Utilisateur simulé',
        role: simulatedRole,
        appRole: mapToAppRole(simulatedRole),
        schoolId: Number.isFinite(simulatedSchoolId) ? simulatedSchoolId : null,
        simulated: true,
      };
      return next();
    }

    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  try {
    const verification = accessJwtSigner.verify(token);
    if (verification.valid === false) {
      if (verification.reason === 'invalid_configuration') {
        return res.status(503).json({
          error: 'Web access-token verification is not configured.',
          code: 'ACCESS_TOKEN_VERIFICATION_UNAVAILABLE',
        });
      }
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    const claims = verification.claims;
    const userId = Number(claims.sub);
    const [snapshot, dbUser] = await Promise.all([
      generationAwareAccessSessionStore.loadWithGeneration(claims.sid),
      db.select().from(users).where(eq(users.id, userId)).then((rows) => rows[0]),
    ]);

    if (!dbUser) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    if (dbUser.isDeleted) {
      if (dbUser.role === 'parent') {
        return res.status(401).json({
          error: 'Ce compte est désactivé. Contactez votre administrateur.',
          code: 'ACCOUNT_DISABLED',
        });
      }
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    if (dbUser.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    if (!snapshot) {
      return res.status(401).json({ error: 'Unauthorized: Access session not found' });
    }

    const nowEpochMs = Date.now();
    const sessionValidation = validateGenerationBoundAccessSession({
      identity: { userId },
      session: snapshot.session,
      claims: {
        userId,
        sessionId: claims.sid,
        contextVersion: claims.cv,
      },
      currentGeneration: snapshot.currentGeneration,
      nowEpochMs,
    });
    if (sessionValidation.valid === false) {
      if (sessionValidation.reason === 'stale_generation') {
        return res.status(401).json({ error: 'Unauthorized: Token revoked' });
      }
      if (sessionValidation.reason === 'invalid_generation') {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }
      const failure = mapAccessSessionFailure(
        sessionValidation.reason === 'stale_context'
          ? 'stale_context'
          : sessionValidation.reason,
      );
      return res.status(failure.status).json({
        error: 'Unauthorized: Access session invalid',
        code: failure.code,
      });
    }

    const activeContext = snapshot.session.context;
    let authorization: ServerResolvedContextAuthorization | undefined;
    let activeRole: string | undefined;
    let activeSchoolId: number | null = null;
    const isTransitionRequest = isContextTransitionRequest(req);
    if (isTransitionRequest) {
      // Selection endpoints authenticate identity and session, then resolve the
      // requested context independently from server-side membership data.
    } else if (activeContext === null) {
      if (!isContextSelectionRequest(req)) {
        return res.status(403).json({
          error: 'Select an access context before continuing.',
          code: 'ACCESS_CONTEXT_REQUIRED',
        });
      }
    } else if (activeContext.kind === 'global') {
      authorization = {
        kind: 'global',
        serverResolvedGlobalRole: dbUser.role,
      };
      activeRole = 'super_admin';
    } else {
      const { userId: contextUserId } = activeContext.identity;
      const { schoolId, role } = activeContext.active;
      const membershipId = activeContext.membershipId;
      if (
        contextUserId !== dbUser.id
        || !Number.isSafeInteger(membershipId)
        || !isLocalSchoolRole(role)
      ) {
        return res.status(403).json({
          error: 'The active access context is invalid.',
          code: 'ACCESS_MEMBERSHIP_NOT_FOUND',
        });
      }

      const [membership] = await db.select({
        membershipId: userSchools.id,
        userId: userSchools.userId,
        schoolId: userSchools.schoolId,
        role: userSchools.role,
        isActive: userSchools.isActive,
      }).from(userSchools).where(and(
        eq(userSchools.id, membershipId),
        eq(userSchools.userId, dbUser.id),
        eq(userSchools.schoolId, schoolId),
        eq(userSchools.role, role),
      )).limit(1);
      if (!membership || !isLocalSchoolRole(membership.role)) {
        return res.status(403).json({
          error: 'The active school membership is no longer available.',
          code: 'ACCESS_MEMBERSHIP_NOT_FOUND',
        });
      }

      const [school] = await db.select({
        id: schools.id,
        isSuspended: schools.isSuspended,
      }).from(schools).where(eq(schools.id, schoolId)).limit(1);
      if (!school || school.isSuspended) {
        return res.status(423).json({
          error: 'The active school is unavailable.',
          code: school?.isSuspended ? 'SCHOOL_SUSPENDED' : 'SCHOOL_NOT_FOUND',
        });
      }

      authorization = {
        kind: 'local',
        membership: {
          membershipId: membership.membershipId,
          userId: membership.userId,
          schoolId: membership.schoolId,
          role: membership.role as LocalSchoolRole,
          status: membership.isActive === false ? 'revoked' : 'active',
        },
      };
      activeRole = membership.role;
      activeSchoolId = membership.schoolId;
    }

    if (!isTransitionRequest) {
      const accessSessionValidation = validateAccessJwtSession({
        claims,
        session: snapshot.session,
        nowEpochSeconds: Math.floor(nowEpochMs / 1000),
        ...(authorization ? { authorization } : {}),
      });
      if (accessSessionValidation.allowed === false) {
        return res.status(accessSessionValidation.status).json({
          error: 'Unauthorized: Access session invalid',
          code: accessSessionValidation.code,
        });
      }
    }

    const [localAuth] = await db.select({ mustReset: localAuths.mustReset })
      .from(localAuths)
      .where(eq(localAuths.userId, dbUser.id));
    const isPasswordChangeRequest = req.method === 'POST' && req.path === '/api/auth/change-password';
    const isLogoutRequest = req.method === 'POST' && req.path === '/api/auth/logout';
    if (localAuth?.mustReset && !isPasswordChangeRequest && !isLogoutRequest) {
      return res.status(403).json({
        error: 'Veuillez changer votre mot de passe avant de continuer.',
        code: 'PASSWORD_RESET_REQUIRED',
      });
    }

    req.user = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email ?? undefined,
      name: dbUser.name || dbUser.email || 'Utilisateur',
      role: activeRole,
      appRole: mapToAppRole(activeRole),
      schoolId: activeSchoolId,
      accessContext: activeContext,
      accessClaims: claims,
    };
    return next();
  } catch (error) {
    console.error('Error verifying JWT:', error);
    return res.status(503).json({
      error: 'Unable to verify the access session.',
      code: 'ACCESS_SESSION_VERIFICATION_UNAVAILABLE',
    });
  }
};

export const requireAuth = verifyToken;

export const requireRole = (allowedRoles: string[]) => (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const role = req.user?.role;
  if (!role || !allowedRoles.includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

interface RequireOwnershipOptions {
  bypassRoles?: string[];
}

export const requireOwnership = (
  resolver: (req: AuthRequest) => Promise<boolean>,
  options?: RequireOwnershipOptions,
) => {
  const bypassRoles = options?.bypassRoles ?? [];

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (role && bypassRoles.includes(role)) {
      return next();
    }

    try {
      const isOwner = await resolver(req);
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return next();
    } catch (error) {
      console.error('Ownership check failed:', error);
      return res.status(500).json({ error: 'Failed to validate ownership' });
    }
  };
};
