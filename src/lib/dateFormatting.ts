export const formatPublicationDateTime = (value?: string | null): string | null => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

export const getPublicationLabel = (value?: string | null): string | null => {
  const formatted = formatPublicationDateTime(value);
  return formatted ? `Publié le ${formatted}` : null;
};
