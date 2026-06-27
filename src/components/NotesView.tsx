import React, { useEffect, useMemo, useState } from 'react';
import { Evaluation, Grade, Student, Class, UserRole } from '../types.ts';
import { sortClasses } from '../lib/classOrdering';
import {
  Award,
  BookOpen,
  Plus,
  Calculator,
  Calendar,
  CheckCircle,
  HelpCircle,
  Edit2
} from 'lucide-react';
import {
  getDateOnlyMs,
  getEligibleStudentsForEvaluation as getEligibleStudentsForEvaluationUtil,
  getEligibleStudentsForEvaluationWithGrades as getEligibleStudentsForEvaluationWithGradesUtil,
  getEligibleStudentsWithHistoryForEvaluation as getEligibleStudentsWithHistoryForEvaluationUtil,
  getEligibleGradesForEvaluation,
  isEvaluationFullyGraded as isEvaluationFullyGradedUtil,
  isStudentEligibleForEvaluation,
  parseDateValue,
} from '../lib/evaluationUtils';
import { getGradeEditPermission } from '../lib/gradePermissions';
import { resolveSelectedEvaluationId } from '../lib/evaluationSelection';

interface NotesViewProps {
  userRole: UserRole;
  evaluationsList: Evaluation[];
  gradesList: Grade[];
  studentsList: Student[];
  classesList: Class[];
  schoolsList: { id: number; name: string }[];
  schoolFilterId?: number | null;
  onSchoolFilterChange?: (schoolId: number | null) => void;
  teacherClassIds?: number[];
  teacherSpecializations?: string[];
  teacherId?: number;
  onAddEvaluation: (data: { classId: number; subject: string; title: string; coefficient: number; maxScore: number; date: string }) => void;
  onAddGrade: (data: { evaluationId: number; studentId: number; score: string; remarks: string }) => void;
}

export default function NotesView({
  userRole,
  evaluationsList,
  gradesList,
  studentsList,
  classesList,
  schoolsList,
  schoolFilterId,
  onSchoolFilterChange,
  teacherClassIds = [],
  teacherSpecializations = [],
  teacherId,
  onAddEvaluation,
  onAddGrade,
}: NotesViewProps) {
  const sortedClasses = useMemo(() => sortClasses(classesList || []), [classesList]);
  const availableClasses = useMemo(
    () => (userRole === 'teacher'
      ? sortedClasses.filter((c) => teacherClassIds.includes(c.id))
      : sortedClasses),
    [userRole, sortedClasses, teacherClassIds]
  );
  const filteredClasses = useMemo(
    () => (schoolFilterId
      ? availableClasses.filter((c) => c.schoolId === schoolFilterId)
      : availableClasses),
    [schoolFilterId, availableClasses]
  );
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedEvalId, setSelectedEvalId] = useState('');
  const [isNewEvalFormOpen, setIsNewEvalFormOpen] = useState(false);
  const [gradeInputValues, setGradeInputValues] = useState<{ [studentId: number]: { score: string; remarks: string } }>({});
  const [gradeScoreErrors, setGradeScoreErrors] = useState<Record<number, string>>({});
  const [isEditingGrades, setIsEditingGrades] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // New Eval form states
  const formatLocalDatetime = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    const tzOffset = date.getTimezoneOffset() * 60000;
    const localDate = new Date(date.getTime() - tzOffset);
    return localDate.toISOString().slice(0, 16);
  };

  const [newEvalClassId, setNewEvalClassId] = useState('');
  const [newEvalSubject, setNewEvalSubject] = useState('');
  const [newEvalTitle, setNewEvalTitle] = useState('');
  const [newEvalCoefficient, setNewEvalCoefficient] = useState(1);
  const [newEvalMaxScore, setNewEvalMaxScore] = useState(20);
  const [newEvalDate, setNewEvalDate] = useState(formatLocalDatetime());

  const sanitizeScoreInput = (raw: string): string | null => {
    const compact = String(raw || '').replace(/\s+/g, '');
    if (compact === '') return '';
    if (!/^[0-9.,]+$/.test(compact)) return null;
    const separators = compact.match(/[.,]/g) || [];
    if (separators.length > 1) return null;
    if (compact.includes('.') && compact.includes(',')) return null;
    return compact;
  };

  const validateAndNormalizeScore = (value: string, maxScore: number): { isValid: boolean; normalized?: string; message?: string } => {
    const compact = String(value || '').trim();
    if (!compact) {
      return { isValid: false, message: 'La note est requise.' };
    }

    if (!/^\d+(?:[.,]\d+)?$/.test(compact)) {
      return { isValid: false, message: 'La note doit contenir uniquement des chiffres, avec un seul séparateur décimal (. ou ,).' };
    }

    const normalized = compact.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return { isValid: false, message: 'Format de note invalide.' };
    }

    if (parsed < 0 || parsed > maxScore) {
      return { isValid: false, message: `Cette note doit être comprise entre 0 et ${maxScore}.` };
    }

    return { isValid: true, normalized };
  };

  const handleScorePaste = (studentId: number, event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text') || '';
    const sanitized = sanitizeScoreInput(pasted);
    if (sanitized == null) {
      setGradeScoreErrors((prev) => ({
        ...prev,
        [studentId]: 'Seuls les chiffres et un seul séparateur decimal (. ou ,) sont autorises.',
      }));
      return;
    }

    const check = validateAndNormalizeScore(sanitized, effectiveMaxScore);
    if (sanitized !== '' && !check.isValid) {
      setGradeScoreErrors((prev) => ({ ...prev, [studentId]: check.message || 'Note invalide.' }));
    } else {
      setGradeScoreErrors((prev) => {
        const next = { ...prev };
        delete next[studentId];
        return next;
      });
    }

    updateGradeInput(studentId, { score: sanitized });
  };

  // Invariant: input typing must always update local state.
  // Do not add permission checks in this updater. Permissions are enforced by readOnly/save flow/backend.
  const updateGradeInput = (studentId: number, patch: Partial<{ score: string; remarks: string }>) => {
    setGradeInputValues((prev) => {
      const current = prev[studentId] || { score: '', remarks: '' };
      return {
        ...prev,
        [studentId]: {
          score: patch.score ?? current.score,
          remarks: patch.remarks ?? current.remarks,
        },
      };
    });
  };

  const populateGradeInputsForEvaluation = (evaluationId: string | null) => {
    if (!evaluationId) {
      setGradeInputValues({});
      return;
    }

    const matchedGrades = gradesList.filter((g) => String(g.evaluationId) === evaluationId);
    const initialGrades: Record<number, { score: string; remarks: string }> = {};
    matchedGrades.forEach((g) => {
      initialGrades[g.studentId] = { score: g.score, remarks: g.remarks || '' };
    });
    setGradeInputValues(initialGrades);
  };

  const allSubjects = [
    'Anglais',
    'Français',
    'Histoire-Géographie',
    'Physique-Chimie',
    'SVT',
    'Mathématiques',
    'Philosophie',
    'Espagnol',
    'Allemand',
  ];

  const availableSubjects = userRole === 'teacher' && teacherSpecializations.length > 0
    ? allSubjects.filter((subject) => teacherSpecializations.map((s) => s.toLowerCase()).includes(subject.toLowerCase()))
    : allSubjects;

  const handleCreateEvaluation = (e: React.FormEvent) => {
    e.preventDefault();
    console.debug('NotesView: creating evaluation with subject', newEvalSubject);
    if (!newEvalClassId) {
      console.warn('NotesView: missing classId for evaluation');
      return;
    }
    if (!newEvalSubject) {
      console.warn('NotesView: missing subject for evaluation');
      return;
    }
    if (!newEvalTitle.trim()) {
      console.warn('NotesView: missing title for evaluation');
      return;
    }

    onAddEvaluation({
      classId: parseInt(newEvalClassId),
      subject: newEvalSubject,
      title: newEvalTitle,
      coefficient: Number(newEvalCoefficient),
      maxScore: Number(newEvalMaxScore),
      date: normalizeDateToISODate(newEvalDate) || newEvalDate,
    });
    setIsNewEvalFormOpen(false);
    setNewEvalClassId('');
    setNewEvalSubject('');
    setNewEvalTitle('');
    setNewEvalCoefficient(1);
    setNewEvalMaxScore(20);
    setNewEvalDate(formatLocalDatetime());
  };

  const normalizeDateToISODate = (value: string | Date | undefined | null): string | null => {
    const date = parseDateValue(value);
    if (!date) return null;
    return date.toISOString().slice(0, 10);
  };

  const handleSaveAllGrades = async () => {
    if (!selectedEvalId) return;
    if (canRoleModifyExistingGrades && !isEditingGrades) {
      setSaveStatus('Cliquez sur "Modifier les notes" pour activer le mode édition.');
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }

    let hasValidationError = false;
    const collectedErrors: Record<number, string> = {};

    const saveableGrades = currentClassStudents
      .map((student) => {
        const existingGrade = gradesList.find(
          (g) => String(g.evaluationId) === selectedEvalId && g.studentId === student.id
        );
        const gradePermission = getGradeEditPermission(userRole, existingGrade);
        const input = gradeInputValues[student.id];
        if (!input || input.score === undefined || input.score === '') return null;
        if (!existingGrade && !gradePermission.canCreate) return null;
        if (existingGrade && !gradePermission.canEditExisting) return null;
        const scoreCheck = validateAndNormalizeScore(input.score, effectiveMaxScore);
        if (!scoreCheck.isValid) {
          hasValidationError = true;
          collectedErrors[student.id] = scoreCheck.message || 'Note invalide.';
          return null;
        }
        return {
          evaluationId: parseInt(selectedEvalId),
          studentId: student.id,
          score: scoreCheck.normalized || input.score,
          remarks: input.remarks || '',
        };
      })
      .filter(Boolean) as Array<{ evaluationId: number; studentId: number; score: string; remarks: string }>;

    if (hasValidationError) {
      setGradeScoreErrors((prev) => ({ ...prev, ...collectedErrors }));
      return;
    }

    setGradeScoreErrors({});

    if (saveableGrades.length === 0) {
      setSaveStatus('Aucune nouvelle note à enregistrer.');
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }

    try {
      await Promise.all(saveableGrades.map((grade) => onAddGrade(grade)));
      setSaveStatus(`Toutes les notes ont été enregistrées.`);
      setIsEditingGrades(false);
    } catch (err: any) {
      setSaveStatus(err?.message || 'Erreur lors de l’enregistrement de certaines notes.');
      console.error('Failed to save all grades:', err);
    }

    setTimeout(() => setSaveStatus(null), 3000);
  };

  // Check if a student is eligible for an evaluation (was enrolled before or at the evaluation timestamp)
  const currentClassStudents = studentsList.filter((st) => {
    if (!selectedClassId) return true;
    return String(st.classId) === selectedClassId;
  });

  // Get eligible students for currently selected evaluation
  const getEligibleStudentsForEvaluation = (evaluation: Evaluation | null): Student[] =>
    getEligibleStudentsForEvaluationUtil(evaluation, currentClassStudents);

  const getEligibleStudentsWithHistoryForEvaluation = (evaluation: Evaluation | null): Student[] =>
    getEligibleStudentsWithHistoryForEvaluationUtil(evaluation, currentClassStudents, gradesList);

  const currentEvaluation = evaluationsList.find((ev) => String(ev.id) === selectedEvalId) || null;
  const selectedEvaluationMaxScore = Number(currentEvaluation?.maxScore);
  const effectiveMaxScore = Number.isFinite(selectedEvaluationMaxScore) && selectedEvaluationMaxScore > 0
    ? selectedEvaluationMaxScore
    : 20;
  const canRoleModifyExistingGrades = getGradeEditPermission(userRole, {
    id: -1,
    evaluationId: -1,
    studentId: -1,
    score: '0',
    remarks: '',
    editCount: 0,
  } as Grade).canEditExisting;
  const eligibleStudentsForSelectedEval = getEligibleStudentsForEvaluationWithGradesUtil(currentEvaluation, currentClassStudents, gradesList);
  const selectedEvalGrades = gradesList.filter((g) => String(g.evaluationId) === selectedEvalId);
  const ineligibleStudentsForSelectedEval = currentClassStudents.filter(
    (st) => !eligibleStudentsForSelectedEval.includes(st) && !selectedEvalGrades.some((g) => g.studentId === st.id)
  );

  const displayStudentsForSelectedEval = eligibleStudentsForSelectedEval;

  const isEvaluationFullyGraded = (ev: Evaluation) =>
    isEvaluationFullyGradedUtil(ev, studentsList, gradesList);

  const openEvaluations = evaluationsList.filter((ev) => {
    if (userRole === 'teacher') {
      if (teacherId == null) return false;
      if (ev.teacherId !== teacherId) return false;
    }
    if (!selectedClassId) return false;
    if (String(ev.classId) !== selectedClassId) return false;
    return !isEvaluationFullyGraded(ev);
  });

  const selectableEvaluations = evaluationsList.filter((ev) => {
    if (userRole === 'teacher') {
      if (teacherId == null) return false;
      if (ev.teacherId !== teacherId) return false;
    }
    if (!selectedClassId) return false;
    if (String(ev.classId) !== selectedClassId) return false;
    return userRole !== 'teacher' || !isEvaluationFullyGraded(ev);
  });

  // Keep class/evaluation selection consistent when filters or available evaluations change.
  // Do not re-populate grade inputs from here to avoid wiping local typing on unrelated rerenders.
  useEffect(() => {
    if (!filteredClasses.length) {
      setSelectedClassId('');
      setSelectedEvalId('');
      setIsEditingGrades(false);
      setGradeScoreErrors({});
      setGradeInputValues({});
      return;
    }

    if (!selectedClassId) {
      const firstClassId = String(filteredClasses[0].id);
      setSelectedClassId(firstClassId);
      const firstEvalForClass = evaluationsList.find((ev) => String(ev.classId) === firstClassId);
      if (firstEvalForClass) {
        setSelectedEvalId(String(firstEvalForClass.id));
        setIsEditingGrades(false);
        setGradeScoreErrors({});
      } else {
        setSelectedEvalId('');
        setIsEditingGrades(false);
        setGradeScoreErrors({});
        setGradeInputValues({});
      }
      return;
    }

    const classEvaluations = evaluationsList.filter((ev) => String(ev.classId) === selectedClassId);
    if (classEvaluations.length === 0) {
      setSelectedEvalId('');
      setIsEditingGrades(false);
      setGradeScoreErrors({});
      setGradeInputValues({});
      return;
    }

    const nextEvalId = resolveSelectedEvaluationId({
      selectedClassId,
      selectedEvalId,
      classEvaluations,
    });

    if (selectedEvalId !== nextEvalId) {
      setSelectedEvalId(nextEvalId);
      setIsEditingGrades(false);
      setGradeScoreErrors({});
    }
  }, [filteredClasses, evaluationsList, selectedClassId, selectedEvalId]);

  const selectedEvalGradesSignature = useMemo(() => {
    if (!selectedEvalId) return '';
    return gradesList
      .filter((g) => String(g.evaluationId) === selectedEvalId)
      .map((g) => `${g.studentId}|${g.score}|${g.remarks || ''}|${g.editCount ?? 0}`)
      .sort()
      .join('::');
  }, [gradesList, selectedEvalId]);

  // Source-of-truth sync: refresh local inputs when selected eval changes
  // or when selected-eval grade content changes (not merely array reference).
  useEffect(() => {
    if (!selectedEvalId) {
      setGradeScoreErrors({});
      setGradeInputValues({});
      return;
    }
    setGradeScoreErrors({});
    populateGradeInputsForEvaluation(selectedEvalId);
  }, [selectedEvalId, selectedEvalGradesSignature]);

  const gradesForSelectedEval = gradesList.filter((g) => String(g.evaluationId) === selectedEvalId);
  const eligibleStudentsWithHistory = getEligibleStudentsForEvaluationWithGradesUtil(currentEvaluation, currentClassStudents, gradesList);
  const eligibleGradesForSelectedEval = getEligibleGradesForEvaluation(currentEvaluation, currentClassStudents, gradesList);
  const saveableStudentCount = eligibleStudentsWithHistory.filter((student) => {
    const existingGrade = gradesForSelectedEval.find((g) => g.studentId === student.id);
    const gradePermission = getGradeEditPermission(userRole, existingGrade);
    return existingGrade ? gradePermission.canEditExisting : gradePermission.canCreate;
  }).length;
  const canShowEditGradesToggle = canRoleModifyExistingGrades && !!selectedEvalId;
  const canEnterEditMode = canShowEditGradesToggle && saveableStudentCount > 0;
  const canShowSaveAllButton = !!selectedEvalId && (canShowEditGradesToggle ? isEditingGrades : userRole === 'teacher');

  const today = new Date();
  const overdueThresholdMs = 7 * 24 * 60 * 60 * 1000;
  const overdueEvaluations = evaluationsList
    .filter((ev) => {
      if (!ev.date) return false;
      const evalDate = parseDateValue(ev.date);
      if (!evalDate) return false;
      const ageMs = today.getTime() - evalDate.getTime();
      if (ageMs < overdueThresholdMs) return false;
      const classStudents = studentsList.filter((st) => st.classId === ev.classId);
      if (classStudents.length === 0) return false;

      const evaluationTimestamp = parseDateValue(ev.createdAt || ev.date);
      const eligibleStudents = classStudents.filter((st) => {
        if (!st.enrolledAt || !evaluationTimestamp) return true;
        const enrollmentDate = parseDateValue(st.enrolledAt);
        return enrollmentDate ? enrollmentDate.getTime() <= evaluationTimestamp.getTime() : true;
      });
      if (eligibleStudents.length === 0) return false;

      const eligibleStudentIds = new Set(eligibleStudents.map((st) => st.id));
      const gradesForEval = gradesList.filter(
        (g) => g.evaluationId === ev.id && eligibleStudentIds.has(g.studentId)
      );
      return gradesForEval.length < eligibleStudents.length;
    })
    .filter((ev) => userRole !== 'teacher' || (teacherId != null && ev.teacherId === teacherId));

  const overdueCount = overdueEvaluations.length;

  // Calculate averages
  const getStudentAverage = (studentId: number) => {
    let studentGrades = gradesList.filter((g) => g.studentId === studentId);
    if (userRole === 'teacher' && teacherId != null) {
      studentGrades = studentGrades.filter((g) => {
        const evaluation = evaluationsList.find((ev) => ev.id === g.evaluationId);
        return evaluation ? evaluation.teacherId === teacherId : false;
      });
    }
    if (studentGrades.length === 0) return '—';

    let totalPoints = 0;
    let totalCoefficients = 0;

    studentGrades.forEach((g) => {
      const parsedScore = parseFloat(g.score);
      if (!isNaN(parsedScore)) {
        // Find coefficient in evaluations
        const evaluation = evaluationsList.find((ev) => ev.id === g.evaluationId);
        const coeff = evaluation?.coefficient || 1;
        totalPoints += parsedScore * coeff;
        totalCoefficients += coeff;
      }
    });

    if (totalCoefficients === 0) return '—';
    return (totalPoints / totalCoefficients).toFixed(2);
  };

  const getClassAverage = () => {
    if (!selectedEvalId) return '—';
    const evalGrades = gradesList.filter((g) => String(g.evaluationId) === selectedEvalId);
    const validScores = evalGrades.map((g) => parseFloat(g.score)).filter((s) => !isNaN(s));
    
    if (validScores.length === 0) return '—';
    const sum = validScores.reduce((acc, curr) => acc + curr, 0);
    return (sum / validScores.length).toFixed(2);
  };

  return (
    <div className="space-y-6" id="notes-view">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Gestion des Notes & Évaluations</h2>
          <p className="text-sm text-slate-500">Planifiez les devoirs, saisissez les résultats et consultez les bulletins scolaires</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {canShowEditGradesToggle && (
            <button
              type="button"
              onClick={() => {
                if (isEditingGrades) {
                  setIsEditingGrades(false);
                  populateGradeInputsForEvaluation(selectedEvalId || null);
                  return;
                }
                setIsEditingGrades(true);
              }}
              disabled={!isEditingGrades && !canEnterEditMode}
              className={`flex items-center gap-2 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md transition-colors w-full sm:w-auto justify-center ${isEditingGrades ? 'bg-slate-600 hover:bg-slate-700' : 'bg-emerald-600 hover:bg-emerald-700'} ${!isEditingGrades && !canEnterEditMode ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              id="btn-toggle-edit-grades"
            >
              {isEditingGrades ? 'Annuler' : 'Modifier les notes'}
            </button>
          )}

          {['super_admin', 'school_admin', 'teacher'].includes(userRole) && (
            <button
              type="button"
              onClick={() => {
                const initialClasses = filteredClasses.length > 0 ? filteredClasses : availableClasses;
                if (initialClasses.length > 0) {
                  setNewEvalClassId(String(initialClasses[0].id));
                }
                setNewEvalSubject('');
                setNewEvalTitle('');
                setNewEvalCoefficient(1);
                setNewEvalMaxScore(20);
                setNewEvalDate(formatLocalDatetime());
                setIsNewEvalFormOpen(!isNewEvalFormOpen);
              }}
              disabled={userRole === 'teacher' && availableClasses.length === 0}
              className={`flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md transition-colors w-full sm:w-auto justify-center ${userRole === 'teacher' && availableClasses.length === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              id="btn-new-eval-trigger"
            >
              <Plus className="h-4.5 w-4.5" />
              Créer un Devoir / Évaluation
            </button>
          )}
        </div>
      </div>

      {overdueCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <HelpCircle className="h-4 w-4" />
            Alerte devoirs en retard
          </div>
          <p className="text-xs sm:text-sm text-amber-800">
            {overdueCount} devoir{overdueCount > 1 ? 's' : ''} publi{overdueCount > 1 ? 'és' : 'é'} il y a plus de 7 jours n'ont pas encore toutes les notes renseignées.
          </p>
          <div className="text-[11px] text-amber-700">
            {userRole === 'teacher'
              ? 'Veuillez compléter les notes manquantes ou demander à un administrateur de le faire pour vous.'
              : 'Les administrateurs peuvent consulter et compléter ces devoirs en retard.'}
          </div>
        </div>
      )}

      {/* NEW EVALUATION CREATION FORM */}
      {isNewEvalFormOpen && (
        <div className="bg-slate-50 border border-slate-100 p-5 rounded-2xl animate-fade-in" id="box-eval-form">
          <h3 className="font-bold text-slate-800 mb-3 text-sm sm:text-base flex items-center gap-2">
            <Calendar className="h-5 w-5 text-indigo-600" />
            Planifier une nouvelle évaluation
          </h3>
          <form onSubmit={handleCreateEvaluation} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Classe concernée</label>
              <select
                required
                value={newEvalClassId}
                onChange={(e) => setNewEvalClassId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none placeholder-slate-400"
              >
                <option value="">-- Choisissez --</option>
                {filteredClasses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Matière</label>
              <select
                required
                value={newEvalSubject}
                onChange={(e) => {
                  console.debug('NotesView: subject changed to', e.target.value);
                  setNewEvalSubject(e.target.value);
                }}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              >
                <option value="">-- Choisir une matière --</option>
                {availableSubjects.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Intitulé du devoir (ex: "DS n°3")</label>
              <input
                required
                type="text"
                value={newEvalTitle}
                onChange={(e) => setNewEvalTitle(e.target.value)}
                placeholder="ex. Devoir Surveillé Fractions"
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Coefficient</label>
              <input
                type="number"
                min="1"
                max="5"
                value={newEvalCoefficient}
                onChange={(e) => setNewEvalCoefficient(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Note maximale</label>
              <input
                type="number"
                value={newEvalMaxScore}
                onChange={(e) => setNewEvalMaxScore(parseInt(e.target.value) || 20)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Date et heure de l'évaluation</label>
              <input
                type="datetime-local"
                value={newEvalDate}
                onChange={(e) => setNewEvalDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div className="md:col-span-3 flex justify-end gap-2 p-2">
              <button
                type="button"
                onClick={() => setIsNewEvalFormOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md cursor-pointer"
              >
                Publier le Devoir
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FILTER PANEL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white p-4 border border-slate-50 rounded-2xl shadow-sm">
        {userRole === 'super_admin' && (
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Filtrer par école</label>
            <select
              value={schoolFilterId ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                if (onSchoolFilterChange) onSchoolFilterChange(value ? parseInt(value, 10) : null);
                setSelectedClassId('');
                setSelectedEvalId('');
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
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Division (Classe)</label>
          <select
            value={selectedClassId}
            onChange={(e) => {
              const nextClassId = e.target.value;
              setSelectedClassId(nextClassId);
              setIsEditingGrades(false);
              const firstEvalForClass = evaluationsList.find((ev) => String(ev.classId) === nextClassId);
              if (firstEvalForClass) {
                setSelectedEvalId(String(firstEvalForClass.id));
                populateGradeInputsForEvaluation(String(firstEvalForClass.id));
              } else {
                setSelectedEvalId('');
                setGradeInputValues({});
              }
            }}
            disabled={userRole === 'teacher' && availableClasses.length === 0}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none disabled:opacity-50"
          >
            <option value="">Sélectionner une classe</option>
            {filteredClasses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {userRole === 'teacher' && availableClasses.length === 0 && (
            <p className="mt-2 text-[11px] text-amber-600 italic">
              Vous n’avez actuellement aucune classe assignée. Contactez l’administrateur pour en ajouter.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Évaluation (Devoir de la classe)</label>
          <select
            value={selectedEvalId}
            onChange={(e) => {
              const evId = e.target.value;
              setSelectedEvalId(evId);
              setIsEditingGrades(false);
              populateGradeInputsForEvaluation(evId);
            }}
            disabled={!selectedClassId}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none disabled:opacity-50"
          >
            <option value="">-- Sélectionnez un devoir --</option>
            {selectableEvaluations.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.subject} — {ev.title} ({ev.date})
              </option>
            ))}
          </select>
        </div>
      </div>

      {saveStatus && (
        <div className="p-3 bg-emerald-50 text-emerald-700 text-xs border border-emerald-100 rounded-xl font-semibold animate-bounce">
          {saveStatus}
        </div>
      )}

      {/* MARKS RECORDING LIST */}
      <div className="bg-white border border-slate-50 rounded-2xl shadow-sm overflow-visible" id="grades-table-container">
        
        {selectedClassId ? (
          <div>
            {/* Header statistics block */}
            {selectedEvalId && (
              <div className="bg-indigo-600 p-5 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-indigo-200 uppercase tracking-wider">Statistiques du devoir</span>
                  <h4 className="text-sm sm:text-base font-bold">
                    Moyenne générale de la classe : <span className="font-mono text-lg font-black bg-white/20 px-2.5 py-1 rounded-xl text-yellow-300 ml-1">{getClassAverage()} / 20</span>
                  </h4>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 text-xs text-indigo-100">
                  <div>Total copies saisies : {eligibleGradesForSelectedEval.length} / {eligibleStudentsForSelectedEval.length}</div>
                  {canShowSaveAllButton && (
                    <button
                      type="button"
                      onClick={handleSaveAllGrades}
                      disabled={saveableStudentCount === 0}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-400 disabled:cursor-not-allowed rounded-xl text-white text-xs font-semibold transition-colors"
                    >
                      Enregistrer tout
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm text-slate-600">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4">Nom de l'Élève</th>
                    <th className="px-6 py-4">Moyenne Générale du Trimestre</th>
                    {selectedEvalId && (
                      <>
                        <th className="px-6 py-4">Note au devoir ( / {effectiveMaxScore} )</th>
                        <th className="px-6 py-4">Appréciation / Remarques</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayStudentsForSelectedEval.length > 0 ? (
                    displayStudentsForSelectedEval.map((st) => {
                      const studentAverage = getStudentAverage(st.id);
                      const isEvaluationSelected = !!selectedEvalId;
                      const existingGrade = gradesList.find(
                        (g) => String(g.evaluationId) === selectedEvalId && g.studentId === st.id
                      );
                      const gradePermission = getGradeEditPermission(userRole, existingGrade);
                      const canEditGrade = existingGrade ? gradePermission.canEditExisting : gradePermission.canCreate;
                      const isEligible = eligibleStudentsForSelectedEval.some((s) => s.id === st.id);
                      const scoreError = gradeScoreErrors[st.id];

                    return (
                      <tr key={st.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4 font-bold text-slate-800">{st.firstName} {st.lastName}</td>
                        <td className="px-6 py-4 font-bold text-slate-700">
                          <span className="bg-slate-100 px-2.5 py-1 rounded-lg text-xs">
                            {studentAverage} / 20
                          </span>
                        </td>

                        {/* If evaluation is selected, show edit inputs */}
                        {isEvaluationSelected && (
                          <>
                            <td className="px-6 py-4">
                              {['super_admin', 'school_admin', 'teacher'].includes(userRole) ? (
                                existingGrade && userRole === 'teacher' ? (
                                  <div className="text-xs space-y-1">
                                    <div className="font-mono font-bold text-indigo-700">{existingGrade.score} / 20</div>
                                    <div className="text-slate-400 text-[10px]">Note déjà enregistrée</div>
                                  </div>
                                ) : isEligible ? (
                                    <div className="space-y-1">
                                      <input
                                        type="text"
                                        value={gradeInputValues[st.id]?.score || ''}
                                        onChange={(e) => {
                                          const sanitized = sanitizeScoreInput(e.target.value);
                                          if (sanitized == null) {
                                            setGradeScoreErrors((prev) => ({
                                              ...prev,
                                              [st.id]: 'Seuls les chiffres et un seul séparateur decimal (. ou ,) sont autorises.',
                                            }));
                                            return;
                                          }

                                          const check = validateAndNormalizeScore(sanitized, effectiveMaxScore);
                                          if (sanitized !== '' && !check.isValid) {
                                            setGradeScoreErrors((prev) => ({
                                              ...prev,
                                              [st.id]: check.message || 'Note invalide.',
                                            }));
                                          } else {
                                            setGradeScoreErrors((prev) => {
                                              const next = { ...prev };
                                              delete next[st.id];
                                              return next;
                                            });
                                          }

                                          updateGradeInput(st.id, { score: sanitized });
                                        }}
                                        onPaste={(e) => handleScorePaste(st.id, e)}
                                        readOnly={(canShowEditGradesToggle && !isEditingGrades) || !canEditGrade}
                                        inputMode="decimal"
                                        placeholder="ex. 12.5"
                                        className={`w-24 px-2.5 py-1.5 bg-slate-50 border text-xs sm:text-sm rounded-lg text-center font-bold text-slate-800 read-only:bg-slate-200 read-only:text-slate-500 read-only:cursor-not-allowed ${scoreError ? 'border-rose-400 focus:outline-rose-500' : 'border-slate-200 focus:outline-indigo-500'}`}
                                      />
                                      {scoreError && (
                                        <div className="text-[10px] text-rose-600 max-w-[11rem] leading-tight">
                                          {scoreError}
                                        </div>
                                      )}
                                      {((canShowEditGradesToggle ? isEditingGrades : true) && canEditGrade) && (
                                        <div className="text-[10px] text-slate-400">
                                          Valeur attendue : 0 a {effectiveMaxScore} (decimales autorisees, ex. 12.5 ou 12,5)
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-left text-xs text-amber-800 font-semibold">
                                      Non éligible<br />(inscrit après le devoir)
                                    </div>
                                  )
                              ) : (
                                <span className="font-mono text-xs font-extrabold text-indigo-700">
                                  {gradeInputValues[st.id]?.score || '—'} / 20
                                </span>
                              )}
                            </td>

                            <td className="px-6 py-4">
                              {['super_admin', 'school_admin', 'teacher'].includes(userRole) ? (
                                existingGrade && userRole === 'teacher' ? (
                                  <div className="text-xs text-slate-500 italic">Remarque enregistrée</div>
                                ) : isEligible ? (
                                  <input
                                    type="text"
                                    value={gradeInputValues[st.id]?.remarks || ''}
                                    onChange={(e) => {
                                      updateGradeInput(st.id, { remarks: e.target.value });
                                    }}
                                    readOnly={(canShowEditGradesToggle && !isEditingGrades) || !canEditGrade}
                                    placeholder="Entrez vos remarques..."
                                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 text-xs rounded-lg focus:outline-indigo-500 text-slate-700 read-only:bg-slate-200 read-only:text-slate-500 read-only:cursor-not-allowed"
                                  />
                                ) : (
                                  <span className="text-xs text-slate-500 italic">Aucune saisie requise</span>
                                )
                              ) : (
                                <span className="text-xs text-slate-500 italic">
                                  {gradeInputValues[st.id]?.remarks || 'Pas d’observation rédigée.'}
                                </span>
                              )}
                            </td>

                          </>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-400 text-sm">
                      Sélectionnez un devoir pour afficher les notes
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
              
              {/* Ineligible students notice */}
              {selectedEvalId && ineligibleStudentsForSelectedEval.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-900 mb-2">
                    ⚠️ {ineligibleStudentsForSelectedEval.length} élève(s) non éligible(s) pour cette évaluation (inscrit(s) après la date du devoir)
                  </p>
                  <div className="text-xs text-amber-800 space-y-1">
                    {ineligibleStudentsForSelectedEval.map((student) => (
                      <div key={student.id} className="flex justify-between">
                        <span>{student.firstName} {student.lastName}</span>
                        <span className="text-amber-700 font-mono">
                          Inscrit le {student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString('fr-FR') : 'date inconnue'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 text-xs space-y-2">
            <Calculator className="h-10 w-10 mx-auto text-slate-300" />
            <p>Veuillez sélectionner une division (une classe) ci-dessus pour afficher le carnet de notes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
