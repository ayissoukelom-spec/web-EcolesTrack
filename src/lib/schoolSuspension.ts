import { sql, type SQL } from 'drizzle-orm';
import { SCHOOL_SUSPENDED_MESSAGE } from './schoolSuspensionMessage.ts';

export { SCHOOL_SUSPENDED_MESSAGE } from './schoolSuspensionMessage.ts';

type SchoolStateTransaction = {
  execute(query: SQL): Promise<unknown>;
};

export class SchoolSuspendedError extends Error {
  readonly code = 'SCHOOL_SUSPENDED';
  readonly statusCode = 423;

  constructor(readonly schoolId: number) {
    super(SCHOOL_SUSPENDED_MESSAGE);
    this.name = 'SchoolSuspendedError';
  }
}

export async function assertSchoolActiveInTransaction(
  tx: SchoolStateTransaction,
  schoolId: number,
): Promise<void> {
  const result = await tx.execute(sql`
    SELECT is_suspended
    FROM schools
    WHERE id = ${schoolId}
    FOR SHARE
  `) as { rows?: Array<{ is_suspended: boolean }> } | Array<{ is_suspended: boolean }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const state = rows[0];
  if (!state) throw new Error(`School ${schoolId} does not exist`);
  if (state.is_suspended) throw new SchoolSuspendedError(schoolId);
}
