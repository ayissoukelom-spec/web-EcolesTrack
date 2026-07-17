var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc3) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc3 = __getOwnPropDesc(from, key)) || desc3.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_vite = require("vite");

// src/db/index.ts
var import_path = __toESM(require("path"), 1);
var dotenv = __toESM(require("dotenv"), 1);
var import_node_postgres = require("drizzle-orm/node-postgres");
var import_pg = __toESM(require("pg"), 1);

// src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  absences: () => absences,
  absencesRelations: () => absencesRelations,
  academicYears: () => academicYears,
  academicYearsRelations: () => academicYearsRelations,
  auditEvents: () => auditEvents,
  bulletinLines: () => bulletinLines,
  bulletinLinesRelations: () => bulletinLinesRelations,
  bulletins: () => bulletins,
  bulletinsRelations: () => bulletinsRelations,
  classTeachers: () => classTeachers,
  classTeachersRelations: () => classTeachersRelations,
  classes: () => classes,
  classesRelations: () => classesRelations,
  evaluations: () => evaluations,
  evaluationsRelations: () => evaluationsRelations,
  gradeHistory: () => gradeHistory,
  grades: () => grades,
  gradesRelations: () => gradesRelations,
  localAuths: () => localAuths,
  notifications: () => notifications,
  notificationsRelations: () => notificationsRelations,
  parents: () => parents,
  parentsRelations: () => parentsRelations,
  schoolClasses: () => schoolClasses,
  schoolClassesRelations: () => schoolClassesRelations,
  schoolSubjects: () => schoolSubjects,
  schoolSubjectsRelations: () => schoolSubjectsRelations,
  schoolTerms: () => schoolTerms,
  schoolTermsRelations: () => schoolTermsRelations,
  schools: () => schools,
  schoolsRelations: () => schoolsRelations,
  students: () => students,
  studentsRelations: () => studentsRelations,
  subjects: () => subjects,
  subjectsRelations: () => subjectsRelations,
  teachers: () => teachers,
  teachersRelations: () => teachersRelations,
  userSchools: () => userSchools,
  users: () => users,
  usersRelations: () => usersRelations
});
var import_drizzle_orm = require("drizzle-orm");
var import_pg_core = require("drizzle-orm/pg-core");
var schools = (0, import_pg_core.pgTable)("schools", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  name: (0, import_pg_core.text)("name").notNull(),
  address: (0, import_pg_core.text)("address"),
  phone: (0, import_pg_core.text)("phone"),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var academicYears = (0, import_pg_core.pgTable)("academic_years", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }),
  name: (0, import_pg_core.text)("name").notNull(),
  // e.g. "2025-2026"
  isActive: (0, import_pg_core.boolean)("is_active").default(true).notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var schoolTerms = (0, import_pg_core.pgTable)("school_terms", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }),
  academicYearId: (0, import_pg_core.integer)("academic_year_id").references(() => academicYears.id, { onDelete: "cascade" }).notNull(),
  name: (0, import_pg_core.text)("name").notNull(),
  // e.g. "Trimestre 1"
  startDate: (0, import_pg_core.text)("start_date"),
  // YYYY-MM-DD
  endDate: (0, import_pg_core.text)("end_date"),
  // YYYY-MM-DD
  orderIndex: (0, import_pg_core.integer)("order_index").default(1).notNull(),
  isActive: (0, import_pg_core.boolean)("is_active").default(true).notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var users = (0, import_pg_core.pgTable)("users", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  uid: (0, import_pg_core.text)("uid").notNull().unique(),
  // Firebase UID
  email: (0, import_pg_core.text)("email").notNull().unique(),
  name: (0, import_pg_core.text)("name").notNull(),
  role: (0, import_pg_core.text)("role").notNull(),
  // 'super_admin' | 'school_admin' | 'teacher' | 'parent'
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }),
  academicYearId: (0, import_pg_core.integer)("academic_year_id").references(() => academicYears.id, { onDelete: "set null" }),
  gender: (0, import_pg_core.text)("gender"),
  isDeleted: (0, import_pg_core.boolean)("is_deleted").default(false).notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var userSchools = (0, import_pg_core.pgTable)("user_schools", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  userId: (0, import_pg_core.integer)("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }).notNull(),
  role: (0, import_pg_core.text)("role").notNull(),
  isActive: (0, import_pg_core.boolean)("is_active").default(true).notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
}, (table) => ({
  userSchoolUniqueIdx: (0, import_pg_core.uniqueIndex)("user_schools_user_id_school_id_idx").on(table.userId, table.schoolId)
}));
var localAuths = (0, import_pg_core.pgTable)("local_auths", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  userId: (0, import_pg_core.integer)("user_id").references(() => users.id, { onDelete: "cascade" }).notNull().unique(),
  passwordHash: (0, import_pg_core.text)("password_hash").notNull(),
  salt: (0, import_pg_core.text)("salt").notNull(),
  mustReset: (0, import_pg_core.boolean)("must_reset").default(true).notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var teachers = (0, import_pg_core.pgTable)("teachers", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  userId: (0, import_pg_core.integer)("user_id").references(() => users.id, { onDelete: "cascade" }).notNull().unique(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }).notNull(),
  phone: (0, import_pg_core.text)("phone"),
  specialization: (0, import_pg_core.text)("specialization")
});
var parents = (0, import_pg_core.pgTable)("parents", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  userId: (0, import_pg_core.integer)("user_id").references(() => users.id, { onDelete: "cascade" }).notNull().unique(),
  phone: (0, import_pg_core.text)("phone"),
  address: (0, import_pg_core.text)("address"),
  studentId: (0, import_pg_core.integer)("student_id"),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" })
});
var classes = (0, import_pg_core.pgTable)("classes", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }),
  academicYearId: (0, import_pg_core.integer)("academic_year_id").references(() => academicYears.id, { onDelete: "cascade" }).notNull(),
  name: (0, import_pg_core.text)("name").notNull(),
  // e.g. "6ème A"
  teacherId: (0, import_pg_core.integer)("teacher_id").references(() => teachers.id, { onDelete: "set null" })
  // Principal teacher
}, (table) => ({
  schoolAcademicYearNameIdx: (0, import_pg_core.uniqueIndex)("classes_school_academic_year_name_idx").on(table.schoolId, table.academicYearId, table.name)
}));
var classTeachers = (0, import_pg_core.pgTable)("class_teachers", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  classId: (0, import_pg_core.integer)("class_id").references(() => classes.id, { onDelete: "cascade" }).notNull(),
  teacherId: (0, import_pg_core.integer)("teacher_id").references(() => teachers.id, { onDelete: "cascade" }).notNull()
}, (table) => ({
  classTeacherUniqueIdx: (0, import_pg_core.uniqueIndex)("class_teachers_class_id_teacher_id_idx").on(table.classId, table.teacherId)
}));
var students = (0, import_pg_core.pgTable)("students", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }).notNull(),
  classId: (0, import_pg_core.integer)("class_id").references(() => classes.id, { onDelete: "cascade" }).notNull(),
  firstName: (0, import_pg_core.text)("first_name").notNull(),
  lastName: (0, import_pg_core.text)("last_name").notNull(),
  birthDate: (0, import_pg_core.text)("birth_date"),
  // YYYY-MM-DD
  gender: (0, import_pg_core.text)("gender"),
  parentId: (0, import_pg_core.integer)("parent_id").references(() => parents.id, { onDelete: "set null" }),
  schoolAdminId: (0, import_pg_core.integer)("school_admin_id").references(() => users.id, { onDelete: "set null" }),
  enrolledAt: (0, import_pg_core.timestamp)("enrolled_at").defaultNow().notNull()
  // Date when student was enrolled in this class
});
var subjects = (0, import_pg_core.pgTable)("subjects", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }),
  name: (0, import_pg_core.text)("name").notNull(),
  // e.g. "Mathématiques"
  code: (0, import_pg_core.text)("code"),
  // optional abbreviation e.g. "MATH"
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow(),
  updatedAt: (0, import_pg_core.timestamp)("updated_at").defaultNow()
});
var schoolSubjects = (0, import_pg_core.pgTable)("school_subjects", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }).notNull(),
  subjectId: (0, import_pg_core.integer)("subject_id").references(() => subjects.id, { onDelete: "cascade" }).notNull(),
  status: (0, import_pg_core.text)("status").default("pending").notNull(),
  // pending | approved | rejected
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow(),
  updatedAt: (0, import_pg_core.timestamp)("updated_at").defaultNow()
}, (table) => ({
  schoolSubjectUniqueIdx: (0, import_pg_core.uniqueIndex)("school_subjects_school_id_subject_id_idx").on(table.schoolId, table.subjectId)
}));
var schoolClasses = (0, import_pg_core.pgTable)("school_classes", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }).notNull(),
  classId: (0, import_pg_core.integer)("class_id").references(() => classes.id, { onDelete: "cascade" }).notNull(),
  status: (0, import_pg_core.text)("status").default("pending").notNull(),
  // pending | approved | rejected
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow(),
  updatedAt: (0, import_pg_core.timestamp)("updated_at").defaultNow()
}, (table) => ({
  schoolClassUniqueIdx: (0, import_pg_core.uniqueIndex)("school_classes_school_id_class_id_idx").on(table.schoolId, table.classId)
}));
var evaluations = (0, import_pg_core.pgTable)("evaluations", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  classId: (0, import_pg_core.integer)("class_id").references(() => classes.id, { onDelete: "cascade" }).notNull(),
  teacherId: (0, import_pg_core.integer)("teacher_id").references(() => teachers.id, { onDelete: "cascade" }).notNull(),
  termId: (0, import_pg_core.integer)("term_id").references(() => schoolTerms.id, { onDelete: "set null" }),
  subject: (0, import_pg_core.text)("subject").notNull(),
  // e.g. "Mathématiques"
  title: (0, import_pg_core.text)("title").notNull(),
  // e.g. "Devoir surveillé 1"
  coefficient: (0, import_pg_core.integer)("coefficient").default(1).notNull(),
  maxScore: (0, import_pg_core.integer)("max_score").default(20).notNull(),
  countInBulletin: (0, import_pg_core.boolean)("count_in_bulletin").default(true).notNull(),
  date: (0, import_pg_core.text)("date").notNull(),
  // YYYY-MM-DD
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var grades = (0, import_pg_core.pgTable)("grades", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  evaluationId: (0, import_pg_core.integer)("evaluation_id").references(() => evaluations.id, { onDelete: "cascade" }).notNull(),
  studentId: (0, import_pg_core.integer)("student_id").references(() => students.id, { onDelete: "cascade" }).notNull(),
  score: (0, import_pg_core.text)("score").notNull(),
  // text (allows "Abs", "15.5", "18.0")
  remarks: (0, import_pg_core.text)("remarks"),
  editCount: (0, import_pg_core.integer)("edit_count").default(0).notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow(),
  updatedAt: (0, import_pg_core.timestamp)("updated_at").defaultNow()
});
var gradeHistory = (0, import_pg_core.pgTable)("grade_history", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  gradeId: (0, import_pg_core.integer)("grade_id").references(() => grades.id, { onDelete: "cascade" }).notNull(),
  oldValue: (0, import_pg_core.text)("old_value"),
  newValue: (0, import_pg_core.text)("new_value"),
  changedBy: (0, import_pg_core.integer)("changed_by").references(() => users.id, { onDelete: "set null" }),
  changedAt: (0, import_pg_core.timestamp)("changed_at").defaultNow().notNull()
});
var absences = (0, import_pg_core.pgTable)("absences", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  studentId: (0, import_pg_core.integer)("student_id").references(() => students.id, { onDelete: "cascade" }).notNull(),
  classId: (0, import_pg_core.integer)("class_id").references(() => classes.id, { onDelete: "cascade" }).notNull(),
  date: (0, import_pg_core.text)("date").notNull(),
  // YYYY-MM-DD
  period: (0, import_pg_core.text)("period").notNull(),
  // 'morning' | 'afternoon' | 'all_day'
  isJustified: (0, import_pg_core.boolean)("is_justified").default(false).notNull(),
  justificationReason: (0, import_pg_core.text)("justification_reason"),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var notifications = (0, import_pg_core.pgTable)("notifications", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  userId: (0, import_pg_core.integer)("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  // Recipient users.id
  title: (0, import_pg_core.text)("title").notNull(),
  body: (0, import_pg_core.text)("body").notNull(),
  type: (0, import_pg_core.text)("type").notNull(),
  // 'absence' | 'grade' | 'info'
  isRead: (0, import_pg_core.boolean)("is_read").default(false).notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var bulletins = (0, import_pg_core.pgTable)("bulletins", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  studentId: (0, import_pg_core.integer)("student_id").references(() => students.id, { onDelete: "cascade" }).notNull(),
  classId: (0, import_pg_core.integer)("class_id").references(() => classes.id, { onDelete: "cascade" }).notNull(),
  schoolYearId: (0, import_pg_core.integer)("school_year_id").references(() => academicYears.id, { onDelete: "cascade" }).notNull(),
  termId: (0, import_pg_core.integer)("term_id").references(() => schoolTerms.id, { onDelete: "set null" }).notNull(),
  average: (0, import_pg_core.text)("average"),
  totalPoints: (0, import_pg_core.text)("total_points").notNull(),
  totalCoefficients: (0, import_pg_core.text)("total_coefficients").notNull(),
  rank: (0, import_pg_core.integer)("rank"),
  mention: (0, import_pg_core.text)("mention"),
  appreciation: (0, import_pg_core.text)("appreciation"),
  generatedAt: (0, import_pg_core.timestamp)("generated_at").defaultNow().notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow().notNull(),
  updatedAt: (0, import_pg_core.timestamp)("updated_at").defaultNow().notNull()
});
var bulletinLines = (0, import_pg_core.pgTable)("bulletin_lines", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  bulletinId: (0, import_pg_core.integer)("bulletin_id").references(() => bulletins.id, { onDelete: "cascade" }).notNull(),
  subjectId: (0, import_pg_core.integer)("subject_id"),
  subjectName: (0, import_pg_core.text)("subject_name").notNull(),
  coefficient: (0, import_pg_core.integer)("coefficient").notNull(),
  average: (0, import_pg_core.text)("average"),
  teacherComment: (0, import_pg_core.text)("teacher_comment"),
  rank: (0, import_pg_core.integer)("rank"),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow().notNull()
});
var auditEvents = (0, import_pg_core.pgTable)("audit_events", {
  id: (0, import_pg_core.serial)("id").primaryKey(),
  actorUserId: (0, import_pg_core.integer)("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorRole: (0, import_pg_core.text)("actor_role").notNull(),
  actorEmail: (0, import_pg_core.text)("actor_email"),
  actorName: (0, import_pg_core.text)("actor_name"),
  action: (0, import_pg_core.text)("action").notNull(),
  resourceType: (0, import_pg_core.text)("resource_type").notNull(),
  resourceId: (0, import_pg_core.integer)("resource_id"),
  schoolId: (0, import_pg_core.integer)("school_id").references(() => schools.id, { onDelete: "cascade" }),
  description: (0, import_pg_core.text)("description").notNull(),
  createdAt: (0, import_pg_core.timestamp)("created_at").defaultNow()
});
var schoolsRelations = (0, import_drizzle_orm.relations)(schools, ({ many }) => ({
  academicYears: many(academicYears),
  users: many(users),
  classes: many(classes),
  students: many(students),
  schoolSubjects: many(schoolSubjects)
}));
var academicYearsRelations = (0, import_drizzle_orm.relations)(academicYears, ({ one, many }) => ({
  school: one(schools, {
    fields: [academicYears.schoolId],
    references: [schools.id]
  }),
  terms: many(schoolTerms),
  classes: many(classes)
}));
var schoolTermsRelations = (0, import_drizzle_orm.relations)(schoolTerms, ({ one, many }) => ({
  school: one(schools, {
    fields: [schoolTerms.schoolId],
    references: [schools.id]
  }),
  academicYear: one(academicYears, {
    fields: [schoolTerms.academicYearId],
    references: [academicYears.id]
  }),
  evaluations: many(evaluations)
}));
var subjectsRelations = (0, import_drizzle_orm.relations)(subjects, ({ one, many }) => ({
  school: one(schools, {
    fields: [subjects.schoolId],
    references: [schools.id]
  }),
  schoolSubjects: many(schoolSubjects)
}));
var schoolSubjectsRelations = (0, import_drizzle_orm.relations)(schoolSubjects, ({ one }) => ({
  school: one(schools, {
    fields: [schoolSubjects.schoolId],
    references: [schools.id]
  }),
  subject: one(subjects, {
    fields: [schoolSubjects.subjectId],
    references: [subjects.id]
  })
}));
var usersRelations = (0, import_drizzle_orm.relations)(users, ({ one, many }) => ({
  school: one(schools, {
    fields: [users.schoolId],
    references: [schools.id]
  }),
  teacherProfile: one(teachers, {
    fields: [users.id],
    references: [teachers.userId]
  }),
  parentProfile: one(parents, {
    fields: [users.id],
    references: [parents.userId]
  }),
  notifications: many(notifications)
}));
var teachersRelations = (0, import_drizzle_orm.relations)(teachers, ({ one, many }) => ({
  user: one(users, {
    fields: [teachers.userId],
    references: [users.id]
  }),
  school: one(schools, {
    fields: [teachers.schoolId],
    references: [schools.id]
  }),
  classes: many(classes),
  classAssignments: many(classTeachers),
  evaluations: many(evaluations)
}));
var classTeachersRelations = (0, import_drizzle_orm.relations)(classTeachers, ({ one }) => ({
  class: one(classes, {
    fields: [classTeachers.classId],
    references: [classes.id]
  }),
  teacher: one(teachers, {
    fields: [classTeachers.teacherId],
    references: [teachers.id]
  })
}));
var parentsRelations = (0, import_drizzle_orm.relations)(parents, ({ one, many }) => ({
  user: one(users, {
    fields: [parents.userId],
    references: [users.id]
  }),
  students: many(students),
  school: one(schools, {
    fields: [parents.schoolId],
    references: [schools.id]
  })
}));
var classesRelations = (0, import_drizzle_orm.relations)(classes, ({ one, many }) => ({
  school: one(schools, {
    fields: [classes.schoolId],
    references: [schools.id]
  }),
  academicYear: one(academicYears, {
    fields: [classes.academicYearId],
    references: [academicYears.id]
  }),
  mainTeacher: one(teachers, {
    fields: [classes.teacherId],
    references: [teachers.id]
  }),
  students: many(students),
  evaluations: many(evaluations),
  absences: many(absences),
  schoolClasses: many(schoolClasses)
}));
var schoolClassesRelations = (0, import_drizzle_orm.relations)(schoolClasses, ({ one }) => ({
  school: one(schools, {
    fields: [schoolClasses.schoolId],
    references: [schools.id]
  }),
  class: one(classes, {
    fields: [schoolClasses.classId],
    references: [classes.id]
  })
}));
var studentsRelations = (0, import_drizzle_orm.relations)(students, ({ one, many }) => ({
  school: one(schools, {
    fields: [students.schoolId],
    references: [schools.id]
  }),
  class: one(classes, {
    fields: [students.classId],
    references: [classes.id]
  }),
  parent: one(parents, {
    fields: [students.parentId],
    references: [parents.id]
  }),
  grades: many(grades),
  absences: many(absences),
  bulletins: many(bulletins)
}));
var bulletinsRelations = (0, import_drizzle_orm.relations)(bulletins, ({ one, many }) => ({
  student: one(students, {
    fields: [bulletins.studentId],
    references: [students.id]
  }),
  class: one(classes, {
    fields: [bulletins.classId],
    references: [classes.id]
  }),
  schoolYear: one(academicYears, {
    fields: [bulletins.schoolYearId],
    references: [academicYears.id]
  }),
  term: one(schoolTerms, {
    fields: [bulletins.termId],
    references: [schoolTerms.id]
  }),
  lines: many(bulletinLines)
}));
var bulletinLinesRelations = (0, import_drizzle_orm.relations)(bulletinLines, ({ one }) => ({
  bulletin: one(bulletins, {
    fields: [bulletinLines.bulletinId],
    references: [bulletins.id]
  })
}));
var evaluationsRelations = (0, import_drizzle_orm.relations)(evaluations, ({ one, many }) => ({
  class: one(classes, {
    fields: [evaluations.classId],
    references: [classes.id]
  }),
  teacher: one(teachers, {
    fields: [evaluations.teacherId],
    references: [teachers.id]
  }),
  term: one(schoolTerms, {
    fields: [evaluations.termId],
    references: [schoolTerms.id]
  }),
  grades: many(grades)
}));
var gradesRelations = (0, import_drizzle_orm.relations)(grades, ({ one }) => ({
  evaluation: one(evaluations, {
    fields: [grades.evaluationId],
    references: [evaluations.id]
  }),
  student: one(students, {
    fields: [grades.studentId],
    references: [students.id]
  })
}));
var absencesRelations = (0, import_drizzle_orm.relations)(absences, ({ one }) => ({
  student: one(students, {
    fields: [absences.studentId],
    references: [students.id]
  }),
  class: one(classes, {
    fields: [absences.classId],
    references: [classes.id]
  })
}));
var notificationsRelations = (0, import_drizzle_orm.relations)(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.userId],
    references: [users.id]
  })
}));

// src/db/index.ts
var envPath = import_path.default.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });
var requiredEnvVars = ["SQL_HOST", "SQL_USER", "SQL_PASSWORD", "SQL_DB_NAME"];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required database environment variable: ${key}. Ensure ${envPath} exists and contains ${key}.`);
  }
}
var createPool = () => {
  console.log("Connecting to Postgres using:", {
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT ?? 5432,
    database: process.env.SQL_DB_NAME,
    user: process.env.SQL_USER
  });
  return new import_pg.default.Pool({
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    connectionTimeoutMillis: 15e3
  });
};
var pool = createPool();
pool.on("error", (err) => {
  console.error("Unexpected error on idle SQL pool client:", err);
});
var db = (0, import_node_postgres.drizzle)(pool, { schema: schema_exports });

// src/db/helpers.ts
var import_drizzle_orm2 = require("drizzle-orm");
async function ensureSchoolClassesTableExists() {
  try {
    await db.execute(import_drizzle_orm2.sql`CREATE TABLE IF NOT EXISTS school_classes (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id),
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );`);
    await db.execute(import_drizzle_orm2.sql`CREATE UNIQUE INDEX IF NOT EXISTS school_classes_school_id_class_id_idx ON school_classes (school_id, class_id);`);
  } catch (err) {
    console.error("Failed to ensure school_classes table exists:", err?.message || err);
    throw err;
  }
}
async function ensureUsersTableSchema() {
  try {
    await db.execute(import_drizzle_orm2.sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id);`);
    await db.execute(import_drizzle_orm2.sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;`);
    await db.execute(import_drizzle_orm2.sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;`);
    const duplicateCheck = await db.execute(import_drizzle_orm2.sql`SELECT 1 AS duplicate
      FROM users
      GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
      LIMIT 1;`);
    if (Array.isArray(duplicateCheck.rows) && duplicateCheck.rows.length > 0) {
      console.warn("Skipping users.email UNIQUE constraint because duplicate emails already exist; new duplicates are blocked by application checks.");
    } else {
      await db.execute(import_drizzle_orm2.sql`ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);`);
    }
  } catch (err) {
    console.error("Failed to ensure users table schema exists:", err?.message || err);
    throw err;
  }
}
async function ensureUserSchoolsTableExists() {
  try {
    await db.execute(import_drizzle_orm2.sql`CREATE TABLE IF NOT EXISTS user_schools (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      role TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT now()
    );`);
    await db.execute(import_drizzle_orm2.sql`CREATE UNIQUE INDEX IF NOT EXISTS user_schools_user_id_school_id_idx ON user_schools (user_id, school_id);`);
    await db.execute(import_drizzle_orm2.sql`ALTER TABLE user_schools ADD COLUMN IF NOT EXISTS role TEXT;`);
    await db.execute(import_drizzle_orm2.sql`ALTER TABLE user_schools ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;`);
    await db.execute(import_drizzle_orm2.sql`ALTER TABLE user_schools ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();`);
    await db.execute(import_drizzle_orm2.sql`
      UPDATE user_schools
      SET role = 'teacher'
      FROM teachers
      WHERE user_schools.role IS NULL
        AND user_schools.user_id = teachers.user_id
        AND user_schools.school_id = teachers.school_id;
    `);
    await db.execute(import_drizzle_orm2.sql`
      UPDATE user_schools
      SET role = 'parent'
      FROM parents
      WHERE user_schools.role IS NULL
        AND user_schools.user_id = parents.user_id
        AND user_schools.school_id = parents.school_id;
    `);
    await db.execute(import_drizzle_orm2.sql`
      UPDATE user_schools
      SET role = users.role
      FROM users
      WHERE user_schools.role IS NULL
        AND user_schools.user_id = users.id
        AND users.role IN ('teacher', 'parent', 'school_admin', 'student');
    `);
    await db.execute(import_drizzle_orm2.sql`UPDATE user_schools SET is_active = true WHERE is_active IS NULL;`);
    await db.execute(import_drizzle_orm2.sql`ALTER TABLE user_schools ALTER COLUMN role SET NOT NULL;`);
  } catch (err) {
    console.error("Failed to ensure user_schools table exists:", err?.message || err);
    throw err;
  }
}
async function seedDatabaseIfEmpty() {
  try {
    const schoolCountResult = await db.select({ count: import_drizzle_orm2.sql`count(*)::integer` }).from(schools);
    const count = schoolCountResult[0]?.count || 0;
    if (count > 0) {
      console.log("Database already seeded or has schools. Skipping seed.");
      return;
    }
    console.log("Database is empty. Initializing seed data for EcoleTrack...");
    const schoolInsert = await db.insert(schools).values({
      name: "C.S LE SAVOIR",
      address: "25 Avenue de la R\xE9publique, 75011 Paris",
      phone: "+228 90000000"
    }).returning();
    const mainSchool = schoolInsert[0];
    const yearInsert = await db.insert(academicYears).values({
      schoolId: mainSchool.id,
      name: "2025-2026",
      isActive: true
    }).returning();
    const activeYear = yearInsert[0];
    const defaultTerms = [
      { name: "Trimestre 1", orderIndex: 1 },
      { name: "Trimestre 2", orderIndex: 2 },
      { name: "Trimestre 3", orderIndex: 3 }
    ];
    for (const term of defaultTerms) {
      await db.insert(schoolTerms).values({
        schoolId: mainSchool.id,
        academicYearId: activeYear.id,
        name: term.name,
        orderIndex: term.orderIndex,
        isActive: true
      });
    }
    const superAdminUser = await db.insert(users).values({
      uid: "sim_superadmin_123",
      email: "superadmin@ecoletrack.fr",
      name: "M. Jean-Marc Super-Admin",
      role: "super_admin"
    }).returning();
    const schoolAdminUser = await db.insert(users).values({
      uid: "sim_schooladmin_123",
      email: "valerie.admin@ecoletrack.fr",
      name: "Directrice Val\xE9rie Bertrand",
      role: "school_admin",
      schoolId: mainSchool.id
    }).returning();
    const teacherUser = await db.insert(users).values({
      uid: "sim_teacher_123",
      email: "f.martin.prof@ecoletrack.fr",
      name: "M. Fran\xE7ois Martin",
      role: "teacher",
      schoolId: mainSchool.id
    }).returning();
    const parentUser = await db.insert(users).values({
      uid: "sim_parent_123",
      email: "marianne.dubois@gmail.com",
      name: "Mme. Marianne Dubois",
      role: "parent",
      schoolId: mainSchool.id
    }).returning();
    const teacherProfileInsert = await db.insert(teachers).values({
      userId: teacherUser[0].id,
      schoolId: mainSchool.id,
      phone: "+228 90000000",
      specialization: "Math\xE9matiques & Sciences Physiques"
    }).returning();
    const mathTeacher = teacherProfileInsert[0];
    const parentProfileInsert = await db.insert(parents).values({
      userId: parentUser[0].id,
      phone: "+228 90000000",
      address: "14 Rue des Lilas, 75011 Paris"
    }).returning();
    const mamanDubois = parentProfileInsert[0];
    const classNames = [
      // 4ème
      "4\xE8me A",
      "4\xE8me B",
      "4\xE8me C",
      "4\xE8me D",
      "4\xE8me E",
      "4\xE8me F",
      // 3ème
      "3\xE8me",
      "3\xE8me A",
      "3\xE8me B",
      "3\xE8me C",
      "3\xE8me D",
      "3\xE8me E",
      "3\xE8me F",
      // 2nde A4 then 2nde CD variants
      "2nde A4 1",
      "2nde A4 2",
      "2nde A4 3",
      "2nde CD",
      "2nde CD 1",
      "2nde CD 2",
      "2nde CD 3",
      "2nde 1",
      "2nde 2",
      "2nde 3",
      "2nde 4",
      "2nde 5",
      "2nde 6",
      // 1ère A4 variants, then 1ère D then other 1ère
      "1\xE8re A4",
      "1\xE8re A4 1",
      "1\xE8re A4 2",
      "1\xE8re A4 3",
      "1\xE8re D",
      "1\xE8re D 1",
      "1\xE8re 1",
      "1\xE8re 2",
      "1\xE8re 3",
      "1\xE8re 4",
      "1\xE8re 5",
      "1\xE8re 6",
      // Terminale: A4 variants, then D variants, then other Tle
      "Tle A4",
      "Tle A4 1",
      "Tle A4 2",
      "Tle A4 3",
      "Tle D",
      "Tle D 1",
      "Tle D2",
      "Tle D3",
      "Tle 1",
      "Tle 2",
      "Tle 3",
      "Tle 4",
      "Tle 5",
      "Tle 6"
    ];
    const createdClasses = [];
    for (const className of classNames) {
      const classInsert = await db.insert(classes).values({
        schoolId: mainSchool.id,
        academicYearId: activeYear.id,
        name: className
      }).returning();
      createdClasses.push(classInsert[0]);
    }
    const terminaleS1 = createdClasses.find((c) => c.name === "Tle A4 1") || createdClasses[0];
    const student1 = await db.insert(students).values({
      schoolId: mainSchool.id,
      classId: terminaleS1.id,
      firstName: "Lucas",
      lastName: "Dubois",
      birthDate: "2008-04-12",
      parentId: mamanDubois.id,
      schoolAdminId: schoolAdminUser[0].id
    }).returning();
    const student2 = await db.insert(students).values({
      schoolId: mainSchool.id,
      classId: terminaleS1.id,
      firstName: "Chlo\xE9",
      lastName: "Dubois",
      // Chloe is lucas' sister
      birthDate: "2010-09-25",
      parentId: mamanDubois.id,
      schoolAdminId: schoolAdminUser[0].id
    }).returning();
    const parentUserExtra = await db.insert(users).values({
      uid: "sim_parent_extra",
      email: "robert.thomas@gmail.com",
      name: "M. Robert Thomas",
      role: "parent",
      schoolId: mainSchool.id
    }).returning();
    const papaThomasProf = await db.insert(parents).values({
      userId: parentUserExtra[0].id,
      phone: "+228 90000000",
      address: "29 Boulevard Voltaire, Paris"
    }).returning();
    const student3 = await db.insert(students).values({
      schoolId: mainSchool.id,
      classId: terminaleS1.id,
      firstName: "Thomas",
      lastName: "Robert",
      birthDate: "2008-11-30",
      parentId: papaThomasProf[0].id,
      schoolAdminId: schoolAdminUser[0].id
    }).returning();
    const student4 = await db.insert(students).values({
      schoolId: mainSchool.id,
      classId: terminaleS1.id,
      firstName: "In\xE8s",
      lastName: "Robert",
      birthDate: "2008-01-14",
      parentId: papaThomasProf[0].id,
      schoolAdminId: schoolAdminUser[0].id
    }).returning();
    const evalMath1 = await db.insert(evaluations).values({
      classId: terminaleS1.id,
      teacherId: mathTeacher.id,
      subject: "Math\xE9matiques",
      title: "Alg\xE8bre - Fonctions et Limites",
      coefficient: 2,
      maxScore: 20,
      date: "2026-06-10"
    }).returning();
    const evalMath2 = await db.insert(evaluations).values({
      classId: terminaleS1.id,
      teacherId: mathTeacher.id,
      subject: "Math\xE9matiques",
      title: "G\xE9om\xE9trie analytique - Vecteurs de l'espace",
      coefficient: 1,
      maxScore: 20,
      date: "2026-06-15"
    }).returning();
    await db.insert(grades).values([
      { evaluationId: evalMath1[0].id, studentId: student1[0].id, score: "14.5", remarks: "Bon travail, continuez ainsi." },
      { evaluationId: evalMath2[0].id, studentId: student1[0].id, score: "16.0", remarks: "Excellent devoir, tr\xE8s bonne raisonnement." }
    ]);
    await db.insert(grades).values([
      { evaluationId: evalMath1[0].id, studentId: student2[0].id, score: "18.0", remarks: "Parfait ! Excellente ma\xEEtrise." },
      { evaluationId: evalMath2[0].id, studentId: student2[0].id, score: "15.0", remarks: "Tr\xE8s bon travail." }
    ]);
    await db.insert(grades).values([
      { evaluationId: evalMath1[0].id, studentId: student3[0].id, score: "11.0", remarks: "Quelques erreurs d'\xE9tourderie." },
      { evaluationId: evalMath2[0].id, studentId: student3[0].id, score: "12.5", remarks: "Moyen mais s\xE9rieux." }
    ]);
    await db.insert(grades).values([
      { evaluationId: evalMath1[0].id, studentId: student4[0].id, score: "15.0", remarks: "Tr\xE8s satisfaisant." },
      { evaluationId: evalMath2[0].id, studentId: student4[0].id, score: "14.0", remarks: "Bien compris." }
    ]);
    await db.insert(absences).values([
      {
        studentId: student1[0].id,
        classId: terminaleS1.id,
        date: "2026-06-12",
        period: "morning",
        isJustified: false
      },
      {
        studentId: student1[0].id,
        classId: terminaleS1.id,
        date: "2026-06-18",
        period: "afternoon",
        isJustified: true,
        justificationReason: "Rendez-vous m\xE9dical chez le dentiste (justificatif fourni)."
      },
      {
        studentId: student3[0].id,
        classId: terminaleS1.id,
        date: "2026-06-19",
        period: "all_day",
        isJustified: false
      }
    ]);
    await db.insert(notifications).values([
      {
        userId: parentUser[0].id,
        title: "Absence enregistr\xE9e de Lucas",
        body: "Lucas Dubois a \xE9t\xE9 marqu\xE9 absent ce matin (2026-06-12). Veuillez justifier cette absence dans votre espace.",
        type: "absence",
        isRead: false
      },
      {
        userId: parentUser[0].id,
        title: "Nouvelle note disponible",
        body: "Lucas Dubois a re\xE7u une note de 16.0/20 pour l'\xE9valuation : G\xE9om\xE9trie analytique.",
        type: "grade",
        isRead: false
      },
      {
        userId: parentUser[0].id,
        title: "Information de l'\xE9tablissement",
        body: "Rappel : La r\xE9union parents-professeurs aura lieu vendredi prochain \xE0 partir de 17h.",
        type: "info",
        isRead: true
      }
    ]);
    console.log("Seeding finished successfully. The database has been pre-populated.");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}

// src/middleware/auth.ts
var import_jsonwebtoken = __toESM(require("jsonwebtoken"), 1);
var import_drizzle_orm3 = require("drizzle-orm");
var mapToAppRole = (rawRole) => {
  if (!rawRole) return void 0;
  if (rawRole === "super_admin" || rawRole === "school_admin" || rawRole === "admin") return "admin";
  if (rawRole === "teacher") return "teacher";
  if (rawRole === "parent") return "parent";
  if (rawRole === "student") return "student";
  return void 0;
};
var verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const simulatedRoleHeader = req.headers["x-simulated-role"];
  const simulatedRole = typeof simulatedRoleHeader === "string" ? simulatedRoleHeader : Array.isArray(simulatedRoleHeader) ? simulatedRoleHeader[0] : void 0;
  const simulatedUidHeader = req.headers["x-simulated-uid"];
  const simulatedUid = typeof simulatedUidHeader === "string" ? simulatedUidHeader : Array.isArray(simulatedUidHeader) ? simulatedUidHeader[0] : void 0;
  const simulatedEmailHeader = req.headers["x-simulated-email"];
  const simulatedEmail = typeof simulatedEmailHeader === "string" ? simulatedEmailHeader : Array.isArray(simulatedEmailHeader) ? simulatedEmailHeader[0] : void 0;
  const simulatedNameHeader = req.headers["x-simulated-name"];
  const simulatedName = typeof simulatedNameHeader === "string" ? simulatedNameHeader : Array.isArray(simulatedNameHeader) ? simulatedNameHeader[0] : void 0;
  const simulatedSchoolIdHeader = req.headers["x-simulated-school-id"];
  const simulatedSchoolId = typeof simulatedSchoolIdHeader === "string" ? Number(simulatedSchoolIdHeader) : Array.isArray(simulatedSchoolIdHeader) ? Number(simulatedSchoolIdHeader[0]) : null;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    if (simulatedRole) {
      req.user = {
        uid: simulatedUid || `sim_${simulatedRole}_123`,
        email: simulatedEmail || `${simulatedRole}@ecoletrack.fr`,
        name: simulatedName || "Utilisateur simul\xE9",
        role: simulatedRole,
        appRole: mapToAppRole(simulatedRole),
        schoolId: Number.isFinite(simulatedSchoolId) ? simulatedSchoolId : null,
        simulated: true
      };
      return next();
    }
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    const secret = process.env.JWT_SECRET || "dev-jwt-secret";
    const decoded = import_jsonwebtoken.default.verify(token, secret);
    const uid = decoded?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }
    const [dbUser] = await db.select().from(users).where((0, import_drizzle_orm3.eq)(users.uid, uid));
    if (!dbUser) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }
    req.user = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      name: dbUser.name || dbUser.email || "Utilisateur",
      role: dbUser.role,
      appRole: mapToAppRole(dbUser.role),
      schoolId: dbUser.schoolId ?? null
    };
    return next();
  } catch (error) {
    console.error("Error verifying JWT:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};
var requireAuth = verifyToken;
var requireRole = (allowedRoles) => (req, res, next) => {
  const role = req.user?.appRole;
  if (!role || !allowedRoles.includes(role)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};
var requireOwnership = (resolver, options) => {
  const bypassRoles = options?.bypassRoles ?? [];
  return async (req, res, next) => {
    const role = req.user?.appRole;
    if (role && bypassRoles.includes(role)) {
      return next();
    }
    try {
      const isOwner = await resolver(req);
      if (!isOwner) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return next();
    } catch (error) {
      console.error("Ownership check failed:", error);
      return res.status(500).json({ error: "Failed to validate ownership" });
    }
  };
};

// src/lib/gradeValidation.ts
function validateGradeScore(score, maxScore) {
  if (score === null || score === void 0 || String(score).trim() === "") {
    return { isValid: false, error: "La note est requise" };
  }
  const raw = String(score).trim();
  const parsed = typeof score === "number" ? score : Number(raw);
  if (!Number.isFinite(parsed)) {
    return { isValid: false, error: "La note doit \xEAtre un nombre valide" };
  }
  if (parsed < 0) {
    return { isValid: false, error: "La note ne peut pas \xEAtre n\xE9gative" };
  }
  if (maxScore != null && maxScore !== void 0 && parsed > maxScore) {
    return { isValid: false, error: `La note ne peut pas d\xE9passer ${maxScore}` };
  }
  return { isValid: true };
}

// src/lib/emailUniqueness.ts
function normalizeEmail(email) {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

// src/lib/bulletinSnapshotService.ts
var import_drizzle_orm4 = require("drizzle-orm");

// src/lib/bulletinService.ts
var parseNumericScore = (score) => {
  const normalized = String(score).trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
var findLatestGradeForStudent = (evaluationId, studentId, grades2) => {
  for (let index = grades2.length - 1; index >= 0; index -= 1) {
    const grade = grades2[index];
    if (grade.evaluationId === evaluationId && grade.studentId === studentId) {
      return grade;
    }
  }
  return null;
};
var normalizeScore = (rawScore, maxScore) => {
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    return null;
  }
  return rawScore / maxScore * 20;
};
var resolveCoefficient = (evaluation) => {
  const coefficient = Number(evaluation.coefficient ?? 1);
  return Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 0;
};
var calculateStudentTermAverage = ({ term, student, evaluations: evaluations2, grades: grades2 }) => {
  const selectedEvaluations = evaluations2.filter((evaluation) => {
    if (evaluation.classId !== student.classId) return false;
    if (evaluation.countInBulletin === false) return false;
    return evaluation.termId === term.id || evaluation.termId == null;
  });
  const snapshots = [];
  let totalWeightedScore = 0;
  let totalCoefficient = 0;
  for (const evaluation of selectedEvaluations) {
    const coefficient = resolveCoefficient(evaluation);
    const latestGrade = findLatestGradeForStudent(evaluation.id, student.id, grades2);
    if (!latestGrade) {
      snapshots.push({
        evaluationId: evaluation.id,
        title: evaluation.title,
        subject: evaluation.subject,
        coefficient,
        maxScore: evaluation.maxScore,
        rawScore: null,
        normalizedScore: null,
        weightedScore: null,
        countedInAverage: false,
        excludedReason: "missing-grade"
      });
      continue;
    }
    const rawScore = parseNumericScore(latestGrade.score);
    if (rawScore == null) {
      snapshots.push({
        evaluationId: evaluation.id,
        title: evaluation.title,
        subject: evaluation.subject,
        coefficient,
        maxScore: evaluation.maxScore,
        rawScore: null,
        normalizedScore: null,
        weightedScore: null,
        countedInAverage: false,
        excludedReason: "invalid-score"
      });
      continue;
    }
    const normalizedScore = normalizeScore(rawScore, evaluation.maxScore);
    if (normalizedScore == null || coefficient <= 0) {
      snapshots.push({
        evaluationId: evaluation.id,
        title: evaluation.title,
        subject: evaluation.subject,
        coefficient,
        maxScore: evaluation.maxScore,
        rawScore,
        normalizedScore,
        weightedScore: null,
        countedInAverage: false,
        excludedReason: coefficient <= 0 ? "invalid-score" : "invalid-max-score"
      });
      continue;
    }
    const weightedScore = normalizedScore * coefficient;
    totalCoefficient += coefficient;
    totalWeightedScore += weightedScore;
    snapshots.push({
      evaluationId: evaluation.id,
      title: evaluation.title,
      subject: evaluation.subject,
      coefficient,
      maxScore: evaluation.maxScore,
      rawScore,
      normalizedScore,
      weightedScore,
      countedInAverage: true
    });
  }
  const average = totalCoefficient > 0 ? totalWeightedScore / totalCoefficient : null;
  return {
    termId: term.id,
    studentId: student.id,
    selectedEvaluations,
    snapshots,
    totalCoefficient,
    totalWeightedScore,
    average
  };
};

// src/lib/bulletinSnapshotService.ts
var toStoredNumber = (value) => {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(4);
};
var toStoredStrictNumber = (value) => {
  if (!Number.isFinite(value)) return "0.0000";
  return value.toFixed(4);
};
var resolveMention = (average) => {
  if (average == null) return null;
  if (average >= 16) return "Tr\xE8s bien";
  if (average >= 14) return "Bien";
  if (average >= 12) return "Assez bien";
  if (average >= 10) return "Passable";
  return "Insuffisant";
};
var resolveAppreciation = (average) => {
  if (average == null) return "Aucune note disponible pour ce trimestre.";
  if (average >= 16) return "Excellent trimestre, continuez ainsi.";
  if (average >= 14) return "Tr\xE8s bon trimestre avec des r\xE9sultats solides.";
  if (average >= 12) return "Bon trimestre, efforts r\xE9guliers.";
  if (average >= 10) return "Trimestre satisfaisant, peut progresser.";
  return "Des efforts suppl\xE9mentaires sont attendus.";
};
var computeSubjectLines = (evaluations2, snapshots) => {
  const bySubject = /* @__PURE__ */ new Map();
  for (const evaluation of evaluations2) {
    const current = bySubject.get(evaluation.subject) ?? { coefficient: 0, weighted: 0, weightedCoefficient: 0 };
    current.coefficient += Math.max(0, Number(evaluation.coefficient || 0));
    bySubject.set(evaluation.subject, current);
  }
  for (const snapshot of snapshots) {
    if (!snapshot.countedInAverage || snapshot.normalizedScore == null) continue;
    const current = bySubject.get(snapshot.subject) ?? { coefficient: 0, weighted: 0, weightedCoefficient: 0 };
    current.weighted += snapshot.normalizedScore * snapshot.coefficient;
    current.weightedCoefficient += snapshot.coefficient;
    bySubject.set(snapshot.subject, current);
  }
  return Array.from(bySubject.entries()).map(([subjectName, agg]) => ({
    subjectId: null,
    subjectName,
    coefficient: agg.coefficient,
    average: agg.weightedCoefficient > 0 ? agg.weighted / agg.weightedCoefficient : null,
    teacherComment: null,
    rank: null
  }));
};
var computeRank = (targetStudentId, classStudents, termEvaluations, allGrades, termId) => {
  const averages = classStudents.map((student) => {
    const studentGrades = allGrades.filter((grade) => grade.studentId === student.id);
    const result = calculateStudentTermAverage({
      term: { id: termId },
      student,
      evaluations: termEvaluations,
      grades: studentGrades
    });
    return { studentId: student.id, average: result.average };
  }).filter((entry) => entry.average != null).sort((a, b) => b.average - a.average);
  const rank = averages.findIndex((entry) => entry.studentId === targetStudentId);
  return rank >= 0 ? rank + 1 : null;
};
var createDbBulletinSnapshotPersistence = () => ({
  transaction: async (run) => {
    return db.transaction(async (tx) => {
      const ctx = {
        async getStudentById(studentId) {
          const [row] = await tx.select({
            id: students.id,
            classId: students.classId,
            schoolId: students.schoolId,
            firstName: students.firstName,
            lastName: students.lastName
          }).from(students).where((0, import_drizzle_orm4.eq)(students.id, studentId));
          return row ?? null;
        },
        async getClassById(classId) {
          const [row] = await tx.select({
            id: classes.id,
            academicYearId: classes.academicYearId
          }).from(classes).where((0, import_drizzle_orm4.eq)(classes.id, classId));
          return row ?? null;
        },
        async getTermById(termId) {
          const [row] = await tx.select({
            id: schoolTerms.id,
            academicYearId: schoolTerms.academicYearId
          }).from(schoolTerms).where((0, import_drizzle_orm4.eq)(schoolTerms.id, termId));
          return row ?? null;
        },
        async getClassStudents(classId) {
          return tx.select({
            id: students.id,
            classId: students.classId,
            schoolId: students.schoolId,
            firstName: students.firstName,
            lastName: students.lastName
          }).from(students).where((0, import_drizzle_orm4.eq)(students.classId, classId));
        },
        async getClassTermEvaluations(classId, termId) {
          return tx.select({
            id: evaluations.id,
            classId: evaluations.classId,
            termId: evaluations.termId,
            subject: evaluations.subject,
            title: evaluations.title,
            coefficient: evaluations.coefficient,
            maxScore: evaluations.maxScore,
            countInBulletin: evaluations.countInBulletin
          }).from(evaluations).where((0, import_drizzle_orm4.and)(
            (0, import_drizzle_orm4.eq)(evaluations.classId, classId),
            (0, import_drizzle_orm4.or)(
              (0, import_drizzle_orm4.eq)(evaluations.termId, termId),
              (0, import_drizzle_orm4.and)(
                import_drizzle_orm4.sql`${evaluations.termId} IS NULL`,
                import_drizzle_orm4.sql`EXISTS (
                  SELECT 1
                  FROM school_terms st
                  WHERE st.id = ${termId}
                    AND st.start_date IS NOT NULL
                    AND st.end_date IS NOT NULL
                    AND ${evaluations.date} >= st.start_date
                    AND ${evaluations.date} <= st.end_date
                )`
              )
            )
          ));
        },
        async getGradesForStudents(studentIds, evaluationIds) {
          if (studentIds.length === 0 || evaluationIds.length === 0) return [];
          return tx.select({
            id: grades.id,
            evaluationId: grades.evaluationId,
            studentId: grades.studentId,
            score: grades.score
          }).from(grades).where((0, import_drizzle_orm4.and)((0, import_drizzle_orm4.inArray)(grades.studentId, studentIds), (0, import_drizzle_orm4.inArray)(grades.evaluationId, evaluationIds)));
        },
        async insertBulletin(payload) {
          const [inserted] = await tx.insert(bulletins).values({
            studentId: payload.studentId,
            classId: payload.classId,
            schoolYearId: payload.schoolYearId,
            termId: payload.termId,
            average: toStoredNumber(payload.average),
            totalPoints: toStoredStrictNumber(payload.totalPoints),
            totalCoefficients: toStoredStrictNumber(payload.totalCoefficients),
            rank: payload.rank,
            mention: payload.mention,
            appreciation: payload.appreciation,
            generatedAt: payload.generatedAt
          }).returning({ id: bulletins.id });
          return inserted;
        },
        async insertBulletinLines(bulletinId, lines) {
          if (lines.length === 0) return;
          await tx.insert(bulletinLines).values(lines.map((line) => ({
            bulletinId,
            subjectId: line.subjectId,
            subjectName: line.subjectName,
            coefficient: line.coefficient,
            average: toStoredNumber(line.average),
            teacherComment: line.teacherComment ?? null,
            rank: line.rank ?? null
          })));
        }
      };
      return run(ctx);
    });
  }
});
var registerBulletinGenerateRoute = (app, options) => {
  const {
    resolveActor: resolveActor2,
    verifyMiddleware = verifyToken,
    accessMiddleware = requireRole(["admin"]),
    generateHandler = async (studentId, termId) => generateBulletinSnapshot(studentId, termId)
  } = options;
  app.post("/api/bulletins/generate", verifyMiddleware, accessMiddleware, async (req, res) => {
    try {
      const actor = await resolveActor2(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const studentId = Number(req.body?.studentId);
      const termId = Number(req.body?.termId);
      if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(termId) || termId <= 0) {
        return res.status(400).json({ error: "studentId and termId are required" });
      }
      const result = await generateHandler(studentId, termId);
      const createdId = result.id ?? result.bulletinId;
      return res.status(201).json({
        id: createdId,
        studentId: result.studentId,
        termId: result.termId,
        average: result.average,
        rank: result.rank,
        mention: result.mention,
        appreciation: result.appreciation
      });
    } catch (err) {
      console.error("Failed to generate bulletin:", err);
      return res.status(500).json({ error: "Failed to generate bulletin" });
    }
  });
};
var generateBulletinSnapshot = async (studentId, termId, persistence = createDbBulletinSnapshotPersistence()) => {
  return persistence.transaction(async (ctx) => {
    const student = await ctx.getStudentById(studentId);
    if (!student) throw new Error("Student not found");
    const klass = await ctx.getClassById(student.classId);
    if (!klass) throw new Error("Class not found");
    const term = await ctx.getTermById(termId);
    if (!term) throw new Error("Term not found");
    if (klass.academicYearId !== term.academicYearId) {
      throw new Error("Term does not belong to student class academic year");
    }
    const classStudents = await ctx.getClassStudents(student.classId);
    const termEvaluations = await ctx.getClassTermEvaluations(student.classId, termId);
    const evaluationIds = termEvaluations.map((evaluation) => evaluation.id);
    const classStudentIds = classStudents.map((row) => row.id);
    const allGrades = await ctx.getGradesForStudents(classStudentIds, evaluationIds);
    const studentGrades = allGrades.filter((grade) => grade.studentId === student.id);
    const calculation = calculateStudentTermAverage({
      term: { id: term.id },
      student,
      evaluations: termEvaluations,
      grades: studentGrades
    });
    const rank = computeRank(student.id, classStudents, termEvaluations, allGrades, term.id);
    const mention = resolveMention(calculation.average);
    const appreciation = resolveAppreciation(calculation.average);
    const lines = computeSubjectLines(calculation.selectedEvaluations, calculation.snapshots);
    const inserted = await ctx.insertBulletin({
      studentId: student.id,
      classId: student.classId,
      schoolYearId: klass.academicYearId,
      termId: term.id,
      average: calculation.average,
      totalPoints: calculation.totalWeightedScore,
      totalCoefficients: calculation.totalCoefficient,
      rank,
      mention,
      appreciation,
      generatedAt: /* @__PURE__ */ new Date()
    });
    await ctx.insertBulletinLines(inserted.id, lines);
    return {
      bulletinId: inserted.id,
      studentId: student.id,
      termId: term.id,
      average: calculation.average,
      totalPoints: calculation.totalWeightedScore,
      totalCoefficients: calculation.totalCoefficient,
      rank,
      mention,
      appreciation,
      linesCount: lines.length
    };
  });
};

// src/lib/bulletinReadApi.ts
var import_drizzle_orm6 = require("drizzle-orm");

// src/lib/bulletinAccess.ts
var import_drizzle_orm5 = require("drizzle-orm");
var isBulletinOwnedByCurrentUser = async (req) => {
  const userId = req.user?.id;
  if (!userId) return false;
  const bulletinId = Number(req.params?.id);
  if (!Number.isInteger(bulletinId) || bulletinId <= 0) return false;
  const [row] = await db.select({
    studentId: bulletins.studentId,
    parentUserId: parents.userId
  }).from(bulletins).innerJoin(students, (0, import_drizzle_orm5.eq)(bulletins.studentId, students.id)).leftJoin(parents, (0, import_drizzle_orm5.eq)(students.parentId, parents.id)).where((0, import_drizzle_orm5.eq)(bulletins.id, bulletinId));
  if (!row) return false;
  if (row.parentUserId === userId) return true;
  const [parentLink] = await db.select({ id: parents.id }).from(parents).where((0, import_drizzle_orm5.and)((0, import_drizzle_orm5.eq)(parents.userId, userId), (0, import_drizzle_orm5.eq)(parents.studentId, row.studentId)));
  return !!parentLink;
};

// src/lib/teacherScope.ts
function getTeacherClassIdSet(assignments = [], currentSchoolId) {
  return assignments.filter((assignment) => {
    if (currentSchoolId == null) return true;
    return assignment.schoolId == null || assignment.schoolId === currentSchoolId;
  }).map((assignment) => assignment.classId).filter((id) => typeof id === "number");
}

// src/lib/bulletinReadApi.ts
var parseNumber = (value) => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
var toIso = (value) => {
  if (!value) return null;
  return value.toISOString();
};
var buildConditions = async (actor, filters) => {
  const conditions = [];
  if (actor.role === "teacher") {
    if (actor.id == null || actor.schoolId == null) {
      conditions.push(import_drizzle_orm6.sql`1 = 0`);
      return conditions;
    }
    const teacherRows = await db.select({ id: teachers.id }).from(teachers).where((0, import_drizzle_orm6.eq)(teachers.userId, actor.id));
    if (teacherRows.length === 0) {
      conditions.push(import_drizzle_orm6.sql`1 = 0`);
      return conditions;
    }
    const assignmentRows = await db.select({ classId: classTeachers.classId, schoolId: classes.schoolId }).from(classTeachers).innerJoin(classes, (0, import_drizzle_orm6.eq)(classTeachers.classId, classes.id)).where((0, import_drizzle_orm6.eq)(classTeachers.teacherId, teacherRows[0].id));
    const teacherClassIds = getTeacherClassIdSet(assignmentRows, actor.schoolId);
    if (teacherClassIds.length === 0) {
      conditions.push(import_drizzle_orm6.sql`1 = 0`);
      return conditions;
    }
    conditions.push((0, import_drizzle_orm6.eq)(students.schoolId, actor.schoolId));
    conditions.push((0, import_drizzle_orm6.inArray)(bulletins.classId, teacherClassIds));
  } else if (actor.role !== "super_admin") {
    if (actor.schoolId == null) {
      conditions.push(import_drizzle_orm6.sql`1 = 0`);
      return conditions;
    }
    conditions.push((0, import_drizzle_orm6.eq)(students.schoolId, actor.schoolId));
  }
  if (filters?.schoolYearId != null) conditions.push((0, import_drizzle_orm6.eq)(bulletins.schoolYearId, filters.schoolYearId));
  if (filters?.termId != null) conditions.push((0, import_drizzle_orm6.eq)(bulletins.termId, filters.termId));
  if (filters?.classId != null) conditions.push((0, import_drizzle_orm6.eq)(bulletins.classId, filters.classId));
  if (filters?.studentId != null) conditions.push((0, import_drizzle_orm6.eq)(bulletins.studentId, filters.studentId));
  return conditions;
};
var createDbBulletinReadService = () => ({
  async list(actor, filters) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
    const offset = (page - 1) * pageSize;
    const conditions = await buildConditions(actor, filters);
    const whereClause = conditions.length > 0 ? (0, import_drizzle_orm6.and)(...conditions) : void 0;
    let totalQuery = db.select({ count: import_drizzle_orm6.sql`count(*)::integer` }).from(bulletins).innerJoin(students, (0, import_drizzle_orm6.eq)(bulletins.studentId, students.id));
    if (whereClause) totalQuery = totalQuery.where(whereClause);
    const [totalRow] = await totalQuery;
    let listQuery = db.select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      classId: bulletins.classId,
      className: classes.name,
      schoolYearId: bulletins.schoolYearId,
      schoolYearName: academicYears.name,
      termId: bulletins.termId,
      termName: schoolTerms.name,
      average: bulletins.average,
      rank: bulletins.rank,
      mention: bulletins.mention,
      appreciation: bulletins.appreciation,
      generatedAt: bulletins.generatedAt,
      createdAt: bulletins.createdAt,
      updatedAt: bulletins.updatedAt
    }).from(bulletins).innerJoin(students, (0, import_drizzle_orm6.eq)(bulletins.studentId, students.id)).innerJoin(classes, (0, import_drizzle_orm6.eq)(bulletins.classId, classes.id)).innerJoin(academicYears, (0, import_drizzle_orm6.eq)(bulletins.schoolYearId, academicYears.id)).innerJoin(schoolTerms, (0, import_drizzle_orm6.eq)(bulletins.termId, schoolTerms.id)).orderBy((0, import_drizzle_orm6.desc)(bulletins.generatedAt), (0, import_drizzle_orm6.desc)(bulletins.id)).limit(pageSize).offset(offset);
    if (whereClause) listQuery = listQuery.where(whereClause);
    const rows = await listQuery;
    return {
      page,
      pageSize,
      total: totalRow?.count || 0,
      items: rows.map((row) => ({
        id: row.id,
        studentId: row.studentId,
        studentName: `${row.studentFirstName} ${row.studentLastName}`.trim(),
        classId: row.classId,
        className: row.className,
        schoolYearId: row.schoolYearId,
        schoolYearName: row.schoolYearName,
        termId: row.termId,
        termName: row.termName,
        average: parseNumber(row.average),
        rank: row.rank,
        mention: row.mention,
        appreciation: row.appreciation,
        generatedAt: toIso(row.generatedAt),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt)
      }))
    };
  },
  async getById(actor, id) {
    const conditions = await buildConditions(actor);
    conditions.push((0, import_drizzle_orm6.eq)(bulletins.id, id));
    const whereClause = (0, import_drizzle_orm6.and)(...conditions);
    const [header] = await db.select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      classId: bulletins.classId,
      className: classes.name,
      schoolYearId: bulletins.schoolYearId,
      schoolYearName: academicYears.name,
      termId: bulletins.termId,
      termName: schoolTerms.name,
      average: bulletins.average,
      totalPoints: bulletins.totalPoints,
      totalCoefficients: bulletins.totalCoefficients,
      rank: bulletins.rank,
      mention: bulletins.mention,
      appreciation: bulletins.appreciation,
      generatedAt: bulletins.generatedAt,
      createdAt: bulletins.createdAt,
      updatedAt: bulletins.updatedAt
    }).from(bulletins).innerJoin(students, (0, import_drizzle_orm6.eq)(bulletins.studentId, students.id)).innerJoin(classes, (0, import_drizzle_orm6.eq)(bulletins.classId, classes.id)).innerJoin(academicYears, (0, import_drizzle_orm6.eq)(bulletins.schoolYearId, academicYears.id)).innerJoin(schoolTerms, (0, import_drizzle_orm6.eq)(bulletins.termId, schoolTerms.id)).where(whereClause);
    if (!header) return null;
    const lines = await db.select({
      id: bulletinLines.id,
      bulletinId: bulletinLines.bulletinId,
      subjectId: bulletinLines.subjectId,
      subjectName: bulletinLines.subjectName,
      coefficient: bulletinLines.coefficient,
      average: bulletinLines.average,
      teacherComment: bulletinLines.teacherComment,
      rank: bulletinLines.rank,
      createdAt: bulletinLines.createdAt
    }).from(bulletinLines).where((0, import_drizzle_orm6.eq)(bulletinLines.bulletinId, id)).orderBy(bulletinLines.id);
    return {
      id: header.id,
      studentId: header.studentId,
      studentName: `${header.studentFirstName} ${header.studentLastName}`.trim(),
      classId: header.classId,
      className: header.className,
      schoolYearId: header.schoolYearId,
      schoolYearName: header.schoolYearName,
      termId: header.termId,
      termName: header.termName,
      average: parseNumber(header.average),
      totalPoints: parseNumber(header.totalPoints) ?? 0,
      totalCoefficients: parseNumber(header.totalCoefficients) ?? 0,
      rank: header.rank,
      mention: header.mention,
      appreciation: header.appreciation,
      generatedAt: toIso(header.generatedAt),
      createdAt: toIso(header.createdAt),
      updatedAt: toIso(header.updatedAt),
      lines: lines.map((line) => ({
        id: line.id,
        bulletinId: line.bulletinId,
        subjectId: line.subjectId,
        subjectName: line.subjectName,
        coefficient: line.coefficient,
        average: parseNumber(line.average),
        teacherComment: line.teacherComment,
        rank: line.rank,
        createdAt: toIso(line.createdAt)
      }))
    };
  }
});
var parseOptionalPositiveInt = (value) => {
  if (value == null || value === "") return void 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
};
var registerBulletinReadRoutes = (app, options) => {
  const {
    resolveActor: resolveActor2,
    readService = createDbBulletinReadService(),
    verifyMiddleware = verifyToken,
    listAccessMiddleware = requireRole(["admin", "teacher"]),
    detailAccessMiddleware = requireOwnership(isBulletinOwnedByCurrentUser, { bypassRoles: ["admin", "teacher"] })
  } = options;
  app.get("/api/bulletins", verifyMiddleware, listAccessMiddleware, async (req, res) => {
    try {
      const actor = await resolveActor2(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const response = await readService.list(actor, {
        schoolYearId: parseOptionalPositiveInt(req.query.schoolYearId),
        termId: parseOptionalPositiveInt(req.query.termId),
        classId: parseOptionalPositiveInt(req.query.classId),
        studentId: parseOptionalPositiveInt(req.query.studentId),
        page: parseOptionalPositiveInt(req.query.page) ?? 1,
        pageSize: parseOptionalPositiveInt(req.query.pageSize) ?? 20
      });
      return res.json(response);
    } catch (err) {
      console.error("Failed to list persisted bulletins:", err);
      return res.status(500).json({ error: "Failed to list persisted bulletins" });
    }
  });
  app.get("/api/bulletins/:id", verifyMiddleware, detailAccessMiddleware, async (req, res) => {
    try {
      const actor = await resolveActor2(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid bulletin id" });
      }
      const bulletin = await readService.getById(actor, id);
      if (!bulletin) {
        return res.status(404).json({ error: "Bulletin not found" });
      }
      return res.json(bulletin);
    } catch (err) {
      console.error("Failed to retrieve persisted bulletin:", err);
      return res.status(500).json({ error: "Failed to retrieve persisted bulletin" });
    }
  });
};

// src/lib/bulletinPdfApi.ts
var import_drizzle_orm7 = require("drizzle-orm");
var import_pdf_lib = require("pdf-lib");
var import_promises = require("node:fs/promises");
var DEFAULT_TEMPLATE = {
  primaryColor: "#1f3a8a",
  secondaryColor: "#e2e8f0",
  textColor: "#0f172a",
  labels: {
    title: "Bulletin scolaire",
    schoolYear: "Ann\xE9e scolaire",
    term: "Trimestre",
    student: "\xC9l\xE8ve",
    class: "Classe",
    average: "Moyenne g\xE9n\xE9rale",
    rank: "Rang",
    mention: "Mention",
    appreciation: "Appr\xE9ciation g\xE9n\xE9rale",
    generationDate: "Date de g\xE9n\xE9ration",
    subject: "Mati\xE8re",
    coefficient: "Coef",
    subjectAverage: "Moyenne",
    teacherComment: "Appr\xE9ciation",
    signatureSchool: "Signature de l \xE9tablissement",
    signatureParent: "Signature du parent"
  }
};
var parseNumber2 = (value) => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
var parseNumericScore2 = (score) => {
  const normalized = String(score || "").trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
var buildFallbackLinesFromGrades = (rows) => {
  const bySubject = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const coefficient = Number(row.coefficient || 0);
    const maxScore = Number(row.maxScore || 0);
    const rawScore = parseNumericScore2(row.score);
    if (!(coefficient > 0) || !(maxScore > 0) || rawScore == null) continue;
    const normalizedScore = rawScore / maxScore * 20;
    const current = bySubject.get(row.subject) ?? { coefficient: 0, weighted: 0, weightedCoefficient: 0 };
    current.coefficient += coefficient;
    current.weighted += normalizedScore * coefficient;
    current.weightedCoefficient += coefficient;
    bySubject.set(row.subject, current);
  }
  let runningId = 1;
  return Array.from(bySubject.entries()).map(([subjectName, agg]) => ({
    id: runningId++,
    bulletinId: 0,
    subjectId: null,
    subjectName,
    coefficient: agg.coefficient,
    average: agg.weightedCoefficient > 0 ? agg.weighted / agg.weightedCoefficient : null,
    teacherComment: null,
    rank: null
  }));
};
var hexToRgb = (hexColor) => {
  const normalized = hexColor.replace("#", "").trim();
  const value = normalized.length === 3 ? normalized.split("").map((c) => `${c}${c}`).join("") : normalized;
  const intValue = Number.parseInt(value, 16);
  const r = (intValue >> 16 & 255) / 255;
  const g = (intValue >> 8 & 255) / 255;
  const b = (intValue & 255) / 255;
  return (0, import_pdf_lib.rgb)(r, g, b);
};
var toDateLabel = (iso) => {
  if (!iso) return (/* @__PURE__ */ new Date()).toLocaleDateString("fr-FR");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return (/* @__PURE__ */ new Date()).toLocaleDateString("fr-FR");
  return date.toLocaleDateString("fr-FR");
};
var sanitizePdfText = (value) => {
  const raw = String(value ?? "");
  return raw.normalize("NFKD").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
};
var buildConditions2 = (actor) => {
  const conditions = [];
  if (actor.role !== "super_admin") {
    if (actor.schoolId == null) {
      conditions.push(import_drizzle_orm7.sql`1 = 0`);
      return conditions;
    }
    conditions.push((0, import_drizzle_orm7.eq)(students.schoolId, actor.schoolId));
  }
  return conditions;
};
var createDbBulletinPdfDataProvider = () => ({
  async getById(actor, bulletinId) {
    const conditions = buildConditions2(actor);
    conditions.push((0, import_drizzle_orm7.eq)(bulletins.id, bulletinId));
    const whereClause = (0, import_drizzle_orm7.and)(...conditions);
    const [header] = await db.select({
      id: bulletins.id,
      studentId: bulletins.studentId,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      classId: bulletins.classId,
      className: classes.name,
      schoolName: schools.name,
      schoolYearId: bulletins.schoolYearId,
      schoolYearName: academicYears.name,
      termId: bulletins.termId,
      termName: schoolTerms.name,
      termStartDate: schoolTerms.startDate,
      termEndDate: schoolTerms.endDate,
      average: bulletins.average,
      totalPoints: bulletins.totalPoints,
      totalCoefficients: bulletins.totalCoefficients,
      rank: bulletins.rank,
      mention: bulletins.mention,
      appreciation: bulletins.appreciation,
      generatedAt: bulletins.generatedAt
    }).from(bulletins).innerJoin(students, (0, import_drizzle_orm7.eq)(bulletins.studentId, students.id)).innerJoin(classes, (0, import_drizzle_orm7.eq)(bulletins.classId, classes.id)).innerJoin(schools, (0, import_drizzle_orm7.eq)(classes.schoolId, schools.id)).innerJoin(academicYears, (0, import_drizzle_orm7.eq)(bulletins.schoolYearId, academicYears.id)).innerJoin(schoolTerms, (0, import_drizzle_orm7.eq)(bulletins.termId, schoolTerms.id)).where(whereClause);
    if (!header) return null;
    const lines = await db.select({
      id: bulletinLines.id,
      bulletinId: bulletinLines.bulletinId,
      subjectId: bulletinLines.subjectId,
      subjectName: bulletinLines.subjectName,
      coefficient: bulletinLines.coefficient,
      average: bulletinLines.average,
      teacherComment: bulletinLines.teacherComment,
      rank: bulletinLines.rank
    }).from(bulletinLines).where((0, import_drizzle_orm7.eq)(bulletinLines.bulletinId, bulletinId)).orderBy(bulletinLines.id);
    let resolvedLines = lines.map((line) => ({
      id: line.id,
      bulletinId: line.bulletinId,
      subjectId: line.subjectId,
      subjectName: line.subjectName,
      coefficient: line.coefficient,
      average: parseNumber2(line.average),
      teacherComment: line.teacherComment,
      rank: line.rank
    }));
    if (resolvedLines.length === 0) {
      const termScopeCondition = header.termStartDate && header.termEndDate ? import_drizzle_orm7.sql`(
            ${evaluations.termId} = ${header.termId}
            or (
              ${evaluations.termId} is null
              and ${evaluations.date} >= ${header.termStartDate}
              and ${evaluations.date} <= ${header.termEndDate}
            )
          )` : import_drizzle_orm7.sql`${evaluations.termId} = ${header.termId}`;
      const gradeRows = await db.select({
        subject: evaluations.subject,
        coefficient: evaluations.coefficient,
        maxScore: evaluations.maxScore,
        score: grades.score
      }).from(grades).innerJoin(evaluations, (0, import_drizzle_orm7.eq)(grades.evaluationId, evaluations.id)).where((0, import_drizzle_orm7.and)(
        (0, import_drizzle_orm7.eq)(grades.studentId, header.studentId),
        (0, import_drizzle_orm7.eq)(evaluations.classId, header.classId),
        (0, import_drizzle_orm7.eq)(evaluations.countInBulletin, true),
        termScopeCondition
      ));
      resolvedLines = buildFallbackLinesFromGrades(gradeRows).map((line) => ({
        ...line,
        bulletinId
      }));
    }
    return {
      id: header.id,
      studentId: header.studentId,
      studentName: `${header.studentFirstName} ${header.studentLastName}`.trim(),
      classId: header.classId,
      className: header.className,
      schoolName: header.schoolName,
      schoolYearId: header.schoolYearId,
      schoolYearName: header.schoolYearName,
      termId: header.termId,
      termName: header.termName,
      average: parseNumber2(header.average),
      totalPoints: parseNumber2(header.totalPoints) ?? 0,
      totalCoefficients: parseNumber2(header.totalCoefficients) ?? 0,
      rank: header.rank,
      mention: header.mention,
      appreciation: header.appreciation,
      generatedAt: header.generatedAt ? header.generatedAt.toISOString() : null,
      lines: resolvedLines
    };
  }
});
var drawText = (page, text2, x, y, size, color, font) => {
  const safeText = sanitizePdfText(text2);
  page.drawText(safeText, {
    x,
    y,
    size,
    color,
    font
  });
};
var createBulletinPdfDocument = async (data, templateOverrides) => {
  const template = {
    ...DEFAULT_TEMPLATE,
    ...templateOverrides,
    labels: {
      ...DEFAULT_TEMPLATE.labels,
      ...templateOverrides?.labels || {}
    }
  };
  const primary = hexToRgb(template.primaryColor);
  const secondary = hexToRgb(template.secondaryColor);
  const text2 = hexToRgb(template.textColor);
  const pdf = await import_pdf_lib.PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const width = page.getWidth();
  const height = page.getHeight();
  const margin = 40;
  const fontRegular = await pdf.embedFont(import_pdf_lib.StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(import_pdf_lib.StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: primary });
  drawText(page, template.labels.title, margin, height - 52, 20, (0, import_pdf_lib.rgb)(1, 1, 1), fontBold);
  drawText(page, data.schoolName, margin, height - 76, 12, (0, import_pdf_lib.rgb)(1, 1, 1), fontRegular);
  if (template.logoFilePath) {
    try {
      const logoBytes = await (0, import_promises.readFile)(template.logoFilePath);
      const logo = template.logoFilePath.toLowerCase().endsWith(".png") ? await pdf.embedPng(logoBytes) : await pdf.embedJpg(logoBytes);
      const scaled = logo.scale(0.2);
      page.drawImage(logo, {
        x: width - margin - scaled.width,
        y: height - 80,
        width: scaled.width,
        height: scaled.height
      });
    } catch {
    }
  }
  let cursorY = height - 120;
  const lineGap = 18;
  page.drawRectangle({ x: margin, y: cursorY - 62, width: width - margin * 2, height: 62, color: secondary });
  drawText(page, `${template.labels.schoolYear}: ${data.schoolYearName}`, margin + 10, cursorY - 20, 11, text2, fontRegular);
  drawText(page, `${template.labels.term}: ${data.termName}`, margin + 10, cursorY - 38, 11, text2, fontRegular);
  drawText(page, `${template.labels.student}: ${data.studentName}`, margin + 250, cursorY - 20, 11, text2, fontRegular);
  drawText(page, `${template.labels.class}: ${data.className}`, margin + 250, cursorY - 38, 11, text2, fontRegular);
  cursorY -= 90;
  const tableX = margin;
  const colSubject = 220;
  const colCoef = 70;
  const colAvg = 80;
  const colComment = width - margin * 2 - colSubject - colCoef - colAvg;
  const tableWidth = width - margin * 2;
  page.drawRectangle({ x: tableX, y: cursorY, width: tableWidth, height: 22, color: primary });
  drawText(page, template.labels.subject, tableX + 8, cursorY + 6, 10, (0, import_pdf_lib.rgb)(1, 1, 1), fontBold);
  drawText(page, template.labels.coefficient, tableX + colSubject + 8, cursorY + 6, 10, (0, import_pdf_lib.rgb)(1, 1, 1), fontBold);
  drawText(page, template.labels.subjectAverage, tableX + colSubject + colCoef + 8, cursorY + 6, 10, (0, import_pdf_lib.rgb)(1, 1, 1), fontBold);
  drawText(page, template.labels.teacherComment, tableX + colSubject + colCoef + colAvg + 8, cursorY + 6, 10, (0, import_pdf_lib.rgb)(1, 1, 1), fontBold);
  cursorY -= 24;
  for (const line of data.lines) {
    page.drawRectangle({ x: tableX, y: cursorY, width: tableWidth, height: 22, borderColor: secondary, borderWidth: 0.6 });
    drawText(page, line.subjectName, tableX + 8, cursorY + 6, 9, text2, fontRegular);
    drawText(page, String(line.coefficient), tableX + colSubject + 8, cursorY + 6, 9, text2, fontRegular);
    drawText(page, line.average == null ? "-" : line.average.toFixed(2), tableX + colSubject + colCoef + 8, cursorY + 6, 9, text2, fontRegular);
    drawText(page, line.teacherComment || "-", tableX + colSubject + colCoef + colAvg + 8, cursorY + 6, 9, text2, fontRegular);
    cursorY -= 22;
    if (cursorY < 160) break;
  }
  cursorY -= 16;
  drawText(page, `${template.labels.average}: ${data.average == null ? "-" : data.average.toFixed(2)}`, margin, cursorY, 11, text2, fontBold);
  cursorY -= lineGap;
  drawText(page, `${template.labels.rank}: ${data.rank ?? "-"}`, margin, cursorY, 11, text2, fontRegular);
  cursorY -= lineGap;
  drawText(page, `${template.labels.mention}: ${data.mention ?? "-"}`, margin, cursorY, 11, text2, fontRegular);
  cursorY -= lineGap;
  drawText(page, `${template.labels.appreciation}: ${data.appreciation ?? "-"}`, margin, cursorY, 11, text2, fontRegular);
  cursorY -= lineGap;
  drawText(page, `${template.labels.generationDate}: ${toDateLabel(data.generatedAt)}`, margin, cursorY, 10, text2, fontRegular);
  page.drawLine({
    start: { x: margin, y: 100 },
    end: { x: margin + 190, y: 100 },
    color: secondary,
    thickness: 1
  });
  page.drawLine({
    start: { x: width - margin - 190, y: 100 },
    end: { x: width - margin, y: 100 },
    color: secondary,
    thickness: 1
  });
  drawText(page, template.labels.signatureSchool, margin, 84, 10, text2, fontRegular);
  drawText(page, template.labels.signatureParent, width - margin - 190, 84, 10, text2, fontRegular);
  return pdf.save({ useObjectStreams: false });
};
var registerBulletinPdfRoute = (app, options) => {
  const {
    resolveActor: resolveActor2,
    dataProvider = createDbBulletinPdfDataProvider(),
    pdfGenerator,
    template,
    verifyMiddleware = verifyToken,
    detailAccessMiddleware = requireOwnership(isBulletinOwnedByCurrentUser, { bypassRoles: ["admin", "teacher"] }),
    batchAccessMiddleware = requireRole(["admin", "teacher"])
  } = options;
  const buildPdf = pdfGenerator ?? ((data) => createBulletinPdfDocument(data, template));
  app.get("/api/bulletins/pdf/batch", verifyMiddleware, batchAccessMiddleware, async (req, res) => {
    try {
      const actor = await resolveActor2(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const rawIds = String(req.query.ids || "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
      const bulletinIds = Array.from(new Set(rawIds));
      if (bulletinIds.length === 0) {
        return res.status(400).json({ error: "At least one valid bulletin id is required" });
      }
      const mergedPdf = await import_pdf_lib.PDFDocument.create();
      let mergedCount = 0;
      for (const bulletinId of bulletinIds) {
        const bulletin = await dataProvider.getById(actor, bulletinId);
        if (!bulletin) continue;
        const pdfBytes = await buildPdf(bulletin);
        const sourcePdf = await import_pdf_lib.PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        mergedCount += 1;
      }
      if (mergedCount === 0) {
        return res.status(404).json({ error: "No accessible bulletins found for provided ids" });
      }
      const mergedBytes = await mergedPdf.save({ useObjectStreams: false });
      const fileName = `bulletins-batch-${Date.now()}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      return res.status(200).send(Buffer.from(mergedBytes));
    } catch (err) {
      console.error("Failed to generate batch bulletin PDF:", err);
      const message = err instanceof Error && err.message ? `Failed to generate batch bulletin PDF: ${err.message}` : "Failed to generate batch bulletin PDF";
      return res.status(500).json({ error: message });
    }
  });
  app.get("/api/bulletins/:id/pdf", verifyMiddleware, detailAccessMiddleware, async (req, res) => {
    try {
      const actor = await resolveActor2(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const bulletinId = Number(req.params.id);
      if (!Number.isInteger(bulletinId) || bulletinId <= 0) {
        return res.status(400).json({ error: "Invalid bulletin id" });
      }
      const bulletin = await dataProvider.getById(actor, bulletinId);
      if (!bulletin) {
        return res.status(404).json({ error: "Bulletin not found" });
      }
      const pdfBytes = await buildPdf(bulletin);
      const fileName = `bulletin-${bulletin.id}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      res.status(200).send(Buffer.from(pdfBytes));
    } catch (err) {
      console.error("Failed to generate bulletin PDF:", err);
      const message = err instanceof Error && err.message ? `Failed to generate bulletin PDF: ${err.message}` : "Failed to generate bulletin PDF";
      res.status(500).json({ error: message });
    }
  });
};

// server.ts
var import_drizzle_orm8 = require("drizzle-orm");

// src/lib/classSchoolValidation.ts
function resolveClassCreationSchoolId(args) {
  const { actorRole, requestedSchoolId, actorSchoolId } = args;
  if (actorRole === "school_admin") {
    const candidate = requestedSchoolId ?? actorSchoolId;
    const parsed = candidate == null || candidate === "" || candidate === "undefined" || candidate === "null" ? null : Number(candidate);
    if (parsed == null || Number.isNaN(parsed)) {
      return { schoolId: null, error: "schoolId is required to create a class" };
    }
    return { schoolId: parsed };
  }
  if (actorRole === "super_admin") {
    const parsed = requestedSchoolId == null || requestedSchoolId === "" || requestedSchoolId === "undefined" || requestedSchoolId === "null" ? null : Number(requestedSchoolId);
    if (parsed != null && Number.isNaN(parsed)) {
      return { schoolId: null, error: "Invalid schoolId" };
    }
    return { schoolId: parsed };
  }
  return { schoolId: null, error: "Forbidden" };
}

// server.ts
async function logIfTeacherUserMismatch(userId, teacherId) {
  try {
    if (!userId || !teacherId) return;
    const [u] = await db.select({ id: users.id, schoolId: users.schoolId }).from(users).where((0, import_drizzle_orm8.eq)(users.id, userId));
    const [t] = await db.select({ id: teachers.id, schoolId: teachers.schoolId }).from(teachers).where((0, import_drizzle_orm8.eq)(teachers.id, teacherId));
    if (!u || !t) return;
    if (t.schoolId != null && (u.schoolId == null || u.schoolId !== t.schoolId)) {
      console.warn("DATA-INCONSISTENCY: users.school_id and teachers.school_id mismatch", { userId: u.id, users_schoolId: u.schoolId, teacherId: t.id, teachers_schoolId: t.schoolId });
    }
  } catch (e) {
    console.warn("DIAG: failed to verify teacher/user school_id consistency", { userId, teacherId, err: e?.message || e });
  }
}
async function findExistingUsersByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];
  return db.select().from(users).where((0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${users.email})`, normalizedEmail));
}
async function findExistingUsersByEmailAndSchool(email, schoolId) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];
  if (schoolId == null) {
    return [];
  }
  return db.select().from(users).where(
    (0, import_drizzle_orm8.and)(
      (0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${users.email})`, normalizedEmail),
      (0, import_drizzle_orm8.eq)(users.schoolId, schoolId)
    )
  );
}
async function resolveActor(req) {
  console.log("TRACE resolveActor enter", { userPresent: !!req.user, user: req.user && { uid: req.user.uid, email: req.user.email, role: req.user.role, schoolId: req.user.schoolId, simulated: req.user.simulated } });
  if (!req.user) return null;
  if (req.user.simulated) {
    let dbUser2 = null;
    const rowsByUid = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
    console.log("TRACE resolveActor lookup by uid", { uid: req.user.uid, rowsByUidLength: rowsByUid.length });
    if (rowsByUid.length > 0) dbUser2 = rowsByUid[0];
    if (!dbUser2 && req.user.email) {
      const rowsByEmail = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.email, req.user.email));
      console.log("TRACE resolveActor lookup by email", { email: req.user.email, rowsByEmailLength: rowsByEmail.length });
      if (rowsByEmail.length > 0) dbUser2 = rowsByEmail[0];
    }
    console.log("TRACE resolveActor dbUser final", { found: !!dbUser2, dbUser: dbUser2 ? { id: dbUser2.id, uid: dbUser2.uid, email: dbUser2.email, schoolId: dbUser2.schoolId } : null });
    if (dbUser2) {
      const activeSchoolId = req.user.schoolId ?? null;
      return { ...dbUser2, schoolId: activeSchoolId ?? dbUser2.schoolId ?? null };
    }
    return {
      uid: req.user.uid,
      role: req.user.role,
      schoolId: req.user.schoolId,
      email: req.user.email,
      name: req.user.name
    };
  }
  const [dbUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
  if (dbUser) {
    const activeSchoolId = req.user.schoolId ?? null;
    if (activeSchoolId != null) {
      return { ...dbUser, schoolId: activeSchoolId };
    }
    return dbUser;
  }
  return null;
}
async function getParentChildStudentIds(userId) {
  if (!userId) return [];
  const parentRows = await db.select({ id: parents.id, studentId: parents.studentId }).from(parents).where((0, import_drizzle_orm8.eq)(parents.userId, userId));
  if (parentRows.length === 0) return [];
  const childIds = /* @__PURE__ */ new Set();
  for (const parentRow of parentRows) {
    if (parentRow.studentId != null) {
      childIds.add(parentRow.studentId);
    }
    const ownedStudents = await db.select({ id: students.id }).from(students).where((0, import_drizzle_orm8.eq)(students.parentId, parentRow.id));
    for (const studentRow of ownedStudents) {
      if (studentRow.id != null) {
        childIds.add(studentRow.id);
      }
    }
  }
  return Array.from(childIds);
}
async function getUserSchoolMemberships(userId) {
  if (!userId) return [];
  const rows = await db.select({
    schoolId: userSchools.schoolId,
    isActive: userSchools.isActive
  }).from(userSchools).where((0, import_drizzle_orm8.eq)(userSchools.userId, userId));
  return rows;
}
async function ensureUserSchoolMembership(userId, schoolId, requiredRole) {
  if (!userId || schoolId == null) return null;
  const whereClause = requiredRole ? (0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(userSchools.userId, userId), (0, import_drizzle_orm8.eq)(userSchools.schoolId, schoolId), (0, import_drizzle_orm8.eq)(userSchools.role, requiredRole)) : (0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(userSchools.userId, userId), (0, import_drizzle_orm8.eq)(userSchools.schoolId, schoolId));
  const existing = await db.select().from(userSchools).where(whereClause);
  return existing[0] ?? null;
}
async function upsertUserSchoolMembership(userId, schoolId, role, isActive = true) {
  if (!userId || schoolId == null) return null;
  const existing = await ensureUserSchoolMembership(userId, schoolId);
  if (existing) {
    const updates = {};
    if (existing.role !== role) updates.role = role;
    if (existing.isActive !== isActive) updates.isActive = isActive;
    if (Object.keys(updates).length > 0) {
      const [updated] = await db.update(userSchools).set(updates).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(userSchools.userId, userId), (0, import_drizzle_orm8.eq)(userSchools.schoolId, schoolId))).returning();
      return updated ?? existing;
    }
    return existing;
  }
  const [inserted] = await db.insert(userSchools).values({
    userId,
    schoolId,
    role,
    isActive
  }).returning();
  return inserted ?? null;
}
async function repairMissingSchoolAdminMemberships() {
  const schoolAdmins = await db.select({
    id: users.id,
    schoolId: users.schoolId
  }).from(users).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(users.role, "school_admin"), import_drizzle_orm8.sql`${users.schoolId} IS NOT NULL`));
  for (const schoolAdmin of schoolAdmins) {
    if (schoolAdmin.schoolId == null) continue;
    const existing = await ensureUserSchoolMembership(schoolAdmin.id, schoolAdmin.schoolId);
    if (!existing) {
      await upsertUserSchoolMembership(schoolAdmin.id, schoolAdmin.schoolId, "school_admin", true);
    }
  }
}
async function setActiveUserSchool(userId, schoolId) {
  if (!userId || schoolId == null) return null;
  const membership = await ensureUserSchoolMembership(userId, schoolId);
  if (!membership) return null;
  await db.update(userSchools).set({ isActive: false }).where((0, import_drizzle_orm8.eq)(userSchools.userId, userId));
  const updated = await db.update(userSchools).set({ isActive: true }).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(userSchools.userId, userId), (0, import_drizzle_orm8.eq)(userSchools.schoolId, schoolId))).returning();
  return updated[0] ?? null;
}
function normalizeSpecialization(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item.trim() !== "").join(", ");
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}
async function isApprovedClassForSchool(classId, targetSchoolId) {
  if (targetSchoolId == null) return false;
  const [cls] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, classId));
  if (!cls) return false;
  if (cls.schoolId === targetSchoolId) return true;
  if (cls.schoolId != null) return false;
  const [schoolClass] = await db.select().from(schoolClasses).where(
    (0, import_drizzle_orm8.and)(
      (0, import_drizzle_orm8.eq)(schoolClasses.classId, classId),
      (0, import_drizzle_orm8.eq)(schoolClasses.schoolId, targetSchoolId),
      (0, import_drizzle_orm8.eq)(schoolClasses.status, "approved")
    )
  );
  return !!schoolClass;
}
async function isApprovedSubjectForSchool(subjectName, targetSchoolId) {
  const normalizedSubject = String(subjectName || "").trim();
  console.log("DEBUG isApprovedSubjectForSchool enter", {
    subjectName,
    normalizedSubject,
    normalizedLength: normalizedSubject.length,
    targetSchoolId
  });
  if (!normalizedSubject) {
    console.log("DEBUG isApprovedSubjectForSchool fail empty subject", { subjectName });
    return false;
  }
  const normalizedSubjectMatch = import_drizzle_orm8.sql`LOWER(TRIM(${subjects.name})) = LOWER(TRIM(${normalizedSubject}))`;
  if (targetSchoolId != null) {
    const [sameSchoolSubject] = await db.select().from(subjects).where(
      (0, import_drizzle_orm8.and)(
        (0, import_drizzle_orm8.eq)(subjects.schoolId, targetSchoolId),
        normalizedSubjectMatch
      )
    );
    console.log("DEBUG isApprovedSubjectForSchool sameSchoolSubject query", {
      targetSchoolId,
      normalizedSubject,
      sameSchoolSubject
    });
    if (sameSchoolSubject) {
      console.log("DEBUG isApprovedSubjectForSchool pass sameSchoolSubject", { targetSchoolId, normalizedSubject });
      return true;
    }
    const approvedSubjectRows = await db.select({
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectSchoolId: subjects.schoolId,
      schoolSubjectId: schoolSubjects.id,
      schoolSubjectSchoolId: schoolSubjects.schoolId,
      schoolSubjectStatus: schoolSubjects.status
    }).from(subjects).innerJoin(
      schoolSubjects,
      (0, import_drizzle_orm8.and)(
        (0, import_drizzle_orm8.eq)(subjects.id, schoolSubjects.subjectId),
        (0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, targetSchoolId),
        (0, import_drizzle_orm8.eq)(schoolSubjects.status, "approved")
      )
    ).where(normalizedSubjectMatch);
    console.log("DEBUG isApprovedSubjectForSchool approvedSubjectRows", {
      targetSchoolId,
      normalizedSubject,
      approvedSubjectRows
    });
    const result2 = approvedSubjectRows.length > 0;
    console.log("DEBUG isApprovedSubjectForSchool result", {
      targetSchoolId,
      normalizedSubject,
      result: result2,
      reason: result2 ? "approvedSubjectRows match" : "no approved subject match"
    });
    return result2;
  }
  const globalSubjectRows = await db.select().from(subjects).where(
    (0, import_drizzle_orm8.and)(
      import_drizzle_orm8.sql`${subjects.schoolId} IS NULL`,
      normalizedSubjectMatch
    )
  );
  console.log("DEBUG isApprovedSubjectForSchool globalSubjectRows", {
    normalizedSubject,
    globalSubjectRows
  });
  const result = globalSubjectRows.length > 0;
  console.log("DEBUG isApprovedSubjectForSchool result", {
    normalizedSubject,
    result,
    reason: result ? "globalSubjectRows match" : "no global subject match"
  });
  return result;
}
function formatUserUpdateDiff(targetUser, incoming) {
  const changes = [];
  if (incoming.email !== targetUser.email) {
    changes.push(`email: "${targetUser.email}" \u2192 "${incoming.email}"`);
  }
  if (incoming.role !== targetUser.role) {
    changes.push(`role: "${targetUser.role}" \u2192 "${incoming.role}"`);
  }
  const oldSchoolId = targetUser.schoolId != null ? String(targetUser.schoolId) : "null";
  const newSchoolId = incoming.schoolId != null && incoming.schoolId !== "" ? String(incoming.schoolId) : "null";
  if (oldSchoolId !== newSchoolId) {
    changes.push(`schoolId: ${oldSchoolId} \u2192 ${newSchoolId}`);
  }
  if (incoming.phone != null && incoming.phone !== "" && incoming.phone !== targetUser.phone) {
    changes.push(`phone: "${targetUser.phone ?? ""}" \u2192 "${incoming.phone}"`);
  }
  const normalizedIncomingSpecialization = normalizeSpecialization(incoming.specialization);
  const existingSpecialization = typeof targetUser.specialization === "string" ? targetUser.specialization : Array.isArray(targetUser.specialization) ? targetUser.specialization.join(", ") : "";
  if (normalizedIncomingSpecialization !== "" && normalizedIncomingSpecialization !== existingSpecialization) {
    changes.push(`specialization: "${existingSpecialization}" \u2192 "${normalizedIncomingSpecialization}"`);
  }
  return changes.length > 0 ? `Champs modifi\xE9s: ${changes.join("; ")}` : "Aucun champ modifi\xE9 d\xE9tect\xE9.";
}
async function logAuditEvent(actor, action, resourceType, resourceId, schoolId, description) {
  try {
    const result = await db.insert(auditEvents).values({
      actorUserId: actor?.id ?? null,
      actorRole: actor?.role ?? "unknown",
      actorEmail: actor?.email ?? null,
      actorName: actor?.name ?? null,
      action,
      resourceType,
      resourceId,
      schoolId,
      description
    }).returning();
    console.log("Audit event stored:", JSON.stringify(result[0]));
  } catch (err) {
    console.error("Failed to write audit event:", err?.message || err);
  }
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json());
  app.use((req, res, next) => {
    try {
      console.log("\u{1F4E1} REQUEST:", req.method, req.url);
      console.log("\u{1F4E6} BODY:", req.body);
    } catch (err) {
      console.error("Failed to log request debug data:", err);
    }
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    res.json = function(data) {
      try {
        console.log("\u{1F4E4} RESPONSE:", res.statusCode, data);
      } catch (err) {
        console.error("Failed to log response JSON debug data:", err);
      }
      return originalJson(data);
    };
    res.on("finish", () => {
      try {
        console.log("\u{1F4E5} RESPONSE STATUS:", res.statusCode, req.method, req.url);
      } catch (err) {
        console.error("Failed to log response status:", err);
      }
    });
    next();
  });
  console.log("Verifying if database needs seeding...");
  try {
    await seedDatabaseIfEmpty();
    await ensureSchoolClassesTableExists();
    await ensureUsersTableSchema();
    await ensureUserSchoolsTableExists();
    await repairMissingSchoolAdminMemberships();
  } catch (error) {
    console.error("Database initialization failed, shutting down application.", error);
    process.exit(1);
  }
  app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });
  app.use((req, res, next) => {
    if (req.path === "/" || req.path.startsWith("/api") || req.path === "/login" || req.path.startsWith("/assets") || req.path.startsWith("/@") || req.path.startsWith("/node_modules") || /\.(ico|png|jpg|jpeg|gif|svg|css|js|jsx|ts|tsx|json|mjs)$/i.test(req.path)) {
      return next();
    }
    requireAuth(req, res, (err) => {
      if (res.headersSent) return;
      const r = req;
      if (err || !r.user) {
        return res.redirect("/login");
      }
      return next();
    });
  });
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: (/* @__PURE__ */ new Date()).toISOString() });
  });
  registerBulletinGenerateRoute(app, { resolveActor });
  registerBulletinReadRoutes(app, { resolveActor });
  registerBulletinPdfRoute(app, { resolveActor });
  app.post("/api/users/:userId/schools", requireAuth, async (req, res) => {
    try {
      console.log("HANDLER ENTER /api/users/:userId/schools", { params: req.params, body: req.body, simulatedRole: req.headers["x-simulated-role"], hasAuth: !!req.headers.authorization });
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actorRole = req.user?.role;
      if (!actorRole) return res.status(401).json({ error: "Unauthenticated" });
      const userIdParam = parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(userIdParam)) return res.status(400).json({ error: "Invalid userId" });
      const { schoolId, role } = req.body ?? {};
      const parsedSchoolId = typeof schoolId === "number" ? schoolId : parseInt(String(schoolId), 10);
      if (!Number.isFinite(parsedSchoolId)) return res.status(400).json({ error: "Invalid schoolId" });
      if (actorRole !== "super_admin") {
        return res.status(403).json({ error: "Forbidden: only super_admin can manage multi-school memberships" });
      }
      const [targetUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.id, userIdParam)).limit(1);
      if (!targetUser) return res.status(404).json({ error: "USER_NOT_FOUND" });
      if (!["teacher", "parent"].includes(targetUser.role)) {
        return res.status(400).json({ error: "Cannot add a school membership for school_admin or student accounts" });
      }
      const membershipRole = role ?? targetUser.role;
      if (membershipRole !== targetUser.role) {
        return res.status(400).json({ error: "Membership role must match the user role for teacher and parent accounts" });
      }
      if (!["teacher", "parent"].includes(membershipRole)) {
        return res.status(400).json({ error: "Membership role must be teacher or parent" });
      }
      const [targetSchool] = await db.select().from(schools).where((0, import_drizzle_orm8.eq)(schools.id, parsedSchoolId)).limit(1);
      if (!targetSchool) return res.status(404).json({ error: "SCHOOL_NOT_FOUND" });
      const existing = await db.select().from(userSchools).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(userSchools.userId, userIdParam), (0, import_drizzle_orm8.eq)(userSchools.schoolId, parsedSchoolId)));
      if (existing.length > 0) {
        return res.status(200).json({ message: "Membership already exists", membership: existing[0] });
      }
      const inserted = await db.insert(userSchools).values({ userId: userIdParam, schoolId: parsedSchoolId, role: membershipRole }).returning();
      res.status(201).json(inserted[0] ?? null);
    } catch (err) {
      console.error("Error associating user with school:", err);
      res.status(500).json({ error: err?.message || "Failed to associate user with school" });
    }
  });
  app.get("/api/simulation/users", requireAuth, async (req, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: "Unauthenticated" });
      let filterConditions = (0, import_drizzle_orm8.eq)(users.isDeleted, false);
      if (actor.role === "school_admin" && actor.schoolId) {
        filterConditions = (0, import_drizzle_orm8.and)(
          filterConditions,
          (0, import_drizzle_orm8.or)((0, import_drizzle_orm8.eq)(userSchools.schoolId, actor.schoolId), (0, import_drizzle_orm8.eq)(users.schoolId, actor.schoolId)),
          (0, import_drizzle_orm8.notInArray)(users.role, ["super_admin"])
        );
      } else if (actor.role === "super_admin") {
      } else if (actor.role === "parent") {
        if (!actor.id) {
          return res.json([]);
        }
        filterConditions = (0, import_drizzle_orm8.and)(filterConditions, (0, import_drizzle_orm8.eq)(users.id, actor.id));
      } else if (actor.role === "teacher") {
        return res.status(403).json({ error: "Forbidden" });
      } else {
        return res.status(403).json({ error: "Forbidden" });
      }
      const allUsers = await db.select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        name: users.name,
        role: users.role,
        schoolId: users.schoolId,
        academicYearId: users.academicYearId,
        isDeleted: users.isDeleted,
        createdAt: users.createdAt,
        teacherId: teachers.id,
        teacherPhone: teachers.phone,
        teacherSpecialization: teachers.specialization,
        parentPhone: parents.phone,
        userSchoolId: userSchools.schoolId
      }).from(users).leftJoin(teachers, (0, import_drizzle_orm8.eq)(teachers.userId, users.id)).leftJoin(parents, (0, import_drizzle_orm8.eq)(parents.userId, users.id)).leftJoin(userSchools, (0, import_drizzle_orm8.eq)(userSchools.userId, users.id)).where(filterConditions);
      const normalizedById = allUsers.reduce((acc, user) => {
        if (!acc[user.id]) {
          acc[user.id] = {
            id: user.id,
            uid: user.uid,
            email: user.email,
            name: user.name,
            role: user.role,
            schoolId: user.schoolId,
            schoolIds: user.schoolId != null ? [user.schoolId] : [],
            academicYearId: user.academicYearId,
            isDeleted: user.isDeleted,
            createdAt: user.createdAt,
            phone: user.teacherPhone || user.parentPhone || null,
            specialization: user.teacherSpecialization || null,
            classIds: [],
            _teacherId: user.teacherId
          };
        }
        if (user.userSchoolId != null) {
          const existingSchoolIds = acc[user.id].schoolIds || [];
          if (!existingSchoolIds.includes(user.userSchoolId)) {
            existingSchoolIds.push(user.userSchoolId);
            acc[user.id].schoolIds = existingSchoolIds;
          }
        }
        return acc;
      }, {});
      const teacherIds = Object.values(normalizedById).map((user) => user._teacherId).filter((id) => id != null);
      if (teacherIds.length > 0) {
        const assignmentRows = await db.select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId }).from(classTeachers).where((0, import_drizzle_orm8.inArray)(classTeachers.teacherId, teacherIds));
        const assignmentMap = /* @__PURE__ */ new Map();
        assignmentRows.forEach((item) => {
          const existing = assignmentMap.get(item.teacherId) || [];
          existing.push(item.classId);
          assignmentMap.set(item.teacherId, existing);
        });
        Object.values(normalizedById).forEach((user) => {
          if (user._teacherId != null) {
            user.classIds = assignmentMap.get(user._teacherId) || [];
          }
          delete user._teacherId;
        });
      } else {
        Object.values(normalizedById).forEach((user) => {
          delete user._teacherId;
        });
      }
      res.json(Object.values(normalizedById));
    } catch (err) {
      console.error("Failed to retrieve simulation users:", err);
      res.status(500).json({ error: "Failed to retrieve simulation users" });
    }
  });
  app.get("/api/debug/sim-profile", requireAuth, async (req, res) => {
    try {
      const simHeaders = {
        uid: req.headers["x-simulated-uid"] || null,
        email: req.headers["x-simulated-email"] || null,
        role: req.headers["x-simulated-role"] || null,
        schoolId: req.headers["x-simulated-school-id"] || null
      };
      const resolved = await resolveActor(req);
      let dbUser = null;
      if (resolved && resolved.id) {
        dbUser = resolved;
      } else if (req.user && req.user.email) {
        const rows = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.email, req.user.email));
        dbUser = rows.length > 0 ? rows[0] : null;
      } else if (req.user && req.user.uid) {
        const rows = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
        dbUser = rows.length > 0 ? rows[0] : null;
      }
      let teacherRow = null;
      let classRows = [];
      let studentRows = [];
      if (dbUser && dbUser.id) {
        const t = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, dbUser.id));
        teacherRow = t.length > 0 ? t[0] : null;
        if (teacherRow && teacherRow.id) {
          const assignmentRows = await db.select({ classId: classTeachers.classId }).from(classTeachers).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherRow.id));
          const classIds = assignmentRows.map((a) => a.classId);
          if (classIds.length > 0) {
            classRows = await db.select().from(classes).where(import_drizzle_orm8.sql`${classes.id} IN ${classIds}`);
          }
          for (const c of classRows) {
            const s = await db.select().from(students).where((0, import_drizzle_orm8.eq)(students.classId, c.id));
            studentRows = studentRows.concat(s);
          }
        }
      }
      res.json({ simHeaders, resolvedActor: resolved, dbUser, teacherRow, classCount: classRows.length, classes: classRows, studentCount: studentRows.length, students: studentRows });
    } catch (err) {
      console.error("Debug sim-profile failed:", err);
      res.status(500).json({ error: err?.message || "Failed to run debug" });
    }
  });
  app.post("/api/admin/users", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      let actor = await resolveActor(req);
      console.log("DEBUG /api/admin/users create request", {
        reqUser: req.user,
        actor: actor ? { id: actor.id, uid: actor.uid, role: actor.role, schoolId: actor.schoolId, email: actor.email } : null,
        body: req.body
      });
      if (!actor || !["super_admin", "school_admin"].includes(actor.role)) return res.status(403).json({ error: "Forbidden" });
      if (actor.role === "school_admin" && actor.schoolId == null && req.user.schoolId != null) {
        actor = { ...actor, schoolId: req.user.schoolId };
      }
      const { uid, email, name, role, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, phone, specialization, gender, password, classIds, studentId } = req.body;
      console.log("DEBUG /api/admin/users create body", { email, role, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, gender, classIds, passwordPresent: typeof password === "string" && password.length > 0 });
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !name || !role) return res.status(400).json({ error: "Missing required fields: email, name, role" });
      const allowed = ["super_admin", "school_admin", "teacher", "parent"];
      if (!allowed.includes(role)) return res.status(400).json({ error: "Invalid role" });
      const schoolId = rawSchoolId != null && rawSchoolId !== "" ? parseInt(rawSchoolId, 10) : void 0;
      if (rawSchoolId != null && rawSchoolId !== "" && Number.isNaN(schoolId)) {
        return res.status(400).json({ error: "Invalid schoolId" });
      }
      const academicYearId = rawAcademicYearId != null && rawAcademicYearId !== "" ? parseInt(rawAcademicYearId, 10) : void 0;
      if (rawAcademicYearId != null && rawAcademicYearId !== "" && Number.isNaN(academicYearId)) {
        return res.status(400).json({ error: "Invalid academicYearId" });
      }
      if (actor.role === "school_admin" && ["super_admin", "school_admin"].includes(role)) {
        return res.status(403).json({ error: "Forbidden: school_admin cannot create admin accounts" });
      }
      if (role === "school_admin" && schoolId == null) {
        return res.status(400).json({ error: "Missing required field: schoolId is required for school_admin role" });
      }
      if (actor.role === "school_admin" && schoolId != null && schoolId !== actor.schoolId) {
        return res.status(403).json({ error: "Forbidden: cannot create users for other schools" });
      }
      const resolvedSchoolId = schoolId != null ? schoolId : actor.role === "school_admin" ? actor.schoolId : null;
      if (role === "school_admin" && academicYearId == null) {
        return res.status(400).json({ error: "Missing required field: academicYearId is required for school_admin role" });
      }
      if (academicYearId != null) {
        const [yearRow] = await db.select().from(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.id, academicYearId));
        if (!yearRow || yearRow.schoolId !== null && yearRow.schoolId !== resolvedSchoolId) {
          return res.status(400).json({ error: "Invalid academicYearId for selected school" });
        }
      }
      const finalUid = uid || `${role}_${Date.now()}`;
      const existingByUid = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, finalUid));
      if (existingByUid.length > 0) return res.status(409).json({ error: "User with same uid already exists" });
      let existingByEmail = [];
      if (role === "super_admin") {
        existingByEmail = await findExistingUsersByEmail(normalizedEmail);
      } else {
        existingByEmail = await findExistingUsersByEmailAndSchool(normalizedEmail, resolvedSchoolId);
      }
      if (existingByEmail.length > 0) {
        return res.status(409).json({ error: "User with same email already exists" + (resolvedSchoolId && role !== "super_admin" ? " in this school" : "") });
      }
      const newUserRows = await db.insert(users).values({ uid: finalUid, email: normalizedEmail, name, role, schoolId: resolvedSchoolId, academicYearId, gender: gender ?? null }).returning();
      const createdUser = newUserRows[0];
      if (role === "school_admin" && resolvedSchoolId != null) {
        await upsertUserSchoolMembership(createdUser.id, resolvedSchoolId, "school_admin", true);
      }
      let teacherProfile = null;
      if (role === "parent") {
        const normalizedStudentId = studentId != null && studentId !== "" ? parseInt(studentId, 10) : void 0;
        const parentStudentId = Number.isNaN(normalizedStudentId) ? void 0 : normalizedStudentId;
        let parentSchoolId = resolvedSchoolId ?? null;
        if (parentStudentId) {
          const [studentRow] = await db.select({ schoolId: students.schoolId }).from(students).where((0, import_drizzle_orm8.eq)(students.id, parentStudentId));
          if (studentRow && parentSchoolId == null && studentRow.schoolId != null) {
            parentSchoolId = studentRow.schoolId;
          }
        }
        if (actor.role !== "super_admin" && parentSchoolId != null && actor.schoolId != null && parentSchoolId !== actor.schoolId) {
          return res.status(403).json({ error: "Forbidden: cannot create parent for another school" });
        }
        await db.insert(parents).values({
          userId: createdUser.id,
          phone: phone || "",
          address: "",
          studentId: parentStudentId || void 0,
          schoolId: parentSchoolId
        });
        if (parentSchoolId != null) {
          await db.insert(userSchools).values({
            userId: createdUser.id,
            schoolId: parentSchoolId,
            role: "parent",
            isActive: true
          });
        }
      } else if (role === "teacher") {
        const teacherResult = await db.insert(teachers).values({ userId: createdUser.id, schoolId: resolvedSchoolId, phone: phone || "", specialization: normalizeSpecialization(specialization) || null }).returning();
        teacherProfile = teacherResult[0];
        if (resolvedSchoolId != null) {
          await db.insert(userSchools).values({
            userId: createdUser.id,
            schoolId: resolvedSchoolId,
            role: "teacher",
            isActive: true
          });
        }
        if (Array.isArray(classIds) && classIds.length > 0) {
          console.log("Assigning classes to teacher (admin create):", { teacherId: teacherProfile?.id, classIds });
          for (const rawClassId of classIds) {
            const cid = Number(rawClassId);
            if (Number.isNaN(cid)) {
              console.log("DIAG admin create skip invalid id", { rawClassId, teacherId: teacherProfile?.id });
              continue;
            }
            const [cls] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, cid));
            const [schoolClassRow] = resolvedSchoolId != null ? await db.select().from(schoolClasses).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolClasses.classId, cid), (0, import_drizzle_orm8.eq)(schoolClasses.schoolId, resolvedSchoolId))) : [null];
            const approved = await isApprovedClassForSchool(cid, resolvedSchoolId);
            if (!cls) {
              console.log("DIAG admin create - ignored", { cid, teacherId: teacherProfile?.id, resolvedSchoolId, reason: "class_not_found", cls: null, schoolClassRow, approved });
              continue;
            }
            if (resolvedSchoolId != null && cls.schoolId != null && cls.schoolId !== resolvedSchoolId) {
              console.log("DIAG admin create - ignored", { cid, teacherId: teacherProfile?.id, resolvedSchoolId, reason: "class_school_mismatch", cls, schoolClassRow, approved });
              continue;
            }
            if (!approved) {
              console.log("DIAG admin create - ignored", { cid, teacherId: teacherProfile?.id, resolvedSchoolId, reason: "not_approved_for_school", cls, schoolClassRow, approved });
              continue;
            }
            try {
              const existingAssignment = await db.select().from(classTeachers).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(classTeachers.classId, cid), (0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherProfile.id)));
              if (existingAssignment.length === 0) {
                await db.insert(classTeachers).values({ classId: cid, teacherId: teacherProfile.id });
                const insertedRows = await db.select().from(classTeachers).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(classTeachers.classId, cid), (0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherProfile.id)));
                console.log("DIAG admin create - inserted", { cid, teacherId: teacherProfile.id, insertedCount: insertedRows.length, cls, schoolClassRow, approved, resolvedSchoolId });
              } else {
                console.log("DIAG admin create - ignored", { cid, teacherId: teacherProfile.id, reason: "already_assigned", existingCount: existingAssignment.length, cls, schoolClassRow, approved, resolvedSchoolId });
              }
            } catch (e) {
              console.warn("Failed to assign teacher to class", cid, e?.message || e);
            }
          }
        }
        try {
          await db.update(users).set({ schoolId: resolvedSchoolId ?? null }).where((0, import_drizzle_orm8.eq)(users.id, createdUser.id));
        } catch (e) {
          console.warn("DIAG: failed to sync users.schoolId after teacher creation", { userId: createdUser.id, resolvedSchoolId, err: e?.message || e });
        }
        try {
          await logIfTeacherUserMismatch(createdUser.id, teacherProfile?.id);
        } catch (e) {
        }
      }
      try {
        const passwordToSet = "123456";
        const crypto = await import("node:crypto");
        const salt = crypto.randomBytes(16).toString("hex");
        const hash = crypto.pbkdf2Sync(passwordToSet, salt, 31e4, 64, "sha512").toString("hex");
        const existingLocal = await db.select().from(localAuths).where((0, import_drizzle_orm8.eq)(localAuths.userId, createdUser.id));
        if (existingLocal.length > 0) {
          await db.update(localAuths).set({ passwordHash: hash, salt, mustReset: true }).where((0, import_drizzle_orm8.eq)(localAuths.userId, createdUser.id));
        } else {
          await db.insert(localAuths).values({ userId: createdUser.id, passwordHash: hash, salt, mustReset: true }).returning();
        }
      } catch (e) {
        console.warn("Failed to set default password for new user", { userId: createdUser.id, err: e?.message || e });
      }
      await logAuditEvent(actor, "create", "user", createdUser.id, actor.schoolId ?? null, `${actor.role === "school_admin" ? "School admin" : "Super admin"} ${actor.email || actor.uid} created ${role} account ${createdUser.email}`);
      const responseBody = {
        ...createdUser,
        specialization: role === "teacher" ? teacherProfile?.specialization || null : null,
        phone: role === "teacher" ? teacherProfile?.phone || phone || "" : role === "parent" ? phone || "" : void 0
      };
      if (role === "teacher" && teacherProfile?.id) {
        responseBody.teacherId = teacherProfile.id;
        const assignments = await db.select({ classId: classTeachers.classId }).from(classTeachers).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherProfile.id));
        responseBody.classIds = assignments.map((a) => a.classId);
      }
      res.status(201).json(responseBody);
    } catch (err) {
      console.error("Error creating admin user:", err);
      res.status(500).json({ error: err?.message || "Failed to create user" });
    }
  });
  app.put("/api/admin/users/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor || !["super_admin", "school_admin"].includes(actor.role)) return res.status(403).json({ error: "Forbidden" });
      const id = parseInt(req.params.id);
      const { email, name, role, schoolId: incomingSchoolId, academicYearId: rawAcademicYearId, phone, specialization, gender, classIds, studentId } = req.body;
      const parsedSchoolId = incomingSchoolId != null && incomingSchoolId !== "" ? parseInt(incomingSchoolId, 10) : void 0;
      if (!email || !name || !role) return res.status(400).json({ error: "Missing required fields: email, name, role" });
      const academicYearId = rawAcademicYearId != null && rawAcademicYearId !== "" ? parseInt(rawAcademicYearId, 10) : void 0;
      if (rawAcademicYearId != null && rawAcademicYearId !== "" && Number.isNaN(academicYearId)) {
        return res.status(400).json({ error: "Invalid academicYearId" });
      }
      const allowed = ["super_admin", "school_admin", "teacher", "parent"];
      if (!allowed.includes(role)) return res.status(400).json({ error: "Invalid role" });
      const [targetUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.id, id));
      console.log("DEBUG delete: actor=", { uid: actor?.uid, role: actor?.role, schoolId: actor?.schoolId }, "targetId=", id, "targetUser=", targetUser ? { id: targetUser.id, role: targetUser.role, schoolId: targetUser.schoolId } : null);
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      if (targetUser.role === "teacher" && role !== "teacher") {
        return res.status(403).json({ error: "Forbidden: cannot change role for teacher accounts" });
      }
      if (actor.role === "school_admin" && actor.schoolId !== targetUser.schoolId) {
        if (["teacher", "parent"].includes(targetUser.role)) {
          const membership = await ensureUserSchoolMembership(targetUser.id, actor.schoolId, targetUser.role);
          if (!membership) {
            return res.status(403).json({ error: "Forbidden: cannot modify users outside your school" });
          }
        } else {
          return res.status(403).json({ error: "Forbidden: cannot modify users outside your school" });
        }
      }
      if (actor.role === "school_admin" && ["super_admin", "school_admin"].includes(role)) {
        return res.status(403).json({ error: "Forbidden: school_admin cannot modify admin accounts" });
      }
      if (actor.role === "school_admin" && ["super_admin", "school_admin"].includes(targetUser.role)) {
        return res.status(403).json({ error: "Forbidden: school_admin cannot modify admin accounts" });
      }
      if (email !== targetUser.email) {
        const normalizedEmail = email.trim().toLowerCase();
        let emailConflicts = [];
        if (targetUser.role === "super_admin" || role === "super_admin") {
          emailConflicts = await db.select().from(users).where(
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${users.email})`, normalizedEmail),
              import_drizzle_orm8.sql`${users.id} != ${id}`
            )
          );
        } else {
          const schoolForCheck = parsedSchoolId !== void 0 ? parsedSchoolId : targetUser.schoolId;
          if (schoolForCheck != null) {
            emailConflicts = await db.select().from(users).where(
              (0, import_drizzle_orm8.and)(
                (0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${users.email})`, normalizedEmail),
                (0, import_drizzle_orm8.eq)(users.schoolId, schoolForCheck),
                import_drizzle_orm8.sql`${users.id} != ${id}`
              )
            );
          }
        }
        if (emailConflicts.length > 0) {
          const school = parsedSchoolId !== void 0 ? parsedSchoolId : targetUser.schoolId;
          const msg = role === "super_admin" || targetUser.role === "super_admin" ? "Email already in use by another user" : school ? "Email already in use by another user in this school" : "Email already in use by another user";
          return res.status(409).json({ error: msg });
        }
      }
      const updatedValues = { email, name, role, gender: gender ?? null };
      if (parsedSchoolId !== void 0) updatedValues.schoolId = parsedSchoolId;
      if (role === "school_admin") {
        if (academicYearId == null) {
          return res.status(400).json({ error: "Missing required field: academicYearId is required for school_admin role" });
        }
        const selectedSchoolId = incomingSchoolId ? parseInt(String(incomingSchoolId), 10) : null;
        const [yearRow] = await db.select().from(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.id, academicYearId));
        if (!yearRow || yearRow.schoolId !== null && yearRow.schoolId !== selectedSchoolId) {
          return res.status(400).json({ error: "Invalid academicYearId for selected school" });
        }
        updatedValues.academicYearId = academicYearId;
      } else {
        updatedValues.academicYearId = null;
      }
      const updatedUsers = await db.update(users).set(updatedValues).where((0, import_drizzle_orm8.eq)(users.id, id)).returning();
      if (updatedUsers.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      const effectiveSchoolIdForMembership = role === "school_admin" ? parsedSchoolId !== void 0 ? parsedSchoolId : targetUser.schoolId : null;
      if (role === "school_admin" && effectiveSchoolIdForMembership != null) {
        await upsertUserSchoolMembership(id, effectiveSchoolIdForMembership, "school_admin", true);
      }
      if (role === "teacher") {
        await db.delete(parents).where((0, import_drizzle_orm8.eq)(parents.userId, id));
        const existingTeacher = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, id));
        let teacherProfileId = null;
        if (existingTeacher.length > 0) {
          teacherProfileId = existingTeacher[0].id;
          if (parsedSchoolId !== void 0) {
            await db.update(teachers).set({ schoolId: parsedSchoolId, phone: phone || "", specialization: normalizeSpecialization(specialization) || null }).where((0, import_drizzle_orm8.eq)(teachers.userId, id));
            try {
              await db.update(users).set({ schoolId: parsedSchoolId ?? null }).where((0, import_drizzle_orm8.eq)(users.id, id));
            } catch (e) {
              console.warn("DIAG: failed to sync users.schoolId during admin update", { userId: id, parsedSchoolId, err: e?.message || e });
            }
          } else {
            await db.update(teachers).set({ phone: phone || "", specialization: normalizeSpecialization(specialization) || null }).where((0, import_drizzle_orm8.eq)(teachers.userId, id));
          }
        } else {
          const [inserted] = await db.insert(teachers).values({ userId: id, schoolId: parsedSchoolId !== void 0 ? parsedSchoolId : void 0, phone: phone || "", specialization: normalizeSpecialization(specialization) || null }).returning();
          teacherProfileId = inserted?.id ?? null;
          if (parsedSchoolId !== void 0) {
            try {
              await db.update(users).set({ schoolId: parsedSchoolId ?? null }).where((0, import_drizzle_orm8.eq)(users.id, id));
            } catch (e) {
              console.warn("DIAG: failed to sync users.schoolId when inserting teacher profile", { userId: id, parsedSchoolId, err: e?.message || e });
            }
          }
        }
        if (teacherProfileId != null) {
          console.log("Updating class assignments for teacher (admin update):", { teacherProfileId, classIds });
          await db.delete(classTeachers).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherProfileId));
          if (Array.isArray(classIds) && classIds.length > 0) {
            const assignmentSchoolId = incomingSchoolId ? parseInt(String(incomingSchoolId), 10) : actor && actor.role === "school_admin" && actor.schoolId != null ? actor.schoolId : targetUser.schoolId;
            for (const rawClassId of classIds) {
              const cid = parseInt(rawClassId, 10);
              if (Number.isNaN(cid)) {
                console.log("DIAG admin update skip invalid id", { rawClassId, teacherProfileId });
                continue;
              }
              const [cls] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, cid));
              const [schoolClassRow] = assignmentSchoolId != null ? await db.select().from(schoolClasses).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolClasses.classId, cid), (0, import_drizzle_orm8.eq)(schoolClasses.schoolId, assignmentSchoolId))) : [null];
              const approved = await isApprovedClassForSchool(cid, assignmentSchoolId);
              if (!cls) {
                console.log("DIAG admin update - ignored", { cid, teacherProfileId, assignmentSchoolId, reason: "class_not_found", cls: null, schoolClassRow, approved });
                continue;
              }
              if (cls.schoolId != null && assignmentSchoolId != null && cls.schoolId !== assignmentSchoolId) {
                console.log("DIAG admin update - ignored", { cid, teacherProfileId, assignmentSchoolId, reason: "class_school_mismatch", cls, schoolClassRow, approved });
                continue;
              }
              if (!approved) {
                console.log("DIAG admin update - ignored", { cid, teacherProfileId, assignmentSchoolId, reason: "not_approved_for_school", cls, schoolClassRow, approved });
                continue;
              }
              try {
                await db.insert(classTeachers).values({ classId: cid, teacherId: teacherProfileId });
                const insertedRows = await db.select().from(classTeachers).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(classTeachers.classId, cid), (0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherProfileId)));
                console.log("DIAG admin update - inserted", { cid, teacherProfileId, insertedCount: insertedRows.length, cls, schoolClassRow, approved, assignmentSchoolId });
              } catch (e) {
                console.warn("Failed to insert classTeachers during admin update", { cid, teacherProfileId, err: e?.message || e });
              }
            }
          }
        }
      } else if (role === "parent") {
        const existingTeacher = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, id));
        if (existingTeacher.length > 0) {
          await db.delete(classTeachers).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, existingTeacher[0].id));
        }
        await db.delete(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, id));
        const normalizedStudentId = studentId != null && studentId !== "" ? parseInt(String(studentId), 10) : void 0;
        const resolvedStudentId = Number.isNaN(normalizedStudentId) ? void 0 : normalizedStudentId;
        const existingParent = await db.select().from(parents).where((0, import_drizzle_orm8.eq)(parents.userId, id));
        const parentValues = {
          phone: phone || "",
          address: typeof req.body.address === "string" ? req.body.address : existingParent[0]?.address || "",
          schoolId: incomingSchoolId ? Number.isNaN(Number(incomingSchoolId)) ? null : Number(incomingSchoolId) : existingParent[0]?.schoolId ?? null
        };
        if (resolvedStudentId != null) {
          parentValues.studentId = resolvedStudentId;
        } else if (studentId != null) {
          parentValues.studentId = null;
        }
        if (existingParent.length > 0) {
          await db.update(parents).set(parentValues).where((0, import_drizzle_orm8.eq)(parents.userId, id));
        } else {
          await db.insert(parents).values({ userId: id, ...parentValues });
        }
      } else {
        const existingTeacher = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, id));
        if (existingTeacher.length > 0) {
          await db.delete(classTeachers).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, existingTeacher[0].id));
        }
        await db.delete(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, id));
        await db.delete(parents).where((0, import_drizzle_orm8.eq)(parents.userId, id));
      }
      const [updatedUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.id, id));
      const diffDescription = formatUserUpdateDiff(targetUser, { email, name, role, schoolId: incomingSchoolId, phone, specialization });
      await logAuditEvent(actor, "update", "user", updatedUser.id, actor.schoolId ?? null, `${actor.role === "school_admin" ? "School admin" : "Super admin"} ${actor.email || actor.uid} updated account ${updatedUser.email}. ${diffDescription}`);
      if (role === "teacher") {
        const existingTeacher = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, id));
        let classIds2 = [];
        let teacherId = null;
        let phoneValue = phone || "";
        let specializationValue = normalizeSpecialization(specialization) || null;
        if (existingTeacher.length > 0) {
          teacherId = existingTeacher[0].id;
          phoneValue = existingTeacher[0].phone || phoneValue;
          specializationValue = existingTeacher[0].specialization || specializationValue;
          const assignments = await db.select({ classId: classTeachers.classId }).from(classTeachers).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, existingTeacher[0].id));
          classIds2 = assignments.map((a) => a.classId);
        }
        try {
          await logIfTeacherUserMismatch(updatedUser.id, teacherId);
        } catch (e) {
        }
        res.json({ ...updatedUser, teacherId, classIds: classIds2, phone: phoneValue, specialization: specializationValue });
      } else {
        res.json(updatedUser);
      }
    } catch (err) {
      console.error("Error updating admin user:", err);
      res.status(500).json({ error: err?.message || "Failed to update user" });
    }
  });
  app.delete("/api/admin/users/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor || actor.role !== "super_admin") {
        return res.status(403).json({ error: "Forbidden: only super_admin can delete user accounts" });
      }
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Invalid user id" });
      }
      const [targetUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.id, id));
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      await db.update(users).set({ isDeleted: true }).where((0, import_drizzle_orm8.eq)(users.id, id));
      await logAuditEvent(
        actor,
        "delete",
        "user",
        id,
        actor.schoolId ?? null,
        `Super admin ${actor.name} deactivated user account ${targetUser.name} (${targetUser.email})`
      );
      res.json({ success: true, id });
    } catch (err) {
      console.error("Error deleting user:", err);
      res.status(500).json({ error: err?.message || "Failed to delete user" });
    }
  });
  app.get("/api/audit/events", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor || actor.role !== "super_admin") return res.status(403).json({ error: "Forbidden" });
      const events = await db.select().from(auditEvents).orderBy((0, import_drizzle_orm8.desc)(auditEvents.createdAt));
      res.json(events);
    } catch (err) {
      console.error("Failed fetching audit events:", err);
      res.status(500).json({ error: "Failed to retrieve audit events" });
    }
  });
  app.post("/api/admin/set-password", requireAuth, async (req, res) => {
    try {
      console.log("DEBUG /api/admin/set-password headers", {
        simulatedRole: req.headers["x-simulated-role"],
        simulatedSchoolId: req.headers["x-simulated-school-id"],
        contentType: req.headers["content-type"]
      });
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      console.log("DEBUG /api/admin/set-password actor", actor);
      if (!actor || !["super_admin", "school_admin"].includes(actor.role)) return res.status(403).json({ error: "Forbidden" });
      const { userId, password } = req.body;
      console.log("DEBUG /api/admin/set-password body", { userId, passwordPresent: !!password });
      if (!userId || !password) return res.status(400).json({ error: "Missing userId or password" });
      if (password === "123456") return res.status(400).json({ error: "Le mot de passe ne peut pas \xEAtre le mot de passe par d\xE9faut" });
      const [targetUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.id, parseInt(userId)));
      console.log("DEBUG /api/admin/set-password targetUser", targetUser);
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      if (targetUser.role === "student") return res.status(403).json({ error: "Cannot set password for student profile" });
      if (actor.role === "school_admin") {
        if (targetUser.schoolId !== actor.schoolId) {
          console.log("DEBUG /api/admin/set-password forbidden school mismatch", { actorSchoolId: actor.schoolId, targetSchoolId: targetUser.schoolId });
          return res.status(403).json({ error: "Forbidden: cannot set password for users outside your school" });
        }
        if (["super_admin", "school_admin"].includes(targetUser.role)) {
          return res.status(403).json({ error: "Forbidden: cannot set password for admin accounts" });
        }
      }
      const crypto = await import("node:crypto");
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto.pbkdf2Sync(password, salt, 31e4, 64, "sha512").toString("hex");
      const exists = await db.select().from(localAuths).where((0, import_drizzle_orm8.eq)(localAuths.userId, parseInt(userId)));
      if (exists.length > 0) {
        await db.update(localAuths).set({ passwordHash: hash, salt, mustReset: false }).where((0, import_drizzle_orm8.eq)(localAuths.userId, parseInt(userId)));
      } else {
        await db.insert(localAuths).values({ userId: parseInt(userId), passwordHash: hash, salt, mustReset: false }).returning();
      }
      res.json({ success: true, userId });
    } catch (err) {
      console.error("Error setting password:", err);
      res.status(500).json({ error: err?.message || "Failed to set password" });
    }
  });
  console.log("REGISTER ROUTE: PUT /api/users/:id");
  app.put("/api/users/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid user id" });
      if (!actor) return res.status(403).json({ error: "Forbidden" });
      const actorIsOwner = actor.id && Number(actor.id) === id;
      if (!(actorIsOwner || ["super_admin", "school_admin"].includes(actor.role))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { firstName, lastName, name, phone, address } = req.body;
      let displayName = name;
      if (!displayName && (firstName || lastName)) displayName = [firstName || "", lastName || ""].filter(Boolean).join(" ");
      const updatedFields = {};
      if (displayName) updatedFields.name = displayName;
      console.log("DEBUG /api/users/:id update request", { actor: actor ? { id: actor.id, uid: actor.uid, role: actor.role } : null, targetId: id, body: req.body });
      if (Object.keys(updatedFields).length > 0) {
        console.log("DEBUG updating users table", { id, updatedFields });
        await db.update(users).set(updatedFields).where((0, import_drizzle_orm8.eq)(users.id, id));
      }
      const [targetUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.id, id));
      if (targetUser && targetUser.role === "parent") {
        const existingParent = await db.select().from(parents).where((0, import_drizzle_orm8.eq)(parents.userId, id));
        const parentValues = {
          phone: typeof phone === "string" ? phone : existingParent[0]?.phone || "",
          address: typeof address === "string" ? address : existingParent[0]?.address || ""
        };
        if (existingParent.length > 0) {
          console.log("DEBUG updating parents row", { userId: id, parentValues });
          await db.update(parents).set(parentValues).where((0, import_drizzle_orm8.eq)(parents.userId, id));
        } else {
          console.log("DEBUG inserting parents row", { userId: id, parentValues });
          await db.insert(parents).values({ userId: id, ...parentValues });
        }
      }
      const [updatedUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.id, id));
      console.log("DEBUG /api/users/:id update result", { updatedUser });
      await logAuditEvent(actor, "update", "user", updatedUser.id, actor.schoolId ?? null, `${actor.role === "school_admin" ? "School admin" : actor.role === "super_admin" ? "Super admin" : "User"} ${actor.email || actor.uid} updated account ${updatedUser.email}`);
      res.json(updatedUser);
    } catch (err) {
      console.error("Error in self-update user:", err);
      res.status(500).json({ error: err?.message || "Failed to update user" });
    }
  });
  app.post("/api/auth/local-login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
      const normalizedEmail = email.trim().toLowerCase();
      const usersFound = await db.select().from(users).where((0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${users.email})`, normalizedEmail));
      if (usersFound.length === 0) return res.status(401).json({ error: "Email ou mot de passe invalide" });
      const userRecord = usersFound[0];
      if (userRecord.role === "student") return res.status(401).json({ error: "Connexion non autoris\xE9e pour un compte \xE9l\xE8ve" });
      const authRows = await db.select().from(localAuths).where((0, import_drizzle_orm8.eq)(localAuths.userId, userRecord.id));
      if (authRows.length === 0) return res.status(401).json({ error: "Aucun mot de passe enregistr\xE9 pour cet utilisateur" });
      const { passwordHash, salt, mustReset } = authRows[0];
      const crypto = await import("node:crypto");
      const verifyHash = crypto.pbkdf2Sync(password, salt, 31e4, 64, "sha512").toString("hex");
      if (verifyHash !== passwordHash) return res.status(401).json({ error: "Mot de passe incorrect" });
      let localMustReset = !!mustReset;
      if (typeof mustReset === "undefined" || mustReset === null) {
        try {
          const defaultHash = crypto.pbkdf2Sync("123456", salt, 31e4, 64, "sha512").toString("hex");
          localMustReset = passwordHash === defaultHash;
        } catch (e) {
          localMustReset = false;
        }
      }
      const response = { ...userRecord, mustReset: !!localMustReset };
      res.json(response);
    } catch (err) {
      console.error("Local login error:", err);
      res.status(500).json({ error: err?.message || "Login failed" });
    }
  });
  app.post("/api/auth/logout", async (req, res) => {
    try {
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to logout" });
    }
  });
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const { email, currentPassword, newPassword } = req.body;
      if (!email || !currentPassword || !newPassword) return res.status(400).json({ error: "Missing fields" });
      if (newPassword === "123456") return res.status(400).json({ error: "Le mot de passe ne peut pas \xEAtre le mot de passe par d\xE9faut" });
      const normalizedEmail = String(email).trim().toLowerCase();
      const usersFound = await db.select().from(users).where((0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${users.email})`, normalizedEmail));
      if (usersFound.length === 0) return res.status(404).json({ error: "Utilisateur non trouv\xE9" });
      const userRecord = usersFound[0];
      const authRows = await db.select().from(localAuths).where((0, import_drizzle_orm8.eq)(localAuths.userId, userRecord.id));
      if (authRows.length === 0) return res.status(400).json({ error: "Aucun mot de passe enregistr\xE9 pour cet utilisateur" });
      const { passwordHash, salt } = authRows[0];
      const crypto = await import("node:crypto");
      const verifyHash = crypto.pbkdf2Sync(currentPassword, salt, 31e4, 64, "sha512").toString("hex");
      if (verifyHash !== passwordHash) return res.status(401).json({ error: "Mot de passe actuel incorrect" });
      const newSalt = crypto.randomBytes(16).toString("hex");
      const newHash = crypto.pbkdf2Sync(newPassword, newSalt, 31e4, 64, "sha512").toString("hex");
      await db.update(localAuths).set({ passwordHash: newHash, salt: newSalt, mustReset: false }).where((0, import_drizzle_orm8.eq)(localAuths.userId, userRecord.id));
      res.json({ success: true });
    } catch (err) {
      console.error("change-password error:", err);
      res.status(500).json({ error: err?.message || "Failed to change password" });
    }
  });
  app.get("/api/auth/schools", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const memberships = await getUserSchoolMemberships(actor.id ?? null);
      let schoolsList = [];
      if (actor.role === "super_admin") {
        schoolsList = await db.select().from(schools);
      } else {
        const schoolIds = memberships.map((membership) => membership.schoolId).filter((id) => id != null);
        if (schoolIds.length > 0) {
          schoolsList = await db.select().from(schools).where((0, import_drizzle_orm8.inArray)(schools.id, schoolIds));
        } else if (actor.schoolId != null) {
          schoolsList = await db.select().from(schools).where((0, import_drizzle_orm8.eq)(schools.id, actor.schoolId));
        } else if (actor.role === "parent" && actor.id) {
          const parentRows = await db.select({ schoolId: parents.schoolId, studentId: parents.studentId }).from(parents).where((0, import_drizzle_orm8.eq)(parents.userId, actor.id));
          const fallbackIds = /* @__PURE__ */ new Set();
          for (const row of parentRows) {
            if (row.schoolId != null) fallbackIds.add(row.schoolId);
            if (row.studentId != null) {
              const [studentRow] = await db.select({ schoolId: students.schoolId }).from(students).where((0, import_drizzle_orm8.eq)(students.id, row.studentId));
              if (studentRow?.schoolId != null) {
                fallbackIds.add(studentRow.schoolId);
              }
            }
          }
          if (fallbackIds.size > 0) {
            schoolsList = await db.select().from(schools).where((0, import_drizzle_orm8.inArray)(schools.id, Array.from(fallbackIds)));
          }
        }
      }
      const activeSchoolId = actor.role === "super_admin" ? null : memberships.find((membership) => membership.isActive)?.schoolId ?? actor.schoolId ?? schoolsList[0]?.id ?? null;
      res.json({
        schools: schoolsList.map((school) => ({ id: school.id, name: school.name })),
        activeSchoolId
      });
    } catch (err) {
      console.error("Error fetching user schools:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch user schools" });
    }
  });
  app.post("/api/auth/schools/active", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const { schoolId } = req.body ?? {};
      const parsedSchoolId = typeof schoolId === "number" ? schoolId : parseInt(String(schoolId), 10);
      if (!Number.isFinite(parsedSchoolId)) return res.status(400).json({ error: "Invalid schoolId" });
      if (actor.role === "super_admin") {
        res.json({ schoolId: parsedSchoolId });
        return;
      }
      let membership = actor.role === "school_admin" ? await ensureUserSchoolMembership(actor.id ?? null, parsedSchoolId, "school_admin") : await ensureUserSchoolMembership(actor.id ?? null, parsedSchoolId);
      if (!membership && actor.role === "parent" && actor.id) {
        try {
          const parentRows = await db.select({ schoolId: parents.schoolId, studentId: parents.studentId }).from(parents).where((0, import_drizzle_orm8.eq)(parents.userId, actor.id));
          let canCreate = false;
          for (const row of parentRows) {
            if (row.schoolId === parsedSchoolId) {
              canCreate = true;
              break;
            }
            if (row.studentId != null) {
              const [studentRow] = await db.select({ schoolId: students.schoolId }).from(students).where((0, import_drizzle_orm8.eq)(students.id, row.studentId));
              if (studentRow?.schoolId === parsedSchoolId) {
                canCreate = true;
                break;
              }
            }
          }
          if (canCreate) {
            await upsertUserSchoolMembership(actor.id, parsedSchoolId, "parent", true);
            membership = await ensureUserSchoolMembership(actor.id, parsedSchoolId);
            console.log("Auto-created user_schools membership for parent", { userId: actor.id, schoolId: parsedSchoolId });
          }
        } catch (e) {
          console.warn("Failed to auto-create parent membership:", e?.message || e);
        }
      }
      if (!membership && !actor.id) {
        console.warn("School selection rejected: actor has no ID", {
          schoolId: parsedSchoolId,
          userRole: actor.role,
          actorHasId: !!actor.id
        });
        return res.status(403).json({ error: "User identity cannot be verified" });
      }
      if (!membership) {
        console.warn("School selection denied: user has no membership for school", {
          userId: actor.id,
          schoolId: parsedSchoolId,
          userRole: actor.role
        });
        return res.status(403).json({ error: "School membership not found for this user" });
      }
      await setActiveUserSchool(actor.id ?? null, parsedSchoolId);
      console.log("School activated successfully", { userId: actor.id, schoolId: parsedSchoolId });
      res.json({ schoolId: parsedSchoolId });
    } catch (err) {
      console.error("Error setting active school:", err);
      res.status(500).json({ error: err?.message || "Failed to set active school" });
    }
  });
  app.post("/api/auth/register-or-login", requireAuth, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthenticated" });
      }
      const { uid, email, name, role } = req.user;
      const normalizedEmail = normalizeEmail(email);
      const existingUser = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, uid));
      if (existingUser.length > 0) {
        const existing = existingUser[0];
        if (req.user.schoolId && existing.schoolId !== req.user.schoolId) {
          await db.update(users).set({ schoolId: req.user.schoolId }).where((0, import_drizzle_orm8.eq)(users.uid, uid));
          existing.schoolId = req.user.schoolId;
        }
        return res.json(existing);
      }
      if (normalizedEmail) {
        let existingByEmail = [];
        if (req.user.schoolId) {
          existingByEmail = await db.select().from(users).where(
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${users.email})`, normalizedEmail),
              (0, import_drizzle_orm8.eq)(users.schoolId, req.user.schoolId)
            )
          );
        } else {
          existingByEmail = await db.select().from(users).where((0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${users.email})`, normalizedEmail));
        }
        if (existingByEmail.length > 0) {
          const existing = existingByEmail[0];
          if (req.user.schoolId && existing.schoolId !== req.user.schoolId) {
            await db.update(users).set({ schoolId: req.user.schoolId }).where((0, import_drizzle_orm8.eq)(users.id, existing.id));
            existing.schoolId = req.user.schoolId;
          }
          return res.json(existing);
        }
      }
      const allowedRoles = ["super_admin", "school_admin", "teacher", "parent"];
      const normalizedRole = String(role || "").trim();
      const finalRole = allowedRoles.includes(normalizedRole) ? normalizedRole : "parent";
      let resolvedSchoolId = req.user.schoolId ?? null;
      if (req.user.simulated && !resolvedSchoolId && finalRole !== "super_admin") {
        const defaultSchool = await db.select().from(schools).limit(1);
        if (defaultSchool.length > 0) {
          resolvedSchoolId = defaultSchool[0].id;
        }
      }
      const newUserResult = await db.insert(users).values({
        uid,
        email: email || "user@schooltrack.fr",
        name: name || "Nouvel Utilisateur",
        role: finalRole,
        schoolId: resolvedSchoolId
      }).returning();
      const createdUser = newUserResult[0];
      if (finalRole === "parent") {
        await db.insert(parents).values({
          userId: createdUser.id,
          phone: "",
          address: ""
        });
        if (resolvedSchoolId != null) {
          try {
            await db.insert(userSchools).values({
              userId: createdUser.id,
              schoolId: resolvedSchoolId,
              role: "parent",
              isActive: true
            });
          } catch (e) {
            console.warn("Failed to insert user_schools for register-or-login parent", e?.message || e);
          }
        }
      } else if (finalRole === "school_admin") {
        if (resolvedSchoolId != null) {
          try {
            await upsertUserSchoolMembership(createdUser.id, resolvedSchoolId, "school_admin", true);
          } catch (e) {
            console.warn("Failed to insert user_schools for register-or-login school_admin", e?.message || e);
          }
        }
      } else if (finalRole === "teacher") {
        const defaultSchool = await db.select().from(schools).limit(1);
        if (defaultSchool.length > 0) {
          await db.insert(teachers).values({
            userId: createdUser.id,
            schoolId: defaultSchool[0].id,
            phone: "",
            specialization: "G\xE9n\xE9ral"
          });
          try {
            await db.insert(userSchools).values({
              userId: createdUser.id,
              schoolId: defaultSchool[0].id,
              role: "teacher",
              isActive: true
            });
          } catch (e) {
            console.warn("Failed to insert user_schools for register-or-login teacher", e?.message || e);
          }
          try {
            const createdTeacherRow = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, createdUser.id));
            if (createdTeacherRow.length > 0) {
              await logIfTeacherUserMismatch(createdUser.id, createdTeacherRow[0].id);
            }
          } catch (e) {
          }
        }
      }
      res.json(createdUser);
      return;
    } catch (err) {
      console.error("Error in register-or-login:", err);
      res.status(500).json({ error: "Failed to register or login" });
    }
  });
  app.get("/api/schools", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const user = await resolveActor(req);
      if (!user) return res.status(401).json({ error: "Unauthenticated" });
      let list;
      if (user.role === "super_admin") {
        list = await db.select().from(schools);
      } else if ((user.role === "school_admin" || user.role === "parent" || user.role === "teacher") && user.schoolId) {
        list = await db.select().from(schools).where((0, import_drizzle_orm8.eq)(schools.id, user.schoolId));
      } else {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: "Failed to retrieve schools" });
    }
  });
  app.post("/api/schools", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const { name, address, phone, classNames, subjectNames } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const user = await resolveActor(req);
      if (!user) {
        console.log("TRACE /api/evaluations about to return 404 after resolveActor", { reqUser: req.user });
        return res.status(404).json({ error: "User not found" });
      }
      if (user.role !== "super_admin") {
        return res.status(403).json({ error: "Only super admin can create schools" });
      }
      const result = await db.insert(schools).values({ name, address, phone }).returning();
      const createdSchool = result[0];
      if (Array.isArray(classNames) && classNames.length > 0) {
        try {
          const [globalActiveYear] = await db.select().from(academicYears).where(
            (0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(academicYears.isActive, true), import_drizzle_orm8.sql`${academicYears.schoolId} IS NULL`)
          ).limit(1);
          let yearId = globalActiveYear?.id;
          if (!yearId) {
            const [globalYear] = await db.select().from(academicYears).where(import_drizzle_orm8.sql`${academicYears.schoolId} IS NULL`).orderBy((0, import_drizzle_orm8.desc)(academicYears.id)).limit(1);
            yearId = globalYear?.id;
          }
          if (!yearId) {
            const [anyYear] = await db.select().from(academicYears).orderBy((0, import_drizzle_orm8.desc)(academicYears.id)).limit(1);
            yearId = anyYear?.id;
          }
          if (!yearId) {
            console.warn("No academic years exist yet; skipped class creation for school because no global year was available.");
          } else {
            for (const className of classNames) {
              const trimmedClassName = String(className || "").trim();
              if (!trimmedClassName) continue;
              try {
                await db.insert(classes).values({
                  name: trimmedClassName,
                  schoolId: createdSchool.id,
                  academicYearId: yearId
                }).returning();
              } catch (classErr) {
                console.warn(`Warning: Could not create class "${trimmedClassName}":`, classErr?.message);
              }
            }
          }
        } catch (classCreationErr) {
          console.warn("Warning: Could not create classes for school:", classCreationErr?.message);
        }
      }
      if (Array.isArray(subjectNames) && subjectNames.length > 0) {
        try {
          for (const subjectName of subjectNames) {
            const trimmedSubjectName = String(subjectName || "").trim();
            if (!trimmedSubjectName) continue;
            const existingSubject = await db.select().from(subjects).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(subjects.schoolId, createdSchool.id), (0, import_drizzle_orm8.eq)(subjects.name, trimmedSubjectName))).limit(1);
            if (existingSubject.length > 0) continue;
            await db.insert(subjects).values({
              name: trimmedSubjectName,
              schoolId: createdSchool.id
            });
          }
        } catch (subjectCreationErr) {
          console.warn("Warning: Could not create subjects for school:", subjectCreationErr?.message);
        }
      }
      res.status(201).json(createdSchool);
    } catch (err) {
      console.error("Error creating school:", err);
      res.status(500).json({ error: err.message || "Failed to create school" });
    }
  });
  app.put("/api/schools/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const id = parseInt(req.params.id);
      const { name, address, phone, classNames, subjectNames } = req.body;
      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin") {
        return res.status(403).json({ error: "Only super admin can modify school information" });
      }
      const [existingSchool] = await db.select().from(schools).where((0, import_drizzle_orm8.eq)(schools.id, id));
      if (!existingSchool) {
        return res.status(404).json({ error: "School not found" });
      }
      const result = await db.update(schools).set({ name, address, phone }).where((0, import_drizzle_orm8.eq)(schools.id, id)).returning();
      if (result.length === 0) {
        return res.status(404).json({ error: "School not found" });
      }
      if (Array.isArray(classNames) && classNames.length > 0) {
        try {
          const [globalActiveYear] = await db.select().from(academicYears).where(
            (0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(academicYears.isActive, true), import_drizzle_orm8.sql`${academicYears.schoolId} IS NULL`)
          ).limit(1);
          let yearId = globalActiveYear?.id;
          if (!yearId) {
            const [globalYear] = await db.select().from(academicYears).where(import_drizzle_orm8.sql`${academicYears.schoolId} IS NULL`).orderBy((0, import_drizzle_orm8.desc)(academicYears.id)).limit(1);
            yearId = globalYear?.id;
          }
          if (!yearId) {
            const [anyYear] = await db.select().from(academicYears).orderBy((0, import_drizzle_orm8.desc)(academicYears.id)).limit(1);
            yearId = anyYear?.id;
          }
          if (!yearId) {
            console.warn("No academic years exist yet; skipped class creation during school update because no global year was available.");
          } else {
            for (const className of classNames) {
              const trimmedClassName = String(className || "").trim();
              if (!trimmedClassName) continue;
              const existingClass = await db.select().from(classes).where(
                (0, import_drizzle_orm8.and)(
                  (0, import_drizzle_orm8.eq)(classes.schoolId, id),
                  (0, import_drizzle_orm8.eq)(classes.academicYearId, yearId),
                  (0, import_drizzle_orm8.eq)(classes.name, trimmedClassName)
                )
              ).limit(1);
              if (existingClass.length > 0) continue;
              try {
                await db.insert(classes).values({
                  name: trimmedClassName,
                  schoolId: id,
                  academicYearId: yearId
                }).returning();
              } catch (classErr) {
                console.warn(`Warning: Could not create class "${trimmedClassName}" during school update:`, classErr?.message);
              }
            }
          }
        } catch (classCreationErr) {
          console.warn("Warning: Could not create classes during school update:", classCreationErr?.message);
        }
      }
      if (Array.isArray(subjectNames) && subjectNames.length > 0) {
        try {
          for (const subjectName of subjectNames) {
            const trimmedSubjectName = String(subjectName || "").trim();
            if (!trimmedSubjectName) continue;
            const existingSubject = await db.select().from(subjects).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(subjects.schoolId, id), (0, import_drizzle_orm8.eq)(subjects.name, trimmedSubjectName))).limit(1);
            if (existingSubject.length > 0) continue;
            await db.insert(subjects).values({
              name: trimmedSubjectName,
              schoolId: id
            });
          }
        } catch (subjectCreationErr) {
          console.warn("Warning: Could not create subjects during school update:", subjectCreationErr?.message);
        }
      }
      const changes = [];
      if (name && name !== existingSchool.name) {
        changes.push(`name: "${existingSchool.name}" \u2192 "${name}"`);
      }
      if (address && address !== existingSchool.address) {
        changes.push(`address: "${existingSchool.address || ""}" \u2192 "${address}"`);
      }
      if (phone && phone !== existingSchool.phone) {
        changes.push(`phone: "${existingSchool.phone || ""}" \u2192 "${phone}"`);
      }
      if (Array.isArray(classNames) && classNames.length > 0) {
        const addedNames = classNames.map((n) => String(n || "").trim()).filter((n) => n);
        if (addedNames.length > 0) {
          changes.push(`classes ajout\xE9es: ${addedNames.join(", ")}`);
        }
      }
      const diffDescription = changes.length > 0 ? `Champs modifi\xE9s: ${changes.join("; ")}` : "Aucun champ modifi\xE9 d\xE9tect\xE9.";
      await logAuditEvent(user, "update", "school", id, id, `Super admin ${user.email || user.uid} updated school "${existingSchool.name}". ${diffDescription}`);
      res.json(result[0]);
    } catch (err) {
      console.error("Error updating school:", err);
      res.status(500).json({ error: "Failed to update school" });
    }
  });
  app.get("/api/schools/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid school id" });
      const user = await resolveActor(req);
      if (!user) return res.status(401).json({ error: "Unauthenticated" });
      const [schoolRow] = await db.select().from(schools).where((0, import_drizzle_orm8.eq)(schools.id, id));
      if (!schoolRow) return res.status(404).json({ error: "\xC9cole introuvable" });
      if (user.role === "super_admin" || user.schoolId && Number(user.schoolId) === id) {
        return res.json(schoolRow);
      }
      return res.status(403).json({ error: "Forbidden" });
    } catch (err) {
      console.error("Failed to fetch school by id:", err);
      res.status(500).json({ error: "Failed to retrieve school" });
    }
  });
  app.get("/api/students/template", async (req, res) => {
    try {
      const XLSX = await import("xlsx");
      const rows = [
        // Headers: prefer both IDs and helpful parent contact fields for convenience
        ["firstName", "lastName", "birthDate", "schoolId", "classId", "parentId", "parentName", "parentEmail", "parentPhone", "academicYearId", "teacherId", "schoolAdminId", "gender"],
        // Example rows
        ["Lucas", "Dubois", "2008-04-12", 1, 1, 1, "Marie Dubois", "marie.dubois@example.com", "90000001", 1, 2, 1, "Masculin"],
        ["Chloe", "Dubois", "2010-09-25", 1, 1, 1, "Paul Dubois", "paul.dubois@example.com", "90000002", 1, 3, 1, "F\xE9minin"]
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "students");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="students_template.xlsx"');
      res.send(Buffer.from(buf));
    } catch (err) {
      console.error("Failed to generate Excel template", err);
      res.status(500).json({ error: "Failed to generate students template" });
    }
  });
  app.post("/api/students/batch", requireAuth, async (req, res) => {
    try {
      console.log("Received students batch import request", { headers: req.headers && { "x-simulated-role": req.headers["x-simulated-role"], "content-type": req.headers["content-type"] } });
      console.log("Batch request body preview:", typeof req.body === "object" ? Array.isArray(req.body) ? `array(${req.body.length})` : "object" : typeof req.body);
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const userRows = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      let userRecord = userRows[0];
      if (!userRecord && req.user.simulated && req.user.role === "super_admin") {
        console.log("Simulated super_admin detected and no DB profile found; bypassing user lookup for dev.");
        userRecord = { uid: req.user.uid, role: "super_admin" };
      }
      if (!userRecord) return res.status(404).json({ error: "User profile not found" });
      if (!["super_admin", "school_admin"].includes(userRecord.role)) {
        return res.status(403).json({ error: "Permission denied" });
      }
      const payload = req.body;
      if (!Array.isArray(payload)) return res.status(400).json({ error: "Expected an array of students" });
      const schoolIds = Array.from(new Set(payload.map((p) => p.schoolId).filter(Boolean).map((v) => parseInt(v))));
      const classIds = Array.from(new Set(payload.map((p) => p.classId).filter(Boolean).map((v) => parseInt(v))));
      const parentIds = Array.from(new Set(payload.map((p) => p.parentId).filter(Boolean).map((v) => parseInt(v))));
      if (userRecord.role === "school_admin" && userRecord.schoolId) {
        schoolIds.push(userRecord.schoolId);
      }
      const existingSchoolRows = schoolIds.length > 0 ? await db.select({ id: schools.id }).from(schools).where(import_drizzle_orm8.sql`${schools.id} IN ${schoolIds}`) : [];
      const existingClassRows = classIds.length > 0 ? await db.select({ id: classes.id }).from(classes).where(import_drizzle_orm8.sql`${classes.id} IN ${classIds}`) : [];
      const existingParentRows = parentIds.length > 0 ? await db.select({ id: parents.id }).from(parents).where(import_drizzle_orm8.sql`${parents.id} IN ${parentIds}`) : [];
      const existingSchoolIds = new Set(existingSchoolRows.map((r) => r.id));
      const existingClassIds = new Set(existingClassRows.map((r) => r.id));
      const existingParentIds = new Set(existingParentRows.map((r) => r.id));
      const inserted = [];
      const errors = [];
      for (let i = 0; i < payload.length; i++) {
        const s = payload[i];
        const firstName = s.firstName?.trim();
        const lastName = s.lastName?.trim();
        const birthDate = s.birthDate?.trim() || "";
        const resolvedSchoolId = userRecord.role === "school_admin" ? userRecord.schoolId : s.schoolId;
        const schoolId = resolvedSchoolId ? parseInt(resolvedSchoolId) : null;
        const classId = s.classId ? parseInt(s.classId) : null;
        const parentId = s.parentId ? parseInt(s.parentId) : null;
        const gender = s.gender != null && s.gender !== "" ? String(s.gender).trim() : null;
        if (!firstName || !lastName) {
          errors.push({ row: i, reason: "Missing firstName or lastName", data: s });
          continue;
        }
        if (!schoolId || !existingSchoolIds.has(schoolId)) {
          errors.push({ row: i, reason: `Invalid or missing schoolId: ${schoolId}`, data: s });
          continue;
        }
        if (!classId || !existingClassIds.has(classId)) {
          errors.push({ row: i, reason: `Invalid or missing classId: ${classId}`, data: s });
          continue;
        }
        if (!parentId || !existingParentIds.has(parentId)) {
          errors.push({ row: i, reason: `Invalid or missing parentId: ${parentId}`, data: s });
          continue;
        }
        try {
          const resolvedSchoolAdminId = await (async () => {
            if (userRecord.role === "school_admin") {
              return userRecord.id;
            }
            const explicitAdminId = s.schoolAdminId ? parseInt(s.schoolAdminId) : void 0;
            if (explicitAdminId) {
              const [assignedAdmin] = await db.select().from(users).where(
                (0, import_drizzle_orm8.and)(
                  (0, import_drizzle_orm8.eq)(users.id, explicitAdminId),
                  (0, import_drizzle_orm8.eq)(users.role, "school_admin"),
                  (0, import_drizzle_orm8.eq)(users.schoolId, schoolId)
                )
              );
              if (!assignedAdmin) {
                throw new Error("Invalid schoolAdminId for this school");
              }
              return assignedAdmin.id;
            }
            const admins = await db.select({ id: users.id }).from(users).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(users.role, "school_admin"), (0, import_drizzle_orm8.eq)(users.schoolId, schoolId)));
            if (admins.length === 1) {
              return admins[0].id;
            }
            if (admins.length === 0) {
              throw new Error("No school admin found for this school");
            }
            throw new Error("Multiple school admins found for this school. Please specify schoolAdminId in the import file.");
          })();
          const result = await db.insert(students).values({
            firstName,
            lastName,
            birthDate,
            schoolId,
            classId,
            parentId,
            schoolAdminId: resolvedSchoolAdminId,
            gender
          }).returning();
          inserted.push(result[0]);
        } catch (e) {
          console.error("Insert student failed for row", i, e?.message || e);
          errors.push({ row: i, reason: e?.message || "Insert failed", data: s });
        }
      }
      res.json({ insertedCount: inserted.length, inserted, errors });
    } catch (err) {
      console.error("Error in students batch import:", err);
      res.status(500).json({ error: err?.message || "Failed to import students" });
    }
  });
  app.delete("/api/schools/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!req.user) {
        return res.status(401).json({ error: "Utilisateur non authentifi\xE9." });
      }
      const user = await resolveActor(req);
      if (!user) {
        return res.status(404).json({ error: "Profil utilisateur introuvable." });
      }
      if (user.role !== "super_admin") {
        return res.status(403).json({ error: "Seul un super administrateur peut supprimer un \xE9tablissement." });
      }
      const [school] = await db.select().from(schools).where((0, import_drizzle_orm8.eq)(schools.id, id));
      if (!school) {
        return res.status(404).json({ error: "\xC9cole introuvable." });
      }
      await db.transaction(async (tx) => {
        const schoolUserIds = (await tx.select({ id: users.id }).from(users).where((0, import_drizzle_orm8.eq)(users.schoolId, id))).map((u) => u.id);
        const classIds = (await tx.select({ id: classes.id }).from(classes).where((0, import_drizzle_orm8.eq)(classes.schoolId, id))).map((c) => c.id);
        const studentIds = (await tx.select({ id: students.id }).from(students).where((0, import_drizzle_orm8.eq)(students.schoolId, id))).map((s) => s.id);
        const academicYearIds = (await tx.select({ id: academicYears.id }).from(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.schoolId, id))).map((a) => a.id);
        const evaluationIds = classIds.length > 0 ? (await tx.select({ id: evaluations.id }).from(evaluations).where(import_drizzle_orm8.sql`${evaluations.classId} IN ${classIds}`)).map((e) => e.id) : [];
        console.log(`School deletion order for school=${id}: users=${schoolUserIds.length}, classes=${classIds.length}, students=${studentIds.length}, academicYears=${academicYearIds.length}, evaluations=${evaluationIds.length}`);
        if (schoolUserIds.length > 0) {
          console.log(`Step 1/10: delete notifications for users [${schoolUserIds.join(", ")}]`);
          await tx.delete(notifications).where(import_drizzle_orm8.sql`${notifications.userId} IN ${schoolUserIds}`);
        }
        if (studentIds.length > 0) {
          console.log(`Step 2/10: delete absences for students [${studentIds.join(", ")}]`);
          await tx.delete(absences).where(import_drizzle_orm8.sql`${absences.studentId} IN ${studentIds}`);
        }
        if (classIds.length > 0) {
          console.log(`Step 3/10: delete absences for classes [${classIds.join(", ")}]`);
          await tx.delete(absences).where(import_drizzle_orm8.sql`${absences.classId} IN ${classIds}`);
        }
        if (studentIds.length > 0) {
          console.log(`Step 4/10: delete grades for students [${studentIds.join(", ")}]`);
          await tx.delete(grades).where(import_drizzle_orm8.sql`${grades.studentId} IN ${studentIds}`);
        }
        if (evaluationIds.length > 0) {
          console.log(`Step 5/10: delete grades for evaluations [${evaluationIds.join(", ")}]`);
          await tx.delete(grades).where(import_drizzle_orm8.sql`${grades.evaluationId} IN ${evaluationIds}`);
        }
        if (evaluationIds.length > 0) {
          console.log(`Step 6/10: delete evaluations [${evaluationIds.join(", ")}]`);
          await tx.delete(evaluations).where(import_drizzle_orm8.sql`${evaluations.id} IN ${evaluationIds}`);
        }
        if (studentIds.length > 0) {
          console.log(`Step 7/10: delete students [${studentIds.join(", ")}]`);
          await tx.delete(students).where(import_drizzle_orm8.sql`${students.id} IN ${studentIds}`);
        }
        if (schoolUserIds.length > 0) {
          console.log(`Step 8/10: delete parent profiles for users [${schoolUserIds.join(", ")}]`);
          await tx.delete(parents).where(import_drizzle_orm8.sql`${parents.userId} IN ${schoolUserIds}`);
        }
        if (classIds.length > 0) {
          console.log(`Step 9/10: unset teacher assignments for classes [${classIds.join(", ")}]`);
          await tx.update(classes).set({ teacherId: null }).where(import_drizzle_orm8.sql`${classes.id} IN ${classIds}`);
        }
        if (schoolUserIds.length > 0) {
          console.log(`Step 10/11: disconnect schoolAdminId and delete audit events for users [${schoolUserIds.join(", ")}]`);
          await tx.update(students).set({ schoolAdminId: null }).where(import_drizzle_orm8.sql`${students.schoolAdminId} IN ${schoolUserIds}`);
          await tx.delete(auditEvents).where(import_drizzle_orm8.sql`${auditEvents.actorUserId} IN ${schoolUserIds}`);
        }
        if (schoolUserIds.length > 0) {
          console.log(`Step 11/11: delete local auth entries for users [${schoolUserIds.join(", ")}]`);
          await tx.delete(localAuths).where(import_drizzle_orm8.sql`${localAuths.userId} IN ${schoolUserIds}`);
        }
        console.log("Step 12/12: delete audit events linked directly to school");
        await tx.delete(auditEvents).where((0, import_drizzle_orm8.eq)(auditEvents.schoolId, id));
        console.log(`Deleting remaining teachers, classes, academic years and users for school=${id}`);
        await tx.delete(teachers).where((0, import_drizzle_orm8.eq)(teachers.schoolId, id));
        if (classIds.length > 0) {
          await tx.delete(classes).where(import_drizzle_orm8.sql`${classes.id} IN ${classIds}`);
        }
        if (academicYearIds.length > 0) {
          await tx.delete(academicYears).where(import_drizzle_orm8.sql`${academicYears.id} IN ${academicYearIds}`);
        }
        if (schoolUserIds.length > 0) {
          await tx.delete(users).where(import_drizzle_orm8.sql`${users.id} IN ${schoolUserIds}`);
        }
        console.log("Final cleanup pass: delete any remaining school-linked entities by schoolId");
        await tx.delete(students).where((0, import_drizzle_orm8.eq)(students.schoolId, id));
        await tx.delete(classes).where((0, import_drizzle_orm8.eq)(classes.schoolId, id));
        await tx.delete(teachers).where((0, import_drizzle_orm8.eq)(teachers.schoolId, id));
        await tx.delete(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.schoolId, id));
        await tx.delete(users).where((0, import_drizzle_orm8.eq)(users.schoolId, id));
        await tx.delete(auditEvents).where((0, import_drizzle_orm8.eq)(auditEvents.schoolId, id));
        await tx.delete(schools).where((0, import_drizzle_orm8.eq)(schools.id, id));
      });
      res.json({ message: "School deleted successfully" });
    } catch (err) {
      console.error("Error deleting school:", err);
      const errorMessage = err?.message && (err.message.includes("constraint") || err.message.includes("foreign key")) ? "Impossible de supprimer cette \xE9cole car elle contient des donn\xE9es li\xE9es. Supprimez d\u2019abord les \xE9l\xE9ments associ\xE9s." : err?.message || "Impossible de supprimer l\u2019\xE9cole.";
      res.status(500).json({ error: errorMessage });
    }
  });
  app.get("/api/academic-years", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      let list;
      if (user.role === "super_admin") {
        list = await db.select().from(academicYears);
      } else if (user.role === "school_admin") {
        if (user.academicYearId) {
          list = await db.select().from(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.id, user.academicYearId));
        } else {
          list = [];
        }
      } else {
        list = await db.select().from(academicYears).where(
          (0, import_drizzle_orm8.or)(
            import_drizzle_orm8.sql`${academicYears.schoolId} IS NULL`,
            (0, import_drizzle_orm8.eq)(academicYears.schoolId, user.schoolId)
          )
        );
      }
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch academic years" });
    }
  });
  app.post("/api/academic-years", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const { name, isActive } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin") {
        return res.status(403).json({ error: "Only super admin can create academic years" });
      }
      if (isActive) {
        await db.update(academicYears).set({ isActive: false });
      }
      const result = await db.insert(academicYears).values({
        name,
        schoolId: null,
        isActive: isActive ?? true
      }).returning();
      res.status(201).json(result[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to write academic year" });
    }
  });
  app.put("/api/academic-years/:id/activate", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid academic year id" });
      }
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      if (actor.role !== "super_admin") {
        return res.status(403).json({ error: "Only super admin can set active academic year" });
      }
      const [targetYear] = await db.select().from(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.id, id));
      if (!targetYear) return res.status(404).json({ error: "Academic year not found" });
      await db.update(academicYears).set({ isActive: false });
      await db.update(academicYears).set({ isActive: true }).where((0, import_drizzle_orm8.eq)(academicYears.id, id));
      const [updated] = await db.select().from(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.id, id));
      res.json(updated);
    } catch (err) {
      console.error("Failed to activate academic year:", err);
      res.status(500).json({ error: "Failed to activate academic year" });
    }
  });
  app.delete("/api/academic-years/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid academic year id" });
      }
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      if (actor.role !== "super_admin") {
        return res.status(403).json({ error: "Only super admin can delete academic years" });
      }
      const [targetYear] = await db.select().from(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.id, id));
      if (!targetYear) return res.status(404).json({ error: "Academic year not found" });
      await db.delete(academicYears).where((0, import_drizzle_orm8.eq)(academicYears.id, id));
      res.json({ success: true });
    } catch (err) {
      console.error("Failed to delete academic year:", err);
      if (err?.code === "23503" || err?.cause?.code === "23503") {
        return res.status(409).json({ error: "Impossible de supprimer cette ann\xE9e: elle est utilis\xE9e par des classes, trimestres ou utilisateurs." });
      }
      res.status(500).json({ error: "Failed to delete academic year" });
    }
  });
  app.get("/api/school-terms", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const academicYearId = req.query.academicYearId ? Number(req.query.academicYearId) : void 0;
      const schoolIdParam = req.query.schoolId ? Number(req.query.schoolId) : void 0;
      let rows = [];
      if (actor.role === "super_admin") {
        if (academicYearId != null) {
          rows = await db.select().from(schoolTerms).where((0, import_drizzle_orm8.eq)(schoolTerms.academicYearId, academicYearId));
        } else if (schoolIdParam != null) {
          rows = await db.select().from(schoolTerms).where((0, import_drizzle_orm8.eq)(schoolTerms.schoolId, schoolIdParam));
        } else {
          rows = await db.select().from(schoolTerms);
        }
      } else if (actor.role === "school_admin") {
        const targetSchoolId = actor.schoolId ?? schoolIdParam;
        if (!targetSchoolId) return res.status(403).json({ error: "School context required" });
        if (academicYearId != null) {
          rows = await db.select().from(schoolTerms).where(
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.or)(import_drizzle_orm8.sql`${schoolTerms.schoolId} IS NULL`, (0, import_drizzle_orm8.eq)(schoolTerms.schoolId, targetSchoolId)),
              (0, import_drizzle_orm8.eq)(schoolTerms.academicYearId, academicYearId)
            )
          );
        } else {
          rows = await db.select().from(schoolTerms).where(
            (0, import_drizzle_orm8.or)(import_drizzle_orm8.sql`${schoolTerms.schoolId} IS NULL`, (0, import_drizzle_orm8.eq)(schoolTerms.schoolId, targetSchoolId))
          );
        }
      } else {
        const schoolId = actor.schoolId ?? schoolIdParam;
        if (academicYearId != null) {
          rows = await db.select().from(schoolTerms).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.or)(import_drizzle_orm8.sql`${schoolTerms.schoolId} IS NULL`, (0, import_drizzle_orm8.eq)(schoolTerms.schoolId, schoolId)), (0, import_drizzle_orm8.eq)(schoolTerms.academicYearId, academicYearId)));
        } else {
          rows = await db.select().from(schoolTerms).where((0, import_drizzle_orm8.or)(import_drizzle_orm8.sql`${schoolTerms.schoolId} IS NULL`, (0, import_drizzle_orm8.eq)(schoolTerms.schoolId, schoolId)));
        }
      }
      res.json(rows);
    } catch (err) {
      console.error("Failed to fetch school terms:", err);
      res.status(500).json({ error: "Failed to fetch school terms" });
    }
  });
  app.post("/api/school-terms", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const { academicYearId, name, startDate, endDate, orderIndex, isActive, schoolId: incomingSchoolId } = req.body;
      if (!academicYearId || !name) return res.status(400).json({ error: "academicYearId and name are required" });
      let targetSchoolId = null;
      if (actor.role === "school_admin") {
        targetSchoolId = actor.schoolId ?? null;
      } else if (actor.role === "super_admin") {
        targetSchoolId = incomingSchoolId != null ? Number(incomingSchoolId) : null;
      } else {
        return res.status(403).json({ error: "Forbidden" });
      }
      const vals = {
        academicYearId: Number(academicYearId),
        name: String(name),
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        orderIndex: Number(orderIndex) || 1,
        isActive: isActive != null ? !!isActive : true,
        schoolId: targetSchoolId
      };
      const inserted = await db.insert(schoolTerms).values(vals).returning();
      res.status(201).json(inserted[0]);
    } catch (err) {
      console.error("Failed to create school term:", err);
      if (err?.cause?.code === "23503") {
        return res.status(400).json({ error: "Ann\xE9e acad\xE9mique introuvable. Choisissez une ann\xE9e valide." });
      }
      res.status(500).json({ error: "Failed to create school term" });
    }
  });
  app.put("/api/school-terms/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [existing] = await db.select().from(schoolTerms).where((0, import_drizzle_orm8.eq)(schoolTerms.id, id));
      if (!existing) return res.status(404).json({ error: "Term not found" });
      if (actor.role === "school_admin" && existing.schoolId !== actor.schoolId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { name, startDate, endDate, orderIndex, isActive } = req.body;
      const updates = {};
      if (name != null) updates.name = String(name);
      if (startDate != null) updates.startDate = startDate;
      if (endDate != null) updates.endDate = endDate;
      if (orderIndex != null) updates.orderIndex = Number(orderIndex);
      if (isActive != null) updates.isActive = !!isActive;
      await db.update(schoolTerms).set(updates).where((0, import_drizzle_orm8.eq)(schoolTerms.id, id));
      const [row] = await db.select().from(schoolTerms).where((0, import_drizzle_orm8.eq)(schoolTerms.id, id));
      res.json(row);
    } catch (err) {
      console.error("Failed to update school term:", err);
      res.status(500).json({ error: "Failed to update school term" });
    }
  });
  app.delete("/api/school-terms/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [existing] = await db.select().from(schoolTerms).where((0, import_drizzle_orm8.eq)(schoolTerms.id, id));
      if (!existing) return res.status(404).json({ error: "Term not found" });
      if (actor.role === "school_admin" && existing.schoolId !== actor.schoolId) return res.status(403).json({ error: "Forbidden" });
      await db.delete(schoolTerms).where((0, import_drizzle_orm8.eq)(schoolTerms.id, id));
      res.json({ success: true });
    } catch (err) {
      console.error("Failed to delete school term:", err);
      res.status(500).json({ error: "Failed to delete school term" });
    }
  });
  app.get("/api/classes", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const schoolIdParam = req.query.schoolId ? Number(req.query.schoolId) : void 0;
      const approvedOnly = req.query.approvedOnly === "true" || req.query.approvedOnly === "1";
      const targetSchoolId = actor.role === "school_admin" ? actor.schoolId : actor.role === "teacher" ? actor.schoolId : schoolIdParam;
      const baseSelect = {
        id: classes.id,
        name: classes.name,
        schoolId: classes.schoolId,
        academicYearId: classes.academicYearId,
        yearName: academicYears.name,
        teacherId: classes.teacherId,
        teacherName: users.name
      };
      if (actor.role === "teacher") {
        if (!targetSchoolId) {
          return res.status(403).json({ error: "Teacher school context is required" });
        }
        const localClasses = await db.select(baseSelect).from(classes).leftJoin(teachers, (0, import_drizzle_orm8.eq)(classes.teacherId, teachers.id)).leftJoin(users, (0, import_drizzle_orm8.eq)(teachers.userId, users.id)).leftJoin(academicYears, (0, import_drizzle_orm8.eq)(classes.academicYearId, academicYears.id)).where((0, import_drizzle_orm8.eq)(classes.schoolId, targetSchoolId));
        const approvedGlobalClasses = await db.select(baseSelect).from(classes).innerJoin(
          schoolClasses,
          (0, import_drizzle_orm8.and)(
            (0, import_drizzle_orm8.eq)(classes.id, schoolClasses.classId),
            (0, import_drizzle_orm8.eq)(schoolClasses.schoolId, targetSchoolId),
            (0, import_drizzle_orm8.eq)(schoolClasses.status, "approved")
          )
        ).leftJoin(teachers, (0, import_drizzle_orm8.eq)(classes.teacherId, teachers.id)).leftJoin(users, (0, import_drizzle_orm8.eq)(teachers.userId, users.id)).leftJoin(academicYears, (0, import_drizzle_orm8.eq)(classes.academicYearId, academicYears.id)).where(import_drizzle_orm8.sql`${classes.schoolId} IS NULL`);
        const combined = [...localClasses, ...approvedGlobalClasses];
        const uniqueMap = /* @__PURE__ */ new Map();
        combined.forEach((row) => uniqueMap.set(row.id, row));
        res.json(Array.from(uniqueMap.values()));
        return;
      }
      if (approvedOnly && !targetSchoolId) {
        if (actor.role === "super_admin") {
          const approvedRows = await db.select(baseSelect).from(classes).innerJoin(
            schoolClasses,
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.eq)(classes.id, schoolClasses.classId),
              (0, import_drizzle_orm8.eq)(schoolClasses.status, "approved")
            )
          ).leftJoin(teachers, (0, import_drizzle_orm8.eq)(classes.teacherId, teachers.id)).leftJoin(users, (0, import_drizzle_orm8.eq)(teachers.userId, users.id)).leftJoin(academicYears, (0, import_drizzle_orm8.eq)(classes.academicYearId, academicYears.id));
          res.json(approvedRows);
          return;
        }
        return res.status(403).json({ error: "School context is required" });
      }
      let query = db.select(baseSelect).from(classes).leftJoin(teachers, (0, import_drizzle_orm8.eq)(classes.teacherId, teachers.id)).leftJoin(users, (0, import_drizzle_orm8.eq)(teachers.userId, users.id)).leftJoin(academicYears, (0, import_drizzle_orm8.eq)(classes.academicYearId, academicYears.id));
      if (actor.role !== "super_admin") {
        if (actor.schoolId != null) {
          query = query.where((0, import_drizzle_orm8.or)((0, import_drizzle_orm8.eq)(classes.schoolId, actor.schoolId), import_drizzle_orm8.sql`${classes.schoolId} IS NULL`));
        } else {
          return res.json([]);
        }
      }
      const allClasses = await query;
      try {
        const missingTeacherIds = Array.from(new Set(allClasses.filter((c) => c.teacherId != null && !c.teacherName).map((c) => c.teacherId)));
        if (missingTeacherIds.length > 0) {
          const teacherRows = await db.select({ id: teachers.id, userId: teachers.userId, name: users.name }).from(teachers).leftJoin(users, (0, import_drizzle_orm8.eq)(teachers.userId, users.id)).where((0, import_drizzle_orm8.inArray)(teachers.id, missingTeacherIds));
          const nameByTeacherId = /* @__PURE__ */ new Map();
          for (const tr of teacherRows) {
            if (tr.id != null && tr.name) nameByTeacherId.set(tr.id, tr.name);
          }
          for (const cls of allClasses) {
            if (cls.teacherId != null && !cls.teacherName) {
              const n = nameByTeacherId.get(cls.teacherId);
              if (n) cls.teacherName = n;
            }
          }
        }
      } catch (e) {
        console.warn("Failed to fill missing teacher names", e?.message || e);
      }
      if (targetSchoolId) {
        const statusRows = await db.select().from(schoolClasses).where((0, import_drizzle_orm8.eq)(schoolClasses.schoolId, targetSchoolId));
        const statusMap = new Map(statusRows.map((row) => [row.classId, row.status]));
        let result = allClasses.map((klass) => ({
          ...klass,
          status: statusMap.get(klass.id) ?? (klass.schoolId === targetSchoolId ? "approved" : "pending")
        }));
        result = result.filter((klass) => klass.schoolId === targetSchoolId || klass.schoolId == null && klass.status === "approved");
        if (approvedOnly) {
          result = result.filter((klass) => klass.status === "approved");
        }
        console.log("\u2705 GET /api/classes RESPONSE", result);
        res.json(result);
        return;
      }
      console.log("\u2705 GET /api/classes RESPONSE", allClasses);
      res.json(allClasses);
    } catch (err) {
      res.status(500).json({ error: "Failed to retrieve classes" });
    }
  });
  app.post("/api/classes", requireAuth, async (req, res) => {
    try {
      console.log("POST /api/classes ex\xE9cut\xE9");
      console.log("\u{1F525} RAW BODY RECEIVED =", req.body);
      console.log("BODY FULL =", JSON.stringify(req.body));
      console.log("name raw =", req.body?.name);
      console.log("academicYearId raw =", req.body?.academicYearId);
      console.log("type =", typeof req.body?.academicYearId);
      console.log("schoolId raw =", req.body?.schoolId);
      console.log("schoolId type =", typeof req.body?.schoolId);
      console.log("\u{1F525} FULL KEYS =", Object.keys(req.body || {}));
      console.log("\u{1F525} HIT POST /api/classes - NEW CODE");
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const { name, schoolId: rawSchoolId, academicYearId: rawAcademicYearId, teacherId } = req.body;
      const trimmedName = typeof name === "string" ? name.trim() : "";
      const academicYearId = rawAcademicYearId != null && rawAcademicYearId !== "" ? Number(rawAcademicYearId) : null;
      console.log("academicYearId parsed =", academicYearId, typeof academicYearId);
      if (rawAcademicYearId != null && rawAcademicYearId !== "" && Number.isNaN(academicYearId)) {
        return res.status(400).json({ error: "Invalid academicYearId" });
      }
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      const validation = resolveClassCreationSchoolId({
        actorRole: user.role,
        requestedSchoolId: rawSchoolId,
        actorSchoolId: user.schoolId
      });
      if (validation.error) {
        return res.status(400).json({ error: validation.error });
      }
      const parsedSchoolId = validation.schoolId;
      console.log("\u{1F525} parsedSchoolId =", parsedSchoolId);
      if (user.role !== "super_admin" && user.role !== "school_admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (user.role === "school_admin" && !user.schoolId) {
        return res.status(403).json({ error: "School admin must belong to a school" });
      }
      const resolvedSchoolId = parsedSchoolId;
      if (user.role === "school_admin" && resolvedSchoolId == null) {
        return res.status(400).json({ error: "schoolId is required to create a class" });
      }
      if (!trimmedName || academicYearId == null) {
        return res.status(400).json({ error: `Missing required parameters. Received: name=${trimmedName}, academicYearId=${academicYearId}` });
      }
      console.log("Attempting to create class", { name: trimmedName, academicYearId, teacherId, schoolId: resolvedSchoolId });
      try {
        const duplicateCondition = resolvedSchoolId != null ? (0, import_drizzle_orm8.and)(
          (0, import_drizzle_orm8.eq)(classes.name, trimmedName),
          (0, import_drizzle_orm8.eq)(classes.schoolId, Number(resolvedSchoolId)),
          (0, import_drizzle_orm8.eq)(classes.academicYearId, Number(academicYearId))
        ) : (0, import_drizzle_orm8.and)(
          (0, import_drizzle_orm8.eq)(classes.name, trimmedName),
          import_drizzle_orm8.sql`${classes.schoolId} IS NULL`,
          (0, import_drizzle_orm8.eq)(classes.academicYearId, Number(academicYearId))
        );
        const existing = await db.select().from(classes).where(duplicateCondition);
        if (existing && existing.length > 0) {
          return res.status(400).json({ error: `Classe d\xE9j\xE0 existante: ${trimmedName}` });
        }
      } catch (dupErr) {
        console.error("Error while checking duplicate class:", dupErr);
      }
      try {
        const [newClass] = await db.insert(classes).values({
          name: trimmedName,
          schoolId: resolvedSchoolId != null ? Number(resolvedSchoolId) : null,
          academicYearId: Number(academicYearId),
          teacherId: teacherId ? Number(teacherId) : null
        }).returning();
        console.log("\u2705 CLASS CREATED:", newClass);
        console.log("\u2705 CREATED CLASS ID:", newClass.id);
        console.log("\u2705 CLASS CREATED SUCCESSFULLY");
        res.status(201).json({
          ...newClass,
          schoolId: newClass.schoolId ?? null,
          status: "approved"
        });
      } catch (insertErr) {
        console.error("ERROR OBJECT:", insertErr);
        if (insertErr instanceof Error) {
          console.error("MESSAGE:", insertErr.message);
          console.error("STACK:", insertErr.stack);
        }
        console.dir(insertErr, { depth: null });
        console.error("code:", insertErr?.code);
        console.error("detail:", insertErr?.detail);
        console.error("constraint:", insertErr?.constraint);
        console.error("table:", insertErr?.table);
        console.error("column:", insertErr?.column);
        if (insertErr && insertErr.code === "23505") {
          return res.status(400).json({ error: `Classe d\xE9j\xE0 existante: ${trimmedName}` });
        }
        return res.status(500).json({ error: `Failed to create class: ${insertErr?.message || insertErr}` });
      }
    } catch (error) {
      console.error("POST /api/classes STACK:", error);
      console.error(error instanceof Error ? error.stack : error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
    }
  });
  app.post("/api/schools/:schoolId/classes/:classId/approve", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin" && user.role !== "school_admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const schoolId = Number(req.params.schoolId);
      const classId = Number(req.params.classId);
      if (!schoolId || !classId) return res.status(400).json({ error: "Invalid class or school ID" });
      if (user.role === "school_admin" && user.schoolId !== schoolId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const [classRow] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, classId));
      if (!classRow) {
        return res.status(404).json({ error: "Class not found" });
      }
      if (classRow.schoolId != null && classRow.schoolId !== schoolId) {
        return res.status(409).json({ error: "Class already belongs to another school" });
      }
      if (classRow.schoolId == null) {
        await db.update(classes).set({ schoolId }).where((0, import_drizzle_orm8.eq)(classes.id, classId));
      }
      const existing = await db.select().from(schoolClasses).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolClasses.schoolId, schoolId), (0, import_drizzle_orm8.eq)(schoolClasses.classId, classId)));
      if (existing[0]) {
        const [updated] = await db.update(schoolClasses).set({ status: "approved", updatedAt: /* @__PURE__ */ new Date() }).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolClasses.schoolId, schoolId), (0, import_drizzle_orm8.eq)(schoolClasses.classId, classId))).returning();
        return res.json(updated);
      }
      const [created] = await db.insert(schoolClasses).values({ schoolId, classId, status: "approved" }).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("Error approving class:", err);
      res.status(500).json({ error: "Failed to approve class" });
    }
  });
  app.post("/api/schools/:schoolId/classes/:classId/reject", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin" && user.role !== "school_admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const schoolId = Number(req.params.schoolId);
      const classId = Number(req.params.classId);
      if (!schoolId || !classId) return res.status(400).json({ error: "Invalid class or school ID" });
      if (user.role === "school_admin" && user.schoolId !== schoolId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const existing = await db.select().from(schoolClasses).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolClasses.schoolId, schoolId), (0, import_drizzle_orm8.eq)(schoolClasses.classId, classId)));
      if (existing[0]) {
        const [updated] = await db.update(schoolClasses).set({ status: "rejected", updatedAt: /* @__PURE__ */ new Date() }).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolClasses.schoolId, schoolId), (0, import_drizzle_orm8.eq)(schoolClasses.classId, classId))).returning();
        return res.json(updated);
      }
      const [created] = await db.insert(schoolClasses).values({ schoolId, classId, status: "rejected" }).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("Error rejecting class:", err);
      res.status(500).json({ error: "Failed to reject class" });
    }
  });
  app.delete("/api/classes/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const id = parseInt(req.params.id);
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      const [classToDelete] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, id));
      if (!classToDelete) return res.status(404).json({ error: "Class not found" });
      if (user.role !== "super_admin") {
        if (user.schoolId && classToDelete.schoolId !== user.schoolId) {
          return res.status(403).json({ error: "Cannot delete class in another school" });
        }
      }
      await db.delete(classes).where((0, import_drizzle_orm8.eq)(classes.id, id));
      res.json({ message: "Class deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: "Cannot delete class due to linked data (absence / marks)" });
    }
  });
  app.put("/api/classes/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const id = parseInt(req.params.id);
      const { teacherId } = req.body;
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      const [classToUpdate] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, id));
      if (!classToUpdate) return res.status(404).json({ error: "Class not found" });
      if (user.role !== "super_admin") {
        if (user.role !== "school_admin") {
          return res.status(403).json({ error: "Only super_admin or school_admin can update classes" });
        }
        if (user.schoolId && classToUpdate.schoolId !== user.schoolId) {
          return res.status(403).json({ error: "Cannot update class in another school" });
        }
      }
      if (teacherId != null) {
        const parsedTeacherId = parseInt(String(teacherId), 10);
        if (Number.isNaN(parsedTeacherId)) {
          return res.status(400).json({ error: "Invalid teacherId" });
        }
        const [teacher] = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.id, parsedTeacherId));
        if (!teacher) {
          return res.status(404).json({ error: "Teacher not found" });
        }
        let teacherMatchesSchool = classToUpdate.schoolId != null && teacher.schoolId === classToUpdate.schoolId;
        if (!teacherMatchesSchool && classToUpdate.schoolId != null) {
          const [membership] = await db.select().from(userSchools).where(
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.eq)(userSchools.userId, teacher.userId),
              (0, import_drizzle_orm8.eq)(userSchools.role, "teacher"),
              (0, import_drizzle_orm8.eq)(userSchools.schoolId, classToUpdate.schoolId)
            )
          );
          teacherMatchesSchool = Boolean(membership);
        }
        if (classToUpdate.schoolId != null && !teacherMatchesSchool) {
          return res.status(400).json({ error: "Teacher does not belong to the same school as the class" });
        }
        const [updated] = await db.update(classes).set({ teacherId: parsedTeacherId }).where((0, import_drizzle_orm8.eq)(classes.id, id)).returning();
        return res.json(updated);
      } else {
        const [updated] = await db.update(classes).set({ teacherId: null }).where((0, import_drizzle_orm8.eq)(classes.id, id)).returning();
        return res.json(updated);
      }
    } catch (err) {
      console.error("Error updating class:", err);
      res.status(500).json({ error: "Failed to update class" });
    }
  });
  app.get("/api/teachers", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const filterSchoolId = req.query.schoolId ? parseInt(String(req.query.schoolId), 10) : null;
      if (actor.role !== "super_admin" && filterSchoolId && actor.schoolId && filterSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: "Cannot request teachers for another school" });
      }
      const teacherProjection = {
        id: teachers.id,
        userId: teachers.userId,
        uid: users.uid,
        name: users.name,
        email: users.email,
        gender: users.gender,
        phone: teachers.phone,
        specialization: teachers.specialization,
        schoolId: teachers.schoolId
      };
      const baseOldModel = db.select(teacherProjection).from(teachers).innerJoin(users, (0, import_drizzle_orm8.eq)(teachers.userId, users.id));
      const baseNewModel = db.select({
        ...teacherProjection,
        schoolId: userSchools.schoolId
      }).from(teachers).innerJoin(users, (0, import_drizzle_orm8.eq)(teachers.userId, users.id)).innerJoin(userSchools, (0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(userSchools.userId, users.id), (0, import_drizzle_orm8.eq)(userSchools.role, "teacher")));
      let oldModelQuery = baseOldModel;
      let newModelQuery = baseNewModel;
      if (filterSchoolId) {
        oldModelQuery = oldModelQuery.where((0, import_drizzle_orm8.eq)(teachers.schoolId, filterSchoolId));
        newModelQuery = newModelQuery.where((0, import_drizzle_orm8.eq)(userSchools.schoolId, filterSchoolId));
      }
      if (actor.role !== "super_admin") {
        if (!actor.schoolId) {
          return res.json([]);
        }
        oldModelQuery = oldModelQuery.where((0, import_drizzle_orm8.eq)(teachers.schoolId, actor.schoolId));
        newModelQuery = newModelQuery.where((0, import_drizzle_orm8.eq)(userSchools.schoolId, actor.schoolId));
      }
      const [oldTeachers, newTeachers] = await Promise.all([
        oldModelQuery,
        newModelQuery
      ]);
      const teacherById = /* @__PURE__ */ new Map();
      for (const teacher of oldTeachers) {
        teacherById.set(teacher.id, {
          ...teacher,
          schoolIds: teacher.schoolId != null ? [teacher.schoolId] : []
        });
      }
      for (const teacher of newTeachers) {
        const existing = teacherById.get(teacher.id);
        if (existing) {
          const mergedSchoolIds = Array.from(new Set([...existing.schoolIds || [], teacher.schoolId].filter((id) => id != null)));
          teacherById.set(teacher.id, {
            ...existing,
            ...teacher,
            schoolId: existing.schoolId ?? teacher.schoolId,
            schoolIds: mergedSchoolIds
          });
        } else {
          teacherById.set(teacher.id, {
            ...teacher,
            schoolIds: teacher.schoolId != null ? [teacher.schoolId] : []
          });
        }
      }
      const teachersList = Array.from(teacherById.values());
      const teacherIds = teachersList.map((teacher) => teacher.id).filter(Boolean);
      let assignments = [];
      if (teacherIds.length > 0) {
        assignments = await db.select({ teacherId: classTeachers.teacherId, classId: classTeachers.classId }).from(classTeachers).where((0, import_drizzle_orm8.inArray)(classTeachers.teacherId, teacherIds));
      }
      console.log("GET /api/teachers - assignments count:", assignments.length);
      const assignmentMap = /* @__PURE__ */ new Map();
      assignments.forEach((item) => {
        const existing = assignmentMap.get(item.teacherId) || [];
        existing.push(item.classId);
        assignmentMap.set(item.teacherId, existing);
      });
      const list = teachersList.map((teacher) => ({
        ...teacher,
        teacherId: teacher.id,
        classIds: assignmentMap.get(teacher.id) || []
      }));
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: "Failed to retrieve teachers list" });
    }
  });
  app.post("/api/teachers", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const { name, email, phone, specialization, schoolId, classIds, gender } = req.body;
      const requestedClassIds = Array.isArray(classIds) ? classIds : [];
      const normalizedEmail = normalizeEmail(email);
      if (!name || !normalizedEmail || !schoolId) return res.status(400).json({ error: `Missing compulsory details. Received name=${name}, email=${email}, schoolId=${schoolId}` });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      const parsedSchoolId = parseInt(String(schoolId), 10);
      if (user.role !== "super_admin") {
        if (user.schoolId && parsedSchoolId !== user.schoolId) {
          return res.status(403).json({ error: "Cannot create teacher in another school" });
        }
      }
      const existingTeacherEmail = await findExistingUsersByEmailAndSchool(normalizedEmail, parsedSchoolId);
      if (existingTeacherEmail.length > 0) {
        return res.status(409).json({ error: "User with same email already exists in this school" });
      }
      const fakeUid = `sim_teacher_${Date.now()}`;
      const userResult = await db.insert(users).values({
        uid: fakeUid,
        email: normalizedEmail,
        name,
        role: "teacher",
        schoolId: parsedSchoolId,
        gender: gender ?? null
      }).returning();
      const createdUser = userResult[0];
      const teacherResult = await db.insert(teachers).values({
        userId: createdUser.id,
        schoolId: parseInt(schoolId),
        phone,
        specialization: normalizeSpecialization(specialization) || null
      }).returning();
      const createdTeacher = teacherResult[0];
      if (parsedSchoolId != null) {
        try {
          await db.insert(userSchools).values({
            userId: createdUser.id,
            schoolId: parsedSchoolId,
            role: "teacher",
            isActive: true
          });
        } catch (e) {
          console.warn("Failed to insert user_schools for public teacher create", e?.message || e);
        }
      }
      try {
        await logIfTeacherUserMismatch(createdUser.id, createdTeacher?.id);
      } catch (e) {
      }
      if (requestedClassIds.length > 0) {
        const parsedSchoolId2 = parseInt(schoolId, 10);
        console.log("Assigning classes to teacher (public create):", { teacherId: createdTeacher?.id, classIds: requestedClassIds });
        for (const rawId of requestedClassIds) {
          const cid = Number(rawId);
          if (Number.isNaN(cid)) {
            console.log("DIAG public create skip invalid id", { rawId, teacherId: createdTeacher?.id });
            continue;
          }
          const [cls] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, cid));
          const [schoolClassRow] = parsedSchoolId2 != null ? await db.select().from(schoolClasses).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolClasses.classId, cid), (0, import_drizzle_orm8.eq)(schoolClasses.schoolId, parsedSchoolId2))) : [null];
          const approved = await isApprovedClassForSchool(cid, parsedSchoolId2);
          if (!cls) {
            console.log("DIAG public create - ignored", { cid, teacherId: createdTeacher?.id, parsedSchoolId: parsedSchoolId2, reason: "class_not_found", cls: null, schoolClassRow, approved });
            continue;
          }
          if (cls.schoolId != null && cls.schoolId !== parsedSchoolId2) {
            console.log("DIAG public create - ignored", { cid, teacherId: createdTeacher?.id, parsedSchoolId: parsedSchoolId2, reason: "class_school_mismatch", cls, schoolClassRow, approved });
            continue;
          }
          if (!approved) {
            console.log("DIAG public create - ignored", { cid, teacherId: createdTeacher?.id, parsedSchoolId: parsedSchoolId2, reason: "not_approved_for_school", cls, schoolClassRow, approved });
            continue;
          }
          try {
            const existingAssignment = await db.select().from(classTeachers).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(classTeachers.classId, cid), (0, import_drizzle_orm8.eq)(classTeachers.teacherId, createdTeacher.id)));
            if (existingAssignment.length === 0) {
              await db.insert(classTeachers).values({ classId: cid, teacherId: createdTeacher.id });
              const insertedRows = await db.select().from(classTeachers).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(classTeachers.classId, cid), (0, import_drizzle_orm8.eq)(classTeachers.teacherId, createdTeacher.id)));
              console.log("DIAG public create - inserted", { cid, teacherId: createdTeacher.id, insertedCount: insertedRows.length, cls, schoolClassRow, approved, parsedSchoolId: parsedSchoolId2 });
            } else {
              console.log("DIAG public create - ignored", { cid, teacherId: createdTeacher.id, reason: "already_assigned", existingCount: existingAssignment.length, cls, schoolClassRow, approved, parsedSchoolId: parsedSchoolId2 });
            }
          } catch (e) {
            console.error("Failed to assign teacher to class", cid, e?.message || e);
          }
        }
      }
      let classIdsForResponse = [];
      if (createdTeacher?.id) {
        const assignments = await db.select({ classId: classTeachers.classId }).from(classTeachers).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, createdTeacher.id));
        classIdsForResponse = assignments.map((a) => a.classId);
      }
      res.status(201).json({
        ...createdUser,
        teacherId: createdTeacher.id,
        phone,
        specialization: normalizeSpecialization(specialization) || null,
        classIds: classIdsForResponse
      });
    } catch (err) {
      console.error("Error creating teacher profile:", err);
      res.status(500).json({ error: `Failed to register teacher profile: ${err.message}` });
    }
  });
  app.get("/api/parents", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      if (actor.role === "teacher") return res.status(403).json({ error: "Forbidden" });
      const filterSchoolId = req.query.schoolId ? parseInt(String(req.query.schoolId)) : null;
      const filterClassId = req.query.classId ? parseInt(String(req.query.classId)) : null;
      if (actor.role !== "super_admin" && filterSchoolId && actor.schoolId && filterSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: "Cannot request parents for another school" });
      }
      const parentProjection = {
        id: parents.id,
        userId: parents.userId,
        name: users.name,
        email: users.email,
        gender: users.gender,
        phone: parents.phone,
        address: parents.address,
        studentId: parents.studentId,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        studentClassId: students.classId,
        studentSchoolId: students.schoolId,
        schoolId: parents.schoolId,
        className: classes.name,
        schoolName: schools.name
      };
      const baseOldModel = db.select(parentProjection).from(parents).innerJoin(users, (0, import_drizzle_orm8.eq)(parents.userId, users.id)).leftJoin(students, (0, import_drizzle_orm8.eq)(students.parentId, parents.id)).leftJoin(classes, (0, import_drizzle_orm8.eq)(students.classId, classes.id)).leftJoin(schools, (0, import_drizzle_orm8.eq)(parents.schoolId, schools.id));
      const baseNewModel = db.select({
        ...parentProjection,
        schoolId: userSchools.schoolId
      }).from(parents).innerJoin(users, (0, import_drizzle_orm8.eq)(parents.userId, users.id)).innerJoin(userSchools, (0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(userSchools.userId, users.id), (0, import_drizzle_orm8.eq)(userSchools.role, "parent"))).leftJoin(students, (0, import_drizzle_orm8.eq)(students.parentId, parents.id)).leftJoin(classes, (0, import_drizzle_orm8.eq)(students.classId, classes.id)).leftJoin(schools, (0, import_drizzle_orm8.eq)(userSchools.schoolId, schools.id));
      let oldModelQuery = baseOldModel;
      let newModelQuery = baseNewModel;
      if (filterSchoolId) {
        oldModelQuery = oldModelQuery.where((0, import_drizzle_orm8.eq)(parents.schoolId, filterSchoolId));
        newModelQuery = newModelQuery.where((0, import_drizzle_orm8.eq)(userSchools.schoolId, filterSchoolId));
      }
      if (filterClassId) {
        oldModelQuery = oldModelQuery.where((0, import_drizzle_orm8.eq)(students.classId, filterClassId));
        newModelQuery = newModelQuery.where((0, import_drizzle_orm8.eq)(students.classId, filterClassId));
      }
      if (actor.role !== "super_admin") {
        if (!actor.schoolId) {
          return res.json([]);
        }
        oldModelQuery = oldModelQuery.where((0, import_drizzle_orm8.eq)(parents.schoolId, actor.schoolId));
        newModelQuery = newModelQuery.where((0, import_drizzle_orm8.eq)(userSchools.schoolId, actor.schoolId));
      }
      const [oldParents, newParents] = await Promise.all([
        oldModelQuery,
        newModelQuery
      ]);
      const parentById = /* @__PURE__ */ new Map();
      for (const parent of oldParents) {
        parentById.set(parent.id, {
          ...parent,
          schoolIds: parent.schoolId != null ? [parent.schoolId] : []
        });
      }
      for (const parent of newParents) {
        const existing = parentById.get(parent.id);
        if (existing) {
          const mergedSchoolIds = Array.from(
            new Set([...existing.schoolIds || [], parent.schoolId].filter((id) => id != null))
          );
          parentById.set(parent.id, {
            ...existing,
            ...parent,
            schoolId: existing.schoolId ?? parent.schoolId,
            schoolIds: mergedSchoolIds
          });
        } else {
          parentById.set(parent.id, {
            ...parent,
            schoolIds: parent.schoolId != null ? [parent.schoolId] : []
          });
        }
      }
      const list = Array.from(parentById.values());
      console.debug("[api/parents] returning parents count:", list.length, "requestedClassId=", filterClassId, "requestedSchoolId=", filterSchoolId);
      res.json(list);
    } catch (err) {
      console.error("Error fetching parents:", err);
      res.status(500).json({ error: `Failed to fetch parents list: ${err.message}` });
    }
  });
  app.post("/api/parents", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      console.debug("[api/parents POST] body received:", req.body);
      const { name, email, phone, address, schoolId, studentId, gender } = req.body;
      const normalizedEmail = normalizeEmail(email);
      if (!name || !normalizedEmail) return res.status(400).json({ error: "Name and Email are required" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const parsedStudentId = studentId != null && studentId !== "" ? parseInt(String(studentId), 10) : void 0;
      let resolvedSchoolId = schoolId != null && schoolId !== "" ? parseInt(String(schoolId), 10) : null;
      if (Number.isNaN(resolvedSchoolId)) resolvedSchoolId = null;
      if (parsedStudentId) {
        const [studentRow] = await db.select({ parentId: students.parentId, schoolId: students.schoolId }).from(students).where((0, import_drizzle_orm8.eq)(students.id, parsedStudentId));
        if (!studentRow) {
          return res.status(400).json({ error: "Student not found for provided studentId" });
        }
        if (studentRow.parentId != null) {
          return res.status(400).json({ error: "Student is already linked to another parent" });
        }
        if (resolvedSchoolId == null && studentRow.schoolId != null) {
          resolvedSchoolId = studentRow.schoolId;
        }
      }
      const effectiveSchoolId = resolvedSchoolId ?? (actor.role !== "super_admin" ? actor.schoolId : null);
      if (actor.role !== "super_admin" && effectiveSchoolId != null && actor.schoolId != null && effectiveSchoolId !== actor.schoolId) {
        return res.status(403).json({ error: "Cannot create parent in another school" });
      }
      const existingParentEmail = await findExistingUsersByEmailAndSchool(normalizedEmail, effectiveSchoolId);
      if (existingParentEmail.length > 0) {
        return res.status(409).json({ error: "User with same email already exists in this school" });
      }
      const fakeUid = `sim_parent_${Date.now()}`;
      const userResult = await db.insert(users).values({
        uid: fakeUid,
        email: normalizedEmail,
        name,
        role: "parent",
        schoolId: effectiveSchoolId,
        gender: gender ?? null
      }).returning();
      const createdUser = userResult[0];
      const parentResult = await db.insert(parents).values({
        userId: createdUser.id,
        phone,
        address,
        studentId: parsedStudentId ?? null,
        schoolId: effectiveSchoolId ?? null
      }).returning();
      const createdParent = parentResult[0];
      if (parsedStudentId) {
        await db.update(students).set({ parentId: createdParent.id }).where((0, import_drizzle_orm8.eq)(students.id, parsedStudentId));
      }
      if (effectiveSchoolId != null) {
        await db.insert(userSchools).values({
          userId: createdUser.id,
          schoolId: effectiveSchoolId,
          role: "parent",
          isActive: true
        });
      }
      console.debug("[api/parents POST] parent inserted:", createdParent);
      res.status(201).json({
        ...createdUser,
        parentId: createdParent.id,
        phone,
        address,
        studentId: createdParent.studentId,
        schoolId: createdParent.schoolId ?? null
      });
    } catch (err) {
      console.error("Error recording parent info:", err);
      res.status(500).json({ error: `Failed to record parent info: ${err.message}` });
    }
  });
  app.get("/api/parents/template", async (req, res) => {
    try {
      const XLSX = await import("xlsx");
      const headers = ["name", "email", "phone", "address", "schoolId", "studentIds", "studentNames"];
      const worksheet = XLSX.utils.aoa_to_sheet([headers]);
      worksheet["!cols"] = headers.map((_, index) => ({ wch: index === 0 ? 24 : 18 }));
      worksheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
      const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "2563EB" }, type: "pattern", patternType: "solid" },
        border: {
          top: { style: "thin", color: { rgb: "D1D5DB" } },
          bottom: { style: "thin", color: { rgb: "D1D5DB" } },
          left: { style: "thin", color: { rgb: "D1D5DB" } },
          right: { style: "thin", color: { rgb: "D1D5DB" } }
        }
      };
      headers.forEach((_, index) => {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: index });
        worksheet[cellRef] = { ...worksheet[cellRef], s: headerStyle };
      });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "parents");
      const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="parents_template.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (err) {
      console.error("Error generating parents template:", err);
      res.status(500).json({ error: "Failed to generate template" });
    }
  });
  app.get("/api/parents/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid parent id" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: "Unauthenticated" });
      const rows = await db.select({
        id: parents.id,
        userId: parents.userId,
        name: users.name,
        email: users.email,
        phone: parents.phone,
        address: parents.address,
        studentId: parents.studentId,
        studentClassId: students.classId,
        studentSchoolId: students.schoolId,
        schoolId: parents.schoolId,
        className: classes.name,
        schoolName: schools.name
      }).from(parents).leftJoin(users, (0, import_drizzle_orm8.eq)(parents.userId, users.id)).leftJoin(students, (0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(students.parentId, parents.id), (0, import_drizzle_orm8.eq)(students.schoolId, parents.schoolId))).leftJoin(classes, (0, import_drizzle_orm8.eq)(students.classId, classes.id)).leftJoin(schools, (0, import_drizzle_orm8.eq)(parents.schoolId, schools.id)).where((0, import_drizzle_orm8.eq)(parents.id, id));
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Parent not found" });
      res.json(rows[0]);
    } catch (err) {
      console.error("Failed to fetch parent by id:", err);
      res.status(500).json({ error: "Failed to fetch parent" });
    }
  });
  app.post("/api/parents/batch", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: "Unauthenticated" });
      if (!["super_admin", "school_admin"].includes(actor.role)) return res.status(403).json({ error: "Forbidden" });
      const rows = Array.isArray(req.body) ? req.body : req.body.rows;
      if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: "Invalid payload: expected array of rows" });
      const errors = [];
      const inserted = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        const name = (r.name || r.fullName || "").trim();
        const normalizedEmail = normalizeEmail(r.email || "");
        const phone = (r.phone || "").trim();
        const address = (r.address || "").trim();
        const schoolId = r.schoolId ? parseInt(r.schoolId) : actor.role === "school_admin" ? actor.schoolId : null;
        if (!name || !normalizedEmail) {
          errors.push({ row: i, email: normalizedEmail || void 0, error: "name and email are required" });
          continue;
        }
        const existing = await findExistingUsersByEmailAndSchool(normalizedEmail, schoolId);
        if (existing && existing.length > 0) {
          errors.push({ row: i, email: normalizedEmail, error: "duplicate email in this school" });
          continue;
        }
        const fakeUid = `sim_parent_${Date.now()}_${i}`;
        const userRes = await db.insert(users).values({ uid: fakeUid, email: normalizedEmail, name, role: "parent", schoolId }).returning();
        const createdUser = userRes[0];
        let linkedStudentId = null;
        if (r.studentIds) {
          const ids = String(r.studentIds).split(/[,;]+/).map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
          for (const sid of ids) {
            const [srow] = await db.select().from(students).where((0, import_drizzle_orm8.eq)(students.id, sid));
            if (srow) {
              linkedStudentId = srow.id;
              break;
            }
          }
          if (ids.length > 0 && !linkedStudentId) {
            errors.push({ row: i, email: normalizedEmail, error: `studentIds provided but no matching student found (${String(r.studentIds)})` });
          }
        } else if (r.studentNames) {
          const names = String(r.studentNames).split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
          for (const nm of names) {
            const parts = nm.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
              const first = parts[0];
              const last = parts.slice(1).join(" ");
              const [srow] = await db.select().from(students).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${students.firstName})`, first.toLowerCase()), (0, import_drizzle_orm8.eq)(import_drizzle_orm8.sql`LOWER(${students.lastName})`, last.toLowerCase())));
              if (srow) {
                linkedStudentId = srow.id;
                break;
              }
            }
          }
          if (names.length > 0 && !linkedStudentId) {
            errors.push({ row: i, email: normalizedEmail, error: `studentNames provided but no matching student found (${String(r.studentNames)})` });
          }
        }
        const parentRes = await db.insert(parents).values({ userId: createdUser.id, phone: phone || null, address: address || null, studentId: linkedStudentId, schoolId: schoolId || null }).returning();
        try {
          if (schoolId != null) {
            await db.insert(userSchools).values({
              userId: createdUser.id,
              schoolId,
              role: "parent",
              isActive: true
            });
          }
        } catch (e) {
          console.warn("Failed to insert user_schools for imported parent", e?.message || e);
        }
        inserted.push({ user: createdUser, parentId: parentRes[0].id });
      }
      await logAuditEvent(actor, "import", "parents_batch", null, actor.schoolId ?? null, `Imported ${inserted.length} parents, ${errors.length} errors`);
      res.json({ insertedCount: inserted.length, errors, inserted });
    } catch (err) {
      console.error("Error importing parents batch:", err);
      res.status(500).json({ error: err?.message || "Failed to import parents" });
    }
  });
  app.get("/api/students", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      let query = db.select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        birthDate: students.birthDate,
        schoolId: students.schoolId,
        classId: students.classId,
        className: classes.name,
        yearId: academicYears.id,
        yearName: academicYears.name,
        parentId: students.parentId,
        parentName: users.name,
        schoolAdminId: students.schoolAdminId,
        enrolledAt: students.enrolledAt
      }).from(students).innerJoin(classes, (0, import_drizzle_orm8.eq)(students.classId, classes.id)).leftJoin(academicYears, (0, import_drizzle_orm8.eq)(classes.academicYearId, academicYears.id)).leftJoin(parents, (0, import_drizzle_orm8.eq)(students.parentId, parents.id)).leftJoin(users, (0, import_drizzle_orm8.eq)(parents.userId, users.id));
      if (actor.role === "teacher") {
        const currentSchoolId = actor.schoolId ?? null;
        const teacherRows = await db.select({ id: teachers.id }).from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, actor.id));
        if (teacherRows.length === 0) {
          return res.json([]);
        }
        const teacherId = teacherRows[0].id;
        const assignmentRows = await db.select({ classId: classTeachers.classId, schoolId: classes.schoolId }).from(classTeachers).innerJoin(classes, (0, import_drizzle_orm8.eq)(classTeachers.classId, classes.id)).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherId));
        const teacherClassIds = getTeacherClassIdSet(assignmentRows, currentSchoolId);
        if (teacherClassIds.length === 0) {
          return res.json([]);
        }
        query = query.where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.inArray)(students.classId, teacherClassIds), currentSchoolId != null ? (0, import_drizzle_orm8.eq)(students.schoolId, currentSchoolId) : void 0));
      } else if (actor.role === "school_admin") {
        if (actor.schoolId) {
          query = query.where((0, import_drizzle_orm8.eq)(students.schoolId, actor.schoolId));
        } else {
          return res.json([]);
        }
      } else if (actor.role !== "super_admin") {
        if (actor.role === "parent") {
          const childStudentIds = await getParentChildStudentIds(actor.id);
          if (childStudentIds.length === 0) {
            return res.json([]);
          }
          query = query.where((0, import_drizzle_orm8.inArray)(students.id, childStudentIds));
        } else if (actor.schoolId) {
          query = query.where((0, import_drizzle_orm8.eq)(students.schoolId, actor.schoolId));
        } else {
          return res.json([]);
        }
      }
      const list = await query;
      res.json(list);
    } catch (err) {
      console.error("Error fetching students:", err);
      res.status(500).json({ error: `Failed to retrieve students: ${err.message}` });
    }
  });
  app.post("/api/students", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const { firstName, lastName, birthDate, schoolId, classId, parentId, schoolAdminId, gender, enrolledAt } = req.body;
      const parsedSchoolId = schoolId !== void 0 && schoolId !== null && String(schoolId).trim() !== "" ? parseInt(String(schoolId)) : null;
      const parsedClassId = classId !== void 0 && classId !== null && String(classId).trim() !== "" ? parseInt(String(classId)) : null;
      const parsedParentId = parentId !== void 0 && parentId !== null && String(parentId).trim() !== "" ? parseInt(String(parentId)) : null;
      const parsedSchoolAdminId = schoolAdminId !== void 0 && schoolAdminId !== null && String(schoolAdminId).trim() !== "" ? parseInt(String(schoolAdminId)) : null;
      const parsedEnrolledAt = enrolledAt ? new Date(enrolledAt) : /* @__PURE__ */ new Date();
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      const effectiveSchoolId = actor.role === "school_admin" ? actor.schoolId : parsedSchoolId;
      if (!firstName || !lastName || !effectiveSchoolId || !parsedClassId) {
        return res.status(400).json({ error: `Missing compulsory student parameters. Received firstName=${firstName}, lastName=${lastName}, schoolId=${schoolId}, classId=${classId}` });
      }
      if (actor.role !== "super_admin") {
        if (!actor.schoolId || effectiveSchoolId !== actor.schoolId) {
          return res.status(403).json({ error: "Cannot create student in another school" });
        }
      }
      const resolvedSchoolAdminId = await (async () => {
        if (actor.role === "school_admin") {
          return actor.id;
        }
        const explicitAdminId = schoolAdminId ? parseInt(schoolAdminId) : void 0;
        const targetSchoolId = parseInt(schoolId);
        if (explicitAdminId) {
          const [assignedAdmin] = await db.select().from(users).where(
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.eq)(users.id, explicitAdminId),
              (0, import_drizzle_orm8.eq)(users.role, "school_admin"),
              (0, import_drizzle_orm8.eq)(users.schoolId, targetSchoolId)
            )
          );
          if (!assignedAdmin) {
            throw new Error("Invalid schoolAdminId: the selected admin is not a school admin for this school.");
          }
          return assignedAdmin.id;
        }
        const admins = await db.select({ id: users.id }).from(users).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(users.role, "school_admin"), (0, import_drizzle_orm8.eq)(users.schoolId, targetSchoolId)));
        if (admins.length === 1) {
          return admins[0].id;
        }
        if (admins.length === 0) {
          throw new Error("Chaque \xE9l\xE8ve doit \xEAtre li\xE9 \xE0 un admin \xE9cole. Aucune admin \xE9cole n\u2019est trouv\xE9 pour cette \xE9cole.");
        }
        throw new Error("Plusieurs admins \xE9cole existent pour cette \xE9cole. Veuillez s\xE9lectionner explicitement un compte Admin \xC9cole.");
      })();
      const result = await db.insert(students).values({
        firstName,
        lastName,
        birthDate,
        gender: gender ?? null,
        schoolId: effectiveSchoolId,
        classId: parsedClassId,
        parentId: parsedParentId,
        schoolAdminId: resolvedSchoolAdminId,
        enrolledAt: parsedEnrolledAt
      }).returning();
      res.status(201).json(result[0]);
    } catch (err) {
      console.error("Error creating student profile:", err);
      res.status(500).json({ error: `Failed to record student profile: ${err.message}` });
    }
  });
  app.put("/api/students/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const studentId = parseInt(req.params.id);
      const { firstName, lastName, birthDate, schoolId, classId, parentId, academicYearId, teacherId, schoolAdminId, gender } = req.body;
      if (!firstName || !lastName || !classId || !parentId) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!["super_admin", "school_admin"].includes(user.role)) {
        return res.status(403).json({ error: "Only super_admin or school_admin can update students" });
      }
      const [existingStudent] = await db.select().from(students).where((0, import_drizzle_orm8.eq)(students.id, studentId));
      if (!existingStudent) return res.status(404).json({ error: "Student not found" });
      if (user.role === "school_admin" && user.schoolId != null && existingStudent.schoolId != null && user.schoolId !== existingStudent.schoolId) {
        return res.status(403).json({ error: "You can only update students from your school" });
      }
      const newSchoolId = schoolId !== void 0 && schoolId !== null && String(schoolId) !== "" ? parseInt(String(schoolId)) : existingStudent.schoolId;
      const newClassId = parseInt(String(classId));
      const newParentId = parseInt(String(parentId));
      const newSchoolAdminId = schoolAdminId !== void 0 && schoolAdminId !== null && String(schoolAdminId) !== "" ? parseInt(String(schoolAdminId)) : existingStudent.schoolAdminId ?? null;
      const newGender = gender !== void 0 && gender !== null && String(gender).trim() !== "" ? String(gender) : existingStudent.gender;
      const changes = [];
      if (existingStudent.firstName !== firstName) changes.push(`firstName: "${existingStudent.firstName}" \u2192 "${firstName}"`);
      if (existingStudent.lastName !== lastName) changes.push(`lastName: "${existingStudent.lastName}" \u2192 "${lastName}"`);
      if (existingStudent.birthDate !== birthDate) changes.push(`birthDate: "${existingStudent.birthDate}" \u2192 "${birthDate}"`);
      if (existingStudent.gender !== newGender) changes.push(`gender: "${existingStudent.gender ?? ""}" \u2192 "${newGender ?? ""}"`);
      if (existingStudent.schoolId !== newSchoolId) changes.push(`schoolId: ${existingStudent.schoolId} \u2192 ${newSchoolId}`);
      if (existingStudent.classId !== newClassId) changes.push(`classId: ${existingStudent.classId} \u2192 ${newClassId}`);
      if (existingStudent.parentId !== newParentId) changes.push(`parentId: ${existingStudent.parentId} \u2192 ${newParentId}`);
      if ((existingStudent.schoolAdminId ?? null) !== newSchoolAdminId) changes.push(`schoolAdminId: ${existingStudent.schoolAdminId ?? "null"} \u2192 ${newSchoolAdminId}`);
      if (changes.length === 0) {
        return res.status(200).json(existingStudent);
      }
      const result = await db.update(students).set({ firstName, lastName, birthDate, gender: newGender, schoolId: newSchoolId, classId: newClassId, parentId: newParentId, schoolAdminId: newSchoolAdminId }).where((0, import_drizzle_orm8.eq)(students.id, studentId)).returning();
      await logAuditEvent(
        user,
        "UPDATE",
        "student",
        studentId,
        existingStudent.schoolId ?? null,
        `Student updated: ${changes.join("; ")}`
      );
      res.status(200).json(result[0]);
    } catch (err) {
      console.error("Error updating student:", err);
      res.status(500).json({ error: `Failed to update student: ${err.message}` });
    }
  });
  app.get("/api/absences", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      let query = db.select({
        id: absences.id,
        studentId: absences.studentId,
        studentName: import_drizzle_orm8.sql`concat(${students.firstName}, ' ', ${students.lastName})`,
        classId: absences.classId,
        className: classes.name,
        date: absences.date,
        period: absences.period,
        isJustified: absences.isJustified,
        justificationReason: absences.justificationReason,
        parentId: students.parentId,
        parentUserId: parents.userId,
        schoolId: students.schoolId
      }).from(absences).innerJoin(students, (0, import_drizzle_orm8.eq)(absences.studentId, students.id)).innerJoin(classes, (0, import_drizzle_orm8.eq)(absences.classId, classes.id)).innerJoin(parents, (0, import_drizzle_orm8.eq)(students.parentId, parents.id));
      if (actor.role !== "super_admin") {
        if (actor.role === "parent") {
          const childStudentIds = await getParentChildStudentIds(actor.id);
          if (childStudentIds.length === 0) {
            return res.json([]);
          }
          query = query.where((0, import_drizzle_orm8.inArray)(absences.studentId, childStudentIds));
        } else {
          if (actor.schoolId) {
            query = query.where((0, import_drizzle_orm8.eq)(students.schoolId, actor.schoolId));
          } else {
            return res.json([]);
          }
        }
      }
      const list = await query;
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: "Failed to load absences" });
    }
  });
  app.post("/api/absences", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const { studentId, classId, date, period, isJustified, justificationReason } = req.body;
      if (!studentId || !classId || !date || !period) {
        return res.status(400).json({ error: "Missing mandatory absence parameters" });
      }
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      const [student] = await db.select().from(students).where((0, import_drizzle_orm8.eq)(students.id, parseInt(studentId)));
      if (!student) return res.status(404).json({ error: "Student not found" });
      const [classRecord] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, parseInt(classId)));
      if (!classRecord) return res.status(404).json({ error: "Class not found" });
      if (user.role !== "super_admin") {
        if (user.schoolId && (student.schoolId !== user.schoolId || classRecord.schoolId !== user.schoolId)) {
          return res.status(403).json({ error: "Cannot record absence for student in another school" });
        }
      }
      const result = await db.insert(absences).values({
        studentId: parseInt(studentId),
        classId: parseInt(classId),
        date,
        period,
        isJustified: isJustified || false,
        justificationReason
      }).returning();
      const [parentRecord] = await db.select().from(parents).where((0, import_drizzle_orm8.eq)(parents.id, student.parentId));
      if (parentRecord) {
        await db.insert(notifications).values({
          userId: parentRecord.userId,
          title: `Nouvelle absence pour ${student.firstName}`,
          body: `Une absence a \xE9t\xE9 signal\xE9e pour ${student.firstName} le ${date} (P\xE9riode: ${period}). Veuillez fournir un justificatif.`,
          type: "absence"
        });
      }
      res.status(201).json(result[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to record absence" });
    }
  });
  app.put("/api/absences/:id/justify", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const id = parseInt(req.params.id);
      const { justificationReason } = req.body;
      if (!justificationReason) {
        return res.status(400).json({ error: "Please specify a reasons for justification" });
      }
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      const [absence] = await db.select().from(absences).innerJoin(students, (0, import_drizzle_orm8.eq)(absences.studentId, students.id)).where((0, import_drizzle_orm8.eq)(absences.id, id));
      if (!absence) return res.status(404).json({ error: "Absence not found" });
      if (user.role !== "super_admin") {
        if (user.schoolId && absence.students.schoolId !== user.schoolId) {
          return res.status(403).json({ error: "Cannot justify absence in another school" });
        }
      }
      const updated = await db.update(absences).set({
        isJustified: true,
        justificationReason
      }).where((0, import_drizzle_orm8.eq)(absences.id, id)).returning();
      res.json(updated[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to validate absence justification" });
    }
  });
  app.get("/api/subjects", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: "User not found" });
      const schoolIdParam = req.query.schoolId ? Number(req.query.schoolId) : void 0;
      const approvedOnly = req.query.approvedOnly === "true" || req.query.approvedOnly === "1";
      const targetSchoolId = user.role === "school_admin" ? user.schoolId : user.role === "teacher" ? user.schoolId : schoolIdParam;
      if (user.role === "teacher") {
        if (!targetSchoolId) {
          return res.status(403).json({ error: "Teacher school context is required" });
        }
        const schoolRows = await db.select({
          id: subjects.id,
          schoolId: subjects.schoolId,
          name: subjects.name,
          code: subjects.code,
          status: import_drizzle_orm8.sql`COALESCE(${schoolSubjects.status}, 'approved')`,
          createdAt: subjects.createdAt,
          updatedAt: subjects.updatedAt
        }).from(subjects).leftJoin(
          schoolSubjects,
          (0, import_drizzle_orm8.and)(
            (0, import_drizzle_orm8.eq)(subjects.id, schoolSubjects.subjectId),
            (0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, targetSchoolId)
          )
        ).where(
          (0, import_drizzle_orm8.or)(
            (0, import_drizzle_orm8.eq)(subjects.schoolId, targetSchoolId),
            (0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, targetSchoolId)
          )
        );
        let result = schoolRows.map((subject) => ({
          ...subject,
          schoolId: subject.schoolId ?? null
        }));
        if (approvedOnly) {
          result = result.filter((subject) => subject.status === "approved");
        }
        res.json(result);
        return;
      }
      if (user.role === "school_admin") {
        if (!targetSchoolId) {
          return res.status(403).json({ error: "School context is required" });
        }
        const schoolRows = await db.select({
          id: subjects.id,
          schoolId: subjects.schoolId,
          name: subjects.name,
          code: subjects.code,
          status: import_drizzle_orm8.sql`COALESCE(${schoolSubjects.status}, 'approved')`,
          createdAt: subjects.createdAt,
          updatedAt: subjects.updatedAt
        }).from(subjects).leftJoin(
          schoolSubjects,
          (0, import_drizzle_orm8.and)(
            (0, import_drizzle_orm8.eq)(subjects.id, schoolSubjects.subjectId),
            (0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, targetSchoolId)
          )
        ).where(
          (0, import_drizzle_orm8.or)(
            (0, import_drizzle_orm8.eq)(subjects.schoolId, targetSchoolId),
            (0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, targetSchoolId)
          )
        );
        let result = schoolRows.map((subject) => ({
          ...subject,
          schoolId: subject.schoolId ?? null
        }));
        if (approvedOnly) {
          result = result.filter((subject) => subject.status === "approved");
        }
        res.json(result);
        return;
      }
      if (approvedOnly && !targetSchoolId) {
        if (user.role === "super_admin") {
          const approvedRows = await db.select({
            id: subjects.id,
            schoolId: subjects.schoolId,
            name: subjects.name,
            code: subjects.code,
            status: schoolSubjects.status,
            createdAt: subjects.createdAt,
            updatedAt: subjects.updatedAt
          }).from(subjects).innerJoin(
            schoolSubjects,
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.eq)(subjects.id, schoolSubjects.subjectId),
              (0, import_drizzle_orm8.eq)(schoolSubjects.status, "approved")
            )
          );
          res.json(approvedRows.map((subject) => ({
            ...subject,
            schoolId: subject.schoolId ?? null
          })));
          return;
        }
        return res.status(403).json({ error: "School context is required" });
      }
      const allSubjects = await db.select().from(subjects);
      if (targetSchoolId) {
        const statusRows = await db.select().from(schoolSubjects).where((0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, targetSchoolId));
        const statusMap = new Map(statusRows.map((row) => [row.subjectId, row.status]));
        let result = allSubjects.map((subject) => ({
          ...subject,
          schoolId: subject.schoolId ?? null,
          status: subject.schoolId === targetSchoolId ? "approved" : statusMap.get(subject.id) ?? "pending"
        }));
        if (approvedOnly) {
          result = result.filter((subject) => subject.status === "approved");
        }
        res.json(result);
        return;
      }
      res.json(allSubjects.map((subject) => ({
        ...subject,
        schoolId: subject.schoolId ?? null
      })));
    } catch (err) {
      console.error("Error fetching subjects:", err);
      res.status(500).json({ error: "Failed to fetch subjects" });
    }
  });
  app.post("/api/subjects", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin" && user.role !== "school_admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { name, code, schoolId: bodySchoolId } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Subject name is required" });
      }
      const requestedSchoolId = bodySchoolId == null || bodySchoolId === "" ? null : Number(bodySchoolId);
      if (bodySchoolId != null && bodySchoolId !== "" && Number.isNaN(requestedSchoolId)) {
        return res.status(400).json({ error: "Invalid schoolId" });
      }
      let finalSchoolId = null;
      if (user.role === "school_admin") {
        const validation = resolveClassCreationSchoolId({
          actorRole: user.role,
          requestedSchoolId: bodySchoolId,
          actorSchoolId: user.schoolId
        });
        if (validation.error) {
          return res.status(400).json({ error: validation.error });
        }
        finalSchoolId = validation.schoolId;
      } else {
        finalSchoolId = requestedSchoolId;
      }
      const [newSubject] = await db.insert(subjects).values({
        schoolId: finalSchoolId != null ? Number(finalSchoolId) : null,
        name: name.trim(),
        code: code ? code.trim() : void 0
      }).returning();
      res.status(201).json({
        ...newSubject,
        schoolId: newSubject.schoolId ?? null,
        status: "approved"
      });
    } catch (err) {
      console.error("Error creating subject:", err);
      res.status(500).json({ error: "Failed to create subject" });
    }
  });
  app.put("/api/subjects/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin" && user.role !== "school_admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const subjectId = Number(req.params.id);
      if (!subjectId) return res.status(400).json({ error: "Invalid subject ID" });
      const [subject] = await db.select().from(subjects).where((0, import_drizzle_orm8.eq)(subjects.id, subjectId));
      if (!subject) return res.status(404).json({ error: "Subject not found" });
      if (user.role === "school_admin" && subject.schoolId !== user.schoolId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { name, code } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Subject name is required" });
      }
      const [updatedSubject] = await db.update(subjects).set({
        name: name.trim(),
        code: code ? code.trim() : void 0,
        updatedAt: /* @__PURE__ */ new Date()
      }).where((0, import_drizzle_orm8.eq)(subjects.id, subjectId)).returning();
      res.json(updatedSubject);
    } catch (err) {
      console.error("Error updating subject:", err);
      res.status(500).json({ error: "Failed to update subject" });
    }
  });
  app.delete("/api/subjects/:id", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin" && user.role !== "school_admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const subjectId = Number(req.params.id);
      if (!subjectId) return res.status(400).json({ error: "Invalid subject ID" });
      const [subject] = await db.select().from(subjects).where((0, import_drizzle_orm8.eq)(subjects.id, subjectId));
      if (!subject) return res.status(404).json({ error: "Subject not found" });
      if (user.role === "school_admin" && subject.schoolId !== user.schoolId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await db.delete(schoolSubjects).where((0, import_drizzle_orm8.eq)(schoolSubjects.subjectId, subjectId));
      await db.delete(subjects).where((0, import_drizzle_orm8.eq)(subjects.id, subjectId));
      res.json({ success: true, message: "Subject deleted" });
    } catch (err) {
      console.error("Error deleting subject:", err);
      res.status(500).json({ error: "Failed to delete subject" });
    }
  });
  app.post("/api/schools/:schoolId/subjects/:subjectId/approve", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin" && user.role !== "school_admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const schoolId = Number(req.params.schoolId);
      const subjectId = Number(req.params.subjectId);
      if (!schoolId || !subjectId) return res.status(400).json({ error: "Invalid subject or school ID" });
      if (user.role === "school_admin" && user.schoolId !== schoolId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const [subjectRow] = await db.select().from(subjects).where((0, import_drizzle_orm8.eq)(subjects.id, subjectId));
      if (!subjectRow) {
        return res.status(404).json({ error: "Subject not found" });
      }
      if (subjectRow.schoolId != null && subjectRow.schoolId !== schoolId) {
        return res.status(409).json({ error: "Subject already belongs to another school" });
      }
      if (subjectRow.schoolId == null) {
        await db.update(subjects).set({ schoolId }).where((0, import_drizzle_orm8.eq)(subjects.id, subjectId));
      }
      const existing = await db.select().from(schoolSubjects).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, schoolId), (0, import_drizzle_orm8.eq)(schoolSubjects.subjectId, subjectId)));
      if (existing[0]) {
        const [updated] = await db.update(schoolSubjects).set({ status: "approved", updatedAt: /* @__PURE__ */ new Date() }).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, schoolId), (0, import_drizzle_orm8.eq)(schoolSubjects.subjectId, subjectId))).returning();
        return res.json(updated);
      }
      const [created] = await db.insert(schoolSubjects).values({ schoolId, subjectId, status: "approved" }).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("Error approving subject:", err);
      res.status(500).json({ error: "Failed to approve subject" });
    }
  });
  app.post("/api/schools/:schoolId/subjects/:subjectId/reject", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "super_admin" && user.role !== "school_admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const schoolId = Number(req.params.schoolId);
      const subjectId = Number(req.params.subjectId);
      if (!schoolId || !subjectId) return res.status(400).json({ error: "Invalid subject or school ID" });
      if (user.role === "school_admin" && user.schoolId !== schoolId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const existing = await db.select().from(schoolSubjects).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, schoolId), (0, import_drizzle_orm8.eq)(schoolSubjects.subjectId, subjectId)));
      if (existing[0]) {
        const [updated] = await db.update(schoolSubjects).set({ status: "rejected", updatedAt: /* @__PURE__ */ new Date() }).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(schoolSubjects.schoolId, schoolId), (0, import_drizzle_orm8.eq)(schoolSubjects.subjectId, subjectId))).returning();
        return res.json(updated);
      }
      const [created] = await db.insert(schoolSubjects).values({ schoolId, subjectId, status: "rejected" }).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("Error rejecting subject:", err);
      res.status(500).json({ error: "Failed to reject subject" });
    }
  });
  app.get("/api/evaluations", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      let query = db.select({
        id: evaluations.id,
        classId: evaluations.classId,
        className: classes.name,
        teacherId: evaluations.teacherId,
        teacherName: users.name,
        termId: evaluations.termId,
        subject: evaluations.subject,
        title: evaluations.title,
        coefficient: evaluations.coefficient,
        maxScore: evaluations.maxScore,
        date: evaluations.date,
        createdAt: evaluations.createdAt,
        schoolId: classes.schoolId
      }).from(evaluations).innerJoin(classes, (0, import_drizzle_orm8.eq)(evaluations.classId, classes.id)).innerJoin(teachers, (0, import_drizzle_orm8.eq)(evaluations.teacherId, teachers.id)).innerJoin(users, (0, import_drizzle_orm8.eq)(teachers.userId, users.id));
      if (actor.role !== "super_admin") {
        if (actor.role === "parent") {
          const childStudentIds = await getParentChildStudentIds(actor.id);
          if (childStudentIds.length === 0) {
            return res.json([]);
          }
          const childClassRows = await db.selectDistinct({ classId: students.classId }).from(students).where((0, import_drizzle_orm8.inArray)(students.id, childStudentIds));
          const childClassIds = childClassRows.map((row) => row.classId).filter((id) => id != null);
          if (childClassIds.length === 0) {
            return res.json([]);
          }
          query = query.where((0, import_drizzle_orm8.inArray)(evaluations.classId, childClassIds));
        } else if (actor.schoolId) {
          query = query.where((0, import_drizzle_orm8.or)(
            (0, import_drizzle_orm8.eq)(classes.schoolId, actor.schoolId),
            (0, import_drizzle_orm8.and)(
              import_drizzle_orm8.sql`${classes.schoolId} IS NULL`,
              import_drizzle_orm8.sql`EXISTS (SELECT 1 FROM school_classes sc WHERE sc.class_id = ${classes.id} AND sc.school_id = ${actor.schoolId} AND sc.status = 'approved')`
            )
          ));
        } else {
          return res.json([]);
        }
        if (actor.role === "teacher") {
          if (actor.id == null) {
            return res.json([]);
          }
          query = query.where((0, import_drizzle_orm8.eq)(teachers.userId, actor.id));
        }
      }
      const list = await query;
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: "Failed to load evaluations list" });
    }
  });
  app.post("/api/evaluations", requireAuth, async (req, res) => {
    console.log("TRACE /api/evaluations handler ENTRY", {
      path: req.path,
      method: req.method,
      headers: {
        "x-simulated-role": req.headers["x-simulated-role"],
        "x-simulated-uid": req.headers["x-simulated-uid"],
        "x-simulated-school-id": req.headers["x-simulated-school-id"],
        "content-type": req.headers["content-type"]
      }
    });
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [requestingUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (requestingUser && requestingUser.role === "parent") {
        return res.status(403).json({ error: "Parents are not allowed to create evaluations" });
      }
      const { classId, teacherId, termId, subject, title, coefficient, maxScore, date } = req.body;
      if (!classId || !subject || !title || !date) {
        return res.status(400).json({ error: "Missing mandatory assessment data" });
      }
      const user = await resolveActor(req);
      if (!user) return res.status(404).json({ error: "User not found" });
      const [classRecord] = await db.select().from(classes).where((0, import_drizzle_orm8.eq)(classes.id, parseInt(classId)));
      if (!classRecord) return res.status(404).json({ error: "Class not found" });
      if (user.role !== "super_admin") {
        if (user.schoolId) {
          const allowedForSchool = classRecord.schoolId === user.schoolId || await isApprovedClassForSchool(parseInt(classId), user.schoolId);
          if (!allowedForSchool) {
            return res.status(403).json({ error: "Cannot create evaluation for class in another school" });
          }
        }
      }
      let resolvedTeacherId = teacherId ? parseInt(teacherId) : null;
      const [dbUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      console.log("TRACE /api/evaluations dbUser lookup result", { reqUser: req.user, dbUser });
      if (!dbUser) {
        console.log("TRACE /api/evaluations returning 404 at dbUser check", { reqUser: req.user });
        return res.status(404).json({ error: "User not found" });
      }
      if (user.role === "teacher") {
        const [teacherProfile] = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, dbUser.id));
        if (!teacherProfile) {
          return res.status(403).json({ error: "Teacher profile not found for the current user" });
        }
        const [assignment] = await db.select().from(classTeachers).where((0, import_drizzle_orm8.and)((0, import_drizzle_orm8.eq)(classTeachers.classId, parseInt(classId)), (0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherProfile.id)));
        if (!assignment) {
          return res.status(403).json({ error: "Un enseignant ne peut cr\xE9er une \xE9valuation que pour une classe qui lui est assign\xE9e" });
        }
        resolvedTeacherId = teacherProfile.id;
      }
      if (!resolvedTeacherId) {
        if (classRecord.teacherId) {
          resolvedTeacherId = classRecord.teacherId;
        }
      }
      if (!resolvedTeacherId) {
        return res.status(400).json({ error: "Must specify a valid Teacher ID for this evaluation" });
      }
      const evaluationDate = String(date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(evaluationDate)) {
        return res.status(400).json({ error: "Invalid evaluation date format. Expected YYYY-MM-DD" });
      }
      let resolvedTermId = null;
      if (termId != null && termId !== "") {
        const parsedTermId = Number(termId);
        if (!Number.isInteger(parsedTermId) || parsedTermId <= 0) {
          return res.status(400).json({ error: "Invalid termId" });
        }
        const [selectedTerm] = await db.select({ id: schoolTerms.id, academicYearId: schoolTerms.academicYearId }).from(schoolTerms).where((0, import_drizzle_orm8.eq)(schoolTerms.id, parsedTermId));
        if (!selectedTerm) {
          return res.status(400).json({ error: "Selected term not found" });
        }
        if (selectedTerm.academicYearId !== classRecord.academicYearId) {
          return res.status(400).json({ error: "Selected term does not belong to class academic year" });
        }
        resolvedTermId = selectedTerm.id;
      } else {
        const termsForYear = await db.select({
          id: schoolTerms.id,
          startDate: schoolTerms.startDate,
          endDate: schoolTerms.endDate,
          orderIndex: schoolTerms.orderIndex,
          isActive: schoolTerms.isActive
        }).from(schoolTerms).where((0, import_drizzle_orm8.eq)(schoolTerms.academicYearId, classRecord.academicYearId)).orderBy(schoolTerms.orderIndex);
        const matchedByRange = termsForYear.find(
          (term) => !!term.startDate && !!term.endDate && evaluationDate >= term.startDate && evaluationDate <= term.endDate
        );
        if (matchedByRange) {
          resolvedTermId = matchedByRange.id;
        } else {
          const activeTerm = termsForYear.find((term) => term.isActive);
          if (activeTerm) {
            resolvedTermId = activeTerm.id;
          } else if (termsForYear.length === 1) {
            resolvedTermId = termsForYear[0].id;
          }
        }
      }
      if (!resolvedTermId) {
        return res.status(400).json({ error: "Unable to resolve term for this evaluation. Please select a term explicitly." });
      }
      const normalizedSubject = String(subject).trim();
      let approvalSchoolId = classRecord.schoolId;
      let resolvedSchoolClassId = null;
      let resolvedSchoolClassSchoolId = null;
      let approvalSource = "class";
      if (approvalSchoolId == null) {
        approvalSource = "request";
        if (user.schoolId != null) {
          const [approvedClass] = await db.select().from(schoolClasses).where(
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.eq)(schoolClasses.classId, parseInt(classId)),
              (0, import_drizzle_orm8.eq)(schoolClasses.schoolId, user.schoolId),
              (0, import_drizzle_orm8.eq)(schoolClasses.status, "approved")
            )
          );
          if (!approvedClass) {
            console.error("ERROR /api/evaluations invalid school context for class", {
              classId: parseInt(classId),
              userSchoolId: user.schoolId,
              note: "No approved school_classes entry found for the current user school"
            });
            return res.status(403).json({ error: "Invalid school context for this class" });
          }
          approvalSchoolId = user.schoolId;
          resolvedSchoolClassId = approvedClass.id;
          resolvedSchoolClassSchoolId = approvedClass.schoolId;
        } else {
          const approvedClasses = await db.select().from(schoolClasses).where(
            (0, import_drizzle_orm8.and)(
              (0, import_drizzle_orm8.eq)(schoolClasses.classId, parseInt(classId)),
              (0, import_drizzle_orm8.eq)(schoolClasses.status, "approved")
            )
          );
          if (approvedClasses.length === 0) {
            console.error("ERROR /api/evaluations missing approved school context for global class", {
              classId: parseInt(classId)
            });
            return res.status(403).json({ error: "Cannot determine school context for this class" });
          }
          if (approvedClasses.length > 1) {
            console.error("ERROR /api/evaluations ambiguous school context for global class", {
              classId: parseInt(classId),
              approvedSchoolIds: approvedClasses.map((row) => row.schoolId)
            });
            return res.status(400).json({ error: "Ambiguous school context for this class" });
          }
          const [approvedClass] = approvedClasses;
          approvalSchoolId = approvedClass.schoolId;
          resolvedSchoolClassId = approvedClass.id;
          resolvedSchoolClassSchoolId = approvedClass.schoolId;
        }
      }
      console.log("DEBUG /api/evaluations school context", {
        classId: parseInt(classId),
        subject: normalizedSubject,
        classSchoolId: classRecord.schoolId,
        resolvedSchoolClassId,
        resolvedSchoolClassSchoolId,
        userSchoolId: user.schoolId,
        approvalSchoolId,
        approvalSource
      });
      const approvedSubject = await isApprovedSubjectForSchool(normalizedSubject, approvalSchoolId);
      if (!approvedSubject) {
        return res.status(400).json({ error: "La mati\xE8re n\u2019est pas approuv\xE9e pour cette \xE9cole" });
      }
      const result = await db.insert(evaluations).values({
        classId: parseInt(classId),
        teacherId: resolvedTeacherId,
        termId: resolvedTermId,
        subject: normalizedSubject,
        title,
        coefficient: coefficient ? parseInt(coefficient) : 1,
        maxScore: maxScore ? parseInt(maxScore) : 20,
        date
      }).returning();
      const [createdEvaluation] = result;
      const classStudentParents = await db.select({ parentUserId: parents.userId }).from(students).leftJoin(parents, (0, import_drizzle_orm8.eq)(students.parentId, parents.id)).where((0, import_drizzle_orm8.eq)(students.classId, parseInt(classId)));
      const uniqueParentIds = Array.from(
        new Set(
          classStudentParents.map((row) => row.parentUserId).filter((parentUserId) => parentUserId !== null && parentUserId !== void 0)
        )
      );
      if (uniqueParentIds.length > 0) {
        const notificationsToInsert = uniqueParentIds.map((parentUserId) => ({
          userId: parentUserId,
          title: `Nouveau devoir publi\xE9 : ${title}`,
          body: `Un nouveau devoir en ${subject} a \xE9t\xE9 publi\xE9 pour la classe ${classRecord.name} le ${date}. Encouragez votre enfant \xE0 se pr\xE9parer !`,
          type: "grade"
        }));
        await db.insert(notifications).values(notificationsToInsert);
      }
      res.status(201).json(createdEvaluation);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create assessment" });
    }
  });
  app.get("/api/grades", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      let query = db.select({
        id: grades.id,
        evaluationId: grades.evaluationId,
        evaluationTitle: evaluations.title,
        evaluationDate: evaluations.date,
        subject: evaluations.subject,
        studentId: grades.studentId,
        studentName: import_drizzle_orm8.sql`concat(${students.firstName}, ' ', ${students.lastName})`,
        score: grades.score,
        remarks: grades.remarks,
        editCount: grades.editCount,
        createdAt: grades.createdAt,
        updatedAt: grades.updatedAt,
        parentId: students.parentId,
        schoolId: students.schoolId
      }).from(grades).innerJoin(students, (0, import_drizzle_orm8.eq)(grades.studentId, students.id)).innerJoin(evaluations, (0, import_drizzle_orm8.eq)(grades.evaluationId, evaluations.id));
      if (user.role !== "super_admin") {
        if (user.role === "parent") {
          const childStudentIds = await getParentChildStudentIds(user.id);
          if (childStudentIds.length === 0) {
            return res.json([]);
          }
          query = query.where((0, import_drizzle_orm8.inArray)(grades.studentId, childStudentIds));
        } else {
          if (user.schoolId) {
            query = query.where((0, import_drizzle_orm8.eq)(students.schoolId, user.schoolId));
          } else {
            return res.json([]);
          }
        }
      }
      const list = await query;
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch grades list" });
    }
  });
  app.post("/api/grades", requireAuth, async (req, res) => {
    try {
      console.log("POST /api/grades payload", req.body);
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [requestingUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (requestingUser && requestingUser.role === "parent") {
        return res.status(403).json({ error: "Parents are not allowed to record or update grades" });
      }
      const { evaluationId, studentId, score, remarks } = req.body;
      if (!evaluationId || !studentId || score === void 0) {
        return res.status(400).json({ error: "Missing grade details" });
      }
      const normalizedScore = typeof score === "string" ? score.trim() : score;
      if (normalizedScore === "" || normalizedScore === null || normalizedScore === void 0) {
        return res.status(400).json({ error: "La note est requise" });
      }
      const [user] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!user) return res.status(404).json({ error: "User not found" });
      const [evaluation] = await db.select().from(evaluations).where((0, import_drizzle_orm8.eq)(evaluations.id, parseInt(evaluationId)));
      if (!evaluation) return res.status(404).json({ error: "Evaluation not found" });
      const scoreValidation = validateGradeScore(normalizedScore, evaluation.maxScore);
      if (!scoreValidation.isValid) {
        return res.status(400).json({ error: scoreValidation.error });
      }
      const [student] = await db.select().from(students).where((0, import_drizzle_orm8.eq)(students.id, parseInt(studentId)));
      if (!student) return res.status(404).json({ error: "Student not found" });
      console.log("Grade save details", {
        evaluationId,
        studentId,
        score,
        remarks,
        studentSchoolId: student.schoolId,
        userSchoolId: user.schoolId,
        evaluationSchoolId: evaluation.schoolId
      });
      if (student.enrolledAt && (evaluation.createdAt || evaluation.date)) {
        const enrollmentDate = new Date(student.enrolledAt);
        const evaluationTimestamp = new Date(evaluation.createdAt || evaluation.date);
        if (Number.isNaN(evaluationTimestamp.getTime())) {
          return res.status(400).json({ error: "Evaluation timestamp invalide" });
        }
        if (enrollmentDate.getTime() > evaluationTimestamp.getTime()) {
          return res.status(400).json({
            error: `Impossible de cr\xE9er une note pour ${student.firstName} ${student.lastName}: cet \xE9l\xE8ve n'\xE9tait pas encore inscrit au moment de la cr\xE9ation du devoir (${evaluation.createdAt || evaluation.date})`
          });
        }
      }
      if (user.role === "school_admin") {
        if (user.schoolId && student.schoolId !== user.schoolId) {
          return res.status(403).json({ error: "Cannot record grade for student in another school" });
        }
      }
      if (user.role === "teacher") {
        const [teacherProfile] = await db.select().from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, user.id));
        if (!teacherProfile) {
          return res.status(403).json({ error: "Profile enseignant introuvable" });
        }
        if (evaluation.teacherId !== teacherProfile.id) {
          return res.status(403).json({ error: "Vous ne pouvez pas modifier une note d\u2019une \xE9valuation qui ne vous appartient pas" });
        }
        if (user.schoolId && student.schoolId !== user.schoolId) {
          return res.status(403).json({ error: "Cannot record grade for student in another school" });
        }
      }
      const existing = await db.select().from(grades).where(
        (0, import_drizzle_orm8.and)(
          (0, import_drizzle_orm8.eq)(grades.evaluationId, parseInt(evaluationId)),
          (0, import_drizzle_orm8.eq)(grades.studentId, parseInt(studentId))
        )
      );
      let savedGrade;
      if (existing.length > 0) {
        if (user.role === "teacher") {
          const message = "Cette note a d\xE9j\xE0 \xE9t\xE9 saisie. Pour toute modification, veuillez contacter le school admin.";
          return res.status(403).json({ error: message });
        }
        const updated = await db.update(grades).set({ score: String(score), remarks, editCount: (existing[0].editCount ?? 0) + 1 }).where((0, import_drizzle_orm8.eq)(grades.id, existing[0].id)).returning();
        savedGrade = updated[0];
      } else {
        const inserted = await db.insert(grades).values({
          evaluationId: parseInt(evaluationId),
          studentId: parseInt(studentId),
          score: String(score),
          remarks,
          editCount: 0
        }).returning();
        savedGrade = inserted[0];
      }
      const [evaluationRecord] = await db.select().from(evaluations).where((0, import_drizzle_orm8.eq)(evaluations.id, parseInt(evaluationId)));
      if (evaluationRecord) {
        const [parentRecord] = student.parentId != null ? await db.select().from(parents).where((0, import_drizzle_orm8.eq)(parents.id, student.parentId)) : [null];
        if (parentRecord) {
          await db.insert(notifications).values({
            userId: parentRecord.userId,
            title: `Nouvelle note pour ${student.firstName}`,
            body: `${student.firstName} a obtenu la note de ${score}/${evaluationRecord.maxScore} en ${evaluationRecord.subject} pour : ${evaluationRecord.title}.`,
            type: "grade"
          });
        }
      }
      res.status(200).json(savedGrade);
    } catch (err) {
      console.error("POST /api/grades error:", err);
      console.error(err?.stack || err);
      res.status(500).json({ error: err?.message || "Failed to record student grade" });
    }
  });
  app.delete("/api/evaluations", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      if (actor.role === "parent") return res.status(403).json({ error: "Forbidden" });
      let evaluationIds = [];
      if (actor.role === "super_admin") {
        const rows = await db.select({ id: evaluations.id }).from(evaluations);
        evaluationIds = rows.map((row) => row.id);
      } else if (actor.role === "school_admin") {
        const rows = await db.select({ id: evaluations.id }).from(evaluations).innerJoin(classes, (0, import_drizzle_orm8.eq)(evaluations.classId, classes.id)).where((0, import_drizzle_orm8.eq)(classes.schoolId, actor.schoolId));
        evaluationIds = rows.map((row) => row.id);
      }
      if (evaluationIds.length === 0) {
        return res.json({ deletedEvaluations: 0, deletedGrades: 0 });
      }
      const deletedGrades = await db.delete(grades).where(import_drizzle_orm8.sql`${grades.evaluationId} IN ${evaluationIds}`);
      const deletedEvaluations = await db.delete(evaluations).where(import_drizzle_orm8.sql`${evaluations.id} IN ${evaluationIds}`);
      res.json({ deletedEvaluations: evaluationIds.length, deletedGrades: deletedGrades.rowCount ?? 0 });
    } catch (err) {
      console.error("Failed to delete evaluations and grades:", err);
      res.status(500).json({ error: "Failed to delete evaluations" });
    }
  });
  app.get("/api/dashboard/summary", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const actor = await resolveActor(req);
      if (!actor) return res.status(404).json({ error: "User not found" });
      let schoolFilter = void 0;
      let parentChildIds = null;
      let teacherClassIds = null;
      if (actor.role !== "super_admin" && actor.schoolId) {
        schoolFilter = actor.schoolId;
      }
      if (actor.role === "teacher") {
        const currentSchoolId = actor.schoolId ?? null;
        const teacherRows = await db.select({ id: teachers.id }).from(teachers).where((0, import_drizzle_orm8.eq)(teachers.userId, actor.id));
        if (teacherRows.length === 0) {
          teacherClassIds = [];
        } else {
          const teacherId = teacherRows[0].id;
          const assignmentRows = await db.select({ classId: classTeachers.classId, schoolId: classes.schoolId }).from(classTeachers).innerJoin(classes, (0, import_drizzle_orm8.eq)(classTeachers.classId, classes.id)).where((0, import_drizzle_orm8.eq)(classTeachers.teacherId, teacherId));
          teacherClassIds = getTeacherClassIdSet(assignmentRows, currentSchoolId);
        }
      }
      let parentProfile = null;
      if (actor.role === "parent") {
        parentChildIds = await getParentChildStudentIds(actor.id);
      }
      const normalizeGenderValue = (value) => {
        if (value == null) return "unknown";
        const normalized = String(value).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (["m", "male", "masculin", "homme", "garcon", "garcons", "boy", "boys"].includes(normalized)) return "male";
        if (["f", "female", "feminin", "feminine", "femme", "fille", "filles", "girl", "girls"].includes(normalized)) return "female";
        return "unknown";
      };
      let studentCountQuery = db.select({ count: import_drizzle_orm8.sql`count(*)::integer` }).from(students);
      let studentGenderQuery = db.select({ gender: students.gender }).from(students);
      let absenceCountQuery = db.select({ count: import_drizzle_orm8.sql`count(*)::integer` }).from(absences);
      let classCountQuery = db.select({ count: import_drizzle_orm8.sql`count(distinct ${classes.id})::integer` }).from(classes);
      let chartClassesQuery = db.select({ id: classes.id, name: classes.name }).from(classes);
      let chartStudentsQuery = db.select({ classId: students.classId }).from(students);
      let chartAbsencesQuery = db.select({ classId: absences.classId }).from(absences);
      if (actor.role === "parent") {
        if (!parentChildIds || parentChildIds.length === 0) {
          return res.json({ stats: { totalStudents: 0, totalAbsences: 0, totalClasses: 0, attendanceRate: 100, maleStudents: 0, femaleStudents: 0, unknownGenderStudents: 0 }, recentAbsences: [], recentGrades: [] });
        }
        studentCountQuery = studentCountQuery.where((0, import_drizzle_orm8.inArray)(students.id, parentChildIds));
        studentGenderQuery = studentGenderQuery.where((0, import_drizzle_orm8.inArray)(students.id, parentChildIds));
        chartStudentsQuery = chartStudentsQuery.where((0, import_drizzle_orm8.inArray)(students.id, parentChildIds));
        chartAbsencesQuery = chartAbsencesQuery.where((0, import_drizzle_orm8.inArray)(absences.studentId, parentChildIds));
        classCountQuery = db.select({ count: import_drizzle_orm8.sql`count(distinct ${classes.id})::integer` }).from(classes).innerJoin(students, (0, import_drizzle_orm8.eq)(classes.id, students.classId)).where((0, import_drizzle_orm8.inArray)(students.id, parentChildIds));
        absenceCountQuery = db.select({ count: import_drizzle_orm8.sql`count(*)::integer` }).from(absences).where((0, import_drizzle_orm8.inArray)(absences.studentId, parentChildIds));
      } else if (actor.role === "teacher") {
        if (!teacherClassIds || teacherClassIds.length === 0) {
          return res.json({ stats: { totalStudents: 0, totalAbsences: 0, totalClasses: 0, attendanceRate: 100, maleStudents: 0, femaleStudents: 0, unknownGenderStudents: 0 }, recentAbsences: [], recentGrades: [] });
        }
        studentCountQuery = studentCountQuery.where((0, import_drizzle_orm8.inArray)(students.classId, teacherClassIds));
        studentGenderQuery = studentGenderQuery.where((0, import_drizzle_orm8.inArray)(students.classId, teacherClassIds));
        chartClassesQuery = chartClassesQuery.where((0, import_drizzle_orm8.inArray)(classes.id, teacherClassIds));
        chartStudentsQuery = chartStudentsQuery.where((0, import_drizzle_orm8.inArray)(students.classId, teacherClassIds));
        classCountQuery = db.select({ count: import_drizzle_orm8.sql`count(*)::integer` }).from(classes).where((0, import_drizzle_orm8.inArray)(classes.id, teacherClassIds));
        absenceCountQuery = db.select({ count: import_drizzle_orm8.sql`count(*)::integer` }).from(absences).where((0, import_drizzle_orm8.inArray)(absences.classId, teacherClassIds));
        chartAbsencesQuery = db.select({ classId: absences.classId }).from(absences).where((0, import_drizzle_orm8.inArray)(absences.classId, teacherClassIds));
      } else if (schoolFilter) {
        studentCountQuery = studentCountQuery.where((0, import_drizzle_orm8.eq)(students.schoolId, schoolFilter));
        studentGenderQuery = studentGenderQuery.where((0, import_drizzle_orm8.eq)(students.schoolId, schoolFilter));
        chartClassesQuery = chartClassesQuery.where((0, import_drizzle_orm8.eq)(classes.schoolId, schoolFilter));
        chartStudentsQuery = chartStudentsQuery.where((0, import_drizzle_orm8.eq)(students.schoolId, schoolFilter));
        classCountQuery = classCountQuery.where((0, import_drizzle_orm8.eq)(classes.schoolId, schoolFilter));
        absenceCountQuery = db.select({ count: import_drizzle_orm8.sql`count(*)::integer` }).from(absences).innerJoin(students, (0, import_drizzle_orm8.eq)(absences.studentId, students.id)).where((0, import_drizzle_orm8.eq)(students.schoolId, schoolFilter));
        chartAbsencesQuery = db.select({ classId: absences.classId }).from(absences).innerJoin(students, (0, import_drizzle_orm8.eq)(absences.studentId, students.id)).where((0, import_drizzle_orm8.eq)(students.schoolId, schoolFilter));
      }
      const studentCountResult = await studentCountQuery;
      const studentGenderRows = await studentGenderQuery;
      const absenceCountResult = await absenceCountQuery;
      const classCountResult = await classCountQuery;
      const chartClassesRows = await chartClassesQuery;
      const chartStudentsRows = await chartStudentsQuery;
      const chartAbsencesRows = await chartAbsencesQuery;
      console.log("Nombre d'\xE9l\xE8ves :", studentCountResult[0]?.count || 0);
      console.log("Premier \xE9l\xE8ve :", studentGenderRows[0]);
      console.log("Valeurs de genre observ\xE9es :", studentGenderRows.slice(0, 10).map((row) => row.gender));
      const totalStudents = studentCountResult[0]?.count || 0;
      const genderCounts = studentGenderRows.reduce((acc, row) => {
        const normalized = normalizeGenderValue(row.gender);
        if (normalized === "male") acc.maleStudents += 1;
        else if (normalized === "female") acc.femaleStudents += 1;
        else acc.unknownGenderStudents += 1;
        return acc;
      }, { maleStudents: 0, femaleStudents: 0, unknownGenderStudents: 0 });
      const totalAbsences = absenceCountResult[0]?.count || 0;
      const totalClasses = classCountResult[0]?.count || 0;
      const studentsByClass = chartStudentsRows.reduce((acc, row) => {
        if (row.classId != null) {
          acc.set(row.classId, (acc.get(row.classId) || 0) + 1);
        }
        return acc;
      }, /* @__PURE__ */ new Map());
      const absencesByClass = chartAbsencesRows.reduce((acc, row) => {
        if (row.classId != null) {
          acc.set(row.classId, (acc.get(row.classId) || 0) + 1);
        }
        return acc;
      }, /* @__PURE__ */ new Map());
      const chartData = (chartClassesRows || []).map((classRow) => {
        const studentCount = studentsByClass.get(classRow.id) || 0;
        const absenceCount = absencesByClass.get(classRow.id) || 0;
        const taux = studentCount > 0 ? Math.max(0, 100 - absenceCount / (studentCount * 20) * 100) : 100;
        return { name: classRow.name, taux: Number((Math.round(taux * 100) / 100).toFixed(2)) };
      });
      console.log("Classes retourn\xE9es :", chartClassesRows);
      console.log("\xC9l\xE8ves par classe :", Array.from(studentsByClass.entries()));
      console.log("Donn\xE9es envoy\xE9es au graphique :", chartData);
      const attendanceRate = totalStudents > 0 && totalAbsences > 0 ? Math.max(0, 100 - totalAbsences / (totalStudents * 20) * 100) : 100;
      let recentAbsencesQuery = db.select({
        id: absences.id,
        studentId: absences.studentId,
        studentName: import_drizzle_orm8.sql`concat(${students.firstName}, ' ', ${students.lastName})`,
        date: absences.date,
        isJustified: absences.isJustified,
        period: absences.period,
        className: classes.name
      }).from(absences).innerJoin(students, (0, import_drizzle_orm8.eq)(absences.studentId, students.id)).innerJoin(classes, (0, import_drizzle_orm8.eq)(absences.classId, classes.id)).orderBy((0, import_drizzle_orm8.desc)(absences.date)).limit(5);
      if (actor.role === "parent") {
        recentAbsencesQuery = recentAbsencesQuery.where((0, import_drizzle_orm8.inArray)(absences.studentId, parentChildIds || []));
      } else if (actor.role === "teacher") {
        recentAbsencesQuery = recentAbsencesQuery.where((0, import_drizzle_orm8.inArray)(absences.classId, teacherClassIds || []));
      } else if (schoolFilter) {
        recentAbsencesQuery = recentAbsencesQuery.where((0, import_drizzle_orm8.eq)(students.schoolId, schoolFilter));
      }
      const recentAbsences = await recentAbsencesQuery;
      let recentGradesQuery = db.select({
        id: grades.id,
        studentId: grades.studentId,
        studentName: import_drizzle_orm8.sql`concat(${students.firstName}, ' ', ${students.lastName})`,
        evaluationTitle: evaluations.title,
        score: grades.score,
        date: evaluations.date
      }).from(grades).innerJoin(students, (0, import_drizzle_orm8.eq)(grades.studentId, students.id)).innerJoin(evaluations, (0, import_drizzle_orm8.eq)(grades.evaluationId, evaluations.id)).orderBy((0, import_drizzle_orm8.desc)(evaluations.date)).limit(5);
      if (actor.role === "parent") {
        recentGradesQuery = recentGradesQuery.where((0, import_drizzle_orm8.inArray)(grades.studentId, parentChildIds || []));
      } else if (actor.role === "teacher") {
        recentGradesQuery = recentGradesQuery.where((0, import_drizzle_orm8.inArray)(evaluations.classId, teacherClassIds || []));
      } else if (schoolFilter) {
        recentGradesQuery = recentGradesQuery.where((0, import_drizzle_orm8.eq)(students.schoolId, schoolFilter));
      }
      const recentGrades = await recentGradesQuery;
      const stats = {
        totalStudents,
        totalAbsences,
        totalClasses,
        attendanceRate: Math.round(attendanceRate * 100) / 100,
        maleStudents: genderCounts.maleStudents,
        femaleStudents: genderCounts.femaleStudents,
        unknownGenderStudents: genderCounts.unknownGenderStudents
      };
      console.log("Statistiques envoy\xE9es :", stats);
      res.json({
        stats,
        recentAbsences,
        recentGrades,
        chartData
      });
    } catch (err) {
      console.error("Error loading dashboard summary:", err);
      res.status(500).json({ error: "Failed to load dashboard summary" });
    }
  });
  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [dbUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!dbUser) return res.json([]);
      if (dbUser.role === "teacher") return res.status(403).json({ error: "Forbidden" });
      const userNotifications = await db.select().from(notifications).where((0, import_drizzle_orm8.eq)(notifications.userId, dbUser.id)).orderBy((0, import_drizzle_orm8.desc)(notifications.id));
      res.json(userNotifications);
    } catch (err) {
      res.status(500).json({ error: "Failed to load notifications feed" });
    }
  });
  app.put("/api/notifications/read-all", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const [dbUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (dbUser) {
        await db.update(notifications).set({ isRead: true }).where((0, import_drizzle_orm8.eq)(notifications.userId, dbUser.id));
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to clean notifications status" });
    }
  });
  app.post("/api/notifications/send", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
      const { title, body, type, userId } = req.body;
      if (!title || !body || !type) return res.status(400).json({ error: "Missing keys" });
      const [actor] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.uid, req.user.uid));
      if (!actor) return res.status(404).json({ error: "User not found" });
      let targetUserIds = [];
      if (userId) {
        const [targetUser] = await db.select().from(users).where((0, import_drizzle_orm8.eq)(users.id, parseInt(userId)));
        if (!targetUser) return res.status(404).json({ error: "Target user not found" });
        if (actor.role !== "super_admin") {
          if (actor.schoolId && targetUser.schoolId !== actor.schoolId) {
            return res.status(403).json({ error: "Cannot send notification to user in another school" });
          }
        }
        targetUserIds.push(targetUser.id);
      } else {
        let query = db.select().from(parents).innerJoin(users, (0, import_drizzle_orm8.eq)(parents.userId, users.id));
        if (actor.role !== "super_admin" && actor.schoolId) {
          query = query.where((0, import_drizzle_orm8.eq)(users.schoolId, actor.schoolId));
        }
        const parentsList = await query;
        targetUserIds = parentsList.map((p) => p.users.id);
      }
      for (const id of targetUserIds) {
        await db.insert(notifications).values({
          userId: id,
          title,
          body,
          type
        });
      }
      res.json({ success: true, message: `Notification successfully routed to ${targetUserIds.length} users.` });
    } catch (err) {
      res.status(500).json({ error: "Failed to dispatch notifications" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true }
    });
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      vite.middlewares(req, res, next);
    });
    app.use((req, res) => {
      if (req.path.startsWith("/api")) {
        return res.status(404).json({ error: "Not found" });
      }
      if (/\.\w+$/i.test(req.path)) {
        return res.status(404).send("Not found");
      }
      const indexPath = import_path2.default.join(process.cwd(), "index.html");
      res.sendFile(indexPath, (err) => {
        if (err) {
          res.status(500).send("Error serving index.html");
        }
      });
    });
  } else {
    const distPath = import_path2.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path2.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    try {
      const routes = [];
      app._router.stack.forEach((middleware) => {
        if (middleware.route) {
          const methods = Object.keys(middleware.route.methods).join(",").toUpperCase();
          routes.push(`${methods} ${middleware.route.path}`);
        } else if (middleware.name === "router" && middleware.handle && middleware.handle.stack) {
          middleware.handle.stack.forEach((handler) => {
            const route = handler.route;
            if (route) {
              const methods = Object.keys(route.methods).join(",").toUpperCase();
              routes.push(`${methods} ${route.path}`);
            }
          });
        }
      });
      console.log("Registered routes:", routes.join(" | "));
    } catch (e) {
      console.error("Failed to list registered routes:", e);
    }
    console.log(`Server starting on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
