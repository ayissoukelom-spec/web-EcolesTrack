import { Request, Response, NextFunction } from 'express';

// Allow Unicode letters, digits and common punctuation used in school/class names.
const NAME_CHARACTERS_REGEX = /^[\p{L}\p{N} '’().&/\-]+$/u;

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

    if (!NAME_CHARACTERS_REGEX.test(trimmed)) {
      return res.status(400).json({
        error: `Le champ '${check.field}' contient des caractères invalides. Seules les lettres, les chiffres et les espaces sont autorisés.`,
        field: check.field,
      });
    }
  }

  return next();
}
