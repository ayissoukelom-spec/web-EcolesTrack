import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

export type AppRole = 'admin' | 'teacher' | 'parent' | 'student';

export const mapToAppRole = (rawRole?: string | null): AppRole | undefined => {
  if (!rawRole) return undefined;
  if (rawRole === 'super_admin' || rawRole === 'school_admin' || rawRole === 'admin') return 'admin';
  if (rawRole === 'teacher') return 'teacher';
  if (rawRole === 'parent') return 'parent';
  if (rawRole === 'student') return 'student';
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
    simulated?: boolean;
  };
}

export const verifyToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
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

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (simulatedRole) {
      req.user = {
        uid: simulatedUid || `sim_${simulatedRole}_123`,
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

  const token = authHeader.split('Bearer ')[1];
  try {
    const secret = process.env.JWT_SECRET || 'dev-jwt-secret';
    const decoded: any = jwt.verify(token, secret);
    const uid = decoded?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    const [dbUser] = await db.select().from(users).where(eq(users.uid, uid));
    if (!dbUser) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    req.user = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      name: dbUser.name || dbUser.email || 'Utilisateur',
      role: dbUser.role,
      appRole: mapToAppRole(dbUser.role),
      schoolId: dbUser.schoolId ?? null,
    };
    return next();
  } catch (error) {
    console.error('Error verifying JWT:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const requireAuth = verifyToken;

export const requireRole = (allowedRoles: AppRole[]) => (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const role = req.user?.appRole;
  if (!role || !allowedRoles.includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

interface RequireOwnershipOptions {
  bypassRoles?: AppRole[];
}

export const requireOwnership = (
  resolver: (req: AuthRequest) => Promise<boolean>,
  options?: RequireOwnershipOptions,
) => {
  const bypassRoles = options?.bypassRoles ?? [];

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user?.appRole;
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
