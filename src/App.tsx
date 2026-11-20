import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  School,
  AcademicYear,
  Class,
  Teacher,
  Student,
  Parent,
  SystemNotification,
  User,
  UserRole,
  AuditEventDeactivationSummary,
  AuditEventFilters,
  AuditEventsPage,
  SubjectType,
  EducationLevel,
  AbsenceDeclaration,
} from './types.ts';
import {
  apiFetch,
  getUiErrorMessage,
  setSimulatedRole,
  clearSimulatedRole,
  clearSimulatedUser,
  setSimulatedUser,
  setActiveSchoolId,
  findTeacherProfileFromSimulatedUser,
  fetchLateArrivalJustifications,
  submitLateArrivalJustification,
  reviewLateArrivalJustification,
  reexamineLateArrivalJustification,
  fetchLateArrivalJustificationDetail,
  downloadLateArrivalJustificationFile,
  type LateArrivalJustificationListItem,
  type LateArrivalJustificationDetail,
  type HomeroomClassSummary,
} from './lib/api.ts';
import { useAuth } from './contexts/AuthContext.tsx';
import { useAbsences } from './hooks/useAbsences.ts';
import { useLateArrivals, type LateArrivalInput } from './hooks/useLateArrivals.ts';
import { createAbsenceRefreshSequence } from './lib/absenceRefresh.ts';
import { reexamineAbsenceJustification } from './lib/absenceJustificationApi.ts';
import { getEffectiveAbsenceJustificationStatus } from './lib/absenceJustificationStatus.ts';
import { normalizeAuditEvents } from './lib/auditEventReader.ts';
import type { LoginStats } from './hooks/useAdminDashboard.ts';
import type { ClassAgeStats } from './lib/studentAgeStats.ts';
import { countOverdueEvaluations, isEvaluationArchived, isEvaluationLockedBySchoolAdmin, isEvaluationArchivedForSchoolAdminByAge } from './lib/evaluationUtils.ts';
import SimulatorHeader from './components/SimulatorHeader.tsx';
import ParentWhatsAppButton from './components/ParentWhatsAppButton.tsx';
import LoginView from './components/LoginView.tsx';
import DashboardView from './components/DashboardView.tsx';
import AdminView from './components/AdminView.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import AbsenceView from './components/AbsenceView.tsx';
import AbsenceDeclarationValidationsView from './components/AbsenceDeclarationValidationsView.tsx';
import AbsenceControlsView from './components/AbsenceControlsView.tsx';
import NotesView from './components/NotesView.tsx';
import NotificationView from './components/NotificationView.tsx';
import AuditView from './components/AuditView.tsx';
import MobileParentView from './components/MobileParentView.tsx';
import ParentNotesView from './components/ParentNotesView.tsx';
import ArchiveView from './components/ArchiveView.tsx';
import BulletinsView from './components/BulletinsView.tsx';
import AccountingView from './components/AccountingView.tsx';
import ClassResultsView from './components/ClassResultsView.tsx';
import ClassSubjectPivotView from './components/ClassSubjectPivotView.tsx';
import GlobalErrorToast from './components/GlobalErrorToast.tsx';
import HomeroomView from './components/HomeroomView.tsx';
import SchoolSuspensionNotice from './components/SchoolSuspensionNotice.tsx';
import TeacherControlView from './components/TeacherControlView.tsx';

import {
  LayoutDashboard,
  Building2,
  CalendarDays,
  Award,
  Bell,
  Smartphone,
  Info,
  BookOpen,
  FileText,
  ClipboardCheck,
  ClipboardList,
  Table2,
  ChevronDown,
  LogOut,
  RefreshCw,
  AlertCircle,
  Wallet,
} from 'lucide-react';

function SidebarNavigationGroup({
  id,
  expanded,
  activeChild,
  hasSubmenu,
  onToggle,
  parent,
  children,
}: {
  id: string;
  expanded: boolean;
  activeChild: boolean;
  hasSubmenu: boolean;
  onToggle: () => void;
  parent: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={`${id}-navigation-group`}
      className={`rounded-2xl transition-colors ${activeChild ? 'bg-indigo-50/70 ring-1 ring-indigo-100' : ''}`}
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">{parent}</div>
        {hasSubmenu && (
          <button
            type="button"
            aria-label={`${expanded ? 'Réduire' : 'Développer'} le sous-menu`}
            aria-expanded={expanded}
            aria-controls={`${id}-submenu`}
            onClick={onToggle}
            disabled={activeChild}
            className="mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-indigo-700 disabled:cursor-default disabled:opacity-70"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {hasSubmenu && expanded && (
        <div
          id={`${id}-submenu`}
          data-testid={`${id}-submenu`}
          className="relative ml-5 space-y-1 border-l border-indigo-200/80 pb-2 pl-3"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function SidebarNavigationIcon({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center"
      data-nav-icon="true"
      data-testid={testId ?? 'sidebar-navigation-icon'}
    >
      {children}
    </span>
  );
}

function isAuditEventDeactivationSummary(value: unknown): value is AuditEventDeactivationSummary {
  return value !== null
    && typeof value === 'object'
    && 'id' in value
    && typeof value.id === 'number'
    && 'action' in value
    && typeof value.action === 'string'
    && 'resourceType' in value
    && value.resourceType === 'user'
    && 'resourceId' in value
    && typeof value.resourceId === 'number'
    && 'createdAt' in value
    && (typeof value.createdAt === 'string' || value.createdAt === null);
}

type SuperAdminSchoolDataSnapshot = {
  stats: {
    totalStudents: number;
    totalAbsences: number;
    totalClasses: number;
    totalTeachers: number;
    attendanceRate: number;
    absenceStatusCounts: {
      justified: number;
      unjustified: number;
      pending: number;
      declared: number;
    };
  };
  absenceDeclarationStats: {
    total: number;
    received: number;
    accepted: number;
    refused: number;
    cancelled: number;
    notRealized: number;
  };
  absenceJustificationStats: {
    total: number;
    pending: number;
    accepted: number;
    refused: number;
  };
  chartData: Array<{ name: string; taux: number }>;
  ageStatsByClass: ClassAgeStats[];
  ageStatsAsOf: string;
  years: AcademicYear[];
  classes: Class[];
  teachers: Teacher[];
  students: Student[];
  parents: Parent[];
  absences: any[];
  absenceDeclarations: AbsenceDeclaration[];
  lateArrivalJustifications: LateArrivalJustificationListItem[];
  absenceControls: any[];
  lateArrivals: any[];
  recentAbsences: any[];
  evaluations: any[];
  grades: any[];
  recentGrades: any[];
  notifications: SystemNotification[];
  subjects: any[];
  approvedSubjects: any[];
};

export default function App() {
  const { user: authenticatedUser, token, role, activeSchoolId } = useAuth();
  const { justifyAbsence, recordAbsenceControl } = useAbsences();
  const { lateArrivals: lateArrivalsList, setLateArrivals, addLateArrival } = useLateArrivals();
  const currentRole = role as UserRole;
  const currentSchoolId = activeSchoolId;
  const authContextScope = `${token ?? ''}:${authenticatedUser?.id ?? ''}:${authenticatedUser?.uid ?? ''}:${currentRole}`;
  const [superAdminSchoolFilterId, setSuperAdminSchoolFilterId] = useState<number | null>(null);
  const previousSuperAdminSchoolFilterIdRef = useRef(superAdminSchoolFilterId);
  const dataRefreshSequenceRef = useRef(0);
  const dataScopeRef = useRef('');
  const superAdminSchoolDataCacheRef = useRef(new Map<string, SuperAdminSchoolDataSnapshot>());
  const cacheRefreshInFlightRef = useRef(new Map<string, number>());
  const cacheableDataScopeRef = useRef<string | null>(null);
  dataScopeRef.current = `${authContextScope}:${currentRole}:${currentRole === 'super_admin' ? superAdminSchoolFilterId ?? 'all' : currentSchoolId ?? 'none'}`;
  const getSuperAdminSchoolDataScope = (schoolId: number | null) => (
    `${authContextScope}:super_admin:${schoolId ?? 'all'}`
  );
  const invalidateSuperAdminSchoolDataCache = (scope = dataScopeRef.current) => {
    superAdminSchoolDataCacheRef.current.delete(scope);
  };
  useEffect(() => {
    superAdminSchoolDataCacheRef.current.clear();
    cacheRefreshInFlightRef.current.clear();
  }, [authContextScope]);
  const [activeTab, setActiveTab] = useState('tableau-de-bord');
  const [expandedNavigationGroups, setExpandedNavigationGroups] = useState({
    absences: true,
    teacherControl: true,
  });
  const activeAbsenceSubmenu = activeTab === 'absence-declaration-validations'
    || activeTab === 'absence-validations'
    || activeTab === 'absence-controls';
  const activeTeacherControlSubmenu = activeTab === 'teacher-control-regularizations';
  const absenceGroupExpanded = expandedNavigationGroups.absences || activeAbsenceSubmenu;
  const teacherControlGroupExpanded = expandedNavigationGroups.teacherControl || activeTeacherControlSubmenu;
  const toggleNavigationGroup = (group: 'absences' | 'teacherControl') => {
    setExpandedNavigationGroups((previous) => ({ ...previous, [group]: !previous[group] }));
  };
  const [teacherControlRequestedTab, setTeacherControlRequestedTab] = useState<'sessions' | 'requests'>('sessions');
  const [shouldPrepareTeacherControl, setShouldPrepareTeacherControl] = useState(false);
  const [teacherControlSettledScopeKey, setTeacherControlSettledScopeKey] = useState<string | null>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const pendingTeacherControlNavigationRef = useRef<{
    scopeKey: string;
    fromTab: string;
    destination: 'teacher-control' | 'teacher-control-regularizations';
  } | null>(null);
  const [pendingRegularizationsCount, setPendingRegularizationsCount] = useState(0);
  const regularizationsCountRequestsInFlightRef = useRef(new Set<string>());
  const teacherControlScopeKey = `${currentRole}:${currentRole === 'super_admin' ? superAdminSchoolFilterId ?? 'global' : currentSchoolId ?? 'none'}`;
  const teacherControlScopeKeyRef = useRef(teacherControlScopeKey);
  teacherControlScopeKeyRef.current = teacherControlScopeKey;
  const handleTeacherControlInitialViewSettled = useCallback(() => {
    if (teacherControlScopeKeyRef.current !== teacherControlScopeKey) return;
    setTeacherControlSettledScopeKey(teacherControlScopeKey);
    const pendingNavigation = pendingTeacherControlNavigationRef.current;
    if (!pendingNavigation) return;
    pendingTeacherControlNavigationRef.current = null;
    if (pendingNavigation.scopeKey === teacherControlScopeKey
      && activeTabRef.current === pendingNavigation.fromTab) {
      setTeacherControlRequestedTab(pendingNavigation.destination === 'teacher-control' ? 'sessions' : 'requests');
      setActiveTab(pendingNavigation.destination);
    }
  }, [teacherControlScopeKey]);
  useEffect(() => {
    setTeacherControlSettledScopeKey(null);
    pendingTeacherControlNavigationRef.current = null;
  }, [teacherControlScopeKey]);
  const openTeacherControlDestination = (destination: 'teacher-control' | 'teacher-control-regularizations') => {
    setShouldPrepareTeacherControl(true);
    setTeacherControlRequestedTab(destination === 'teacher-control' ? 'sessions' : 'requests');
    if (destination === 'teacher-control-regularizations') {
      pendingTeacherControlNavigationRef.current = null;
      setActiveTab(destination);
      return;
    }
    if (activeTabRef.current === 'teacher-control-regularizations') {
      pendingTeacherControlNavigationRef.current = null;
      setActiveTab(destination);
      return;
    }
    if (teacherControlSettledScopeKey === teacherControlScopeKey) {
      pendingTeacherControlNavigationRef.current = null;
      setActiveTab(destination);
      return;
    }
    pendingTeacherControlNavigationRef.current = {
      scopeKey: teacherControlScopeKey,
      fromTab: activeTabRef.current,
      destination,
    };
  };
  const openTeacherControl = () => openTeacherControlDestination('teacher-control');
  const handleTeacherControlTabChange = useCallback((tab: 'sessions' | 'requests' | 'gps' | 'rates') => {
    setTeacherControlRequestedTab(tab === 'requests' ? 'requests' : 'sessions');
  }, []);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadedDataScope, setLoadedDataScope] = useState('');
  const [schoolDataCacheRevision, setSchoolDataCacheRevision] = useState(0);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const importCredentialsSessionRef = useRef(`${token ?? ''}:${authenticatedUser?.id ?? ''}:${authenticatedUser?.uid ?? ''}:${role}`);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [suspendedSchoolId, setSuspendedSchoolId] = useState<number | null>(null);
  const [availableSchools, setAvailableSchools] = useState<School[]>([]);
  const [availableMemberships, setAvailableMemberships] = useState<Array<{ schoolId: number; role: string }>>([]);
  const [schoolToSwitchTo, setSchoolToSwitchTo] = useState<number | ''>('');
  const [roleToSwitchTo, setRoleToSwitchTo] = useState('');
  const [isSwitchingSchool, setIsSwitchingSchool] = useState(false);
  const suspendedSchoolNoticeRef = useRef<number | null>(null);

  useEffect(() => {
    const sessionKey = `${token ?? ''}:${authenticatedUser?.id ?? ''}:${authenticatedUser?.uid ?? ''}:${role}`;
    if (importCredentialsSessionRef.current !== sessionKey) {
      importCredentialsSessionRef.current = sessionKey;
      setImportResult(null);
    }
  }, [authenticatedUser?.id, authenticatedUser?.uid, role, token]);

  useEffect(() => {
    const handleSchoolSuspended = (event: Event) => {
      const detail = (event as CustomEvent<{ schoolId?: number }>).detail;
      const schoolId = Number.isInteger(detail?.schoolId) ? Number(detail.schoolId) : activeSchoolId;
      if (schoolId != null && suspendedSchoolNoticeRef.current === schoolId) return;
      suspendedSchoolNoticeRef.current = schoolId;
      if (schoolId != null) {
        superAdminSchoolDataCacheRef.current.delete(getSuperAdminSchoolDataScope(schoolId));
      }
      setSuspendedSchoolId(schoolId);
      setSchoolsList([]);
      setYearsList([]);
      setClassesList([]);
      setTeachersList([]);
      setStudentsList([]);
      setParentsList([]);
      setHomeroomClassesList([]);
      setAbsencesList([]);
      setAbsenceDeclarationsList([]);
      setLateArrivalJustificationsList([]);
      setAbsenceControlsList([]);
      setSummaryRecentAbsences([]);
      setEvaluationsList([]);
      setGradesList([]);
      setSummaryRecentGrades([]);
      setNotificationsList([]);
      setAuditEvents([]);
      setAuditPage(null);
      setUsersList([]);
      setDisabledUsersList([]);
      setSubjectsList([]);
      setApprovedSubjectsList([]);
      setSubjectTypesList([]);
      setEducationLevels([]);
      setLateArrivals([]);
      setStats({
        totalStudents: 0,
        totalAbsences: 0,
        totalClasses: 0,
        totalTeachers: 0,
        attendanceRate: 0,
        absenceStatusCounts: { justified: 0, unjustified: 0, pending: 0, declared: 0 },
      });
      setAbsenceDeclarationStats({
        total: 0,
        received: 0,
        accepted: 0,
        refused: 0,
        cancelled: 0,
        notRealized: 0,
      });
      setAbsenceJustificationStats({ total: 0, pending: 0, accepted: 0, refused: 0 });
      setChartData([]);
      setSchoolToSwitchTo('');
      void apiFetch('/api/auth/schools')
        .then((payload) => {
          const schools = Array.isArray(payload?.schools) ? payload.schools : [];
           const memberships = Array.isArray(payload?.memberships)
             ? payload.memberships.filter((membership: { isActive?: boolean | null }) => membership.isActive !== false)
             : [];
           const initialSchoolId = schools.find((school: School) => !school.isSuspended)?.id ?? '';
           const initialRoles = memberships
             .filter((membership: { schoolId: number }) => membership.schoolId === initialSchoolId)
             .map((membership: { role: string }) => membership.role);
           setAvailableSchools(schools);
           setAvailableMemberships(memberships);
           setSchoolToSwitchTo(initialSchoolId);
           setRoleToSwitchTo(initialRoles.length === 1 ? initialRoles[0] : '');
        })
        .catch((error) => {
          console.error('Failed to load available schools after suspension:', error);
          setErrorMsg('Impossible de charger les autres écoles autorisées.');
        });
    };
    window.addEventListener('schoolSuspended', handleSchoolSuspended);
    return () => window.removeEventListener('schoolSuspended', handleSchoolSuspended);
  }, [activeSchoolId, authContextScope, setLateArrivals]);

  // States loaded from backend
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalAbsences: 0,
    totalClasses: 0,
    totalTeachers: 0,
    attendanceRate: 94.5,
    absenceStatusCounts: {
      justified: 0,
      unjustified: 0,
      pending: 0,
      declared: 0,
    },
  });
  const [absenceDeclarationStats, setAbsenceDeclarationStats] = useState({
    total: 0,
    received: 0,
    accepted: 0,
    refused: 0,
    cancelled: 0,
    notRealized: 0,
  });
  const [absenceJustificationStats, setAbsenceJustificationStats] = useState({
    total: 0,
    pending: 0,
    accepted: 0,
    refused: 0,
  });
  const [chartData, setChartData] = useState<Array<{ name: string; taux: number }>>([]);
  const [ageStatsByClass, setAgeStatsByClass] = useState<ClassAgeStats[]>([]);
  const [ageStatsAsOf, setAgeStatsAsOf] = useState('');
  const [schoolsList, setSchoolsList] = useState<School[]>([]);
  const [yearsList, setYearsList] = useState<AcademicYear[]>([]);
  const [classesList, setClassesList] = useState<Class[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [parentsList, setParentsList] = useState<Parent[]>([]);
  const [homeroomClassesList, setHomeroomClassesList] = useState<HomeroomClassSummary[]>([]);

  const logTeachersPayload = (prefix: string, payload: unknown) => {
    if (!Array.isArray(payload)) {
      console.log(`${prefix} payload is not an array:`, payload);
      return;
    }
    console.log(`${prefix} length=${payload.length}`);
    payload.forEach((teacher: any, index: number) => {
      console.log(`${prefix} [${index}]`, {
        id: teacher?.id,
        uid: teacher?.uid,
        email: teacher?.email,
        classIds: teacher?.classIds,
      });
    });
  };
  const [absencesList, setAbsencesList] = useState<any[]>([]);
  const absenceRefreshSequenceRef = useRef(createAbsenceRefreshSequence());
  const [absenceDeclarationsList, setAbsenceDeclarationsList] = useState<AbsenceDeclaration[]>([]);
  const [lateArrivalJustificationsList, setLateArrivalJustificationsList] = useState<LateArrivalJustificationListItem[]>([]);
  const [absenceControlsList, setAbsenceControlsList] = useState<any[]>([]);
  const [summaryRecentAbsences, setSummaryRecentAbsences] = useState<any[]>([]);
  const unjustifiedAbsencesCount = absencesList.filter((absence: any) => {
    const status = getEffectiveAbsenceJustificationStatus(absence);
    return status === 'REJECTED' || (status === null && !absence.isJustified && !absence.declarationId);
  }).length;
  const pendingAbsenceValidationsCount = Math.max(0, Number(stats.absenceStatusCounts.pending) || 0);
  const pendingAttendanceJustificationsCount = pendingAbsenceValidationsCount
    + lateArrivalJustificationsList.filter(({ justification }) => justification.status === 'PENDING').length;
  const pendingAbsenceDeclarationsCount = absenceDeclarationsList.filter((declaration) => declaration.status === 'RECEIVED').length;
  const [evaluationsList, setEvaluationsList] = useState<any[]>([]);
  const [gradesList, setGradesList] = useState<any[]>([]);
  const [summaryRecentGrades, setSummaryRecentGrades] = useState<any[]>([]);
  const [loginStats, setLoginStats] = useState<LoginStats>({
    totalLogins: 0,
    uniqueUsers: 0,
    webLogins: 0,
    androidLogins: 0,
    loginsByDay: [],
    loginsByRole: [],
  });
  const [notificationsList, setNotificationsList] = useState<SystemNotification[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventDeactivationSummary[]>([]);
  const [auditPage, setAuditPage] = useState<AuditEventsPage | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [disabledUsersList, setDisabledUsersList] = useState<User[]>([]);
  const [subjectsList, setSubjectsList] = useState<any[]>([]);
  const [approvedSubjectsList, setApprovedSubjectsList] = useState<any[]>([]);
  const [subjectTypesList, setSubjectTypesList] = useState<SubjectType[]>([]);
  const [educationLevels, setEducationLevels] = useState<EducationLevel[]>([]);
  const processedNotificationIdsRef = useRef<Set<number>>(new Set());
  const parentFocusCheckInFlightRef = useRef(false);

  const currentTeacherProfile = findTeacherProfileFromSimulatedUser(currentRole, authenticatedUser, teachersList, usersList);

  const applySuperAdminSchoolDataSnapshot = (
    snapshot: SuperAdminSchoolDataSnapshot,
    scope: string,
  ) => {
    snapshot.notifications.forEach((notification) => {
      processedNotificationIdsRef.current.add(notification.id);
    });
    setStats(snapshot.stats);
    setAbsenceDeclarationStats(snapshot.absenceDeclarationStats);
    setAbsenceJustificationStats(snapshot.absenceJustificationStats);
    setChartData(snapshot.chartData);
    setAgeStatsByClass(snapshot.ageStatsByClass);
    setAgeStatsAsOf(snapshot.ageStatsAsOf);
    setYearsList(snapshot.years);
    setClassesList(snapshot.classes);
    setTeachersList(snapshot.teachers);
    setStudentsList(snapshot.students);
    setParentsList(snapshot.parents);
    setAbsencesList(snapshot.absences);
    setAbsenceDeclarationsList(snapshot.absenceDeclarations);
    setLateArrivalJustificationsList(snapshot.lateArrivalJustifications);
    setAbsenceControlsList(snapshot.absenceControls);
    setLateArrivals(snapshot.lateArrivals);
    setSummaryRecentAbsences(snapshot.recentAbsences);
    setEvaluationsList(snapshot.evaluations);
    setGradesList(snapshot.grades);
    setSummaryRecentGrades(snapshot.recentGrades);
    setNotificationsList(snapshot.notifications);
    setSubjectsList(snapshot.subjects);
    setApprovedSubjectsList(snapshot.approvedSubjects);
    setLoadedDataScope(scope);
  };

  useEffect(() => {
    if (
      currentRole !== 'super_admin'
      || suspendedSchoolId != null
      || loadedDataScope !== dataScopeRef.current
      || cacheRefreshInFlightRef.current.has(dataScopeRef.current)
      || cacheableDataScopeRef.current !== dataScopeRef.current
    ) return;

    superAdminSchoolDataCacheRef.current.set(dataScopeRef.current, {
      stats,
      absenceDeclarationStats,
      absenceJustificationStats,
      chartData,
      ageStatsByClass,
      ageStatsAsOf,
      years: yearsList,
      classes: classesList,
      teachers: teachersList,
      students: studentsList,
      parents: parentsList,
      absences: absencesList,
      absenceDeclarations: absenceDeclarationsList,
      lateArrivalJustifications: lateArrivalJustificationsList,
      absenceControls: absenceControlsList,
      lateArrivals: lateArrivalsList,
      recentAbsences: summaryRecentAbsences,
      evaluations: evaluationsList,
      grades: gradesList,
      recentGrades: summaryRecentGrades,
      notifications: notificationsList,
      subjects: subjectsList,
      approvedSubjects: approvedSubjectsList,
    });
  }, [
    absenceControlsList,
    absenceDeclarationStats,
    absenceDeclarationsList,
    absenceJustificationStats,
    absencesList,
    ageStatsAsOf,
    ageStatsByClass,
    approvedSubjectsList,
    chartData,
    classesList,
    currentRole,
    gradesList,
    lateArrivalJustificationsList,
    lateArrivalsList,
    loadedDataScope,
    notificationsList,
    parentsList,
    stats,
    studentsList,
    subjectsList,
    summaryRecentAbsences,
    summaryRecentGrades,
    teachersList,
    yearsList,
    suspendedSchoolId,
    schoolDataCacheRevision,
  ]);

  const currentTeacherTeachingAssignments = (currentTeacherProfile?.teachingAssignments || [])
    .filter((assignment) => assignment.isActive === true && assignment.schoolId === currentSchoolId);
  const currentTeacherClassIds: number[] = Array.from(new Set<number>(currentTeacherTeachingAssignments
    .map((assignment) => Number(assignment.classId))
    .filter((classId) => Number.isInteger(classId))));
  const currentTeacherSubjectIds: number[] = Array.from(new Set<number>(currentTeacherTeachingAssignments
    .map((assignment) => Number(assignment.subjectId))
    .filter((subjectId) => Number.isInteger(subjectId))));
  const currentTeacherHomeroomClassIds: number[] = Array.from(new Set(
    (currentTeacherProfile?.homeroomAssignments || [])
      .filter((assignment) => assignment.schoolId === currentSchoolId)
      .map((assignment) => Number(assignment.classId))
      .filter((classId) => Number.isInteger(classId)),
  ));
  const visibleErrorMsg = getUiErrorMessage(errorMsg);

  const noteOverdueCount = currentRole === 'teacher' || currentRole === 'surveillant' || currentRole === 'school_admin' || currentRole === 'school_accountant' || currentRole === 'super_admin'
    ? countOverdueEvaluations(
      evaluationsList,
      studentsList,
      gradesList,
      currentRole as UserRole,
      undefined,
    )
    : 0;

  const normalizeStudentsPayload = (payload: unknown): Student[] => {
    if (Array.isArray(payload)) return payload as Student[];

    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const maybeStudents = record.students;
      if (Array.isArray(maybeStudents)) return maybeStudents as Student[];

      const maybeData = record.data;
      if (Array.isArray(maybeData)) return maybeData as Student[];
      if (maybeData && typeof maybeData === 'object') {
        const nestedStudents = (maybeData as Record<string, unknown>).students;
        if (Array.isArray(nestedStudents)) return nestedStudents as Student[];
      }
    }

    return [];
  };

  const fetchAuditEvents = async (filters: AuditEventFilters = {}) => {
    if (currentRole !== 'super_admin') {
      setAuditPage(null);
      return;
    }

    setIsAuditLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
      });
      const response = await apiFetch(`/api/audit/events?${params.toString()}`);
      if (!response || !Array.isArray(response.events)) {
        throw new TypeError('Invalid audit events response.');
      }
      setAuditPage({
        ...response,
        events: normalizeAuditEvents(response.events),
      });
    } catch (auditErr: any) {
      console.warn('Impossible de charger le journal d\'événements :', auditErr);
      setAuditPage(null);
      setErrorMsg('Impossible de charger le journal des actions.');
    } finally {
      setIsAuditLoading(false);
    }
  };

  const fetchAccountDeactivationEvents = async (userIds: number[]) => {
    if (currentRole !== 'super_admin') {
      setAuditEvents([]);
      return;
    }
    try {
      const eventBatches = await Promise.all(
        Array.from({ length: Math.ceil(userIds.length / 400) }, (_, index) => {
          const batch = userIds.slice(index * 400, (index + 1) * 400);
          const params = new URLSearchParams({ userIds: batch.join(',') });
          return apiFetch(`/api/audit/deactivations?${params.toString()}`);
        }),
      );
      const events = eventBatches.flat();
      const summaries = events.filter(isAuditEventDeactivationSummary);
      if (summaries.length !== events.length) throw new TypeError('Invalid account deactivation events response.');
      setAuditEvents(summaries);
    } catch (auditErr) {
      console.warn('Impossible de charger les dates de désactivation :', auditErr);
      setAuditEvents([]);
    }
  };

  // Authenticate & Fetch data on load and whenever simulation role changes
  const fetchAllData = async (showSpinner = true) => {
    if (!role || (role !== 'super_admin' && activeSchoolId == null)) return;

    const requestScope = currentRole === 'super_admin'
      ? getSuperAdminSchoolDataScope(superAdminSchoolFilterId)
      : `${authContextScope}:${currentRole}:${currentSchoolId ?? 'none'}`;
    if (requestScope !== dataScopeRef.current) return;

    const requestId = ++dataRefreshSequenceRef.current;
    if (currentRole === 'super_admin') {
      invalidateSuperAdminSchoolDataCache(requestScope);
      cacheRefreshInFlightRef.current.set(requestScope, requestId);
      cacheableDataScopeRef.current = null;
    }
    const isCurrentRequest = () => requestId === dataRefreshSequenceRef.current
      && requestScope === dataScopeRef.current;
    const absenceRefreshRequestId = absenceRefreshSequenceRef.current.begin();
    let cacheableResult = false;
    if (showSpinner) setIsSyncing(true);
    setErrorMsg(null);
    try {
      // 1. Sync authentication role switcher context
      await apiFetch('/api/auth/register-or-login', { method: 'POST' }).catch((err) => {
        const uiMessage = getUiErrorMessage(err);
        if (uiMessage) {
          console.warn('Auth sync warning ignored in UI:', err);
        }
      });
      if (!isCurrentRequest()) return;

      // 2. Load dashboard summary & role details
      const schoolQuery = currentRole === 'super_admin' && superAdminSchoolFilterId != null
        ? `?schoolId=${encodeURIComponent(superAdminSchoolFilterId)}`
        : '';
      const summary = await apiFetch(`/api/dashboard/summary${schoolQuery}`);
      if (!isCurrentRequest()) return;
      console.log('RAW API RESPONSE DASHBOARD:', summary);
      console.log('chartData reçu:', (summary as any)?.chartData);
      if (summary && typeof summary === 'object') {
        if ('stats' in summary) setStats((prev) => ({ ...prev, ...summary.stats }));
        if ('absenceStatusCounts' in summary) {
          setStats((prev) => ({
            ...prev,
            absenceStatusCounts: summary.absenceStatusCounts || prev.absenceStatusCounts,
          }));
        }
        if ('absenceDeclarationStats' in summary) {
          setAbsenceDeclarationStats(summary.absenceDeclarationStats);
        }
        if ('absenceJustificationStats' in summary) {
          setAbsenceJustificationStats(summary.absenceJustificationStats);
        }
        if ('recentGrades' in summary) setSummaryRecentGrades(summary.recentGrades);
        if ('recentAbsences' in summary) setSummaryRecentAbsences(summary.recentAbsences);
        if (Array.isArray((summary as any).chartData)) {
          setChartData((summary as any).chartData);
        } else {
          setChartData([]);
        }
        setAgeStatsByClass(Array.isArray((summary as any).ageStatsByClass) ? (summary as any).ageStatsByClass : []);
        setAgeStatsAsOf(typeof (summary as any).ageStatsAsOf === 'string' ? (summary as any).ageStatsAsOf : '');
      }

      if (currentRole === 'super_admin') {
        try {
          const loginSummary = await apiFetch('/api/admin/login-stats');
          setLoginStats({
            totalLogins: Number(loginSummary?.totalLogins || 0),
            uniqueUsers: Number(loginSummary?.uniqueUsers || 0),
            webLogins: Number(loginSummary?.webLogins || 0),
            androidLogins: Number(loginSummary?.androidLogins || 0),
            loginsByDay: Array.isArray(loginSummary?.loginsByDay) ? loginSummary.loginsByDay : [],
            loginsByRole: Array.isArray(loginSummary?.loginsByRole) ? loginSummary.loginsByRole : [],
          });
        } catch {
          setLoginStats({
            totalLogins: 0,
            uniqueUsers: 0,
            webLogins: 0,
            androidLogins: 0,
            loginsByDay: [],
            loginsByRole: [],
          });
        }
      } else {
        setLoginStats({
          totalLogins: 0,
          uniqueUsers: 0,
          webLogins: 0,
          androidLogins: 0,
          loginsByDay: [],
          loginsByRole: [],
        });
      }

      // 3. Load other lists for CRUD and management tabs
      const withSchoolFilter = (endpoint: string) => {
        if (currentRole !== 'super_admin' || superAdminSchoolFilterId == null) return endpoint;
        const separator = endpoint.includes('?') ? '&' : '?';
        return `${endpoint}${separator}schoolId=${encodeURIComponent(superAdminSchoolFilterId)}`;
      };
      const classesEndpoint = currentRole !== 'super_admin' && currentSchoolId != null
        ? `/api/classes?schoolId=${currentSchoolId}`
        : withSchoolFilter('/api/classes');
      const studentsEndpoint = withSchoolFilter('/api/students?includeFormer=true');
      const homeroomClassesEndpoint = currentRole === 'teacher' ? '/api/my-homeroom-classes' : null;
      const disabledUsersEndpoint = currentRole === 'super_admin'
        ? '/api/simulation/users?includeDeleted=true'
        : null;
      const endpointRoutes = [
        { key: '/api/schools', url: '/api/schools' },
        { key: '/api/academic-years', url: withSchoolFilter('/api/academic-years') },
        { key: classesEndpoint, url: classesEndpoint },
        { key: '/api/teachers', url: withSchoolFilter('/api/teachers') },
        { key: studentsEndpoint, url: studentsEndpoint },
        { key: '/api/parents', url: withSchoolFilter('/api/parents') },
        { key: '/api/absences', url: withSchoolFilter('/api/absences') },
        { key: '/api/absence-declarations', url: withSchoolFilter('/api/absence-declarations') },
        { key: '/api/late-arrivals', url: withSchoolFilter('/api/late-arrivals') },
        { key: '/api/absence-controls', url: withSchoolFilter('/api/absence-controls') },
        { key: '/api/evaluations', url: withSchoolFilter('/api/evaluations') },
        { key: '/api/grades', url: withSchoolFilter('/api/grades') },
        { key: '/api/notifications', url: withSchoolFilter('/api/notifications') },
        { key: '/api/subjects', url: withSchoolFilter('/api/subjects') },
        { key: '/api/subjects?approvedOnly=true', url: withSchoolFilter('/api/subjects?approvedOnly=true') },
        { key: '/api/subject-types', url: '/api/subject-types' },
        { key: '/api/education/levels', url: '/api/education/levels' },
        { key: '/api/simulation/users', url: '/api/simulation/users' },
        ...(disabledUsersEndpoint ? [{ key: disabledUsersEndpoint, url: disabledUsersEndpoint }] : []),
        ...(homeroomClassesEndpoint ? [{ key: homeroomClassesEndpoint, url: homeroomClassesEndpoint }] : []),
      ];
      const endpoints = endpointRoutes.map(({ key }) => key);
      const promises = endpointRoutes.map(({ url }) =>
        apiFetch(url).catch((err) => ({ __error: true, error: err })),
      );
      const canLoadLateArrivalJustifications = ['parent', 'teacher', 'surveillant', 'school_admin', 'school_accountant', 'super_admin'].includes(currentRole);
      const [results, lateArrivalJustifications] = await Promise.all([
        Promise.all(promises),
        canLoadLateArrivalJustifications
          ? fetchLateArrivalJustifications(
            currentRole === 'super_admin' ? superAdminSchoolFilterId ?? undefined : undefined,
          ).catch((err) => ({ __error: true, error: err }))
          : Promise.resolve([] as LateArrivalJustificationListItem[]),
      ]);
      if (!isCurrentRequest()) return;
      cacheableResult = currentRole === 'super_admin'
        && results.every(Array.isArray)
        && Array.isArray(lateArrivalJustifications);

      const map = Object.fromEntries(endpoints.map((e, i) => [e, results[i]]));
      logTeachersPayload('RAW_API_RESPONSE_/api/teachers', results[endpoints.indexOf('/api/teachers')]);
      logTeachersPayload('MAP_/api/teachers', map['/api/teachers']);
      if (Array.isArray(map['/api/teachers'])) {
        logTeachersPayload('BEFORE_SET_TEACHERSLIST', map['/api/teachers']);
        setTeachersList(map['/api/teachers']);
      }
      if (Array.isArray(map['/api/schools'])) setSchoolsList(map['/api/schools']);
      if (Array.isArray(map['/api/academic-years'])) setYearsList(map['/api/academic-years']);
      if (Array.isArray(map[classesEndpoint])) {
        setClassesList((previousClasses) =>
          currentRole === 'teacher' && map[classesEndpoint].length === 0
            ? previousClasses
            : map[classesEndpoint]
        );
      }

      const rawStudentsPayload = map[studentsEndpoint];
      const normalizedStudents = normalizeStudentsPayload(rawStudentsPayload);
      setStudentsList(normalizedStudents);

      if (Array.isArray(map['/api/parents'])) setParentsList(map['/api/parents']);
      if (Array.isArray(map['/api/absences']) && absenceRefreshSequenceRef.current.isLatest(absenceRefreshRequestId)) {
        setAbsencesList(map['/api/absences']);
      }
      if (Array.isArray(map['/api/absence-declarations'])) setAbsenceDeclarationsList(map['/api/absence-declarations']);
      if (Array.isArray(map['/api/late-arrivals'])) setLateArrivals(map['/api/late-arrivals']);
      const selectedSchoolLateArrivalIds = new Set(
        currentRole === 'super_admin' && superAdminSchoolFilterId != null && Array.isArray(map['/api/late-arrivals'])
          ? map['/api/late-arrivals'].map((arrival: any) => arrival.id)
          : [],
      );
      if (Array.isArray(lateArrivalJustifications)) {
        setLateArrivalJustificationsList(
          currentRole === 'super_admin' && superAdminSchoolFilterId != null
            ? lateArrivalJustifications.filter((item) => selectedSchoolLateArrivalIds.has(item.lateArrival.id))
            : lateArrivalJustifications,
        );
      }
      else if (lateArrivalJustifications?.__error) {
        console.error('Failed to load late-arrival justifications:', lateArrivalJustifications.error);
        setErrorMsg(getUiErrorMessage(
          lateArrivalJustifications.error,
          'Impossible de charger les justifications de retard.',
        ));
      }
      if (Array.isArray(map['/api/absence-controls'])) setAbsenceControlsList(map['/api/absence-controls']);
      if (Array.isArray(map['/api/evaluations'])) setEvaluationsList(map['/api/evaluations']);
      if (Array.isArray(map['/api/grades'])) setGradesList(map['/api/grades']);
      if (Array.isArray(map['/api/notifications'])) setNotificationsList(map['/api/notifications']);
      if (Array.isArray(map['/api/subjects'])) setSubjectsList(map['/api/subjects']);
      if (Array.isArray(map['/api/subjects?approvedOnly=true'])) setApprovedSubjectsList(map['/api/subjects?approvedOnly=true']);
      if (Array.isArray(map['/api/subject-types'])) setSubjectTypesList(map['/api/subject-types']);
      if (Array.isArray(map['/api/education/levels'])) setEducationLevels(map['/api/education/levels']);
      if (Array.isArray(map['/api/simulation/users'])) setUsersList(map['/api/simulation/users']);
      const disabledAccountRows = disabledUsersEndpoint && Array.isArray(map[disabledUsersEndpoint])
        ? map[disabledUsersEndpoint].filter((user: User) => (
          user.isDeleted === true && ['teacher', 'school_admin', 'school_accountant', 'parent'].includes(user.role)
        ))
        : [];
      if (disabledAccountRows.length > 0) {
        setDisabledUsersList(disabledAccountRows);
      } else {
        setDisabledUsersList([]);
      }
      if (homeroomClassesEndpoint && Array.isArray(map[homeroomClassesEndpoint])) {
        setHomeroomClassesList(map[homeroomClassesEndpoint]);
      } else if (currentRole !== 'teacher') {
        setHomeroomClassesList([]);
      }

      if (currentRole === 'super_admin') {
        await fetchAccountDeactivationEvents(disabledAccountRows.map((user: User) => user.id));
      } else {
        setAuditEvents([]);
        setAuditPage(null);
      }
      if (!isCurrentRequest()) return;
      cacheableDataScopeRef.current = cacheableResult ? requestScope : null;
      setLoadedDataScope(requestScope);
    } catch (err: any) {
      if (!isCurrentRequest()) return;
      const uiMessage = getUiErrorMessage(err, 'Impossible de charger les données EcoleTrack.');
      if (uiMessage) {
        setErrorMsg(uiMessage);
      }
      console.error('Error hydrating EcoleTrack database:', err);
      console.warn('[students-load] keeping existing student list because the refresh failed.', err);
    } finally {
      if (isCurrentRequest()) setIsSyncing(false);
      if (
        currentRole === 'super_admin'
        && cacheRefreshInFlightRef.current.get(requestScope) === requestId
      ) {
        cacheRefreshInFlightRef.current.delete(requestScope);
        if (isCurrentRequest() && cacheableResult) {
          setSchoolDataCacheRevision((revision) => revision + 1);
        }
      }
    }
  };

  const refreshSuperAdminSchoolData = async () => {
    if (currentRole !== 'super_admin') return;

    const requestScope = getSuperAdminSchoolDataScope(superAdminSchoolFilterId);
    if (requestScope !== dataScopeRef.current) return;
    const requestId = ++dataRefreshSequenceRef.current;
    if (superAdminSchoolDataCacheRef.current.has(requestScope)) {
      return;
    }
    cacheableDataScopeRef.current = null;
    cacheRefreshInFlightRef.current.delete(requestScope);
    const isCurrentRequest = () => requestId === dataRefreshSequenceRef.current
      && requestScope === dataScopeRef.current;
    const absenceRefreshRequestId = absenceRefreshSequenceRef.current.begin();
    const withSchoolFilter = (endpoint: string) => {
      if (superAdminSchoolFilterId == null) return endpoint;
      const separator = endpoint.includes('?') ? '&' : '?';
      return `${endpoint}${separator}schoolId=${encodeURIComponent(superAdminSchoolFilterId)}`;
    };
    const endpointRoutes = [
      { key: 'academicYears', url: withSchoolFilter('/api/academic-years') },
      { key: 'classes', url: withSchoolFilter('/api/classes') },
      { key: 'teachers', url: withSchoolFilter('/api/teachers') },
      { key: 'students', url: withSchoolFilter('/api/students?includeFormer=true') },
      { key: 'parents', url: withSchoolFilter('/api/parents') },
      { key: 'absences', url: withSchoolFilter('/api/absences') },
      { key: 'absenceDeclarations', url: withSchoolFilter('/api/absence-declarations') },
      { key: 'lateArrivals', url: withSchoolFilter('/api/late-arrivals') },
      { key: 'absenceControls', url: withSchoolFilter('/api/absence-controls') },
      { key: 'evaluations', url: withSchoolFilter('/api/evaluations') },
      { key: 'grades', url: withSchoolFilter('/api/grades') },
      { key: 'notifications', url: withSchoolFilter('/api/notifications') },
      { key: 'subjects', url: withSchoolFilter('/api/subjects') },
      { key: 'approvedSubjects', url: withSchoolFilter('/api/subjects?approvedOnly=true') },
    ];

    setErrorMsg(null);
    try {
      const [summary, results, lateArrivalJustifications] = await Promise.all([
        apiFetch(withSchoolFilter('/api/dashboard/summary')),
        Promise.all(endpointRoutes.map(({ url }) =>
          apiFetch(url).catch((error) => ({ __error: true, error })),
        )),
        fetchLateArrivalJustifications(superAdminSchoolFilterId ?? undefined)
          .catch((error) => ({ __error: true, error })),
      ]);
      if (!isCurrentRequest()) return;

      const failedResult = results.find((result) => !Array.isArray(result) || result?.__error);
      if (failedResult) {
        throw failedResult.error ?? new TypeError('Invalid school-scoped data response.');
      }
      if (!Array.isArray(lateArrivalJustifications)) {
        throw lateArrivalJustifications?.error ?? new TypeError('Invalid late-arrival justifications response.');
      }
      if (!summary || typeof summary !== 'object') {
        throw new TypeError('Invalid dashboard summary response.');
      }

      const map = Object.fromEntries(endpointRoutes.map(({ key }, index) => [key, results[index]]));
      if ('stats' in summary) setStats((prev) => ({ ...prev, ...summary.stats }));
      if ('absenceStatusCounts' in summary) {
        setStats((prev) => ({
          ...prev,
          absenceStatusCounts: summary.absenceStatusCounts || prev.absenceStatusCounts,
        }));
      }
      if ('absenceDeclarationStats' in summary) setAbsenceDeclarationStats(summary.absenceDeclarationStats);
      if ('absenceJustificationStats' in summary) setAbsenceJustificationStats(summary.absenceJustificationStats);
      if ('recentGrades' in summary) setSummaryRecentGrades(summary.recentGrades);
      if ('recentAbsences' in summary) setSummaryRecentAbsences(summary.recentAbsences);
      setChartData(Array.isArray(summary.chartData) ? summary.chartData : []);
      setAgeStatsByClass(Array.isArray(summary.ageStatsByClass) ? summary.ageStatsByClass : []);
      setAgeStatsAsOf(typeof summary.ageStatsAsOf === 'string' ? summary.ageStatsAsOf : '');

      setYearsList(map.academicYears);
      setClassesList(map.classes);
      setTeachersList(map.teachers);
      setStudentsList(normalizeStudentsPayload(map.students));
      setParentsList(map.parents);
      if (absenceRefreshSequenceRef.current.isLatest(absenceRefreshRequestId)) {
        setAbsencesList(map.absences);
      }
      setAbsenceDeclarationsList(map.absenceDeclarations);
      setLateArrivals(map.lateArrivals);
      setAbsenceControlsList(map.absenceControls);
      setEvaluationsList(map.evaluations);
      setGradesList(map.grades);
      map.notifications.forEach((notification: SystemNotification) => {
        processedNotificationIdsRef.current.add(notification.id);
      });
      setNotificationsList(map.notifications);
      setSubjectsList(map.subjects);
      setApprovedSubjectsList(map.approvedSubjects);
      const selectedSchoolLateArrivalIds = new Set(map.lateArrivals.map((arrival: any) => arrival.id));
      setLateArrivalJustificationsList(
        lateArrivalJustifications.filter((item) => selectedSchoolLateArrivalIds.has(item.lateArrival.id)),
      );
      cacheableDataScopeRef.current = requestScope;
      setLoadedDataScope(requestScope);
    } catch (error: any) {
      if (!isCurrentRequest()) return;
      console.error('Failed to refresh Super Admin school-scoped data:', error);
      setErrorMsg(getUiErrorMessage(error, 'Impossible d’actualiser les données de l’établissement.'));
    }
  };

  const handleSuperAdminSchoolFilterChange = (schoolId: number | null) => {
    if (schoolId === superAdminSchoolFilterId) return;

    const nextScope = getSuperAdminSchoolDataScope(schoolId);
    const cachedSnapshot = superAdminSchoolDataCacheRef.current.get(nextScope);
    dataRefreshSequenceRef.current += 1;
    absenceRefreshSequenceRef.current.begin();
    setSuperAdminSchoolFilterId(schoolId);
    setIsSyncing(false);
    setErrorMsg(null);

    if (cachedSnapshot) {
      applySuperAdminSchoolDataSnapshot(cachedSnapshot, nextScope);
      return;
    }

    setStats({
      totalStudents: 0,
      totalAbsences: 0,
      totalClasses: 0,
      totalTeachers: 0,
      attendanceRate: 0,
      absenceStatusCounts: { justified: 0, unjustified: 0, pending: 0, declared: 0 },
    });
    setAbsenceDeclarationStats({ total: 0, received: 0, accepted: 0, refused: 0, cancelled: 0, notRealized: 0 });
    setAbsenceJustificationStats({ total: 0, pending: 0, accepted: 0, refused: 0 });
    setSummaryRecentGrades([]);
    setSummaryRecentAbsences([]);
    setChartData([]);
    setAgeStatsByClass([]);
    setAgeStatsAsOf('');
    setYearsList([]);
    setClassesList([]);
    setTeachersList([]);
    setStudentsList([]);
    setParentsList([]);
    setAbsencesList([]);
    setAbsenceDeclarationsList([]);
    setLateArrivalJustificationsList([]);
    setAbsenceControlsList([]);
    setLateArrivals([]);
    setEvaluationsList([]);
    setGradesList([]);
    setNotificationsList([]);
    setSubjectsList([]);
    setApprovedSubjectsList([]);
  };

  const refreshGrades = async () => {
    const requestScope = dataScopeRef.current;
    const endpoint = currentRole === 'super_admin' && superAdminSchoolFilterId != null
      ? `/api/grades?schoolId=${encodeURIComponent(superAdminSchoolFilterId)}`
      : '/api/grades';
    const grades = await apiFetch(endpoint);
    if (requestScope !== dataScopeRef.current) return;
    if (Array.isArray(grades)) setGradesList(grades);
  };

  useEffect(() => {
    logTeachersPayload('AFTER_SET_TEACHERSLIST', teachersList);
  }, [teachersList]);

  useEffect(() => {
    if (role !== 'super_admin') {
      setSuperAdminSchoolFilterId(null);
    }
  }, [role]);

  useEffect(() => {
    if (!role) return;
    if (currentRole === 'super_admin' || activeSchoolId != null) {
      fetchAllData();
    }
  }, [activeSchoolId, authContextScope, currentRole, role]);

  useEffect(() => {
    if (currentRole !== 'super_admin') {
      previousSuperAdminSchoolFilterIdRef.current = superAdminSchoolFilterId;
      return;
    }
    if (previousSuperAdminSchoolFilterIdRef.current === superAdminSchoolFilterId) return;
    previousSuperAdminSchoolFilterIdRef.current = superAdminSchoolFilterId;
    if (superAdminSchoolDataCacheRef.current.has(dataScopeRef.current)) {
      setLoadedDataScope(dataScopeRef.current);
      setIsSyncing(false);
      return;
    }
    void refreshSuperAdminSchoolData();
  }, [currentRole, superAdminSchoolFilterId]);

  useEffect(() => {
    setPendingRegularizationsCount(0);
    if (!['teacher', 'school_admin', 'school_accountant', 'super_admin'].includes(currentRole)) {
      return;
    }
    if (currentRole !== 'super_admin' && activeSchoolId == null) {
      return;
    }

    let active = true;
    const refreshPendingRegularizationsCount = async () => {
      const endpoint = currentRole === 'super_admin'
        ? '/api/teacher-control/statistics/global'
        : '/api/teacher-control/statistics';
      const requestKey = `${endpoint}:${currentRole === 'super_admin' ? 'global' : activeSchoolId}`;
      if (regularizationsCountRequestsInFlightRef.current.has(requestKey)) return;
      regularizationsCountRequestsInFlightRef.current.add(requestKey);
      try {
        const summary = await apiFetch(endpoint, { cache: 'no-store' }) as { pendingRegularizations?: number };
        const count = summary?.pendingRegularizations;
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
          throw new Error('Le nombre de régularisations en attente retourné par le serveur est invalide.');
        }
        if (active) setPendingRegularizationsCount(count);
      } catch (error) {
        console.warn('Impossible d’actualiser le nombre de régularisations en attente :', error);
      } finally {
        regularizationsCountRequestsInFlightRef.current.delete(requestKey);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshPendingRegularizationsCount();
    };
    void refreshPendingRegularizationsCount();
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener('focus', refreshPendingRegularizationsCount);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshPendingRegularizationsCount);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeSchoolId, currentRole]);

  useEffect(() => {
    if (!notificationsList || notificationsList.length === 0) return;

    const newNotifs = notificationsList.filter((notif) => !processedNotificationIdsRef.current.has(notif.id));
    if (newNotifs.length === 0) return;

    const hasAbsence = newNotifs.some((notif) => notif.type === 'absence');
    const hasGrade = newNotifs.some((notif) => notif.type === 'grade');
    if (!hasAbsence && !hasGrade) return;

    newNotifs.forEach((notif) => processedNotificationIdsRef.current.add(notif.id));
    if (hasAbsence || hasGrade) {
      fetchAllData(false);
    }
  }, [notificationsList]);

  useEffect(() => {
    if (activeTab === 'audit' && currentRole === 'super_admin') {
      fetchAuditEvents();
    }
  }, [activeTab, currentRole]);

  useEffect(() => {
    if (!['school_admin', 'school_accountant', 'super_admin', 'surveillant', 'teacher', 'parent'].includes(currentRole)) return;

    const refreshDashboardOnFocus = () => {
      if (currentRole === 'parent') {
        if (parentFocusCheckInFlightRef.current) return;
        parentFocusCheckInFlightRef.current = true;
        void apiFetch('/api/notifications')
          .then((notifications) => {
            if (Array.isArray(notifications)) setNotificationsList(notifications);
          })
          .catch((error) => {
            console.warn('Impossible de vérifier la session parent au retour du focus :', error);
          })
          .finally(() => {
            parentFocusCheckInFlightRef.current = false;
          });
        return;
      }

      void fetchAllData(false);
    };
    window.addEventListener('focus', refreshDashboardOnFocus);
    return () => window.removeEventListener('focus', refreshDashboardOnFocus);
  }, [activeSchoolId, authContextScope, currentRole, superAdminSchoolFilterId]);

  const handleRoleChange = (newRole: string) => {
    setImportResult(null);
    if (!newRole) {
      clearSimulatedRole();
      clearSimulatedUser();
      window.history.replaceState(null, '', '/login');
      return;
    }
    // Ensure there's a simulated user set when switching roles quickly.
    const existingSimUser = authenticatedUser;
    if (!existingSimUser) {
      if (newRole === 'teacher' || newRole === 'surveillant') {
        // pick a teacher in the current school if available, otherwise a generic teacher
        const preferred = currentSchoolId == null
          ? undefined
          : teachersList.find((t) => t.schoolId === currentSchoolId);
        if (preferred) {
          setSimulatedUser({ uid: `teacher_${preferred.userId || preferred.id}`, email: preferred.email || '', name: preferred.name || 'Enseignant', schoolId: preferred.schoolId });
        } else {
          setSimulatedUser({ uid: `sim_${newRole}_${Date.now()}`, email: `${newRole}@example.test`, name: newRole === 'surveillant' ? 'Surveillant Simulé' : 'Enseignant Simulé', schoolId: currentSchoolId });
        }
      } else if (newRole === 'school_admin') {
        setSimulatedUser({ uid: `sim_schooladmin_${Date.now()}`, email: 'sim_schooladmin@example.test', name: 'Admin Ecole', schoolId: currentSchoolId });
      } else if (newRole === 'school_accountant') {
        setSimulatedUser({ uid: `sim_schoolaccountant_${Date.now()}`, email: 'sim_schoolaccountant@example.test', name: 'Secrétaire comptable', schoolId: currentSchoolId });
      } else if (newRole === 'parent') {
        setSimulatedUser({ uid: `sim_parent_${Date.now()}`, email: 'sim_parent@example.test', name: 'Parent Simulé', schoolId: currentSchoolId });
      }
    }

    setSimulatedRole(newRole);
    window.history.replaceState(null, '', '/');
  };

  const handleLogout = async () => {
    setImportResult(null);
    clearSimulatedRole();
    clearSimulatedUser();
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout request failed', e);
    }
    window.location.replace('/login');
  };

  const suspendedSchoolRoles = [...new Set(availableMemberships
    .filter((membership) => membership.schoolId === Number(schoolToSwitchTo))
    .map((membership) => membership.role))];

  const handleSwitchFromSuspendedSchool = async () => {
    if (!schoolToSwitchTo || availableSchools.some((school) => (
      school.id === schoolToSwitchTo && school.isSuspended
    ))) return;

    setIsSwitchingSchool(true);
    setErrorMsg(null);
    try {
      const selectedRole = suspendedSchoolRoles.includes(roleToSwitchTo)
        ? roleToSwitchTo
        : suspendedSchoolRoles.length === 1 ? suspendedSchoolRoles[0] : '';
      if (!selectedRole) {
        throw new Error('Choisissez une fonction attribuée dans cette école.');
      }
      const result = await apiFetch('/api/auth/context/active', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'local',
          schoolId: Number(schoolToSwitchTo),
          role: selectedRole,
        }),
      });
      if (typeof result?.token !== 'string' || !result.token) {
        throw new Error('Le serveur n’a pas émis de jeton pour ce nouvel espace.');
      }
      const selectedSchoolId = Number(result?.schoolId ?? schoolToSwitchTo);
      localStorage.setItem('ecoletrack_jwt_access', result.token);
      setActiveSchoolId(selectedSchoolId);
      setSimulatedRole(result.role);
      if (authenticatedUser) {
        setSimulatedUser({ ...authenticatedUser, role: result.role, schoolId: selectedSchoolId });
      }
      suspendedSchoolNoticeRef.current = null;
      setSuspendedSchoolId(null);
      setAvailableSchools([]);
      setAvailableMemberships([]);
      await fetchAllData(false);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Impossible de sélectionner cette école.');
    } finally {
      setIsSwitchingSchool(false);
    }
  };

  // ==========================================
  // HANDLERS FOR CREATIONS (POSTS REST API)
  // ==========================================

  const handleAddSchool = async (data: { name: string; address: string; phone: string; phone2?: string | null; officialName?: string | null; abbreviation?: string | null; motto?: string | null; postalBox?: string | null; email?: string | null; city?: string | null; region?: string | null; educationDirection?: string | null; ministryName?: string | null; principalName?: string | null; principalGender?: 'M' | 'F' | null; timeZone?: string; promotionThreshold?: number; classNames?: string[]; subjectNames?: string[] }) => {
    try {
      const createdSchool = await apiFetch('/api/schools', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      await fetchAllData(false);
      return createdSchool;
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible d\'ajouter l\'école');
      throw err;
    }
  };

  const handleSetSchoolSuspended = async (schoolId: number, isSuspended: boolean) => {
    try {
      await apiFetch(`/api/schools/${schoolId}/suspension`, {
        method: 'PUT',
        body: JSON.stringify({ isSuspended }),
      });
      await fetchAllData(false);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Impossible de modifier l’état de l’école.');
      throw error;
    }
  };

  const handleAddYear = async (data: { name: string; isActive: boolean; schoolId?: number }) => {
    try {
      await apiFetch('/api/academic-years', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible d\'ajouter l\'année');
      throw err;
    }
  };

  const handleSetActiveYear = async (yearId: number) => {
    try {
      await apiFetch(`/api/academic-years/${yearId}/activate`, {
        method: 'PUT',
      });
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de définir cette année comme active');
      throw err;
    }
  };

  const handleDeleteYear = async (yearId: number) => {
    try {
      await apiFetch(`/api/academic-years/${yearId}`, {
        method: 'DELETE',
      });
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de supprimer cette année scolaire');
      throw err;
    }
  };

  const handleAddClass = async (data: { name: string; levelId?: number | null; schoolId?: number | null; academicYearId: number; teacherId?: number }) => {
    try {
      const payload = {
        ...data,
        schoolId: data.schoolId ?? null,
      };
      await apiFetch('/api/classes', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de créer la classe');
      throw err;
    }
  };

  const refreshClassesForSchool = async (schoolId: number): Promise<Class[]> => {
    const payload = await apiFetch(`/api/classes?schoolId=${schoolId}`);
    if (!Array.isArray(payload)) throw new Error('Impossible de recharger les classes de cette école.');
    const refreshedClasses = payload as Class[];
    if (currentRole !== 'super_admin') setClassesList(refreshedClasses);
    return refreshedClasses;
  };

  const handleDeleteClass = async (id: number) => {
    try {
      await apiFetch(`/api/classes/${id}`, { method: 'DELETE' });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Suppression impossible');
    }
  };

  const handleApproveClass = async (id: number) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error('Aucun établissement sélectionné pour approuver la classe');
      await apiFetch(`/api/schools/${schoolId}/classes/${id}/approve`, { method: 'POST' });
      setClassesList((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'approved' } : c)));
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible d\'approuver la classe.');
      throw err;
    }
  };

  const handleRejectClass = async (id: number) => {
    try {
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error('Aucun établissement sélectionné pour refuser la classe');
      await apiFetch(`/api/schools/${schoolId}/classes/${id}/reject`, { method: 'POST' });
      setClassesList((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'rejected' } : c)));
      await fetchAllData(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de refuser la classe.');
      throw err;
    }
  };

  const handleDeleteSchool = async (id: number, password: string) => {
    try {
      await apiFetch(`/api/schools/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      });
      await fetchAllData();
    } catch (err: any) {
      if (err.message && err.message.includes('École introuvable')) {
        setErrorMsg('L’école demandée n’existe plus. Rafraîchissez la page puis réessayez.');
        await fetchAllData();
      } else {
        setErrorMsg(err.message || 'Impossible de supprimer l’école.');
      }
      throw err;
    }
  };
  const handleUpdateSchool = async (id: number, data: { name: string; address: string; phone?: string; phone2?: string | null; officialName?: string | null; abbreviation?: string | null; motto?: string | null; postalBox?: string | null; email?: string | null; city?: string | null; region?: string | null; educationDirection?: string | null; ministryName?: string | null; principalName?: string | null; principalGender?: 'M' | 'F' | null; timeZone?: string; promotionThreshold?: number; classNames?: string[]; subjectNames?: string[] }) => {
    try {
      await apiFetch(`/api/schools/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de mettre à jour l\'école');
      throw err;
    }
  };

  const handleUploadSchoolLogo = async (id: number, file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    const result = await apiFetch(`/api/schools/${id}/logo`, {
      method: 'POST',
      body: formData,
    });
    await fetchAllData(false);
    return result;
  };

  const handleUpdateStudent = async (id: number, data: { firstName: string; lastName: string; birthDate: string | null; schoolId?: number; classId: number; parentId: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string; studentStatus?: string | null }) => {
    try {
      await apiFetch(`/api/students/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de mettre à jour l\'élève');
      throw err;
    }
  };

  const handleRemoveStudentFromClass = async (id: number) => {
    try {
      await apiFetch(`/api/students/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ classId: null }),
      });
      await fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de retirer l’élève de sa classe');
      throw err;
    }
  };

  const handleAddTeacher = async (data: { name?: string; lastName?: string; firstNames?: string; email: string; phone: string; specialization: string | string[]; subjectIds?: number[]; schoolId: number; classIds?: number[]; teachingAssignments?: Array<{ classId: number; subjectId: number }>; gender?: string }) => {
    try {
      const payload = {
        ...data,
        ...(data.lastName || data.firstNames
          ? {
              lastName: String(data.lastName ?? '').trim(),
              firstNames: String(data.firstNames ?? '').trim(),
              name: `${String(data.lastName ?? '').trim()} ${String(data.firstNames ?? '').trim()}`.trim() || data.name || '',
            }
          : {}),
      };
      const created = await apiFetch('/api/teachers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await fetchAllData(false);
      return created;
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleAddParent = async (data: { name: string; email?: string | null; phone: string; address: string; schoolId?: number; studentId?: number; gender?: string }) => {
    try {
      const requestScope = dataScopeRef.current;
      const parentsEndpoint = currentRole === 'super_admin' && superAdminSchoolFilterId != null
        ? `/api/parents?schoolId=${encodeURIComponent(superAdminSchoolFilterId)}`
        : '/api/parents';
      const created = await apiFetch('/api/parents', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateSuperAdminSchoolDataCache(requestScope);
      // Refresh only parent list to avoid closing/reinitializing the student form
      const parents = await apiFetch(parentsEndpoint);
      if (requestScope === dataScopeRef.current && Array.isArray(parents)) setParentsList(parents);
      return created;
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleAddStudent = async (data: { firstName: string; lastName: string; birthDate: string; schoolId: number; classId: number; parentId?: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string; studentStatus?: string | null }) => {
    try {
      await apiFetch('/api/students', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleBatchCreateStudents = async (records: any[]) => {
    try {
      const json = await apiFetch('/api/students/batch', {
        method: 'POST',
        body: JSON.stringify(records),
      });
      setImportResult({ ...json, entityType: 'students' });
      if (json.insertedCount && json.insertedCount > 0) fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Import CSV impossible');
    }
  };

  const handleBatchCreateParents = async (records: any[]) => {
    setImportResult(null);
    setErrorMsg(null);
    try {
      const json = await apiFetch('/api/parents/batch', {
        method: 'POST',
        body: JSON.stringify(records),
      });
      setImportResult({ ...json, entityType: 'parents' });
      if (json.insertedCount && json.insertedCount > 0) fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Import parents impossible');
      throw err;
    }
  };

  const handleCreateUser = async (data: { uid?: string; email: string; name?: string; lastName?: string; firstNames?: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string | string[]; subjectIds?: number[]; gender?: string; classIds?: number[]; teachingAssignments?: Array<{ classId: number; subjectId: number }> }) => {
    try {
      const payload = {
        ...data,
        ...(data.lastName || data.firstNames
          ? {
              lastName: String(data.lastName ?? '').trim(),
              firstNames: String(data.firstNames ?? '').trim(),
              name: `${String(data.lastName ?? '').trim()} ${String(data.firstNames ?? '').trim()}`.trim() || data.name || '',
            }
          : {}),
      };
      const created = await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      fetchAllData();
      return created;
    } catch (err: any) {
      const userFriendlyMessage = err.status === 403 || /Forbidden/.test(err.message)
        ? 'Erreur : vous n’êtes pas autorisé à créer ce compte pour cette école ou ce rôle.'
        : err.message || 'Failed to create user';
      setErrorMsg(userFriendlyMessage);
      throw new Error(userFriendlyMessage);
    }
  };

  const handleUpdateUser = async (id: number, data: { email: string; name?: string; lastName?: string; firstNames?: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string | string[]; subjectIds?: number[]; gender?: string; address?: string; studentId?: number; classIds?: number[]; teachingAssignments?: Array<{ classId: number; subjectId: number }> }) => {
    try {
      const payload = {
        ...data,
        ...(data.lastName || data.firstNames
          ? {
              lastName: String(data.lastName ?? '').trim(),
              firstNames: String(data.firstNames ?? '').trim(),
              name: `${String(data.lastName ?? '').trim()} ${String(data.firstNames ?? '').trim()}`.trim() || data.name || '',
            }
          : {}),
      };
      await apiFetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de mettre à jour le compte');
      throw err;
    }
  };

  const handleSetPassword = async (userId: number) => {
    try {
      const result = await apiFetch('/api/admin/set-password', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      void fetchAllData(false);
      return result;
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de réinitialiser le mot de passe');
      throw err;
    }
  };

  const handleDeleteUser = async (id: number) => {
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
      });
      await fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de supprimer le compte');
      throw err;
    }
  };

  const handleReactivateUser = async (id: number) => {
    try {
      await apiFetch(`/api/admin/users/${id}/reactivate`, {
        method: 'POST',
      });
      await fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Impossible de réactiver le compte');
      throw err;
    }
  };

  const handleAddAbsence = async (data: { studentId: number; classId: number; date: string; subjectId?: number; startTime: string; endTime: string; isJustified: boolean }) => {
    try {
      await apiFetch('/api/absences', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCreateAbsenceDeclaration = async (data: { studentId: number; date: string; startTime: string; endTime: string; reason?: string }) => {
    await apiFetch('/api/absence-declarations', { method: 'POST', body: JSON.stringify(data) });
    await fetchAllData(false);
  };

  const handleUpdateAbsenceDeclaration = async (id: number, data: { studentId: number; date: string; startTime: string; endTime: string; reason?: string }) => {
    await apiFetch(`/api/absence-declarations/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    await fetchAllData(false);
  };

  const handleCancelAbsenceDeclaration = async (id: number) => {
    await apiFetch(`/api/absence-declarations/${id}/cancel`, { method: 'PUT', body: JSON.stringify({}) });
    await fetchAllData(false);
  };

  const handleReviewAbsenceDeclaration = async (id: number, status: 'ACCEPTED' | 'REFUSED', rejectionReason?: string) => {
    await apiFetch(`/api/absence-declarations/${id}/review`, {
      method: 'PUT',
      body: JSON.stringify({ status, ...(status === 'REFUSED' ? { rejectionReason } : {}) }),
    });
    await fetchAllData(false);
  };

  const handleCloseAbsenceDeclaration = async (id: number) => {
    await apiFetch(`/api/absence-declarations/${id}/not-realized`, { method: 'PUT', body: JSON.stringify({}) });
    await fetchAllData(false);
  };

  const handleAddLateArrival = async (data: LateArrivalInput) => {
    await addLateArrival(data);
    await fetchAllData(false);
  };

  const handleSubmitLateArrivalJustification = async (id: number, reason: string, files: File[]) => {
    await submitLateArrivalJustification(id, reason, files);
    await fetchAllData(false);
  };

  const handleReviewLateArrivalJustification = async (
    id: number,
    status: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ) => {
    await reviewLateArrivalJustification(id, status, rejectionReason);
    await fetchAllData(false);
  };

  const handleReexamineLateArrivalJustification = async (id: number) => {
    await reexamineLateArrivalJustification(id);
    await fetchAllData(false);
  };

  const handleLoadLateArrivalJustification = async (id: number): Promise<LateArrivalJustificationDetail> => (
    fetchLateArrivalJustificationDetail(id)
  );

  const handleDownloadLateArrivalJustificationFile = async (id: number, fileId: number): Promise<Blob> => (
    downloadLateArrivalJustificationFile(id, fileId)
  );

  const handleReviewAbsence = async (id: number, status: 'APPROVED' | 'REJECTED', rejectionReason?: string) => {
    await apiFetch(`/api/absences/${id}/justification/review`, {
      method: 'PUT',
      body: JSON.stringify({ status, ...(status === 'REJECTED' ? { rejectionReason } : {}) }),
    });
    await fetchAllData(false);
  };

  const handleReexamineAbsenceJustification = async (id: number) => {
    await reexamineAbsenceJustification(id);
    await fetchAllData(false);
  };

  const handleJustifyAbsence = async (id: number, reason: string, files?: File[] | File | null) => {
    try {
      await justifyAbsence(id, reason, files ?? undefined);
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAddEvaluation = async (data: { classId: number; subject: string; subjectId?: number; type: string; coefficient: number; maxScore: number; date: string }) => {
    try {
      console.debug('Creating evaluation', data);
      await apiFetch('/api/evaluations', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      console.debug('Evaluation created, refreshing data');
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const refreshApprovedSubjects = async () => {
    const requestScope = dataScopeRef.current;
    try {
      const endpoint = currentRole === 'super_admin' && superAdminSchoolFilterId != null
        ? `/api/subjects?approvedOnly=true&schoolId=${encodeURIComponent(superAdminSchoolFilterId)}`
        : '/api/subjects?approvedOnly=true';
      const approved = await apiFetch(endpoint);
      if (requestScope === dataScopeRef.current && Array.isArray(approved)) {
        setApprovedSubjectsList(approved);
      }
    } catch (err: any) {
      if (currentRole === 'super_admin') invalidateSuperAdminSchoolDataCache(requestScope);
      console.warn('Unable to refresh approved subject list:', err);
    }
  };

  const handleAddGrade = async (data: { evaluationId: number; studentId: number; score: string; remarks: string }) => {
    try {
      const requestScope = dataScopeRef.current;
      await apiFetch('/api/grades', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateSuperAdminSchoolDataCache(requestScope);
      if (requestScope === dataScopeRef.current) await refreshGrades();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleAddSubject = async (data: { name: string; code?: string; schoolId?: number; subjectTypeId?: number | null }) => {
    try {
      const requestScope = dataScopeRef.current;
      const createdSubject = await apiFetch('/api/subjects', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateSuperAdminSchoolDataCache(requestScope);
      if (requestScope !== dataScopeRef.current) return;
      setSubjectsList((prev) => [...prev, createdSubject]);
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleUpdateSubject = async (id: number, data: { name?: string; code?: string; subjectTypeId?: number | null }) => {
    try {
      const requestScope = dataScopeRef.current;
      const updatedSubject = await apiFetch(`/api/subjects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      invalidateSuperAdminSchoolDataCache(requestScope);
      if (requestScope !== dataScopeRef.current) return;
      setSubjectsList((prev) =>
        prev.map((s) => (s.id === id ? updatedSubject : s))
      );
      await refreshApprovedSubjects();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleAddSubjectType = async (data: { name: string; description?: string | null; sortOrder?: number }) => {
    const created = await apiFetch('/api/subject-types', { method: 'POST', body: JSON.stringify(data) });
    setSubjectTypesList((prev) => [...prev, created]);
    return created;
  };

  const handleUpdateSubjectType = async (id: number, data: { name?: string; description?: string | null; sortOrder?: number }) => {
    const updated = await apiFetch(`/api/subject-types/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    setSubjectTypesList((prev) => prev.map((item) => item.id === id ? updated : item));
    return updated;
  };

  const handleDeleteSubjectType = async (id: number) => {
    await apiFetch(`/api/subject-types/${id}`, { method: 'DELETE' });
    setSubjectTypesList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleDeleteSubject = async (id: number) => {
    try {
      const requestScope = dataScopeRef.current;
      await apiFetch(`/api/subjects/${id}`, {
        method: 'DELETE',
      });
      invalidateSuperAdminSchoolDataCache(requestScope);
      if (requestScope !== dataScopeRef.current) return;
      setSubjectsList((prev) => prev.filter((s) => s.id !== id));
      await refreshApprovedSubjects();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleApproveSubject = async (id: number) => {
    try {
      const requestScope = dataScopeRef.current;
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error('Aucun établissement sélectionné');
      await apiFetch(`/api/schools/${schoolId}/subjects/${id}/approve`, { method: 'POST' });
      invalidateSuperAdminSchoolDataCache(requestScope);
      if (requestScope !== dataScopeRef.current) return;
      setSubjectsList((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'approved' } : s)));
      await refreshApprovedSubjects();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleRejectSubject = async (id: number) => {
    try {
      const requestScope = dataScopeRef.current;
      const schoolId = currentSchoolId;
      if (!schoolId) throw new Error('Aucun établissement sélectionné');
      await apiFetch(`/api/schools/${schoolId}/subjects/${id}/reject`, { method: 'POST' });
      invalidateSuperAdminSchoolDataCache(requestScope);
      if (requestScope !== dataScopeRef.current) return;
      setSubjectsList((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'rejected' } : s)));
      await refreshApprovedSubjects();
    } catch (err: any) {
      setErrorMsg(err.message);
      throw err;
    }
  };

  const handleSendNotification = async (data: { title: string; body: string; type: string; userId?: number; classId?: number; schoolId?: number; files?: File[] }) => {
    try {
      if (data.files && data.files.length > 0) {
        const formData = new FormData();
        formData.append('title', data.title);
        formData.append('body', data.body);
        formData.append('type', data.type);
        if (data.userId != null) formData.append('userId', String(data.userId));
        if (data.classId != null) formData.append('classId', String(data.classId));
        if (data.schoolId != null) formData.append('schoolId', String(data.schoolId));
        data.files.forEach((file) => formData.append('files', file));

        await apiFetch('/api/notifications/send', {
          method: 'POST',
          body: formData,
        });
      } else {
        await apiFetch('/api/notifications/send', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'PUT' });
      fetchAllData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleNotificationRead = async () => {
    // refresh notifications list after a single notification is marked read
    try {
      await fetchAllData(false);
    } catch (e) {
      console.warn('Failed to refresh data after marking notification read', e);
    }
  };

  // If not authenticated, render SPA login view
  if (suspendedSchoolId != null) {
    const eligibleSchools = availableSchools.filter((school) => !school.isSuspended);
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl">
          <SchoolSuspensionNotice />
          {eligibleSchools.length > 0 && (
            <div className="mb-5">
              <label className="mb-2 block text-sm" htmlFor="suspended-school-switch">École autorisée</label>
              <select
                id="suspended-school-switch"
                className="w-full rounded border border-slate-700 bg-slate-800 p-2"
                value={schoolToSwitchTo}
                onChange={(event) => {
                  const selectedSchool = Number(event.target.value);
                  const roles = [...new Set(availableMemberships
                    .filter((membership) => membership.schoolId === selectedSchool)
                    .map((membership) => membership.role))];
                  setSchoolToSwitchTo(selectedSchool);
                  setRoleToSwitchTo(roles.length === 1 ? roles[0] : '');
                }}
              >
                {eligibleSchools.map((school) => (
                  <option key={school.id} value={school.id}>{school.name}</option>
                ))}
              </select>
              {suspendedSchoolRoles.length > 1 && (
                <label className="mt-3 block text-sm" htmlFor="suspended-school-role-switch">
                  Fonction
                  <select
                    id="suspended-school-role-switch"
                    className="mt-2 w-full rounded border border-slate-700 bg-slate-800 p-2"
                    value={roleToSwitchTo}
                    onChange={(event) => setRoleToSwitchTo(event.target.value)}
                  >
                    <option value="">-- Choisissez une fonction --</option>
                    {suspendedSchoolRoles.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="mt-3 w-full rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
                onClick={handleSwitchFromSuspendedSchool}
                disabled={isSwitchingSchool
                  || !schoolToSwitchTo
                  || suspendedSchoolRoles.length === 0
                  || (suspendedSchoolRoles.length > 1 && !suspendedSchoolRoles.includes(roleToSwitchTo))}
              >
                {isSwitchingSchool ? 'Ouverture...' : 'Accéder à cette école'}
              </button>
            </div>
          )}
          {eligibleSchools.length === 0 && (
            <p className="mb-5 text-sm text-slate-400">Aucune autre école autorisée n’est disponible.</p>
          )}
          {errorMsg && <p className="mb-4 text-sm text-rose-300">{errorMsg}</p>}
          <button
            type="button"
            className="w-full rounded bg-slate-700 px-4 py-2 font-medium hover:bg-slate-600"
            onClick={handleLogout}
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }
  if (!authenticatedUser || (!token && currentRole !== 'super_admin') || (currentRole !== 'super_admin' && !activeSchoolId)) {
    return <LoginView onLogin={(role) => { setSimulatedRole(role); }} />;
  }

  // Centralized filtering of evaluations: separate active from archived
  const activeEvaluations = evaluationsList.filter((ev) => {
    if (currentRole === 'super_admin') return true;
    if (currentRole === 'school_admin' || currentRole === 'school_accountant') {
      return !isEvaluationLockedBySchoolAdmin(ev, studentsList, gradesList)
        && !isEvaluationArchivedForSchoolAdminByAge(ev, studentsList, gradesList);
    }
    return !isEvaluationArchived(ev, studentsList, gradesList);
  });
  const visibleAbsenceDeclarations = currentRole === 'super_admin' && superAdminSchoolFilterId != null
    ? absenceDeclarationsList.filter((declaration) => declaration.schoolId === superAdminSchoolFilterId)
    : absenceDeclarationsList;
  const archivedEvaluations = evaluationsList.filter((ev) => {
    if (currentRole === 'super_admin') return false;
    if (currentRole === 'school_admin' || currentRole === 'school_accountant') {
      return isEvaluationLockedBySchoolAdmin(ev, studentsList, gradesList)
        || isEvaluationArchivedForSchoolAdminByAge(ev, studentsList, gradesList);
    }
    return isEvaluationArchived(ev, studentsList, gradesList);
  });
  const isTeacherControlDestination = (activeTab === 'teacher-control'
    || activeTab === 'teacher-control-regularizations')
    && ['teacher', 'school_admin', 'school_accountant', 'super_admin'].includes(currentRole);
  const canAccessAccounting = ['super_admin', 'school_admin', 'school_accountant'].includes(currentRole);
  const isSuperAdminSchoolScopeTransition = currentRole === 'super_admin'
    && loadedDataScope !== ''
    && loadedDataScope !== dataScopeRef.current;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800" id="main-application">
      {/* Simulation console bar at the header */}
      <SimulatorHeader
        currentRole={currentRole}
        schoolsList={schoolsList}
        parentsList={parentsList}
        classesList={classesList}
        teachersList={teachersList}
        studentsList={studentsList}
        usersList={usersList}
        yearsList={yearsList}
        approvedSubjectsList={approvedSubjectsList}
        onRoleChange={handleRoleChange}
        onLogout={handleLogout}
        onRefreshData={fetchAllData}
        isSyncing={isSyncing}
        onManageAccounts={() => setActiveTab('administration')}
      />
      <ParentWhatsAppButton currentRole={currentRole} studentsList={studentsList} />

      {visibleErrorMsg && (
        <GlobalErrorToast message={visibleErrorMsg} onClose={() => setErrorMsg(null)} />
      )}

      {/* Main workspace with sidebar option layout */}
      <div className="flex-1 w-[94%] max-w-[1920px] mx-auto p-4 sm:p-6 lg:p-8 flex flex-col lg:flex-row gap-6">
        
        {/* SIDEBAR NAVIGATION */}
        <aside className="w-full lg:w-64 shrink-0 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm" id="main-sidebar">
          <div className="space-y-4">
            <div className="px-3 py-2 border-b border-slate-100 pb-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Navigation</span>
              <p className="text-xs text-slate-400">Cliquez pour basculer d'un module à l'autre</p>
            </div>

            <nav className="space-y-1 border-b border-slate-100 pb-3" aria-label="Accueil">
              <button
                onClick={() => setActiveTab('tableau-de-bord')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'tableau-de-bord'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-dashboard"
              >
                <SidebarNavigationIcon><LayoutDashboard className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                <span className="text-left">Tableau de Bord</span>
              </button>
            </nav>

            <nav className="space-y-1" aria-label="Navigation principale">
              {/* Administration */}
              {(currentRole === 'super_admin' || currentRole === 'school_admin' || currentRole === 'school_accountant') && <button
                onClick={() => setActiveTab('administration')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'administration'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-admin"
              >
                <SidebarNavigationIcon><Building2 className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                <span className="text-left">Administration</span>
              </button>}

              {/* Teacher control */}
              {['teacher', 'school_admin', 'school_accountant', 'super_admin'].includes(currentRole) && (
                <SidebarNavigationGroup
                  id="teacher-control"
                  expanded={teacherControlGroupExpanded}
                  activeChild={activeTeacherControlSubmenu}
                  hasSubmenu
                  onToggle={() => toggleNavigationGroup('teacherControl')}
                  parent={(
                    <button
                      onClick={openTeacherControl}
                      onPointerEnter={() => setShouldPrepareTeacherControl(true)}
                      onFocus={() => setShouldPrepareTeacherControl(true)}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                        activeTab === 'teacher-control'
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                      id="sidebar-nav-teacher-control"
                      data-testid="sidebar-nav-teacher-control"
                    >
                      <SidebarNavigationIcon testId="sidebar-nav-teacher-control-icon">
                        <ClipboardCheck className="h-5 w-5 shrink-0" />
                      </SidebarNavigationIcon>
                      <span className="text-left">{currentRole === 'teacher' ? 'Déclaration de présence' : 'Contrôle des enseignants'}</span>
                    </button>
                  )}
                >
                  <button
                    onClick={() => openTeacherControlDestination('teacher-control-regularizations')}
                    className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all cursor-pointer ${
                      activeTeacherControlSubmenu
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'text-slate-600 hover:bg-white hover:text-indigo-700'
                    }`}
                    id="sidebar-nav-regularizations"
                    data-testid="sidebar-nav-regularizations"
                    data-nav-child="true"
                  >
                    <SidebarNavigationIcon><ClipboardList className="h-4 w-4" /></SidebarNavigationIcon>
                    <span className="min-w-0 flex-1 text-left">{currentRole === 'teacher' ? 'Régularisations en attente' : 'Régularisations à traiter'}</span>
                    {pendingRegularizationsCount > 0 && (
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        activeTeacherControlSubmenu ? 'bg-indigo-700 text-white' : 'bg-rose-600 text-white'
                      }`}>
                        {pendingRegularizationsCount > 99 ? '99+' : pendingRegularizationsCount}
                      </span>
                    )}
                  </button>
                </SidebarNavigationGroup>
              )}

              {!['teacher', 'parent', 'surveillant'].includes(currentRole) && <button
                disabled={!canAccessAccounting}
                onClick={() => {
                  if (canAccessAccounting) setActiveTab('accounting');
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                  canAccessAccounting
                    ? activeTab === 'accounting'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10 cursor-pointer'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 cursor-pointer'
                    : 'cursor-not-allowed opacity-60 text-slate-400'
                }`}
                id="sidebar-nav-accounting"
                aria-disabled={!canAccessAccounting}
              >
                <SidebarNavigationIcon><Wallet className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                <span className="text-left">Comptabilité</span>
              </button>}

              {currentRole === 'teacher' && homeroomClassesList.length > 0 && (
                <button
                  onClick={() => setActiveTab('homeroom')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${activeTab === 'homeroom' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                  id="sidebar-nav-homeroom"
                >
                  <SidebarNavigationIcon><Building2 className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                  <span className="text-left">Mes classes titulaires</span>
                </button>
              )}

              {/* Tab 3: Absences */}
              <SidebarNavigationGroup
                id="absences"
                expanded={absenceGroupExpanded}
                activeChild={activeAbsenceSubmenu}
                hasSubmenu={['school_admin', 'school_accountant', 'super_admin', 'surveillant', 'teacher'].includes(currentRole)}
                onToggle={() => toggleNavigationGroup('absences')}
                parent={(
                  <button
                    onClick={() => setActiveTab('absences')}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'absences'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                    id="sidebar-nav-absences"
                    data-testid="sidebar-nav-absences"
                  >
                    <div className="flex items-center gap-3">
                      <SidebarNavigationIcon><CalendarDays className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                      <span className="text-left">Absences</span>
                    </div>
                    {unjustifiedAbsencesCount > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        activeTab === 'absences' ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'
                      }`}>
                        {unjustifiedAbsencesCount > 99 ? '99+' : unjustifiedAbsencesCount}
                      </span>
                    )}
                  </button>
                )}
              >
                {['school_admin', 'school_accountant', 'super_admin', 'surveillant', 'teacher'].includes(currentRole) && (
                  <button
                    onClick={() => setActiveTab('absence-declaration-validations')}
                    className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all cursor-pointer ${
                      activeTab === 'absence-declaration-validations'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'text-slate-600 hover:bg-white hover:text-indigo-700'
                    }`}
                    id="sidebar-nav-absence-declaration-validations"
                    data-testid="sidebar-nav-absence-declaration-validations"
                    data-nav-child="true"
                  >
                    <SidebarNavigationIcon><ClipboardList className="h-4 w-4" /></SidebarNavigationIcon>
                    <span className="min-w-0 flex-1 text-left">Déclarations d’absence à traiter</span>
                    {pendingAbsenceDeclarationsCount > 0 && (
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        activeTab === 'absence-declaration-validations' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white'
                      }`}>
                        {pendingAbsenceDeclarationsCount > 99 ? '99+' : pendingAbsenceDeclarationsCount}
                      </span>
                    )}
                  </button>
                )}

                {['school_admin', 'school_accountant', 'super_admin', 'surveillant', 'teacher'].includes(currentRole) && (
                  <button
                    onClick={() => setActiveTab('absence-validations')}
                    className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all cursor-pointer ${
                      activeTab === 'absence-validations'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'text-slate-600 hover:bg-white hover:text-indigo-700'
                    }`}
                    id="sidebar-nav-absence-validations"
                    data-testid="sidebar-nav-absence-validations"
                    data-nav-child="true"
                  >
                    <SidebarNavigationIcon><ClipboardCheck className="h-4 w-4" /></SidebarNavigationIcon>
                    <span className="min-w-0 flex-1 text-left">Justifications à traiter</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      activeTab === 'absence-validations' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white'
                    }`}>
                      {pendingAttendanceJustificationsCount > 99 ? '99+' : pendingAttendanceJustificationsCount}
                    </span>
                  </button>
                )}

                {(currentRole === 'school_admin' || currentRole === 'school_accountant' || currentRole === 'surveillant') && (
                  <button
                    onClick={() => setActiveTab('absence-controls')}
                    className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all cursor-pointer ${
                      activeTab === 'absence-controls'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'text-slate-600 hover:bg-white hover:text-indigo-700'
                    }`}
                    id="sidebar-nav-absence-controls"
                    data-testid="sidebar-nav-absence-controls"
                    data-nav-child="true"
                  >
                    <SidebarNavigationIcon><CalendarDays className="h-4 w-4" /></SidebarNavigationIcon>
                    <span className="min-w-0 flex-1 text-left">Contrôles Néant</span>
                  </button>
                )}
              </SidebarNavigationGroup>

              {currentRole === 'parent' && (
                <button
                  onClick={() => setActiveTab('notes')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    activeTab === 'notes'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  id="sidebar-nav-parent-grades"
                >
                  <SidebarNavigationIcon><Award className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                  <span className="text-left">Notes</span>
                </button>
              )}

              {/* Tab 4: Notes et bulletins (hidden for parents) */}
              {currentRole !== 'parent' && currentRole !== 'surveillant' && (
                <>
                  <button
                    onClick={() => setActiveTab('notes')}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'notes'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                    id="sidebar-nav-grades"
                  >
                    <div className="flex items-center gap-3">
                      <SidebarNavigationIcon><Award className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                      <span className="text-left">Notes & Bulletins</span>
                    </div>
                    {noteOverdueCount > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        activeTab === 'notes' ? 'bg-white text-indigo-700' : 'bg-rose-500 text-white'
                      }`}>
                        {noteOverdueCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setActiveTab('archive')}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'archive'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                    id="sidebar-nav-archive"
                  >
                    <SidebarNavigationIcon><BookOpen className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                    <span className="text-left">Archive</span>
                  </button>
                </>
              )}

              {currentRole !== 'surveillant' && !['teacher', 'parent'].includes(currentRole) && <button
                type="button"
                disabled={!['super_admin', 'school_admin', 'school_accountant'].includes(currentRole)}
                onClick={() => {
                  if (['super_admin', 'school_admin', 'school_accountant'].includes(currentRole)) {
                    setActiveTab('bulletins');
                  }
                }}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                  !['super_admin', 'school_admin', 'school_accountant'].includes(currentRole)
                    ? 'cursor-not-allowed opacity-60 text-slate-400'
                    : 'cursor-pointer text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                } ${
                  activeTab === 'bulletins' && ['super_admin', 'school_admin', 'school_accountant'].includes(currentRole)
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : ''
                }`}
                id="sidebar-nav-bulletins"
                aria-disabled={!['super_admin', 'school_admin', 'school_accountant'].includes(currentRole)}
              >
                <div className="flex items-center gap-3">
                  <SidebarNavigationIcon><FileText className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                  <span className="text-left">Bulletins</span>
                </div>
                {noteOverdueCount > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'bulletins' && ['super_admin', 'school_admin', 'school_accountant'].includes(currentRole) ? 'bg-white text-indigo-700' : 'bg-rose-500 text-white'
                  }`}>
                    {noteOverdueCount}
                  </span>
                )}
              </button>}

              {['super_admin', 'school_admin', 'school_accountant'].includes(currentRole) && (
                <button
                  onClick={() => setActiveTab('class-results')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    activeTab === 'class-results'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  id="sidebar-nav-class-results"
                >
                  <SidebarNavigationIcon><Award className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                  <span className="text-left">Résultats / Proclamation</span>
                </button>
              )}

              {['super_admin', 'school_admin', 'school_accountant'].includes(currentRole) && (
                <button
                  onClick={() => setActiveTab('class-subject-pivot')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    activeTab === 'class-subject-pivot'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  id="sidebar-nav-class-subject-pivot"
                >
                  <SidebarNavigationIcon><Table2 className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                  <span className="text-left">Résultats par matière</span>
                </button>
              )}

              {currentRole === 'super_admin' && (
                <button
                  onClick={() => setActiveTab('audit')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    activeTab === 'audit'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  id="sidebar-nav-audit"
                >
                  <SidebarNavigationIcon><Info className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                  <span className="text-left">Journal des actions</span>
                </button>
              )}

              {/* Tab 5: Real-time FCM Notifications */}
              {currentRole !== 'surveillant' && <button
                onClick={() => setActiveTab('notifications')}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'notifications'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-notifications"
              >
                <div className="flex items-center gap-3">
                  <SidebarNavigationIcon><Bell className="h-4.5 w-4.5" /></SidebarNavigationIcon>
                  <span className="text-left">Messagerie & Push</span>
                </div>
                {notificationsList.filter((n) => !n.isRead).length > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'notifications' ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'
                  }`}>
                    {notificationsList.filter((n) => !n.isRead).length}
                  </span>
                )}
              </button>}

            </nav>
          </div>

        </aside>

        {/* WORKSPACE CENTRAL BOARD */}
        <main className="flex-1 min-w-0" id="main-viewport">
          
          {/* Error warning notification banners */}
          {visibleErrorMsg && (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl mb-6 flex items-start gap-3 animate-fade-in text-xs sm:text-sm">
              <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="space-y-1 leading-relaxed">
                <p className="font-bold text-rose-800">Alerte Système</p>
                <p className="text-rose-700">{visibleErrorMsg}</p>
              </div>
              <button onClick={() => setErrorMsg(null)} className="ml-auto text-rose-400 font-bold hover:text-rose-600 cursor-pointer">✕</button>
            </div>
          )}

          {shouldPrepareTeacherControl && ['teacher', 'school_admin', 'school_accountant', 'super_admin'].includes(currentRole) && (
            <div
              className={!isSyncing && isTeacherControlDestination
                ? 'bg-white p-6 border border-slate-100 rounded-2xl shadow-sm transition-all animate-fade-in'
                : 'hidden'}
              id={isTeacherControlDestination ? 'content-card' : undefined}
            >
              <ErrorBoundary>
                <TeacherControlView
                  userRole={currentRole}
                  activeSchoolId={currentSchoolId}
                  schoolsList={schoolsList}
                  teachersList={teachersList}
                  superAdminSchoolFilterId={superAdminSchoolFilterId}
                  onSuperAdminSchoolFilterChange={handleSuperAdminSchoolFilterChange}
                  viewMode={activeTab === 'teacher-control-regularizations' ? 'regularizations' : 'full'}
                  initialTab={activeTab === 'teacher-control-regularizations' ? 'requests' : teacherControlRequestedTab}
                  onTabChange={handleTeacherControlTabChange}
                  onPendingRegularizationsCountChange={setPendingRegularizationsCount}
                  onInitialViewSettled={handleTeacherControlInitialViewSettled}
                  currentTeacherId={currentTeacherProfile?.id}
                  currentTeacherName={currentTeacherProfile?.name ?? authenticatedUser?.name ?? ''}
                />
              </ErrorBoundary>
            </div>
          )}

          {/* LOADING SCREEN */}
          {(isSyncing || (loadedDataScope !== dataScopeRef.current && !isSuperAdminSchoolScopeTransition)) && (
            <div className="bg-white/60 p-12 text-center rounded-2xl border border-slate-50 shadow-sm flex flex-col justify-center items-center gap-3 my-12">
              {isSyncing
                ? <RefreshCw className="h-10 w-10 text-indigo-600 animate-spin" />
                : <AlertCircle className="h-10 w-10 text-amber-500" />}
              <p className="text-xs text-slate-500 font-medium">
                {isSyncing ? 'Synchronisation des registres en temps réel...' : 'Les données de ce périmètre ne sont pas disponibles.'}
              </p>
            </div>
          )}

          {/* DYNAMIC RENDERING PANEL BASED ON ACTIVE TABS */}
          {!isSyncing && (loadedDataScope === dataScopeRef.current || isSuperAdminSchoolScopeTransition) && !isTeacherControlDestination && (
            <div className="bg-white p-6 border border-slate-100 rounded-2xl shadow-sm transition-all animate-fade-in" id="content-card">
              {currentRole === 'super_admin' && (
                <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                  <label htmlFor="global-school-filter" className="text-sm font-semibold text-slate-700">
                    Établissement consulté
                  </label>
                  <select
                    id="global-school-filter"
                    value={superAdminSchoolFilterId ?? ''}
                    onChange={(event) => handleSuperAdminSchoolFilterChange(event.target.value ? Number(event.target.value) : null)}
                    className="min-w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Toutes les écoles</option>
                    {schoolsList.map((school) => (
                      <option key={school.id} value={school.id}>{school.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {isSuperAdminSchoolScopeTransition && activeTab !== 'audit' && !errorMsg && (
                <p className="mb-4 text-xs text-slate-500" role="status">
                  Actualisation des données de l’établissement…
                </p>
              )}
              <div className={isSuperAdminSchoolScopeTransition && activeTab !== 'audit' ? 'hidden' : 'contents'}>
              {activeTab === 'tableau-de-bord' && (
                <DashboardView
                  stats={stats}
                  loginStats={loginStats}
                  recentAbsences={summaryRecentAbsences}
                  recentGrades={summaryRecentGrades}
                  userRole={currentRole}
                  chartData={chartData}
                  ageStatsByClass={ageStatsByClass}
                  ageStatsAsOf={ageStatsAsOf}
                  absenceStatusCounts={stats.absenceStatusCounts}
                  absenceDeclarationStats={absenceDeclarationStats}
                  absenceJustificationStats={absenceJustificationStats}
                />
              )}

              {activeTab === 'homeroom' && currentRole === 'teacher' && homeroomClassesList.length > 0 && (
                <HomeroomView classes={homeroomClassesList} />
              )}

              {activeTab === 'administration' && (
                <ErrorBoundary>
                          <AdminView
                  userRole={currentRole}
                  schoolsList={schoolsList}
                  yearsList={yearsList}
                  classesList={classesList}
                  teachersList={teachersList}
                  studentsList={studentsList}
                  parentsList={parentsList}
                  usersList={usersList}
                  disabledUsersList={disabledUsersList}
                  auditEvents={auditEvents}
                  subjectsList={subjectsList}
                  subjectTypesList={subjectTypesList}
                  educationLevels={educationLevels}
                  approvedSubjectsList={approvedSubjectsList}
                  onAddSchool={handleAddSchool}
                  onUpdateSchool={handleUpdateSchool}
                  onUploadSchoolLogo={handleUploadSchoolLogo}
                  onUpdateStudent={handleUpdateStudent}
                  onRemoveStudentFromClass={handleRemoveStudentFromClass}
                  onAddYear={handleAddYear}
                  onSetActiveYear={handleSetActiveYear}
                  onDeleteYear={handleDeleteYear}
                  onAddClass={handleAddClass}
                  onAddTeacher={handleAddTeacher}
                  onAddParent={handleAddParent}
                  onAddStudent={handleAddStudent}
                  onBatchCreateStudents={handleBatchCreateStudents}
                  onBatchCreateParents={handleBatchCreateParents}
                  importResult={importResult}
                  onClearImportResult={() => setImportResult(null)}
                  onCreateUser={handleCreateUser}
                  onUpdateUser={handleUpdateUser}
                  onSetPassword={handleSetPassword}
                  onDeleteUser={handleDeleteUser}
                  onReactivateUser={handleReactivateUser}
                  onDeleteClass={handleDeleteClass}
                  onDeleteSchool={handleDeleteSchool}
                  onSetSchoolSuspended={handleSetSchoolSuspended}
                  onAddSubject={handleAddSubject}
                  onUpdateSubject={handleUpdateSubject}
                  onDeleteSubject={handleDeleteSubject}
                  onApproveSubject={handleApproveSubject}
                  onRejectSubject={handleRejectSubject}
                  onAddSubjectType={handleAddSubjectType}
                  onUpdateSubjectType={handleUpdateSubjectType}
                  onDeleteSubjectType={handleDeleteSubjectType}
                  onApproveClass={handleApproveClass}
                  onRejectClass={handleRejectClass}
                  currentSchoolId={currentSchoolId}
                  schoolFilterId={currentRole === 'super_admin' ? superAdminSchoolFilterId : null}
                  onSchoolFilterChange={handleSuperAdminSchoolFilterChange}
                  onRefreshClasses={refreshClassesForSchool}
                  />
                </ErrorBoundary>
              )}

              {(activeTab === 'absences' || activeTab === 'absence-validations') && (
                <AbsenceView
                  userRole={currentRole}
                  schoolFilterId={currentRole === 'super_admin' ? superAdminSchoolFilterId : undefined}
                  pendingReviewOnly={activeTab === 'absence-validations'}
                  showAbsenceDeclarationSection={activeTab === 'absences'}
                  absencesList={absencesList}
                  absenceDeclarationsList={visibleAbsenceDeclarations}
                  lateArrivalsList={lateArrivalsList}
                  lateArrivalJustificationsList={lateArrivalJustificationsList}
                  studentsList={studentsList}
                  classesList={classesList}
                  schoolsList={schoolsList}
                  teachersList={teachersList}
                  teacherSubjectIds={currentRole === 'teacher' ? currentTeacherSubjectIds : []}
                  teacherTeachingAssignments={currentRole === 'teacher' ? currentTeacherTeachingAssignments : []}
                  teacherHomeroomClassIds={currentRole === 'teacher' ? currentTeacherHomeroomClassIds : []}
                  approvedSubjectsList={approvedSubjectsList}
                  onAddAbsence={handleAddAbsence}
                  onAddLateArrival={handleAddLateArrival}
                  onReviewAbsence={handleReviewAbsence}
                  onSubmitLateArrivalJustification={handleSubmitLateArrivalJustification}
                  onReviewLateArrivalJustification={handleReviewLateArrivalJustification}
                  onReexamineLateArrivalJustification={handleReexamineLateArrivalJustification}
                  onLoadLateArrivalJustification={handleLoadLateArrivalJustification}
                  onDownloadLateArrivalJustificationFile={handleDownloadLateArrivalJustificationFile}
                  onReexamineAbsenceJustification={handleReexamineAbsenceJustification}
                  onCreateAbsenceDeclaration={handleCreateAbsenceDeclaration}
                  onUpdateAbsenceDeclaration={handleUpdateAbsenceDeclaration}
                  onCancelAbsenceDeclaration={handleCancelAbsenceDeclaration}
                  onReviewAbsenceDeclaration={handleReviewAbsenceDeclaration}
                  onCloseAbsenceDeclaration={handleCloseAbsenceDeclaration}
                  onJustifyAbsence={handleJustifyAbsence}
                  onRecordAbsenceControl={recordAbsenceControl}
                />
              )}

              {activeTab === 'absence-declaration-validations'
                && ['school_admin', 'school_accountant', 'super_admin', 'surveillant', 'teacher'].includes(currentRole) && (
                <AbsenceDeclarationValidationsView
                  declarations={visibleAbsenceDeclarations}
                  onReview={handleReviewAbsenceDeclaration}
                />
              )}

              {activeTab === 'absence-controls' && (currentRole === 'school_admin' || currentRole === 'school_accountant' || currentRole === 'surveillant') && (
                <AbsenceControlsView
                  absenceControlsList={absenceControlsList}
                  classesList={classesList}
                  teachersList={teachersList}
                  approvedSubjectsList={approvedSubjectsList}
                />
              )}

              {activeTab === 'notes' && currentRole !== 'surveillant' && (
                currentRole === 'parent' ? (
                  <ParentNotesView
                    currentRole={currentRole}
                    studentsList={studentsList}
                    parentsList={parentsList}
                    gradesList={gradesList}
                    evaluationsList={activeEvaluations}
                  />
                ) : (
                  <NotesView
                    evaluationsList={activeEvaluations}
                    gradesList={gradesList}
                    studentsList={studentsList}
                    classesList={classesList}
                    schoolsList={schoolsList}
                    schoolFilterId={currentRole === 'super_admin' ? superAdminSchoolFilterId : null}
                    dataReady={loadedDataScope === dataScopeRef.current}
                    onSchoolFilterChange={handleSuperAdminSchoolFilterChange}
                    teacherHomeroomClassIds={currentRole === 'teacher' ? currentTeacherHomeroomClassIds : []}
                    teacherTeachingAssignments={currentRole === 'teacher' ? currentTeacherTeachingAssignments : []}
                    approvedSubjectsList={approvedSubjectsList}
                    teacherId={currentRole === 'teacher' ? currentTeacherProfile?.id : undefined}
                    onAddEvaluation={handleAddEvaluation}
                    onAddGrade={handleAddGrade}
                    onGroupedEvaluationPublication={() => { void fetchAllData(false); }}
                  />
                )
              )}

              {activeTab === 'archive' && currentRole !== 'parent' && currentRole !== 'surveillant' && (
                <ArchiveView
                  userRole={currentRole}
                  evaluationsList={archivedEvaluations}
                  gradesList={gradesList}
                  studentsList={studentsList}
                  classesList={classesList}
                  schoolsList={schoolsList}
                  schoolFilterId={superAdminSchoolFilterId}
                  onSchoolFilterChange={handleSuperAdminSchoolFilterChange}
                  teacherHomeroomClassIds={currentRole === 'teacher' ? currentTeacherHomeroomClassIds : []}
                  teacherTeachingAssignments={currentRole === 'teacher' ? currentTeacherTeachingAssignments : []}
                  teacherId={currentRole === 'teacher' ? currentTeacherProfile?.id : undefined}
                />
              )}

              {activeTab === 'bulletins' && ['super_admin', 'school_admin', 'school_accountant'].includes(currentRole) && (
                <BulletinsView
                  schoolsList={schoolsList}
                  schoolFilterId={superAdminSchoolFilterId}
                  onSchoolFilterChange={handleSuperAdminSchoolFilterChange}
                  classesList={classesList}
                  studentsList={studentsList}
                  evaluationsList={activeEvaluations}
                  gradesList={gradesList}
                  teacherClassIds={[]}
                />
              )}

              {activeTab === 'bulletins' && !['super_admin', 'school_admin', 'school_accountant'].includes(currentRole) && null}

              {activeTab === 'accounting' && canAccessAccounting && (
                <AccountingView
                  userRole={currentRole}
                  currentSchoolId={currentSchoolId ?? null}
                  schoolFilterId={superAdminSchoolFilterId}
                  onSchoolFilterChange={handleSuperAdminSchoolFilterChange}
                  schools={schoolsList}
                  years={yearsList}
                  classes={classesList}
                  students={studentsList}
                />
              )}

              {activeTab === 'class-results' && ['super_admin', 'school_admin', 'school_accountant'].includes(currentRole) && (
                <ClassResultsView
                  schoolsList={schoolsList}
                  currentSchoolId={currentSchoolId}
                  schoolFilterId={superAdminSchoolFilterId}
                  onSchoolFilterChange={handleSuperAdminSchoolFilterChange}
                />
              )}

              {activeTab === 'class-subject-pivot' && ['super_admin', 'school_admin', 'school_accountant'].includes(currentRole) && (
                <ClassSubjectPivotView
                  schoolsList={schoolsList}
                  currentSchoolId={currentSchoolId}
                  schoolFilterId={superAdminSchoolFilterId}
                  onSchoolFilterChange={handleSuperAdminSchoolFilterChange}
                />
              )}

              {activeTab === 'audit' && currentRole === 'super_admin' && (
                <AuditView
                  page={auditPage}
                  isLoading={isAuditLoading}
                  onReload={fetchAuditEvents}
                  schoolsList={schoolsList}
                />
              )}

              {activeTab === 'notifications' && (
                <NotificationView
                  userRole={currentRole}
                  schoolFilterId={superAdminSchoolFilterId}
                  notificationsList={notificationsList}
                  usersList={usersList}
                  classesList={classesList}
                  studentsList={studentsList}
                  onSendNotification={handleSendNotification}
                  onMarkAllAsRead={handleMarkAllAsRead}
                  onNotificationRead={handleNotificationRead}
                />
              )}

              {activeTab === 'mobile-parent' && (
                <MobileParentView
                  studentsList={studentsList}
                  parentsList={parentsList}
                  absencesList={absencesList}
                  gradesList={gradesList}
                  notificationsList={notificationsList}
                  onJustifyAbsence={handleJustifyAbsence}
                  onNotificationRead={handleNotificationRead}
                />
              )}
              </div>
            </div>
          )}

        </main>

      </div>
    </div>
  );
}
