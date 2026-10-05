const CLASS_DISPLAY_PREFIXES: Array<[RegExp, string]> = [
  [/^(?:6|5|4|3)\s*(?:ème|eme|e)(?=$|\s)(.*)$/i, ''],
  [/^2\s*(?:nde|nd)(?=$|\s)(.*)$/i, '2nde'],
  [/^2\s*(?:ème|eme|e)(?=$|\s)(.*)$/i, '2ème'],
  [/^1\s*(?:ère|ere)(?=$|\s)(.*)$/i, '1ère'],
  [/^(?:terminale|tle)(?=$|\s)(.*)$/i, 'Tle'],
];

export const normalizeClassNameForDisplay = (className: string): string => {
  const trimmedName = className.trim();
  if (!trimmedName) return className;

  for (const [pattern, canonicalPrefix] of CLASS_DISPLAY_PREFIXES) {
    const match = trimmedName.match(pattern);
    if (!match) continue;

    if (!canonicalPrefix) {
      const grade = trimmedName.match(/^([6543])/);
      if (!grade) return trimmedName;
      const ordinal = grade[1] === '3' ? '3ème' : `${grade[1]}ème`;
      const suffix = match[1].trim().replace(/\s+/g, ' ');
      return suffix ? `${ordinal} ${suffix}` : ordinal;
    }

    const suffix = match[1].trim().replace(/\s+/g, ' ');
    return suffix ? `${canonicalPrefix} ${suffix}` : canonicalPrefix;
  }

  return trimmedName;
};
