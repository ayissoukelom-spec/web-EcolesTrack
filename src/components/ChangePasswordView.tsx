import React, { useState } from 'react';
import type { User } from '../types.ts';
import { apiFetch } from '../lib/api.ts';
import RequiredLabel from './RequiredLabel';

interface Props {
  user: User;
  onSuccess: () => void;
}

export default function ChangePasswordView({ user, onSuccess }: Props) {
  const simulatedUser = user;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!simulatedUser?.email) {
      setError('Impossible de récupérer l’adresse e-mail de l’utilisateur.');
      return;
    }

    if (!currentPassword.trim()) {
      setError('Le mot de passe actuel est requis.');
      return;
    }

    if (!newPassword.trim()) {
      setError('Le nouveau mot de passe est requis.');
      return;
    }

    if (newPassword === '123456') {
      setError('Le mot de passe ne peut pas être le mot de passe par défaut');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Le nouveau mot de passe et sa confirmation doivent être identiques.');
      return;
    }

    try {
      setLoading(true);
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          email: simulatedUser.email,
          currentPassword,
          newPassword,
        }),
      });
      console.log('DEBUG change-password success');
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Impossible de changer le mot de passe.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="bg-white p-6 rounded shadow w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4">Changer le mot de passe</h2>
        <p className="text-sm text-slate-600 mb-4">
          Vous devez remplacer le mot de passe par défaut avant de continuer.
        </p>
        {error && <div className="text-rose-600 mb-3">{error}</div>}
        <label className="block text-sm mb-4">
          <RequiredLabel label="Mot de passe actuel" required />
          <input
            className="w-full mt-1 p-2 border rounded"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm mb-4">
          <RequiredLabel label="Nouveau mot de passe" required />
          <input
            className="w-full mt-1 p-2 border rounded"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm mb-4">
          <RequiredLabel label="Confirmer le nouveau mot de passe" required />
          <input
            className="w-full mt-1 p-2 border rounded"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Enregistrement...' : 'Mettre à jour le mot de passe'}
        </button>
      </form>
    </div>
  );
}
