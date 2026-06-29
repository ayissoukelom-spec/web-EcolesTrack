import React, { useState } from 'react';
import { Evaluation, Grade, Student, Class, UserRole } from '../types.ts';
import { sortClasses } from '../lib/classOrdering';
import { BookOpen } from 'lucide-react';
import { getEligibleStudentsForEvaluation, getEligibleStudentsForEvaluationWithGrades, getDateOnlyMs, isEvaluationFullyGraded as isEvaluationFullyGradedUtil, isEvaluationCompleted as isEvaluationCompletedUtil, parseDateValue } from '../lib/evaluationUtils';

interface ArchiveViewProps {
  userRole: UserRole;
  evaluationsList: Evaluation[];
  gradesList: Grade[];
  studentsList: Student[];
  classesList: Class[];
  schoolsList: { id: number; name: string }[];
  schoolFilterId?: number | null;
  onSchoolFilterChange?: (schoolId: number | null) => void;
  teacherClassIds?: number[];
  teacherId?: number;
}

export default function ArchiveView({
  userRole,
  evaluationsList,
  gradesList,
  studentsList,
  classesList,
  schoolsList,
  schoolFilterId,
  onSchoolFilterChange,
  teacherClassIds = [],
  teacherId,
}: ArchiveViewProps) {
  const sortedClasses = sortClasses(classesList || []);
  const availableClasses = userRole === 'teacher'
    ? sortedClasses.filter((c) => teacherClassIds.includes(c.id))
    : sortedClasses;
  const filteredClasses = schoolFilterId
    ? availableClasses.filter((c) => c.schoolId === schoolFilterId)
    : availableClasses;
  const [selectedClassId, setSelectedClassId] = useState('');

  const normalizeDateOnly = (value: string | Date | undefined | null): string | null => {
    const date = parseDateValue(value);
    if (!date) return null;
    return date.toISOString().split('T')[0];
  };

  const isEvaluationFullyGraded = (ev: Evaluation) =>
    isEvaluationFullyGradedUtil(ev, studentsList, gradesList);

  const isEvaluationCompleted = (ev: Evaluation) =>
    isEvaluationCompletedUtil(ev, studentsList, gradesList);

  const isGradeModified = (grade: Grade) => {
    return grade.isModified ?? ((grade.editCount ?? 0) > 0);
  };

  const filteredArchived = evaluationsList.filter((ev) => {
    if (userRole === 'teacher') {
      if (teacherId == null) return false;
      if (ev.teacherId !== teacherId) return false;
    }
    if (schoolFilterId) {
      const evaluationClass = classesList.find((cls) => cls.id === ev.classId);
      if (!evaluationClass || evaluationClass.schoolId !== schoolFilterId) return false;
    }
    if (selectedClassId && String(ev.classId) !== selectedClassId) return false;
    return isEvaluationCompleted(ev);
  });

  return (
    <div className="space-y-6" id="archive-view">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Archive des devoirs terminés</h2>
          <p className="text-sm text-slate-500">Consultez les devoirs dont toutes les notes ont été saisies et leurs résultats.</p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-2 text-slate-600 text-xs font-semibold">
          <BookOpen className="h-4.5 w-4.5" />
          {filteredArchived.length} devoir{filteredArchived.length > 1 ? 's' : ''}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white p-4 border border-slate-50 rounded-2xl shadow-sm">
        {userRole === 'super_admin' && (
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Filtrer par école</label>
            <select
              value={schoolFilterId ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                if (onSchoolFilterChange) onSchoolFilterChange(value ? parseInt(value, 10) : null);
                setSelectedClassId('');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
            >
              <option value="">Toutes les écoles</option>
              {schoolsList.map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="sm:col-span-1">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Filtrer par classe</label>
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
          >
            <option value="">Toutes les classes</option>
            {filteredClasses.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 flex flex-col justify-end text-slate-500 text-xs leading-relaxed">
          <p>Cet écran affiche les évaluations terminées avec toutes les notes saisies. Vous pouvez choisir une école puis une classe pour limiter l’archive.</p>
        </div>
      </div>

      {filteredArchived.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center text-slate-500">
          Aucun devoir terminé n’est disponible pour cette sélection.
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredArchived.map((ev) => {
            const gradesForEval = gradesList.filter((g) => g.evaluationId === ev.id);
            const classStudents = studentsList.filter((st) => st.classId === ev.classId);
            const evaluationTimestamp = parseDateValue(ev.createdAt || ev.date);
            const eligibleStudents = classStudents.filter((st) => {
              if (!st.enrolledAt || !evaluationTimestamp) return true;
              const enrollmentDate = parseDateValue(st.enrolledAt);
              return enrollmentDate ? enrollmentDate.getTime() <= evaluationTimestamp.getTime() : true;
            });
            return (
              <div key={ev.id} className="bg-white border border-slate-100 rounded-3xl p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold">{ev.subject}</div>
                    <h3 className="text-lg font-semibold text-slate-900">{ev.title}</h3>
                    <div className="mt-2 text-sm text-slate-500">Date : {ev.date}</div>
                  </div>
                  <div className="rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-xs font-semibold">Terminé</div>
                </div>

                <div className="mt-4 rounded-3xl bg-slate-50 border border-slate-100 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 text-[12px] uppercase tracking-[0.15em] text-slate-500 font-semibold">
                    <span>Notes enregistrées</span>
                    <span>{gradesForEval.length} / {getEligibleStudentsForEvaluationWithGrades(ev, studentsList.filter((st) => st.classId === ev.classId), gradesList).length}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {gradesForEval.map((grade) => {
                      const student = studentsList.find((st) => st.id === grade.studentId);
                      return (
                        <div key={grade.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-slate-800">{grade.studentName || `${student?.firstName || 'Élève'} ${student?.lastName || ''}`.trim() || 'Élève'}</div>
                            {isGradeModified(grade) && (
                              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
                                Modifiée
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-slate-600 text-xs">
                            <div>Note : <span className="font-bold text-slate-900">{grade.score}{ev.maxScore != null ? `/${ev.maxScore}` : '/20'}</span></div>
                            <div>Remarque : <span className="text-slate-700">{grade.remarks || '—'}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
