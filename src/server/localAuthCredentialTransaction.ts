import { and, eq } from 'drizzle-orm';
import { localAuths, users } from '../db/schema.ts';
import type { AccessSessionTransaction } from './accessSessionRepository.ts';

export interface LocalAuthCredentialValues {
  readonly passwordHash: string;
  readonly salt: string;
  readonly mustReset: boolean;
}

export class LocalAuthCredentialUpdateError extends Error {
  constructor(
    readonly code:
      | 'user_not_found'
      | 'local_auth_not_found'
      | 'concurrent_change'
      | 'unexpected_row_count',
  ) {
    super(`Local authentication credential update failed: ${code}.`);
    this.name = 'LocalAuthCredentialUpdateError';
  }
}

/**
 * Update local credentials from inside the access-session revocation transaction.
 * The caller must pass the transaction object supplied by revokeAllForUser.
 */
export async function updateLocalAuthCredentials(
  transaction: AccessSessionTransaction,
  input: {
    readonly userId: number;
    readonly values: LocalAuthCredentialValues;
    readonly expected?: LocalAuthCredentialValues;
  },
): Promise<void> {
  const [user] = await transaction.select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.userId))
    .for('update')
    .limit(1);
  if (!user) throw new LocalAuthCredentialUpdateError('user_not_found');

  const expected = input.expected;
  const conditions = [eq(localAuths.userId, input.userId)];
  if (expected) {
    conditions.push(
      eq(localAuths.passwordHash, expected.passwordHash),
      eq(localAuths.salt, expected.salt),
      eq(localAuths.mustReset, expected.mustReset),
    );
  }

  const updated = await transaction.update(localAuths)
    .set({
      passwordHash: input.values.passwordHash,
      salt: input.values.salt,
      mustReset: input.values.mustReset,
    })
    .where(and(...conditions))
    .returning({ userId: localAuths.userId });

  if (updated.length === 1) return;
  if (updated.length > 1) {
    throw new LocalAuthCredentialUpdateError('unexpected_row_count');
  }

  const [existingAuth] = await transaction.select({ userId: localAuths.userId })
    .from(localAuths)
    .where(eq(localAuths.userId, input.userId))
    .limit(1);
  if (!existingAuth) throw new LocalAuthCredentialUpdateError('local_auth_not_found');
  if (expected) throw new LocalAuthCredentialUpdateError('concurrent_change');
  throw new LocalAuthCredentialUpdateError('unexpected_row_count');
}
