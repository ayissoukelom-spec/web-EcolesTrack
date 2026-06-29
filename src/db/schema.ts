import { relations } from 'drizzle-orm';
import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// 1. Schools
export const schools = pgTable('schools', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  phone: text('phone'),
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

// 2b. School Terms / Trimesters
export const schoolTerms = pgTable('school_terms', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
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
  role: text('role').notNull(), // 'super_admin' | 'school_admin' | 'teacher' | 'parent'
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'set null' }),
  gender: text('gender'),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 3b. Local auth store for username/password (optional, dev-friendly)
export const localAuths = pgTable('local_auths', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 4. Teachers
export const teachers = pgTable('teachers', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  phone: text('phone'),
  specialization: text('specialization'),
});

// 5. Parents
export const parents = pgTable('parents', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  phone: text('phone'),
  address: text('address'),
  studentId: integer('student_id'),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
});

// 6. Classes
export const classes = pgTable('classes', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  academicYearId: integer('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(), // e.g. "6ème A"
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'set null' }), // Principal teacher
}, (table) => ({
  schoolAcademicYearNameIdx: uniqueIndex('classes_school_academic_year_name_idx').on(table.schoolId, table.academicYearId, table.name),
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
  birthDate: text('birth_date'), // YYYY-MM-DD
  gender: text('gender'),
  parentId: integer('parent_id').references(() => parents.id, { onDelete: 'set null' }),
  schoolAdminId: integer('school_admin_id').references(() => users.id, { onDelete: 'set null' }),
  enrolledAt: timestamp('enrolled_at').defaultNow().notNull(), // Date when student was enrolled in this class
});

// 7b. Subjects (Matières)
export const subjects = pgTable('subjects', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // e.g. "Mathématiques"
  code: text('code'), // optional abbreviation e.g. "MATH"
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const schoolSubjects = pgTable('school_subjects', {
  id: serial('id').primaryKey(),
  schoolId: integer('school_id').references(() => schools.id, { onDelete: 'cascade' }).notNull(),
  subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'cascade' }).notNull(),
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

// 8. Evaluations
export const evaluations = pgTable('evaluations', {
  id: serial('id').primaryKey(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'cascade' }).notNull(),
  termId: integer('term_id').references(() => schoolTerms.id, { onDelete: 'set null' }),
  subject: text('subject').notNull(), // e.g. "Mathématiques"
  title: text('title').notNull(), // e.g. "Devoir surveillé 1"
  coefficient: integer('coefficient').default(1).notNull(),
  maxScore: integer('max_score').default(20).notNull(),
  countInBulletin: boolean('count_in_bulletin').default(true).notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  createdAt: timestamp('created_at').defaultNow(),
});

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
  isJustified: boolean('is_justified').default(false).notNull(),
  justificationReason: text('justification_reason'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 12. Notifications
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(), // Recipient users.id
  title: text('title').notNull(),
  body: text('body').notNull(),
  type: text('type').notNull(), // 'absence' | 'grade' | 'info'
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 13. Bulletins (persisted snapshots)
export const bulletins = pgTable('bulletins', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'cascade' }).notNull(),
  schoolYearId: integer('school_year_id').references(() => academicYears.id, { onDelete: 'cascade' }).notNull(),
  termId: integer('term_id').references(() => schoolTerms.id, { onDelete: 'set null' }).notNull(),
  average: text('average'),
  totalPoints: text('total_points').notNull(),
  totalCoefficients: text('total_coefficients').notNull(),
  rank: integer('rank'),
  mention: text('mention'),
  appreciation: text('appreciation'),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 14. Bulletin lines (one line per subject)
export const bulletinLines = pgTable('bulletin_lines', {
  id: serial('id').primaryKey(),
  bulletinId: integer('bulletin_id').references(() => bulletins.id, { onDelete: 'cascade' }).notNull(),
  subjectId: integer('subject_id'),
  subjectName: text('subject_name').notNull(),
  coefficient: integer('coefficient').notNull(),
  average: text('average'),
  teacherComment: text('teacher_comment'),
  rank: integer('rank'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 15. Audit Events / Journal d'événements
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

export const schoolTermsRelations = relations(schoolTerms, ({ one, many }) => ({
  school: one(schools, {
    fields: [schoolTerms.schoolId],
    references: [schools.id],
  }),
  academicYear: one(academicYears, {
    fields: [schoolTerms.academicYearId],
    references: [academicYears.id],
  }),
  evaluations: many(evaluations),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  school: one(schools, {
    fields: [subjects.schoolId],
    references: [schools.id],
  }),
  schoolSubjects: many(schoolSubjects),
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
  mainTeacher: one(teachers, {
    fields: [classes.teacherId],
    references: [teachers.id],
  }),
  students: many(students),
  evaluations: many(evaluations),
  absences: many(absences),
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
  bulletins: many(bulletins),
}));

export const bulletinsRelations = relations(bulletins, ({ one, many }) => ({
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

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));
