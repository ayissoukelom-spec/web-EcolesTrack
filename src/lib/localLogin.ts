import { Request, Response } from 'express';
import { getJwtSecret, signJwt, type JwtExpiresIn } from './jwt.ts';
import { db } from '../db/index.ts';
import { users, localAuths, userLoginEvents } from '../db/schema.ts';
import { and, eq, or, sql } from 'drizzle-orm';
import { parents } from '../db/schema.ts';
import { canonicalizeUserPhone, normalizeParentLoginPhone } from './phoneCanonicalization.ts';

export { canonicalizeUserPhone, normalizeParentLoginPhone } from './phoneCanonicalization.ts';

const DEFAULT_JWT_ISSUER = 'ecoletrack';
const DEFAULT_JWT_AUDIENCE = 'ecoletrack-api';
const DEFAULT_JWT_EXPIRES_IN = '1h';

function normalizeJwtExpiresIn(rawValue: string | undefined): JwtExpiresIn {
  const value = rawValue?.trim();
  if (!value) {
    return DEFAULT_JWT_EXPIRES_IN;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  if (/^(?:\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)$/.test(value)) {
    return value as JwtExpiresIn;
  }

  return DEFAULT_JWT_EXPIRES_IN;
}

export async function handleLocalLogin(req: Request, res: Response) {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim();
    const phoneCountryCode = typeof req.body?.phoneCountryCode === 'string' ? req.body.phoneCountryCode : '';
    const password = req.body?.password;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Missing login identifier or password' });
    }

    const isEmail = identifier.includes('@');
    let userRecord: any;
    if (isEmail) {
      const normalizedEmail = identifier.toLowerCase();
      const usersFound = await db.select().from(users).where(eq(sql`LOWER(${users.email})`, normalizedEmail));
      userRecord = usersFound[0];
    } else {
      const phoneValues = normalizeParentLoginPhone(identifier, phoneCountryCode);
      const phoneRows = phoneValues.length > 0
        ? await db.select({ user: users })
          .from(users)
          .innerJoin(parents, eq(parents.userId, users.id))
          .where(and(
            eq(users.role, 'parent'),
            or(
              sql`regexp_replace(coalesce(${parents.phone}, ''), '[^0-9]', '', 'g') = ${phoneValues[0]}`,
              sql`regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g') = ${phoneValues[0]}`,
            ),
          ))
        : [];
      const matchingUsers = Array.from(new Map(phoneRows.map((row: any) => [row.user.id, row.user])).values());
      if (matchingUsers.length !== 1) {
        return res.status(401).json({ error: 'Email ou mot de passe invalide' });
      }
      userRecord = matchingUsers[0];
    }

    if (!userRecord) {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    if (userRecord.role === 'student') {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    const authRows = await db.select().from(localAuths).where(eq(localAuths.userId, userRecord.id));
    if (authRows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    const { passwordHash, salt, mustReset } = authRows[0] as any;
    const crypto = await import('node:crypto');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
    if (verifyHash !== passwordHash) {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    let localMustReset = !!mustReset;
    if (typeof mustReset === 'undefined' || mustReset === null) {
      const defaultHash = crypto.pbkdf2Sync('123456', salt, 310000, 64, 'sha512').toString('hex');
      localMustReset = (passwordHash === defaultHash);
    }

    if (localMustReset && password === '123456') {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    const payload = {
      uid: userRecord.uid,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role,
      schoolId: userRecord.schoolId ?? null,
      type: 'access',
    };

    const secret = getJwtSecret({ isProduction: process.env.NODE_ENV === 'production' });
    if (!secret) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const token = signJwt(payload, secret, {
      expiresIn: normalizeJwtExpiresIn(process.env.JWT_EXPIRES_IN),
      issuer: process.env.JWT_ISSUER ?? DEFAULT_JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE ?? DEFAULT_JWT_AUDIENCE,
      subject: String(userRecord.id),
      jwtid: crypto.randomUUID(),
    });

    try {
      await db.insert(userLoginEvents).values({
        userId: userRecord.id,
        role: userRecord.role,
        schoolId: userRecord.schoolId ?? null,
        clientType: 'web',
      });
    } catch (eventError: any) {
      console.error('Failed to record Web login event:', eventError?.message || eventError);
    }

    if (userRecord.role === 'parent') {
      await db.update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, userRecord.id));
    }

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
