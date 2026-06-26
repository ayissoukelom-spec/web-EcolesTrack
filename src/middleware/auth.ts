import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

export interface AuthRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    name?: string;
    role?: string;
    schoolId?: number | null;
    simulated?: boolean;
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  // 1. Support dev session mockup / simulated mode via headers for flexible testing
  //    Block simulation headers in production to prevent test artifacts leaking.
  const simulatedRole = req.headers['x-simulated-role'];
  const simulatedUid = req.headers['x-simulated-uid'];
  const simulatedEmail = req.headers['x-simulated-email'];
  const simulatedName = req.headers['x-simulated-name'];
  const simulatedSchoolId = req.headers['x-simulated-school-id'];

  if (process.env.NODE_ENV === 'production' && (simulatedRole || simulatedUid)) {
    return res.status(400).json({ error: 'Simulation headers are not allowed in production' });
  }

  if (simulatedRole && simulatedUid) {
    try {
      const [dbUser] = await db.select().from(users).where(eq(users.uid, simulatedUid as string));
      if (dbUser) {
        req.user = {
          uid: dbUser.uid,
          email: dbUser.email || (simulatedEmail as string | undefined),
          name: dbUser.name || (simulatedName as string | undefined),
          role: dbUser.role,
          schoolId: dbUser.schoolId,
          simulated: true,
        };
      } else {
        req.user = {
          uid: simulatedUid as string,
          email: (simulatedEmail || 'simulated@schooltrack.com') as string,
          name: (simulatedName || 'User Simulé') as string,
          role: simulatedRole as string,
          schoolId: simulatedSchoolId ? parseInt(simulatedSchoolId as string) : null,
          simulated: true,
        };
      }
    } catch (error) {
      console.error('Failed to resolve simulated auth user from DB', error);
      req.user = {
        uid: simulatedUid as string,
        email: (simulatedEmail || 'simulated@schooltrack.com') as string,
        name: (simulatedName || 'User Simulé') as string,
        role: simulatedRole as string,
        schoolId: simulatedSchoolId ? parseInt(simulatedSchoolId as string) : null,
        simulated: true,
      };
    }
    return next();
  }

  // 2. Standard Firebase ID Token auth
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token and no simulated profile' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email || 'Utilisateur',
      // We will look up role dynamically in the database
    };
    return next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
