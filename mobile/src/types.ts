export type UserRole = 'super_admin' | 'school_admin' | 'teacher' | 'parent';

export interface Evaluation {
  id: number;
  classId: number;
  teacherId: number;
  subject: string;
  title: string;
  coefficient: number;
  maxScore: number;
  date: string;
}

export interface Grade {
  id: number;
  evaluationId: number;
  studentId: number;
  score: string;
  remarks?: string;
}

export interface Student {
  id: number;
  classId: number;
  firstName: string;
  lastName: string;
}
