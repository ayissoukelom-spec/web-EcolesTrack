import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import type { AcademicYear, Class, School, Student, UserRole } from '../types.ts';
import { apiFetch, apiFetchBlob } from '../lib/api.ts';
import { generateClassSituationPdf } from '../lib/classSituationPdf.ts';

type Category = { id: number; code: string; label: string; isEnabled: boolean };
type Tariff = {
  id: number;
  classId: number | null;
  className: string;
  classFromId?: number | null;
  classFromName?: string | null;
  classToId?: number | null;
  classToName?: string | null;
  categoryId: number;
  categoryCode: string;
  categoryLabel: string;
  amount: number;
  academicYearId: number;
  isEnabled?: boolean;
};
type EducationLevel = { id: number; orderIndex: number };
type Fee = { id: number; academicYearId: number; classId: number | null; studentId: number | null; categoryId: number; label: string; amount: number; status: string };
type AccountingTab = 'dashboard' | 'configuration' | 'fees' | 'students';
type SituationRow = {
  studentId: number;
  firstName: string;
  lastName: string;
  matricule: string | null;
  classId: number;
  className: string;
  tariffId: number | null;
  categoryId: number;
  categoryCode: string;
  categoryLabel: string;
  due: number;
  paid: number;
  remaining: number;
  status: 'unpaid' | 'partial' | 'paid' | 'unconfigured';
  studentStatus?: 'unpaid' | 'partial' | 'paid' | 'unconfigured';
  studentDue?: number;
  studentPaid?: number;
  studentRemaining?: number;
};
type ClassSituationRow = Pick<SituationRow,
  'studentId' | 'firstName' | 'lastName' | 'className' | 'studentDue' | 'studentPaid' | 'studentRemaining' | 'studentStatus'> & {
    studentDue: number;
    studentPaid: number;
    studentRemaining: number;
    studentStatus: 'unpaid' | 'partial' | 'paid' | 'unconfigured';
  };

interface AccountingViewProps {
  userRole: UserRole;
  currentSchoolId: number | null;
  schools: School[];
  years: AcademicYear[];
  classes: Class[];
  students: Student[];
}

const formatMoney = (amount: number) => `${Number(amount || 0).toLocaleString('fr-FR')} FCFA`;
const normalizeFeeLabel = (label: string) => label.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('fr');
const normalizeFeeFilterLabel = (label: string) => label
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('fr');
const formatStatus = (status: SituationRow['status']) => ({
  unpaid: 'Impayé',
  partial: 'Partiel',
  paid: 'Soldé',
  unconfigured: 'Tarif à configurer',
}[status]);
const formatTotalsStatus = (due: number, paid: number): SituationRow['status'] => {
  if (due <= 0) return 'unconfigured';
  if (due <= paid) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
};
const dashboardMetricStyles = {
  received: {
    card: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/80',
    label: 'text-emerald-800',
    value: 'text-emerald-950',
  },
  expected: {
    card: 'border-indigo-200 bg-gradient-to-br from-indigo-600 to-blue-700',
    label: 'text-indigo-100',
    value: 'text-white',
  },
  remaining: {
    card: 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100/80',
    label: 'text-amber-900',
    value: 'text-amber-950',
  },
  overdue: {
    card: 'border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100/80',
    label: 'text-rose-800',
    value: 'text-rose-950',
  },
  upcoming: {
    card: 'border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-100/80',
    label: 'text-amber-800',
    value: 'text-amber-950',
  },
  students: {
    card: 'border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-100/80',
    label: 'text-violet-800',
    value: 'text-violet-950',
  },
  recent: {
    card: 'border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-100/80',
    label: 'text-sky-800',
    value: 'text-sky-950',
  },
} as const;

export default function AccountingView({
  userRole,
  currentSchoolId,
  schools,
  years,
  classes,
  students,
}: AccountingViewProps) {
  const [schoolId, setSchoolId] = useState<number | null>(currentSchoolId);
  const [yearId, setYearId] = useState<number | null>(() =>
    years.find((year) => year.isActive
      && (!currentSchoolId || !year.schoolId || year.schoolId === currentSchoolId))?.id ?? null);
  const [tab, setTab] = useState<AccountingTab>('dashboard');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [educationLevels, setEducationLevels] = useState<EducationLevel[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [situationRows, setSituationRows] = useState<SituationRow[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [cashSummary, setCashSummary] = useState<any>(null);
  const [feesCashSummary, setFeesCashSummary] = useState<any>(null);
  const [isFeesCashDetailsOpen, setIsFeesCashDetailsOpen] = useState(false);
  const [feesCashDateMode, setFeesCashDateMode] = useState<'all' | 'specific'>('all');
  const [feesCashDateFilter, setFeesCashDateFilter] = useState('');
  const [feesCashClassFilterId, setFeesCashClassFilterId] = useState<number | null>(null);
  const [selectedTariffIds, setSelectedTariffIds] = useState<number[]>([]);
  const [feeLabelFilter, setFeeLabelFilter] = useState<string[]>([]);
  const [isFeeLabelMenuOpen, setIsFeeLabelMenuOpen] = useState(false);
  const feeLabelMenuRef = useRef<HTMLDivElement>(null);
  const [feeClassFilterId, setFeeClassFilterId] = useState<number | null>(null);
  const [issuedReceipt, setIssuedReceipt] = useState<{ url: string; number: string } | null>(null);
  const [cashFilters, setCashFilters] = useState({
    startDate: '',
    endDate: '',
    categoryId: '',
    classId: '',
    studentId: '',
    method: '',
  });
  const [studentId, setStudentId] = useState<number | null>(null);
  const [situationClassId, setSituationClassId] = useState<number | null>(null);
  const [studentSituationClassId, setStudentSituationClassId] = useState<number | null>(null);
  const [studentSituationStatus, setStudentSituationStatus] = useState<'paid' | 'partial' | 'unpaid' | null>(null);
  const [studentSituationStudentIds, setStudentSituationStudentIds] = useState<number[] | null>(null);
  const [isClassSituationVisible, setIsClassSituationVisible] = useState(false);
  const [classSituationRows, setClassSituationRows] = useState<ClassSituationRow[]>([]);
  const [isClassSituationLoading, setIsClassSituationLoading] = useState(false);
  const [isClassSituationPdfLoading, setIsClassSituationPdfLoading] = useState(false);
  const [classSituationError, setClassSituationError] = useState('');
  const [paymentSituationRow, setPaymentSituationRow] = useState<SituationRow | null>(null);
  const [showRubricPayment, setShowRubricPayment] = useState(false);
  const [studentFinance, setStudentFinance] = useState<any>(null);
  const [receiptUrls, setReceiptUrls] = useState<Record<number, string>>({});
  const [enrollmentKinds, setEnrollmentKinds] = useState<Record<number, string>>({});
  const [amount, setAmount] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [configurationMode, setConfigurationMode] = useState<'single' | 'range'>('single');
  const [rangeStartClassId, setRangeStartClassId] = useState<number | null>(null);
  const [rangeEndClassId, setRangeEndClassId] = useState<number | null>(null);
  const [feeLabel, setFeeLabel] = useState('');
  const [isFeeFormOpen, setIsFeeFormOpen] = useState(false);
  const [editingTariffId, setEditingTariffId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentCategoryId, setPaymentCategoryId] = useState<number | null>(null);
  const [feePaymentMode, setFeePaymentMode] = useState(false);
  const [multiPaymentEnabled, setMultiPaymentEnabled] = useState(false);
  const [multiPaymentAmounts, setMultiPaymentAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const paymentAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const receiptObjectUrls = useRef(new Set<string>());
  const paymentFormRef = useRef<HTMLDivElement>(null);
  const authorized = userRole === 'school_admin' || userRole === 'super_admin';

  const visibleYears = useMemo(
    () => years.filter((year) => !schoolId || !year.schoolId || year.schoolId === schoolId),
    [years, schoolId],
  );
  const visibleClasses = useMemo(
    () => classes.filter((item) => !schoolId || item.schoolId === schoolId || item.schoolId == null),
    [classes, schoolId],
  );
  const visibleStudents = useMemo(
    () => students.filter((item) => !schoolId || item.schoolId === schoolId),
    [students, schoolId],
  );
  const situationClasses = visibleClasses.filter((item) => item.academicYearId === yearId);
  const levelOrderById = new Map(educationLevels.map((level) => [level.id, level.orderIndex]));
  const orderedConfigurationClasses = [...situationClasses].sort((left, right) => {
    const leftOrder = left.levelId == null ? undefined : levelOrderById.get(left.levelId);
    const rightOrder = right.levelId == null ? undefined : levelOrderById.get(right.levelId);
    if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (leftOrder != null && rightOrder == null) return -1;
    if (leftOrder == null && rightOrder != null) return 1;
    if (leftOrder != null && rightOrder != null) return left.name.localeCompare(right.name, 'fr', { numeric: true });
    return 0;
  });
  const rangeHasPedagogicalOrder = situationClasses.length > 0
    && situationClasses.every((item) => item.levelId != null && levelOrderById.has(item.levelId));
  const rangeStartIndex = orderedConfigurationClasses.findIndex((item) => item.id === rangeStartClassId);
  const rangeEndIndex = orderedConfigurationClasses.findIndex((item) => item.id === rangeEndClassId);
  const rangeClasses = rangeStartIndex >= 0 && rangeEndIndex >= rangeStartIndex
    ? orderedConfigurationClasses.slice(rangeStartIndex, rangeEndIndex + 1)
    : [];
  const tariffAppliesToClass = (tariff: Tariff, classId: number) => {
    if (tariff.classId != null) return tariff.classId === classId;
    const startIndex = orderedConfigurationClasses.findIndex((item) => item.id === tariff.classFromId);
    const endIndex = orderedConfigurationClasses.findIndex((item) => item.id === tariff.classToId);
    const targetIndex = orderedConfigurationClasses.findIndex((item) => item.id === classId);
    return startIndex >= 0 && endIndex >= startIndex && targetIndex >= startIndex && targetIndex <= endIndex;
  };
  const tariffsForSelectedYear = tariffs.filter((tariff) =>
    tariff.academicYearId === yearId && tariff.isEnabled !== false);
  const feeLabelOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const tariff of tariffsForSelectedYear) {
      const normalizedLabel = normalizeFeeFilterLabel(tariff.categoryLabel);
      if (!labels.has(normalizedLabel)) labels.set(normalizedLabel, tariff.categoryLabel);
    }
    return [...labels.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'fr'));
  }, [tariffs, yearId]);
  const selectedFeeLabelOptions = feeLabelOptions.filter((option) => feeLabelFilter.includes(option.value));
  const feeLabelFilterSummary = selectedFeeLabelOptions.length === 0
    ? 'Tous les libellés'
    : selectedFeeLabelOptions.length <= 2
      ? selectedFeeLabelOptions.map((option) => option.label).join(', ')
      : `${selectedFeeLabelOptions.length} libellés sélectionnés`;
  const filteredYearTariffs = tariffsForSelectedYear.filter((tariff) =>
    (!feeClassFilterId || tariffAppliesToClass(tariff, feeClassFilterId))
    && (feeLabelFilter.length === 0 || feeLabelFilter.includes(normalizeFeeFilterLabel(tariff.categoryLabel))));
  const selectedYearName = visibleYears.find((year) => year.id === yearId)?.name ?? '';
  const enabledCategories = categories.filter((category) => category.isEnabled);
  const matchingTariff = editingTariffId == null
    ? null
    : tariffs.find((tariff) => tariff.id === editingTariffId) ?? null;
  const duplicateTariff = yearId && selectedClassId && feeLabel.trim()
    && configurationMode === 'single'
    ? tariffs.find((tariff) => tariff.id !== editingTariffId
      && tariff.academicYearId === yearId
      && tariff.classId === selectedClassId
      && normalizeFeeLabel(tariff.categoryLabel) === normalizeFeeLabel(feeLabel))
    : null;
  const selectedPaymentStudent = studentFinance?.student?.id === studentId ? studentFinance.student : null;
  const selectedPaymentCategory = (studentFinance?.student?.id === studentId ? studentFinance?.categories ?? [] : [])
    .find((category: any) => category.id === paymentCategoryId);
  const activeRubricRow = paymentSituationRow?.studentId === studentId
    && paymentSituationRow.categoryId === paymentCategoryId
    ? paymentSituationRow
    : null;
  const paymentScope = {
    due: activeRubricRow?.due ?? selectedPaymentCategory?.due ?? studentFinance?.totals?.due ?? 0,
    paid: activeRubricRow?.paid ?? selectedPaymentCategory?.paid ?? studentFinance?.totals?.paid ?? 0,
    remaining: activeRubricRow?.remaining
      ?? selectedPaymentCategory?.remaining
      ?? Math.max(0, (studentFinance?.totals?.due ?? 0) - (studentFinance?.totals?.paid ?? 0)),
  };
  const selectedFeePaymentCategories = (studentFinance?.student?.id === studentId
    ? studentFinance?.categories ?? []
    : []).filter((category: any) => category.tariffId
      && (selectedTariffIds ?? []).includes(category.tariffId));
  const feePaymentScope = selectedFeePaymentCategories.reduce((scope: { due: number; paid: number; remaining: number }, category: any) => ({
    due: scope.due + category.due,
    paid: scope.paid + category.paid,
    remaining: scope.remaining + category.remaining,
  }), { due: 0, paid: 0, remaining: 0 });
  const feePaymentTotal = Object.values(multiPaymentAmounts)
    .reduce((sum, lineAmount) => sum + (Number(lineAmount) || 0), 0);
  const feesCashAllocations = feesCashSummary?.allocations ?? [];
  const filteredFeesCashAllocations = feesCashAllocations.filter((allocation: any) => {
    const paidAt = new Date(allocation.paidAt);
    const allocationDate = Number.isNaN(paidAt.getTime())
      ? ''
      : `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, '0')}-${String(paidAt.getDate()).padStart(2, '0')}`;
    return (!feesCashDateFilter || allocationDate === feesCashDateFilter)
      && (!feesCashClassFilterId || allocation.classId === feesCashClassFilterId);
  });
  const filteredFeesCashTotal = filteredFeesCashAllocations.reduce(
    (total: number, allocation: any) => total + Number(allocation.amount || 0),
    0,
  );
  const selectedPaymentCategoryLabel = selectedPaymentCategory?.label
    ?? activeRubricRow?.categoryLabel
    ?? 'Frais';
  const accountQuery = schoolId ? `schoolId=${schoolId}` : '';
  const yearQuery = yearId ? `&academicYearId=${yearId}` : '';
  const cashQuery = useMemo(() => {
    const params = new URLSearchParams({ schoolId: String(schoolId ?? '') });
    if (yearId) params.set('academicYearId', String(yearId));
    for (const [key, value] of Object.entries(cashFilters)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }, [cashFilters, schoolId, yearId]);
  const feesCashQuery = useMemo(() => {
    const params = new URLSearchParams({ schoolId: String(schoolId ?? '') });
    if (yearId) params.set('academicYearId', String(yearId));
    (selectedTariffIds ?? []).forEach((tariffId) => params.append('tariffId', String(tariffId)));
    return params.toString();
  }, [schoolId, selectedTariffIds, yearId]);
  const situationQuery = useMemo(() => {
    const params = new URLSearchParams({ schoolId: String(schoolId ?? ''), academicYearId: String(yearId ?? '') });
    (selectedTariffIds ?? []).forEach((tariffId) => params.append('tariffId', String(tariffId)));
    return params.toString();
  }, [schoolId, selectedTariffIds, yearId]);
  const studentSituationQuery = useMemo(() => {
    const params = new URLSearchParams({
      schoolId: String(schoolId ?? ''),
      academicYearId: String(yearId ?? ''),
      includeInactive: 'true',
    });
    if (studentSituationClassId != null) params.set('classId', String(studentSituationClassId));
    if (studentSituationStatus != null) params.set('status', studentSituationStatus);
    return params.toString();
  }, [schoolId, studentSituationClassId, studentSituationStatus, yearId]);
  const classSituationQuery = useMemo(() => {
    const params = new URLSearchParams({
      schoolId: String(schoolId ?? ''),
      academicYearId: String(yearId ?? ''),
      classId: String(studentSituationClassId ?? ''),
      aggregate: 'student',
      includeInactive: 'true',
    });
    if (studentSituationStatus != null) params.set('status', studentSituationStatus);
    return params.toString();
  }, [schoolId, studentSituationClassId, studentSituationStatus, yearId]);
  const filteredSituationStudents = visibleStudents.filter((student) =>
    (studentSituationClassId == null || student.classId === studentSituationClassId)
    && (studentSituationStatus == null
      || (studentSituationStudentIds ?? []).includes(student.id)));
  const selectedClassSituation = situationClasses.find((item) => item.id === studentSituationClassId) ?? null;
  const selectedSchool = schools.find((item) => item.id === schoolId) ?? null;
  const classSituationTotals = classSituationRows.reduce((totals, row) => ({
    due: totals.due + row.studentDue,
    paid: totals.paid + row.studentPaid,
    remaining: totals.remaining + row.studentRemaining,
  }), { due: 0, paid: 0, remaining: 0 });
  const selectedFeeSituationRows = situationRows.filter((row) => row.tariffId != null
    && (selectedTariffIds ?? []).includes(row.tariffId)
    && (!situationClassId || row.classId === situationClassId));
  const categoryDisplayLabel = (code: string, fallbackLabel?: string, classId?: number | null) => {
    const matchingTariffs = tariffs.filter((tariff) =>
      tariff.categoryCode === code
      && (!yearId || tariff.academicYearId === yearId)
      && (!classId || tariffAppliesToClass(tariff, classId)));
    const labelsByClass = new Map<string, Set<string>>();
    for (const tariff of matchingTariffs) {
      const classNames = labelsByClass.get(tariff.categoryLabel) ?? new Set<string>();
      classNames.add(tariff.className);
      labelsByClass.set(tariff.categoryLabel, classNames);
    }
    if (labelsByClass.size === 1) return labelsByClass.keys().next().value as string;
    if (labelsByClass.size > 1) {
      return [...labelsByClass].map(([label, classNames]) => `${label} (${[...classNames].join(', ')})`).join(' · ');
    }
    return fallbackLabel ?? categories.find((category) => category.code === code)?.label ?? 'Frais';
  };

  useEffect(() => {
    if (!authorized) return;
    if (userRole === 'school_admin') setSchoolId(currentSchoolId);
  }, [authorized, currentSchoolId, userRole]);

  useEffect(() => {
    setSituationClassId(null);
    setFeeClassFilterId(null);
    setFeesCashDateMode('all');
    setFeesCashDateFilter('');
    setFeesCashClassFilterId(null);
    setSelectedTariffIds([]);
    setIsFeeLabelMenuOpen(false);
    setShowRubricPayment(false);
    setPaymentSituationRow(null);
    setIsFeeFormOpen(false);
    setEditingTariffId(null);
    setFeeLabel('');
    setSelectedClassId(null);
    setAmount('');
  }, [schoolId, yearId]);

  useEffect(() => {
    if (!isFeeLabelMenuOpen) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!feeLabelMenuRef.current?.contains(event.target as Node)) {
        setIsFeeLabelMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown);
  }, [isFeeLabelMenuOpen]);

  useEffect(() => {
    if (!authorized) return;
    if (!schoolId) {
      setCategories([]);
      setTariffs([]);
      setDashboard(null);
      return;
    }
    let cancelled = false;
    setError('');
    Promise.all([
      apiFetch(`/api/accounting/categories?${accountQuery}`),
      apiFetch(`/api/accounting/tariffs?${accountQuery}${yearQuery}`),
      apiFetch(`/api/accounting/dashboard?${accountQuery}${yearQuery}`),
      apiFetch(`/api/accounting/fees?${accountQuery}`),
      apiFetch(`/api/accounting/cash?${cashQuery}`),
    ]).then(([categoryRows, tariffRows, dashboardData, feeRows, cashData]) => {
      if (cancelled) return;
      setCategories(categoryRows);
      setTariffs(tariffRows);
      const availableFeeLabels = new Set(
        tariffRows.map((tariff: Tariff) => normalizeFeeFilterLabel(tariff.categoryLabel)),
      );
      setFeeLabelFilter((current) => current.filter((label) => availableFeeLabels.has(label)));
      setSelectedTariffIds((current) =>
        current.filter((tariffId) => tariffRows.some((tariff: Tariff) => tariff.id === tariffId)));
      setDashboard(dashboardData);
      setFees(feeRows);
      setCashSummary(cashData);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Impossible de charger la comptabilité.');
    });
    return () => { cancelled = true; };
  }, [accountQuery, authorized, cashQuery, schoolId, yearQuery]);

  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    apiFetch('/api/education/levels')
      .then((rows) => {
        if (!cancelled) setEducationLevels(rows);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error
          ? loadError.message
          : 'Impossible de charger l’ordre pédagogique des classes.');
      });
    return () => { cancelled = true; };
  }, [authorized]);

  useEffect(() => {
    if (!authorized || !schoolId) {
      setFeesCashSummary(null);
      return;
    }
    if (selectedTariffIds == null || selectedTariffIds.length === 0) {
      setFeesCashSummary({ total: 0, allocations: [] });
      return;
    }
    let cancelled = false;
    apiFetch(`/api/accounting/cash?${feesCashQuery}`)
      .then((result) => {
        if (!cancelled) setFeesCashSummary(result);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les paiements par frais.');
      });
    return () => { cancelled = true; };
  }, [authorized, feesCashQuery, schoolId]);

  useEffect(() => {
    if (!authorized || !schoolId || !yearId) {
      setSituationRows([]);
      return;
    }
    if (selectedTariffIds == null || selectedTariffIds.length === 0) {
      setSituationRows([]);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/accounting/situation?${situationQuery}`)
      .then((result) => {
        if (!cancelled) setSituationRows((result.rows ?? []).filter((row: SituationRow) => row.tariffId != null));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les situations des élèves.');
      });
    return () => { cancelled = true; };
  }, [authorized, dashboard, schoolId, situationQuery, selectedTariffIds, yearId]);

  useEffect(() => {
    if (!authorized || !schoolId || !yearId || studentSituationStatus == null) {
      setStudentSituationStudentIds(null);
      return;
    }
    let cancelled = false;
    setStudentSituationStudentIds(null);
    apiFetch(`/api/accounting/situation?${studentSituationQuery}`)
      .then((result) => {
        if (!cancelled) {
          const rows = (result.rows ?? []) as SituationRow[];
          setStudentSituationStudentIds([...new Set(rows.map((row) => row.studentId))]);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error
            ? loadError.message
            : 'Impossible de filtrer les élèves par statut financier.');
        }
      });
    return () => { cancelled = true; };
  }, [authorized, schoolId, studentSituationQuery, studentSituationStatus, yearId]);

  useEffect(() => {
    if (!isClassSituationVisible || !authorized || !schoolId || !yearId || studentSituationClassId == null) {
      setClassSituationRows([]);
      setIsClassSituationLoading(false);
      return;
    }
    let cancelled = false;
    setIsClassSituationLoading(true);
    setClassSituationError('');
    apiFetch(`/api/accounting/situation?${classSituationQuery}`)
      .then((result) => {
        if (!cancelled) setClassSituationRows((result.rows ?? []) as ClassSituationRow[]);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setClassSituationRows([]);
          setClassSituationError(loadError instanceof Error
            ? loadError.message
            : 'Impossible de charger la situation financière de la classe.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsClassSituationLoading(false);
      });
    return () => { cancelled = true; };
  }, [authorized, classSituationQuery, isClassSituationVisible, schoolId, studentSituationClassId, yearId]);

  useEffect(() => {
    if (!authorized || !schoolId) return;
    let cancelled = false;
    apiFetch('/api/accounting/notifications/overdue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId, academicYearId: yearId }),
    }).catch((notificationError) => {
      if (!cancelled) setError(notificationError instanceof Error
        ? notificationError.message
        : 'Impossible de créer les notifications d’échéance.');
    });
    return () => { cancelled = true; };
  }, [authorized, schoolId, yearId]);

  useEffect(() => {
    if (!authorized || !studentId || !schoolId || !yearId) {
      setStudentFinance(null);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/accounting/students/${studentId}?schoolId=${schoolId}&academicYearId=${yearId}`)
      .then((result) => { if (!cancelled) setStudentFinance(result); })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Impossible de charger le compte élève.'); });
    return () => { cancelled = true; };
  }, [authorized, schoolId, studentId, yearId, dashboard]);

  const showError = (errorValue: unknown) => setError(errorValue instanceof Error ? errorValue.message : 'Opération impossible.');

  useEffect(() => () => {
    receiptObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    receiptObjectUrls.current.clear();
  }, []);

  useEffect(() => {
    if (showRubricPayment && paymentSituationRow) {
      paymentFormRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [paymentSituationRow, showRubricPayment]);

  const loadReceipt = async (receiptId: number) => {
    try {
      const blob = await apiFetchBlob(`/api/accounting/receipts/${receiptId}`);
      const url = URL.createObjectURL(blob);
      receiptObjectUrls.current.add(url);
      setReceiptUrls((current) => {
        const existingUrl = current[receiptId];
        if (existingUrl) {
          URL.revokeObjectURL(existingUrl);
          receiptObjectUrls.current.delete(existingUrl);
        }
        return { ...current, [receiptId]: url };
      });
    } catch (requestError) {
      showError(requestError);
    }
  };

  const downloadClassSituationPdf = async () => {
    if (!selectedClassSituation || !yearId || !isClassSituationVisible) return;
    setIsClassSituationPdfLoading(true);
    setClassSituationError('');
    try {
      const pdfQuery = new URLSearchParams(classSituationQuery);
      pdfQuery.delete('aggregate');
      pdfQuery.set('includeAllCategories', 'true');
      const detailResult = await apiFetch(`/api/accounting/situation?${pdfQuery.toString()}`);
      const pdfBytes = await generateClassSituationPdf({
        schoolName: selectedSchool?.officialName || selectedSchool?.name || 'Établissement',
        academicYearName: selectedYearName,
        className: selectedClassSituation.name,
        issuedAt: new Date(),
        rows: detailResult.rows ?? [],
      });
      const pdfBlob = new Blob([new Uint8Array(pdfBytes).buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `situation-financiere-${selectedClassSituation.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.pdf`;
      document.body.append(link);
      const revokeUrl = URL.revokeObjectURL.bind(URL);
      link.click();
      link.remove();
      window.setTimeout(() => revokeUrl(url), 1000);
    } catch (pdfError) {
      setClassSituationError(pdfError instanceof Error
        ? pdfError.message
        : 'Impossible de générer le PDF de la situation de classe.');
    } finally {
      setIsClassSituationPdfLoading(false);
    }
  };

  const submitTariff = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanLabel = feeLabel.trim();
    const parsedAmount = Number(amount);
    const classIdsToConfigure = configurationMode === 'single'
      ? selectedClassId ? [selectedClassId] : []
      : rangeClasses.map((item) => item.id);
    if (!schoolId || !yearId || classIdsToConfigure.length === 0 || !cleanLabel
      || !Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      setError(configurationMode === 'single'
        ? 'Saisissez un libellé, une classe et un montant entier supérieur à zéro.'
        : 'Sélectionnez une plage de classes dans l’ordre pédagogique et un montant entier supérieur à zéro.');
      return;
    }
    if (configurationMode === 'range' && !rangeHasPedagogicalOrder) {
      setError('L’ordre pédagogique des classes n’est pas disponible pour cette année scolaire.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (configurationMode === 'range') {
        await apiFetch('/api/accounting/tariffs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schoolId,
            academicYearId: yearId,
            classFromId: rangeStartClassId,
            classToId: rangeEndClassId,
            label: cleanLabel,
            amount: parsedAmount,
          }),
        });
      } else {
        await apiFetch(editingTariffId == null
          ? '/api/accounting/tariffs'
          : `/api/accounting/tariffs/${editingTariffId}`, {
          method: editingTariffId == null ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingTariffId == null
            ? { schoolId, academicYearId: yearId, classId: selectedClassId, label: cleanLabel, amount: parsedAmount }
            : {
            schoolId,
            academicYearId: yearId,
            ...(configurationMode === 'single'
              ? { classId: selectedClassId }
              : { classFromId: rangeStartClassId, classToId: rangeEndClassId }),
            amount: parsedAmount,
            label: cleanLabel,
            }),
        });
      }
      const [rows, currentCategories, currentSituation, currentDashboard] = await Promise.all([
        apiFetch(`/api/accounting/tariffs?${accountQuery}${yearQuery}`),
        apiFetch(`/api/accounting/categories?${accountQuery}`),
        apiFetch(`/api/accounting/situation?schoolId=${schoolId}&academicYearId=${yearId}`),
        apiFetch(`/api/accounting/dashboard?${accountQuery}${yearQuery}`),
      ]);
      setTariffs(rows);
      setCategories(currentCategories);
      setSituationRows(currentSituation.rows ?? []);
      setDashboard(currentDashboard);
      if (studentId) {
        setStudentFinance(await apiFetch(`/api/accounting/students/${studentId}?schoolId=${schoolId}&academicYearId=${yearId}`));
      }
      setNotice(configurationMode === 'range'
        ? 'Un tarif a été configuré pour toute la plage de classes.'
        : editingTariffId != null
          ? 'Frais modifié. Les paiements et reçus existants restent inchangés.'
          : 'Frais enregistré.');
      setIsFeeFormOpen(false);
      setEditingTariffId(null);
      setConfigurationMode('single');
      setFeeLabel('');
      setSelectedClassId(null);
      setRangeStartClassId(null);
      setRangeEndClassId(null);
      setAmount('');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const deleteTariff = async (tariff: Tariff) => {
    if (!schoolId || !window.confirm(`Supprimer le tarif « ${tariff.categoryLabel} — ${tariff.className} » ?`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch(`/api/accounting/tariffs/${tariff.id}?schoolId=${schoolId}`, { method: 'DELETE' });
      const rows = await apiFetch(`/api/accounting/tariffs?${accountQuery}${yearQuery}`);
      setTariffs(rows);
      setSelectedTariffIds((current) => current.filter((id) => id !== tariff.id));
      setNotice(result.archived
        ? 'Tarif archivé car il est lié à l’historique comptable.'
        : 'Tarif supprimé.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const createObligation = async (
    sourceId: number,
    categoryCode: string,
    enrollmentKind?: string,
    isFee = false,
  ) => {
    if (!schoolId || !yearId || !studentId) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch('/api/accounting/obligations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId,
          studentId,
          academicYearId: yearId,
          ...(isFee ? { feeDefinitionId: sourceId } : { tariffId: sourceId }),
          enrollmentKind: categoryCode === 'enrollment' ? enrollmentKind : undefined,
        }),
      });
      const result = await apiFetch(`/api/accounting/students/${studentId}?schoolId=${schoolId}&academicYearId=${yearId}`);
      setStudentFinance(result);
      setNotice('Obligation créée avec un instantané du tarif.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!schoolId || !yearId || !studentId || (!feePaymentMode && !multiPaymentEnabled && !paymentCategoryId)) return;
    const usesTariffAllocations = feePaymentMode || multiPaymentEnabled;
    const selectedLines = usesTariffAllocations
      ? Object.entries(multiPaymentAmounts).map(([tariffId, lineAmount]) => ({
        tariffId: Number(tariffId),
        amount: Number(lineAmount),
        category: studentFinance?.categories?.find((item: any) => item.tariffId === Number(tariffId)),
      }))
      : [];
    const invalidLine = selectedLines.some((line) => !line.category
      || !Number.isSafeInteger(line.amount)
      || line.amount <= 0
      || line.amount > line.category.remaining);
    const paidAmount = usesTariffAllocations
      ? selectedLines.reduce((sum, line) => sum + (Number.isSafeInteger(line.amount) ? line.amount : 0), 0)
      : Number(paymentAmount);
    if (usesTariffAllocations
      ? selectedLines.length === 0 || invalidLine
      : !Number.isSafeInteger(paidAmount) || paidAmount <= 0 || paidAmount > paymentScope.remaining) {
      setError(usesTariffAllocations
        ? 'Saisissez pour chaque frais sélectionné un montant entier supérieur à 0 et ne dépassant pas son reste à payer.'
        : 'Le montant payé doit être supérieur à 0 et ne pas dépasser le reste à payer.');
      return;
    }
    const paymentRequest = {
      schoolId,
      studentId,
      academicYearId: yearId,
      method: paymentMethod,
      reference: paymentReference,
      ...(usesTariffAllocations
        ? { allocations: selectedLines.map(({ tariffId, amount: lineAmount }) => ({ tariffId, amount: lineAmount })) }
        : { amount: paidAmount, categoryId: paymentCategoryId }),
    };
    const fingerprint = JSON.stringify(paymentRequest);
    if (paymentAttempt.current?.fingerprint !== fingerprint) {
      paymentAttempt.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    }
    setBusy(true);
    setError('');
    try {
      const payment = await apiFetch('/api/accounting/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...paymentRequest,
          idempotencyKey: paymentAttempt.current.idempotencyKey,
        }),
      });
      const blob = await apiFetchBlob(`/api/accounting/receipts/${payment.receipt.id}`);
      const url = URL.createObjectURL(blob);
      receiptObjectUrls.current.add(url);
      setReceiptUrls((current) => ({ ...current, [payment.receipt.id]: url }));
      setIssuedReceipt({ url, number: payment.receipt.receiptNumber });
      const [statement, currentDashboard] = await Promise.all([
        apiFetch(`/api/accounting/students/${studentId}?schoolId=${schoolId}&academicYearId=${yearId}`),
        apiFetch(`/api/accounting/dashboard?${accountQuery}${yearQuery}`),
      ]);
      setStudentFinance(statement);
      setDashboard(currentDashboard);
      const currentSituation = await apiFetch(`/api/accounting/situation?schoolId=${schoolId}&academicYearId=${yearId}`);
      setSituationRows(currentSituation.rows ?? []);
      setFeesCashSummary(await apiFetch(`/api/accounting/cash?${feesCashQuery}`));
      const refreshedRow = (currentSituation.rows ?? []).find((row: SituationRow) =>
        row.studentId === studentId && row.categoryId === paymentCategoryId);
      if (refreshedRow) setPaymentSituationRow(refreshedRow);
      setPaymentAmount('');
      setFeePaymentMode(false);
      setMultiPaymentEnabled(false);
      setMultiPaymentAmounts({});
      setPaymentReference('');
      paymentAttempt.current = null;
      setNotice(`Paiement enregistré — reçu ${payment.receipt.receiptNumber}.`);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const renderPaymentForm = () => {
    if (!selectedPaymentStudent && !activeRubricRow) return null;
    const multiPaymentCategories = feePaymentMode
      ? selectedFeePaymentCategories
      : (studentFinance?.student?.id === studentId ? studentFinance?.categories ?? [] : [])
        .filter((category: any) => category.tariffId && category.remaining > 0);
    const multiPaymentTotal = feePaymentMode ? feePaymentTotal : Object.values(multiPaymentAmounts)
      .reduce((sum, lineAmount) => sum + (Number(lineAmount) || 0), 0);
    const displayedPaymentScope = feePaymentMode ? feePaymentScope : paymentScope;
    const hasInvalidMultiAmount = Object.entries(multiPaymentAmounts).some(([tariffId, lineAmount]) => {
      const category = multiPaymentCategories.find((item: any) => item.tariffId === Number(tariffId));
      const parsed = Number(lineAmount);
      return !category || !Number.isSafeInteger(parsed) || parsed <= 0 || parsed > category.remaining;
    });
    return (
      <div ref={paymentFormRef} className="scroll-mt-24 rounded-xl">
      <form onSubmit={submitPayment} className="grid gap-3 rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h3 className="text-lg font-black text-indigo-950">
            Encaissement — {feePaymentMode
              ? selectedFeePaymentCategories.map((category: any) => category.label).join(' + ') || 'Frais sélectionnés'
              : selectedPaymentCategoryLabel}
          </h3>
          <p className="mt-1 text-sm text-slate-700">
            Élève : {selectedPaymentStudent
              ? `${selectedPaymentStudent.firstName} ${selectedPaymentStudent.lastName}`
              : `${activeRubricRow?.firstName} ${activeRubricRow?.lastName}`}
            {' · '}Classe : {selectedPaymentStudent?.className ?? activeRubricRow?.className ?? 'Sans classe'}
            {' · '}Année : {selectedYearName}
          </p>
        </div>
        <p className="sm:col-span-2 text-sm font-semibold text-slate-800">
          Montant attendu : {formatMoney(displayedPaymentScope.due)}
          {' · '}Déjà payé : {formatMoney(displayedPaymentScope.paid)}
          {' · '}Reste à payer : {formatMoney(displayedPaymentScope.remaining)}
        </p>
        {!feePaymentMode && !multiPaymentEnabled && <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Montant payé aujourd'hui (XOF)
          <input aria-label="Montant payé aujourd'hui" className="rounded-lg border border-slate-300 bg-white p-2" type="number" min="1" max={paymentScope.remaining || undefined} step="1" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="Saisir le montant réellement payé" />
        </label>}
        {!feePaymentMode && <div className="sm:col-span-2">
          <button type="button" className="text-sm font-semibold text-indigo-700 underline" onClick={() => {
            if (!multiPaymentEnabled && paymentCategoryId != null) {
              const selectedCategory = multiPaymentCategories.find((category: any) => category.id === paymentCategoryId);
              setMultiPaymentAmounts(selectedCategory?.tariffId ? { [selectedCategory.tariffId]: '' } : {});
            }
            setMultiPaymentEnabled(!multiPaymentEnabled);
            setError('');
          }}>
            {multiPaymentEnabled ? 'Revenir à un seul frais' : 'Encaisser plusieurs frais en une opération'}
          </button>
        </div>}
        {(feePaymentMode || multiPaymentEnabled) && (
          <div className="sm:col-span-2 space-y-2 rounded-lg border border-indigo-100 bg-white p-3">
            {multiPaymentCategories.map((category: any) => {
              const selected = feePaymentMode || Object.prototype.hasOwnProperty.call(multiPaymentAmounts, category.tariffId);
              return (
                <div key={category.tariffId} className="grid gap-2 border-b border-slate-100 py-2 last:border-0 sm:grid-cols-[1fr_12rem]">
                  <label className="flex items-start gap-2 text-sm">
                    {!feePaymentMode && <input type="checkbox" checked={selected} onChange={(event) => setMultiPaymentAmounts((current) => {
                      const next = { ...current };
                      if (event.target.checked) next[category.tariffId] = '';
                      else delete next[category.tariffId];
                      return next;
                    })} />}
                    <span><strong>{category.label}</strong><span className="block text-xs text-slate-500">Reste : {formatMoney(category.remaining)}</span></span>
                  </label>
                  {selected && <label className="grid gap-1 text-xs font-semibold text-slate-600">Montant affecté
                    <input aria-label={`Montant pour ${category.label}`} type="number" min="1" max={category.remaining} step="1" value={multiPaymentAmounts[category.tariffId] ?? ''} onChange={(event) => setMultiPaymentAmounts((current) => ({ ...current, [category.tariffId]: event.target.value }))} className="rounded-lg border border-slate-300 p-2 text-sm" />
                  </label>}
                </div>
              );
            })}
            {!multiPaymentCategories.length && <p className="text-sm text-slate-500">Aucun frais sélectionné avec un reste à payer pour cet élève.</p>}
            <p className="text-right text-sm font-bold">Total du paiement : {formatMoney(multiPaymentTotal)}</p>
          </div>
        )}
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Mode de paiement
          <select aria-label="Mode de paiement" className="rounded-lg border border-slate-300 bg-white p-2" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
            <option value="cash">Espèces</option><option value="tmoney">TMoney</option><option value="flooz">Flooz</option><option value="bank_transfer">Virement bancaire</option><option value="check">Chèque</option><option value="other">Autre</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">
          Référence (facultative)
          <input aria-label="Référence facultative" className="rounded-lg border border-slate-300 bg-white p-2" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="À renseigner selon le mode de paiement" />
        </label>
        {!feePaymentMode && !multiPaymentEnabled && <p className="sm:col-span-2 text-sm text-slate-700">
          Après paiement, reste à payer : {formatMoney(Math.max(0, paymentScope.remaining - Number(paymentAmount || 0)))}.
        </p>}
        <button className="rounded-lg bg-indigo-700 px-4 py-3 font-black uppercase tracking-wide text-white shadow disabled:opacity-50 sm:col-span-2" disabled={busy
          || (feePaymentMode || multiPaymentEnabled
            ? !Object.keys(multiPaymentAmounts).length || hasInvalidMultiAmount
            : !paymentCategoryId || !paymentScope.due || !Number.isSafeInteger(Number(paymentAmount)) || Number(paymentAmount) <= 0 || Number(paymentAmount) > paymentScope.remaining)}>
          {busy ? 'Traitement…' : 'Encaisser et générer le reçu'}
        </button>
      </form>
      </div>
    );
  };

  return (
    !authorized ? null :
    <section className="space-y-6" aria-label="Comptabilité scolaire">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Gestion financière</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Comptabilité</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          {userRole === 'super_admin' && (
            <select className="rounded-lg border border-slate-200 p-2 text-sm" value={schoolId ?? ''} onChange={(event) => {
              const nextSchoolId = Number(event.target.value) || null;
              setSchoolId(nextSchoolId);
              setYearId(years.find((year) => year.isActive
                && (!nextSchoolId || !year.schoolId || year.schoolId === nextSchoolId))?.id ?? null);
            }} aria-label="Établissement">
              <option value="">Choisir une école</option>
              {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          )}
          <select className="rounded-lg border border-slate-200 p-2 text-sm" value={yearId ?? ''} onChange={(event) => setYearId(Number(event.target.value) || null)} aria-label="Année scolaire">
            <option value="">Toutes les années</option>
            {visibleYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
          </select>
        </div>
      </header>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
      {issuedReceipt && (
        <a className="inline-block rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800"
          href={issuedReceipt.url} target="_blank" rel="noreferrer">
          Reçu {issuedReceipt.number} — ouvrir / imprimer le PDF
        </a>
      )}
      {!schoolId && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Sélectionnez un établissement pour accéder à ses données financières.</p>}
      {schoolId && (
        <>
          <nav className="flex flex-wrap gap-2" aria-label="Sections comptables">
            {([
              ['dashboard', 'Tableau de bord'],
              ['configuration', 'Configuration des frais'],
              ['students', 'Situation des élèves'],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setTab('fees')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'fees' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              Frais scolaires
            </button>
          </nav>

          {tab === 'dashboard' && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Caisse totale', dashboard?.total, 'received'],
                  ...categories.filter((category) => category.isEnabled).map((category) => [
                    categoryDisplayLabel(category.code, category.label),
                    dashboard?.categories?.[category.code],
                    'received',
                  ]),
                  ['Total attendu', dashboard?.expected, 'expected'],
                  ['Reste à recouvrer', dashboard?.remaining, 'remaining'],
                ].map(([label, value, tone]) => {
                  const styles = tone === 'expected'
                    ? dashboardMetricStyles.expected
                    : tone === 'remaining'
                      ? dashboardMetricStyles.remaining
                      : dashboardMetricStyles.received;
                  return (
                    <article
                      key={String(label)}
                      className={`min-w-0 rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5 ${styles.card}`}
                    >
                      <p className={`text-xs font-bold uppercase tracking-wide ${styles.label}`}>{label}</p>
                      <p className={`mt-3 break-words text-xl font-black leading-tight tracking-tight tabular-nums sm:text-2xl ${styles.value}`}>
                        {formatMoney(Number(value || 0))}
                      </p>
                    </article>
                  );
                })}
              </div>
              <div className="grid gap-3 rounded-xl border border-slate-100 p-4 sm:grid-cols-3 xl:grid-cols-6">
                <input type="date" aria-label="Début période caisse" value={cashFilters.startDate} onChange={(event) => setCashFilters((filters) => ({ ...filters, startDate: event.target.value }))} className="rounded-lg border border-slate-200 p-2 text-sm" />
                <input type="date" aria-label="Fin période caisse" value={cashFilters.endDate} onChange={(event) => setCashFilters((filters) => ({ ...filters, endDate: event.target.value }))} className="rounded-lg border border-slate-200 p-2 text-sm" />
                <select aria-label="Filtrer la caisse par catégorie" value={cashFilters.categoryId} onChange={(event) => setCashFilters((filters) => ({ ...filters, categoryId: event.target.value }))} className="rounded-lg border border-slate-200 p-2 text-sm">
                  <option value="">Toutes les catégories</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>
                    {categoryDisplayLabel(category.code, category.label, Number(cashFilters.classId) || null)}
                  </option>)}
                </select>
                <select aria-label="Filtrer la caisse par classe" value={cashFilters.classId} onChange={(event) => setCashFilters((filters) => ({ ...filters, classId: event.target.value }))} className="rounded-lg border border-slate-200 p-2 text-sm">
                  <option value="">Toutes les classes</option>
                  {visibleClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select aria-label="Filtrer la caisse par élève" value={cashFilters.studentId} onChange={(event) => setCashFilters((filters) => ({ ...filters, studentId: event.target.value }))} className="rounded-lg border border-slate-200 p-2 text-sm">
                  <option value="">Tous les élèves</option>
                  {visibleStudents.map((student) => <option key={student.id} value={student.id}>{student.lastName} {student.firstName}</option>)}
                </select>
                <select aria-label="Filtrer la caisse par mode de paiement" value={cashFilters.method} onChange={(event) => setCashFilters((filters) => ({ ...filters, method: event.target.value }))} className="rounded-lg border border-slate-200 p-2 text-sm">
                  <option value="">Tous les modes</option>
                  <option value="cash">Espèces</option><option value="tmoney">TMoney</option><option value="flooz">Flooz</option><option value="bank_transfer">Virement</option><option value="check">Chèque</option><option value="other">Autre</option>
                </select>
                <div className="grid gap-2 sm:col-span-3 sm:grid-cols-2 xl:col-span-6 xl:grid-cols-4">
                  {[
                    ['Total encaissé filtré', cashSummary?.total, 'received'],
                    ['Dû', cashSummary?.expected, 'expected'],
                    ['Payé net', cashSummary?.paid, 'received'],
                    ['Reste', cashSummary?.remaining, 'remaining'],
                  ].map(([label, value, tone]) => {
                    const styles = tone === 'expected'
                      ? dashboardMetricStyles.expected
                      : tone === 'remaining'
                        ? dashboardMetricStyles.remaining
                        : dashboardMetricStyles.received;
                    return (
                      <article key={String(label)} className={`min-w-0 rounded-xl border px-3 py-2.5 ${styles.card}`}>
                        <p className={`text-[11px] font-semibold ${styles.label}`}>{label}</p>
                        <p className={`mt-1 break-words text-base font-black tabular-nums ${styles.value}`}>
                          {formatMoney(Number(value ?? 0))}
                        </p>
                      </article>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h2 className="font-bold text-slate-800">Indicateurs</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['Échéances impayées', dashboard?.overdueInstallmentCount ?? 0, 'overdue'],
                    ['Échéances à venir', dashboard?.upcomingInstallmentCount ?? 0, 'upcoming'],
                    ['Élèves concernés', dashboard?.studentCount ?? 0, 'students'],
                    ['Paiements récents', dashboard?.recentPaymentCount ?? 0, 'recent'],
                  ].map(([label, value, tone]) => {
                    const styles = tone === 'overdue'
                      ? dashboardMetricStyles.overdue
                      : tone === 'upcoming'
                        ? dashboardMetricStyles.upcoming
                        : tone === 'recent'
                          ? dashboardMetricStyles.recent
                          : dashboardMetricStyles.students;
                    return (
                      <article key={String(label)} className={`rounded-xl border p-3 ${styles.card}`}>
                        <p className={`text-xs font-semibold ${styles.label}`}>{label}</p>
                        <p className={`mt-2 text-2xl font-black tabular-nums ${styles.value}`}>{value}</p>
                      </article>
                    );
                  })}
                </div>
                <p className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  {Object.entries(dashboard?.methods ?? {}).map(([method, value]) => `${method} : ${formatMoney(Number(value))}`).join(' · ') || 'Aucun encaissement'}
                </p>
              </div>
            </div>
          )}

          {tab === 'fees' && (
            <section className="space-y-5" aria-label="Frais scolaires">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Frais scolaires</h2>
                <p className="mt-1 text-sm text-slate-500">Sélectionnez un ou plusieurs frais configurés pour filtrer les paiements et les situations.</p>
              </div>
              {!yearId && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Sélectionnez une année scolaire pour afficher les frais configurés.</p>}
              {yearId && (
                <div className="space-y-3 rounded-xl border border-slate-100 p-4">
                  <h3 className="text-sm font-bold text-slate-700">Frais de l’année sélectionnée</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div ref={feeLabelMenuRef} className="relative">
                      <button
                        type="button"
                        aria-label="Libellé des tarifs disponibles"
                        aria-expanded={isFeeLabelMenuOpen}
                        aria-controls="available-fee-label-options"
                        onClick={() => setIsFeeLabelMenuOpen((open) => !open)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setIsFeeLabelMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-left text-sm"
                      >
                        <span className="truncate">{feeLabelFilterSummary}</span>
                        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${isFeeLabelMenuOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isFeeLabelMenuOpen && (
                        <div
                          id="available-fee-label-options"
                          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
                        >
                          <button
                            type="button"
                            aria-pressed={feeLabelFilter.length === 0}
                            onClick={() => setFeeLabelFilter([])}
                            className="w-full rounded px-2 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Tous les libellés
                          </button>
                          <fieldset className="mt-1 space-y-1 border-t border-slate-100 pt-2">
                            <legend className="sr-only">Sélectionner les libellés</legend>
                            {feeLabelOptions.map((option) => (
                              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                                <input
                                  type="checkbox"
                                  checked={feeLabelFilter.includes(option.value)}
                                  onChange={(event) => setFeeLabelFilter((current) => event.target.checked
                                    ? [...current, option.value]
                                    : current.filter((label) => label !== option.value))}
                                />
                                {option.label}
                              </label>
                            ))}
                          </fieldset>
                        </div>
                      )}
                    </div>
                    <select
                      value={feeClassFilterId ?? ''}
                      onChange={(event) => setFeeClassFilterId(Number(event.target.value) || null)}
                      aria-label="Classe des tarifs disponibles"
                      className="rounded-lg border border-slate-200 p-2 text-sm"
                    >
                      <option value="">Toutes les classes</option>
                      {situationClasses.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                  <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <legend className="sr-only">Frais de l’année sélectionnée</legend>
                    {filteredYearTariffs.map((tariff) => (
                      <label key={tariff.id} className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                        <input type="checkbox" checked={(selectedTariffIds ?? []).includes(tariff.id)} onChange={(event) => {
                          setSelectedTariffIds((current) => event.target.checked
                            ? [...(current ?? []), tariff.id]
                            : (current ?? []).filter((id) => id !== tariff.id));
                        }} />
                        <span><strong>{tariff.categoryLabel}</strong><span className="block text-xs text-slate-500">{tariff.className} · {formatMoney(tariff.amount)}</span></span>
                      </label>
                    ))}
                    {filteredYearTariffs.length === 0 && (
                      <p className="text-sm text-slate-500">Aucun frais ne correspond aux filtres sélectionnés.</p>
                    )}
                  </fieldset>
                </div>
              )}
              <div className="rounded-xl border border-slate-100 p-4">
                <button
                  type="button"
                  aria-expanded={isFeesCashDetailsOpen}
                  aria-controls="selected-fee-payments-details"
                  onClick={() => setIsFeesCashDetailsOpen((open) => !open)}
                  className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg text-left transition-colors hover:bg-slate-50"
                  data-testid="selected-fee-payments-toggle"
                >
                  <span>
                    <span className="block font-bold">Paiements correspondant aux frais sélectionnés</span>
                    <span className="mt-1 block text-sm font-semibold text-slate-700">
                      Total encaissé : {formatMoney(filteredFeesCashTotal)}
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${isFeesCashDetailsOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                <div className="mt-3 flex flex-wrap gap-3">
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Filtrer par date
                    <span className="flex items-center gap-2">
                      <select
                        aria-label="Date des paiements des frais sélectionnés"
                        value={feesCashDateMode}
                        onChange={(event) => {
                          const mode = event.target.value === 'specific' ? 'specific' : 'all';
                          setFeesCashDateMode(mode);
                          if (mode === 'all') setFeesCashDateFilter('');
                        }}
                        className="rounded-lg border border-slate-200 p-2 text-sm font-normal"
                      >
                        <option value="all">Toutes les dates</option>
                        <option value="specific">Une date précise</option>
                      </select>
                      {feesCashDateMode === 'specific' && (
                        <input
                          type="date"
                          aria-label="Date précise des paiements"
                          value={feesCashDateFilter}
                          onChange={(event) => setFeesCashDateFilter(event.target.value)}
                          className="rounded-lg border border-slate-200 p-2 text-sm font-normal"
                        />
                      )}
                    </span>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Filtrer par classe
                    <select
                      aria-label="Classe des paiements des frais sélectionnés"
                      value={feesCashClassFilterId ?? ''}
                      onChange={(event) => setFeesCashClassFilterId(Number(event.target.value) || null)}
                      className="rounded-lg border border-slate-200 p-2 text-sm font-normal"
                    >
                      <option value="">Toutes les classes</option>
                      {situationClasses.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {isFeesCashDetailsOpen && <div id="selected-fee-payments-details">
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Élève</th><th className="px-3 py-2">Frais</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2">Montant affecté</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredFeesCashAllocations.map((allocation: any) => (
                          <tr key={allocation.allocationId}><td className="px-3 py-2">{new Date(allocation.paidAt).toLocaleDateString('fr-FR')}</td><td className="px-3 py-2">{allocation.studentName}</td><td className="px-3 py-2">{allocation.categoryLabel}</td><td className="px-3 py-2">{allocation.method}</td><td className="px-3 py-2 font-semibold">{formatMoney(allocation.amount)}</td></tr>
                        ))}
                        {!filteredFeesCashAllocations.length && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Aucun paiement ne correspond aux filtres sélectionnés.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>}
              </div>
              {yearId && (() => {
                const rows = selectedFeeSituationRows;
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-bold">Élèves concernés par les frais sélectionnés</h3>
                      <select className="rounded-lg border border-slate-200 p-2 text-sm" value={situationClassId ?? ''} onChange={(event) => {
                        setSituationClassId(Number(event.target.value) || null);
                        setPaymentSituationRow(null);
                        setShowRubricPayment(false);
                      }} aria-label="Classe des frais sélectionnés">
                        <option value="">Toutes les classes</option>
                        {situationClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Élève</th><th className="px-4 py-3">Frais</th><th className="px-4 py-3">À payer</th><th className="px-4 py-3">Déjà payé</th><th className="px-4 py-3">Reste</th><th className="px-4 py-3">Action</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((row) => (
                            <tr key={`${row.studentId}-${row.tariffId}`}>
                              <td className="px-4 py-3 font-semibold">{row.lastName} {row.firstName}<span className="block text-xs font-normal text-slate-500">{row.className}</span></td>
                              <td className="px-4 py-3">{row.categoryLabel}</td><td className="px-4 py-3">{formatMoney(row.due)}</td><td className="px-4 py-3">{formatMoney(row.paid)}</td><td className="px-4 py-3 font-semibold">{formatMoney(row.remaining)}</td>
                              <td className="px-4 py-3"><button type="button" disabled={row.remaining <= 0} className="rounded-lg bg-indigo-600 px-3 py-2 font-bold text-white disabled:opacity-50" onClick={() => {
                                setStudentId(row.studentId);
                                setPaymentSituationRow(row);
                                setPaymentCategoryId(row.categoryId);
                                setPaymentAmount('');
                                setFeePaymentMode(true);
                                setMultiPaymentEnabled(false);
                                setMultiPaymentAmounts({});
                                setError('');
                                setShowRubricPayment(true);
                              }}>Encaisser</button></td>
                            </tr>
                          ))}
                          {!rows.length && <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-500">Aucun élève avec une situation pour les frais sélectionnés.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    {showRubricPayment && paymentSituationRow && (
                      <div><p className="mb-3 text-sm text-slate-500">Encaissement pour {paymentSituationRow.className} · {selectedYearName}</p>{renderPaymentForm()}</div>
                    )}
                  </div>
                );
              })()}
            </section>
          )}

          {tab === 'students' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Filtrer par classe
                  <select
                    className="min-w-52 rounded-lg border border-slate-200 p-2 text-sm font-normal"
                    value={studentSituationClassId ?? ''}
                    onChange={(event) => {
                      setStudentSituationClassId(Number(event.target.value) || null);
                      setStudentId(null);
                      setStudentFinance(null);
                    }}
                    aria-label="Filtrer par classe"
                  >
                    <option value="">Toutes les classes</option>
                    {situationClasses.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Statut financier
                  <select
                    className="min-w-44 rounded-lg border border-slate-200 p-2 text-sm font-normal"
                    value={studentSituationStatus ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setStudentSituationStatus(value === 'paid' || value === 'partial' || value === 'unpaid'
                        ? value
                        : null);
                      setStudentId(null);
                      setStudentFinance(null);
                    }}
                    aria-label="Filtrer par statut financier"
                  >
                    <option value="">Tous</option>
                    <option value="paid">Soldé</option>
                    <option value="partial">Partiel</option>
                    <option value="unpaid">Impayé</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                  onClick={() => {
                    setStudentSituationClassId(null);
                    setStudentSituationStatus(null);
                    setStudentId(null);
                    setStudentFinance(null);
                  }}
                >
                  Réinitialiser les filtres
                </button>
                <select className="min-w-64 rounded-lg border border-slate-200 p-2 text-sm" value={studentId ?? ''} onChange={(event) => {
                  setStudentId(Number(event.target.value) || null);
                  setStudentFinance(null);
                  setFeePaymentMode(false);
                  setPaymentSituationRow(null);
                  setShowRubricPayment(false);
                }} aria-label="Élève">
                  <option value="">Rechercher un élève</option>
                  {filteredSituationStudents.map((student) => <option key={student.id} value={student.id}>{student.lastName} {student.firstName}</option>)}
                </select>
                <button
                  type="button"
                  disabled={studentSituationClassId == null || !yearId || isClassSituationLoading}
                  onClick={() => {
                    setIsClassSituationVisible(true);
                    setStudentId(null);
                    setStudentFinance(null);
                  }}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isClassSituationLoading ? 'Chargement…' : 'Voir la situation de la classe'}
                </button>
                <button
                  type="button"
                  disabled={!selectedClassSituation || !yearId || !isClassSituationVisible || isClassSituationLoading || isClassSituationPdfLoading}
                  onClick={downloadClassSituationPdf}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {isClassSituationPdfLoading ? 'Génération…' : 'Télécharger PDF'}
                </button>
              </div>
              {classSituationError && <p role="alert" className="text-sm text-rose-700">{classSituationError}</p>}
              {isClassSituationVisible && selectedClassSituation && (
                <section className="space-y-3 rounded-xl border border-slate-200 p-4" aria-label="Situation financière de la classe">
                  <div>
                    <h2 className="text-lg font-bold">Situation financière de la classe — {selectedClassSituation.name}</h2>
                    <p className="text-sm text-slate-500">{selectedSchool?.name ?? ''} · {selectedYearName}</p>
                  </div>
                  {isClassSituationLoading ? (
                    <p role="status" className="text-sm text-slate-500">Chargement de la situation financière de la classe…</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full min-w-[820px] text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-3 py-2">N°</th>
                              <th className="px-3 py-2">Élève</th>
                              <th className="px-3 py-2">Classe</th>
                              <th className="px-3 py-2 text-right">Montant dû</th>
                              <th className="px-3 py-2 text-right">Montant payé</th>
                              <th className="px-3 py-2 text-right">Reste à payer</th>
                              <th className="px-3 py-2">Statut</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {classSituationRows.map((row, index) => (
                              <tr key={row.studentId}>
                                <td className="px-3 py-2">{index + 1}</td>
                                <td className="px-3 py-2 font-semibold">{row.lastName} {row.firstName}</td>
                                <td className="px-3 py-2">{row.className}</td>
                                <td className="px-3 py-2 text-right">{formatMoney(row.studentDue)}</td>
                                <td className="px-3 py-2 text-right">{formatMoney(row.studentPaid)}</td>
                                <td className="px-3 py-2 text-right font-semibold">{formatMoney(row.studentRemaining)}</td>
                                <td className="px-3 py-2">
                                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.studentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' : row.studentStatus === 'partial' ? 'bg-amber-100 text-amber-800' : row.studentStatus === 'unpaid' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
                                    {formatStatus(row.studentStatus)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {!classSituationRows.length && (
                              <tr>
                                <td colSpan={7} className="px-3 py-5 text-center text-slate-500">
                                  Aucun élève ne correspond à cette classe et aux filtres sélectionnés.
                                </td>
                              </tr>
                            )}
                          </tbody>
                          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                            <tr>
                              <td colSpan={3} className="px-3 py-2">Totaux</td>
                              <td className="px-3 py-2 text-right">{formatMoney(classSituationTotals.due)}</td>
                              <td className="px-3 py-2 text-right">{formatMoney(classSituationTotals.paid)}</td>
                              <td className="px-3 py-2 text-right">{formatMoney(classSituationTotals.remaining)}</td>
                              <td className="px-3 py-2">{classSituationRows.length} élève(s)</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              )}
              {studentId && yearId && studentFinance && (
                <>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <h2 className="font-bold">{studentFinance.student.firstName} {studentFinance.student.lastName}</h2>
                    <p className="text-sm text-slate-500">Matricule {studentFinance.student.matricule} · {studentFinance.student.className ?? 'Sans classe'}</p>
                    <p className="mt-2 text-sm font-semibold">
                      Total à payer {formatMoney(studentFinance.totals.due)} · Déjà payé {formatMoney(studentFinance.totals.paid)} · Reste {formatMoney(Math.max(0, studentFinance.totals.due - studentFinance.totals.paid))}
                    </p>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr><th className="px-4 py-3">Frais</th><th className="px-4 py-3">À payer</th><th className="px-4 py-3">Payé</th><th className="px-4 py-3">Reste</th><th className="px-4 py-3">Statut</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {studentFinance.categories.filter((category: any) => category.due > 0).map((category: any) => (
                          <tr key={category.id}>
                            <td className="px-4 py-3 font-semibold">{category.label}</td>
                            <td className="px-4 py-3">{formatMoney(category.due)}</td>
                            <td className="px-4 py-3">{formatMoney(category.paid)}</td>
                            <td className="px-4 py-3 font-semibold">{formatMoney(Math.max(0, category.remaining))}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${category.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : category.status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                                {formatStatus(category.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 font-bold">
                          <td className="px-4 py-3">Total</td>
                          <td className="px-4 py-3">{formatMoney(studentFinance.totals.due)}</td>
                          <td className="px-4 py-3">{formatMoney(studentFinance.totals.paid)}</td>
                          <td className="px-4 py-3">{formatMoney(Math.max(0, studentFinance.totals.due - studentFinance.totals.paid))}</td>
                          <td className="px-4 py-3">{formatStatus(formatTotalsStatus(studentFinance.totals.due, studentFinance.totals.paid))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {studentFinance.payments.map((payment: any) => (
                    <p key={payment.id} className="text-sm text-slate-600">
                      Paiement {payment.paidAt} · {formatMoney(payment.amount)} · {payment.method} · {payment.receiptNumber ?? 'Reçu indisponible'}
                      {payment.receiptId && (receiptUrls[payment.receiptId]
                        ? <a className="ml-2 text-indigo-700 underline" href={receiptUrls[payment.receiptId]} target="_blank" rel="noreferrer">Voir / imprimer le reçu</a>
                        : <button type="button" className="ml-2 text-indigo-700 underline" onClick={() => loadReceipt(payment.receiptId)}>Télécharger le reçu PDF</button>)}
                    </p>
                  ))}
                  <div className="space-y-3">
                    <select required className="rounded-lg border border-slate-200 p-2" value={paymentCategoryId ?? ''} onChange={(event) => {
                      setPaymentCategoryId(Number(event.target.value) || null);
                      setPaymentSituationRow(null);
                    }} aria-label="Type de frais à encaisser">
                      <option value="">Choisir un type de frais</option>
                      {studentFinance.categories.filter((category: any) => category.due > 0 && category.remaining > 0).map((category: any) => (
                        <option key={category.id} value={category.id}>{category.label}</option>
                      ))}
                    </select>
                    {renderPaymentForm()}
                  </div>
                  {fees.filter((fee) => fee.status === 'active'
                    && fee.academicYearId === yearId
                    && (fee.studentId == null || fee.studentId === studentId)
                    && (fee.classId == null || fee.classId === studentFinance.student.classId)).length > 0 && (
                    <div className="rounded-xl border border-slate-100 p-4">
                      <h3 className="font-bold">Frais supplémentaires validés</h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {fees.filter((fee) => fee.status === 'active'
                          && fee.academicYearId === yearId
                          && (fee.studentId == null || fee.studentId === studentId)
                          && (fee.classId == null || fee.classId === studentFinance.student.classId)).map((fee) => (
                          <button key={fee.id} type="button" disabled={busy}
                            onClick={() => createObligation(fee.id, categories.find((category) => category.id === fee.categoryId)?.code ?? 'other', undefined, true)}
                            className="rounded-lg bg-slate-100 px-3 py-2 text-sm">
                            Ajouter {fee.label} · {formatMoney(fee.amount)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {studentId && !yearId && <p className="text-sm text-amber-700">Sélectionnez une année scolaire pour afficher les obligations et paiements.</p>}
              {studentId && yearId && !studentFinance && <p className="text-sm text-slate-500">Chargement de la situation financière…</p>}
            </div>
          )}

          {tab === 'configuration' && (
            <section className="space-y-4" aria-label="Configuration des frais">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">Configuration des frais</h2>
                  <p className="mt-1 text-sm text-slate-500">Configurez les montants à payer par classe pour l’année sélectionnée.</p>
                </div>
                {!isFeeFormOpen && (
                  <button type="button" disabled={busy} onClick={() => {
                    setEditingTariffId(null);
                    setConfigurationMode('single');
                    setFeeLabel('');
                    setSelectedClassId(null);
                    setRangeStartClassId(null);
                    setRangeEndClassId(null);
                    setAmount('');
                    setError('');
                    setIsFeeFormOpen(true);
                  }} className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white">
                    + Créer un frais
                  </button>
                )}
              </div>

              {isFeeFormOpen && (
                <form onSubmit={submitTariff} className="grid gap-3 rounded-xl border border-slate-100 p-4 sm:max-w-2xl sm:grid-cols-2">
                  <h3 className="sm:col-span-2 font-bold">{editingTariffId == null ? 'Créer un frais' : 'Modifier le frais'}</h3>
                  {editingTariffId == null && (
                    <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                      Mode de configuration
                      <select
                        aria-label="Mode de configuration"
                        className="rounded-lg border border-slate-200 p-2 font-normal"
                        value={configurationMode}
                        onChange={(event) => {
                          setConfigurationMode(event.target.value === 'range' ? 'range' : 'single');
                          setSelectedClassId(null);
                          setRangeStartClassId(null);
                          setRangeEndClassId(null);
                          setError('');
                        }}
                        disabled={busy}
                      >
                        <option value="single">Une seule classe</option>
                        <option value="range">Une plage de classes</option>
                      </select>
                    </label>
                  )}
                  <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                    Libellé
                    <input required maxLength={120} className="rounded-lg border border-slate-200 p-2 font-normal" value={feeLabel}
                      onChange={(event) => setFeeLabel(event.target.value)} placeholder="Saisir le libellé du frais"
                      disabled={busy} />
                  </label>
                  {duplicateTariff && configurationMode === 'single' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
                      <span>Ce frais existe déjà pour cette classe et cette année. Modifiez le frais existant.</span>
                      {editingTariffId == null && (
                        <button type="button" onClick={() => {
                          setEditingTariffId(duplicateTariff.id);
                          setFeeLabel(duplicateTariff.categoryLabel);
                          setAmount(String(duplicateTariff.amount));
                        }} className="rounded-lg bg-amber-100 px-3 py-1.5 font-bold">
                          Modifier le frais existant
                        </button>
                      )}
                    </div>
                  )}
                  {configurationMode === 'single' ? (
                    <label className="grid gap-1 text-sm font-semibold">
                      Classe
                      <select required className="rounded-lg border border-slate-200 p-2 font-normal" value={selectedClassId ?? ''}
                        onChange={(event) => setSelectedClassId(Number(event.target.value) || null)}
                        aria-label="Classe du frais" disabled={busy}>
                        <option value="">Sélectionner une classe</option>
                        {visibleClasses.filter((item) => item.academicYearId === yearId)
                          .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                  ) : (
                    <>
                      <label className="grid gap-1 text-sm font-semibold">
                        Classe de début
                        <select required className="rounded-lg border border-slate-200 p-2 font-normal" value={rangeStartClassId ?? ''}
                          onChange={(event) => setRangeStartClassId(Number(event.target.value) || null)}
                          aria-label="Classe de début" disabled={busy || !rangeHasPedagogicalOrder}>
                          <option value="">Sélectionner une classe de début</option>
                          {orderedConfigurationClasses.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">
                        Classe de fin
                        <select required className="rounded-lg border border-slate-200 p-2 font-normal" value={rangeEndClassId ?? ''}
                          onChange={(event) => setRangeEndClassId(Number(event.target.value) || null)}
                          aria-label="Classe de fin" disabled={busy || !rangeHasPedagogicalOrder}>
                          <option value="">Sélectionner une classe de fin</option>
                          {orderedConfigurationClasses.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </label>
                      {!rangeHasPedagogicalOrder && (
                        <p className="text-sm text-amber-700 sm:col-span-2">
                          L’ordre pédagogique des classes doit être configuré pour cette année scolaire avant de définir une plage.
                        </p>
                      )}
                      {rangeStartIndex >= 0 && rangeEndIndex >= 0 && rangeEndIndex < rangeStartIndex && (
                        <p role="alert" className="text-sm text-rose-700 sm:col-span-2">
                          La classe de fin doit être égale ou après la classe de début dans l’ordre pédagogique.
                        </p>
                      )}
                      {rangeClasses.length > 0 && (
                        <p className="text-sm text-slate-600 sm:col-span-2">
                          Classes concernées : {rangeClasses.map((item) => item.name).join(', ')}
                        </p>
                      )}
                    </>
                  )}
                  <label className="grid gap-1 text-sm font-semibold">
                    Montant
                    <span className="flex items-center gap-2">
                      <input required min="1" step="1" type="number" className="min-w-0 flex-1 rounded-lg border border-slate-200 p-2 font-normal"
                        aria-label="Montant" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Montant entier" />
                      <span className="font-normal text-slate-500">FCFA</span>
                    </span>
                  </label>
                  {!yearId && <p className="text-sm text-amber-700 sm:col-span-2">Sélectionnez d’abord une année scolaire.</p>}
                  <div className="flex justify-end gap-2 sm:col-span-2">
                    <button type="button" disabled={busy} onClick={() => {
                      setIsFeeFormOpen(false);
                      setEditingTariffId(null);
                      setConfigurationMode('single');
                      setFeeLabel('');
                      setSelectedClassId(null);
                      setRangeStartClassId(null);
                      setRangeEndClassId(null);
                      setAmount('');
                      setError('');
                    }} className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-700">
                      Annuler
                    </button>
                    <button type="submit" disabled={busy || !yearId
                      || (configurationMode === 'single'
                        ? !selectedClassId || Boolean(duplicateTariff)
                        : !rangeHasPedagogicalOrder || rangeClasses.length === 0)
                      || !feeLabel.trim()
                      || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0}
                      className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50">
                      Enregistrer
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2">
                <h3 className="font-bold">Frais configurés</h3>
                {tariffsForSelectedYear.map((tariff) => (
                  <article key={tariff.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-4">
                    <div>
                      <h4 className="font-bold text-slate-900">{tariff.categoryLabel}</h4>
                      <p className="text-sm text-slate-500">{tariff.className} · {selectedYearName}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-bold">{formatMoney(tariff.amount)}</span>
                      <button type="button" disabled={busy} onClick={() => {
                        setEditingTariffId(tariff.id);
                        setConfigurationMode(tariff.classId == null ? 'range' : 'single');
                        setFeeLabel(tariff.categoryLabel);
                        setSelectedClassId(tariff.classId);
                        setRangeStartClassId(tariff.classFromId ?? null);
                        setRangeEndClassId(tariff.classToId ?? null);
                        setAmount(String(tariff.amount));
                        setError('');
                        setIsFeeFormOpen(true);
                      }} className="rounded-lg bg-indigo-50 px-3 py-1.5 font-bold text-indigo-700">
                        Modifier
                      </button>
                      <button type="button" disabled={busy} onClick={() => { void deleteTariff(tariff); }}
                        className="rounded-lg bg-rose-50 px-3 py-1.5 font-bold text-rose-700">
                        Supprimer
                      </button>
                    </div>
                  </article>
                ))}
                {!tariffsForSelectedYear.length && (
                  <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Aucun frais configuré pour cette année scolaire.</p>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
