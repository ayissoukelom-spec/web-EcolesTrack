import React, { useState, useEffect } from 'react';
import { Student, Absence, Grade, SystemNotification, UserRole, Parent } from '../types.ts';
import { getSimulatedUser } from '../lib/api.ts';
import {
  Smartphone,
  GraduationCap,
  Wifi,
  Battery,
  User,
  Bell,
  Award,
  Calendar,
  Lock,
  ChevronRight,
  TrendingUp,
  Inbox,
  AlertCircle,
  FileCheck2,
  Sparkles
} from 'lucide-react';

interface MobileParentViewProps {
  studentsList: Student[];
  parentsList: Parent[];
  absencesList: Absence[];
  gradesList: Grade[];
  notificationsList: SystemNotification[];
  onJustifyAbsence: (id: number, reason: string) => void;
  currentRole?: UserRole;
}

export default function MobileParentView({
  studentsList,
  parentsList,
  absencesList,
  gradesList,
  notificationsList,
  onJustifyAbsence,
  currentRole,
}: MobileParentViewProps) {
  const [activeScreen, setActiveScreen] = useState<'login' | 'dashboard' | 'absences' | 'grades' | 'notifs'>('login');
  const [notifTab, setNotifTab] = useState<'notes' | 'homework'>('notes');
  const [password, setPassword] = useState('parent123456');
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null);

  // States for live alerts inside simulator
  const [pushedAlert, setPushedAlert] = useState<SystemNotification | null>(null);

  const simulatedUser = getSimulatedUser();
  const parentEmail = simulatedUser?.email || 'marianne.dubois@gmail.com';

  const currentEmail = simulatedUser?.email?.toLowerCase();
  const currentUid = simulatedUser?.uid || '';
  const parsedUidSuffix = currentUid ? Number(currentUid.split('_').pop()) : NaN;
  const currentParent = parentsList.find((p) => {
    const byEmail = currentEmail && p.email?.toLowerCase() === currentEmail;
    const byUidString = currentUid && String(p.userId) === currentUid;
    const byUidNumber = !Number.isNaN(parsedUidSuffix) && p.userId === parsedUidSuffix;
    return Boolean(byEmail || byUidString || byUidNumber);
  });

  const connectedParentName = currentParent?.name || simulatedUser?.name || 'Parent';

  const children = currentParent
    ? studentsList.filter((s) => s.parentId === currentParent.id || s.id === currentParent.studentId)
    : [];

  useEffect(() => {
    if (children.length > 0 && selectedChildId === null) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  // Read newest unread notification to trigger a simulated sliding banner
  useEffect(() => {
    const unread = notificationsList.filter((n) => !n.isRead);
    if (unread.length > 0) {
      const newest = unread[0];
      setPushedAlert(newest);
      const timer = setTimeout(() => {
        setPushedAlert(null);
      }, 5000); // Dissolve notice banner after 5 sec
      return () => clearTimeout(timer);
    }
  }, [notificationsList]);

  const activeChild = children.find((c) => c.id === selectedChildId) || children[0];

  const showGrades = currentRole === 'parent'
    ? Boolean(currentParent && children.length > 0)
    : currentRole != null;

  // Filters for active children
  const childAbsences = activeChild
    ? absencesList.filter((a) => a.studentId === activeChild.id)
    : [];
  const childGrades = activeChild
    ? gradesList.filter((g) => g.studentId === activeChild.id)
    : [];

  const normalizeNotifText = (value?: string) => (value || '').toLowerCase();
  const normalizeForMatch = (value?: string) =>
    normalizeNotifText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  type ParentNotifCategory = 'notes' | 'homework' | 'other';

  const classifyParentNotification = (notif: SystemNotification): ParentNotifCategory => {
    const notifType = normalizeForMatch(notif.type);
    const payload = `${normalizeForMatch(notif.title)} ${normalizeForMatch(notif.body)}`;

    const isHomeworkByType = notifType === 'assignment' || notifType === 'homework' || notifType === 'devoir';
    const isHomeworkByKeyword = /\b(devoir|publie|assignment)\b/i.test(payload);
    if (isHomeworkByType || isHomeworkByKeyword) return 'homework';

    if (notifType === 'grade') return 'notes';

    return 'other';
  };

  const parentNotifBuckets = notificationsList.reduce(
    (acc, notif) => {
      if (acc.seenIds.has(notif.id)) return acc;

      const category = classifyParentNotification(notif);
      if (category === 'notes') {
        acc.notes.push(notif);
        acc.seenIds.add(notif.id);
      } else if (category === 'homework') {
        acc.homework.push(notif);
        acc.seenIds.add(notif.id);
      }

      return acc;
    },
    {
      notes: [] as SystemNotification[],
      homework: [] as SystemNotification[],
      seenIds: new Set<number>(),
    }
  );

  const mobileNotesNotifications = parentNotifBuckets.notes;
  const mobileHomeworkNotifications = parentNotifBuckets.homework;
  const currentNotifTabList = notifTab === 'notes' ? mobileNotesNotifications : mobileHomeworkNotifications;

  // Calculate Average score for child
  const calculateGPA = () => {
    if (childGrades.length === 0) return 'N/A';
    const numScores = childGrades.map((g) => parseFloat(g.score)).filter((s) => !isNaN(s));
    if (numScores.length === 0) return 'N/A';
    const sum = numScores.reduce((acc, c) => acc + c, 0);
    return (sum / numScores.length).toFixed(1);
  };

  const handleApkLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveScreen('dashboard');
  };

  return (
    <div className="space-y-6" id="mobile-parent-view">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="px-3 py-1 bg-indigo-50 border border-indigo-100/50 text-indigo-700 text-xs font-black rounded-full uppercase tracking-wider">
          Architecture Mobile Hybride
        </span>
        <h2 className="text-2xl font-black text-slate-800">Maquette Mobile Parents (APK)</h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Découvrez la future application Android d'EcoleTrack. Ce panneau réplique en temps réel l'interface qui sera embarquée dans l'APK compilé.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row items-center justify-center gap-8 pt-4">
        
        {/* LEFT COMPONENT: COMPILING CAPABILITY CARD DETAILS */}
        <div className="w-full lg:w-96 space-y-4 text-slate-600 text-xs self-start">
          <div className="bg-white p-5 border border-slate-100 rounded-2xl space-y-3 shadow-sm">
            <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Sparkles className="h-4.5 w-4.5 text-indigo-500 animate-pulse" />
              Spécifications Clés APK Android
            </h4>
            
            <div className="space-y-2.5">
              <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
                <span className="text-slate-400">Framework Mobile</span>
                <span className="font-bold text-slate-700 text-right">React Native / Capacitor</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
                <span className="text-slate-400">Canal Notifications</span>
                <span className="font-bold text-indigo-600 text-right">Firebase Cloud Messaging (FCM)</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
                <span className="text-slate-400">Payload Token</span>
                <span className="font-bold text-slate-700 text-right text-[10px] bg-slate-100 p-1 rounded font-mono">X-FCM-TOKEN</span>
              </div>
              <div className="flex justify-between items-center pb-1.5">
                <span className="text-slate-400">Signature Android</span>
                <span className="font-bold text-slate-700 text-right">APK v2 (SHA-256)</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 p-4 border border-slate-100 rounded-xl space-y-1 text-[11px] leading-relaxed">
            <p className="font-bold text-slate-700">💡 Conseil d'utilisation :</p>
            <p>
              Publiez une nouvelle note ou absence dans l'onglet Enseignant, et observez instantanément le bandeau de notification push apparaître au sommet du smartphone virtuel simulé !
            </p>
          </div>
        </div>

        {/* CENTER COMPONENT: ANDROID DEVICE CASING */}
        <div className="relative mx-auto w-[310px] h-[640px] bg-slate-900 rounded-[44px] p-3 shadow-2xl border-4 border-slate-700 flex flex-col overflow-hidden select-none mb-10" id="android-device">
          
          {/* Speaker ear piece & Camera Punch hole */}
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center gap-1.5 z-30">
            <span className="w-12 h-1 bg-slate-800 rounded-full" />
            <span className="w-2.5 h-2.5 bg-slate-950 border border-slate-800 rounded-full inline-block" />
          </div>

          {/* Device inner board */}
          <div className="flex-1 rounded-[36px] bg-slate-900 border border-slate-950 overflow-hidden relative flex flex-col text-slate-100 text-xs">
            
            {/* ANDROID STATUS STATUS BAR */}
            <div className="h-7 pt-1 px-5 flex justify-between items-center bg-slate-950 text-[10px] font-bold text-slate-400 z-20">
              <span>09:41</span>
              <div className="flex items-center gap-1.5">
                <Wifi className="h-3 w-3" />
                <span className="font-semibold" style={{ fontSize: '9px' }}>LTE</span>
                <Battery className="h-3 w-3" />
              </div>
            </div>

            {/* FCM PUSH NOTIFICATION IMMERSIVE BANNER SLIDE-IN */}
            {pushedAlert && (
              <div className="absolute top-8 left-2 right-2 p-3 bg-slate-950/95 backdrop-blur border border-indigo-500/30 rounded-xl flex gap-2 shadow-2xl z-40 animate-bounce duration-300">
                <div className="p-1.5 bg-indigo-600 rounded-lg text-white">
                  <Bell className="h-3.5 w-3.5 animate-pulse" />
                </div>
                <div className="flex-1 text-[10px] text-slate-300">
                  <p className="font-bold text-white text-xs">{pushedAlert.title}</p>
                  <p className="line-clamp-2 mt-0.5 leading-snug">{pushedAlert.body}</p>
                </div>
              </div>
            )}

            {/* SCREEN CONTENT CANVAS */}
            <div className="flex-1 bg-slate-950 relative flex flex-col overflow-hidden">
              
              {/* SCREEN 1: LOGIN APP PORT */}
              {activeScreen === 'login' && (
                <div className="flex-1 p-5 flex flex-col justify-center space-y-6">
                  <div className="text-center space-y-1.5 pt-6">
                    <div className="w-12 h-12 bg-indigo-600 rounded-2xl mx-auto flex items-center justify-center">
                      <GraduationCap className="h-7 w-7 text-white" />
                    </div>
                    <h3 className="font-black text-white text-base">EcoleTrack Parent</h3>
                    <p className="text-[10px] text-slate-400">Espace Privé & Sécurisé de l'élève</p>
                  </div>

                  <form onSubmit={handleApkLogin} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Compte Parent rattaché</label>
                      <input
                        disabled
                        type="email"
                        value={parentEmail}
                        className="w-full bg-slate-900 border border-slate-800 text-slate-300 px-3 py-2 text-[11px] rounded-lg cursor-not-allowed"
                      />
                    </div>
                    
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Code d'accès secret</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 text-white px-3 py-2 text-[11px] rounded-lg tracking-widest focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow-md shadow-indigo-600/30 transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
                    >
                      <Lock className="h-3 w-3" />
                      Se connecter
                    </button>
                  </form>

                  <div className="text-center text-[9px] text-slate-500 leading-normal">
                    Compatible Push Notifications Google FCM Service standard
                  </div>
                </div>
              )}

              {/* OUT OF LOGIN: APP CONTENT (DASHBOARD, GRADES, ABSENCES, NOTIFS) */}
              {activeScreen !== 'login' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  
                  {/* APP LOGGED HEADER */}
                  <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center shrink-0">
                    <div>
                      <span className="text-[8px] font-black text-indigo-400 uppercase tracking-wider block">Portail Parent</span>
                      <h4 className="font-black text-xs text-white max-w-[150px] truncate">{connectedParentName}</h4>
                    </div>
                    
                    <button
                      onClick={() => setActiveScreen('login')}
                      className="text-[9px] font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded"
                    >
                      Déconnexion
                    </button>
                  </div>

                  {/* CHILD SELECTION TOP WIDGET */}
                  <div className="px-3 py-2 bg-slate-950 border-b border-slate-900 shrink-0 flex items-center justify-between">
                    <span className="text-[9px] text-slate-400">Élève actif :</span>
                    <div className="flex gap-1.5">
                      {children.map((ch) => (
                        <button
                          key={ch.id}
                          onClick={() => setSelectedChildId(ch.id)}
                          className={`px-2 py-1 text-[9px] font-bold rounded transition-colors ${
                            selectedChildId === ch.id
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-900 text-slate-400 hover:text-white'
                          }`}
                        >
                          {ch.firstName}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* FLEX CENTRAL PAGE VIEWPORTS */}
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
                    
                    {/* MOB DASHBOARD */}
                    {activeScreen === 'dashboard' && activeChild && (
                      <div className="space-y-4 animate-fade-in">
                        {/* Child micro profile sheet */}
                        <div className="bg-gradient-to-br from-indigo-900 to-indigo-950 p-4 rounded-xl border border-indigo-800/40 relative overflow-hidden">
                          <div className="space-y-1.5 relative z-10">
                            <span className="text-[8px] font-bold text-indigo-200 bg-white/15 px-2 py-0.5 rounded uppercase tracking-wider inline-block">Élève actif</span>
                            <h3 className="font-extrabold text-white text-sm">{activeChild.firstName} {activeChild.lastName}</h3>
                            <p className="text-[10px] text-indigo-200">Date naiss : {activeChild.birthDate}</p>
                          </div>
                        </div>

                        {/* Stats counters */}
                        <div className="grid grid-cols-2 gap-2.5">
                          {showGrades ? (
                            <div
                              onClick={() => setActiveScreen('grades')}
                              className="bg-slate-900 p-3 rounded-lg border border-slate-800/50 flex flex-col justify-between h-20 hover:border-slate-700 cursor-pointer"
                            >
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Trimestre</span>
                              <p className="text-lg font-black text-indigo-400 mt-1">{calculateGPA()} <span className="text-[10px] text-slate-500 font-normal">/20</span></p>
                              <p className="text-[8px] text-slate-500">Moyenne Générale</p>
                            </div>
                          ) : (
                            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800/20 flex flex-col justify-between h-20 opacity-60">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Trimestre</span>
                              <p className="text-lg font-black text-indigo-400 mt-1">— <span className="text-[10px] text-slate-500 font-normal">/20</span></p>
                              <p className="text-[8px] text-slate-500">Moyenne indisponible</p>
                            </div>
                          )}

                          <div
                            onClick={() => setActiveScreen('absences')}
                            className="bg-slate-900 p-3 rounded-lg border border-slate-800/50 flex flex-col justify-between h-20 hover:border-slate-700 cursor-pointer"
                          >
                            <span className="text-[9px] font-bold text-rose-400 uppercase tracking-wider block">Assiduité</span>
                            <p className="text-lg font-black text-rose-500 mt-1">
                              {childAbsences.length} <span className="text-[10px] text-slate-500 font-normal">absences</span>
                            </p>
                            <p className="text-[8px] text-slate-500">
                              {childAbsences.filter(a => !a.isJustified).length} non justifiées
                            </p>
                          </div>
                        </div>

                        {/* Quick navig links */}
                        <div className="space-y-1.5">
                          <h5 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Raccourcis de Suivi</h5>
                          
                          <div
                            onClick={() => setActiveScreen('absences')}
                            className="p-2.5 bg-slate-900 hover:bg-slate-800 rounded-lg flex justify-between items-center border border-slate-800 cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <Calendar className="h-3.5 w-3.5 text-rose-500" />
                              <span className="text-[11px] font-semibold">Registre des Absences</span>
                            </div>
                            <ChevronRight className="h-3 w-3 text-slate-500" />
                          </div>

                          {showGrades && (
                            <div
                              onClick={() => setActiveScreen('grades')}
                              className="p-2.5 bg-slate-900 hover:bg-slate-800 rounded-lg flex justify-between items-center border border-slate-800 cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <Award className="h-3.5 w-3.5 text-indigo-400" />
                                <span className="text-[11px] font-semibold">Consulter le Bulletin</span>
                              </div>
                              <ChevronRight className="h-3 w-3 text-slate-500" />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* MOB ABSENCES SCREEN */}
                    {activeScreen === 'absences' && (
                      <div className="space-y-3 animate-fade-in">
                        <div className="flex justify-between items-center">
                          <h4 className="font-extrabold text-xs text-white">Absences de {activeChild?.firstName}</h4>
                          <span className="text-[9px] bg-slate-900 text-slate-400 px-2 py-0.5 rounded">Total: {childAbsences.length}</span>
                        </div>

                        <div className="space-y-2">
                          {childAbsences.map((abs) => (
                            <div key={abs.id} className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1.5 text-[10px]">
                              <div className="flex justify-between items-center">
                                <span className="font-bold text-white font-mono text-[10px]">{abs.date}</span>
                                <span className={`px-1.5 py-0.5 rounded-[4px] font-bold uppercase text-[8px] ${
                                  abs.isJustified ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                                }`}>
                                  {abs.isJustified ? 'Justifiée' : 'A Justifier'}
                                </span>
                              </div>
                              <p className="text-slate-400 capitalize">Période : {abs.period === 'morning' ? 'Matin' : 'Après-midi'}</p>
                              
                              {abs.isJustified ? (
                                <p className="text-emerald-500 py-0.5 border-t border-slate-800/30 font-semibold italic truncate">Motif : {abs.justificationReason}</p>
                              ) : (
                                <div className="pt-2 border-t border-slate-800/30">
                                  <button
                                    onClick={() => {
                                      const reason = window.prompt("Saisissez le motif de justification pour Lucas Dubois :");
                                      if (reason) {
                                        onJustifyAbsence(abs.id, reason);
                                      }
                                    }}
                                    className="w-full py-1 bg-indigo-600 text-white font-bold rounded-lg text-[9px] hover:bg-indigo-700"
                                  >
                                    Justifier Maintenant
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}

                          {childAbsences.length === 0 && (
                            <div className="py-8 text-center text-slate-500 text-[10px]">
                              <Inbox className="h-6 w-6 text-slate-600 mx-auto mb-1.5" />
                              Aucune absence enregistrée. Félicitations !
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* MOB GRADES SCREEN */}
                    {showGrades && activeScreen === 'grades' && (
                      <div className="space-y-3 animate-fade-in">
                        <div className="flex justify-between items-center pb-1 border-b border-slate-800/40">
                          <h4 className="font-extrabold text-xs text-white">Carnet de Notes</h4>
                          <span className="text-[10px] text-slate-400">Moyenne: <strong className="text-yellow-400">{calculateGPA()}/20</strong></span>
                        </div>

                        <div className="space-y-2">
                          {childGrades.map((g) => (
                            <div key={g.id} className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg flex justify-between items-center text-[10px]">
                              <div className="space-y-0.5">
                                <p className="font-extrabold text-white">{g.subject}</p>
                                <p className="text-[9px] text-slate-400 truncate max-w-[160px]">{g.evaluationTitle || 'Devoir'}</p>
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-black text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded">
                                  {g.score}/20
                                </span>
                              </div>
                            </div>
                          ))}

                          {childGrades.length === 0 && (
                            <p className="text-slate-500 py-6 text-center text-[10px]">Aucune note disponible dans le système.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* MOB NOTIFICATIONS SCREEN */}
                    {activeScreen === 'notifs' && (
                      <div className="space-y-3 animate-fade-in">
                        <h4 className="font-extrabold text-xs text-white">Notifications Push Recues</h4>

                        <div className="rounded-lg bg-slate-900/70 border border-slate-800 p-1 flex gap-1">
                          <button
                            type="button"
                            onClick={() => setNotifTab('notes')}
                            className={`flex-1 px-2 py-1.5 rounded-md text-[10px] font-bold transition-colors ${
                              notifTab === 'notes'
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            Notes ({mobileNotesNotifications.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setNotifTab('homework')}
                            className={`flex-1 px-2 py-1.5 rounded-md text-[10px] font-bold transition-colors ${
                              notifTab === 'homework'
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            Devoirs ({mobileHomeworkNotifications.length})
                          </button>
                        </div>

                        <div className="space-y-2">
                          {currentNotifTabList.map((notif) => (
                            <div key={notif.id} className="p-3 bg-slate-900 border border-slate-850 rounded-lg text-[10px] space-y-1">
                              <p className="font-bold text-indigo-300">{notif.title}</p>
                              <p className="text-slate-400 leading-snug">{notif.body}</p>
                            </div>
                          ))}

                          {currentNotifTabList.length === 0 && (
                            <p className="text-slate-500 text-center py-6 text-[10px]">
                              {notifTab === 'notes'
                                ? 'Aucune notification liée aux notes.'
                                : 'Aucune notification de devoir à venir.'}
                            </p>
                          )}
                        </div>

                        {notificationsList.length === 0 && (
                          <p className="text-slate-500 text-center py-3 text-[10px]">Aucune notification dans l'historique mobile.</p>
                        )}
                      </div>
                    )}

                  </div>

                  {/* BOTTOM MOBILE NAVIGATION BAR */}
                  <div className="h-14 bg-slate-900 border-t border-slate-800 flex justify-around items-center shrink-0">
                    <button
                      onClick={() => setActiveScreen('dashboard')}
                      className={`flex flex-col items-center gap-1 text-[9px] font-bold ${
                        activeScreen === 'dashboard' ? 'text-indigo-400' : 'text-slate-500'
                      }`}
                    >
                      <User className="h-4 w-4" />
                      <span>Accueil</span>
                    </button>
                    
                    <button
                      onClick={() => setActiveScreen('absences')}
                      className={`flex flex-col items-center gap-1 text-[9px] font-bold ${
                        activeScreen === 'absences' ? 'text-indigo-400' : 'text-slate-500'
                      }`}
                    >
                      <Calendar className="h-4 w-4" />
                      <span>Absences</span>
                    </button>

                    {showGrades && (
                      <button
                        onClick={() => setActiveScreen('grades')}
                        className={`flex flex-col items-center gap-1 text-[9px] font-bold ${
                          activeScreen === 'grades' ? 'text-indigo-400' : 'text-slate-500'
                        }`}
                      >
                        <Award className="h-4 w-4" />
                        <span>Notes</span>
                      </button>
                    )}

                    <button
                      onClick={() => setActiveScreen('notifs')}
                      className={`flex flex-col items-center gap-1 pr-1.5 relative text-[9px] font-bold ${
                        activeScreen === 'notifs' ? 'text-indigo-400' : 'text-slate-500'
                      }`}
                    >
                      <Bell className="h-4 w-4" />
                      <span>Alertes</span>
                      {notificationsList.filter(n => !n.isRead).length > 0 && (
                        <span className="absolute top-0 right-1 h-1.5 w-1.5 bg-rose-500 rounded-full" />
                      )}
                    </button>
                  </div>

                </div>
              )}

            </div>

            {/* Simulated Android home key button */}
            <div className="h-9 bg-slate-950 flex justify-center items-center shrink-0">
              <span className="w-10 h-10 border border-slate-850 rounded-full inline-block cursor-pointer hover:bg-slate-900 transition-colors" onClick={() => { if (activeScreen !== 'login') setActiveScreen('dashboard'); }} />
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
