import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Class, Parent, Student, SystemNotification, User, UserRole } from '../types.ts';
import { apiFetch, apiFetchBlob } from '../lib/api.ts';
import { Bell, ShieldAlert, Sparkles, Send, CheckCircle2, Megaphone, Smartphone, RefreshCw, Mail } from 'lucide-react';
import RequiredLabel from './RequiredLabel';
import { getPublicationLabel } from '../lib/dateFormatting';

interface NotificationViewProps {
  userRole: UserRole;
  notificationsList: SystemNotification[];
  usersList: User[];
  classesList: Class[];
  studentsList: Student[];
  onSendNotification: (data: { title: string; body: string; type: string; userId?: number; classId?: number; files?: File[] }) => void;
  onMarkAllAsRead: () => void;
  onNotificationRead?: () => void;
}

export default function NotificationView({
  userRole,
  notificationsList,
  usersList,
  classesList,
  studentsList,
  onSendNotification,
  onMarkAllAsRead,
  onNotificationRead,
}: NotificationViewProps) {
  const [isSending, setIsSending] = useState(false);
  const [parentActiveTab, setParentActiveTab] = useState<'notes' | 'homework' | 'absences' | 'info'>('notes');
  const [notifForm, setNotifForm] = useState({
    title: '',
    body: '',
    type: 'info',
    recipientMode: 'all' as 'all' | 'class' | 'individual',
    userId: '',
    classId: '',
  });
  const [parentSearchQuery, setParentSearchQuery] = useState('');
  const [parentSearchResults, setParentSearchResults] = useState<Parent[]>([]);
  const [selectedParent, setSelectedParent] = useState<Parent | null>(null);
  const [isParentSearchLoading, setIsParentSearchLoading] = useState(false);
  const parentSearchRequestRef = useRef(0);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<number | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);

    onSendNotification({
      title: notifForm.title,
      body: notifForm.body,
      type: notifForm.type,
      userId: notifForm.recipientMode === 'individual' && selectedParent ? selectedParent.userId : undefined,
      classId: notifForm.recipientMode === 'class' && notifForm.classId ? parseInt(notifForm.classId) : undefined,
      files: attachedFiles.length > 0 ? attachedFiles : undefined,
    });

    setNotifForm({
      title: '',
      body: '',
      type: 'info',
      recipientMode: 'all',
      userId: '',
      classId: '',
    });
    setParentSearchQuery('');
    setParentSearchResults([]);
    setSelectedParent(null);
    setAttachedFiles([]);
    
    setTimeout(() => setIsSending(false), 800);
  };

  useEffect(() => {
    if (notifForm.recipientMode !== 'individual') {
      setParentSearchResults([]);
      setIsParentSearchLoading(false);
      return;
    }

    const query = parentSearchQuery.trim();
    const requestId = ++parentSearchRequestRef.current;
    if (query.length < 2) {
      setParentSearchResults([]);
      setIsParentSearchLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsParentSearchLoading(true);
      apiFetch(`/api/parents?q=${encodeURIComponent(query)}`)
        .then((results) => {
          if (requestId === parentSearchRequestRef.current) {
            setParentSearchResults(Array.isArray(results) ? results : []);
          }
        })
        .catch(() => {
          if (requestId === parentSearchRequestRef.current) setParentSearchResults([]);
        })
        .finally(() => {
          if (requestId === parentSearchRequestRef.current) setIsParentSearchLoading(false);
        });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [notifForm.recipientMode, parentSearchQuery]);

  const parentLabel = (parent: Parent) => String(parent.name || `${parent.firstName || ''} ${parent.lastName || ''}`).trim() || `Parent #${parent.id}`;
  const parentStudentLabel = (parent: Parent) => [parent.studentFirstName, parent.studentLastName].filter(Boolean).join(' ').trim();
  const selectedClassParentCount = notifForm.classId
    ? new Set(
      studentsList
        .filter((student) => String(student.classId) === notifForm.classId && student.parentId != null)
        .map((student) => student.parentId),
    ).size
    : 0;

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    setAttachedFiles((previousFiles) => [...previousFiles, ...nextFiles]);
    event.target.value = '';
  };

  const removeAttachedFile = (indexToRemove: number) => {
    setAttachedFiles((previousFiles) => previousFiles.filter((_, index) => index !== indexToRemove));
  };

  const handleAttachmentDownload = async (notificationId: number, attachmentId: number, fileName: string) => {
    setAttachmentError(null);
    setDownloadingAttachmentId(attachmentId);

    try {
      const blob = await apiFetchBlob(`/api/notifications/${notificationId}/attachments/${attachmentId}`);
      const objectUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = objectUrl;
      downloadLink.download = fileName;
      downloadLink.target = '_blank';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error: any) {
      const status = error?.status;
      setAttachmentError(
        status === 401
          ? 'Votre session a expiré. Veuillez vous reconnecter.'
          : status === 403
            ? 'Vous n’êtes pas autorisé à télécharger cette pièce jointe.'
            : status === 404
              ? 'Cette pièce jointe est indisponible.'
              : 'Le téléchargement de la pièce jointe a échoué.'
      );
    } finally {
      setDownloadingAttachmentId(null);
    }
  };

  const normalizeNotifText = (value?: string) => (value || '').toLowerCase();
  const normalizeForMatch = (value?: string) =>
    normalizeNotifText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  type ParentNotifCategory = 'notes' | 'homework' | 'absences' | 'info' | 'other';

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
    if (notifType === 'absence') return 'absences';
    if (notifType === 'info') return 'info';

    return 'other';
  };

  const parentNotificationsByCategory = useMemo(() => {
    const seenIds = new Set<number>();
    const notes: SystemNotification[] = [];
    const homework: SystemNotification[] = [];
    const absences: SystemNotification[] = [];
    const info: SystemNotification[] = [];

    for (const notif of notificationsList) {
      if (seenIds.has(notif.id)) continue;
      const category = classifyParentNotification(notif);
      if (category === 'notes') {
        notes.push(notif);
        seenIds.add(notif.id);
      } else if (category === 'homework') {
        homework.push(notif);
        seenIds.add(notif.id);
      } else if (category === 'absences') {
        absences.push(notif);
        seenIds.add(notif.id);
      } else if (category === 'info') {
        info.push(notif);
        seenIds.add(notif.id);
      }
    }

    return { notes, homework, absences, info };
  }, [notificationsList]);

  const parentNotesNotifications = parentNotificationsByCategory.notes;
  const parentUpcomingHomeworkNotifications = parentNotificationsByCategory.homework;
  const parentAbsencesNotifications = parentNotificationsByCategory.absences;
  const parentInfoNotifications = parentNotificationsByCategory.info;
  const parentTabNotifications = parentActiveTab === 'notes'
    ? parentNotesNotifications
    : parentActiveTab === 'homework'
      ? parentUpcomingHomeworkNotifications
      : parentActiveTab === 'absences'
        ? parentAbsencesNotifications
        : parentInfoNotifications;

  const renderNotificationCard = (notif: SystemNotification) => {
    const themeColor =
      notif.type === 'absence' ? { bg: 'bg-rose-50 border-rose-100 text-rose-700', bullet: 'bg-rose-500' } :
      notif.type === 'grade' ? { bg: 'bg-amber-50 border-amber-100 text-amber-700', bullet: 'bg-amber-500' } :
      { bg: 'bg-indigo-50 border-indigo-100 text-indigo-700', bullet: 'bg-indigo-500' };
    const publishedAtLabel = getPublicationLabel(notif.createdAt);

    return (
      <div
        key={notif.id}
        role="button"
        onClick={async () => {
          try {
            if (!notif.isRead) {
              await apiFetch(`/api/notifications/${notif.id}/read`, { method: 'PUT' });
              if (onNotificationRead) onNotificationRead();
            }
          } catch (e) {
            // best-effort: swallow errors to avoid breaking UI
            console.warn('Failed to mark notification read', e);
          }
        }}
        className={`p-4 rounded-xl border flex gap-3 transition-colors cursor-pointer ${
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
          {notif.attachments && notif.attachments.length > 0 && (
            <div className="pt-1 space-y-1">
              {notif.attachments.map((attachment) => (
                <button
                  type="button"
                  key={attachment.id}
                  className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-indigo-700 underline underline-offset-2 disabled:cursor-wait disabled:opacity-60"
                  disabled={downloadingAttachmentId === attachment.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleAttachmentDownload(notif.id, attachment.id, attachment.fileName);
                  }}
                >
                  <Mail className="h-3 w-3" />
                  {downloadingAttachmentId === attachment.id ? 'Téléchargement...' : attachment.fileName}
                </button>
              ))}
            </div>
          )}
          {attachmentError && (
            <p role="alert" className="pt-1 text-[10px] font-semibold text-rose-600">{attachmentError}</p>
          )}
          <div className="pt-1 flex flex-col gap-1 text-[10px] text-slate-400">
            {publishedAtLabel && (
              <span className="text-slate-500">{publishedAtLabel}</span>
            )}
            <div className="flex items-center justify-between">
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
                      {parentNotesNotifications.filter((n) => !n.isRead).length}
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
                      {parentUpcomingHomeworkNotifications.filter((n) => !n.isRead).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setParentActiveTab('absences')}
                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                      parentActiveTab === 'absences'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800 hover:bg-white/70'
                    }`}
                  >
                    Absences
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${parentActiveTab === 'absences' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                      {parentAbsencesNotifications.filter((n) => !n.isRead).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setParentActiveTab('info')}
                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                      parentActiveTab === 'info'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800 hover:bg-white/70'
                    }`}
                  >
                    Informations
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${parentActiveTab === 'info' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                      {parentInfoNotifications.filter((n) => !n.isRead).length}
                    </span>
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                      {parentActiveTab === 'notes'
                        ? 'Notes'
                        : parentActiveTab === 'homework'
                          ? 'Devoirs à venir'
                          : parentActiveTab === 'absences'
                            ? 'Absences'
                            : 'Informations'}
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
                        : parentActiveTab === 'homework'
                          ? 'Aucune notification de devoir à venir.'
                          : parentActiveTab === 'absences'
                            ? 'Aucune notification d’absence.'
                            : 'Aucune information disponible.'}
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
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Destinataires</label>
                  <div className="space-y-2">
                    {([
                      ['all', 'Tous les parents'],
                      ['class', 'Par classe'],
                      ['individual', 'Individuellement'],
                    ] as const).map(([mode, label]) => (
                      <label key={mode} className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 cursor-pointer">
                        <input
                          type="radio"
                          name="notification-recipient-mode"
                          value={mode}
                          checked={notifForm.recipientMode === mode}
                          onChange={() => {
                            setNotifForm({ ...notifForm, recipientMode: mode, userId: '', classId: '' });
                            setParentSearchQuery('');
                            setParentSearchResults([]);
                            setSelectedParent(null);
                          }}
                          className="accent-indigo-600"
                        />
                        {label}
                      </label>
                    ))}
                  </div>

                  {notifForm.recipientMode === 'class' && (
                    <>
                      <select
                        aria-label="Classe destinataire"
                        value={notifForm.classId}
                        onChange={(e) => setNotifForm({ ...notifForm, classId: e.target.value })}
                        className="mt-3 w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
                        required
                      >
                        <option value="">Sélectionner une classe</option>
                        {classesList.map((klass) => (
                          <option key={klass.id} value={klass.id}>{klass.name}</option>
                        ))}
                      </select>
                      {notifForm.classId && <p className="mt-2 text-xs font-semibold text-indigo-700">Parents concernés : {selectedClassParentCount}</p>}
                    </>
                  )}

                  {notifForm.recipientMode === 'individual' && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="search"
                          aria-label="Rechercher un parent"
                          placeholder="Rechercher un parent..."
                          value={parentSearchQuery}
                          onChange={(event) => setParentSearchQuery(event.target.value)}
                          className="min-w-0 flex-1 px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
                        />
                        {parentSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setParentSearchQuery('')}
                            className="px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl"
                          >
                            Effacer
                          </button>
                        )}
                      </div>

                      {isParentSearchLoading && <p className="text-xs text-slate-400">Recherche en cours...</p>}
                      {!isParentSearchLoading && parentSearchQuery.trim().length >= 2 && parentSearchResults.length === 0 && (
                        <p className="text-xs text-slate-500">Aucun parent trouvé</p>
                      )}
                      {parentSearchResults.length > 0 && (
                        <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                          {parentSearchResults.map((parent) => {
                            const studentLabel = parentStudentLabel(parent);
                            return (
                              <button
                                type="button"
                                key={`${parent.id}-${parent.userId}`}
                                onClick={() => {
                                  setSelectedParent(parent);
                                  setNotifForm((previous) => ({ ...previous, userId: String(parent.userId) }));
                                }}
                                className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-indigo-50"
                              >
                                <span className="block font-bold">{parentLabel(parent)}</span>
                                {studentLabel && <span className="block text-[10px] text-slate-400">Élève : {studentLabel}</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {selectedParent && (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                          <span><strong>Parent choisi :</strong> {parentLabel(selectedParent)}{parentStudentLabel(selectedParent) ? `, élève : ${parentStudentLabel(selectedParent)}` : ''}</span>
                          <button type="button" onClick={() => { setSelectedParent(null); setNotifForm((previous) => ({ ...previous, userId: '' })); }} className="shrink-0 font-bold text-indigo-700">Changer</button>
                        </div>
                      )}
                    </div>
                  )}
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

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Pièces jointes (PDF, JPG, PNG)
                  </label>
                  <input
                    type="file"
                    multiple
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={handleFileSelection}
                    className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-indigo-700 file:font-bold"
                  />
                  {attachedFiles.length > 0 && (
                    <div className="mt-2 space-y-1.5 text-[10px] text-slate-500">
                      {attachedFiles.map((file, index) => (
                        <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                          <span className="truncate">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => removeAttachedFile(index)}
                            className="text-[10px] font-bold text-rose-600 hover:text-rose-700"
                          >
                            Retirer
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSending || (notifForm.recipientMode === 'individual' && !selectedParent)}
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
