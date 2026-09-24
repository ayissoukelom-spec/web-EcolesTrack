import { relations, sql } from 'drizzle-orm';
import { boolean, check, customType, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// 1. Schools
export const schools = pgTable('schools', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  phone: text('phone'),
  phone2: text('phone2'),
  officialName: text('official_name'),
  abbreviation: text('abbreviation'),
  motto: text('motto'),
  postalBox: text('postal_box'),
  email: text('email'),
  city: text('city'),
  region: text('region'),
  educationDirection: text('education_direction'),
  ministryName: text('ministry_name'),
  principalName: text('principal_name'),
  logoPath: text('logo_path'),
  promotionThreshold: numeric('promotion_threshold', { precision: 5, scale: 2 }).default('10.00').notNull(),
  studentsCreationLocked: boolean('students_creation_locked').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. Academic Years
export const academicYears = pgTable('academic_years', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // e.g. "2025-2026"
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 2b. Global education cycles and levels
export const cycles = pgTable('cycles', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const levels = pgTable('levels', {
  id: serial('id').primaryKey(),
  cycleId: integer('cycle_id').references(() => cycles.id, { onDelete: 'restrict' }).notNull(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  orderIndex: integer('order_index').default(1).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const schoolCycles = pgTable('school_cycles', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  cycleId: integer('cycle_id').references(() => cycles.id, { onDelete: 'cascade' }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  schoolCycleUniqueIdx: uniqueIndex('school_cycles_school_id_cycle_id_idx').on(table.schoolId, table.cycleId),
}));

export const cyclePeriodTemplates = pgTable('cycle_period_templates', {
  id: serial('id').primaryKey(),
  cycleId: integer('cycle_id').references(() => cycles.id, { onDelete: 'cascade' }).notNull(),
  periodType: text('period_type').notNull(), // trimester | semester
  name: text('name').notNull(),
  orderIndex: integer('order_index').default(1).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  cyclePeriodTemplateUniqueIdx: uniqueIndex('cycle_period_templates_cycle_order_idx').on(table.cycleId, table.orderIndex),
}));

// 2c. School Terms / operational periods
export const schoolTerms = pgTable('school_terms', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  cycleId: integer('cycle_id').references(() => cycles.id, { onDelete: 'set null' }),
  templateId: integer('template_id').references(() => cyclePeriodTemplates.id, { onDelete: 'set null' }),
  periodType: text('period_type'), // trimester | semester; nullable for legacy terms
  name: text('name').notNull(), // e.g. "Trimestre 1"
  startDate: text('start_date'), // YYYY-MM-DD
  endDate: text('end_date'), // YYYY-MM-DD
  orderIndex: integer('order_index').default(1).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 3. Users (Auth mapping)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase UID
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  lastName: text('last_name'),
  firstNames: text('first_name'),
  role: text('role').notNull(), // 'super_admin' | 'school_admin' | 'teacher' | 'parent'
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'set null' }),
  phone: text('phone'),
  gender: text('gender'),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userSchools = pgTable('user_schools', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userSchoolUniqueIdx: uniqueIndex('user_schools_user_id_school_id_idx').on(table.userId, table.schoolId),
}));

export const userLoginEvents = pgTable('user_login_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  loginAt: timestamp('login_at').defaultNow().notNull(),
  clientType: text('client_type'),
}, (table) => ({
  clientTypeCheck: check(
    'user_login_events_client_type_check',
    sql`${table.clientType} IS NULL OR ${table.clientType} IN ('web', 'android')`,
  ),
}));

// 3b. Local auth store for username/password (optional, dev-friendly)
export const localAuths = pgTable('local_auths', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(),
  mustReset: boolean('must_reset').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 3c. Blacklisted tokens to support revocation and token invalidation
export const tokenBlacklist = pgTable('token_blacklist', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  tokenJti: text('token_jti'),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  blacklistedAt: timestamp('blacklisted_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

// 3d. Refresh token session metadata for future rotation and revocation support
export const tokenSessions = pgTable('token_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  refreshTokenId: text('refresh_token_id').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  revokedAt: timestamp('revoked_at'),
});

// 4. Teachers
export const teachers = pgTable('teachers', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  phone: text('phone'),
  specialization: text('specialization'),
});

export const teacherSubjects = pgTable('teacher_subjects', {
  id: serial('id').primaryKey(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'cascade' }).notNull(),
  subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  teacherSubjectUniqueIdx: uniqueIndex('teacher_subjects_teacher_id_subject_id_idx').on(table.teacherId, table.subjectId),
}));

// 5. Parents
export const parents = pgTable('parents', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  phone: text('phone'),
  address: text('address'),
  profession: text('profession'),
  studentId: integer('student_id'),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
});

// 6. Classes
export const classes = pgTable('classes', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  levelId: integer('level_id').references(() => levels.id, { onDelete: 'set null' }),
  progressionCode: text('progression_code'),
  name: text('name').notNull(), // e.g. "6ème A"
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'set null' }), // Principal teacher
}, (table) => ({
  schoolAcademicYearNameIdx: uniqueIndex('classes_school_academic_year_name_idx').on(table.schoolId, table.academicYearId, table.name),
  globalClassNameAcademicYearUniqueIdx: uniqueIndex('classes_global_name_academic_year_idx').on(table.name, table.academicYearId).where(sql`${table.schoolId} IS NULL`),
}));

// 7. Class teacher assignments (many-to-many)
export const classTeachers = pgTable('class_teachers', {
  id: serial('id').primaryKey(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'cascade' }).notNull(),
}, (table) => ({
  classTeacherUniqueIdx: uniqueIndex('class_teachers_class_id_teacher_id_idx').on(table.classId, table.teacherId),
}));

// 8. Students
export const students = pgTable('students', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  matricule: text('matricule').notNull().default('').unique('students_matricule_unique'),
  birthDate: text('birth_date'), // YYYY-MM-DD
  gender: text('gender'),
  parentId: integer('parent_id').references(() => parents.id, { onDelete: 'set null' }),
  schoolAdminId: integer('school_admin_id').references(() => users.id, { onDelete: 'set null' }),
  enrolledAt: timestamp('enrolled_at').defaultNow().notNull(), // Date when student was enrolled in this class
  photoData: bytea('photo_data'),
  photoMimeType: text('photo_mime_type'),
  photoUpdatedAt: timestamp('photo_updated_at'),
});

export const studentAcademicYearStatuses = pgTable('student_academic_year_statuses', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  status: text('status'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  studentAcademicYearUniqueIdx: uniqueIndex('student_academic_year_statuses_student_year_idx').on(table.studentId, table.academicYearId),
  studentStatusAllowedCheck: check('student_academic_year_statuses_status_check', sql`${table.status} IS NULL OR ${table.status} IN ('Nouveau', 'Doublant', 'Triplant', 'Quadruplant', 'Quintuplant', 'Sextuplant')`),
}));

// 7b. Subject types (catalogue global des types de matieres)
export const subjectTypes = pgTable('subject_types', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  subjectTypeNameUniqueIdx: uniqueIndex('subject_types_name_unique_idx').on(table.name),
}));

// 7c. Subjects (Matières)
export const subjects = pgTable('subjects', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  subjectTypeId: integer('subject_type_id').references(() => subjectTypes.id, { onDelete: 'set null' }),
  name: text('name').notNull(), // e.g. "Mathématiques"
  code: text('code'), // optional abbreviation e.g. "MATH"
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const schoolSubjects = pgTable('school_subjects', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'cascade' }).notNull(),
  subjectTypeId: integer('subject_type_id').references(() => subjectTypes.id, { onDelete: 'set null' }),
  status: text('status').default('pending').notNull(), // pending | approved | rejected
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  schoolSubjectUniqueIdx: uniqueIndex('school_subjects_school_id_subject_id_idx').on(table.schoolId, table.subjectId),
}));

export const schoolClasses = pgTable('school_classes', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').default('pending').notNull(), // pending | approved | rejected
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  schoolClassUniqueIdx: uniqueIndex('school_classes_school_id_class_id_idx').on(table.schoolId, table.classId),
}));

export const classSuccessions = pgTable('class_successions', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  sourceClassId: integer('source_class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  targetClassId: integer('target_class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  classSuccessionUniqueIdx: uniqueIndex('class_successions_school_year_source_idx').on(table.schoolId, table.academicYearId, table.sourceClassId),
}));

export const classProgressions = pgTable('class_progressions', {
  id: serial('id').primaryKey(),
  sourceCode: text('source_code').notNull(),
  targetCode: text('target_code').notNull(),
  cycleId: integer('cycle_id').references(() => cycles.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  classProgressionSourceCycleUniqueIdx: uniqueIndex('class_progressions_source_cycle_idx').on(table.sourceCode, table.cycleId),
}));

export const classExamConfigurations = pgTable('class_exam_configurations', {
  id: serial('id').primaryKey(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  examType: text('exam_type').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  classExamConfigurationSpecificUniqueIdx: uniqueIndex('class_exam_configurations_school_context_unique')
    .on(table.classId, table.schoolId, table.academicYearId, table.examType)
    .where(sql`${table.schoolId} IS NOT NULL`),
  classExamConfigurationGlobalUniqueIdx: uniqueIndex('class_exam_configurations_global_context_unique')
    .on(table.classId, table.academicYearId, table.examType)
    .where(sql`${table.schoolId} IS NULL`),
}));

export const examResults = pgTable('exam_results', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  examType: text('exam_type').notNull(),
  resultStatus: text('result_status').notNull(),
  examSession: text('exam_session'),
  recordedBy: integer('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  examResultStudentYearTypeUniqueIdx: uniqueIndex('exam_results_student_year_type_idx').on(table.studentId, table.academicYearId, table.examType),
}));

// 8. Evaluations
export const evaluations = pgTable('evaluations', {
  id: serial('id').primaryKey(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'cascade' }).notNull(),
  termId: integer('term_id').references(() => schoolTerms.id, { onDelete: 'set null' }),
  subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
  subject: text('subject').notNull(), // e.g. "Mathématiques"
  title: text('title').notNull(), // e.g. "Devoir surveillé 1"
  type: text('type'), // 'interrogation', 'devoir', or 'composition'
  sequenceNumber: integer('sequence_number'), // Unique per (termId, classId)
  generatedName: text('generated_name'), // Automatically generated: "Devoir S1.3"
  coefficient: integer('coefficient').default(1).notNull(),
  maxScore: integer('max_score').default(20).notNull(),
  countInBulletin: boolean('count_in_bulletin').default(true).notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  evaluationTermClassSequenceIdx: sql`UNIQUE NULLS NOT DISTINCT (${table.termId}, ${table.classId}, ${table.sequenceNumber})`,
}));

// 9. Grades (Notes)
export const grades = pgTable('grades', {
  id: serial('id').primaryKey(),
  evaluationId: integer('evaluation_id').references(() => evaluations.id, { onDelete: 'cascade' }).notNull(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  score: text('score').notNull(), // text (allows "Abs", "15.5", "18.0")
  remarks: text('remarks'),
  editCount: integer('edit_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const evaluationParticipations = pgTable('evaluation_participations', {
  id: serial('id').primaryKey(),
  evaluationId: integer('evaluation_id').references(() => evaluations.id, { onDelete: 'cascade' }).notNull(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').default('pending').notNull(), // pending | graded | absent
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  evaluationStudentIdx: uniqueIndex('evaluation_participations_evaluation_student_idx').on(table.evaluationId, table.studentId),
}));

// 10. Grade history / audit trail
export const gradeHistory = pgTable('grade_history', {
  id: serial('id').primaryKey(),
  gradeId: integer('grade_id').references(() => grades.id, { onDelete: 'cascade' }).notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  changedBy: integer('changed_by').references(() => users.id, { onDelete: 'set null' }),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
});

// 11. Absences
export const absences = pgTable('absences', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  period: text('period').notNull(), // 'morning' | 'afternoon' | 'all_day'
  subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
  startTime: text('start_time'),
  endTime: text('end_time'),
  isJustified: boolean('is_justified').default(false).notNull(),
  justificationReason: text('justification_reason'),
  justificationStatus: text('justification_status'),
  rejectionReason: text('rejection_reason'),
  reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const lateArrivals = pgTable('late_arrivals', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  date: text('date').notNull(),
  period: text('period').notNull(),
  expectedStartTime: text('expected_start_time').notNull(),
  arrivalTime: text('arrival_time').notNull(),
  lateMinutes: integer('late_minutes'),
  reason: text('reason'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  lateArrivalStudentClassDatePeriodIdx: uniqueIndex('late_arrivals_student_class_date_period_idx').on(
    table.studentId,
    table.classId,
    table.date,
    table.period,
  ),
}));

// 11b. Absence Justifications
export const absenceJustifications = pgTable('absence_justifications', {
  id: serial('id').primaryKey(),
  absenceId: integer('absence_id').references(() => absences.id, { onDelete: 'cascade' }).notNull(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }).notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Web-only teacher control record; never writes to absences or notifications.
export const absenceControls = pgTable('absence_controls', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'cascade' }).notNull(),
  date: text('date').notNull(),
  period: text('period'),
  subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
  startTime: text('start_time'),
  endTime: text('end_time'),
  controlType: text('control_type').default('none').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 12. Notifications
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(), // Recipient users.id
  evaluationId: integer('evaluation_id').references(() => evaluations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  type: text('type').notNull(), // 'absence' | 'grade' | 'info'
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 12b. Notification attachments
export const notificationAttachments = pgTable('notification_attachments', {
  id: serial('id').primaryKey(),
  notificationId: integer('notification_id').references(() => notifications.id, { onDelete: 'cascade' }).notNull(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }).notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 13. Bulletin generations
export const bulletinGenerations = pgTable('bulletin_generations', {
  id: serial('id').primaryKey(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  schoolYearId: integer('school_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  termId: integer('term_id').references(() => schoolTerms.id, { onDelete: 'cascade' }).notNull(),
  generationType: text('generation_type').notNull(),
  expectedCount: integer('expected_count').notNull(),
  completedCount: integer('completed_count').notNull().default(0),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// 14. Bulletins (persisted snapshots)
export const bulletins = pgTable('bulletins', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  schoolYearId: integer('school_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  termId: integer('term_id').references(() => schoolTerms.id, { onDelete: 'set null' }).notNull(),
  generationId: integer('generation_id').references(() => bulletinGenerations.id, { onDelete: 'set null' }),
  average: text('average'),
  classHighestAverage: text('class_highest_average'),
  classLowestAverage: text('class_lowest_average'),
  classAverage: text('class_average'),
  totalPoints: text('total_points').notNull(),
  totalCoefficients: text('total_coefficients').notNull(),
  rank: integer('rank'),
  mention: text('mention'),
  appreciation: text('appreciation'),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 15. Bulletin lines (one line per subject)
export const bulletinLines = pgTable('bulletin_lines', {
  id: serial('id').primaryKey(),
  bulletinId: integer('bulletin_id').references(() => bulletins.id, { onDelete: 'cascade' }).notNull(),
  subjectId: integer('subject_id'),
  subjectName: text('subject_name').notNull(),
  coefficient: integer('coefficient'),
  average: text('average'),
  teacherComment: text('teacher_comment'),
  rank: integer('rank'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 16. Audit Events / Journal d'événements
export const auditEvents = pgTable('audit_events', {
  id: serial('id').primaryKey(),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorRole: text('actor_role').notNull(),
  actorEmail: text('actor_email'),
  actorName: text('actor_name'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: integer('resource_id'),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Define Relationships for Drizzle
export const schoolsRelations = relations(schools, ({ many }) => ({
  academicYears: many(academicYears),
  users: many(users),
  classes: many(classes),
  students: many(students),
  schoolSubjects: many(schoolSubjects),
}));

export const academicYearsRelations = relations(academicYears, ({ one, many }) => ({
  school: one(schools, {
    fields: [academicYears.schoolId],
    references: [schools.id],
  }),
  terms: many(schoolTerms),
  classes: many(classes),
}));

export const cyclesRelations = relations(cycles, ({ many }) => ({
  levels: many(levels),
  schoolCycles: many(schoolCycles),
  periodTemplates: many(cyclePeriodTemplates),
  schoolTerms: many(schoolTerms),
}));

export const levelsRelations = relations(levels, ({ one, many }) => ({
  cycle: one(cycles, { fields: [levels.cycleId], references: [cycles.id] }),
  classes: many(classes),
}));

export const schoolCyclesRelations = relations(schoolCycles, ({ one }) => ({
  school: one(schools, { fields: [schoolCycles.schoolId], references: [schools.id] }),
  cycle: one(cycles, { fields: [schoolCycles.cycleId], references: [cycles.id] }),
}));

export const cyclePeriodTemplatesRelations = relations(cyclePeriodTemplates, ({ one, many }) => ({
  cycle: one(cycles, { fields: [cyclePeriodTemplates.cycleId], references: [cycles.id] }),
  schoolTerms: many(schoolTerms),
}));

export const schoolTermsRelations = relations(schoolTerms, ({ one, many }) => ({
  school: one(schools, {
    fields: [schoolTerms.schoolId],
    references: [schools.id],
  }),
  academicYear: one(academicYears, {
    fields: [schoolTerms.academicYearId],
    references: [academicYears.id],
  }),
  cycle: one(cycles, { fields: [schoolTerms.cycleId], references: [cycles.id] }),
  template: one(cyclePeriodTemplates, { fields: [schoolTerms.templateId], references: [cyclePeriodTemplates.id] }),
  evaluations: many(evaluations),
}));

export const subjectTypesRelations = relations(subjectTypes, ({ many }) => ({
  subjects: many(subjects),
  schoolSubjects: many(schoolSubjects),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  school: one(schools, {
    fields: [subjects.schoolId],
    references: [schools.id],
  }),
  subjectType: one(subjectTypes, {
    fields: [subjects.subjectTypeId],
    references: [subjectTypes.id],
  }),
  schoolSubjects: many(schoolSubjects),
  teacherSubjects: many(teacherSubjects),
}));

export const teacherSubjectsRelations = relations(teacherSubjects, ({ one }) => ({
  teacher: one(teachers, { fields: [teacherSubjects.teacherId], references: [teachers.id] }),
  subject: one(subjects, { fields: [teacherSubjects.subjectId], references: [subjects.id] }),
}));

export const schoolSubjectsRelations = relations(schoolSubjects, ({ one }) => ({
  school: one(schools, {
    fields: [schoolSubjects.schoolId],
    references: [schools.id],
  }),
  subject: one(subjects, {
    fields: [schoolSubjects.subjectId],
    references: [subjects.id],
  }),
  subjectType: one(subjectTypes, {
    fields: [schoolSubjects.subjectTypeId],
    references: [subjectTypes.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  school: one(schools, {
    fields: [users.schoolId],
    references: [schools.id],
  }),
  teacherProfile: one(teachers, {
    fields: [users.id],
    references: [teachers.userId],
  }),
  parentProfile: one(parents, {
    fields: [users.id],
    references: [parents.userId],
  }),
  notifications: many(notifications),
}));

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  user: one(users, {
    fields: [teachers.userId],
    references: [users.id],
  }),
  school: one(schools, {
    fields: [teachers.schoolId],
    references: [schools.id],
  }),
  classes: many(classes),
  classAssignments: many(classTeachers),
  evaluations: many(evaluations),
}));

export const classTeachersRelations = relations(classTeachers, ({ one }) => ({
  class: one(classes, {
    fields: [classTeachers.classId],
    references: [classes.id],
  }),
  teacher: one(teachers, {
    fields: [classTeachers.teacherId],
    references: [teachers.id],
  }),
}));

export const parentsRelations = relations(parents, ({ one, many }) => ({
  user: one(users, {
    fields: [parents.userId],
    references: [users.id],
  }),
  students: many(students),
  school: one(schools, {
    fields: [parents.schoolId],
    references: [schools.id],
  }),
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  school: one(schools, {
    fields: [classes.schoolId],
    references: [schools.id],
  }),
  academicYear: one(academicYears, {
    fields: [classes.academicYearId],
    references: [academicYears.id],
  }),
  level: one(levels, { fields: [classes.levelId], references: [levels.id] }),
  mainTeacher: one(teachers, {
    fields: [classes.teacherId],
    references: [teachers.id],
  }),
  students: many(students),
  evaluations: many(evaluations),
  absences: many(absences),
  lateArrivals: many(lateArrivals),
  schoolClasses: many(schoolClasses),
}));

export const schoolClassesRelations = relations(schoolClasses, ({ one }) => ({
  school: one(schools, {
    fields: [schoolClasses.schoolId],
    references: [schools.id],
  }),
  class: one(classes, {
    fields: [schoolClasses.classId],
    references: [classes.id],
  }),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  school: one(schools, {
    fields: [students.schoolId],
    references: [schools.id],
  }),
  class: one(classes, {
    fields: [students.classId],
    references: [classes.id],
  }),
  parent: one(parents, {
    fields: [students.parentId],
    references: [parents.id],
  }),
  grades: many(grades),
  absences: many(absences),
  lateArrivals: many(lateArrivals),
  bulletins: many(bulletins),
  academicYearStatuses: many(studentAcademicYearStatuses),
}));

export const studentAcademicYearStatusesRelations = relations(studentAcademicYearStatuses, ({ one }) => ({
  student: one(students, {
    fields: [studentAcademicYearStatuses.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [studentAcademicYearStatuses.academicYearId],
    references: [academicYears.id],
  }),
}));

export const bulletinsRelations = relations(bulletins, ({ one, many }) => ({
  generation: one(bulletinGenerations, {
    fields: [bulletins.generationId],
    references: [bulletinGenerations.id],
  }),
  student: one(students, {
    fields: [bulletins.studentId],
    references: [students.id],
  }),
  class: one(classes, {
    fields: [bulletins.classId],
    references: [classes.id],
  }),
  schoolYear: one(academicYears, {
    fields: [bulletins.schoolYearId],
    references: [academicYears.id],
  }),
  term: one(schoolTerms, {
    fields: [bulletins.termId],
    references: [schoolTerms.id],
  }),
  lines: many(bulletinLines),
}));

export const bulletinGenerationsRelations = relations(bulletinGenerations, ({ one, many }) => ({
  class: one(classes, {
    fields: [bulletinGenerations.classId],
    references: [classes.id],
  }),
  schoolYear: one(academicYears, {
    fields: [bulletinGenerations.schoolYearId],
    references: [academicYears.id],
  }),
  term: one(schoolTerms, {
    fields: [bulletinGenerations.termId],
    references: [schoolTerms.id],
  }),
  bulletins: many(bulletins),
}));

export const bulletinLinesRelations = relations(bulletinLines, ({ one }) => ({
  bulletin: one(bulletins, {
    fields: [bulletinLines.bulletinId],
    references: [bulletins.id],
  }),
}));

export const evaluationsRelations = relations(evaluations, ({ one, many }) => ({
  class: one(classes, {
    fields: [evaluations.classId],
    references: [classes.id],
  }),
  teacher: one(teachers, {
    fields: [evaluations.teacherId],
    references: [teachers.id],
  }),
  term: one(schoolTerms, {
    fields: [evaluations.termId],
    references: [schoolTerms.id],
  }),
  grades: many(grades),
}));

export const gradesRelations = relations(grades, ({ one }) => ({
  evaluation: one(evaluations, {
    fields: [grades.evaluationId],
    references: [evaluations.id],
  }),
  student: one(students, {
    fields: [grades.studentId],
    references: [students.id],
  }),
}));

export const absencesRelations = relations(absences, ({ one }) => ({
  student: one(students, {
    fields: [absences.studentId],
    references: [students.id],
  }),
  class: one(classes, {
    fields: [absences.classId],
    references: [classes.id],
  }),
}));

export const lateArrivalsRelations = relations(lateArrivals, ({ one }) => ({
  student: one(students, {
    fields: [lateArrivals.studentId],
    references: [students.id],
  }),
  class: one(classes, {
    fields: [lateArrivals.classId],
    references: [classes.id],
  }),
  creator: one(users, {
    fields: [lateArrivals.createdBy],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const notificationAttachmentsRelations = relations(notificationAttachments, ({ one }) => ({
  notification: one(notifications, {
    fields: [notificationAttachments.notificationId],
    references: [notifications.id],
  }),
  uploader: one(users, {
    fields: [notificationAttachments.uploadedBy],
    references: [users.id],
  }),
}));
