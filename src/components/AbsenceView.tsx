import React, { useState, useRef } from 'react';
import { Absence, Student, Class, Teacher, UserRole } from '../types.ts';
import { sortClasses } from '../lib/classOrdering';
import { Clock, Plus, Filter, CalendarCheck, ShieldAlert, CheckSquare, Search, FileSymlink, Tag, Download } from 'lucide-react';
import { downloadAbsenceJustification } from '../lib/api.ts';
import CustomDropdown from './CustomDropdown';
import RequiredLabel from './RequiredLabel';
import ModalSurface from './ModalSurface';

interface AbsenceViewProps {
  userRole: UserRole;
  absencesList: Absence[];
  studentsList: Student[];
  classesList: Class[];
  schoolsList: { id: number; name: string }[];
  teachersList: Teacher[];
  approvedSubjectsList: { id: number; name: string }[];
  teacherClassIds?: number[];
  teacherSpecializations?: string[];
  onAddAbsence: (data: { studentId: number; classId: number; date: string; subjectId?: number; startTime: string; endTime: string; isJustified: boolean }) => Promise<void>;
  onJustifyAbsence: (id: number, reason: string, files?: File[] | File | null) => void;
}

export default function AbsenceView({
  userRole,
  absencesList,
  studentsList,
  classesList,
  schoolsList,
  teachersList,
  approvedSubjectsList,
  teacherClassIds,
  teacherSpecializations,
  onAddAbsence,
  onJustifyAbsence,
}: AbsenceViewProps) {
  const sortedClasses = sortClasses(classesList || []);
  const sortedStudents = (studentsList || []).slice().sort((a, b) => {
    // Compare by last name, then first name, then class name
    const last = (a.lastName || '').toLowerCase();
    const lastB = (b.lastName || '').toLowerCase();
    if (last !== lastB) return last.localeCompare(lastB);
    const first = (a.firstName || '').toLowerCase();
    const firstB = (b.firstName || '').toLowerCase();
    if (first !== firstB) return first.localeCompare(firstB);
    const classA = (a.className || '').toLowerCase();
    const classB = (b.className || '').toLowerCase();
    return classA.localeCompare(classB);
  });
  const [filterClass, setFilterClass] = useState('');
  const [filterSchool, setFilterSchool] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showJustifyModal, setShowJustifyModal] = useState<Absence | null>(null);
  const [justificationText, setJustificationText] = useState('');
  const [selectedJustificationFiles, setSelectedJustificationFiles] = useState<File[]>([]);
  const [justificationUploadError, setJustificationUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const MAX_JUSTIFICATION_FILES = 5;
  const MAX_JUSTIFICATION_FILE_SIZE = 5 * 1024 * 1024;
  const allowedJustificationTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

  const resetJustificationForm = () => {
    setJustificationText('');
    setSelectedJustificationFiles([]);
    setJustificationUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const appendJustificationFiles = (incomingFiles: File[]) => {
    const validFiles: File[] = [];
    const errors: string[] = [];

    incomingFiles.forEach((file) => {
      if (!allowedJustificationTypes.has(file.type)) {
        errors.push(`${file.name}: format interdit. Seuls PDF, JPG et PNG sont acceptés.`);
        return;
      }

      if (file.size > MAX_JUSTIFICATION_FILE_SIZE) {
        errors.push(`${file.name}: dépasse 5 Mo.`);
        return;
      }

      validFiles.push(file);
    });

    if (selectedJustificationFiles.length + validFiles.length > MAX_JUSTIFICATION_FILES) {
      const remainingSlots = MAX_JUSTIFICATION_FILES - selectedJustificationFiles.length;
      if (remainingSlots <= 0) {
        errors.push(`Vous avez déjà atteint la limite de ${MAX_JUSTIFICATION_FILES} fichiers.`);
      } else {
        errors.push(`Vous pouvez ajouter jusqu'à ${remainingSlots} fichier(s) supplémentaire(s).`);
      }
    }

    if (errors.length > 0) {
      setJustificationUploadError(errors.join(' '));
    } else {
      setJustificationUploadError(null);
    }

    const mergedFiles = [...selectedJustificationFiles, ...validFiles].slice(0, MAX_JUSTIFICATION_FILES);
    setSelectedJustificationFiles(mergedFiles);
  };

  const handleJustificationInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    appendJustificationFiles(files);
    event.target.value = '';
  };

  // Form State
  const [newAbsenceForm, setNewAbsenceForm] = useState({
    studentId: '',
    classId: '',
    lastName: '',
    firstName: '',
    date: new Date().toISOString().split('T')[0],
    subjectId: '' as string,
    startTime: '08:00',
    endTime: '09:30',
  });
  const [selectedAbsentStudentIds, setSelectedAbsentStudentIds] = useState<string[]>([]);
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [isMultipleSaveInProgress, setIsMultipleSaveInProgress] = useState(false);

  const studentsInSelectedClass = newAbsenceForm.classId
    ? sortedStudents.filter((st) => String(st.classId) === newAbsenceForm.classId)
    : [];
  const filteredStudentsInClass = studentSearchQuery.trim()
    ? studentsInSelectedClass.filter((st) => {
        const query = studentSearchQuery.trim().toLowerCase();
        const lastName = (st.lastName || '').toLowerCase();
        const firstName = (st.firstName || '').toLowerCase();
        const fullName = `${lastName} ${firstName}`.trim();
        return lastName.includes(query) || firstName.includes(query) || fullName.includes(query);
      })
    : studentsInSelectedClass;

  const availableLastNames = Array.from(
    new Set(studentsInSelectedClass.map((st) => st.lastName || ''))
  ).sort((a, b) => a.localeCompare(b));

  const studentsWithSelectedLastName = newAbsenceForm.lastName
    ? studentsInSelectedClass.filter((st) => st.lastName === newAbsenceForm.lastName)
    : [];

  const availableFirstNames = Array.from(
    new Set(studentsWithSelectedLastName.map((st) => st.firstName || ''))
  ).sort((a, b) => a.localeCompare(b));

  const filteredStudentsByName = newAbsenceForm.lastName && newAbsenceForm.firstName
    ? studentsWithSelectedLastName.filter((st) => st.firstName === newAbsenceForm.firstName)
    : [];

  const normalizeSubjectName = (value: string) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9 ]+/g, '')
      .replace(/\s+/g, ' ');

  const selectedClassIdNumber = newAbsenceForm.classId ? Number(newAbsenceForm.classId) : null;
  const selectedClassTeachers = teachersList.filter((teacher) =>
    Array.isArray(teacher.classIds) && selectedClassIdNumber != null && teacher.classIds.includes(selectedClassIdNumber)
  );

  const classTeacherSubjectNames = Array.from(new Set(
    selectedClassTeachers.flatMap((teacher) => {
      const specializations = Array.isArray(teacher.specialization)
        ? teacher.specialization
        : String(teacher.specialization || '').split(/[,;&|\/\+]/).map((value) => value.trim()).filter(Boolean);
      return specializations;
    })
  ));

  const effectiveTeacherSubjectNames = userRole === 'teacher' && selectedClassIdNumber !== null && teacherClassIds?.includes(selectedClassIdNumber)
    ? teacherSpecializations || classTeacherSubjectNames
    : classTeacherSubjectNames;

  const availableSubjects = (approvedSubjectsList || []).filter((subject) => {
    return effectiveTeacherSubjectNames.some((name) => normalizeSubjectName(name) === normalizeSubjectName(subject.name));
  });

  const handleCreateAbsence = (e: React.FormEvent) => {
    e.preventDefault();
    const student = studentsList.find((s) => s.id === parseInt(newAbsenceForm.studentId));
    if (!student) return;

    onAddAbsence({
      studentId: student.id,
      classId: student.classId,
      date: newAbsenceForm.date,
      subjectId: newAbsenceForm.subjectId ? Number(newAbsenceForm.subjectId) : undefined,
      startTime: newAbsenceForm.startTime,
      endTime: newAbsenceForm.endTime,
      isJustified: false,
    });

    setIsFormOpen(false);
    setNewAbsenceForm({
      studentId: '',
      classId: '',
      lastName: '',
      firstName: '',
      date: new Date().toISOString().split('T')[0],
      subjectId: '',
      startTime: '08:00',
      endTime: '09:30',
    });
  };

  const handleCreateMultipleAbsences = async () => {
    if (selectedAbsentStudentIds.length === 0 || !newAbsenceForm.classId || isMultipleSaveInProgress) return;

    setIsMultipleSaveInProgress(true);
    try {
      const studentIdsToCreate = selectedAbsentStudentIds.map((id) => parseInt(id, 10));
      for (const studentId of studentIdsToCreate) {
        const student = studentsList.find((s) => s.id === studentId);
        if (!student) continue;

        await onAddAbsence({
          studentId: student.id,
          classId: student.classId,
          date: newAbsenceForm.date,
          subjectId: newAbsenceForm.subjectId ? Number(newAbsenceForm.subjectId) : undefined,
          startTime: newAbsenceForm.startTime,
          endTime: newAbsenceForm.endTime,
          isJustified: false,
        });
      }

      setIsFormOpen(false);
      setNewAbsenceForm({
        studentId: '',
        classId: '',
        lastName: '',
        firstName: '',
        date: new Date().toISOString().split('T')[0],
        subjectId: '',
        startTime: '08:00',
        endTime: '09:30',
      });
      setSelectedAbsentStudentIds([]);
    } finally {
      setIsMultipleSaveInProgress(false);
    }
  };

  const handleJustifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showJustifyModal) return;
    onJustifyAbsence(showJustifyModal.id, justificationText, selectedJustificationFiles);
    setShowJustifyModal(null);
    resetJustificationForm();
  };

  const isClassInSelectedSchool = (klass: Class, schoolId: string) => {
    if (String(klass.schoolId ?? '') === schoolId) return true;
    if (klass.schoolId != null) return false;

    return studentsList.some((student) => (
      student.classId === klass.id && String(student.schoolId) === schoolId
    ));
  };

  // Filter absences
  const subjectOptions = Array.from(
    new Set(absencesList.map((abs) => abs.subjectName || '').filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const dateOptions = Array.from(
    new Set(absencesList.map((abs) => abs.date || '').filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const filteredAbsences = absencesList.filter((abs) => {
    if (filterSchool) {
      const cls = classesList.find((c) => c.id === abs.classId);
      if (!cls || !isClassInSelectedSchool(cls, filterSchool)) return false;
    }
    if (filterClass && String(abs.classId) !== filterClass) return false;

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      const studentName = String(abs.studentName || '').toLowerCase();
      const className = String(abs.className || '').toLowerCase();

      if (
        !studentName.includes(query) &&
        !className.includes(query)
      ) {
        return false;
      }
    }

    if (filterSubject && String(abs.subjectName || '') !== filterSubject) {
      return false;
    }

    if (filterDate && String(abs.date || '') !== filterDate) {
      return false;
    }

    return true;
  });

  return (
    <div className="space-y-6" id="absence-view">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Suivi & Registre des Absences</h2>
          <p className="text-sm text-slate-500">Contrôle des absences des élèves et examen des motifs justificatifs fournis par les parents</p>
        </div>

        {/* Teachers and admins can take attendance */}
        {['super_admin', 'school_admin', 'teacher'].includes(userRole) && (
          <button
            onClick={() => {
              if (sortedStudents.length > 0) {
                setNewAbsenceForm((prev) => ({
                  ...prev,
                  studentId: String(sortedStudents[0].id),
                  classId: String(sortedStudents[0].classId),
                }));
              }
              setIsFormOpen(!isFormOpen);
            }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md transition-colors cursor-pointer w-full sm:w-auto justify-center"
            id="btn-absence-open-form"
          >
            <Plus className="h-4.5 w-4.5" />
            Signaler une absence
          </button>
        )}
      </div>

      {/* New Absence Registry form */}
      {isFormOpen && (
        <div className="bg-slate-50 border border-slate-100 p-5 rounded-2xl animate-fade-in" id="box-absence-form">
          <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2 text-sm sm:text-base">
            <CheckSquare className="h-5 w-5 text-indigo-600" />
            Enregistrer une absence pour un élève
          </h3>
          <form onSubmit={handleCreateAbsence} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                <RequiredLabel label="Sélectionner la Classe" required />
              </label>
              <CustomDropdown
                options={[{ value: '', label: '-- Choisissez une classe --' }, ...sortedClasses.map((cl) => ({ value: String(cl.id), label: cl.name }))]}
                value={newAbsenceForm.classId}
                onChange={(v) => {
                  setNewAbsenceForm((prev) => ({ ...prev, classId: v, lastName: '', firstName: '', studentId: '' }));
                  setSelectedAbsentStudentIds([]);
                }}
                placeholder="-- Choisissez une classe --"
                required
                className=""
              />
            </div>
            {newAbsenceForm.classId && studentsInSelectedClass.length > 0 && (
              <div className="md:col-span-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Sélection multiple des élèves
                </label>
                <div className="mb-3">
                  <input
                    type="search"
                    value={studentSearchQuery}
                    onChange={(e) => setStudentSearchQuery(e.target.value)}
                    placeholder="Rechercher un élève..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-2xl bg-white text-xs sm:text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-2xl bg-white p-3 space-y-2">
                  {filteredStudentsInClass.map((st) => (
                    <label key={st.id} className="flex items-center gap-2 text-slate-700 text-xs sm:text-sm">
                      <input
                        type="checkbox"
                        checked={selectedAbsentStudentIds.includes(String(st.id))}
                        onChange={(e) => {
                          const id = String(st.id);
                          setSelectedAbsentStudentIds((prev) =>
                            e.target.checked ? [...prev, id] : prev.filter((selectedId) => selectedId !== id)
                          );
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{st.lastName?.toUpperCase()} {st.firstName}</span>
                    </label>
                  ))}
                  {filteredStudentsInClass.length === 0 && (
                    <p className="text-slate-500 text-xs">Aucun élève ne correspond à la recherche.</p>
                  )}
                </div>
                <p className="text-slate-500 text-[11px] mt-2">
                  Sélectionnez plusieurs élèves pour préparer un appel de classe. Le flux actuel de saisie individuelle reste disponible.
                </p>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                <RequiredLabel label="Sélectionner le Nom" required />
              </label>
              <select
                required
                disabled={!newAbsenceForm.classId}
                value={newAbsenceForm.lastName}
                onChange={(e) => {
                  const lastName = e.target.value;
                  setNewAbsenceForm((prev) => ({
                    ...prev,
                    lastName,
                    firstName: '',
                    studentId: '',
                  }));
                }}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              >
                <option value="">-- Choisissez un nom --</option>
                {availableLastNames.map((name) => (
                  <option key={name} value={name}>{name.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                <RequiredLabel label="Sélectionner le Prénom" required />
              </label>
              <select
                required
                disabled={!newAbsenceForm.lastName}
                value={newAbsenceForm.firstName}
                onChange={(e) => {
                  const firstName = e.target.value;
                  const selectedStudent = studentsWithSelectedLastName.find((st) => st.firstName === firstName);
                  setNewAbsenceForm((prev) => ({
                    ...prev,
                    firstName,
                    studentId: selectedStudent ? String(selectedStudent.id) : '',
                  }));
                }}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              >
                <option value="">-- Choisissez un prénom --</option>
                {availableFirstNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                <RequiredLabel label="Sélectionner l'Élève" required />
              </label>
              <select
                required
                disabled={!newAbsenceForm.firstName}
                value={newAbsenceForm.studentId}
                onChange={(e) => {
                  const sId = e.target.value;
                  setNewAbsenceForm((prev) => ({
                    ...prev,
                    studentId: sId,
                  }));
                }}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              >
                <option value="">-- Choisissez un élève --</option>
                {filteredStudentsByName.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.lastName?.toUpperCase()} {st.firstName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                <RequiredLabel label="Date d'Absence" required />
              </label>
              <input
                required
                type="date"
                value={newAbsenceForm.date}
                onChange={(e) => setNewAbsenceForm({ ...newAbsenceForm, date: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                <RequiredLabel label="Matières concernées" required />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 border border-slate-200 rounded-2xl bg-white max-h-56 overflow-y-auto">
                {availableSubjects.length > 0 ? availableSubjects.map((subject) => (
                  <label key={subject.id} className="flex items-center gap-2 text-slate-700 text-xs sm:text-sm">
                    <input
                      type="radio"
                      name="absence-subject"
                      value={String(subject.id)}
                      checked={newAbsenceForm.subjectId === String(subject.id)}
                      onChange={() => {
                        const subjectId = String(subject.id);
                        setNewAbsenceForm((prev) => ({ ...prev, subjectId }));
                      }}
                      required
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>{subject.name}</span>
                  </label>
                )) : (
                  <div className="text-slate-500 text-xs sm:text-sm">
                    Aucune matière attribuée pour cette classe et cet enseignant.
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                <RequiredLabel label="Heure de début" required />
              </label>
              <input
                required
                type="time"
                value={newAbsenceForm.startTime}
                onChange={(e) => setNewAbsenceForm({ ...newAbsenceForm, startTime: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                <RequiredLabel label="Heure de fin" required />
              </label>
              <input
                required
                type="time"
                value={newAbsenceForm.endTime}
                onChange={(e) => setNewAbsenceForm({ ...newAbsenceForm, endTime: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              />
            </div>
            <div className="flex gap-2 flex-col sm:flex-row">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-md transition-colors cursor-pointer"
                id="btn-absence-submit"
              >
                Enregistrer
              </button>
              <button
                type="button"
                onClick={handleCreateMultipleAbsences}
                disabled={selectedAbsentStudentIds.length === 0 || isMultipleSaveInProgress}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs sm:text-sm rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                id="btn-absence-submit-multiple"
              >
                {isMultipleSaveInProgress ? 'Enregistrement en cours…' : 'Enregistrer les absences sélectionnées'}
              </button>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-medium cursor-pointer"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FILTER CONTROLS */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 border border-slate-50 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-indigo-500" />
          <span className="text-xs sm:text-sm font-bold text-slate-700">Filtrer l'historique :</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={filterSchool}
            onChange={(e) => { setFilterSchool(e.target.value); setFilterClass(''); }}
            className="px-3 py-1.5 bg-slate-50 border border-slate-100 text-xs rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">Toutes les écoles</option>
            {/** schoolsList passed from parent */}
            {/** @ts-ignore - simple id/name shape */}
            {/** render schoolsList below */}
            { (schoolsList || []).map((s: any) => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
            ))}
          </select>
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-100 text-xs rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">Toutes les classes</option>
            {sortedClasses
              .filter((c) => !filterSchool || isClassInSelectedSchool(c, filterSchool))
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un élève..."
            className="px-3 py-1.5 bg-slate-50 border border-slate-100 text-xs rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-100 text-xs rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">Toutes les matières</option>
            {subjectOptions.map((subject) => (
              <option key={subject} value={subject}>{subject}</option>
            ))}
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-100 text-xs rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
        </div>
      </div>

      {/* ABSENCES LIST */}
      <div className="bg-white border border-slate-50 rounded-2xl shadow-sm overflow-visible" id="absences-table-container">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
              <tr>
                <th className="px-6 py-4">Élève</th>
                <th className="px-6 py-4">Classe</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Horaires</th>
                <th className="px-6 py-4">Matière</th>
                <th className="px-6 py-4">Statut de justification</th>
                <th className="px-6 py-4">Motif justificatif</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAbsences.map((abs) => (
                <tr key={abs.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-800">{abs.studentName}</td>
                  <td className="px-6 py-4 text-slate-500 font-semibold">{abs.className}</td>
                  <td className="px-6 py-4 text-slate-600">
                    <span className="font-mono text-xs">{abs.date}</span> (
                    <span className="font-semibold capitalize text-indigo-600">
                      {abs.period === 'morning' ? 'matin' : abs.period === 'afternoon' ? 'après-midi' : 'journée'}
                    </span>
                    )
                  </td>
                  <td className="px-6 py-4 text-slate-600 font-mono text-xs">
                    {abs.startTime && abs.endTime ? `${abs.startTime} - ${abs.endTime}` : '—'}
                  </td>
                  <td className="px-6 py-4 text-slate-600 font-medium">
                    {abs.subjectName || 'Non précisée'}
                  </td>
                  <td className="px-6 py-4">
                    {abs.isJustified ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-100">
                        Justifiée
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 text-xs font-bold rounded-full border border-rose-100">
                        Injustifiée
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-slate-700 text-sm max-w-xs whitespace-normal break-words space-y-1">
                    <div className="font-bold">
  {abs.justificationReason || '— En attente de motif de l\'enfant...'}
</div>
                    {abs.justificationFileName ? (
                      <div className="text-[10px] text-slate-400 whitespace-normal break-words">
                        Fichier justificatif : <span className="font-semibold text-slate-700">{abs.justificationFileName}</span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {/* Only specific roles or Parent themselves can justify absences */}
                    {abs.justificationFileName ? (
                    <button
                      onClick={async () => {
                        try {
                          const blob = await downloadAbsenceJustification(abs.id);
                          const url = URL.createObjectURL(blob);
                          const anchor = document.createElement('a');
                          anchor.href = url;
                          anchor.download = abs.justificationFileName || 'justification';
                          anchor.click();
                          URL.revokeObjectURL(url);
                        } catch (error) {
                          console.error('Impossible de télécharger le justificatif', error);
                        }
                      }}
                      className="p-1.5 px-3 bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100/80 rounded-lg text-xs font-bold transition-all cursor-pointer mr-2"
                    >
                      <Download className="inline-block h-3.5 w-3.5 mr-1 align-text-bottom" />
                      Télécharger
                    </button>
                  ) : null}
                  {!abs.isJustified && (userRole === 'parent' || userRole === 'super_admin' || userRole === 'school_admin') && (
                    <button
                      onClick={() => {
                        setShowJustifyModal(abs);
                      }}
                      className="p-1.5 px-3 bg-indigo-50 border border-indigo-100 text-indigo-600 hover:bg-indigo-100/80 rounded-lg text-xs font-bold transition-all cursor-pointer"
                      id={`btn-abs-justify-${abs.id}`}
                    >
                      Justifier
                    </button>
                  )}
                  </td>
                </tr>
              ))}
              {filteredAbsences.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-slate-400 text-xs">Aucune absence recensée correspondant à vos critères.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* JUSTIFICATION MODAL */}
      {showJustifyModal && (
        <ModalSurface
          isOpen={!!showJustifyModal}
          onClose={() => setShowJustifyModal(null)}
          ariaLabel="Justifier l'absence"
          contentClassName="bg-white rounded-2xl w-full max-w-md max-h-[90vh] shadow-2xl overflow-hidden border border-slate-100"
          overlayClassName="bg-slate-900/50 backdrop-blur-sm"
        >
          <div className="bg-indigo-600 px-6 py-5 text-white flex justify-between items-center">
            <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
              <FileSymlink className="h-5 w-5" />
              Justifier l'absence de {showJustifyModal.studentName}
            </h3>
            <button onClick={() => setShowJustifyModal(null)} className="text-white hover:text-white text-xs font-bold cursor-pointer">✕</button>
          </div>

          <form onSubmit={handleJustifySubmit} className="flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-6 space-y-4">
              <div className="bg-slate-50 p-3.5 rounded-xl text-xs space-y-1">
                <p className="text-slate-500">Détails de l'absence :</p>
                <p className="font-bold text-slate-800">Date : {showJustifyModal.date} ({showJustifyModal.period})</p>
                <p className="font-bold text-slate-800">Classe : {showJustifyModal.className}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <RequiredLabel label="Motif de l'absence" required />
                </label>
                <textarea
                  required
                  rows={3}
                  value={justificationText}
                  onChange={(e) => setJustificationText(e.target.value)}
                  placeholder="ex: Maladie (grippe), rendez-vous médical urgent chez l'orthodontiste, etc."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-indigo-500 placeholder-slate-400 text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Charger un document justificatif (certificat médical / optionnel)</label>
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center hover:bg-slate-50/50 transition-colors cursor-pointer relative">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,image/jpeg,image/png"
                    multiple
                    onChange={handleJustificationInputChange}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-600">Glissez-déposez ou cliquez pour téléverser</p>
                    <p className="text-[10px] text-slate-400">PDF, PNG, JPG — jusqu'à {MAX_JUSTIFICATION_FILES} fichiers — 5 Mo maximum par fichier</p>
                  </div>
                </div>

                {selectedJustificationFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {selectedJustificationFiles.map((file, index) => (
                      <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{file.name}</div>
                          <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] opacity-80">
                            <span>{file.type || 'inconnu'}</span>
                            <span>•</span>
                            <span>{formatFileSize(file.size)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedJustificationFiles((previousFiles) => previousFiles.filter((_, fileIndex) => fileIndex !== index))}
                          className="shrink-0 font-semibold underline underline-offset-2"
                        >
                          Supprimer
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {justificationUploadError && (
                  <p className="mt-2 text-xs font-semibold text-rose-600">{justificationUploadError}</p>
                )}
              </div>
            </div>

            <div className="flex-none z-20 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-6 py-4 flex flex-col sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowJustifyModal(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md cursor-pointer"
                id="btn-confirm-justify"
              >
                Valider la justification
              </button>
            </div>
          </form>
        </ModalSurface>
      )}
    </div>
  );
}
