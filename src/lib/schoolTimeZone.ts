export const DEFAULT_SCHOOL_TIME_ZONE = 'Africa/Lome';

export const isValidIanaTimeZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

export const getIanaTimeZoneOptions = (currentTimeZone?: string | null): string[] => {
  const supportedTimeZones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [];
  return [...new Set([
    DEFAULT_SCHOOL_TIME_ZONE,
    ...supportedTimeZones,
    ...(isValidIanaTimeZone(currentTimeZone) ? [currentTimeZone] : []),
  ])];
};
