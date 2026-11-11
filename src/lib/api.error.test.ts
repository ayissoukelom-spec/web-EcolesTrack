import { describe, expect, it } from 'vitest';
import { getUiErrorMessage } from './api.ts';

describe('UI error handling', () => {
  it('supprime l’alerte système pour le message de token manquant', () => {
    expect(getUiErrorMessage('Unauthorized: Missing token')).toBeNull();
  });

  it('conserve les autres messages dans l’alerte système', () => {
    expect(getUiErrorMessage('Impossible de charger les données')).toBe('Impossible de charger les données');
  });

  it('ne montre pas une réponse 401 devenue obsolète après un changement de session', () => {
    const staleResponse = Object.assign(
      new Error('La réponse d’authentification concerne une session précédente.'),
      { code: 'STALE_AUTH_RESPONSE' },
    );

    expect(getUiErrorMessage(staleResponse, 'fallback')).toBeNull();
  });
});
