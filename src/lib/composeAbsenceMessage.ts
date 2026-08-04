export interface ComposeAbsenceParams {
  firstName: string;
  date: string; // ISO date or YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  subjectName?: string | undefined;
  derivedPeriod?: string | undefined;
}

const formatDateSafe = (dateStr: string) => {
  if (!dateStr) return '';
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  if (String(dateStr).includes('T')) return new Date(dateStr).toLocaleDateString('fr-FR', opts);
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    const y = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    const d = Number(parts[2]);
    return new Date(y, m, d).toLocaleDateString('fr-FR', opts);
  }
  return new Date(dateStr).toLocaleDateString('fr-FR', opts);
};

export function composeAbsenceMessage(params: ComposeAbsenceParams) {
  const { firstName, date, startTime, endTime, subjectName, derivedPeriod } = params;
  const formattedDate = formatDateSafe(date);
  const timeRange = startTime && endTime ? ` de ${startTime} à ${endTime}` : '';
  const subjectText = subjectName ? `, en ${subjectName}` : '';
  const humanizedPeriod = derivedPeriod === 'morning' ? 'Matin' : derivedPeriod === 'afternoon' ? 'Après‑midi' : derivedPeriod === 'all_day' ? 'Toute la journée' : derivedPeriod;
  const periodFallback = !timeRange && !subjectText ? (derivedPeriod ? ` (${humanizedPeriod})` : '') : '';
  return `Une absence a été signalée pour ${firstName} le ${formattedDate}${timeRange}${subjectText}${periodFallback}. Veuillez fournir un justificatif.`;
}

export default composeAbsenceMessage;
