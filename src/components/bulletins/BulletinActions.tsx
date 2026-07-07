import React from 'react';
import { FileText, Search } from 'lucide-react';
import type { BulletinTermOption, Class, School, Student } from '../../types.ts';
import RequiredLabel from '../RequiredLabel';

interface BulletinActionsProps {
  canGenerate: boolean;
  isParent: boolean;
  schoolsList: School[];
  classesList: Class[];
  studentsList: Student[];
  termOptions: BulletinTermOption[];
  generateSchoolId: string;
  generateClassId: string;
  generateStudentId: string;
  generateTermId: string;
  lookupIdInput: string;
  isGenerateLoading: boolean;
  generateError: string | null;
  generateSuccess: string | null;
  canGenerateClassBulk: boolean;
  generateClassStudentsCount: number;
  onGenerateSchoolChange: (value: string) => void;
  onGenerateClassChange: (value: string) => void;
  onGenerateStudentChange: (value: string) => void;
  onGenerateTermChange: (value: string) => void;
  onGenerateClassSubmit: () => void;
  onLookupIdInputChange: (value: string) => void;
  onGenerateSubmit: (e: React.FormEvent) => void;
  onParentLookupSubmit: (e: React.FormEvent) => void;
  onReloadParentKnown: () => void;
}

export default function BulletinActions({
  canGenerate,
  isParent,
  schoolsList,
  classesList,
  studentsList,
  termOptions,
  generateSchoolId,
  generateClassId,
  generateStudentId,
  generateTermId,
  lookupIdInput,
  isGenerateLoading,
  generateError,
  generateSuccess,
  canGenerateClassBulk,
  generateClassStudentsCount,
  onGenerateSchoolChange,
  onGenerateClassChange,
  onGenerateStudentChange,
  onGenerateTermChange,
  onGenerateClassSubmit,
  onLookupIdInputChange,
  onGenerateSubmit,
  onParentLookupSubmit,
  onReloadParentKnown,
}: BulletinActionsProps) {
  return (
    <>
      {canGenerate && (
        <form onSubmit={onGenerateSubmit} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <FileText className="h-4.5 w-4.5 text-indigo-600" />
            Generation de bulletin (admin)
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Ecole
              </label>
              <select
                value={generateSchoolId}
                onChange={(e) => onGenerateSchoolChange(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
              >
                <option value="">Toutes les ecoles</option>
                {schoolsList.map((school) => (
                  <option key={school.id} value={school.id}>{school.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Classe
              </label>
              <select
                value={generateClassId}
                onChange={(e) => onGenerateClassChange(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
              >
                <option value="">Toutes les classes</option>
                {classesList.map((klass) => (
                  <option key={klass.id} value={klass.id}>{klass.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                <RequiredLabel label="Élève cible" required />
              </label>
              <select
                value={generateStudentId}
                onChange={(e) => onGenerateStudentChange(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                required
              >
                <option value="">Eleve cible</option>
                {studentsList.map((s) => (
                  <option key={s.id} value={s.id}>{s.firstName} {s.lastName} - {s.className}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                <RequiredLabel label="Trimestre" required />
              </label>
              <select
                value={generateTermId}
                onChange={(e) => onGenerateTermChange(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                required
              >
                <option value="">Trimestre</option>
                {termOptions.map((term) => (
                  <option key={term.id} value={term.id}>{term.name}</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={isGenerateLoading}
              className="rounded-xl px-4 py-2 bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {isGenerateLoading ? 'Generation...' : 'Generer le bulletin'}
            </button>

            <button
              type="button"
              disabled={isGenerateLoading || !canGenerateClassBulk}
              onClick={onGenerateClassSubmit}
              className="rounded-xl px-4 py-2 border border-emerald-200 text-emerald-700 bg-emerald-50 font-semibold text-sm hover:bg-emerald-100 disabled:opacity-60"
            >
              {isGenerateLoading ? 'Generation...' : `Generer la classe (${generateClassStudentsCount})`}
            </button>
          </div>

          {generateError && <p className="text-xs text-rose-600">{generateError}</p>}
          {generateSuccess && <p className="text-xs text-emerald-600">{generateSuccess}</p>}
        </form>
      )}

      {isParent && (
        <form onSubmit={onParentLookupSubmit} className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Search className="h-4.5 w-4.5 text-indigo-600" />
            Consultation parent par identifiant de bulletin
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={lookupIdInput}
              onChange={(e) => onLookupIdInputChange(e.target.value)}
              type="number"
              min={1}
              placeholder="ID bulletin"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-xl px-4 py-2 bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700">
              Consulter
            </button>
            <button
              type="button"
              onClick={onReloadParentKnown}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Recharger mes bulletins
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Les bulletins parents sont stockes localement apres consultation autorisee et restent soumis au controle ownership.
          </p>
        </form>
      )}
    </>
  );
}
