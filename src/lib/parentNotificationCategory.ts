import type { SystemNotification } from '../types.ts';

export type ParentNotificationCategory = 'notes' | 'homework' | 'absences' | 'info' | 'other';

const normalizeForMatch = (value?: string) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export function classifyParentNotification(notif: SystemNotification): ParentNotificationCategory {
  const notifType = normalizeForMatch(notif.type);
  const title = normalizeForMatch(notif.title);
  const isHomeworkByType = ['assignment', 'homework', 'devoir'].includes(notifType);
  const isScheduledGroupedEvaluation =
    /^nouveau programme\b/.test(title)
    && /\b(devoirs?|compositions?|examens?)\b/.test(title);
  const isHomeworkByTitle = /\b(devoirs?|assignment|homework)\b/.test(title);

  if (isHomeworkByType || isScheduledGroupedEvaluation || isHomeworkByTitle) return 'homework';
  if (notifType === 'grade') return 'notes';
  if (notifType === 'absence') return 'absences';
  if (notifType === 'info') return 'info';

  return 'other';
}
