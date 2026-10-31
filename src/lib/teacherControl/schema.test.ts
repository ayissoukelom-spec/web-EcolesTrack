import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { teacherControlSessions } from '../../db/schema.ts';

const migrationPath = path.join(process.cwd(), 'drizzle', 'manual', '0144_teacher_control_foundation.sql');
const migration = readFileSync(migrationPath, 'utf8');
const gpsChallengesMigrationPath = path.join(process.cwd(), 'drizzle', 'manual', '0145_teacher_control_gps_challenges.sql');
const gpsChallengesMigration = readFileSync(gpsChallengesMigrationPath, 'utf8');
const existingAssociationsMigrationPath = path.join(process.cwd(), 'drizzle', 'manual', '0146_teacher_control_existing_associations.sql');
const existingAssociationsMigration = readFileSync(existingAssociationsMigrationPath, 'utf8');

describe('teacher control schema migration', () => {
  it('enforces one open session per teacher and school and one pending request per session', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX teacher_control_sessions_one_open_per_teacher_school_uidx[\s\S]*?ON public\.teacher_control_sessions \(school_id, teacher_id\)\s+WHERE status = 'open'/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX teacher_control_regularization_one_pending_per_session_uidx[\s\S]*?ON public\.teacher_control_regularization_requests \(session_id\)\s+WHERE status = 'pending'/);
  });

  it('keeps archive tables independent of deletable school and identity records', () => {
    expect(migration).not.toMatch(/REFERENCES public\.(schools|users|teachers|classes|subjects|teacher_class_subjects)\s*\(/i);
    expect(migration).not.toMatch(/ON DELETE CASCADE/i);
    expect(migration).toMatch(/REFERENCES public\.teacher_control_sessions\(id\) ON DELETE RESTRICT/i);
    expect(migration).toMatch(/REFERENCES public\.teacher_control_regularization_requests\(id\) ON DELETE RESTRICT/i);
    expect(migration).toMatch(/teacher_control_audit_events_append_only/);
    expect(migration).toMatch(/teacher_control_regularization_decisions_append_only/);
    expect(migration).toMatch(/teacher_control_sessions_no_delete/);
    expect(migration).toMatch(/teacher_control_regularization_requests_no_delete/);
  });

  it('stores session instants in UTC-capable PostgreSQL timestamps and keeps unvalidated closures without an end', () => {
    expect(migration).toMatch(/started_at TIMESTAMPTZ NOT NULL/);
    expect(migration).toMatch(/validated_ended_at TIMESTAMPTZ/);
    expect(migration).toMatch(/status = 'closed_without_end' AND validated_ended_at IS NULL AND closed_at IS NOT NULL/);
    expect(migration).toMatch(/geofence_radius_meters INTEGER NOT NULL DEFAULT 200/);
    expect(migration).toMatch(/start_accuracy_meters BETWEEN 0 AND 100/);
    expect(migration).toMatch(/start_geofence_radius_meters > 0/);
  });

  it('stores only scoped, expiring, single-use GPS challenge hashes without foreign keys or coordinates', () => {
    expect(gpsChallengesMigration).toMatch(/challenge_hash TEXT NOT NULL UNIQUE/);
    expect(gpsChallengesMigration).toMatch(/actor_user_id INTEGER NOT NULL/);
    expect(gpsChallengesMigration).toMatch(/school_id INTEGER NOT NULL/);
    expect(gpsChallengesMigration).toMatch(/action IN \('start_session', 'end_session'\)/);
    expect(gpsChallengesMigration).toMatch(/expires_at TIMESTAMPTZ NOT NULL/);
    expect(gpsChallengesMigration).toMatch(/consumed_at TIMESTAMPTZ/);
    expect(gpsChallengesMigration).not.toMatch(/latitude|longitude|REFERENCES/i);
  });

  it('preserves canonical historical assignment ids and requires both existing association snapshots for new sessions', () => {
    expect(teacherControlSessions.teachingAssignmentId.notNull).toBe(false);
    expect(teacherControlSessions.classTeacherAssociationId.notNull).toBe(false);
    expect(teacherControlSessions.teacherSubjectAssociationId.notNull).toBe(false);
    expect(existingAssociationsMigration).toMatch(/ALTER COLUMN teaching_assignment_id DROP NOT NULL/i);
    expect(existingAssociationsMigration).toMatch(/ADD COLUMN class_teacher_association_id INTEGER/i);
    expect(existingAssociationsMigration).toMatch(/ADD COLUMN teacher_subject_association_id INTEGER/i);
    expect(existingAssociationsMigration).toMatch(/teaching_assignment_id IS NOT NULL[\s\S]*class_teacher_association_id IS NULL[\s\S]*teacher_subject_association_id IS NULL/i);
    expect(existingAssociationsMigration).toMatch(/teaching_assignment_id IS NULL[\s\S]*class_teacher_association_id IS NOT NULL[\s\S]*teacher_subject_association_id IS NOT NULL/i);
    expect(existingAssociationsMigration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE|UPDATE public\.teacher_control_sessions/i);
  });
});
