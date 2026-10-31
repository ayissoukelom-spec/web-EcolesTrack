import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  runTeacherControlAuditedMutation,
  type TeacherControlAuditInput,
  type TeacherControlTransaction,
  type TeacherControlTransactionalDatabase,
} from './audit.ts';

const isDisposableLocalTestDatabase = process.env.SQL_DB_NAME === 'ecoletrack_test'
  && ['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '');
const databaseTest = isDisposableLocalTestDatabase ? it : it.skip;

describe('teacher control PostgreSQL constraints', () => {
  databaseTest('enforces one open session per teacher and school while isolating schools', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_session_uniqueness_test (
          school_id INTEGER NOT NULL,
          teacher_id INTEGER NOT NULL,
          status TEXT NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE UNIQUE INDEX teacher_control_session_uniqueness_test_uidx
        ON teacher_control_session_uniqueness_test (school_id, teacher_id)
        WHERE status = 'open'
      `);

      await tx.execute(sql`
        INSERT INTO teacher_control_session_uniqueness_test (school_id, teacher_id, status)
        VALUES (1, 10, 'open'), (2, 10, 'open'), (1, 11, 'open'), (1, 10, 'completed')
      `);
      await tx.execute(sql`SAVEPOINT teacher_control_duplicate_open_session`);
      const duplicateInsertError = await tx.execute(sql`
        INSERT INTO teacher_control_session_uniqueness_test (school_id, teacher_id, status)
        VALUES (1, 10, 'open')
      `).then(() => null, (error: unknown) => error);
      expect(duplicateInsertError).toBeInstanceOf(Error);
      const databaseError = duplicateInsertError as Error & { cause?: { code?: string } };
      expect(databaseError.cause?.code).toBe('23505');
      await tx.execute(sql`ROLLBACK TO SAVEPOINT teacher_control_duplicate_open_session`);

      const result = await tx.execute(sql`
        SELECT COUNT(*)::INTEGER AS count FROM teacher_control_session_uniqueness_test
      `);
      expect(result.rows[0]?.count).toBe(4);

      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_pending_request_uniqueness_test (
          session_id INTEGER NOT NULL,
          status TEXT NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE UNIQUE INDEX teacher_control_pending_request_uniqueness_test_uidx
        ON teacher_control_pending_request_uniqueness_test (session_id)
        WHERE status = 'pending'
      `);
      await tx.execute(sql`
        INSERT INTO teacher_control_pending_request_uniqueness_test (session_id, status)
        VALUES (10, 'pending'), (11, 'pending'), (10, 'rejected')
      `);
      await tx.execute(sql`SAVEPOINT teacher_control_duplicate_pending_request`);
      const duplicatePendingError = await tx.execute(sql`
        INSERT INTO teacher_control_pending_request_uniqueness_test (session_id, status)
        VALUES (10, 'pending')
      `).then(() => null, (error: unknown) => error);
      expect(duplicatePendingError).toBeInstanceOf(Error);
      const pendingDatabaseError = duplicatePendingError as Error & { cause?: { code?: string } };
      expect(pendingDatabaseError.cause?.code).toBe('23505');
      await tx.execute(sql`ROLLBACK TO SAVEPOINT teacher_control_duplicate_pending_request`);

      const pendingResult = await tx.execute(sql`
        SELECT COUNT(*)::INTEGER AS count FROM teacher_control_pending_request_uniqueness_test
      `);
      expect(pendingResult.rows[0]?.count).toBe(3);
    });
  });

  databaseTest('enforces school membership, exact active assignments and raw teacher role in PostgreSQL', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_auth_users_test (
          user_id INTEGER PRIMARY KEY,
          role TEXT NOT NULL,
          school_id INTEGER,
          is_deleted BOOLEAN NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_auth_memberships_test (
          user_id INTEGER NOT NULL,
          school_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          is_active BOOLEAN NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_auth_schools_test (
          school_id INTEGER PRIMARY KEY,
          is_suspended BOOLEAN NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_auth_teachers_test (
          teacher_id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_auth_assignments_test (
          teacher_id INTEGER NOT NULL,
          school_id INTEGER NOT NULL,
          class_id INTEGER NOT NULL,
          subject_id INTEGER NOT NULL,
          is_active BOOLEAN NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        INSERT INTO teacher_control_auth_users_test VALUES
          (10, 'teacher', 8, FALSE),
          (11, 'teacher', 9, FALSE),
          (12, 'surveillant', 8, FALSE),
          (13, 'teacher', 8, TRUE)
      `);
      await tx.execute(sql`
        INSERT INTO teacher_control_auth_memberships_test VALUES
          (10, 8, 'teacher', TRUE),
          (10, 9, 'teacher', TRUE),
          (11, 9, 'teacher', TRUE),
          (12, 8, 'surveillant', TRUE),
          (13, 8, 'teacher', TRUE)
      `);
      await tx.execute(sql`
        INSERT INTO teacher_control_auth_schools_test VALUES (8, FALSE), (9, TRUE)
      `);
      await tx.execute(sql`
        INSERT INTO teacher_control_auth_teachers_test VALUES (20, 10)
      `);
      await tx.execute(sql`
        INSERT INTO teacher_control_auth_assignments_test VALUES
          (20, 8, 30, 40, TRUE),
          (20, 8, 30, 41, TRUE),
          (20, 8, 31, 40, FALSE),
          (20, 9, 30, 40, TRUE)
      `);

      async function hasActiveSchoolAccess(userId: number, schoolId: number): Promise<boolean> {
        const result = await tx.execute(sql`
          SELECT 1
          FROM teacher_control_auth_users_test AS u
          JOIN teacher_control_auth_memberships_test AS m
            ON m.user_id = u.user_id AND m.school_id = ${schoolId}
          JOIN teacher_control_auth_schools_test AS s ON s.school_id = m.school_id
          WHERE u.user_id = ${userId}
            AND u.role = 'teacher'
            AND u.is_deleted = FALSE
            AND u.school_id = s.school_id
            AND m.role = u.role
            AND m.is_active = TRUE
            AND s.is_suspended = FALSE
        `);
        return result.rows.length === 1;
      }

      expect(await hasActiveSchoolAccess(10, 8)).toBe(true);
      expect(await hasActiveSchoolAccess(10, 9)).toBe(false);
      expect(await hasActiveSchoolAccess(11, 9)).toBe(false);
      expect(await hasActiveSchoolAccess(12, 8)).toBe(false);
      expect(await hasActiveSchoolAccess(13, 8)).toBe(false);

      async function hasExactActiveAssignment(
        teacherId: number,
        schoolId: number,
        classId: number,
        subjectId: number,
      ): Promise<boolean> {
        const result = await tx.execute(sql`
          SELECT 1
          FROM teacher_control_auth_teachers_test AS t
          JOIN teacher_control_auth_assignments_test AS a ON a.teacher_id = t.teacher_id
          WHERE t.user_id = 10
            AND t.teacher_id = ${teacherId}
            AND a.school_id = ${schoolId}
            AND a.class_id = ${classId}
            AND a.subject_id = ${subjectId}
            AND a.is_active = TRUE
        `);
        return result.rows.length === 1;
      }

      expect(await hasExactActiveAssignment(20, 8, 30, 40)).toBe(true);
      expect(await hasExactActiveAssignment(20, 8, 30, 41)).toBe(true);
      expect(await hasExactActiveAssignment(20, 8, 31, 40)).toBe(false);
      expect(await hasExactActiveAssignment(20, 8, 30, 42)).toBe(false);
      expect(await hasExactActiveAssignment(21, 8, 30, 40)).toBe(false);
    });
  });

  databaseTest('rolls back a business mutation when the PostgreSQL audit insert fails', async () => {
    await db.transaction(async (outerTx) => {
      await outerTx.execute(sql`
        CREATE TEMP TABLE teacher_control_audit_events (
          id SERIAL PRIMARY KEY,
          school_id INTEGER NOT NULL,
          school_name_snapshot TEXT NOT NULL,
          actor_user_id INTEGER,
          actor_role TEXT NOT NULL,
          actor_email_snapshot TEXT,
          actor_name_snapshot TEXT NOT NULL,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id INTEGER,
          before_values JSONB,
          after_values JSONB,
          reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        ) ON COMMIT DROP
      `);
      await outerTx.execute(sql`
        CREATE TEMP TABLE teacher_control_business_mutation_test (id INTEGER)
        ON COMMIT DROP
      `);
      await outerTx.execute(sql`
        CREATE FUNCTION pg_temp.reject_teacher_control_audit_test()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced audit insertion failure';
        END;
        $$
      `);
      await outerTx.execute(sql`
        CREATE TRIGGER teacher_control_audit_insert_failure_test
        BEFORE INSERT ON teacher_control_audit_events
        FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_teacher_control_audit_test()
      `);

      let nestedTx: typeof outerTx | undefined;
      const transactionalDatabase: TeacherControlTransactionalDatabase = {
        transaction: <T>(callback: (tx: TeacherControlTransaction) => Promise<T>) =>
          outerTx.transaction(async (tx) => {
            nestedTx = tx;
            return callback(tx);
          }),
      };
      const audit: TeacherControlAuditInput = {
        schoolId: 8,
        schoolNameSnapshot: 'École test',
        actorUserId: 10,
        actorRole: 'teacher',
        actorNameSnapshot: 'Enseignant test',
        action: 'session_started',
        resourceType: 'session',
        resourceId: 99,
      };

      const auditFailure = await runTeacherControlAuditedMutation(transactionalDatabase, async () => {
        if (!nestedTx) throw new Error('Test transaction was not initialized.');
        await nestedTx.execute(sql`INSERT INTO teacher_control_business_mutation_test VALUES (1)`);
        return { result: 'mutated', audit };
      }).then(() => null, (error: unknown) => error);
      expect(auditFailure).toBeInstanceOf(Error);
      expect((auditFailure as Error & { cause?: { message?: string } }).cause?.message)
        .toContain('forced audit insertion failure');

      const result = await outerTx.execute(sql`
        SELECT COUNT(*)::INTEGER AS count FROM teacher_control_business_mutation_test
      `);
      expect(result.rows[0]?.count).toBe(0);
    });
  });

  databaseTest('keeps archive rows after source records are deleted', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_source_records_test (id INTEGER PRIMARY KEY)
        ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_archive_records_test (
          source_id INTEGER NOT NULL,
          school_name_snapshot TEXT NOT NULL,
          teacher_name_snapshot TEXT NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`INSERT INTO teacher_control_source_records_test VALUES (1)`);
      await tx.execute(sql`
        INSERT INTO teacher_control_archive_records_test VALUES (1, 'École archivée', 'Enseignant archivé')
      `);

      await tx.execute(sql`DELETE FROM teacher_control_source_records_test WHERE id = 1`);

      const archived = await tx.execute(sql`
        SELECT source_id, school_name_snapshot, teacher_name_snapshot
        FROM teacher_control_archive_records_test
      `);
      expect(archived.rows).toEqual([{
        source_id: 1,
        school_name_snapshot: 'École archivée',
        teacher_name_snapshot: 'Enseignant archivé',
      }]);
    });
  });

  databaseTest('blocks PostgreSQL updates and deletes on append-only history tables', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_audit_events (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE FUNCTION pg_temp.prevent_teacher_control_history_mutation_test()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'Teacher control history is append-only';
        END;
        $$
      `);
      await tx.execute(sql`
        CREATE TRIGGER teacher_control_audit_events_append_only_test
        BEFORE UPDATE OR DELETE ON teacher_control_audit_events
        FOR EACH ROW EXECUTE FUNCTION pg_temp.prevent_teacher_control_history_mutation_test()
      `);
      await tx.execute(sql`INSERT INTO teacher_control_audit_events VALUES (1, 'original')`);

      await tx.execute(sql`SAVEPOINT teacher_control_block_update`);
      const updateError = await tx.execute(sql`
        UPDATE teacher_control_audit_events SET value = 'changed' WHERE id = 1
      `).then(() => null, (error: unknown) => error);
      expect(updateError).toBeInstanceOf(Error);
      expect((updateError as Error & { cause?: { message?: string } }).cause?.message)
        .toContain('append-only');
      await tx.execute(sql`ROLLBACK TO SAVEPOINT teacher_control_block_update`);

      await tx.execute(sql`SAVEPOINT teacher_control_block_delete`);
      const deleteError = await tx.execute(sql`
        DELETE FROM teacher_control_audit_events WHERE id = 1
      `).then(() => null, (error: unknown) => error);
      expect(deleteError).toBeInstanceOf(Error);
      expect((deleteError as Error & { cause?: { message?: string } }).cause?.message)
        .toContain('append-only');
      await tx.execute(sql`ROLLBACK TO SAVEPOINT teacher_control_block_delete`);

      const result = await tx.execute(sql`
        SELECT value FROM teacher_control_audit_events WHERE id = 1
      `);
      expect(result.rows[0]?.value).toBe('original');
    });
  });

  databaseTest('consumes scoped GPS challenges once and rejects expired or cross-action replay', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE teacher_control_gps_challenges_test (
          challenge_hash TEXT PRIMARY KEY,
          actor_user_id INTEGER NOT NULL,
          school_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          resource_id INTEGER,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        INSERT INTO teacher_control_gps_challenges_test
          (challenge_hash, actor_user_id, school_id, action, resource_id, expires_at)
        VALUES
          ('valid-start', 10, 8, 'start_session', NULL, now() + interval '2 minutes'),
          ('expired-end', 10, 8, 'end_session', 55, now() - interval '1 second')
      `);

      const consume = (hash: string, actorUserId: number, schoolId: number, action: string, resourceId: number | null) =>
        tx.execute(sql`
          UPDATE teacher_control_gps_challenges_test
          SET consumed_at = now()
          WHERE challenge_hash = ${hash}
            AND actor_user_id = ${actorUserId}
            AND school_id = ${schoolId}
            AND action = ${action}
            AND resource_id IS NOT DISTINCT FROM ${resourceId}
            AND consumed_at IS NULL
            AND expires_at > now()
          RETURNING challenge_hash
        `);

      expect((await consume('valid-start', 10, 8, 'start_session', null)).rows).toHaveLength(1);
      expect((await consume('valid-start', 10, 8, 'start_session', null)).rows).toHaveLength(0);
      expect((await consume('valid-start', 10, 8, 'end_session', null)).rows).toHaveLength(0);
      expect((await consume('valid-start', 11, 8, 'start_session', null)).rows).toHaveLength(0);
      expect((await consume('valid-start', 10, 9, 'start_session', null)).rows).toHaveLength(0);
      expect((await consume('expired-end', 10, 8, 'end_session', 55)).rows).toHaveLength(0);
    });
  });
});
