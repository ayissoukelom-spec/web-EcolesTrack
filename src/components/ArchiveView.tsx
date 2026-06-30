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
  const safeEvaluationsList = Array.isArray(evaluationsList)
    ? evaluationsList.filter((item): item is Evaluation => Boolean(item))
    : [];
  const safeClassesList = Array.isArray(classesList)
    ? classesList.filter((item): item is Class => Boolean(item))
    : [];
  const safeStudentsList = Array.isArray(studentsList)
    ? studentsList.filter((item): item is Student => Boolean(item))
    : [];
  const safeGradesList = Array.isArray(gradesList)
    ? gradesList.filter((item): item is Grade => Boolean(item))
    : [];
  const normalizedTeacherId = teacherId != null ? Number(teacherId) : undefined;
  const safeTeacherClassIds = Array.isArray(teacherClassIds)
    ? teacherClassIds.map((id) => Number(id)).filter((value) => !Number.isNaN(value))
    : [];

  const sortedClasses = sortClasses(safeClassesList);
  const fallbackClasses = Array.from(
    new Map(
      safeEvaluationsList
        .filter((ev) => ev?.classId != null)
        .map((ev) => [String(ev.classId), {
          id: Number(ev.classId),
          name: String((ev as any).className || `Classe ${ev.classId}`),
          schoolId: (ev as any).schoolId ?? null,
        }])
    ).values(),
  );
  const teacherScopedClasses = sortedClasses.filter((c) => safeTeacherClassIds.includes(c.id) || safeTeacherClassIds.length === 0);
  const availableClasses = userRole === 'teacher'
    ? (teacherScopedClasses.length > 0 ? teacherScopedClasses : fallbackClasses)
    : (sortedClasses.length > 0 ? sortedClasses : fallbackClasses);
  const filteredClasses = schoolFilterId
    ? availableClasses.filter((c) => c.schoolId === schoolFilterId)
    : availableClasses;
  const effectiveClasses = filteredClasses.length > 0 ? filteredClasses : availableClasses;
  const [selectedClassId, setSelectedClassId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

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

  const getEvaluationDateValue = (ev: Evaluation): string | null => {
    return normalizeDateOnly(ev.date || ev.createdAt);
  };

  const filteredArchived = safeEvaluationsList
    .filter((ev) => {
      if (userRole === 'teacher' && normalizedTeacherId != null && ev?.teacherId != null) {
        if (Number(ev.teacherId) !== normalizedTeacherId) return false;
      }
      if (schoolFilterId) {
        const evaluationClassId = Number(ev?.classId);
        const evaluationClass = safeClassesList.find((cls) => cls?.id === evaluationClassId) ?? effectiveClasses.find((cls) => cls?.id === evaluationClassId);
        if (!evaluationClass || Number(evaluationClass.schoolId) !== schoolFilterId) return false;
      }
      if (selectedClassId && String(ev.classId) !== selectedClassId) return false;
      if (!isEvaluationCompleted(ev)) return false;

      const evaluationDateValue = getEvaluationDateValue(ev);
      if (fromDate && (!evaluationDateValue || evaluationDateValue < fromDate)) return false;
      if (toDate && (!evaluationDateValue || evaluationDateValue > toDate)) return false;

      return true;
    })
    .sort((a, b) => {
      const aDate = getEvaluationDateValue(a);
      const bDate = getEvaluationDateValue(b);
      if (aDate && bDate) return bDate.localeCompare(aDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
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

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-white p-4 border border-slate-50 rounded-2xl shadow-sm">
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
            {effectiveClasses.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Du</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Au</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
          />
        </div>
        <div className="sm:col-span-1 flex flex-col justify-end text-slate-500 text-xs leading-relaxed">
          <p>Les devoirs les plus récents apparaissent en premier. Vous pouvez aussi filtrer par période.</p>
        </div>
      </div>

      {filteredArchived.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center text-slate-500">
          Aucun devoir terminé n’est disponible pour cette sélection.
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredArchived.map((ev) => {
            const gradesForEval = safeGradesList.filter((g) => g?.evaluationId === ev.id);
            const classStudents = safeStudentsList.filter((st) => st?.classId === ev.classId);
            const evaluationTimestamp = parseDateValue(ev?.createdAt || ev?.date);
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
                      const student = safeStudentsList.find((st) => st?.id === grade?.studentId);
                      return (
                        <div key={grade.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-slate-800">{grade?.studentName || `${student?.firstName || 'Élève'} ${student?.lastName || ''}`.trim() || 'Élève'}</div>
                            {isGradeModified(grade) && (
                              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
                                Modifiée
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-slate-600 text-xs">
                            <div>Note : <span className="font-bold text-slate-900">{grade?.score ?? '—'}{ev?.maxScore != null ? `/${ev.maxScore}` : '/20'}</span></div>
                            <div>Remarque : <span className="text-slate-700">{grade?.remarks || '—'}</span></div>
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
