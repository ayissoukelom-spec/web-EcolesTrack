import React, { useState } from 'react';
import type { User } from '../types.ts';
import { apiFetch } from '../lib/api.ts';
import RequiredLabel from './RequiredLabel';
import togoFlag from '../assets/flags/togo_drap.jpg';

interface Props {
  user: User;
  onSuccess: () => void;
}

export default function ChangePasswordView({ user, onSuccess }: Props) {
  const simulatedUser = user;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <img
        src={togoFlag}
        alt="Drapeau du Togo"
        className="absolute top-6 left-6 w-20 md:w-24 lg:w-28 h-auto object-contain"
      />
      <form onSubmit={submit} className="bg-slate-900 text-slate-100 p-6 rounded-xl shadow-2xl w-full max-w-sm border border-slate-800">
        <h2 className="text-xl font-semibold mb-4">Changer le mot de passe</h2>
        <p className="text-sm text-slate-400 mb-4">
          Vous devez remplacer le mot de passe par défaut avant de continuer.
        </p>
        {error && <div className="text-rose-400 mb-3">{error}</div>}
        <label className="block text-sm mb-4">
          <RequiredLabel label="Mot de passe actuel" required />
          <div className="relative mt-1">
            <input
              className="w-full pr-10 p-2 border border-slate-700 rounded bg-slate-800 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              type={showCurrentPassword ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            <button
              type="button"
              aria-label={showCurrentPassword ? 'Masquer le mot de passe actuel' : 'Afficher le mot de passe actuel'}
              onClick={() => setShowCurrentPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer"
            >
              {showCurrentPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C7 20 2.73 16.11 1 12c.5-1.1 1.17-2.14 2-3.07" />
                  <path d="M9.88 9.88A3 3 0 0 0 14.12 14.12" />
                  <path d="M3 3l18 18" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>
        <label className="block text-sm mb-4">
          <RequiredLabel label="Nouveau mot de passe" required />
          <div className="relative mt-1">
            <input
              className="w-full pr-10 p-2 border border-slate-700 rounded bg-slate-800 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              type={showNewPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <button
              type="button"
              aria-label={showNewPassword ? 'Masquer le nouveau mot de passe' : 'Afficher le nouveau mot de passe'}
              onClick={() => setShowNewPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer"
            >
              {showNewPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C7 20 2.73 16.11 1 12c.5-1.1 1.17-2.14 2-3.07" />
                  <path d="M9.88 9.88A3 3 0 0 0 14.12 14.12" />
                  <path d="M3 3l18 18" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>
        <label className="block text-sm mb-4">
          <RequiredLabel label="Confirmer le nouveau mot de passe" required />
          <div className="relative mt-1">
            <input
              className="w-full pr-10 p-2 border border-slate-700 rounded bg-slate-800 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <button
              type="button"
              aria-label={showConfirmPassword ? 'Masquer la confirmation du mot de passe' : 'Afficher la confirmation du mot de passe'}
              onClick={() => setShowConfirmPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer"
            >
              {showConfirmPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C7 20 2.73 16.11 1 12c.5-1.1 1.17-2.14 2-3.07" />
                  <path d="M9.88 9.88A3 3 0 0 0 14.12 14.12" />
                  <path d="M3 3l18 18" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
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
