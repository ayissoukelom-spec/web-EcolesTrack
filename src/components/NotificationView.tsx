import React, { useMemo, useState } from 'react';
import { SystemNotification, User, UserRole } from '../types.ts';
import { Bell, ShieldAlert, Sparkles, Send, CheckCircle2, Megaphone, Smartphone, RefreshCw, Mail } from 'lucide-react';
import RequiredLabel from './RequiredLabel';

interface NotificationViewProps {
  userRole: UserRole;
  notificationsList: SystemNotification[];
  usersList: User[];
  onSendNotification: (data: { title: string; body: string; type: string; userId?: number }) => void;
  onMarkAllAsRead: () => void;
}

export default function NotificationView({
  userRole,
  notificationsList,
  usersList,
  onSendNotification,
  onMarkAllAsRead,
}: NotificationViewProps) {
  const [isSending, setIsSending] = useState(false);
  const [parentActiveTab, setParentActiveTab] = useState<'notes' | 'homework'>('notes');
  const [notifForm, setNotifForm] = useState({
    title: '',
    body: '',
    type: 'info',
    userId: '',
  });

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);

    onSendNotification({
      title: notifForm.title,
      body: notifForm.body,
      type: notifForm.type,
      userId: notifForm.userId ? parseInt(notifForm.userId) : undefined,
    });

    setNotifForm({
      title: '',
      body: '',
      type: 'info',
      userId: '',
    });
    
    setTimeout(() => setIsSending(false), 800);
  };

  const normalizeNotifText = (value?: string) => (value || '').toLowerCase();
  const normalizeForMatch = (value?: string) =>
    normalizeNotifText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  type ParentNotifCategory = 'notes' | 'homework' | 'other';

  // Centralized classifier to keep parent tabs deterministic and avoid duplicates.
  const classifyParentNotification = (notif: SystemNotification): ParentNotifCategory => {
    const notifType = normalizeForMatch(notif.type);
    const payload = `${normalizeForMatch(notif.title)} ${normalizeForMatch(notif.body)}`;

    const isHomeworkByType = notifType === 'assignment' || notifType === 'homework' || notifType === 'devoir';
    const isHomeworkByKeyword = /\b(devoir|publie|assignment)\b/i.test(payload);

    // Priority rule: homework markers in type/message win over grade classification.
    if (isHomeworkByType || isHomeworkByKeyword) return 'homework';

    // Notes tab: strictly grade notifications only.
    if (notifType === 'grade') return 'notes';

    return 'other';
  };

  const parentNotificationsByCategory = useMemo(() => {
    const seenIds = new Set<number>();
    const notes: SystemNotification[] = [];
    const homework: SystemNotification[] = [];

    for (const notif of notificationsList) {
      if (seenIds.has(notif.id)) continue;
      const category = classifyParentNotification(notif);
      if (category === 'notes') {
        notes.push(notif);
        seenIds.add(notif.id);
      } else if (category === 'homework') {
        homework.push(notif);
        seenIds.add(notif.id);
      }
    }

    return { notes, homework };
  }, [notificationsList]);

  const parentNotesNotifications = parentNotificationsByCategory.notes;
  const parentUpcomingHomeworkNotifications = parentNotificationsByCategory.homework;
  const parentTabNotifications = parentActiveTab === 'notes' ? parentNotesNotifications : parentUpcomingHomeworkNotifications;

  const renderNotificationCard = (notif: SystemNotification) => {
    const themeColor =
      notif.type === 'absence' ? { bg: 'bg-rose-50 border-rose-100 text-rose-700', bullet: 'bg-rose-500' } :
      notif.type === 'grade' ? { bg: 'bg-amber-50 border-amber-100 text-amber-700', bullet: 'bg-amber-500' } :
      { bg: 'bg-indigo-50 border-indigo-100 text-indigo-700', bullet: 'bg-indigo-500' };

    return (
      <div
        key={notif.id}
        className={`p-4 rounded-xl border flex gap-3 transition-colors ${
          notif.isRead ? 'bg-white border-slate-100 text-slate-600' : 'bg-slate-50/70 border-indigo-100/50'
        }`}
      >
        <div className="mt-1">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${themeColor.bullet} ${!notif.isRead ? 'animate-pulse' : ''}`} />
        </div>
        <div className="space-y-1 flex-1">
          <div className="flex justify-between items-start gap-2">
            <h4 className="font-bold text-xs sm:text-sm text-slate-800 leading-tight">{notif.title}</h4>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">Instant</span>
          </div>
          <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">{notif.body}</p>
          <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400">
            <span className={`capitalize font-bold px-2 py-0.5 rounded ${themeColor.bg}`} style={{ fontSize: '9px' }}>
              Type : {notif.type}
            </span>
            {notif.isRead ? (
              <span className="text-slate-400">Message déjà lu</span>
            ) : (
              <span className="text-indigo-600 font-bold">Nouveau Message</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6" id="notification-view">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Dépêches & Notifications Push</h2>
          <p className="text-sm text-slate-500">Flux de messages, alertes d'absences, notes publiées et communication en temps réel (FCM)</p>
        </div>

        <button
          onClick={onMarkAllAsRead}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm rounded-xl cursor-pointer transition-colors"
          id="btn-notif-read-all"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Tout marquer comme lu
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: ACTIVE NOTIFICATIONS FEED */}
        <div className="bg-white p-5 border border-slate-50 rounded-2xl shadow-sm lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-slate-50">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm sm:text-base">
              <Bell className="h-5 w-5 text-indigo-500" />
              Fil de vos Notifications Recues (Temps réel)
            </h3>
            <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
              {notificationsList.filter((n) => !n.isRead).length} non lues
            </span>
          </div>

          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto pr-1 space-y-1">
            {userRole === 'parent' ? (
              <div className="space-y-4">
                <div className="rounded-xl bg-slate-100/80 p-1.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setParentActiveTab('notes')}
                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                      parentActiveTab === 'notes'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800 hover:bg-white/70'
                    }`}
                  >
                    Notes
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${parentActiveTab === 'notes' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                      {parentNotesNotifications.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setParentActiveTab('homework')}
                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                      parentActiveTab === 'homework'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800 hover:bg-white/70'
                    }`}
                  >
                    Devoirs à venir
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${parentActiveTab === 'homework' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                      {parentUpcomingHomeworkNotifications.length}
                    </span>
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                      {parentActiveTab === 'notes' ? 'Notes' : 'Devoirs à venir'}
                    </h4>
                    <span className="text-[11px] text-slate-400">
                      {parentTabNotifications.length} notification{parentTabNotifications.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  {parentTabNotifications.length > 0 ? (
                    <div className="space-y-2">
                      {parentTabNotifications.map(renderNotificationCard)}
                    </div>
                  ) : (
                    <div className="py-6 px-4 rounded-lg bg-slate-50 text-slate-400 text-xs text-center">
                      {parentActiveTab === 'notes'
                        ? 'Aucune notification liée aux notes.'
                        : 'Aucune notification de devoir à venir.'}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              notificationsList.map(renderNotificationCard)
            )}

            {notificationsList.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-xs">
                <Megaphone className="h-10 w-10 mx-auto text-slate-200 mb-2" />
                Vous n'avez reçu aucune notification pour l'instant.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: BROADCAST EMITTER FOR ADMINS & TEACHERS */}
        <div className="space-y-6">
          
          <div className="bg-white p-5 border border-slate-50 rounded-2xl shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm sm:text-base">
                <Send className="h-5 w-5 text-indigo-500" />
                Émettre un message push (FCM)
              </h3>
              <p className="text-xs text-slate-400">Envoie un message instantané à la cible que vous configurez</p>
            </div>

            {['super_admin', 'school_admin', 'teacher'].includes(userRole) ? (
              <form onSubmit={handleBroadcast} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Destinataires ciblé</label>
                  <select
                    value={notifForm.userId}
                    onChange={(e) => setNotifForm({ ...notifForm, userId: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
                  >
                    <option value="">Tous les parents d'élèves (Diffusion)</option>
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Sélectionner la Catégorie</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['info', 'absence', 'grade'].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNotifForm({ ...notifForm, type: t })}
                        className={`py-1.5 text-xs font-semibold rounded-lg border capitalize transition-all ${
                          notifForm.type === t
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {t === 'info' ? 'Info' : t === 'absence' ? 'Absence' : 'Note'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    <RequiredLabel label="Sujet de la notification" required />
                  </label>
                  <input
                    required
                    type="text"
                    value={notifForm.title}
                    onChange={(e) => setNotifForm({ ...notifForm, title: e.target.value })}
                    placeholder="ex. Réunion d’urgence parents-professeurs"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none placeholder-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    <RequiredLabel label="Contenu / Message" required />
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={notifForm.body}
                    onChange={(e) => setNotifForm({ ...notifForm, body: e.target.value })}
                    placeholder="Saisissez votre message d’information majeur à envoyer..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none placeholder-slate-400 text-slate-800"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSending}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md flex justify-center items-center gap-2 transition-all cursor-pointer"
                  id="btn-broadcast-submit"
                >
                  {isSending ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  ) : (
                    <Smartphone className="h-4 w-4 text-white" />
                  )}
                  Dispatchez par Notification Push
                </button>
              </form>
            ) : (
              <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl text-xs text-amber-800 leading-normal">
                Désolé, l’envoi de notifications push scolaires à l’échelle du lycée est réservé à l’administration scolaire et aux professeurs principaux.
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
