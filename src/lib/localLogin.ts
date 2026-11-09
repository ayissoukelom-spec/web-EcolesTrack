import { Request, Response } from 'express';
import { db } from '../db/index.ts';
import { users, localAuths, userLoginEvents } from '../db/schema.ts';
import { and, eq, or, sql } from 'drizzle-orm';
import { parents } from '../db/schema.ts';
import { canonicalizeUserPhone, normalizeParentLoginPhone } from './phoneCanonicalization.ts';
import { normalizeEmail, normalizedEmailSql } from './emailUniqueness.ts';
import { isAccessSessionGeneration } from '../server/accessContextValidation.ts';
import { createAccessSessionService } from '../server/accessSessionRuntime.ts';

export { canonicalizeUserPhone, normalizeParentLoginPhone } from './phoneCanonicalization.ts';

function toLocalLoginUserDto(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    uid: user.uid,
    email: user.email,
    name: user.name,
    lastName: user.lastName,
    firstNames: user.firstNames,
    role: user.role,
    schoolId: user.schoolId,
    academicYearId: user.academicYearId,
    phone: user.phone,
    gender: user.gender,
    isDeleted: user.isDeleted,
    lastLoginAt: user.lastLoginAt,
    lastMobileVisitAt: user.lastMobileVisitAt,
    createdAt: user.createdAt,
  };
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
      const normalizedEmail = normalizeEmail(identifier);
      const usersFound = normalizedEmail
        ? await db.select().from(users).where(eq(normalizedEmailSql(users.email), normalizedEmail))
        : [];
      userRecord = usersFound[0];
    } else {
      const phoneValues = normalizeParentLoginPhone(identifier, phoneCountryCode);
      const phoneRows = phoneValues.length > 0
        ? await db.select({ user: users })
          .from(users)
          .innerJoin(parents, eq(parents.userId, users.id))
          .where(and(
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

    const authentication = await db.transaction(async (tx) => {
      const [lockedUser] = await tx.select().from(users).for('update').where(eq(users.id, userRecord.id));
      if (!lockedUser) return { status: 'missing' as const };
      if (lockedUser.isDeleted) return { status: 'disabled' as const };
      if (lockedUser.role === 'student') return { status: 'invalid' as const };

      const currentGeneration = typeof lockedUser.accessSessionGeneration === 'bigint'
        ? lockedUser.accessSessionGeneration.toString()
        : typeof lockedUser.accessSessionGeneration === 'number'
          && Number.isSafeInteger(lockedUser.accessSessionGeneration)
          && lockedUser.accessSessionGeneration >= 0
          ? String(lockedUser.accessSessionGeneration)
          : null;
      if (!isAccessSessionGeneration(currentGeneration)) {
        throw new Error('Authenticated user has an invalid access-session generation.');
      }

      if (lockedUser.role === 'parent' || lockedUser.role === 'teacher') {
        const [updatedUser] = await tx.update(users)
          .set({ lastLoginAt: new Date() })
          .where(and(eq(users.id, lockedUser.id), eq(users.isDeleted, false)))
          .returning({ id: users.id });
        if (!updatedUser) {
          throw new Error('Authenticated user was not found while recording last login.');
        }
      }

      return {
        status: 'authenticated' as const,
        user: lockedUser,
        expectedGeneration: currentGeneration,
      };
    });

    if (authentication.status === 'disabled') {
      return res.status(403).json({
        error: 'Ce compte est désactivé. Contactez votre administrateur.',
        code: 'ACCOUNT_DISABLED',
      });
    }
    if (authentication.status !== 'authenticated') {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    let sessionResult;
    try {
      sessionResult = await createAccessSessionService().createForAuthenticatedUser({
        userId: authentication.user.id,
        expectedGeneration: authentication.expectedGeneration,
      });
    } catch (sessionError) {
      console.error('Failed to create Web access session:', sessionError);
      return res.status(503).json({
        error: 'Unable to create an authenticated session.',
        code: 'ACCESS_SESSION_CREATION_FAILED',
      });
    }
    if (!sessionResult.ok) {
      console.error('Web access session creation failed:', sessionResult.error);
      if (sessionResult.error.reason === 'session_creation_failed'
        && sessionResult.error.cause === 'generation_changed') {
        return res.status(401).json({
          error: 'The account security state changed. Please sign in again.',
          code: 'ACCESS_SESSION_GENERATION_CHANGED',
        });
      }
      if (sessionResult.error.reason === 'session_creation_failed'
        && sessionResult.error.cause === 'account_not_admissible') {
        return res.status(403).json({
          error: 'Ce compte est désactivé. Contactez votre administrateur.',
          code: 'ACCOUNT_DISABLED',
        });
      }
      return res.status(503).json({
        error: 'Unable to create an authenticated session.',
        code: 'ACCESS_SESSION_CREATION_FAILED',
      });
    }

    try {
      await db.insert(userLoginEvents).values({
        userId: authentication.user.id,
        role: authentication.user.role,
        schoolId: authentication.user.schoolId ?? null,
        clientType: 'web',
      });
    } catch (eventError: any) {
      console.error('Failed to record Web login event:', eventError?.message || eventError);
    }

    const response = {
      ...toLocalLoginUserDto(authentication.user),
      mustReset: !!localMustReset,
      token: sessionResult.accessToken,
      tokenType: 'access',
    } as any;

    return res.json(response);
  } catch (err: any) {
    console.error('Local login error:', err);
    return res.status(500).json({ error: err?.message || 'Login failed' });
  }
}
