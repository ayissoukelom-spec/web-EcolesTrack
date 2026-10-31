import { teacherControlAuditEvents } from '../../db/schema.ts';
import type { TeacherControlRole } from './authorization.ts';

export interface TeacherControlTransaction {
  insert(table: typeof teacherControlAuditEvents): {
    values(values: typeof teacherControlAuditEvents.$inferInsert): PromiseLike<unknown>;
  };
}

export interface TeacherControlTransactionalDatabase {
  transaction<T>(callback: (tx: TeacherControlTransaction) => Promise<T>): Promise<T>;
}

export interface TeacherControlAuditInput {
  schoolId: number;
  schoolNameSnapshot: string;
  actorUserId: number | null;
  actorRole: TeacherControlRole;
  actorEmailSnapshot?: string | null;
  actorNameSnapshot: string;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  beforeValues?: Record<string, unknown> | null;
  afterValues?: Record<string, unknown> | null;
  reason?: string | null;
}

export async function runTeacherControlAuditedMutation<T>(
  database: TeacherControlTransactionalDatabase,
  mutation: (tx: TeacherControlTransaction) => Promise<{
    result: T;
    audit: TeacherControlAuditInput;
  }>,
): Promise<T> {
  return database.transaction(async (tx) => {
    const { result, audit } = await mutation(tx);
    await tx.insert(teacherControlAuditEvents).values({
      schoolId: audit.schoolId,
      schoolNameSnapshot: audit.schoolNameSnapshot,
      actorUserId: audit.actorUserId,
      actorRole: audit.actorRole,
      actorEmailSnapshot: audit.actorEmailSnapshot ?? null,
      actorNameSnapshot: audit.actorNameSnapshot,
      action: audit.action,
      resourceType: audit.resourceType,
      resourceId: audit.resourceId ?? null,
      beforeValues: audit.beforeValues ?? null,
      afterValues: audit.afterValues ?? null,
      reason: audit.reason ?? null,
    });
    return result;
  });
}
