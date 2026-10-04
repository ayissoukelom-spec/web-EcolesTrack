type ParentSearchable = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
};

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

const phoneSearchVariants = (digits: string): string[] => (
  digits.startsWith('228') && digits.length > 3
    ? [digits, digits.slice(3)]
    : [digits]
);

export const matchesParentSearch = (parent: ParentSearchable, query: string): boolean => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  const normalizedName = [
    parent.name,
    parent.firstName,
    parent.lastName,
    [parent.firstName, parent.lastName].filter(Boolean).join(' '),
    [parent.lastName, parent.firstName].filter(Boolean).join(' '),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));

  if (normalizedName) return true;

  const queryDigits = digitsOnly(normalizedQuery);
  const phoneDigits = digitsOnly(parent.phone ?? '');
  if (!queryDigits || !phoneDigits) return false;

  const queryVariants = phoneSearchVariants(queryDigits);
  const parentPhoneVariants = phoneSearchVariants(phoneDigits);
  return parentPhoneVariants.some((phone) => queryVariants.some((term) => phone.includes(term)));
};
