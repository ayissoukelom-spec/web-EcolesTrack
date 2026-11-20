import React from 'react';
import { FileText, LoaderCircle, Search } from 'lucide-react';
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
  hasSelectedBulletinEvaluations: boolean;
  generateError: string | null;
  generateSuccess: string | null;
  canGenerateClassBulk: boolean;
  generateClassStudentsCount: number;
  compositionValidationMessage: string | null;
  studentsLoadState: 'loading' | 'ready' | 'error';
  studentLoadError: string | null;
  classesLoadState: 'loading' | 'ready' | 'error';
  classLoadError: string | null;
  generationDataLoadState: 'loading' | 'ready' | 'error';
  generationDataLoadError: string | null;
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
  hasSelectedBulletinEvaluations,
  generateError,
  generateSuccess,
  canGenerateClassBulk,
  generateClassStudentsCount,
  compositionValidationMessage,
  studentsLoadState,
  studentLoadError,
  classesLoadState,
  classLoadError,
  generationDataLoadState,
  generationDataLoadError,
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
                disabled={classesLoadState !== 'ready'}
                aria-busy={classesLoadState === 'loading'}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
              >
                <option value="">
                  {classesLoadState === 'loading' ? 'Chargement des classes…' : 'Toutes les classes'}
                </option>
                {classesList.map((klass) => (
                  <option key={klass.id} value={klass.id}>{klass.name}</option>
                ))}
              </select>
              {classesLoadState === 'error' && (
                <p className="mt-1 text-xs text-rose-600" role="alert">
                  {classLoadError || 'Impossible de charger les classes.'}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                <RequiredLabel label="Élève cible" required />
              </label>
              <select
                value={generateStudentId}
                onChange={(e) => onGenerateStudentChange(e.target.value)}
                disabled={studentsLoadState !== 'ready'}
                aria-busy={studentsLoadState === 'loading'}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                required
              >
                <option value="">
                  {studentsLoadState === 'loading'
                    ? 'Chargement des élèves…'
                    : studentsLoadState === 'error'
                      ? 'Liste des élèves indisponible'
                      : 'Élève cible'}
                </option>
                {studentsList.map((s) => (
                  <option key={s.id} value={s.id}>{s.lastName} {s.firstName} - {s.className}</option>
                ))}
              </select>
              {studentsLoadState === 'loading' && (
                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500" role="status">
                  <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Chargement des élèves…
                </p>
              )}
              {studentsLoadState === 'error' && (
                <p className="mt-1 text-xs text-rose-600" role="alert">
                  {studentLoadError || 'Impossible de charger la liste des élèves.'}
                </p>
              )}
              {studentsLoadState === 'ready' && studentsList.length === 0 && (
                <p className="mt-1 text-xs text-slate-500" role="status">
                  Aucun élève correspondant aux filtres.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                <RequiredLabel label="Période" required />
              </label>
              <select
                value={generateTermId}
                onChange={(e) => onGenerateTermChange(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                required
              >
                <option value="">Période</option>
                {termOptions.map((term) => (
                  <option key={term.id} value={term.id}>{term.name}</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={isGenerateLoading || generationDataLoadState !== 'ready' || !hasSelectedBulletinEvaluations || !!compositionValidationMessage}
              className="rounded-xl px-4 py-2 bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {isGenerateLoading ? 'Generation...' : 'Generer le bulletin'}
            </button>

            <button
              type="button"
              disabled={isGenerateLoading || generationDataLoadState !== 'ready' || !canGenerateClassBulk || !!compositionValidationMessage}
              onClick={onGenerateClassSubmit}
              className="rounded-xl px-4 py-2 border border-emerald-200 text-emerald-700 bg-emerald-50 font-semibold text-sm hover:bg-emerald-100 disabled:opacity-60"
            >
              {isGenerateLoading ? 'Generation...' : `Generer la classe (${generateClassStudentsCount})`}
            </button>
          </div>

          {generationDataLoadState === 'error' && (
            <p className="text-xs text-rose-600" role="alert">
              {generationDataLoadError || 'Impossible de charger les évaluations et les notes.'}
            </p>
          )}
          {compositionValidationMessage && <p role="alert" className="text-xs text-rose-600">{compositionValidationMessage}</p>}
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
