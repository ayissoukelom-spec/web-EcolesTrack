import React, { useState } from 'react';
import { getTeacherDisplayName, type Class, type Teacher } from '../types.ts';
import { sortTeachersAlphabetically } from '../lib/teacherOrdering';

interface AbsenceControlsViewProps {
  absenceControlsList: any[];
  classesList: Class[];
  teachersList: Teacher[];
  approvedSubjectsList: { id: number; name: string }[];
}

function formatControlDate(value: string) {
  const parts = String(value || '').split('-');
  if (parts.length !== 3) return value || '—';
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatPeriod(value: string | null | undefined) {
  if (value === 'morning') return 'Matin';
  if (value === 'afternoon') return 'Après-midi';
  if (value === 'all_day') return 'Toute la journée';
  return value || '—';
}

export default function AbsenceControlsView({
  absenceControlsList,
  classesList,
  teachersList,
  approvedSubjectsList,
}: AbsenceControlsViewProps) {
  const [filterDate, setFilterDate] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [filterTeacherId, setFilterTeacherId] = useState('');
  const [filterClassId, setFilterClassId] = useState('');

  const controls = absenceControlsList
    .filter((control) => control.controlType === 'none')
    .filter((control) => (
      (!filterDate || String(control.date || '') === filterDate)
      && (!filterSubjectId || String(control.subjectId || '') === filterSubjectId)
      && (!filterTeacherId || String(control['teacher' + 'Id'] || '') === filterTeacherId)
      && (!filterClassId || String(control.classId || '') === filterClassId)
    ));
  const sortedTeachers = sortTeachersAlphabetically(teachersList);

  const resetFilters = () => {
    setFilterDate('');
    setFilterSubjectId('');
    setFilterTeacherId('');
    setFilterClassId('');
  };

  return (
    <div className="space-y-6" id="absence-controls-view">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Contrôles Néant</h2>
        <p className="text-sm text-slate-500">Contrôles d'absence effectués par les enseignants sans élève absent</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white p-4 border border-slate-50 rounded-2xl shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">
          Date
          <input
            type="date"
            value={filterDate}
            onChange={(event) => setFilterDate(event.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-normal text-slate-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">
          Matière
          <select
            value={filterSubjectId}
            onChange={(event) => setFilterSubjectId(event.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-normal text-slate-700"
          >
            <option value="">Toutes les matières</option>
            {approvedSubjectsList.map((subject) => (
              <option key={subject.id} value={String(subject.id)}>{subject.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">
          Enseignant
          <select
            value={filterTeacherId}
            onChange={(event) => setFilterTeacherId(event.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-normal text-slate-700"
          >
            <option value="">Tous les enseignants</option>
            {sortedTeachers.map((teacher) => (
              <option key={teacher.id} value={String(teacher.id)}>{getTeacherDisplayName(teacher)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">
          Classe
          <select
            value={filterClassId}
            onChange={(event) => setFilterClassId(event.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-normal text-slate-700"
          >
            <option value="">Toutes les classes</option>
            {classesList.map((klass) => (
              <option key={klass.id} value={String(klass.id)}>{klass.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={resetFilters}
          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
        >
          Réinitialiser
        </button>
      </div>

      <div className="bg-white border border-slate-50 rounded-2xl shadow-sm overflow-x-auto" id="absence-controls-table-container">
        <table className="w-full min-w-[900px] text-left text-xs sm:text-sm text-slate-600">
          <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Classe</th>
              <th className="px-6 py-4">Enseignant</th>
              <th className="px-6 py-4">Matière</th>
              <th className="px-6 py-4">Période</th>
              <th className="px-6 py-4">Horaires</th>
              <th className="px-6 py-4">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.map((control) => {
              const klass = classesList.find((item) => item.id === control.classId);
              const teacherId = control['teacher' + 'Id'];
              const teacher = teachersList.find((item) => item.id === teacherId);
              const subject = approvedSubjectsList.find((item) => item.id === control.subjectId);

              return (
                <tr key={control.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-6 py-4 font-mono text-xs">{formatControlDate(control.date)}</td>
                  <td className="px-6 py-4 font-semibold text-slate-700">{klass?.name || `Classe ${control.classId}`}</td>
                  <td className="px-6 py-4 font-semibold text-slate-700">{teacher ? getTeacherDisplayName(teacher) : `Enseignant ${teacherId}`}</td>
                  <td className="px-6 py-4">{subject?.name || 'Non précisée'}</td>
                  <td className="px-6 py-4">{formatPeriod(control.period)}</td>
                  <td className="px-6 py-4 font-mono text-xs">
                    {control.startTime && control.endTime ? `${control.startTime} - ${control.endTime}` : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-100">
                      Contrôle effectué — Néant
                    </span>
                  </td>
                </tr>
              );
            })}
            {controls.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-400 text-xs">
                  {absenceControlsList.some((control) => control.controlType === 'none')
                    ? 'Aucun contrôle Néant ne correspond aux filtres sélectionnés.'
                    : 'Aucun contrôle Néant enregistré.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
