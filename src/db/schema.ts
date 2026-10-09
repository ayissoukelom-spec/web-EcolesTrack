import { relations, sql } from 'drizzle-orm';
import { boolean, check, customType, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
  principalGender: text('principal_gender'),
  logoPath: text('logo_path'),
  promotionThreshold: numeric('promotion_threshold', { precision: 5, scale: 2 }).default('10.00').notNull(),
  studentsCreationLocked: boolean('students_creation_locked').default(false).notNull(),
  isSuspended: boolean('is_suspended').default(false).notNull(),
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

export const schoolPeriodTypeApprovals = pgTable('school_period_type_approvals', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  periodType: text('period_type').notNull(),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  schoolPeriodTypeApprovalUniqueIdx: uniqueIndex('school_period_type_approvals_school_type_idx').on(table.schoolId, table.periodType),
  schoolPeriodTypeApprovalPeriodCheck: check('school_period_type_approvals_period_type_check', sql`${table.periodType} IN ('trimester', 'semester')`),
  schoolPeriodTypeApprovalStatusCheck: check('school_period_type_approvals_status_check', sql`${table.status} IN ('pending', 'approved', 'rejected')`),
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
  email: text('email').unique(),
  name: text('name').notNull(),
  lastName: text('last_name'),
  firstNames: text('first_name'),
  role: text('role').notNull(), // 'super_admin' | 'school_admin' | 'teacher' | 'parent'
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'set null' }),
  phone: text('phone').notNull().unique('users_phone_unique'),
  gender: text('gender'),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  phoneCanonicalCheck: check(
    'users_phone_canonical_check',
    sql`left(${table.phone}, 1) = '+' AND length(${table.phone}) BETWEEN 3 AND 16 AND substring(${table.phone} from 2 for 1) BETWEEN '1' AND '9' AND substring(${table.phone} from 2) !~ '[^0-9]'`,
  ),
}));

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
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  teacherSubjectUniqueIdx: uniqueIndex('teacher_subjects_teacher_school_subject_idx').on(table.teacherId, table.schoolId, table.subjectId),
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
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
}, (table) => ({
  classTeacherUniqueIdx: uniqueIndex('class_teachers_school_class_teacher_idx').on(table.schoolId, table.classId, table.teacherId),
}));

export const teacherClassSubjects = pgTable('teacher_class_subjects', {
  id: serial('id').primaryKey(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'cascade' }).notNull(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'cascade' }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  teacherClassSubjectUniqueIdx: uniqueIndex('teacher_class_subjects_teacher_school_class_subject_idx')
    .on(table.teacherId, table.schoolId, table.classId, table.subjectId),
  teacherClassSubjectLookupIdx: index('teacher_class_subjects_school_teacher_active_idx')
    .on(table.schoolId, table.teacherId, table.isActive),
}));

export const classHomeroomAssignments = pgTable('class_homeroom_assignments', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  classHomeroomSchoolClassUniqueIdx: uniqueIndex('class_homeroom_assignments_school_class_idx').on(table.schoolId, table.classId),
  classHomeroomTeacherIdx: index('class_homeroom_assignments_school_teacher_idx').on(table.schoolId, table.teacherId),
}));

// 8. Students
export const students = pgTable('students', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').default(true).notNull(),
  withdrawnAt: timestamp('withdrawn_at'),
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
  mention: text('mention'),
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
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
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
  evaluationTermClassSequenceIdx: uniqueIndex('evaluations_school_term_class_sequence_idx')
    .on(table.schoolId, table.termId, table.classId, table.sequenceNumber)
    .where(sql`${table.sequenceNumber} IS NOT NULL`),
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

// 11. Parent-declared future absences, kept separate from recorded absences.
export const absenceDeclarations = pgTable('absence_declarations', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  parentId: integer('parent_id').references(() => parents.id, { onDelete: 'cascade' }).notNull(),
  date: text('date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  reason: text('reason').notNull(),
  status: text('status').default('RECEIVED').notNull(),
  rejectionReason: text('rejection_reason'),
  reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 11. Absences
export const absences = pgTable('absences', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  teachingAssignmentId: integer('teaching_assignment_id').references(() => teacherClassSubjects.id, { onDelete: 'set null' }),
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
  declarationId: integer('declaration_id').references(() => absenceDeclarations.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const lateArrivals = pgTable('late_arrivals', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  teachingAssignmentId: integer('teaching_assignment_id').references(() => teacherClassSubjects.id, { onDelete: 'set null' }),
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
  lateArrivalTeachingAssignmentIdx: index('late_arrivals_teaching_assignment_id_idx').on(table.teachingAssignmentId),
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
  dedupeKey: text('dedupe_key'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  dedupeKeyUniqueIdx: uniqueIndex('notifications_dedupe_key_idx').on(table.dedupeKey)
    .where(sql`${table.dedupeKey} IS NOT NULL`),
}));

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
  schoolScopeVersion: integer('school_scope_version').default(0).notNull(),
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

export const accountingCategories = pgTable('accounting_categories', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'restrict' }).notNull(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  schoolCodeUniqueIdx: uniqueIndex('accounting_categories_school_code_idx').on(table.schoolId, table.code),
}));

export const accountingTariffs = pgTable('accounting_tariffs', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'restrict' }).notNull(),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'restrict' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'restrict' }),
  classFromId: integer('class_from_id').references(() => classes.id, { onDelete: 'restrict' }),
  classToId: integer('class_to_id').references(() => classes.id, { onDelete: 'restrict' }),
  categoryId: integer('category_id').references(() => accountingCategories.id, { onDelete: 'restrict' }).notNull(),
  label: text('label').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').default('XOF').notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  schoolYearClassCategoryUniqueIdx: uniqueIndex('accounting_tariffs_school_year_class_category_idx').on(
    table.schoolId, table.academicYearId, table.classId, table.categoryId,
  ),
  schoolYearRangeCategoryUniqueIdx: uniqueIndex('accounting_tariffs_school_year_class_range_category_idx').on(
    table.schoolId, table.academicYearId, table.classFromId, table.classToId, table.categoryId,
  ).where(sql`${table.classId} IS NULL`),
  classScopeCheck: check('accounting_tariffs_class_scope_check', sql`
    (${table.classId} IS NOT NULL AND ${table.classFromId} IS NULL AND ${table.classToId} IS NULL)
    OR (${table.classId} IS NULL AND ${table.classFromId} IS NOT NULL AND ${table.classToId} IS NOT NULL)
  `),
  amountCheck: check('accounting_tariffs_amount_check', sql`${table.amount} > 0`),
  currencyCheck: check('accounting_tariffs_currency_check', sql`${table.currency} = 'XOF'`),
}));

export const accountingScheduleTemplates = pgTable('accounting_schedule_templates', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'restrict' }).notNull(),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'restrict' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'restrict' }).notNull(),
  categoryId: integer('category_id').references(() => accountingCategories.id, { onDelete: 'restrict' }).notNull(),
  periodType: text('period_type').notNull(),
  installments: jsonb('installments').$type<Array<{ label: string; dueDate: string; basisPoints: number }>>().notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  schoolYearClassCategoryUniqueIdx: uniqueIndex('accounting_schedule_templates_scope_idx').on(
    table.schoolId, table.academicYearId, table.classId, table.categoryId,
  ),
  periodTypeCheck: check('accounting_schedule_templates_period_check', sql`${table.periodType} IN ('annual', 'trimester', 'semester')`),
}));

export const accountingFeeDefinitions = pgTable('accounting_fee_definitions', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'restrict' }).notNull(),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'restrict' }).notNull(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'restrict' }),
  categoryId: integer('category_id').references(() => accountingCategories.id, { onDelete: 'restrict' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'restrict' }),
  label: text('label').notNull(),
  description: text('description'),
  amount: integer('amount').notNull(),
  currency: text('currency').default('XOF').notNull(),
  isMandatory: boolean('is_mandatory').default(false).notNull(),
  dueDate: text('due_date'),
  status: text('status').default('pending').notNull(),
  proposedBy: integer('proposed_by').references(() => users.id, { onDelete: 'set null' }),
  validatedBy: integer('validated_by').references(() => users.id, { onDelete: 'set null' }),
  validatedAt: timestamp('validated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  schoolYearIdx: index('accounting_fee_definitions_school_year_idx').on(table.schoolId, table.academicYearId),
  amountCheck: check('accounting_fee_definitions_amount_check', sql`${table.amount} > 0`),
  statusCheck: check('accounting_fee_definitions_status_check', sql`${table.status} IN ('pending', 'validated', 'active', 'rejected', 'disabled')`),
  currencyCheck: check('accounting_fee_definitions_currency_check', sql`${table.currency} = 'XOF'`),
}));

export const financialObligations = pgTable('financial_obligations', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'restrict' }).notNull(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'restrict' }).notNull(),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'restrict' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'restrict' }).notNull(),
  categoryId: integer('category_id').references(() => accountingCategories.id, { onDelete: 'restrict' }).notNull(),
  tariffId: integer('tariff_id').references(() => accountingTariffs.id, { onDelete: 'restrict' }),
  feeDefinitionId: integer('fee_definition_id').references(() => accountingFeeDefinitions.id, { onDelete: 'restrict' }),
  label: text('label').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').default('XOF').notNull(),
  classNameSnapshot: text('class_name_snapshot').notNull(),
  enrollmentKind: text('enrollment_kind'),
  sourceKey: text('source_key').notNull(),
  status: text('status').default('active').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sourceKeyUniqueIdx: uniqueIndex('financial_obligations_school_source_key_idx').on(table.schoolId, table.sourceKey),
  studentYearIdx: index('financial_obligations_student_year_idx').on(table.schoolId, table.studentId, table.academicYearId),
  amountCheck: check('financial_obligations_amount_check', sql`${table.amount} > 0`),
  currencyCheck: check('financial_obligations_currency_check', sql`${table.currency} = 'XOF'`),
  enrollmentKindCheck: check('financial_obligations_enrollment_kind_check', sql`${table.enrollmentKind} IS NULL OR ${table.enrollmentKind} IN ('first_enrollment', 're_enrollment', 'ordinary')`),
  statusCheck: check('financial_obligations_status_check', sql`${table.status} IN ('active', 'cancelled')`),
}));

export const financialInstallments = pgTable('financial_installments', {
  id: serial('id').primaryKey(),
  obligationId: integer('obligation_id').references(() => financialObligations.id, { onDelete: 'restrict' }).notNull(),
  label: text('label').notNull(),
  orderIndex: integer('order_index').notNull(),
  amount: integer('amount').notNull(),
  dueDate: text('due_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  obligationOrderUniqueIdx: uniqueIndex('financial_installments_obligation_order_idx').on(table.obligationId, table.orderIndex),
  amountCheck: check('financial_installments_amount_check', sql`${table.amount} > 0`),
}));

export const financialPayments = pgTable('financial_payments', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'restrict' }).notNull(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'restrict' }).notNull(),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'restrict' }).notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').default('XOF').notNull(),
  method: text('method').notNull(),
  reference: text('reference'),
  requestFingerprint: text('request_fingerprint').notNull(),
  paidAt: timestamp('paid_at').defaultNow().notNull(),
  status: text('status').default('posted').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  recordedBy: integer('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  idempotencyUniqueIdx: uniqueIndex('financial_payments_school_idempotency_idx').on(table.schoolId, table.idempotencyKey),
  schoolPaidAtIdx: index('financial_payments_school_paid_at_idx').on(table.schoolId, table.paidAt),
  amountCheck: check('financial_payments_amount_check', sql`${table.amount} > 0`),
  methodCheck: check('financial_payments_method_check', sql`${table.method} IN ('cash', 'tmoney', 'flooz', 'bank_transfer', 'check', 'other')`),
  statusCheck: check('financial_payments_status_check', sql`${table.status} IN ('posted', 'cancelled')`),
  currencyCheck: check('financial_payments_currency_check', sql`${table.currency} = 'XOF'`),
}));

export const financialPaymentAllocations = pgTable('financial_payment_allocations', {
  id: serial('id').primaryKey(),
  paymentId: integer('payment_id').references(() => financialPayments.id, { onDelete: 'restrict' }).notNull(),
  obligationId: integer('obligation_id').references(() => financialObligations.id, { onDelete: 'restrict' }).notNull(),
  installmentId: integer('installment_id').references(() => financialInstallments.id, { onDelete: 'restrict' }),
  amount: integer('amount').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  paymentIdx: index('financial_payment_allocations_payment_idx').on(table.paymentId),
  obligationIdx: index('financial_payment_allocations_obligation_idx').on(table.obligationId),
  amountCheck: check('financial_payment_allocations_amount_check', sql`${table.amount} > 0`),
}));

export const financialAdjustments = pgTable('financial_adjustments', {
  id: serial('id').primaryKey(),
  paymentId: integer('payment_id').references(() => financialPayments.id, { onDelete: 'restrict' }).notNull(),
  kind: text('kind').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  sourceKey: text('source_key').notNull(),
  recordedBy: integer('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sourceKeyUniqueIdx: uniqueIndex('financial_adjustments_source_key_idx').on(table.sourceKey),
  paymentIdx: index('financial_adjustments_payment_idx').on(table.paymentId),
  kindCheck: check('financial_adjustments_kind_check', sql`${table.kind} IN ('cancellation', 'refund')`),
  amountCheck: check('financial_adjustments_amount_check', sql`${table.amount} > 0`),
}));

export const financialAdjustmentAllocations = pgTable('financial_adjustment_allocations', {
  id: serial('id').primaryKey(),
  adjustmentId: integer('adjustment_id').references(() => financialAdjustments.id, { onDelete: 'restrict' }).notNull(),
  paymentAllocationId: integer('payment_allocation_id').references(() => financialPaymentAllocations.id, { onDelete: 'restrict' }).notNull(),
  amount: integer('amount').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  adjustmentIdx: index('financial_adjustment_allocations_adjustment_idx').on(table.adjustmentId),
  allocationIdx: index('financial_adjustment_allocations_payment_allocation_idx').on(table.paymentAllocationId),
  amountCheck: check('financial_adjustment_allocations_amount_check', sql`${table.amount} > 0`),
}));

export const financialReceipts = pgTable('financial_receipts', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'restrict' }).notNull(),
  paymentId: integer('payment_id').references(() => financialPayments.id, { onDelete: 'restrict' }).notNull(),
  receiptNumber: text('receipt_number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  issuedAt: timestamp('issued_at').defaultNow().notNull(),
}, (table) => ({
  paymentUniqueIdx: uniqueIndex('financial_receipts_payment_idx').on(table.paymentId),
  schoolNumberUniqueIdx: uniqueIndex('financial_receipts_school_number_idx').on(table.schoolId, table.receiptNumber),
}));

// Define Relationships for Drizzle
export const schoolsRelations = relations(schools, ({ many }) => ({
  academicYears: many(academicYears),
  users: many(users),
  classes: many(classes),
  students: many(students),
  schoolSubjects: many(schoolSubjects),
  classHomeroomAssignments: many(classHomeroomAssignments),
  periodTypeApprovals: many(schoolPeriodTypeApprovals),
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

export const schoolPeriodTypeApprovalsRelations = relations(schoolPeriodTypeApprovals, ({ one }) => ({
  school: one(schools, { fields: [schoolPeriodTypeApprovals.schoolId], references: [schools.id] }),
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
  teachingAssignments: many(teacherClassSubjects),
}));

export const teacherSubjectsRelations = relations(teacherSubjects, ({ one }) => ({
  teacher: one(teachers, { fields: [teacherSubjects.teacherId], references: [teachers.id] }),
  subject: one(subjects, { fields: [teacherSubjects.subjectId], references: [subjects.id] }),
}));

export const teacherClassSubjectsRelations = relations(teacherClassSubjects, ({ one, many }) => ({
  teacher: one(teachers, { fields: [teacherClassSubjects.teacherId], references: [teachers.id] }),
  school: one(schools, { fields: [teacherClassSubjects.schoolId], references: [schools.id] }),
  class: one(classes, { fields: [teacherClassSubjects.classId], references: [classes.id] }),
  subject: one(subjects, { fields: [teacherClassSubjects.subjectId], references: [subjects.id] }),
  absences: many(absences),
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
  homeroomAssignments: many(classHomeroomAssignments),
  teachingAssignments: many(teacherClassSubjects),
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

export const classHomeroomAssignmentsRelations = relations(classHomeroomAssignments, ({ one }) => ({
  school: one(schools, {
    fields: [classHomeroomAssignments.schoolId],
    references: [schools.id],
  }),
  class: one(classes, {
    fields: [classHomeroomAssignments.classId],
    references: [classes.id],
  }),
  teacher: one(teachers, {
    fields: [classHomeroomAssignments.teacherId],
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
  teachingAssignments: many(teacherClassSubjects),
  absences: many(absences),
  lateArrivals: many(lateArrivals),
  schoolClasses: many(schoolClasses),
  homeroomAssignments: many(classHomeroomAssignments),
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
  teachingAssignment: one(teacherClassSubjects, {
    fields: [absences.teachingAssignmentId],
    references: [teacherClassSubjects.id],
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
