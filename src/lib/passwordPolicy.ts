export function getNewPasswordPolicyError(password: string): string | null {
  const missingRules: string[] = [];
  if ([...password].length < 8) missingRules.push('au moins 8 caractères');
  if (!/[A-Z]/.test(password)) missingRules.push('au moins une lettre majuscule');
  if (!/[0-9]/.test(password)) missingRules.push('au moins un chiffre');

  if (missingRules.length === 0) return null;

  const requirements = missingRules.length === 1
    ? missingRules[0]
    : `${missingRules.slice(0, -1).join(', ')} et ${missingRules[missingRules.length - 1]}`;
  return `Le nouveau mot de passe doit contenir ${requirements}.`;
}