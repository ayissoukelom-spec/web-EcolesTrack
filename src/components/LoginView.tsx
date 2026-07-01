import React, { useState } from 'react';
import { apiFetch, setActiveSchoolId, setSimulatedRole, setSimulatedUser } from '../lib/api.ts';
import RequiredLabel from './RequiredLabel';

interface Props {
  onLogin: (role: string) => void;
}

export default function LoginView({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [schools, setSchools] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | ''>('');
  const [loggedInUser, setLoggedInUser] = useState<any | null>(null);
  const [selectionPending, setSelectionPending] = useState(false);
  const [schoolsLoading, setSchoolsLoading] = useState(false);

  const loadSchools = async () => {
    setSchoolsLoading(true);
    try {
      const data = await apiFetch('/api/auth/schools');
      setSchools(data.schools || []);
      if (data.activeSchoolId != null) {
        setSelectedSchoolId(data.activeSchoolId);
      } else if ((data.schools || []).length > 0) {
        setSelectedSchoolId(data.schools[0].id);
      } else {
        setSelectedSchoolId('');
      }
      return data;
    } finally {
      setSchoolsLoading(false);
    }
  };

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
      setLoggedInUser(user);
      // Persist simulation state locally so apiFetch will include headers
      setSimulatedRole(user.role || 'parent');
      // DO NOT include schoolId in simulatedUser yet - it needs to be fetched from user_schools first
      // to avoid requesting with an invalid school in headers
      setSimulatedUser({ uid: user.uid || `local_${Date.now()}`, email: user.email, name: user.name });

      if (user.role === 'super_admin') {
        window.history.pushState(null, '', '/');
        onLogin(user.role || 'parent');
        return;
      }

      await loadSchools();
      setSelectionPending(true);
    } catch (err: any) {
      setError(err?.message || 'Échec de la connexion');
    } finally {
      setLoading(false);
    }
  };

  const confirmSchoolSelection = async () => {
    if (!selectedSchoolId) {
      setError('Choisissez une école pour continuer.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await apiFetch('/api/auth/schools/active', {
        method: 'POST',
        body: JSON.stringify({ schoolId: Number(selectedSchoolId) }),
      });

      setActiveSchoolId(Number(selectedSchoolId));
      setSimulatedUser({
        uid: loggedInUser?.uid || `local_${Date.now()}`,
        email: loggedInUser?.email,
        name: loggedInUser?.name,
        schoolId: Number(selectedSchoolId),
      });

      window.history.pushState(null, '', '/');
      onLogin(loggedInUser?.role || 'parent');
    } catch (err: any) {
      setError(err?.message || 'Impossible de sélectionner l’école.');
    } finally {
      setLoading(false);
    }
  };

  if (selectionPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white p-6 rounded shadow w-full max-w-sm">
          <h2 className="text-lg font-bold mb-2">Choisir votre école</h2>
          <p className="text-sm text-slate-600 mb-4">Sélectionnez l’école à utiliser pour cette session.</p>
          {error && <div className="text-rose-600 mb-2">{error}</div>}
          {schools.length === 0 ? (
            <div className="text-sm text-slate-600">Aucune école n’est encore disponible pour ce compte.</div>
          ) : (
            <>
              <label className="block text-sm mb-2">
                <RequiredLabel label="École" required />
                <select
                  className="w-full mt-1 p-2 border rounded"
                  value={selectedSchoolId}
                  onChange={(e) => setSelectedSchoolId(Number(e.target.value))}
                >
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={confirmSchoolSelection}
                className="w-full px-4 py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Validation...' : 'Continuer'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

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
