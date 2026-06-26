export type UserRole = 'super_admin' | 'school_admin' | 'teacher' | 'parent';

export interface School {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  createdAt?: string;
}

export interface AcademicYear {
  id: number;
  schoolId?: number;
  name: string;
  isActive: boolean;
  createdAt?: string;
}

export interface User {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  schoolId?: number;
  academicYearId?: number;
  gender?: string;
  phone?: string;
  specialization?: string | string[];
  isDeleted?: boolean;
  createdAt?: string;
}

export interface Teacher {
  id: number;
  userId: number;
  name: string;
  email: string;
  phone?: string;
  specialization?: string | string[];
  schoolId: number;
  classIds?: number[];
  gender?: string;
}

export interface Parent {
  id: number;
  userId: number;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  firstName?: string;
  lastName?: string;
  studentId?: number;
  studentFirstName?: string;
  studentLastName?: string;
  studentClassId?: number;
  studentSchoolId?: number;
  studentClassName?: string;
  studentSchoolName?: string;
  schoolId?: number;
  className?: string;
  schoolName?: string;
  gender?: string;
}

export interface Class {
  id: number;
  schoolId: number;
  academicYearId: number;
  name: string;
  teacherId?: number;
  teacherName?: string;
  yearName?: string;
}

export interface Student {
  id: number;
  schoolId: number;
  classId: number;
  className: string;
  yearId?: number;
  yearName?: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  gender?: string;
  parentId?: number;
  parentName?: string;
  schoolAdminId?: number;
  enrolledAt?: string; // ISO timestamp of when student was enrolled in class
}

export interface Evaluation {
  id: number;
  classId: number;
  className?: string;
  teacherId: number;
  teacherName?: string;
  subject: string;
  title: string;
  coefficient: number;
  maxScore: number;
  date: string;
  createdAt?: string;
}

export interface Grade {
  id: number;
  evaluationId: number;
  evaluationTitle?: string;
  subject?: string;
  studentId: number;
  studentName?: string;
  score: string; // "14.5", "Abs" etc
  remarks?: string;
  editCount?: number;
}

export interface Absence {
  id: number;
  studentId: number;
  studentName: string;
  classId: number;
  className: string;
  date: string;
  period: 'morning' | 'afternoon' | 'all_day';
  isJustified: boolean;
  justificationReason?: string;
}

export interface SystemNotification {
  id: number;
  userId: number;
  title: string;
  body: string;
  type: 'absence' | 'grade' | 'info';
  isRead: boolean;
  createdAt?: string;
}

export interface AuditEvent {
  id: number;
  actorUserId?: number | null;
  actorName?: string;
  actorEmail?: string;
  actorRole: UserRole | string;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  schoolId?: number | null;
  description: string;
  createdAt?: string;
}
