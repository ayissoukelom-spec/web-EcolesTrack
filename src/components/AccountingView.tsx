import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Download, Printer } from 'lucide-react';
import type { AcademicYear, Class, School, Student, UserRole } from '../types.ts';
import { apiFetch, apiFetchBlob } from '../lib/api.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  compareAccountingClassOrder,
  ACCOUNTING_ENROLLMENT_KINDS,
  getAccountingCategoryDisplayLabel,
  isAccountingEnrollmentKind,
  isStandardAccountingCategoryLabel,
  splitAmountBySchedule,
  STANDARD_ACCOUNTING_CATEGORY_LABELS,
  validateAccountingSchedule,
} from '../lib/accountingRules.ts';
import type { AccountingEnrollmentKind, AccountingScheduleItem } from '../lib/accountingRules.ts';
import { generateClassSituationPdf } from '../lib/classSituationPdf.ts';
import { buildClassSituationExcel } from '../lib/classSituationExcel.ts';
import type { ClassSituationExcelInstallment } from '../lib/classSituationExcel.ts';
import PaymentRemindersPanel from './PaymentRemindersPanel.tsx';
import AccountingAdjustmentWorkflow from './AccountingAdjustmentWorkflow.tsx';
import ModalSurface from './ModalSurface.tsx';

type Category = { id: number; code: string; label: string; isEnabled: boolean };
type Tariff = {
  id: number;
  schoolId?: number;
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
type Fee = { id: number; schoolId?: number; academicYearId: number; classId: number | null; studentId: number | null; categoryId: number; label: string; amount: number; status: string };
type AccountingTab = 'dashboard' | 'configuration' | 'fees' | 'students' | 'reminders' | 'history';
type PaymentConfirmation = {
  amount: number | null;
  studentName: string | null;
  feeLabels: string[];
  paidAtLabel: string | null;
  receiptNumber: string;
  remainingAfterPayment: number | null;
  warnings: string[];
};
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
  obligationClassNames?: string[];
  due: number;
  indicativeTariffAmount?: number | null;
  paid: number;
  remaining: number;
  status: 'unpaid' | 'partial' | 'paid' | 'unconfigured';
  studentStatus?: 'unpaid' | 'partial' | 'paid' | 'unconfigured';
  studentDue?: number;
  studentPaid?: number;
  studentRemaining?: number;
};
type ClassSituationRow = Pick<SituationRow,
  'studentId' | 'firstName' | 'lastName' | 'className' | 'obligationClassNames' | 'studentDue' | 'studentPaid' | 'studentRemaining' | 'studentStatus'> & {
    studentDue: number;
    studentPaid: number;
    studentRemaining: number;
    studentStatus: 'unpaid' | 'partial' | 'paid' | 'unconfigured';
    overdueInstallmentCount: number;
    overdueInstallmentAmount: number;
    punctualityStatus: 'overdue' | 'paid_late' | 'paid_on_time' | 'upcoming' | 'undetermined' | 'not_applicable';
    punctualityReason: string | null;
    nextInstallment: {
      label: string;
      dueDate: string;
      remaining: number;
    } | null;
    installmentDetails?: Array<Omit<ClassSituationExcelInstallment, 'firstName' | 'lastName'>>;
  };
type StudentFinanceInstallment = {
  id: number;
  label: string;
  dueDate: string;
  amount: number;
  paid: number;
  remaining: number;
  status: 'paid' | 'partial' | 'overdue' | 'pending';
  punctualityStatus: ClassSituationRow['punctualityStatus'];
  settledAt: string | null;
  punctualityReason: string | null;
};
type StudentFinanceObligation = {
  id: number;
  label: string;
  className?: string | null;
  amount: number;
  paid: number;
  remaining: number;
  installments?: StudentFinanceInstallment[];
};
type StudentFinanceCategoryObligations = {
  label: string;
  obligations?: StudentFinanceObligation[];
};
type TuitionReduction = { discountAmount: number; reason: string };
type TuitionReductionDraft = {
  tariffId: number;
  studentId: number;
  discountAmount: string;
  reason: string;
  installmentAmounts: string[];
};
type TuitionScheduleDraftRow = {
  label: string;
  dueDate: string;
  amount: string;
};
type ObligationGenerationPreviewRow = {
  key: string;
  studentId: number;
  studentName: string;
  classId: number;
  className: string;
  categoryId: number;
  categoryCode: string;
  categoryLabel: string;
  tariffId: number | null;
  referenceAmount: number | null;
  discountAmount: number;
  individualizationReason: string | null;
  canIndividualize: boolean;
  amount: number | null;
  state: 'eligible' | 'existing' | 'excluded';
  selected: boolean;
  reason: string | null;
  installments: Array<{ label: string; dueDate: string; amount: number; orderIndex: number }>;
};
type ObligationGenerationPreview = {
  previewToken: string;
  selectionByTariffId: Record<string, number[]>;
  tuitionReductionsByTariffId: Record<string, Record<string, TuitionReduction>>;
  tuitionInstallmentAmountsByTariffId: Record<string, Record<string, number[]>>;
  rows: ObligationGenerationPreviewRow[];
  studentsExamined: number;
  studentsEligible: number;
  newObligationCount: number;
  existingObligationCount: number;
  excludedCount: number;
  estimatedTotal: number;
  configurationIssues: string[];
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
const getActiveAccountingYearId = (years: AcademicYear[], schoolId: number | null) => {
  if (schoolId == null) return null;
  return years.find((year) => year.isActive && year.schoolId === schoolId)?.id
    ?? years.find((year) => year.isActive && year.schoolId == null)?.id
    ?? null;
};
const getTariffPaymentLimit = (category: { remaining?: number; indicativeTariffAmount?: number | null }) =>
  category.remaining || category.indicativeTariffAmount || 0;
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
  unconfigured: 'Aucune obligation',
}[status]);
const installmentStatusLabels: Record<StudentFinanceInstallment['status'], string> = {
  paid: 'Soldée',
  partial: 'Partiellement payée',
  overdue: 'En retard',
  pending: 'À venir',
};
const punctualityStatusLabels: Record<ClassSituationRow['punctualityStatus'], string> = {
  overdue: 'En retard',
  paid_late: 'Payée en retard',
  paid_on_time: 'Payée à temps',
  upcoming: 'À venir',
  undetermined: 'Non déterminé',
  not_applicable: 'Sans objet',
};
const formatTotalsStatus = (due: number, paid: number, remaining = Math.max(0, due - paid)): SituationRow['status'] => {
  if (due <= 0) return 'unconfigured';
  if (remaining <= 0) return 'paid';
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
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<number | null>(currentSchoolId);
  const [yearId, setYearId] = useState<number | null>(() => getActiveAccountingYearId(years, currentSchoolId));
  const [tab, setTab] = useState<AccountingTab>('dashboard');
  const [categories, setCategories] = useState<Category[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [educationLevels, setEducationLevels] = useState<EducationLevel[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [generationClassIds, setGenerationClassIds] = useState<number[]>([]);
  const [generationCategoryIds, setGenerationCategoryIds] = useState<number[]>([]);
  const [generationSelectionByTariffId, setGenerationSelectionByTariffId] = useState<Record<string, number[]>>({});
  const [generationStudentSearch, setGenerationStudentSearch] = useState('');
  const [generationTuitionReductionsByTariffId, setGenerationTuitionReductionsByTariffId] = useState<Record<string, Record<string, TuitionReduction>>>({});
  const [generationTuitionInstallmentAmountsByTariffId, setGenerationTuitionInstallmentAmountsByTariffId] = useState<Record<string, Record<string, number[]>>>({});
  const [tuitionReductionDraft, setTuitionReductionDraft] = useState<TuitionReductionDraft | null>(null);
  const [generationPreview, setGenerationPreview] = useState<ObligationGenerationPreview | null>(null);
  const [generationPreviewDirty, setGenerationPreviewDirty] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [isGenerationPanelOpen, setIsGenerationPanelOpen] = useState(false);
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
  const [paymentConfirmation, setPaymentConfirmation] = useState<PaymentConfirmation | null>(null);
  const [paymentReceiptLoading, setPaymentReceiptLoading] = useState(false);
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
  const [feeSituationStudentSearch, setFeeSituationStudentSearch] = useState('');
  const [studentSituationClassId, setStudentSituationClassId] = useState<number | null>(null);
  const [studentSituationStatus, setStudentSituationStatus] = useState<'paid' | 'partial' | 'unpaid' | null>(null);
  const [studentSituationStudentIds, setStudentSituationStudentIds] = useState<number[] | null>(null);
  const [isClassSituationVisible, setIsClassSituationVisible] = useState(false);
  const [classSituationRows, setClassSituationRows] = useState<ClassSituationRow[]>([]);
  const [isClassSituationLoading, setIsClassSituationLoading] = useState(false);
  const [isClassSituationPdfLoading, setIsClassSituationPdfLoading] = useState(false);
  const [isClassSituationExcelLoading, setIsClassSituationExcelLoading] = useState(false);
  const [classSituationError, setClassSituationError] = useState('');
  const [paymentSituationRow, setPaymentSituationRow] = useState<SituationRow | null>(null);
  const [showRubricPayment, setShowRubricPayment] = useState(false);
  const [studentFinance, setStudentFinance] = useState<any>(null);
  const [receiptUrls, setReceiptUrls] = useState<Record<number, string>>({});
  const [amount, setAmount] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [configurationMode, setConfigurationMode] = useState<'single' | 'range'>('single');
  const [configurationCategoryCode, setConfigurationCategoryCode] = useState<
    '' | 'tuition' | 'enrollment' | 'custom'
  >('');
  const [rangeStartClassId, setRangeStartClassId] = useState<number | null>(null);
  const [rangeEndClassId, setRangeEndClassId] = useState<number | null>(null);
  const [feeLabel, setFeeLabel] = useState('');
  const [isFeeFormOpen, setIsFeeFormOpen] = useState(false);
  const [editingTariffId, setEditingTariffId] = useState<number | null>(null);
  const [scheduleClassId, setScheduleClassId] = useState<number | null>(null);
  const [schedulePeriodType, setSchedulePeriodType] = useState<'annual' | 'trimester' | 'semester'>('trimester');
  const [scheduleDraftRows, setScheduleDraftRows] = useState<TuitionScheduleDraftRow[]>([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [initialTuitionAmount, setInitialTuitionAmount] = useState('');
  const [initialTuitionJustification, setInitialTuitionJustification] = useState('');
  const [paymentEnrollmentKind, setPaymentEnrollmentKind] = useState<AccountingEnrollmentKind | ''>('');
  const [paymentCategoryId, setPaymentCategoryId] = useState<number | null>(null);
  const [feePaymentMode, setFeePaymentMode] = useState(false);
  const [multiPaymentEnabled, setMultiPaymentEnabled] = useState(false);
  const [multiPaymentAmounts, setMultiPaymentAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accountingRefreshToken, setAccountingRefreshToken] = useState(0);
  const [paymentOutcomeUncertain, setPaymentOutcomeUncertain] = useState(false);
  const paymentAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const paymentSubmitInFlight = useRef(false);
  const receiptObjectUrls = useRef(new Set<string>());
  const paymentFormRef = useRef<HTMLDivElement>(null);
  const authorized = ['school_admin', 'school_accountant', 'super_admin'].includes(userRole);
  const canConfigure = userRole === 'school_admin' || userRole === 'super_admin';
  const canGenerateObligations = canConfigure;
  const canCollectPayments = userRole === 'school_accountant' || userRole === 'super_admin';
  const currentUserId = typeof user?.id === 'number' && Number.isSafeInteger(user.id) ? user.id : null;

  const visibleYears = useMemo(
    () => schoolId == null
      ? []
      : years.filter((year) => year.schoolId == null || year.schoolId === schoolId),
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
    if (leftOrder != null && rightOrder != null) {
      return compareAccountingClassOrder(
        { classId: left.id, className: left.name, levelOrder: leftOrder },
        { classId: right.id, className: right.name, levelOrder: rightOrder },
      );
    }
    return left.id - right.id;
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
  const generationCategories = enabledCategories.filter((category) => category.code !== 'enrollment'
    && tariffsForSelectedYear.some((tariff) => tariff.categoryId === category.id));
  const tuitionCategory = enabledCategories.find((category) => category.code === 'tuition') ?? null;
  const scheduleTariffsForClass = scheduleClassId == null || tuitionCategory == null
    ? []
    : tariffsForSelectedYear.filter((tariff) =>
      tariff.categoryId === tuitionCategory.id && tariffAppliesToClass(tariff, scheduleClassId));
  const scheduleTariff = scheduleTariffsForClass.length === 1 ? scheduleTariffsForClass[0] : null;
  const scheduleDraftTotal = scheduleDraftRows.reduce((total, row) => total + (Number(row.amount) || 0), 0);
  const scheduleCandidate = scheduleTariff
    ? scheduleDraftRows.map((row) => ({ label: row.label, dueDate: row.dueDate, amount: Number(row.amount) }))
    : [];
  const scheduleDraftValid = Boolean(scheduleTariff
    && scheduleDraftRows.length >= 1
    && validateAccountingSchedule(scheduleCandidate, scheduleTariff.amount));
  const dashboardCategories = enabledCategories.filter((category) =>
    tariffs.some((tariff) => tariff.categoryId === category.id
      && tariff.isEnabled !== false
      && (!yearId || tariff.academicYearId === yearId)
      && (tariff.schoolId == null || tariff.schoolId === schoolId))
    || fees.some((fee) => fee.categoryId === category.id
      && fee.status === 'active'
      && (!yearId || fee.academicYearId === yearId)
      && (fee.schoolId == null || fee.schoolId === schoolId)));
  const selectedStandardCategory = configurationCategoryCode === 'tuition' || configurationCategoryCode === 'enrollment'
    ? categories.find((category) => category.code === configurationCategoryCode && category.isEnabled)
    : null;
  const matchingTariff = editingTariffId == null
    ? null
    : tariffs.find((tariff) => tariff.id === editingTariffId) ?? null;
  const duplicateTariff = configurationCategoryCode === 'custom' && yearId && selectedClassId && feeLabel.trim()
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
  const feePaymentIndicativeAmount = selectedFeePaymentCategories.reduce(
    (total: number, category: any) => total + (category.indicativeTariffAmount ?? 0),
    0,
  );
  const allocationEnrollmentCategories = feePaymentMode
    ? selectedFeePaymentCategories
    : multiPaymentEnabled
      ? (studentFinance?.student?.id === studentId ? studentFinance?.categories ?? [] : [])
        .filter((category: any) => Object.prototype.hasOwnProperty.call(multiPaymentAmounts, category.tariffId))
      : [];
  const paymentNeedsEnrollmentKind = feePaymentMode || multiPaymentEnabled
    ? allocationEnrollmentCategories.some((category: any) =>
      category.code === 'enrollment' && category.indicativeTariffAmount > 0)
      || (feePaymentMode && activeRubricRow?.categoryCode === 'enrollment'
        && (activeRubricRow.indicativeTariffAmount ?? 0) > 0)
    : (selectedPaymentCategory?.code === 'enrollment'
      && (selectedPaymentCategory.indicativeTariffAmount ?? 0) > 0)
      || (activeRubricRow?.categoryCode === 'enrollment'
        && (activeRubricRow.indicativeTariffAmount ?? 0) > 0);
  const selectedPaymentIndicativeAmount = activeRubricRow?.indicativeTariffAmount
    ?? selectedPaymentCategory?.indicativeTariffAmount
    ?? 0;
  const initialTuitionReferenceAmount = feePaymentMode
    ? activeRubricRow?.categoryCode === 'tuition' ? activeRubricRow.indicativeTariffAmount ?? 0 : 0
    : multiPaymentEnabled
      ? selectedFeePaymentCategories.find((category: any) =>
        category.code === 'tuition' && category.indicativeTariffAmount > 0)?.indicativeTariffAmount ?? 0
      : selectedPaymentCategory?.code === 'tuition'
        ? selectedPaymentIndicativeAmount
        : 0;
  const initialTuitionTariffId = activeRubricRow?.tariffId ?? selectedPaymentCategory?.tariffId ?? null;
  const hasInitialTuitionAmount = initialTuitionAmount.trim() !== '';
  const parsedInitialTuitionAmount = hasInitialTuitionAmount ? Number(initialTuitionAmount) : null;
  const initialTuitionInputInvalid = initialTuitionReferenceAmount > 0
    ? hasInitialTuitionAmount
      ? !Number.isSafeInteger(parsedInitialTuitionAmount)
        || parsedInitialTuitionAmount! <= 0
        || parsedInitialTuitionAmount! >= initialTuitionReferenceAmount
        || !initialTuitionJustification.trim()
        || initialTuitionJustification.trim().length > 1000
      : initialTuitionJustification.trim() !== ''
    : hasInitialTuitionAmount || initialTuitionJustification.trim() !== '';
  const initialTuitionDue = hasInitialTuitionAmount && Number.isSafeInteger(parsedInitialTuitionAmount)
    ? parsedInitialTuitionAmount!
    : initialTuitionReferenceAmount;
  const paymentLimitForCategory = (category: any) =>
    category.code === 'tuition'
      && category.indicativeTariffAmount > 0
      && hasInitialTuitionAmount
      && Number.isSafeInteger(parsedInitialTuitionAmount)
      ? parsedInitialTuitionAmount!
      : getTariffPaymentLimit(category);
  const studentFinanceRemaining = studentFinance?.totals?.remaining
    ?? (studentFinance?.categories ?? []).reduce(
      (total: number, category: any) => total + Math.max(0, category.due - category.paid),
      0,
    );
  const studentFinanceOverpayment = studentFinance?.totals?.overpayment
    ?? (studentFinance?.categories ?? []).reduce(
      (total: number, category: any) => total + Math.max(0, category.paid - category.due),
      0,
    );
  const studentFinanceObligations = (studentFinance?.categories ?? []).flatMap(
    (category: StudentFinanceCategoryObligations) => (category.obligations ?? []).map((obligation) => ({
      categoryLabel: category.label,
      obligation,
    })),
  );
  const studentFinanceInstallmentTotal = studentFinanceObligations.reduce(
    (total, { obligation }) => total + (obligation.installments ?? [])
      .reduce((installmentTotal, installment) => installmentTotal + installment.amount, 0),
    0,
  );
  const singlePaymentLimit = paymentScope.remaining || initialTuitionDue || selectedPaymentIndicativeAmount;
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
      aggregate: 'student',
      includeInactive: 'true',
    });
    if (studentSituationClassId != null) params.set('classId', String(studentSituationClassId));
    if (studentSituationStatus != null) params.set('status', studentSituationStatus);
    return params.toString();
  }, [schoolId, studentSituationClassId, studentSituationStatus, yearId]);
  const filteredSituationStudents = visibleStudents.filter((student) =>
    (studentSituationClassId == null || student.classId === studentSituationClassId)
    && (studentSituationStatus == null
      || (studentSituationStudentIds ?? []).includes(student.id)));
  const selectedClassSituation = situationClasses.find((item) => item.id === studentSituationClassId) ?? null;
  const isAllClassesSituation = studentSituationClassId == null;
  const classSituationScopeLabel = selectedClassSituation?.name ?? 'Toutes les classes';
  const selectedSchool = schools.find((item) => item.id === schoolId) ?? null;
  const displayedClassSituationRows = useMemo(() => {
    if (!isAllClassesSituation) return classSituationRows;
    return [...classSituationRows].sort((left, right) =>
      left.className.localeCompare(right.className, 'fr')
      || left.lastName.localeCompare(right.lastName, 'fr')
      || left.firstName.localeCompare(right.firstName, 'fr'));
  }, [classSituationRows, isAllClassesSituation]);
  const classSituationTotals = classSituationRows.reduce((totals, row) => ({
    due: totals.due + row.studentDue,
    paid: totals.paid + row.studentPaid,
    remaining: totals.remaining + row.studentRemaining,
    overdueInstallmentCount: totals.overdueInstallmentCount + row.overdueInstallmentCount,
    overdueInstallmentAmount: totals.overdueInstallmentAmount + row.overdueInstallmentAmount,
  }), { due: 0, paid: 0, remaining: 0, overdueInstallmentCount: 0, overdueInstallmentAmount: 0 });
  const selectedFeeSituationRows = situationRows.filter((row) => row.tariffId != null
    && (selectedTariffIds ?? []).includes(row.tariffId)
    && (!situationClassId || row.classId === situationClassId));
  const normalizedFeeSituationStudentSearch = normalizeFeeFilterLabel(feeSituationStudentSearch);
  const filteredFeeSituationRows = selectedFeeSituationRows.filter((row) => (
    !normalizedFeeSituationStudentSearch
    || normalizeFeeFilterLabel(`${row.lastName} ${row.firstName} ${row.firstName} ${row.lastName}`)
      .includes(normalizedFeeSituationStudentSearch)
  ));
  const normalizedGenerationStudentSearch = normalizeFeeFilterLabel(generationStudentSearch);
  const filteredGenerationPreviewRows = (generationPreview?.rows ?? []).filter((row) => (
    !normalizedGenerationStudentSearch
    || normalizeFeeFilterLabel(row.studentName).includes(normalizedGenerationStudentSearch)
  ));
  const categoryDisplayLabel = (code: string, fallbackLabel?: string) =>
    getAccountingCategoryDisplayLabel(
      code,
      fallbackLabel ?? categories.find((category) => category.code === code)?.label ?? 'Frais',
    );

  useEffect(() => {
    if (!authorized) return;
    const selectedSchoolId = userRole === 'super_admin' ? schoolId : currentSchoolId;
    if (userRole !== 'super_admin') setSchoolId(currentSchoolId);
    setYearId(getActiveAccountingYearId(years, selectedSchoolId));
  }, [authorized, currentSchoolId, schoolId, userRole, years]);

  useEffect(() => {
    if (!canConfigure && tab === 'configuration') setTab('dashboard');
  }, [canConfigure, tab]);

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
    setInitialTuitionAmount('');
    setInitialTuitionJustification('');
    setIsFeeFormOpen(false);
    setEditingTariffId(null);
    setFeeLabel('');
    setSelectedClassId(null);
    setAmount('');
    setGenerationClassIds([]);
    setGenerationCategoryIds([]);
    setGenerationSelectionByTariffId({});
    setGenerationTuitionReductionsByTariffId({});
    setGenerationTuitionInstallmentAmountsByTariffId({});
    setTuitionReductionDraft(null);
    setGenerationPreview(null);
    setGenerationPreviewDirty(false);
    setIsGenerationPanelOpen(false);
    setScheduleClassId(null);
    setSchedulePeriodType('trimester');
    setScheduleDraftRows([]);
    setScheduleError('');
    setScheduleNotice('');
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
  }, [accountQuery, accountingRefreshToken, authorized, cashQuery, schoolId, yearQuery]);

  useEffect(() => {
    if (!authorized || !schoolId || !yearId || !scheduleClassId || !tuitionCategory || !scheduleTariff) {
      setScheduleLoading(false);
      setScheduleDraftRows([]);
      setScheduleError(scheduleClassId && scheduleTariffsForClass.length !== 1
        ? scheduleTariffsForClass.length
          ? 'Plusieurs tarifs de scolarité s’appliquent à cette classe.'
          : 'Configurez un tarif de scolarité unique pour cette classe avant son échéancier.'
        : '');
      return;
    }
    let cancelled = false;
    setScheduleLoading(true);
    setScheduleError('');
    setScheduleNotice('');
    const query = new URLSearchParams({
      schoolId: String(schoolId),
      academicYearId: String(yearId),
      classId: String(scheduleClassId),
      categoryId: String(tuitionCategory.id),
    });
    apiFetch(`/api/accounting/schedules?${query.toString()}`).then((template) => {
      if (cancelled) return;
      if (!template) {
        setSchedulePeriodType('trimester');
        setScheduleDraftRows(Array.from({ length: 3 }, (_, index) => ({
          label: `Tranche ${index + 1}`,
          dueDate: '',
          amount: '',
        })));
        return;
      }
      setSchedulePeriodType(template.periodType);
      const savedSchedule = validateAccountingSchedule(template.installments);
      const split = savedSchedule
        ? splitAmountBySchedule(scheduleTariff.amount, savedSchedule)
        : null;
      if (split) {
        setScheduleDraftRows(split.map((installment) => ({
          label: installment.label,
          dueDate: installment.dueDate,
          amount: String(installment.amount),
        })));
        return;
      }
      const rawInstallments = Array.isArray(template.installments) ? template.installments : [];
      setScheduleDraftRows(rawInstallments.map((installment: any, index: number) => ({
        label: typeof installment?.label === 'string' ? installment.label : `Tranche ${index + 1}`,
        dueDate: typeof installment?.dueDate === 'string' ? installment.dueDate : '',
        amount: Number.isSafeInteger(installment?.amount) ? String(installment.amount) : '',
      })));
      setScheduleError('Le modèle existant est invalide pour le tarif actuel. Corrigez ses montants ou ses dates avant de l’enregistrer.');
    }).catch((loadError) => {
      if (!cancelled) setScheduleError(loadError instanceof Error
        ? loadError.message
        : 'Impossible de charger l’échéancier de scolarité.');
    }).finally(() => {
      if (!cancelled) setScheduleLoading(false);
    });
    return () => { cancelled = true; };
  }, [
    authorized,
    schoolId,
    yearId,
    scheduleClassId,
    tuitionCategory?.id,
    scheduleTariff?.id,
    scheduleTariff?.amount,
    scheduleTariffsForClass.length,
  ]);

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
  }, [accountingRefreshToken, authorized, feesCashQuery, schoolId]);

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
  }, [accountingRefreshToken, authorized, dashboard, schoolId, situationQuery, selectedTariffIds, yearId]);

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
    if (!isClassSituationVisible || !authorized || !schoolId || !yearId) {
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
  }, [accountingRefreshToken, authorized, classSituationQuery, isClassSituationVisible, schoolId, studentSituationClassId, yearId]);

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

  const renderReceiptActions = (
    receiptId?: number | null,
    receiptNumber?: string | null,
    paymentStatus?: string,
  ) => {
    if (paymentStatus === 'cancelled') {
      return <span className="text-slate-500">Paiement annulé — reçu non réimprimable</span>;
    }
    if (!receiptId) return <span className="text-slate-500">Reçu indisponible</span>;
    const url = receiptUrls[receiptId];
    if (!url) {
      return (
        <button type="button" className="text-indigo-700 underline" onClick={() => loadReceipt(receiptId)}>
          Réimprimer le reçu
        </button>
      );
    }
    return (
      <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
        <a className="text-indigo-700 underline" href={url} target="_blank" rel="noreferrer">
          Réimprimer le reçu
        </a>
        <a
          className="text-indigo-700 underline"
          href={url}
          download={receiptNumber ? `${receiptNumber}.pdf` : 'reçu.pdf'}
        >
          Télécharger le reçu PDF
        </a>
      </span>
    );
  };

  const downloadClassSituationPdf = async () => {
    if (!schoolId || !yearId || !isClassSituationVisible) return;
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
        className: classSituationScopeLabel,
        groupByClass: isAllClassesSituation,
        issuedAt: new Date(),
        rows: detailResult.rows ?? [],
      });
      const pdfBlob = new Blob([new Uint8Array(pdfBytes).buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      const fileScope = classSituationScopeLabel.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
      link.download = `situation-financiere-${fileScope}.pdf`;
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

  const downloadClassSituationExcel = async () => {
    if (!schoolId || !yearId || !isClassSituationVisible) return;
    setIsClassSituationExcelLoading(true);
    setClassSituationError('');
    try {
      const excelQuery = new URLSearchParams(classSituationQuery);
      excelQuery.set('includeInstallmentDetails', 'true');
      const result = await apiFetch(`/api/accounting/situation?${excelQuery.toString()}`);
      const rows = (result.rows ?? []) as ClassSituationRow[];
      const installments = rows.flatMap((row) => (row.installmentDetails ?? []).map((installment) => ({
        ...installment,
        firstName: row.firstName,
        lastName: row.lastName,
      })));
      const excelBytes = await buildClassSituationExcel({
        schoolName: selectedSchool?.officialName || selectedSchool?.name || 'Établissement',
        academicYearName: selectedYearName,
        className: classSituationScopeLabel,
        groupByClass: isAllClassesSituation,
        students: rows,
        installments,
      });
      const excelBlob = new Blob([new Uint8Array(excelBytes).buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(excelBlob);
      const link = document.createElement('a');
      link.href = url;
      const fileScope = classSituationScopeLabel.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
      link.download = `situation-financiere-${fileScope}.xlsx`;
      document.body.append(link);
      const revokeUrl = URL.revokeObjectURL.bind(URL);
      link.click();
      link.remove();
      window.setTimeout(() => revokeUrl(url), 1000);
    } catch (excelError) {
      setClassSituationError(excelError instanceof Error
        ? excelError.message
        : 'Impossible de générer le fichier Excel de la situation de classe.');
    } finally {
      setIsClassSituationExcelLoading(false);
    }
  };

  const submitTariff = async (event: React.FormEvent) => {
    event.preventDefault();
    const isCustomCategory = configurationCategoryCode === 'custom';
    const cleanLabel = isCustomCategory
      ? feeLabel.trim()
      : configurationCategoryCode === 'tuition' || configurationCategoryCode === 'enrollment'
        ? STANDARD_ACCOUNTING_CATEGORY_LABELS[configurationCategoryCode]
        : '';
    const parsedAmount = Number(amount);
    const classIdsToConfigure = configurationMode === 'single'
      ? selectedClassId ? [selectedClassId] : []
      : rangeClasses.map((item) => item.id);
    if (isCustomCategory && isStandardAccountingCategoryLabel(cleanLabel)) {
      setError('Ce libellé est réservé à un frais standard. Sélectionnez son type standard.');
      return;
    }
    if (!schoolId || !yearId || classIdsToConfigure.length === 0 || !configurationCategoryCode
      || (isCustomCategory && !cleanLabel)
      || (!isCustomCategory && !selectedStandardCategory && editingTariffId == null)
      || !Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      setError(configurationMode === 'single'
        ? 'Sélectionnez un type de frais, une classe et un montant entier supérieur à zéro.'
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
      const scope = configurationMode === 'range'
        ? { classFromId: rangeStartClassId, classToId: rangeEndClassId }
        : { classId: selectedClassId };
      const type = editingTariffId != null
        ? { label: cleanLabel }
        : isCustomCategory
          ? { label: cleanLabel }
          : { categoryId: selectedStandardCategory!.id };
      await apiFetch(editingTariffId == null
        ? '/api/accounting/tariffs'
        : `/api/accounting/tariffs/${editingTariffId}`, {
        method: editingTariffId == null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId,
          academicYearId: yearId,
          ...scope,
          ...type,
          amount: parsedAmount,
        }),
      });
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
      setConfigurationCategoryCode('');
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

  const saveTuitionSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!schoolId || !yearId || !scheduleClassId || !tuitionCategory || !scheduleTariff) {
      setScheduleError('Sélectionnez une classe avec un tarif de scolarité unique.');
      return;
    }
    const installments = scheduleDraftRows.map((row) => ({
      label: row.label.trim(),
      dueDate: row.dueDate,
      amount: Number(row.amount),
    }));
    if (!validateAccountingSchedule(installments, scheduleTariff.amount)) {
      setScheduleError(`Les tranches doivent avoir des montants entiers positifs, des dates valides et totaliser ${formatMoney(scheduleTariff.amount)}.`);
      return;
    }
    setScheduleBusy(true);
    setScheduleError('');
    setScheduleNotice('');
    try {
      const saved = await apiFetch('/api/accounting/schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId,
          academicYearId: yearId,
          classId: scheduleClassId,
          categoryId: tuitionCategory.id,
          periodType: schedulePeriodType,
          installments,
        }),
      });
      setScheduleDraftRows(saved.installments.map((installment: { label: string; dueDate: string; amount: number }) => ({
        label: installment.label,
        dueDate: installment.dueDate,
        amount: String(installment.amount),
      })));
      setScheduleNotice('Échéancier de scolarité enregistré. Les obligations déjà constituées ne sont pas modifiées.');
    } catch (requestError) {
      setScheduleError(requestError instanceof Error
        ? requestError.message
        : 'Impossible d’enregistrer l’échéancier de scolarité.');
    } finally {
      setScheduleBusy(false);
    }
  };

  const createObligation = async (
    sourceId: number,
    categoryCode: string,
    enrollmentKind?: string,
    isFee = false,
    individualizedTuition?: { amount: number; justification: string },
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
          ...(individualizedTuition
            ? {
              initialTuitionAmount: individualizedTuition.amount,
              initialTuitionJustification: individualizedTuition.justification,
            }
            : {}),
        }),
      });
      const result = await apiFetch(`/api/accounting/students/${studentId}?schoolId=${schoolId}&academicYearId=${yearId}`);
      setStudentFinance(result);
      setInitialTuitionAmount('');
      setInitialTuitionJustification('');
      setNotice(individualizedTuition
        ? 'Obligation de scolarité créée avec un montant individualisé et sa justification.'
        : 'Obligation créée avec un instantané du tarif.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const applyTuitionReductionDraft = () => {
    if (!tuitionReductionDraft || !generationPreview) return;
    const row = generationPreview.rows.find((item) =>
      item.tariffId === tuitionReductionDraft.tariffId
      && item.studentId === tuitionReductionDraft.studentId);
    if (!row || row.referenceAmount == null) return;
    const discountAmount = Number(tuitionReductionDraft.discountAmount);
    if (!Number.isSafeInteger(discountAmount) || discountAmount < 0) {
      setError('Saisissez une réduction entière supérieure ou égale à 0 FCFA.');
      return;
    }
    if (discountAmount >= row.referenceAmount) {
      setError('Une réduction de 100 % ou plus donnerait un montant final nul ou négatif; elle n’est pas autorisée.');
      return;
    }
    const reason = tuitionReductionDraft.reason.trim();
    if (discountAmount > 0 && !reason) {
      setError('Le motif est obligatoire pour toute réduction de scolarité.');
      return;
    }
    if (reason.length > 1000) {
      setError('Le motif ne peut pas dépasser 1000 caractères.');
      return;
    }
    const individualizedAmounts = tuitionReductionDraft.installmentAmounts.map(Number);
    const individualizedAmount = row.referenceAmount - discountAmount;
    if (discountAmount > 0
      && (individualizedAmounts.length !== row.installments.length
        || individualizedAmounts.some((amount) => !Number.isSafeInteger(amount) || amount <= 0)
        || individualizedAmounts.reduce((total, amount) => total + amount, 0) !== individualizedAmount)) {
      setError(`Les montants des tranches doivent être positifs et totaliser ${formatMoney(individualizedAmount)}.`);
      return;
    }
    const tariffKey = String(tuitionReductionDraft.tariffId);
    const studentKey = String(tuitionReductionDraft.studentId);
    setGenerationTuitionReductionsByTariffId((current) => {
      const studentsForTariff = { ...(current[tariffKey] ?? {}) };
      if (discountAmount === 0) {
        delete studentsForTariff[studentKey];
      } else {
        studentsForTariff[studentKey] = { discountAmount, reason };
      }
      const next = { ...current };
      if (Object.keys(studentsForTariff).length) next[tariffKey] = studentsForTariff;
      else delete next[tariffKey];
      return next;
    });
    setGenerationTuitionInstallmentAmountsByTariffId((current) => {
      const studentsForTariff = { ...(current[tariffKey] ?? {}) };
      if (discountAmount === 0) {
        delete studentsForTariff[studentKey];
      } else {
        studentsForTariff[studentKey] = individualizedAmounts;
      }
      const next = { ...current };
      if (Object.keys(studentsForTariff).length) next[tariffKey] = studentsForTariff;
      else delete next[tariffKey];
      return next;
    });
    setTuitionReductionDraft(null);
    setGenerationPreviewDirty(true);
    setError('');
  };

  const previewObligationGeneration = async (
    selection?: Record<string, number[]>,
    tuitionReductions = generationTuitionReductionsByTariffId,
    tuitionInstallmentAmounts = generationTuitionInstallmentAmountsByTariffId,
  ) => {
    if (!schoolId || !yearId || !generationClassIds.length || !generationCategoryIds.length) {
      setError('Sélectionnez une année, au moins une classe et au moins un frais configuré.');
      return;
    }
    setGenerationBusy(true);
    setError('');
    setNotice('');
    try {
      const preview = await apiFetch('/api/accounting/obligation-generation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId,
          academicYearId: yearId,
          classIds: generationClassIds,
          categoryIds: generationCategoryIds,
          tuitionReductionsByTariffId: tuitionReductions,
          tuitionInstallmentAmountsByTariffId: tuitionInstallmentAmounts,
          ...(selection == null ? {} : { selectedStudentIdsByTariffId: selection }),
        }),
      }) as ObligationGenerationPreview;
      setGenerationPreview(preview);
      setGenerationSelectionByTariffId(preview.selectionByTariffId ?? {});
      setGenerationTuitionReductionsByTariffId(preview.tuitionReductionsByTariffId ?? {});
      setGenerationTuitionInstallmentAmountsByTariffId(preview.tuitionInstallmentAmountsByTariffId ?? {});
      setTuitionReductionDraft(null);
      setGenerationPreviewDirty(false);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setGenerationBusy(false);
    }
  };

  const confirmObligationGeneration = async () => {
    if (!schoolId || !yearId || !generationPreview || generationPreviewDirty || tuitionReductionDraft) return;
    setGenerationBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await apiFetch('/api/accounting/obligation-generation/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId,
          academicYearId: yearId,
          classIds: generationClassIds,
          categoryIds: generationCategoryIds,
          selectedStudentIdsByTariffId: generationSelectionByTariffId,
          tuitionReductionsByTariffId: generationTuitionReductionsByTariffId,
          tuitionInstallmentAmountsByTariffId: generationTuitionInstallmentAmountsByTariffId,
          previewToken: generationPreview.previewToken,
        }),
      });
      const [dashboardData, situationData, feeRows] = await Promise.all([
        apiFetch(`/api/accounting/dashboard?${accountQuery}${yearQuery}`),
        apiFetch(`/api/accounting/situation?${accountQuery}${yearQuery}`),
        apiFetch(`/api/accounting/fees?${accountQuery}`),
      ]);
      setDashboard(dashboardData);
      setSituationRows(situationData.rows ?? []);
      setFees(feeRows);
      setGenerationPreview(null);
      setGenerationSelectionByTariffId({});
      setGenerationTuitionReductionsByTariffId({});
      setGenerationTuitionInstallmentAmountsByTariffId({});
      setTuitionReductionDraft(null);
      setGenerationPreviewDirty(false);
      setNotice(`${result.createdCount} obligation(s) créée(s) — ${formatMoney(result.totalAmount)}.`);
    } catch (requestError) {
      setGenerationPreviewDirty(true);
      showError(requestError);
    } finally {
      setGenerationBusy(false);
    }
  };

  const submitPayment = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canCollectPayments) return;
    if (paymentSubmitInFlight.current) return;
    if (!schoolId || !yearId || !studentId || (!feePaymentMode && !multiPaymentEnabled && !paymentCategoryId)) return;
    if (initialTuitionInputInvalid) {
      setError('Pour réduire la scolarité initiale, saisissez un montant inférieur au tarif et une justification.');
      return;
    }
    if (paymentNeedsEnrollmentKind && !paymentEnrollmentKind) {
      setError('Sélectionnez le type d’inscription avant d’enregistrer ce paiement.');
      return;
    }
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
      || line.amount > paymentLimitForCategory(line.category));
    const paidAmount = usesTariffAllocations
      ? selectedLines.reduce((sum, line) => sum + (Number.isSafeInteger(line.amount) ? line.amount : 0), 0)
      : Number(paymentAmount);
    if (usesTariffAllocations
      ? selectedLines.length === 0 || invalidLine
      : !Number.isSafeInteger(paidAmount) || paidAmount <= 0 || paidAmount > singlePaymentLimit) {
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
      ...(hasInitialTuitionAmount
        ? {
          initialTuitionAmount: parsedInitialTuitionAmount!,
          initialTuitionJustification: initialTuitionJustification.trim(),
        }
        : {}),
      ...(paymentNeedsEnrollmentKind ? { enrollmentKind: paymentEnrollmentKind } : {}),
    };
    const fingerprint = JSON.stringify(paymentRequest);
    if (paymentAttempt.current?.fingerprint !== fingerprint) {
      paymentAttempt.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    }
    paymentSubmitInFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setIssuedReceipt(null);
    let payment: any;
    try {
      payment = await apiFetch('/api/accounting/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...paymentRequest,
          idempotencyKey: paymentAttempt.current.idempotencyKey,
        }),
      });
      if (!payment?.receipt?.id || !payment.receipt.receiptNumber) {
        throw new Error('La réponse du serveur ne contient pas les informations du reçu.');
      }
    } catch (requestError) {
      const status = requestError && typeof requestError === 'object' && 'status' in requestError
        ? Number((requestError as { status?: unknown }).status)
        : null;
      if (status == null || !Number.isFinite(status) || status >= 500) {
        setPaymentOutcomeUncertain(true);
        setError('La connexion n’a pas permis de confirmer le résultat de ce paiement. Ne créez pas un nouvel encaissement. Utilisez uniquement « Vérifier le résultat » pour reprendre la même demande avec sa clé d’idempotence.');
      } else {
        setPaymentOutcomeUncertain(false);
        showError(requestError);
      }
      paymentSubmitInFlight.current = false;
      setBusy(false);
      return;
    }

    paymentSubmitInFlight.current = false;
    setBusy(false);
    setPaymentOutcomeUncertain(false);
    paymentAttempt.current = null;
    setAccountingRefreshToken((current) => current + 1);
    const receiptSnapshot = payment.receipt.snapshot ?? {};
    const paymentDetails = payment.payment ?? receiptSnapshot.payment ?? {};
    const amountValue = payment.payment?.amount ?? receiptSnapshot.payment?.amount;
    const confirmedAmount = typeof amountValue === 'number'
      && Number.isSafeInteger(amountValue)
      && amountValue >= 0
      ? amountValue
      : null;
    const snapshotStudent = receiptSnapshot.student ?? {};
    const studentName = [snapshotStudent.firstName, snapshotStudent.lastName]
      .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name: string) => name.trim())
      .join(' ') || null;
    const feeLabels: string[] = [];
    if (Array.isArray(receiptSnapshot.allocations)) {
      for (const item of receiptSnapshot.allocations as unknown[]) {
        if (typeof item !== 'object' || item == null) continue;
        const allocation = item as Record<string, unknown>;
        const label = [allocation.tariffLabel, allocation.label, allocation.category]
          .find((candidate): candidate is string =>
            typeof candidate === 'string' && candidate.trim().length > 0)?.trim();
        if (label && !feeLabels.includes(label)) feeLabels.push(label);
      }
    }
    const paidAt = paymentDetails.paidAt;
    const paidAtDate = paidAt == null ? null : new Date(paidAt);
    setPaymentConfirmation({
      amount: confirmedAmount,
      studentName,
      feeLabels,
      paidAtLabel: paidAtDate && !Number.isNaN(paidAtDate.getTime())
        ? paidAtDate.toLocaleDateString('fr-FR', { timeZone: 'UTC' })
        : null,
      receiptNumber: payment.receipt.receiptNumber,
      remainingAfterPayment: null,
      warnings: [],
    });
    setPaymentSituationRow(null);
    setShowRubricPayment(false);
    setPaymentCategoryId(null);
    setPaymentAmount('');
    setPaymentMethod('cash');
    setInitialTuitionAmount('');
    setInitialTuitionJustification('');
    setPaymentEnrollmentKind('');
    setFeePaymentMode(false);
    setMultiPaymentEnabled(false);
    setMultiPaymentAmounts({});
    setPaymentReference('');
    setPaymentReceiptLoading(true);
    setNotice('');

    const refreshErrors: string[] = [];
    try {
      const blob = await apiFetchBlob(`/api/accounting/receipts/${payment.receipt.id}`);
      const url = URL.createObjectURL(blob);
      receiptObjectUrls.current.add(url);
      setReceiptUrls((current) => ({ ...current, [payment.receipt.id]: url }));
      setIssuedReceipt({ url, number: payment.receipt.receiptNumber });
    } catch {
      refreshErrors.push('le PDF du reçu n’a pas pu être chargé; vous pourrez le réimprimer depuis l’historique des paiements');
    } finally {
      setPaymentReceiptLoading(false);
    }
    const [statementResult, dashboardResult, situationResult, cashResult] = await Promise.allSettled([
      apiFetch(`/api/accounting/students/${studentId}?schoolId=${schoolId}&academicYearId=${yearId}`),
      apiFetch(`/api/accounting/dashboard?${accountQuery}${yearQuery}`),
      apiFetch(`/api/accounting/situation?schoolId=${schoolId}&academicYearId=${yearId}`),
      apiFetch(`/api/accounting/cash?${feesCashQuery}`),
    ]);
    if (statementResult.status === 'fulfilled') {
      setStudentFinance(statementResult.value);
      const remaining = statementResult.value?.totals?.remaining;
      if (typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0) {
        setPaymentConfirmation((current) => current
          ? { ...current, remainingAfterPayment: remaining }
          : current);
      }
    }
    else refreshErrors.push('la situation et l’historique de l’élève n’ont pas pu être actualisés');
    if (dashboardResult.status === 'fulfilled') setDashboard(dashboardResult.value);
    else refreshErrors.push('le tableau de bord comptable n’a pas pu être actualisé');
    if (situationResult.status === 'fulfilled') setSituationRows(situationResult.value.rows ?? []);
    else refreshErrors.push('les soldes comptables n’ont pas pu être actualisés');
    if (cashResult.status === 'fulfilled') setFeesCashSummary(cashResult.value);
    else refreshErrors.push('l’historique général des encaissements n’a pas pu être actualisé');
    if (refreshErrors.length) {
      setPaymentConfirmation((current) => current
        ? { ...current, warnings: refreshErrors }
        : current);
    }
  };

  const renderPaymentForm = () => {
    if (!canCollectPayments) return null;
    if ((!selectedPaymentStudent && !activeRubricRow)
      || (!feePaymentMode && !multiPaymentEnabled && paymentCategoryId == null)) return null;
    const multiPaymentCategories = feePaymentMode
      ? selectedFeePaymentCategories
      : (studentFinance?.student?.id === studentId ? studentFinance?.categories ?? [] : [])
        .filter((category: any) => category.tariffId
          && (category.remaining > 0 || category.indicativeTariffAmount > 0));
    const multiPaymentTotal = feePaymentMode ? feePaymentTotal : Object.values(multiPaymentAmounts)
      .reduce((sum, lineAmount) => sum + (Number(lineAmount) || 0), 0);
    const displayedPaymentScope = feePaymentMode ? feePaymentScope : paymentScope;
    const hasInvalidMultiAmount = Object.entries(multiPaymentAmounts).some(([tariffId, lineAmount]) => {
      const category = multiPaymentCategories.find((item: any) => item.tariffId === Number(tariffId));
      const parsed = Number(lineAmount);
      return !category || !Number.isSafeInteger(parsed) || parsed <= 0 || parsed > paymentLimitForCategory(category);
    });
    const displayedIndicativeAmount = feePaymentMode
      ? feePaymentIndicativeAmount
      : selectedPaymentIndicativeAmount;
    return (
      <div ref={paymentFormRef} className="scroll-mt-24 rounded-xl">
      <form onSubmit={submitPayment} className="grid gap-3 rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4 sm:grid-cols-2">
        <fieldset disabled={busy || paymentOutcomeUncertain} className="contents">
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
        {displayedIndicativeAmount > 0 && (
          <p className="sm:col-span-2 text-sm text-indigo-900">
            Tarif annuel de référence : {formatMoney(displayedIndicativeAmount)}. Il ne constitue pas encore une dette; l’obligation sera créée dans la même opération que l’encaissement.
          </p>
        )}
        {paymentNeedsEnrollmentKind && (
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Type d’inscription
            <select
              aria-label="Type d’inscription"
              className="rounded-lg border border-slate-300 bg-white p-2"
              required
              value={paymentEnrollmentKind}
              onChange={(event) => {
                const value = event.target.value;
                setPaymentEnrollmentKind(isAccountingEnrollmentKind(value) ? value : '');
              }}
            >
              <option value="">Choisir un type d’inscription</option>
              {ACCOUNTING_ENROLLMENT_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>{kind.label}</option>
              ))}
            </select>
          </label>
        )}
        {initialTuitionReferenceAmount > 0 && (
          <div className="sm:col-span-2 grid gap-2 rounded-lg border border-indigo-100 bg-white p-3">
            <p className="text-sm text-slate-700">
              Pour un nouvel arrivant, vous pouvez fixer explicitement un montant initial inférieur au tarif annuel, sans prorata automatique.
            </p>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Montant initial exigible (optionnel, XOF)
              <input
                aria-label="Montant initial de scolarité"
                className="rounded-lg border border-slate-300 p-2"
                type="number"
                min="1"
                max={initialTuitionReferenceAmount - 1}
                step="1"
                value={initialTuitionAmount}
                onChange={(event) => setInitialTuitionAmount(event.target.value)}
                placeholder={`Tarif annuel : ${initialTuitionReferenceAmount}`}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Justification du montant individualisé
              <textarea
                aria-label="Justification du montant initial de scolarité"
                className="rounded-lg border border-slate-300 p-2"
                maxLength={1000}
                value={initialTuitionJustification}
                onChange={(event) => setInitialTuitionJustification(event.target.value)}
                placeholder="Obligatoire si le montant est inférieur au tarif annuel"
              />
            </label>
            {hasInitialTuitionAmount && !initialTuitionInputInvalid && !feePaymentMode && !multiPaymentEnabled
              && initialTuitionTariffId != null && (
                <button
                  type="button"
                  disabled={busy}
                  className="justify-self-start rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 disabled:opacity-50"
                  onClick={() => createObligation(
                    initialTuitionTariffId,
                    'tuition',
                    undefined,
                    false,
                    {
                      amount: parsedInitialTuitionAmount!,
                      justification: initialTuitionJustification.trim(),
                    },
                  )}
                >
                  Constituer l’obligation sans encaissement
                </button>
              )}
          </div>
        )}
        {!feePaymentMode && !multiPaymentEnabled && <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Montant payé aujourd'hui (XOF)
          <input aria-label="Montant payé aujourd'hui" className="rounded-lg border border-slate-300 bg-white p-2" type="number" min="1" max={singlePaymentLimit || undefined} step="1" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="Saisir le montant réellement payé" />
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
                    <span><strong>{category.label}</strong><span className="block text-xs text-slate-500">
                      {category.remaining > 0
                        ? `Reste dû : ${formatMoney(category.remaining)}`
                        : category.indicativeTariffAmount > 0
                          ? `Tarif indicatif : ${formatMoney(category.indicativeTariffAmount)} · obligation créée à l’encaissement`
                          : 'Aucun reste exigible'}
                    </span></span>
                  </label>
                  {selected && <label className="grid gap-1 text-xs font-semibold text-slate-600">Montant affecté
                    <input aria-label={`Montant pour ${category.label}`} type="number" min="1" max={paymentLimitForCategory(category)} step="1" value={multiPaymentAmounts[category.tariffId] ?? ''} onChange={(event) => setMultiPaymentAmounts((current) => ({ ...current, [category.tariffId]: event.target.value }))} className="rounded-lg border border-slate-300 p-2 text-sm" />
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
        {!feePaymentMode && !multiPaymentEnabled && (paymentScope.remaining > 0
          ? <p className="sm:col-span-2 text-sm text-slate-700">
            Après paiement, reste à payer : {formatMoney(Math.max(0, paymentScope.remaining - Number(paymentAmount || 0)))}.
          </p>
          : selectedPaymentIndicativeAmount > 0
            ? <p className="sm:col-span-2 text-sm text-slate-700">
              Solde estimé après création de l’obligation : {formatMoney(Math.max(0, initialTuitionDue - Number(paymentAmount || 0)))}.
            </p>
            : null)}
        <button className="rounded-lg bg-indigo-700 px-4 py-3 font-black uppercase tracking-wide text-white shadow disabled:opacity-50 sm:col-span-2" disabled={busy
          || initialTuitionInputInvalid
          || (paymentNeedsEnrollmentKind && !paymentEnrollmentKind)
          || (feePaymentMode || multiPaymentEnabled
            ? !Object.keys(multiPaymentAmounts).length || hasInvalidMultiAmount
            : !paymentCategoryId || !singlePaymentLimit || !Number.isSafeInteger(Number(paymentAmount)) || Number(paymentAmount) <= 0 || Number(paymentAmount) > singlePaymentLimit)}>
          {busy ? 'Traitement…' : 'Encaisser et générer le reçu'}
        </button>
        </fieldset>
      </form>
      {paymentOutcomeUncertain && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>Ne modifiez pas cette demande et ne créez pas un nouvel encaissement. La vérification réutilise la même clé d’idempotence.</p>
          <button
            type="button"
            className="mt-2 rounded-lg bg-amber-800 px-3 py-2 font-semibold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => { void submitPayment(); }}
          >
            {busy ? 'Vérification…' : 'Vérifier le résultat'}
          </button>
        </div>
      )}
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
              setYearId(getActiveAccountingYearId(years, nextSchoolId));
            }} aria-label="Établissement">
              <option value="">Tous les établissements</option>
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
        <div className="flex flex-wrap gap-2">
          <a className="inline-block rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800"
            href={issuedReceipt.url} target="_blank" rel="noreferrer">
            Reçu {issuedReceipt.number} — ouvrir / imprimer le PDF
          </a>
          <a className="inline-block rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800"
            href={issuedReceipt.url} download={`${issuedReceipt.number}.pdf`}>
            Télécharger le reçu PDF
          </a>
        </div>
      )}
      <ModalSurface
        isOpen={paymentConfirmation != null}
        onClose={() => setPaymentConfirmation(null)}
        closeOnOverlayClick={false}
        closeOnEscape={false}
        disablePadding
        contentClassName="max-w-xl overflow-y-auto p-0"
        ariaLabel="Confirmation de paiement"
      >
        {paymentConfirmation && (
          <div className="space-y-5 p-5 text-center sm:p-8">
            <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-600 sm:h-20 sm:w-20" aria-hidden="true" />
            <div className="space-y-2">
              <h2 className="text-xl font-black text-slate-900 sm:text-2xl">Paiement enregistré avec succès</h2>
              <p className="text-3xl font-black text-emerald-700 sm:text-4xl">
                {paymentConfirmation.amount == null
                  ? 'Montant indisponible'
                  : formatMoney(paymentConfirmation.amount)}
              </p>
            </div>
            <dl className="space-y-3 rounded-xl bg-slate-50 p-4 text-left text-sm sm:p-5">
              <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                <dt className="font-semibold text-slate-500">Élève</dt>
                <dd className="font-bold text-slate-900">{paymentConfirmation.studentName ?? 'Information indisponible'}</dd>
              </div>
              <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                <dt className="font-semibold text-slate-500">Rubrique(s) payée(s)</dt>
                <dd className="font-bold text-slate-900">
                  {paymentConfirmation.feeLabels.length
                    ? paymentConfirmation.feeLabels.join(', ')
                    : 'Information indisponible'}
                </dd>
              </div>
              <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                <dt className="font-semibold text-slate-500">Date du paiement</dt>
                <dd className="font-bold text-slate-900">{paymentConfirmation.paidAtLabel ?? 'Information indisponible'}</dd>
              </div>
              <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                <dt className="font-semibold text-slate-500">Numéro du reçu</dt>
                <dd className="font-bold text-slate-900">{paymentConfirmation.receiptNumber}</dd>
              </div>
              {paymentConfirmation.remainingAfterPayment != null && (
                <div className="grid gap-1 border-t border-slate-200 pt-3 sm:grid-cols-[10rem_1fr]">
                  <dt className="font-semibold text-slate-500">Reste à payer</dt>
                  <dd className="font-bold text-slate-900">{formatMoney(paymentConfirmation.remainingAfterPayment)}</dd>
                </div>
              )}
            </dl>
            {paymentReceiptLoading && (
              <p role="status" className="text-sm text-slate-500">Chargement du reçu PDF…</p>
            )}
            {paymentConfirmation.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900" role="status">
                Le paiement est confirmé. {paymentConfirmation.warnings.join('; ')}.
              </div>
            )}
            <div className="flex flex-col-reverse justify-center gap-2 sm:flex-row">
              <button
                type="button"
                disabled={!issuedReceipt || paymentReceiptLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-700 px-4 py-3 font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  if (!issuedReceipt) return;
                  const link = document.createElement('a');
                  link.href = issuedReceipt.url;
                  link.target = '_blank';
                  link.rel = 'noreferrer';
                  link.click();
                }}
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
                Imprimer le reçu
              </button>
              <button
                type="button"
                disabled={!issuedReceipt || paymentReceiptLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-700 px-4 py-3 font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  if (!issuedReceipt) return;
                  const link = document.createElement('a');
                  link.href = issuedReceipt.url;
                  link.download = `${issuedReceipt.number}.pdf`;
                  link.click();
                }}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Télécharger PDF
              </button>
              <button
                type="button"
                className="rounded-lg bg-emerald-700 px-6 py-3 font-black text-white hover:bg-emerald-800"
                onClick={() => setPaymentConfirmation(null)}
              >
                Terminer
              </button>
            </div>
          </div>
        )}
      </ModalSurface>
      {!schoolId && userRole !== 'super_admin' && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Sélectionnez un établissement pour accéder à ses données financières.</p>}
      {!schoolId && userRole === 'super_admin' && (
        <div className="space-y-4">
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Choisissez un établissement pour ses données financières, ou consultez l’historique global des paiements et des demandes.</p>
          <nav className="flex flex-wrap gap-2" aria-label="Sections comptables">
            <button type="button" onClick={() => setTab('history')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'history' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              Historique global et demandes
            </button>
          </nav>
          {tab === 'history' && (
            <AccountingAdjustmentWorkflow
              userRole={userRole}
              schoolId={null}
              currentUserId={currentUserId}
              refreshToken={accountingRefreshToken}
              onFinancialDataChanged={() => setAccountingRefreshToken((current) => current + 1)}
              renderReceiptActions={renderReceiptActions}
            />
          )}
        </div>
      )}
      {schoolId && (
        <>
          <nav className="flex flex-wrap gap-2" aria-label="Sections comptables">
            {([
              ['dashboard', 'Tableau de bord'],
              ['students', 'Situation des élèves'],
              ['reminders', 'Rappels de paiement'],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {label}
              </button>
            ))}
            {canConfigure && (
              <button type="button" onClick={() => setTab('configuration')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'configuration' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                Configuration des frais
              </button>
            )}
            {userRole !== 'school_admin' && (
              <button type="button" onClick={() => setTab('fees')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'fees' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                Frais scolaires
              </button>
            )}
            <button type="button" onClick={() => setTab('history')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'history' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              Historique et demandes
            </button>
          </nav>

          {tab === 'dashboard' && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { key: 'total', label: 'Total encaissé net', value: dashboard?.total, tone: 'received' },
                  { key: 'expected', label: 'Total attendu', value: dashboard?.expected, tone: 'expected' },
                  { key: 'remaining', label: 'Reste à recouvrer', value: dashboard?.remaining, tone: 'remaining' },
                  ...dashboardCategories.map((category) => ({
                    key: `category-${category.code}`,
                    label: categoryDisplayLabel(category.code, category.label),
                    value: dashboard?.categories?.[category.code],
                    tone: 'received',
                  })),
                ].map(({ key, label, value, tone }) => {
                  const styles = tone === 'expected'
                    ? dashboardMetricStyles.expected
                    : tone === 'remaining'
                      ? dashboardMetricStyles.remaining
                      : dashboardMetricStyles.received;
                  return (
                    <article
                      key={key}
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
                    {categoryDisplayLabel(category.code, category.label)}
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

          {tab === 'reminders' && schoolId && (
            <PaymentRemindersPanel
              schoolId={schoolId}
              schoolName={selectedSchool?.name ?? ''}
              yearId={yearId}
              yearName={selectedYearName}
              classes={situationClasses}
            />
          )}

          {tab === 'history' && schoolId && (
            <AccountingAdjustmentWorkflow
              userRole={userRole}
              schoolId={schoolId}
              currentUserId={currentUserId}
              refreshToken={accountingRefreshToken}
              onFinancialDataChanged={() => setAccountingRefreshToken((current) => current + 1)}
              renderReceiptActions={renderReceiptActions}
            />
          )}

          {tab === 'fees' && (
            <section className="space-y-5" aria-label="Frais scolaires">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {userRole === 'school_admin' ? 'Génération des obligations' : 'Frais scolaires'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">Sélectionnez un ou plusieurs frais configurés pour filtrer les paiements et les situations.</p>
              </div>
              {canGenerateObligations && <button
                type="button"
                aria-expanded={isGenerationPanelOpen}
                aria-controls={isGenerationPanelOpen ? 'obligation-generation-panel' : undefined}
                onClick={() => setIsGenerationPanelOpen((open) => !open)}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-800"
              >
                Générer les frais
              </button>}
              {canGenerateObligations && isGenerationPanelOpen && (
              <section id="obligation-generation-panel" className="space-y-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4" aria-label="Générer les frais">
                <div>
                  <h3 className="font-bold text-slate-900">Générer les frais</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Prévisualisez les obligations avant toute écriture. Les frais d’inscription sont exclus.
                    La scolarité utilise le tarif de référence; désélectionnez les élèves à traiter individuellement.
                    Les autres frais exigent une sélection explicite par élève.
                  </p>
                </div>
                {!yearId && <p className="text-sm text-amber-800">Sélectionnez une année scolaire pour préparer la génération.</p>}
                {yearId && (
                  <>
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-semibold text-slate-700">Classes à inclure</legend>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={situationClasses.length > 0 && generationClassIds.length === situationClasses.length}
                          onChange={(event) => {
                            setGenerationClassIds(event.target.checked ? situationClasses.map((item) => item.id) : []);
                            setGenerationPreview(null);
                            setGenerationSelectionByTariffId({});
                            setGenerationTuitionReductionsByTariffId({});
                            setGenerationTuitionInstallmentAmountsByTariffId({});
                            setTuitionReductionDraft(null);
                            setGenerationPreviewDirty(false);
                          }}
                        />
                        Toutes les classes de {selectedYearName}
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {situationClasses.map((item) => (
                          <label key={item.id} className="flex items-center gap-2 rounded-lg bg-white p-2 text-sm">
                            <input
                              type="checkbox"
                              checked={generationClassIds.includes(item.id)}
                              onChange={(event) => {
                                setGenerationClassIds((current) => event.target.checked
                                  ? [...current, item.id].sort((left, right) => left - right)
                                  : current.filter((id) => id !== item.id));
                                setGenerationPreview(null);
                                setGenerationSelectionByTariffId({});
                                setGenerationTuitionReductionsByTariffId({});
                                setGenerationTuitionInstallmentAmountsByTariffId({});
                                setTuitionReductionDraft(null);
                                setGenerationPreviewDirty(false);
                              }}
                            />
                            {item.name}
                          </label>
                        ))}
                        {!situationClasses.length && <p className="text-sm text-slate-500">Aucune classe disponible pour cette année.</p>}
                      </div>
                    </fieldset>
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-semibold text-slate-700">Catégories configurées</legend>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {generationCategories.map((category) => (
                          <label key={category.id} className="flex items-center gap-2 rounded-lg bg-white p-2 text-sm">
                            <input
                              type="checkbox"
                              checked={generationCategoryIds.includes(category.id)}
                              onChange={(event) => {
                                setGenerationCategoryIds((current) => event.target.checked
                                  ? [...current, category.id].sort((left, right) => left - right)
                                  : current.filter((id) => id !== category.id));
                                setGenerationPreview(null);
                                setGenerationSelectionByTariffId({});
                                setGenerationTuitionReductionsByTariffId({});
                                setGenerationTuitionInstallmentAmountsByTariffId({});
                                setTuitionReductionDraft(null);
                                setGenerationPreviewDirty(false);
                              }}
                            />
                            {categoryDisplayLabel(category.code, category.label)}
                            {category.code !== 'tuition' && <span className="text-xs text-slate-500">(sélection par élève)</span>}
                          </label>
                        ))}
                        {!generationCategories.length && <p className="text-sm text-slate-500">Aucun tarif actif configuré pour cette année.</p>}
                      </div>
                    </fieldset>
                    <button
                      type="button"
                      disabled={generationBusy || !generationClassIds.length || !generationCategoryIds.length}
                      onClick={() => previewObligationGeneration()}
                      className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {generationBusy ? 'Préparation…' : 'Prévisualiser la génération'}
                    </button>
                  </>
                )}
                {generationPreview && (
                  <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="font-bold text-slate-800">Aperçu — aucune donnée n’a encore été enregistrée</h4>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                      {[
                        ['Élèves examinés', generationPreview.studentsExamined],
                        ['Élèves éligibles', generationPreview.studentsEligible],
                        ['Obligations déjà constituées', generationPreview.existingObligationCount],
                        ['Lignes exclues', generationPreview.excludedCount],
                        ['Nouvelles obligations sélectionnées', generationPreview.newObligationCount],
                        ['Montant prévisionnel', formatMoney(generationPreview.estimatedTotal)],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-slate-500">{label}</p>
                          <p className="mt-1 font-black text-slate-900">{value}</p>
                        </div>
                      ))}
                    </div>
                    {!!generationPreview.configurationIssues.length && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <p className="font-bold">Configurations manquantes ou ambiguës</p>
                        <ul className="mt-1 list-inside list-disc">
                          {generationPreview.configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-slate-600">
                      Les obligations existantes (même catégorie et année) ne seront ni remplacées ni modifiées.
                      Un échéancier valide est obligatoire pour la scolarité.
                    </p>
                    {generationPreviewDirty && (
                      <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        La sélection ou une réduction a changé. Cet aperçu ne peut plus être confirmé; actualisez-le avant de continuer.
                      </p>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="grid min-w-64 gap-1 text-xs font-semibold text-slate-600">
                        Rechercher un élève par nom ou prénom
                        <input
                          type="search"
                          aria-label="Rechercher un élève dans l’aperçu"
                          value={generationStudentSearch}
                          onChange={(event) => setGenerationStudentSearch(event.target.value)}
                          className="rounded-lg border border-slate-200 p-2 text-sm font-normal"
                        />
                      </label>
                      {generationStudentSearch && (
                        <button
                          type="button"
                          onClick={() => setGenerationStudentSearch('')}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
                        >
                          Effacer la recherche
                        </button>
                      )}
                    </div>
                    <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-100">
                      <table className="w-full min-w-[700px] text-left text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                          <tr><th className="px-3 py-2">Inclure</th><th className="px-3 py-2">Élève / classe</th><th className="px-3 py-2">Frais et montant</th><th className="px-3 py-2">État / motif</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredGenerationPreviewRows.map((row) => {
                            const selected = row.tariffId != null
                              && (generationSelectionByTariffId[String(row.tariffId)] ?? []).includes(row.studentId);
                            const isEditingTuition = tuitionReductionDraft?.tariffId === row.tariffId
                              && tuitionReductionDraft.studentId === row.studentId;
                            const draftDiscountAmount = isEditingTuition ? Number(tuitionReductionDraft.discountAmount) : Number.NaN;
                            const draftDiscountValid = isEditingTuition
                              && Number.isSafeInteger(draftDiscountAmount)
                              && draftDiscountAmount >= 0
                              && row.referenceAmount != null
                              && draftDiscountAmount < row.referenceAmount;
                            const draftFinalAmount = row.referenceAmount == null || !isEditingTuition
                              ? null
                              : Number.isSafeInteger(draftDiscountAmount) && draftDiscountAmount >= 0
                                ? Math.max(row.referenceAmount - draftDiscountAmount, 0)
                                : null;
                            const draftInstallmentAmounts = isEditingTuition
                              ? tuitionReductionDraft.installmentAmounts.map(Number)
                              : [];
                            const draftInstallmentTotal = draftInstallmentAmounts.reduce((total, amount) => total + amount, 0);
                            const draftInstallmentsValid = isEditingTuition
                              && draftFinalAmount != null
                              && draftInstallmentAmounts.length === row.installments.length
                              && draftInstallmentAmounts.every((amount) => Number.isSafeInteger(amount) && amount > 0)
                              && draftInstallmentTotal === draftFinalAmount;
                            return (
                              <tr key={row.key}>
                                <td className="px-3 py-2">
                                  {row.state === 'eligible' && row.tariffId != null ? (
                                    <input
                                      type="checkbox"
                                      aria-label={`Inclure ${row.categoryLabel} pour ${row.studentName}`}
                                      checked={selected}
                                      onChange={(event) => {
                                        const tariffKey = String(row.tariffId);
                                        setGenerationSelectionByTariffId((current) => {
                                          const ids = current[tariffKey] ?? [];
                                          const nextIds = event.target.checked
                                            ? [...new Set([...ids, row.studentId])].sort((left, right) => left - right)
                                            : ids.filter((id) => id !== row.studentId);
                                          return { ...current, [tariffKey]: nextIds };
                                        });
                                        setGenerationPreviewDirty(true);
                                      }}
                                    />
                                  ) : '—'}
                                </td>
                                <td className="px-3 py-2 font-medium">{row.studentName}<span className="block text-xs text-slate-500">{row.className}</span></td>
                                <td className="px-3 py-2">
                                  <span>{row.categoryLabel}</span>
                                  {row.categoryCode === 'tuition' && row.referenceAmount != null && (
                                    <div className="mt-2 space-y-1">
                                      <p>Tarif normal : {formatMoney(row.referenceAmount)}</p>
                                      {row.discountAmount > 0 && <p>Réduction : {formatMoney(row.discountAmount)}</p>}
                                      <p>
                                        {row.state === 'existing' ? 'Obligation existante' : 'Montant final à payer'}
                                        {' : '}{formatMoney(row.amount ?? 0)}
                                      </p>
                                      {!!row.installments.length && (
                                        <details className="text-xs text-slate-500">
                                          <summary className="cursor-pointer">{row.installments.length} échéance(s)</summary>
                                          <ul className="mt-1">
                                            {row.installments.map((installment) => (
                                              <li key={`${installment.orderIndex}-${installment.dueDate}`}>
                                                {installment.label} · {new Date(`${installment.dueDate}T00:00:00`).toLocaleDateString('fr-FR')} · {formatMoney(installment.amount)}
                                              </li>
                                            ))}
                                          </ul>
                                        </details>
                                      )}
                                      {row.canIndividualize && row.tariffId != null && (
                                        <div className="space-y-2">
                                          <button
                                            type="button"
                                            aria-label={`Personnaliser la scolarité de ${row.studentName}`}
                                            onClick={() => {
                                              const currentReduction = generationTuitionReductionsByTariffId[String(row.tariffId!)]?.[String(row.studentId)];
                                              setTuitionReductionDraft({
                                                tariffId: row.tariffId!,
                                                studentId: row.studentId,
                                                discountAmount: String(currentReduction?.discountAmount ?? 0),
                                                reason: currentReduction?.reason ?? '',
                                                installmentAmounts: row.discountAmount > 0
                                                  ? row.installments.map((installment) => String(installment.amount))
                                                  : row.installments.map(() => ''),
                                              });
                                              setError('');
                                            }}
                                            className="rounded border border-indigo-200 px-2 py-1 text-xs font-semibold text-indigo-800"
                                          >
                                            {row.discountAmount > 0 ? 'Modifier' : 'Personnaliser'}
                                          </button>
                                          {isEditingTuition && tuitionReductionDraft && (
                                            <div className="space-y-2 rounded-lg border border-indigo-100 bg-white p-3">
                                              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                                                Montant de la réduction (FCFA)
                                                <input
                                                  aria-label={`Montant de la réduction pour ${row.studentName}`}
                                                  type="number"
                                                  min="0"
                                                  max={row.referenceAmount}
                                                  step="1"
                                                  value={tuitionReductionDraft.discountAmount}
                                                  onChange={(event) => setTuitionReductionDraft((current) =>
                                                    current ? { ...current, discountAmount: event.target.value } : current)}
                                                  className="rounded border border-slate-300 p-2"
                                                />
                                              </label>
                                              <p>
                                                Montant final à payer :{' '}
                                                <output aria-label={`Montant final à payer pour ${row.studentName}`}>
                                                  {draftFinalAmount == null ? '—' : formatMoney(draftFinalAmount)}
                                                </output>
                                              </p>
                                              {draftDiscountAmount > 0 && (
                                                <div className="space-y-2 border-t border-slate-100 pt-2">
                                                  <p className="text-xs font-bold text-slate-700">
                                                    Montants personnalisés des tranches — dates du modèle de classe conservées
                                                  </p>
                                                  {row.installments.map((installment, index) => (
                                                    <div key={`${installment.orderIndex}-${installment.dueDate}`} className="grid gap-2 sm:grid-cols-[1fr_12rem]">
                                                      <p className="text-xs text-slate-600">
                                                        {installment.label} · {new Date(`${installment.dueDate}T00:00:00`).toLocaleDateString('fr-FR')}
                                                      </p>
                                                      <label className="grid gap-1 text-xs font-semibold">
                                                        Montant de {installment.label} (FCFA)
                                                        <input
                                                          aria-label={`Montant personnalisé de ${installment.label} pour ${row.studentName}`}
                                                          type="number"
                                                          min="1"
                                                          step="1"
                                                          value={tuitionReductionDraft.installmentAmounts[index] ?? ''}
                                                          onChange={(event) => setTuitionReductionDraft((current) =>
                                                            current ? {
                                                              ...current,
                                                              installmentAmounts: current.installmentAmounts.map((value, amountIndex) =>
                                                                amountIndex === index ? event.target.value : value),
                                                            } : current)}
                                                          className="rounded border border-slate-300 p-2"
                                                        />
                                                      </label>
                                                    </div>
                                                  ))}
                                                  <p className="text-xs font-semibold text-slate-700">
                                                    Total des tranches : {formatMoney(draftInstallmentTotal)} / {formatMoney(draftFinalAmount ?? 0)}
                                                  </p>
                                                  {draftFinalAmount != null && !draftInstallmentsValid && (
                                                    <p role="alert" className="text-xs text-rose-700">
                                                      Saisissez un montant strictement positif pour chaque tranche ; leur somme doit égaler le montant final à payer.
                                                    </p>
                                                  )}
                                                </div>
                                              )}
                                              {draftDiscountAmount >= (row.referenceAmount ?? 0) && (
                                                <p role="alert" className="text-xs font-medium text-rose-700">
                                                  Une réduction de 100 % ou plus donnerait un montant final de 0 FCFA ou moins. Elle n’est pas autorisée.
                                                </p>
                                              )}
                                              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                                                Motif de la réduction
                                                <textarea
                                                  aria-label={`Motif de la réduction pour ${row.studentName}`}
                                                  maxLength={1000}
                                                  value={tuitionReductionDraft.reason}
                                                  onChange={(event) => setTuitionReductionDraft((current) =>
                                                    current ? { ...current, reason: event.target.value } : current)}
                                                  placeholder="Obligatoire pour une réduction supérieure à 0"
                                                  className="rounded border border-slate-300 p-2"
                                                />
                                              </label>
                                              {!tuitionReductionDraft.reason.trim() && draftDiscountAmount > 0 && (
                                                <p role="alert" className="text-xs text-rose-700">Le motif est obligatoire pour toute réduction.</p>
                                              )}
                                              <div className="flex flex-wrap gap-2">
                                                <button
                                                  type="button"
                                                  disabled={!draftDiscountValid
                                                    || (draftDiscountAmount > 0 && (!tuitionReductionDraft.reason.trim() || !draftInstallmentsValid))}
                                                  onClick={applyTuitionReductionDraft}
                                                  className="rounded bg-indigo-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                                                >
                                                  Appliquer la réduction
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setTuitionReductionDraft(null)}
                                                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                                                >
                                                  Annuler
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {row.categoryCode !== 'tuition' && (
                                    <div className="mt-2">
                                    {row.amount == null ? '—' : formatMoney(row.amount)}
                                    {!!row.installments.length && (
                                      <details className="mt-1 text-xs text-slate-500">
                                        <summary className="cursor-pointer">{row.installments.length} échéance(s)</summary>
                                        <ul className="mt-1">
                                          {row.installments.map((installment) => (
                                            <li key={`${installment.orderIndex}-${installment.dueDate}`}>
                                              {installment.label} · {new Date(`${installment.dueDate}T00:00:00`).toLocaleDateString('fr-FR')} · {formatMoney(installment.amount)}
                                            </li>
                                          ))}
                                        </ul>
                                      </details>
                                    )}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {row.state === 'eligible'
                                    ? selected ? 'Prêt à créer' : 'Non sélectionné'
                                    : row.state === 'existing' ? 'Déjà constitué' : 'Exclu'}
                                  {row.reason && <span className="block text-xs text-slate-500">{row.reason}</span>}
                                </td>
                              </tr>
                            );
                          })}
                          {!generationPreview.rows.length && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">Aucun élève actif dans les classes sélectionnées.</td></tr>}
                          {!!generationPreview.rows.length && !filteredGenerationPreviewRows.length && (
                            <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">Aucun élève ne correspond à cette recherche.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {generationPreviewDirty && (
                      <button
                        type="button"
                        disabled={generationBusy || tuitionReductionDraft != null}
                        onClick={() => previewObligationGeneration(generationSelectionByTariffId)}
                        className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-800 disabled:opacity-50"
                      >
                        Actualiser l’aperçu
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={generationBusy || generationPreviewDirty || tuitionReductionDraft != null || generationPreview.newObligationCount === 0}
                      onClick={confirmObligationGeneration}
                      className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {generationBusy ? 'Enregistrement…' : `Confirmer la génération de ${generationPreview.newObligationCount} obligation(s)`}
                    </button>
                  </div>
                )}
              </section>
              )}
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
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Élève</th><th className="px-3 py-2">Frais</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2">Montant affecté</th><th className="px-3 py-2">Reçu</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredFeesCashAllocations.map((allocation: any, index: number) => (
                          <tr key={allocation.allocationId}><td className="px-3 py-2">{new Date(allocation.paidAt).toLocaleDateString('fr-FR')}</td><td className="px-3 py-2">{allocation.studentName}</td><td className="px-3 py-2">{allocation.categoryLabel}</td><td className="px-3 py-2">{allocation.method}</td><td className="px-3 py-2 font-semibold">{formatMoney(allocation.amount)}</td><td className="whitespace-nowrap px-3 py-2">{filteredFeesCashAllocations.findIndex((row: any) => row.paymentId === allocation.paymentId) === index && renderReceiptActions(allocation.receiptId, allocation.receiptNumber, 'posted')}</td></tr>
                        ))}
                        {!filteredFeesCashAllocations.length && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Aucun paiement ne correspond aux filtres sélectionnés.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>}
              </div>
              {yearId && (() => {
                const rows = filteredFeeSituationRows;
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-bold">Élèves concernés par les frais sélectionnés</h3>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="grid gap-1 text-xs font-semibold text-slate-600">
                          Rechercher un élève par nom ou prénom
                          <input
                            type="search"
                            aria-label="Rechercher un élève par nom ou prénom"
                            value={feeSituationStudentSearch}
                            onChange={(event) => setFeeSituationStudentSearch(event.target.value)}
                            className="rounded-lg border border-slate-200 p-2 text-sm font-normal"
                          />
                        </label>
                        {feeSituationStudentSearch && (
                          <button
                            type="button"
                            onClick={() => setFeeSituationStudentSearch('')}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
                          >
                            Effacer la recherche
                          </button>
                        )}
                      </div>
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
                      <table className="w-full min-w-[900px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Élève</th><th className="px-4 py-3">Classe de l’obligation</th><th className="px-4 py-3">Frais</th><th className="px-4 py-3">Obligations</th><th className="px-4 py-3">Tarif indicatif</th><th className="px-4 py-3">Payé net</th><th className="px-4 py-3">Trop-perçu</th><th className="px-4 py-3">Reste dû</th><th className="px-4 py-3">Action</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((row) => (
                            <tr key={`${row.studentId}-${row.tariffId}`}>
                              <td className="px-4 py-3 font-semibold">{row.lastName} {row.firstName}<span className="block text-xs font-normal text-slate-500">Classe courante : {row.className}</span></td>
                              <td className="px-4 py-3">{row.obligationClassNames?.join(', ') || '—'}</td>
                              <td className="px-4 py-3">{row.categoryLabel}</td>
                              <td className="px-4 py-3">{formatMoney(row.due)}</td>
                              <td className="px-4 py-3">{row.indicativeTariffAmount
                                ? <span>Tarif indicatif : {formatMoney(row.indicativeTariffAmount)}</span>
                                : '—'}</td>
                              <td className="px-4 py-3">{formatMoney(row.paid)}</td>
                              <td className="px-4 py-3">{row.paid > row.due ? formatMoney(row.paid - row.due) : '—'}</td>
                              <td className="px-4 py-3 font-semibold">{formatMoney(row.remaining)}</td>
                              <td className="px-4 py-3">{canCollectPayments ? <button type="button" disabled={row.remaining <= 0 && !row.indicativeTariffAmount} className="rounded-lg bg-indigo-600 px-3 py-2 font-bold text-white disabled:opacity-50" onClick={() => {
                                setStudentId(row.studentId);
                                setPaymentSituationRow(row);
                                setPaymentCategoryId(row.categoryId);
                                setPaymentAmount('');
                                setInitialTuitionAmount('');
                                setInitialTuitionJustification('');
                                setPaymentEnrollmentKind('');
                                setFeePaymentMode(true);
                                setMultiPaymentEnabled(false);
                                setMultiPaymentAmounts({});
                                setError('');
                                setShowRubricPayment(true);
                              }}>{row.indicativeTariffAmount && row.due === 0 ? 'Encaisser (crée l’obligation)' : 'Encaisser'}</button> : <span className="text-xs text-slate-500">Consultation</span>}</td>
                            </tr>
                          ))}
                          {!rows.length && (
                            <tr><td colSpan={9} className="px-4 py-4 text-center text-slate-500">
                              {selectedFeeSituationRows.length && normalizedFeeSituationStudentSearch
                                ? 'Aucun élève ne correspond à cette recherche et aux filtres sélectionnés.'
                                : 'Aucun élève avec une situation pour les frais sélectionnés.'}
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {canCollectPayments && showRubricPayment && paymentSituationRow && (
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
                  setPaymentEnrollmentKind('');
                  setInitialTuitionAmount('');
                  setInitialTuitionJustification('');
                  setFeePaymentMode(false);
                  setPaymentSituationRow(null);
                  setShowRubricPayment(false);
                }} aria-label="Élève">
                  <option value="">Rechercher un élève</option>
                  {filteredSituationStudents.map((student) => <option key={student.id} value={student.id}>{student.lastName} {student.firstName}</option>)}
                </select>
                <button
                  type="button"
                  disabled={!yearId || isClassSituationLoading}
                  onClick={() => {
                    setIsClassSituationVisible(true);
                    setStudentId(null);
                    setStudentFinance(null);
                  }}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isClassSituationLoading
                    ? 'Chargement…'
                    : isAllClassesSituation ? 'Voir la situation globale' : 'Voir la situation de la classe'}
                </button>
                <button
                  type="button"
                  disabled={!yearId || !isClassSituationVisible || isClassSituationLoading || isClassSituationPdfLoading}
                  onClick={downloadClassSituationPdf}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {isClassSituationPdfLoading ? 'Génération…' : 'Télécharger PDF'}
                </button>
                <button
                  type="button"
                  disabled={!yearId || !isClassSituationVisible || isClassSituationLoading || isClassSituationExcelLoading}
                  onClick={downloadClassSituationExcel}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {isClassSituationExcelLoading ? 'Exportation…' : 'Exporter Excel'}
                </button>
              </div>
              {classSituationError && <p role="alert" className="text-sm text-rose-700">{classSituationError}</p>}
              {isClassSituationVisible && yearId && (
                <section className="space-y-3 rounded-xl border border-slate-200 p-4" aria-label={isAllClassesSituation ? 'Situation financière globale de l’établissement' : 'Situation financière de la classe'}>
                  <div>
                    <h2 className="text-lg font-bold">
                      {isAllClassesSituation
                        ? 'Situation financière de l’établissement — Toutes les classes'
                        : `Situation financière de la classe — ${classSituationScopeLabel}`}
                    </h2>
                    <p className="text-sm text-slate-500">{selectedSchool?.name ?? ''} · {selectedYearName}</p>
                  </div>
                  {isClassSituationLoading ? (
                    <p role="status" className="text-sm text-slate-500">
                      {isAllClassesSituation
                        ? 'Chargement de la situation financière de l’établissement…'
                        : 'Chargement de la situation financière de la classe…'}
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full min-w-[1540px] text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-3 py-2">N°</th>
                              <th className="px-3 py-2">Élève</th>
                              <th className="px-3 py-2">Classe courante</th>
                              <th className="px-3 py-2">Classe de l’obligation</th>
                              <th className="whitespace-nowrap px-3 py-2 text-right">Montant dû</th>
                              <th className="whitespace-nowrap px-3 py-2 text-right">Montant payé</th>
                              <th className="whitespace-nowrap px-3 py-2 text-right">Reste à payer</th>
                              <th className="px-3 py-2">Statut</th>
                              <th className="px-3 py-2 text-right">Échéances échues</th>
                              <th className="px-3 py-2 text-right">Montant en retard</th>
                              <th className="px-3 py-2">Prochaine échéance et date</th>
                              <th className="px-3 py-2">Respect des délais</th>
                              <th className="px-3 py-2">Détail</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {displayedClassSituationRows.map((row, index) => (
                              <tr key={row.studentId}>
                                <td className="px-3 py-2">{index + 1}</td>
                                <td className="px-3 py-2 font-semibold">{row.lastName} {row.firstName}</td>
                                <td className="px-3 py-2">{row.className}</td>
                                <td className="px-3 py-2">{row.obligationClassNames?.join(', ') || '—'}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(row.studentDue)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(row.studentPaid)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{formatMoney(row.studentRemaining)}</td>
                                <td className="px-3 py-2">
                                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.studentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' : row.studentStatus === 'partial' ? 'bg-amber-100 text-amber-800' : row.studentStatus === 'unpaid' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
                                    {formatStatus(row.studentStatus)}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-right">{row.overdueInstallmentCount}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(row.overdueInstallmentAmount)}</td>
                                <td className="px-3 py-2">
                                  {row.nextInstallment ? (
                                    <span>
                                      {row.nextInstallment.label} · {new Date(`${row.nextInstallment.dueDate}T00:00:00`).toLocaleDateString('fr-FR')}
                                      {' · '}{formatMoney(row.nextInstallment.remaining)}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2" title={row.punctualityReason ?? undefined}>
                                  {punctualityStatusLabels[row.punctualityStatus ?? 'undetermined']}
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    aria-label={`Voir les échéances de ${row.firstName} ${row.lastName}`}
                                    className="whitespace-nowrap rounded-lg border border-indigo-200 px-3 py-2 font-semibold text-indigo-700 hover:bg-indigo-50"
                                    onClick={() => {
                                      if (studentId === row.studentId) return;
                                      setStudentFinance(null);
                                      setStudentId(row.studentId);
                                    }}
                                  >
                                    Voir les échéances
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {!classSituationRows.length && (
                              <tr>
                                <td colSpan={13} className="px-3 py-5 text-center text-slate-500">
                                  {isAllClassesSituation
                                    ? 'Aucun élève ne correspond à l’établissement, à l’année et aux filtres sélectionnés.'
                                    : 'Aucun élève ne correspond à cette classe et aux filtres sélectionnés.'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                            <tr>
                              <td colSpan={4} className="px-3 py-2">Totaux</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(classSituationTotals.due)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(classSituationTotals.paid)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(classSituationTotals.remaining)}</td>
                              <td className="px-3 py-2">{classSituationRows.length} élève(s)</td>
                              <td className="px-3 py-2 text-right">{classSituationTotals.overdueInstallmentCount}</td>
                              <td className="px-3 py-2 text-right">{formatMoney(classSituationTotals.overdueInstallmentAmount)}</td>
                              <td className="px-3 py-2">—</td>
                              <td className="px-3 py-2">—</td>
                              <td className="px-3 py-2">—</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <p className="text-sm text-slate-600">
                        La ponctualité utilise les paiements affectés à chaque tranche et leur date comptable enregistrée. Un remboursement antérieur à la date limite ou une chronologie incomplète peut rendre le résultat « Non déterminé ». Le retard actuel reste fondé sur le solde des échéances dépassées.
                      </p>
                    </>
                  )}
                </section>
              )}
              {studentId && yearId && !studentFinance && (
                <p role="status" className="text-sm text-slate-500">Chargement du compte et des échéances de l’élève…</p>
              )}
              {studentId && yearId && studentFinance && (
                <>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <h2 className="font-bold">{studentFinance.student.firstName} {studentFinance.student.lastName}</h2>
                    <p className="text-sm text-slate-500">Matricule {studentFinance.student.matricule} · Classe courante : {studentFinance.student.className ?? 'Sans classe'}</p>
                    <p className="mt-2 text-sm font-semibold">
                      Total à payer {formatMoney(studentFinance.totals.due)} · Payé net {formatMoney(studentFinance.totals.paid)} · Trop-perçu {formatMoney(studentFinanceOverpayment)} · Reste exigible {formatMoney(studentFinanceRemaining)}
                    </p>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr><th className="px-4 py-3">Frais</th><th className="px-4 py-3">Obligations</th><th className="px-4 py-3">Classe de l’obligation</th><th className="px-4 py-3">Tarif indicatif</th><th className="px-4 py-3">Payé net</th><th className="px-4 py-3">Trop-perçu</th><th className="px-4 py-3">Reste dû</th><th className="px-4 py-3">Statut</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {studentFinance.categories.filter((category: any) => category.due > 0 || category.indicativeTariffAmount > 0).map((category: any) => (
                          <tr key={category.id}>
                            <td className="px-4 py-3 font-semibold">{category.label}</td>
                            <td className="px-4 py-3">{formatMoney(category.due)}</td>
                            <td className="px-4 py-3">{category.obligationClassNames?.join(', ') || '—'}</td>
                            <td className="px-4 py-3">{category.indicativeTariffAmount
                              ? formatMoney(category.indicativeTariffAmount)
                              : '—'}</td>
                            <td className="px-4 py-3">{formatMoney(category.paid)}</td>
                            <td className="px-4 py-3">{category.overpayment ? formatMoney(category.overpayment) : '—'}</td>
                            <td className="px-4 py-3 font-semibold">{formatMoney(Math.max(0, category.remaining))}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${category.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : category.status === 'partial' ? 'bg-amber-100 text-amber-800' : category.status === 'unconfigured' ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-800'}`}>
                                {formatStatus(category.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 font-bold">
                          <td className="px-4 py-3">Total</td>
                          <td className="px-4 py-3">{formatMoney(studentFinance.totals.due)}</td>
                          <td className="px-4 py-3">—</td>
                          <td className="px-4 py-3">—</td>
                          <td className="px-4 py-3">{formatMoney(studentFinance.totals.paid)}</td>
                          <td className="px-4 py-3">{studentFinanceOverpayment ? formatMoney(studentFinanceOverpayment) : '—'}</td>
                          <td className="px-4 py-3">{formatMoney(studentFinanceRemaining)}</td>
                          <td className="px-4 py-3">{formatStatus(formatTotalsStatus(studentFinance.totals.due, studentFinance.totals.paid, studentFinanceRemaining))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <section
                    className="space-y-3 rounded-xl border border-indigo-100 bg-white p-4"
                    aria-label="Échéanciers des obligations"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-bold">Échéanciers des obligations</h3>
                      <p className="text-sm text-slate-600">
                        Total des tranches enregistrées : {formatMoney(studentFinanceInstallmentTotal)}
                        {' · '}Solde global de l’élève : {formatMoney(studentFinanceRemaining)}
                      </p>
                    </div>
                    {!studentFinanceObligations.length && (
                      <p className="text-sm text-slate-500">
                        Aucune obligation enregistrée pour cet élève sur cette année scolaire.
                      </p>
                    )}
                    {studentFinanceObligations.map(({ categoryLabel, obligation }) => {
                      const installments = obligation.installments ?? [];
                      const installmentTotal = installments.reduce((total, installment) => total + installment.amount, 0);
                      return (
                        <article
                          key={obligation.id}
                          className="space-y-3 rounded-lg border border-slate-200 p-3"
                          aria-label={`Obligation ${categoryLabel} ${obligation.id}`}
                        >
                          <div>
                            <h4 className="font-semibold">{categoryLabel}</h4>
                            <p className="text-sm text-slate-600">
                              {obligation.label}
                              {obligation.className ? ` · Classe : ${obligation.className}` : ''}
                            </p>
                            <p className="mt-1 text-sm">
                              Montant total dû : {formatMoney(obligation.amount)}
                              {' · '}Payé net : {formatMoney(obligation.paid)}
                              {' · '}Solde de l’obligation : {formatMoney(obligation.remaining)}
                            </p>
                            <p className="text-sm font-semibold">
                              Total des tranches : {formatMoney(installmentTotal)}
                            </p>
                          </div>
                          {!installments.length ? (
                            <p role="status" className="text-sm text-amber-800">
                              Aucune échéance enregistrée pour cette obligation.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table
                                className="w-full min-w-[900px] text-left text-sm"
                                aria-label={`Échéances de ${categoryLabel}, obligation ${obligation.id}`}
                              >
                                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2">Tranche</th>
                                    <th className="px-3 py-2">Date limite</th>
                                    <th className="px-3 py-2">Montant</th>
                                    <th className="px-3 py-2">Payé net</th>
                                    <th className="px-3 py-2">Solde restant</th>
                                    <th className="px-3 py-2">Statut</th>
                                    <th className="px-3 py-2">Respect des délais</th>
                                    <th className="px-3 py-2">Date de règlement intégral</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {installments.map((installment) => {
                                    const parsedDueDate = new Date(`${installment.dueDate}T00:00:00`);
                                    const dueDateLabel = Number.isNaN(parsedDueDate.getTime())
                                      ? installment.dueDate
                                      : parsedDueDate.toLocaleDateString('fr-FR');
                                    return (
                                      <tr key={installment.id}>
                                        <td className="px-3 py-2">{installment.label}</td>
                                        <td className="px-3 py-2">{dueDateLabel}</td>
                                        <td className="px-3 py-2">{formatMoney(installment.amount)}</td>
                                        <td className="px-3 py-2">{formatMoney(installment.paid)}</td>
                                        <td className="px-3 py-2">{formatMoney(installment.remaining)}</td>
                                        <td className="px-3 py-2">{installmentStatusLabels[installment.status]}</td>
                                        <td className="px-3 py-2" title={installment.punctualityReason ?? undefined}>
                                          {punctualityStatusLabels[installment.punctualityStatus ?? 'undetermined']}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2">
                                          {installment.settledAt
                                            ? new Date(`${installment.settledAt}T00:00:00.000Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })
                                            : '—'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </section>
                  {studentFinance.payments.map((payment: any) => (
                    <div key={payment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                      <span>
                        Paiement {payment.paidAt} · {formatMoney(payment.amount)} · {payment.method}
                        {payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}
                      </span>
                      {renderReceiptActions(payment.receiptId, payment.receiptNumber, payment.status)}
                    </div>
                  ))}
                  {canCollectPayments && <div className="space-y-3">
                    <select required className="rounded-lg border border-slate-200 p-2" value={paymentCategoryId ?? ''} onChange={(event) => {
                      setPaymentCategoryId(Number(event.target.value) || null);
                      setPaymentSituationRow(null);
                      setPaymentEnrollmentKind('');
                      setInitialTuitionAmount('');
                      setInitialTuitionJustification('');
                    }} aria-label="Type de frais à encaisser">
                      <option value="">Choisir un type de frais</option>
                      {studentFinance.categories.filter((category: any) =>
                        (category.due > 0 && category.remaining > 0) || category.indicativeTariffAmount > 0).map((category: any) => (
                        <option key={category.id} value={category.id}>
                          {category.label}{category.indicativeTariffAmount > 0
                            ? ` — tarif indicatif ${formatMoney(category.indicativeTariffAmount)}`
                            : ''}
                        </option>
                      ))}
                    </select>
                    {renderPaymentForm()}
                  </div>}
                  {canGenerateObligations && fees.filter((fee) => fee.status === 'active'
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

          {tab === 'configuration' && canConfigure && (
            <section className="space-y-4" aria-label="Configuration des frais">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">Configuration des frais</h2>
                  <p className="mt-1 text-sm text-slate-500">Configurez les montants à payer par classe pour l’année sélectionnée.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {userRole === 'school_admin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setTab('fees');
                        setIsGenerationPanelOpen(true);
                      }}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-800"
                    >
                      Générer les obligations
                    </button>
                  )}
                  {!isFeeFormOpen && (
                  <button type="button" disabled={busy} onClick={() => {
                    setEditingTariffId(null);
                    setConfigurationMode('single');
                    setConfigurationCategoryCode('');
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
              </div>

              <section className="space-y-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4" aria-label="Échéancier de scolarité">
                <div>
                  <h3 className="font-bold text-slate-900">Échéancier de scolarité par classe</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Saisissez les montants exacts et les dates de chaque tranche. Le nombre de tranches est indépendant de la période pédagogique.
                    L’enregistrement est explicite et ne modifie aucune obligation déjà constituée.
                  </p>
                </div>
                <label className="grid max-w-md gap-1 text-sm font-semibold">
                  Classe
                  <select
                    aria-label="Classe de l’échéancier"
                    className="rounded-lg border border-slate-200 bg-white p-2 font-normal"
                    value={scheduleClassId ?? ''}
                    onChange={(event) => {
                      setScheduleClassId(Number(event.target.value) || null);
                      setScheduleError('');
                      setScheduleNotice('');
                    }}
                    disabled={scheduleBusy || !yearId}
                  >
                    <option value="">Sélectionner une classe</option>
                    {situationClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                {!yearId && <p className="text-sm text-amber-800">Sélectionnez une année scolaire.</p>}
                {scheduleClassId != null && scheduleTariff && (
                  <form onSubmit={saveTuitionSchedule} className="space-y-4">
                    <p className="text-sm font-semibold text-slate-700">
                      Tarif annuel de scolarité : {formatMoney(scheduleTariff.amount)}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-sm font-semibold">
                        Période pédagogique de référence
                        <select
                          aria-label="Période pédagogique de référence"
                          className="rounded-lg border border-slate-200 bg-white p-2 font-normal"
                          value={schedulePeriodType}
                          onChange={(event) => setSchedulePeriodType(event.target.value as 'annual' | 'trimester' | 'semester')}
                          disabled={scheduleBusy || scheduleLoading}
                        >
                          <option value="annual">Année</option>
                          <option value="trimester">Trimestre</option>
                          <option value="semester">Semestre</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">
                        Nombre de tranches (1 à 12)
                        <input
                          aria-label="Nombre de tranches"
                          className="rounded-lg border border-slate-200 bg-white p-2 font-normal"
                          type="number"
                          min="1"
                          max="12"
                          step="1"
                          value={scheduleDraftRows.length}
                          onChange={(event) => {
                            const count = Number(event.target.value);
                            if (!Number.isInteger(count) || count < 1 || count > 12) return;
                            setScheduleDraftRows((current) => Array.from({ length: count }, (_, index) =>
                              current[index] ?? { label: `Tranche ${index + 1}`, dueDate: '', amount: '' }));
                            setScheduleNotice('');
                          }}
                          disabled={scheduleBusy || scheduleLoading}
                        />
                      </label>
                    </div>
                    <div className="space-y-2">
                      {scheduleDraftRows.map((row, index) => (
                        <div key={index} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_1fr]">
                          <label className="grid gap-1 text-xs font-semibold">
                            Libellé de la tranche
                            <input
                              aria-label={`Libellé de la tranche ${index + 1}`}
                              className="rounded border border-slate-300 p-2 text-sm font-normal"
                              maxLength={80}
                              value={row.label}
                              onChange={(event) => setScheduleDraftRows((current) => current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, label: event.target.value } : item))}
                              disabled={scheduleBusy || scheduleLoading}
                            />
                          </label>
                          <label className="grid gap-1 text-xs font-semibold">
                            Date d’exigibilité
                            <input
                              aria-label={`Date d’exigibilité de la tranche ${index + 1}`}
                              className="rounded border border-slate-300 p-2 text-sm font-normal"
                              type="date"
                              value={row.dueDate}
                              onChange={(event) => setScheduleDraftRows((current) => current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, dueDate: event.target.value } : item))}
                              disabled={scheduleBusy || scheduleLoading}
                            />
                          </label>
                          <label className="grid gap-1 text-xs font-semibold">
                            Montant (FCFA)
                            <input
                              aria-label={`Montant de la tranche ${index + 1}`}
                              className="rounded border border-slate-300 p-2 text-sm font-normal"
                              type="number"
                              min="1"
                              step="1"
                              value={row.amount}
                              onChange={(event) => setScheduleDraftRows((current) => current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, amount: event.target.value } : item))}
                              disabled={scheduleBusy || scheduleLoading}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm font-semibold text-slate-700">
                      Total des tranches : {formatMoney(scheduleDraftTotal)} / {formatMoney(scheduleTariff.amount)}
                    </p>
                    {!scheduleDraftValid && (
                      <p role="status" className="text-sm text-amber-800">
                        Les montants doivent être des entiers strictement positifs, les dates valides et chronologiques, et leur somme doit égaler le tarif annuel.
                      </p>
                    )}
                    {scheduleLoading && <p className="text-sm text-slate-500">Chargement de l’échéancier…</p>}
                    {scheduleError && <p role="alert" className="text-sm text-rose-700">{scheduleError}</p>}
                    {scheduleNotice && <p role="status" className="text-sm text-emerald-800">{scheduleNotice}</p>}
                    <button
                      type="submit"
                      disabled={scheduleBusy || scheduleLoading || !scheduleDraftValid}
                      className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {scheduleBusy ? 'Enregistrement…' : 'Enregistrer l’échéancier'}
                    </button>
                  </form>
                )}
                {scheduleClassId != null && scheduleTariffsForClass.length !== 1 && (
                  <p role="alert" className="text-sm text-amber-800">
                    {scheduleError || 'Un tarif de scolarité unique doit être configuré pour cette classe.'}
                  </p>
                )}
              </section>

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
                    Type de frais
                    <select
                      aria-label="Type de frais"
                      required
                      className="rounded-lg border border-slate-200 p-2 font-normal"
                      value={configurationCategoryCode}
                      onChange={(event) => {
                        const value = event.target.value;
                        setConfigurationCategoryCode(
                          value === 'tuition' || value === 'enrollment' || value === 'custom' ? value : '',
                        );
                        setFeeLabel('');
                        setError('');
                      }}
                      disabled={busy || editingTariffId != null}
                    >
                      <option value="">Sélectionner un type de frais</option>
                      <option value="tuition" disabled={!categories.some((category) => category.code === 'tuition' && category.isEnabled)}>
                        Frais de scolarité
                      </option>
                      <option value="enrollment" disabled={!categories.some((category) => category.code === 'enrollment' && category.isEnabled)}>
                        Frais d'inscription
                      </option>
                      <option value="custom">Frais personnalisé</option>
                    </select>
                  </label>
                  {!categories.some((category) => category.code === 'tuition' && category.isEnabled) && (
                    <p className="text-sm text-amber-700 sm:col-span-2">
                      Le type Frais de scolarité n’est pas disponible pour cet établissement.
                    </p>
                  )}
                  {!categories.some((category) => category.code === 'enrollment' && category.isEnabled) && (
                    <p className="text-sm text-amber-700 sm:col-span-2">
                      Le type Frais d'inscription n’est pas disponible pour cet établissement.
                    </p>
                  )}
                  {configurationCategoryCode === 'custom' ? (
                    <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                      Libellé
                      <input required maxLength={120} className="rounded-lg border border-slate-200 p-2 font-normal" value={feeLabel}
                        onChange={(event) => setFeeLabel(event.target.value)} placeholder="Saisir le libellé du frais"
                        disabled={busy} />
                      {isStandardAccountingCategoryLabel(feeLabel.trim()) && (
                        <span role="alert" className="font-normal text-rose-700">
                          Ce libellé est réservé à un frais standard. Sélectionnez son type standard.
                        </span>
                      )}
                    </label>
                  ) : configurationCategoryCode === 'tuition' || configurationCategoryCode === 'enrollment' ? (
                    <p className="text-sm text-slate-600 sm:col-span-2">
                      Libellé fixe : {STANDARD_ACCOUNTING_CATEGORY_LABELS[configurationCategoryCode]}
                    </p>
                  ) : null}
                  {duplicateTariff && configurationMode === 'single' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
                      <span>Ce frais existe déjà pour cette classe et cette année. Modifiez le frais existant.</span>
                      {editingTariffId == null && (
                        <button type="button" onClick={() => {
                          setEditingTariffId(duplicateTariff.id);
                          setConfigurationCategoryCode(
                            duplicateTariff.categoryCode === 'tuition' || duplicateTariff.categoryCode === 'enrollment'
                              ? duplicateTariff.categoryCode
                              : 'custom',
                          );
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
                      setConfigurationCategoryCode('');
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
                      || !configurationCategoryCode
                      || (configurationCategoryCode === 'custom'
                        ? !feeLabel.trim() || isStandardAccountingCategoryLabel(feeLabel.trim())
                        : !selectedStandardCategory && editingTariffId == null)
                      || (configurationMode === 'single'
                        ? !selectedClassId || Boolean(duplicateTariff)
                        : !rangeHasPedagogicalOrder || rangeClasses.length === 0)
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
                        setConfigurationCategoryCode(
                          tariff.categoryCode === 'tuition' || tariff.categoryCode === 'enrollment'
                            ? tariff.categoryCode
                            : 'custom',
                        );
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
