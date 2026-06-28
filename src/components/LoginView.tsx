import React, { useState } from 'react';
import { apiFetch, setSimulatedRole, setSimulatedUser } from '../lib/api.ts';
import RequiredLabel from './RequiredLabel';

interface Props {
  onLogin: (role: string) => void;
}

export default function LoginView({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/local-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Échec de la connexion');
      }

      const user = await response.json();
      // Persist simulation state locally so apiFetch will include headers
      setSimulatedRole(user.role || 'parent');
      setSimulatedUser({ uid: user.uid || `local_${Date.now()}`, email: user.email, name: user.name, schoolId: user.schoolId ?? user.school?.id });
      // Update URL to reflect login
      window.history.pushState(null, '', '/');
      onLogin(user.role || 'parent');
    } catch (err: any) {
      setError(err?.message || 'Échec de la connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="bg-white p-6 rounded shadow w-full max-w-sm">
        <h2 className="text-lg font-bold mb-4">Se connecter</h2>
        {error && <div className="text-rose-600 mb-2">{error}</div>}
        <label className="block text-sm mb-2">
          <RequiredLabel label="Email" required />
          <input className="w-full mt-1 p-2 border rounded" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label className="block text-sm mb-4">
          <RequiredLabel label="Mot de passe" required />
          <input className="w-full mt-1 p-2 border rounded" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </label>
        <button type="submit" disabled={loading} className="w-full px-4 py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
