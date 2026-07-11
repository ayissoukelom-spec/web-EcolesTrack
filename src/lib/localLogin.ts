import { Request, Response } from 'express';
import { signJwt } from './jwt.ts';
import { db } from '../db/index.ts';
import { users, localAuths } from '../db/schema.ts';
import { eq, sql } from 'drizzle-orm';

const DEFAULT_JWT_ISSUER = 'ecoletrack';
const DEFAULT_JWT_EXPIRES_IN = '1h';

export async function handleLocalLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const usersFound = await db.select().from(users).where(eq(sql`LOWER(${users.email})`, normalizedEmail));
    if (usersFound.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    const userRecord = usersFound[0];
    if (userRecord.role === 'student') {
      return res.status(401).json({ error: 'Connexion non autorisée pour un compte élève' });
    }

    const authRows = await db.select().from(localAuths).where(eq(localAuths.userId, userRecord.id));
    if (authRows.length === 0) {
      return res.status(401).json({ error: 'Aucun mot de passe enregistré pour cet utilisateur' });
    }

    const { passwordHash, salt, mustReset } = authRows[0] as any;
    const crypto = await import('node:crypto');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
    if (verifyHash !== passwordHash) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    let localMustReset = !!mustReset;
    if (typeof mustReset === 'undefined' || mustReset === null) {
      try {
        const defaultHash = crypto.pbkdf2Sync('123456', salt, 310000, 64, 'sha512').toString('hex');
        localMustReset = (passwordHash === defaultHash);
      } catch (e) {
        localMustReset = false;
      }
    }

    const payload = {
      uid: userRecord.uid,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role,
      schoolId: userRecord.schoolId ?? null,
      type: 'access',
    };

    const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret';
    const token = signJwt(payload, secret, {
      expiresIn: process.env.JWT_EXPIRES_IN ?? DEFAULT_JWT_EXPIRES_IN,
      issuer: process.env.JWT_ISSUER ?? DEFAULT_JWT_ISSUER,
      subject: String(userRecord.id),
      jwtid: crypto.randomUUID(),
    });

    const response = {
      ...userRecord,
      mustReset: !!localMustReset,
      token,
      tokenType: 'access',
    } as any;

    return res.json(response);
  } catch (err: any) {
    console.error('Local login error:', err);
    return res.status(500).json({ error: err?.message || 'Login failed' });
  }
}
