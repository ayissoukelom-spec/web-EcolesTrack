import { describe, expect, it, vi } from 'vitest';
import {
  runTeacherControlAuditedMutation,
  type TeacherControlAuditInput,
  type TeacherControlTransaction,
  type TeacherControlTransactionalDatabase,
} from './audit.ts';
import { teacherControlAuditEvents } from '../../db/schema.ts';

describe('teacher control audited transactions', () => {
  it('inserts the audit row in the same transaction as the mutation', async () => {
    const values = vi.fn(async (_input: typeof teacherControlAuditEvents.$inferInsert) => undefined);
    const insert = vi.fn((_table: typeof teacherControlAuditEvents) => ({ values }));
    const tx: TeacherControlTransaction = { insert };
    let transactionCalls = 0;
    const database: TeacherControlTransactionalDatabase = {
      transaction: async <T>(callback: (tx: TeacherControlTransaction) => Promise<T>): Promise<T> => {
        transactionCalls += 1;
        return callback(tx);
      },
    };

    const result = await runTeacherControlAuditedMutation(database as never, async () => ({
      result: 'saved',
      audit: {
        schoolId: 8,
        schoolNameSnapshot: 'École A',
        actorUserId: 10,
        actorRole: 'teacher',
        actorNameSnapshot: 'Enseignant',
        action: 'session_started',
        resourceType: 'session',
        resourceId: 99,
        beforeValues: null,
        afterValues: { status: 'open' },
      },
    }));

    expect(result).toBe('saved');
    expect(transactionCalls).toBe(1);
    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      schoolId: 8,
      action: 'session_started',
      resourceId: 99,
      afterValues: { status: 'open' },
    }));
  });

  it('propagates audit insertion errors so the transaction cannot commit the mutation', async () => {
    const auditError = new Error('audit unavailable');
    const values = vi.fn(async (_input: typeof teacherControlAuditEvents.$inferInsert) => {
      throw auditError;
    });
    const insert = vi.fn((_table: typeof teacherControlAuditEvents) => ({ values }));
    const tx: TeacherControlTransaction = { insert };
    let transactionCommitted = false;
    const database: TeacherControlTransactionalDatabase = {
      transaction: async <T>(callback: (tx: TeacherControlTransaction) => Promise<T>): Promise<T> => {
        const result = await callback(tx);
        transactionCommitted = true;
        return result;
      },
    };
    await expect(runTeacherControlAuditedMutation(database, async () => ({
      result: 'mutated',
      audit: {
        schoolId: 8,
        schoolNameSnapshot: 'École A',
        actorUserId: 1,
        actorRole: 'school_admin',
        actorNameSnapshot: 'Admin',
        action: 'session_closed',
        resourceType: 'session',
        resourceId: 99,
      } satisfies TeacherControlAuditInput,
    }))).rejects.toBe(auditError);
    expect(transactionCommitted).toBe(false);
  });
});
