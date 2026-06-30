import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type {
  BulletinDetail,
  BulletinListFilters,
  BulletinListItem,
  BulletinTermOption,
  Class,
  Evaluation,
  SchoolTerm,
  Student,
  UserRole,
} from '../types.ts';
import { fetchBulletinDetail, getSimulatedUser } from '../lib/api.ts';
import { useBulletinsList } from '../hooks/useBulletinsList.ts';
import { useBulletinDetail } from '../hooks/useBulletinDetail.ts';
import { useGenerateBulletin } from '../hooks/useGenerateBulletin.ts';
import { useDownloadBulletinPDF } from '../hooks/useDownloadBulletinPDF.ts';
import BulletinsList from './bulletins/BulletinsList.tsx';
import BulletinDetailView from './bulletins/BulletinDetail.tsx';
import BulletinActions from './bulletins/BulletinActions.tsx';

interface BulletinsViewProps {
  currentRole: UserRole;
  classesList: Class[];
  studentsList: Student[];
  evaluationsList: Evaluation[];
  termsList: SchoolTerm[];
  teacherClassIds?: number[];
}

const parentCacheKey = (uid: string) => `ecoletrack_parent_bulletin_ids_${uid}`;

const toParentListItem = (detail: BulletinDetail): BulletinListItem => ({
  id: detail.id,
  studentId: detail.studentId,
  studentName: detail.studentName,
  classId: detail.classId,
  className: detail.className,
  schoolYearId: detail.schoolYearId,
  schoolYearName: detail.schoolYearName,
  termId: detail.termId,
  termName: detail.termName,
  average: detail.average,
  rank: detail.rank,
  mention: detail.mention,
  appreciation: detail.appreciation,
  generatedAt: detail.generatedAt,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
});

export default function BulletinsView({
  currentRole,
  classesList,
  studentsList,
  evaluationsList,
  termsList,
  teacherClassIds = [],
}: BulletinsViewProps) {
  const canGenerate = currentRole === 'school_admin' || currentRole === 'super_admin';
  const canList = currentRole === 'school_admin' || currentRole === 'super_admin' || currentRole === 'teacher' || currentRole === 'parent';
  const isTeacher = currentRole === 'teacher';
  const isParent = currentRole === 'parent';

  const [filters, setFilters] = useState<{ classId?: number; studentId?: number; termId?: number }>({});
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [generateStudentId, setGenerateStudentId] = useState<string>('');
  const [generateTermId, setGenerateTermId] = useState<string>('');
  const [lookupIdInput, setLookupIdInput] = useState('');
  const [parentKnownItems, setParentKnownItems] = useState<BulletinListItem[]>([]);

  const visibleClasses = useMemo(() => {
    if (!isTeacher) return classesList;
    return classesList.filter((c) => teacherClassIds.includes(c.id));
  }, [classesList, isTeacher, teacherClassIds]);

  const visibleStudents = useMemo(() => {
    const scopedByClass = filters.classId
      ? studentsList.filter((s) => s.classId === filters.classId)
      : studentsList;

    if (!isTeacher) return scopedByClass;
    return scopedByClass.filter((s) => teacherClassIds.includes(s.classId));
  }, [filters.classId, isTeacher, studentsList, teacherClassIds]);

  const termOptions = useMemo<BulletinTermOption[]>(() => {
    if (!Array.isArray(termsList) || termsList.length === 0) {
      const seen = new Set<number>();
      const options: BulletinTermOption[] = [];
      for (const ev of evaluationsList || []) {
        const termId = Number(ev?.termId);
        if (!Number.isInteger(termId) || termId <= 0 || seen.has(termId)) continue;
        seen.add(termId);
        options.push({ id: termId, name: String(ev?.termName || `Trimestre ${termId}`) });
      }
      return options.sort((a, b) => a.id - b.id);
    }

    return termsList
      .filter((term) => term && Number.isInteger(term.id) && term.id > 0)
      .map((term) => ({ id: term.id, name: String(term.name ?? `Trimestre ${term.id}`) }))
      .sort((a, b) => a.id - b.id);
  }, [evaluationsList, termsList]);

  const suggestedParentStudentId = useMemo(() => {
    if (!isParent) return null;
    const simulated = getSimulatedUser();
    const parentName = String(simulated?.name || '').trim().toLowerCase();
    const parentEmail = String(simulated?.email || '').trim().toLowerCase();

    const byParentName = studentsList.find((s) => String(s.parentName || '').trim().toLowerCase() === parentName);
    if (byParentName) return byParentName.id;

    const byEmailHint = studentsList.find((s) => {
      const compactParentName = String(s.parentName || '').toLowerCase().replace(/\s+/g, '');
      return compactParentName && parentEmail.includes(compactParentName);
    });

    return byEmailHint?.id ?? null;
  }, [isParent, studentsList]);

  useEffect(() => {
    if (canGenerate && studentsList.length > 0 && !generateStudentId) {
      setGenerateStudentId(String(studentsList[0].id));
    }
  }, [canGenerate, generateStudentId, studentsList]);

  useEffect(() => {
    if (canGenerate && termOptions.length > 0 && !generateTermId) {
      setGenerateTermId(String(termOptions[0].id));
    }
  }, [canGenerate, generateTermId, termOptions]);

  useEffect(() => {
    if (isParent && suggestedParentStudentId && !filters.studentId) {
      setFilters((prev) => ({ ...prev, studentId: suggestedParentStudentId }));
    }
  }, [filters.studentId, isParent, suggestedParentStudentId]);

  const listFilters = useMemo<BulletinListFilters>(() => ({
    page,
    pageSize,
    classId: filters.classId,
    studentId: filters.studentId,
    termId: filters.termId,
  }), [filters.classId, filters.studentId, filters.termId, page, pageSize]);

  const listHook = useBulletinsList({ enabled: canList, filters: listFilters });
  const detailHook = useBulletinDetail();
  const generateHook = useGenerateBulletin();
  const pdfHook = useDownloadBulletinPDF();

  useEffect(() => {
    if (listHook.error && isParent) {
      listHook.setError('Votre profil parent ne peut pas afficher la liste globale. Utilisez la consultation detaillee par ID autorise.');
    }
  }, [isParent, listHook.error]);

  const loadDetailAndMaybeCache = async (id: number) => {
    setSelectedId(id);
    const detail = await detailHook.loadDetail(id);
    if (!detail || !isParent) return;

    const simulated = getSimulatedUser();
    const uid = simulated?.uid;
    if (!uid) return;

    const nextItems = [toParentListItem(detail), ...parentKnownItems.filter((it) => it.id !== detail.id)].slice(0, 20);
    setParentKnownItems(nextItems);
    localStorage.setItem(parentCacheKey(uid), JSON.stringify(nextItems.map((it) => it.id)));
  };

  const loadParentCached = async () => {
    if (!isParent) return;

    const simulated = getSimulatedUser();
    const uid = simulated?.uid;
    if (!uid) return;

    const raw = localStorage.getItem(parentCacheKey(uid));
    if (!raw) {
      setParentKnownItems([]);
      return;
    }

    let ids: number[] = [];
    try {
      const parsed = JSON.parse(raw);
      ids = Array.isArray(parsed)
        ? parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
        : [];
    } catch {
      ids = [];
    }

    if (ids.length === 0) {
      setParentKnownItems([]);
      return;
    }

    const loaded: BulletinListItem[] = [];
    for (const id of ids.slice(0, 20)) {
      try {
        const detail = await fetchBulletinDetail(id);
        loaded.push(toParentListItem(detail));
      } catch {
        // ignore inaccessible cache ids
      }
    }
    setParentKnownItems(loaded);
  };

  useEffect(() => {
    if (isParent) {
      loadParentCached();
    }
  }, [isParent]);

  const handleGenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const studentId = Number(generateStudentId);
    const termId = Number(generateTermId);

    if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(termId) || termId <= 0) {
      generateHook.setError('Selectionnez un eleve et un trimestre valides.');
      return;
    }

    const created = await generateHook.run(studentId, termId);
    await listHook.refresh();
    if (created?.id) {
      await loadDetailAndMaybeCache(Number(created.id));
    }
  };

  const handleParentLookupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(lookupIdInput);
    if (!Number.isInteger(id) || id <= 0) {
      detailHook.setError('Entrez un identifiant de bulletin valide.');
      return;
    }
    await loadDetailAndMaybeCache(id);
  };

  const handleDownloadPdf = async () => {
    console.log('🔘 [BulletinsView.handleDownloadPdf] Button clicked, selectedId:', selectedId);
    if (!selectedId) return;
    console.log('➡️  [BulletinsView.handleDownloadPdf] Calling pdfHook.run(', selectedId, ')');
    await pdfHook.run(selectedId);
  };

  const renderedItems = canList ? listHook.items : parentKnownItems;
  const total = canList ? listHook.total : parentKnownItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6" id="bulletins-view">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Bulletins scolaires</h2>
          <p className="text-sm text-slate-500">Liste, detail et telechargement PDF via APIs backend existantes.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl">
          <ShieldCheck className="h-4 w-4" />
          <span>Securise par role et ownership</span>
        </div>
      </div>

      <BulletinActions
        canGenerate={canGenerate}
        isParent={isParent}
        studentsList={studentsList}
        termOptions={termOptions}
        generateStudentId={generateStudentId}
        generateTermId={generateTermId}
        lookupIdInput={lookupIdInput}
        isGenerateLoading={generateHook.loading}
        generateError={generateHook.error}
        generateSuccess={generateHook.success}
        onGenerateStudentChange={setGenerateStudentId}
        onGenerateTermChange={setGenerateTermId}
        onLookupIdInputChange={setLookupIdInput}
        onGenerateSubmit={handleGenerateSubmit}
        onParentLookupSubmit={handleParentLookupSubmit}
        onReloadParentKnown={loadParentCached}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <BulletinsList
          canList={canList}
          loading={listHook.loading}
          error={listHook.error}
          items={renderedItems}
          total={total}
          page={page}
          totalPages={totalPages}
          selectedId={selectedId}
          visibleClasses={visibleClasses}
          visibleStudents={visibleStudents}
          termOptions={termOptions}
          filters={filters}
          onRefresh={listHook.refresh}
          onSelect={loadDetailAndMaybeCache}
          onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
          onNextPage={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          onResetFilters={() => {
            setFilters({});
            setPage(1);
          }}
          onFilterClassChange={(value) => {
            setFilters((prev) => ({ ...prev, classId: value ? Number(value) : undefined, studentId: undefined }));
            setPage(1);
          }}
          onFilterStudentChange={(value) => {
            setFilters((prev) => ({ ...prev, studentId: value ? Number(value) : undefined }));
            setPage(1);
          }}
          onFilterTermChange={(value) => {
            setFilters((prev) => ({ ...prev, termId: value ? Number(value) : undefined }));
            setPage(1);
          }}
        />

        <BulletinDetailView
          detail={detailHook.detail}
          loading={detailHook.loading}
          error={detailHook.error || pdfHook.error}
          selectedId={selectedId}
          pdfLoading={pdfHook.loading}
          onDownloadPdf={handleDownloadPdf}
        />
      </div>
    </div>
  );
}
