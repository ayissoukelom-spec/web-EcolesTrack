export const normalizeClassProgressionCode = (value: string | null | undefined): string => {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-');

  return normalized.replace(/^-+|-+$/g, '');
};
