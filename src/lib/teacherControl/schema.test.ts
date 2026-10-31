import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  teacherControlRegularizationDecisions,
  teacherControlRegularizationRequests,
  teacherControlSessions,
} from '../../db/schema.ts';

const migrationPath = path.join(process.cwd(), 'drizzle', 'manual', '0144_teacher_control_foundation.sql');
const migration = readFileSync(migrationPath, 'utf8');
const gpsChallengesMigrationPath = path.join(process.cwd(), 'drizzle', 'manual', '0145_teacher_control_gps_challenges.sql');
const gpsChallengesMigration = readFileSync(gpsChallengesMigrationPath, 'utf8');
const existingAssociationsMigrationPath = path.join(process.cwd(), 'drizzle', 'manual', '0146_teacher_control_existing_associations.sql');
const existingAssociationsMigration = readFileSync(existingAssociationsMigrationPath, 'utf8');
const unrecordedRegularizationMigrationPath = path.join(process.cwd(), 'drizzle', 'manual', '0147_teacher_control_unrecorded_regularization.sql');
const unrecordedRegularizationMigration = readFileSync(unrecordedRegularizationMigrationPath, 'utf8');
const acceptanceLinkMigrationPath = path.join(process.cwd(), 'drizzle', 'manual', '0148_teacher_control_regularization_acceptance_link.sql');
const acceptanceLinkMigration = readFileSync(acceptanceLinkMigrationPath, 'utf8');
const drizzleSchema = readFileSync(path.join(process.cwd(), 'src', 'db', 'schema.ts'), 'utf8');

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

  it('models both unrecorded-session request types and allows administrative sessions without fabricated GPS data', () => {
    expect(teacherControlRegularizationRequests.sessionId.notNull).toBe(false);
    expect(teacherControlRegularizationRequests.proposedEndedAt.notNull).toBe(false);
    expect(teacherControlSessions.startDistanceMeters.notNull).toBe(false);
    expect(teacherControlSessions.startAccuracyMeters.notNull).toBe(false);
    expect(teacherControlSessions.regularizationRequestId).toBeDefined();
    expect(teacherControlRegularizationDecisions.sessionId.notNull).toBe(false);
    expect(teacherControlRegularizationDecisions.decidedStartedAt).toBeDefined();
    expect(unrecordedRegularizationMigration).toMatch(/request_type IN \('incomplete_session', 'immediate_report', 'late_declaration'\)/);
    expect(unrecordedRegularizationMigration).toMatch(/reference_started_at TIMESTAMPTZ/);
    expect(unrecordedRegularizationMigration).toMatch(/declared_started_at TIMESTAMPTZ/);
    expect(unrecordedRegularizationMigration).toMatch(/ALTER COLUMN proposed_ended_at DROP NOT NULL/);
    expect(unrecordedRegularizationMigration).toMatch(/start_source = 'regularization'/);
    expect(unrecordedRegularizationMigration).toMatch(/regularization_request_id IS NOT NULL/);
    expect(unrecordedRegularizationMigration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
    expect(unrecordedRegularizationMigration).not.toMatch(/UPDATE public\.(teacher_control_sessions|teacher_control_regularization_requests)/i);
  });

  it('keeps Drizzle constraints aligned with migration 0147 GPS evidence and request links', () => {
    const sessionsConfig = getTableConfig(teacherControlSessions);
    const requestsConfig = getTableConfig(teacherControlRegularizationRequests);
    const requestConstraintNames = requestsConfig.checks.map(({ name }) => name);
    const sessionIndexNames = sessionsConfig.indexes.map(({ config }) => config.name);

    expect(sessionsConfig.foreignKeys.map((foreignKey) => foreignKey.getName()))
      .toContain('teacher_control_sessions_regularization_request_id_teacher_control_regularization_requests_id_fk');
    expect(unrecordedRegularizationMigration)
      .toMatch(/ADD CONSTRAINT teacher_control_sessions_regularization_request_id_teacher_control_regularization_requests_id_fk/);
    expect(requestConstraintNames).toEqual(expect.arrayContaining([
      'teacher_control_regularization_gps_check',
      'teacher_control_regularization_incident_type_check',
      'teacher_control_regularization_immediate_incident_check',
    ]));
    expect(unrecordedRegularizationMigration).toMatch(/gps_latitude IS NOT NULL[\s\S]*gps_longitude IS NOT NULL[\s\S]*gps_accuracy_meters IS NOT NULL/);
    expect(sessionIndexNames).toEqual(expect.arrayContaining([
      'teacher_control_sessions_one_open_per_teacher_school_uidx',
      'teacher_control_sessions_regularization_request_uidx',
    ]));
    expect(drizzleSchema).toMatch(/startDistanceMeters} IS NULL OR/);
    expect(drizzleSchema).toMatch(/startAccuracyMeters} IS NULL OR/);
    expect(drizzleSchema).toMatch(/startGeofenceRadiusMeters} IS NULL OR/);
    expect(unrecordedRegularizationMigration).toMatch(/start_distance_meters IS NULL OR/);
    expect(unrecordedRegularizationMigration).toMatch(/start_accuracy_meters IS NULL OR/);
    expect(unrecordedRegularizationMigration).toMatch(/start_geofence_radius_meters IS NULL OR/);
  });

  it('allows unrecorded requests to link a session only after acceptance', () => {
    const requestsConfig = getTableConfig(teacherControlRegularizationRequests);
    const sourceCheck = requestsConfig.checks.find(
      ({ name }) => name === 'teacher_control_regularization_request_source_check',
    );
    const sessionsConfig = getTableConfig(teacherControlSessions);
    const requestSessionIndex = sessionsConfig.indexes.find(
      ({ config }) => config.name === 'teacher_control_sessions_regularization_request_uidx',
    );

    expect(sourceCheck).toBeDefined();
    expect(drizzleSchema).toMatch(/requestSourceCheck: check[\s\S]*status} IN \('pending', 'rejected'\)[\s\S]*status} IN \('accepted', 'modified_accepted'\)/);
    expect(acceptanceLinkMigration).toMatch(/DROP CONSTRAINT teacher_control_regularization_request_source_check/);
    expect(acceptanceLinkMigration).toMatch(/request_type = 'incomplete_session'[\s\S]*session_id IS NOT NULL[\s\S]*proposed_ended_at IS NOT NULL/);
    expect(acceptanceLinkMigration).toMatch(/status IN \('pending', 'rejected'\) AND session_id IS NULL/);
    expect(acceptanceLinkMigration).toMatch(/status IN \('accepted', 'modified_accepted'\)[\s\S]*session_id IS NOT NULL/);
    expect(acceptanceLinkMigration).toMatch(/request_type = 'immediate_report'[\s\S]*proposed_ended_at IS NOT NULL/);
    expect(requestSessionIndex?.config.unique).toBe(true);
    expect(requestSessionIndex?.config.where?.queryChunks).toBeDefined();
    expect(unrecordedRegularizationMigration).toMatch(/CREATE UNIQUE INDEX teacher_control_sessions_regularization_request_uidx[\s\S]*ON public\.teacher_control_sessions \(regularization_request_id\)[\s\S]*WHERE regularization_request_id IS NOT NULL/);
    expect(acceptanceLinkMigration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE|UPDATE\s+/i);
  });
});
