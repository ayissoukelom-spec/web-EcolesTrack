export const normalizeParentLoginPhone = (value: string, phoneCountryCode?: string): string[] => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return [];
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith('+')) return [digits];
  if (trimmedValue.startsWith('00')) return [digits.slice(2)];

  let countryCodeDigits = String(phoneCountryCode ?? '').replace(/\D/g, '');
  if (countryCodeDigits.startsWith('00')) countryCodeDigits = countryCodeDigits.slice(2);
  if (countryCodeDigits) {
    if (digits.startsWith(countryCodeDigits) && digits.length > countryCodeDigits.length + 7) {
      return [digits];
    }
    return [`${countryCodeDigits}${digits}`];
  }

  return /^228\d{8}$/.test(digits) ? [digits] : [];
};

export const canonicalizeUserPhone = (value: unknown, phoneCountryCode?: string): string | null => {
  if (typeof value !== 'string') return null;
  const trimmedValue = value.trim();
  if (!/^(?:\+|00)?[\d\s()./-]+$/.test(trimmedValue)) return null;
  const normalizedDigits = normalizeParentLoginPhone(trimmedValue, phoneCountryCode)[0];
  return normalizedDigits && /^[1-9]\d{1,14}$/.test(normalizedDigits)
    ? `+${normalizedDigits}`
    : null;
};
