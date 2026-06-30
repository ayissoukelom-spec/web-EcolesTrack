import React, { useState } from 'react';
import { Absence, Student, Class, UserRole } from '../types.ts';
import { sortClasses } from '../lib/classOrdering';
import { Clock, Plus, Filter, CalendarCheck, ShieldAlert, CheckSquare, Search, FileSymlink, Tag } from 'lucide-react';
import CustomDropdown from './CustomDropdown';
import RequiredLabel from './RequiredLabel';
import ModalOverlay from './ModalOverlay';

interface AbsenceViewProps {
  userRole: UserRole;
  absencesList: Absence[];
  studentsList: Student[];
  classesList: Class[];
  schoolsList: { id: number; name: string }[];
  onAddAbsence: (data: { studentId: number; classId: number; date: string; period: string; isJustified: boolean }) => void;
  onJustifyAbsence: (id: number, reason: string) => void;
}

export default function AbsenceView({
  userRole,
  absencesList,
  studentsList,
  classesList,
  schoolsList,
  onAddAbsence,
  onJustifyAbsence,
}: AbsenceViewProps) {
  const safeClassesList = (Array.isArray(classesList) ? classesList : []).filter((item): item is Class => Boolean(item));
  const safeStudentsList = (Array.isArray(studentsList) ? studentsList : []).filter((item): item is Student => Boolean(item));
  const safeAbsencesList = (Array.isArray(absencesList) ? absencesList : []).filter((item): item is Absence => Boolean(item));
  const sortedClasses = sortClasses(safeClassesList);
  const sortedStudents = safeStudentsList.slice().sort((a, b) => {
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
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showJustifyModal, setShowJustifyModal] = useState<Absence | null>(null);
  const [justificationText, setJustificationText] = useState('');
  const [uploadMockFile, setUploadMockFile] = useState<File | null>(null);

  // Form State
  const [newAbsenceForm, setNewAbsenceForm] = useState({
    studentId: '',
    classId: '',
    lastName: '',
    firstName: '',
    date: new Date().toISOString().split('T')[0],
    period: 'morning',
  });

  const studentsInSelectedClass = newAbsenceForm.classId
    ? sortedStudents.filter((st) => String(st.classId) === newAbsenceForm.classId)
    : [];

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

  const handleCreateAbsence = (e: React.FormEvent) => {
    e.preventDefault();
    const student = safeStudentsList.find((s) => s.id === parseInt(newAbsenceForm.studentId));
    if (!student) return;

    onAddAbsence({
      studentId: student.id,
      classId: student.classId,
      date: newAbsenceForm.date,
      period: newAbsenceForm.period,
      isJustified: false,
    });
    
    setIsFormOpen(false);
    setNewAbsenceForm({
      studentId: '',
      classId: '',
      lastName: '',
      firstName: '',
      date: new Date().toISOString().split('T')[0],
      period: 'morning',
    });
  };

  const handleJustifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showJustifyModal) return;
    onJustifyAbsence(showJustifyModal.id, justificationText);
    setShowJustifyModal(null);
    setJustificationText('');
    setUploadMockFile(null);
  };

  // Filter absences
  const filteredAbsences = safeAbsencesList.filter((abs) => {
    if (filterSchool) {
      const cls = safeClassesList.find((c) => c.id === abs?.classId);
      if (!cls || String((cls as any).schoolId) !== filterSchool) return false;
    }
    if (filterClass && String(abs?.classId) !== filterClass) return false;
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
                onChange={(v) => setNewAbsenceForm((prev) => ({ ...prev, classId: v, lastName: '', firstName: '', studentId: '' }))}
                placeholder="-- Choisissez une classe --"
                required
                className=""
              />
            </div>
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
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Période du manquement</label>
              <select
                value={newAbsenceForm.period}
                onChange={(e) => setNewAbsenceForm({ ...newAbsenceForm, period: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
              >
                <option value="morning">Matinée (morning)</option>
                <option value="afternoon">Après-midi (afternoon)</option>
                <option value="all_day">Toute la Journée (all_day)</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-md transition-colors cursor-pointer"
                id="btn-absence-submit"
              >
                Enregistrer
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
        <div className="flex gap-2">
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
              .filter((c) => !filterSchool || String((c as any).schoolId) === filterSchool)
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
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
                <th className="px-6 py-4">Date & Période</th>
                <th className="px-6 py-4">Statut de justification</th>
                <th className="px-6 py-4">Motif justificatif</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAbsences.map((abs) => (
                <tr key={abs?.id ?? `absence-${Math.random()}`} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-800">{abs?.studentName || '—'}</td>
                  <td className="px-6 py-4 text-slate-500 font-semibold">{abs?.className || '—'}</td>
                  <td className="px-6 py-4 text-slate-600">
                    <span className="font-mono text-xs">{abs?.date || '—'}</span> (
                    <span className="font-semibold capitalize text-indigo-600">
                      {abs?.period === 'morning' ? 'matin' : abs?.period === 'afternoon' ? 'après-midi' : 'journée'}
                    </span>
                    )
                  </td>
                  <td className="px-6 py-4">
                    {abs?.isJustified ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-100">
                        Justifiée
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 text-xs font-bold rounded-full border border-rose-100">
                        Injustifiée
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-slate-500 italic max-w-xs truncate text-xs">
                    {abs?.justificationReason || '— En attente de motif de l\'enfant...'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {/* Only specific roles or Parent themselves can justify absences */}
                    {!abs?.isJustified && (userRole === 'parent' || userRole === 'super_admin' || userRole === 'school_admin') && (
                      <button
                        onClick={() => {
                          if (abs) {
                            setShowJustifyModal(abs);
                          }
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
                  <td colSpan={6} className="text-center py-8 text-slate-400 text-xs">Aucune absence recensée correspondant à vos critères.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* JUSTIFICATION MODAL */}
      <ModalOverlay isOpen={Boolean(showJustifyModal)} onClose={() => setShowJustifyModal(null)} backdropClassName="bg-slate-900/50 backdrop-blur-sm" contentClassName="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
          <div className="bg-indigo-600 px-6 py-5 text-white flex justify-between items-center">
              <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
                <FileSymlink className="h-5 w-5" />
                Justifier l'absence de {showJustifyModal?.studentName || 'l’élève'}
              </h3>
              <button onClick={() => setShowJustifyModal(null)} className="text-white hover:text-white text-xs font-bold cursor-pointer">✕</button>
            </div>
            
            <form onSubmit={handleJustifySubmit} className="p-6 space-y-4">
              <div className="bg-slate-50 p-3.5 rounded-xl text-xs space-y-1">
                <p className="text-slate-500">Détails de l'absence :</p>
                <p className="font-bold text-slate-800">Date : {showJustifyModal?.date || '—'} ({showJustifyModal?.period || '—'})</p>
                <p className="font-bold text-slate-800">Classe : {showJustifyModal?.className || '—'}</p>
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

              {/* Usability patterns: file upload requirements */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Charger un document justificatif (certificat médical / optionnel)</label>
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center hover:bg-slate-50/50 transition-colors cursor-pointer relative">
                  <input
                    type="file"
                    onChange={(e) => setUploadMockFile(e.target.files?.[0] || null)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-600">Glissez-déposez ou cliquez pour téléverser</p>
                    <p className="text-[10px] text-slate-400">PDF, PNG, JPG jusqu'à 5 Mo</p>
                  </div>
                </div>
                {uploadMockFile && (
                  <p className="mt-2 text-xs font-semibold text-emerald-600 flex items-center gap-1">
                    <CheckSquare className="h-4 w-4" />
                    Fichier : {uploadMockFile.name} (Simulé)
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
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
          </div>
      </ModalOverlay>
    </div>
  );
}
