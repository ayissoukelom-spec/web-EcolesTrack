import { Request, Response, NextFunction } from 'express';

// Allow only Unicode letters and spaces. Reject if any digit is present.
const LETTERS_AND_SPACES_REGEX = /^[\p{L} ]+$/u;
const DIGITS_REGEX = /\d+/g;

export default function validateNames(req: Request, res: Response, next: NextFunction) {
  if (!req.body || typeof req.body !== 'object') return next();

  const checks: Array<{ field: string; value: any }> = [];
  if ('name' in req.body) checks.push({ field: 'name', value: req.body.name });
  if ('firstName' in req.body) checks.push({ field: 'firstName', value: req.body.firstName });
  if ('lastName' in req.body) checks.push({ field: 'lastName', value: req.body.lastName });

  for (const check of checks) {
    const v = check.value;
    if (v == null) continue;
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;

    const digits = trimmed.match(DIGITS_REGEX);
    if (digits && digits.length > 0) {
      const unique = Array.from(new Set(digits.join('').split(''))).slice(0, 10).join('');
      return res.status(400).json({
        error: `Le champ '${check.field}' contient des chiffres (${unique}). Seules les lettres (avec accents) et les espaces sont autorisés.`,
        field: check.field,
        foundDigits: unique,
      });
    }

    if (!LETTERS_AND_SPACES_REGEX.test(trimmed)) {
      return res.status(400).json({
        error: `Le champ '${check.field}' contient des caractères invalides. Seules les lettres (avec accents) et les espaces sont autorisés.`,
        field: check.field,
      });
    }
  }

  return next();
}
