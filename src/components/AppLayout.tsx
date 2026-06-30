import React, { type ReactNode } from 'react';
import type { AcademicYear, Class, Parent, School, Student, SystemNotification, Teacher, UserRole } from '../types.ts';
import { getUiErrorMessage } from '../lib/api.ts';
import SimulatorHeader from './SimulatorHeader.tsx';
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
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

interface AppLayoutProps {
  currentRole: UserRole;
  schoolsList: School[];
  parentsList: Parent[];
  classesList: Class[];
  teachersList: Teacher[];
  studentsList: Student[];
  yearsList: AcademicYear[];
  notificationsList: SystemNotification[];
  activeTab: string;
  isSyncing: boolean;
  errorMsg: string | null;
  onRoleChange: (role: string) => void;
  onLogout: () => void;
  onRefreshData: (showSpinner?: boolean) => Promise<void>;
  onManageAccounts: () => void;
  onTabChange: (tab: string) => void;
  onClearError: () => void;
  children: ReactNode;
}

export default function AppLayout({
  currentRole,
  schoolsList,
  parentsList,
  classesList,
  teachersList,
  studentsList,
  yearsList,
  notificationsList,
  activeTab,
  isSyncing,
  errorMsg,
  onRoleChange,
  onLogout,
  onRefreshData,
  onManageAccounts,
  onTabChange,
  onClearError,
  children,
}: AppLayoutProps) {
  const unreadNotifications = notificationsList.filter((notification) => !notification.isRead).length;
  const visibleErrorMsg = getUiErrorMessage(errorMsg);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800" id="main-application">
      {visibleErrorMsg && (
        <div className="fixed inset-x-0 top-4 z-[70] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto max-w-md w-full bg-rose-50 border border-rose-100 p-4 rounded-2xl shadow-lg flex items-start gap-3 animate-fade-in text-xs sm:text-sm">
            <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed">
              <p className="font-bold text-rose-800">Alerte Système</p>
              <p className="text-rose-700">{visibleErrorMsg}</p>
            </div>
            <button onClick={onClearError} className="ml-auto text-rose-400 font-bold hover:text-rose-600 cursor-pointer">✕</button>
          </div>
        </div>
      )}

      <SimulatorHeader
        currentRole={currentRole}
        schoolsList={schoolsList}
        parentsList={parentsList}
        classesList={classesList}
        teachersList={teachersList}
        studentsList={studentsList}
        yearsList={yearsList}
        onRoleChange={onRoleChange}
        onLogout={onLogout}
        onRefreshData={onRefreshData}
        isSyncing={isSyncing}
        onManageAccounts={onManageAccounts}
      />

      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col lg:flex-row gap-6">
        <aside className="w-full lg:w-64 shrink-0 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm" id="main-sidebar">
          <div className="space-y-4">
            <div className="px-3 py-2 border-b border-slate-100 pb-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Navigation</span>
              <p className="text-xs text-slate-400">Cliquez pour basculer d'un module à l'autre</p>
            </div>

            <nav className="space-y-1">
              <button
                onClick={() => onTabChange('tableau-de-bord')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'tableau-de-bord'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-dashboard"
              >
                <LayoutDashboard className="h-4.5 w-4.5" />
                <span>Tableau de Bord</span>
              </button>

              <button
                onClick={() => onTabChange('administration')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'administration'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-admin"
              >
                <Building2 className="h-4.5 w-4.5" />
                <span>Administration</span>
              </button>

              <button
                onClick={() => onTabChange('absences')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'absences'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-absences"
              >
                <CalendarDays className="h-4.5 w-4.5" />
                <span>Absences</span>
              </button>

              {currentRole !== 'parent' && (
                <>
                  <button
                    onClick={() => onTabChange('notes')}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'notes'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                    id="sidebar-nav-grades"
                  >
                    <Award className="h-4.5 w-4.5" />
                    <span>Notes & Bulletins</span>
                  </button>

                  <button
                    onClick={() => onTabChange('archive')}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'archive'
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                    id="sidebar-nav-archive"
                  >
                    <BookOpen className="h-4.5 w-4.5" />
                    <span>Archive</span>
                  </button>
                </>
              )}

              <button
                onClick={() => onTabChange('bulletins')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'bulletins'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-bulletins"
              >
                <FileText className="h-4.5 w-4.5" />
                <span>Bulletins</span>
              </button>

              {currentRole === 'super_admin' && (
                <button
                  onClick={() => onTabChange('audit')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    activeTab === 'audit'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  id="sidebar-nav-audit"
                >
                  <Info className="h-4.5 w-4.5" />
                  <span>Journal des actions</span>
                </button>
              )}

              <button
                onClick={() => onTabChange('notifications')}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'notifications'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-notifications"
              >
                <div className="flex items-center gap-3">
                  <Bell className="h-4.5 w-4.5" />
                  <span>Messagerie & Push</span>
                </div>
                {unreadNotifications > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === 'notifications' ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'
                  }`}>
                    {unreadNotifications}
                  </span>
                )}
              </button>

              <button
                onClick={() => onTabChange('mobile-parent')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'mobile-parent'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
                id="sidebar-nav-mobile"
              >
                <Smartphone className="h-4.5 w-4.5" />
                <span>Application Mobile</span>
              </button>
            </nav>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-100 flex flex-col gap-2 p-1">
            <div className="text-[10px] text-slate-400 space-y-1">
              <span className="font-bold text-slate-500 block">BASE DE DONNÉES :</span>
              <p className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full inline-block" />
                PostgreSQL Connecté (Cloud SQL)
              </p>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0" id="main-viewport">
          {isSyncing && (
            <div className="bg-white/60 p-12 text-center rounded-2xl border border-slate-50 shadow-sm flex flex-col justify-center items-center gap-3 my-12">
              <RefreshCw className="h-10 w-10 text-indigo-600 animate-spin" />
              <p className="text-xs text-slate-500 font-medium">Synchronisation des registres en temps réel...</p>
            </div>
          )}

          {!isSyncing && (
            <div className="bg-white p-6 border border-slate-100 rounded-2xl shadow-sm transition-all animate-fade-in" id="content-card">
              {children}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}