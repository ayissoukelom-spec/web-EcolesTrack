import React, { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, BookOpen, UserRound } from 'lucide-react';
import { Evaluation, Grade, Parent, Student, UserRole } from '../types.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { getGradeBadgeClass, getGradeBand } from '../lib/gradeColor.ts';

interface ParentNotesViewProps {
  studentsList: Student[];
  parentsList: Parent[];
  gradesList: Grade[];
  evaluationsList: Evaluation[];
  currentRole?: UserRole;
}

const toScoreValue = (score: string | number | undefined | null): number | null => {
  if (score == null) return null;
  const value = typeof score === 'number' ? score : Number(String(score).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

const toMention = (score: number, maxScore: number): string => {
  if (maxScore <= 0) return '-';
  const ratio = (score / maxScore) * 20;
  if (ratio >= 16) return 'Tres bien';
  if (ratio >= 14) return 'Bien';
  if (ratio >= 12) return 'Assez bien';
  if (ratio >= 10) return 'Passable';
  return 'A renforcer';
};

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const getBestGradeDateValue = (grade: Grade, evaluation?: Evaluation): string | null => {
  return grade.updatedAt || grade.createdAt || grade.evaluationDate || evaluation?.date || null;
};

const getGradeTimestamp = (grade: Grade, evaluation?: Evaluation): number => {
  const rawDate = getBestGradeDateValue(grade, evaluation);
  if (!rawDate) return 0;
  const timestamp = new Date(rawDate).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export default function ParentNotesView({
  studentsList,
  parentsList,
  gradesList,
  evaluationsList,
  currentRole,
}: ParentNotesViewProps) {
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string>('all');
  const [selectedSubjectKey, setSelectedSubjectKey] = useState<string>('all');
  const [sortMode, setSortMode] = useState<'recent' | 'subject-asc' | 'subject-desc'>('recent');

  const { user: simulatedUser } = useAuth();
  const currentEmail = simulatedUser?.email?.toLowerCase();
  const currentUid = simulatedUser?.uid || '';
  const parsedUidSuffix = currentUid ? Number(currentUid.split('_').pop()) : NaN;

  const currentParent = useMemo(() => {
    return parentsList.find((p) => {
      const byEmail = currentEmail && p.email?.toLowerCase() === currentEmail;
      const byUidString = currentUid && String(p.userId) === currentUid;
      const byUidNumber = !Number.isNaN(parsedUidSuffix) && p.userId === parsedUidSuffix;
      return Boolean(byEmail || byUidString || byUidNumber);
    });
  }, [currentEmail, currentUid, parsedUidSuffix, parentsList]);

  const children = useMemo(() => {
    if (currentRole !== 'parent') return [];

    // On parent accounts, studentsList is already filtered by backend scope.
    // Keep an explicit attachment filter when parent profile is available.
    if (currentParent) {
      return studentsList.filter((student) => (
        student.parentId === currentParent.id || student.id === currentParent.studentId
      ));
    }

    return studentsList;
  }, [currentParent, currentRole, studentsList]);

  useEffect(() => {
    if (children.length === 0) {
      setSelectedChildId(null);
      return;
    }

    const selectedStillExists = children.some((student) => student.id === selectedChildId);
    if (!selectedStillExists) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  const evaluationById = useMemo(() => {
    return new Map(evaluationsList.map((evaluation) => [Number(evaluation.id), evaluation]));
  }, [evaluationsList]);

  const activeChild = children.find((student) => student.id === selectedChildId) || null;

  const childGrades = useMemo(() => {
    if (!activeChild) return [];

    return gradesList
      .filter((grade) => grade.studentId === activeChild.id);
  }, [activeChild, gradesList]);

  const getPeriodMeta = (grade: Grade) => {
    const evaluation = evaluationById.get(Number(grade.evaluationId));

    if (evaluation?.termId != null) {
      return {
        key: `term:${evaluation.termId}`,
        label: evaluation.termName || `Periode ${evaluation.termId}`,
      };
    }

    const rawDate = getBestGradeDateValue(grade, evaluation);
    if (rawDate) {
      const date = new Date(rawDate);
      if (!Number.isNaN(date.getTime())) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return {
          key: `month:${year}-${month}`,
          label: new Intl.DateTimeFormat('fr-FR', {
            month: 'long',
            year: 'numeric',
          }).format(date),
        };
      }
    }

    return { key: 'unknown', label: 'Sans periode' };
  };

  const periodOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ key: string; label: string }> = [];

    childGrades.forEach((grade) => {
      const period = getPeriodMeta(grade);
      if (!seen.has(period.key)) {
        seen.add(period.key);
        options.push(period);
      }
    });

    return options;
  }, [childGrades]);

  const getSubjectLabel = (grade: Grade): string => {
    const evaluation = evaluationById.get(Number(grade.evaluationId));
    return String(grade.subject || evaluation?.subject || 'Sans matiere').trim();
  };

  const subjectOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ key: string; label: string }> = [];

    childGrades.forEach((grade) => {
      const label = getSubjectLabel(grade);
      const key = label.toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        options.push({ key, label });
      }
    });

    return options.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }, [childGrades, evaluationById]);

  useEffect(() => {
    if (selectedPeriodKey === 'all') return;
    const stillExists = periodOptions.some((option) => option.key === selectedPeriodKey);
    if (!stillExists) {
      setSelectedPeriodKey('all');
    }
  }, [periodOptions, selectedPeriodKey]);

  useEffect(() => {
    if (selectedSubjectKey === 'all') return;
    const stillExists = subjectOptions.some((option) => option.key === selectedSubjectKey);
    if (!stillExists) {
      setSelectedSubjectKey('all');
    }
  }, [selectedSubjectKey, subjectOptions]);

  useEffect(() => {
    if (selectedSubjectKey !== 'all' && sortMode !== 'recent') {
      setSortMode('recent');
    }
  }, [selectedSubjectKey, sortMode]);

  const visibleGrades = useMemo(() => {
    const periodFiltered = selectedPeriodKey === 'all'
      ? childGrades
      : childGrades.filter((grade) => getPeriodMeta(grade).key === selectedPeriodKey);

    const filtered = selectedSubjectKey === 'all'
      ? periodFiltered
      : periodFiltered.filter((grade) => getSubjectLabel(grade).toLowerCase() === selectedSubjectKey);

    return [...filtered].sort((a, b) => {
        const evalA = evaluationById.get(Number(a.evaluationId));
        const evalB = evaluationById.get(Number(b.evaluationId));

      const subjectA = String(a.subject || evalA?.subject || '').toLowerCase();
      const subjectB = String(b.subject || evalB?.subject || '').toLowerCase();

      if (sortMode === 'subject-asc' && subjectA !== subjectB) {
        return subjectA.localeCompare(subjectB, 'fr');
      }

      if (sortMode === 'subject-desc' && subjectA !== subjectB) {
        return subjectB.localeCompare(subjectA, 'fr');
      }

        const dateA = getGradeTimestamp(a, evalA);
        const dateB = getGradeTimestamp(b, evalB);
        return dateB - dateA;
      });
  }, [childGrades, evaluationById, selectedPeriodKey, selectedSubjectKey, sortMode]);

  const averageLabel = useMemo(() => {
    if (visibleGrades.length === 0) return 'Aucune note';

    const normalizedScores = visibleGrades
      .map((grade) => {
        const scoreValue = toScoreValue(grade.score);
        const maxScore = evaluationById.get(Number(grade.evaluationId))?.maxScore ?? 20;
        if (scoreValue == null || maxScore <= 0) return null;
        return (scoreValue / maxScore) * 20;
      })
      .filter((score): score is number => score != null);

    if (normalizedScores.length === 0) return 'Aucune note numerique';

    const average = normalizedScores.reduce((sum, score) => sum + score, 0) / normalizedScores.length;
    return `${average.toFixed(2)} / 20`;
  }, [visibleGrades, evaluationById]);

  return (
    <div className="space-y-6" id="parent-notes-view">
      <header className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-indigo-100 p-2 text-indigo-700">
            <BookOpen className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900">Notes de vos enfants</h2>
            <p className="text-xs sm:text-sm text-slate-600">
              Consultation web des evaluations et notes pour les eleves rattaches a votre compte parent.
            </p>
          </div>
        </div>
      </header>

      {children.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
          Aucun eleve rattache a ce compte parent. Contactez l&apos;administration pour effectuer le rattachement.
        </div>
      )}

      {children.length > 0 && (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wider font-bold">
                <UserRound className="h-4 w-4" />
                Eleve selectionne
              </div>
              <div className="mt-2">
                <select
                  value={selectedChildId ?? ''}
                  onChange={(event) => setSelectedChildId(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  {children.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.lastName} {student.firstName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wider font-bold">
                <BarChart3 className="h-4 w-4" />
                Moyenne generale
              </div>
              <p className="mt-2 text-2xl font-black text-slate-900">{averageLabel}</p>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <div className="text-slate-500 text-xs uppercase tracking-wider font-bold">Filtrer par periode</div>
              <div className="mt-2">
                <select
                  value={selectedPeriodKey}
                  onChange={(event) => setSelectedPeriodKey(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="all">Toutes les periodes</option>
                  {periodOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <div className="text-slate-500 text-xs uppercase tracking-wider font-bold">Matiere</div>
              <div className="mt-2">
                <select
                  value={selectedSubjectKey}
                  onChange={(event) => setSelectedSubjectKey(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="all">Toutes les matieres</option>
                  {subjectOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <div className="text-slate-500 text-xs uppercase tracking-wider font-bold">Ordre de tri</div>
              <div className="mt-2">
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as 'recent' | 'subject-asc' | 'subject-desc')}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="recent">Plus recent</option>
                  <option value="subject-asc">Matiere A-Z</option>
                  <option value="subject-desc">Matiere Z-A</option>
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <Award className="h-4 w-4 text-indigo-600" />
              <p className="text-sm font-bold text-slate-700">Detail des notes</p>
            </div>

            {visibleGrades.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">
                Aucune note disponible pour cet eleve pour le moment.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-white">
                    <tr className="text-left text-slate-500">
                      <th className="px-4 py-3 font-semibold">Matiere</th>
                      <th className="px-4 py-3 font-semibold">Evaluation</th>
                      <th className="px-4 py-3 font-semibold">Note</th>
                      <th className="px-4 py-3 font-semibold">Date de publication</th>
                      <th className="px-4 py-3 font-semibold">Mention</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGrades.map((grade) => {
                      const evaluation = evaluationById.get(Number(grade.evaluationId));
                      const maxScore = evaluation?.maxScore ?? 20;
                      const scoreValue = toScoreValue(grade.score);
                      const mention = scoreValue == null ? '-' : toMention(scoreValue, maxScore);
                      const publishedDate = formatDate(getBestGradeDateValue(grade, evaluation));
                      const gradeBand = getGradeBand(grade.score, maxScore);
                      const gradeBadgeClass = getGradeBadgeClass(gradeBand);

                      return (
                        <tr key={grade.id} className="border-t border-slate-100">
                          <td className="px-4 py-3 text-slate-700">{grade.subject || evaluation?.subject || '-'}</td>
                          <td className="px-4 py-3 text-slate-700">{grade.evaluationTitle || evaluation?.title || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`font-semibold px-2 py-1 rounded-lg ${gradeBadgeClass}`}>
                              {grade.score} / {maxScore}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{publishedDate}</td>
                          <td className="px-4 py-3 text-slate-700">{mention}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}