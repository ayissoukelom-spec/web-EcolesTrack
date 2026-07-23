import React, { useEffect, useState } from 'react';
import { apiFetch, setActiveSchoolId, setSimulatedRole, setSimulatedUser, getSessionExpiredMessage, clearSessionExpiredMessage } from '../lib/api.ts';
import ChangePasswordView from './ChangePasswordView';
import RequiredLabel from './RequiredLabel';
import logoImage from '../assets/logo.png';
import togoFlag from '../assets/flags/togo_drap.jpg';

const ACCESS_TOKEN_STORAGE_KEY = 'ecoletrack_jwt_access';

interface Props {
  onLogin: (role: string) => void;
}

function persistAccessToken(token: unknown) {
  if (typeof token === 'string' && token.trim()) {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    return;
  }
  localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
}

export default function LoginView({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [schools, setSchools] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | ''>('');
  const [loggedInUser, setLoggedInUser] = useState<any | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [selectionPending, setSelectionPending] = useState(false);
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);

  useEffect(() => {
    const message = getSessionExpiredMessage();
    if (message) {
      setSessionExpiredMessage(message);
      clearSessionExpiredMessage();
    }
  }, []);

  const loadSchools = async () => {
    setSchoolsLoading(true);
    try {
      const data = await apiFetch('/api/auth/schools');
      setSchools(data.schools || []);
      if (data.activeSchoolId != null) {
        setSelectedSchoolId(data.activeSchoolId);
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
      persistAccessToken(user.token);

      if (user.mustReset) {
        setShowChangePassword(true);
        setLoading(false);
        return;
      }

      // Persist simulation state locally so apiFetch will include headers
      setSimulatedRole(user.role || 'parent');
      // Reset any previously selected school before membership sync
      setActiveSchoolId(null);
      setSimulatedUser({ id: user.id, uid: user.uid || `local_${Date.now()}`, email: user.email, name: user.name });

      await apiFetch('/api/auth/register-or-login', { method: 'POST' });

      if (user.role === 'super_admin') {
        window.history.pushState(null, '', '/');
        onLogin(user.role || 'parent');
        return;
      }

      const schoolData = await loadSchools();

      if (Array.isArray(schoolData.schools) && schoolData.schools.length > 1) {
        setSelectionPending(true);
        return;
      }

      const activeSchoolId = Number(schoolData.activeSchoolId ?? schoolData.schools?.[0]?.id ?? null);
      if (Number.isFinite(activeSchoolId)) {
        setActiveSchoolId(activeSchoolId);
        setSimulatedUser({
          id: user.id,
          uid: user.uid || `local_${Date.now()}`,
          email: user.email,
          name: user.name,
          schoolId: activeSchoolId,
        });
        window.history.pushState(null, '', '/');
        onLogin(user.role || 'parent');
        return;
      }

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
      const result = await apiFetch('/api/auth/schools/active', {
        method: 'POST',
        body: JSON.stringify({ schoolId: Number(selectedSchoolId) }),
      });

      if (result?.token) {
        persistAccessToken(result.token);
      }

      const activeSchoolId = Number(result?.schoolId ?? selectedSchoolId);
      setActiveSchoolId(activeSchoolId);
      setSimulatedUser({
        id: loggedInUser?.id,
        uid: loggedInUser?.uid || `local_${Date.now()}`,
        email: loggedInUser?.email,
        name: loggedInUser?.name,
        schoolId: activeSchoolId,
      });

      window.history.pushState(null, '', '/');
      onLogin(loggedInUser?.role || 'parent');
    } catch (err: any) {
      setError(err?.message || 'Impossible de sélectionner l’école.');
    } finally {
      setLoading(false);
    }
  };

  const finishLoginAfterPasswordChange = async (user: any) => {
    // called after ChangePasswordView.onSuccess
    try {
      setSimulatedRole(user.role || 'parent');
      setActiveSchoolId(null);
      setSimulatedUser({ id: user.id, uid: user.uid || `local_${Date.now()}`, email: user.email, name: user.name });
      await apiFetch('/api/auth/register-or-login', { method: 'POST' });
      if (user.role === 'super_admin') {
        window.history.pushState(null, '', '/');
        onLogin(user.role || 'parent');
        return;
      }
      await loadSchools();
      setSelectionPending(true);
    } catch (e) {
      setError('Erreur après mise à jour du mot de passe');
    }
  };

  if (selectionPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="bg-slate-900 text-slate-100 p-6 rounded-xl shadow-2xl w-full max-w-sm border border-slate-800">
          <h2 className="text-lg font-bold mb-2">Choisir votre école</h2>
          <p className="text-sm text-slate-400 mb-4">Sélectionnez l’école à utiliser pour cette session.</p>
          {sessionExpiredMessage && <div className="text-amber-300 mb-2">{sessionExpiredMessage}</div>}
          {error && <div className="text-rose-400 mb-2">{error}</div>}
          {schoolsLoading ? (
            <div className="text-sm text-slate-400">Chargement des écoles...</div>
          ) : schools.length === 0 ? (
            <div className="text-sm text-slate-400">Aucune école n’est encore disponible pour ce compte.</div>
          ) : (
            <>
              <label className="block text-sm mb-2">
                <RequiredLabel label="École" required />
                <select
                  className="w-full mt-1 p-2 border border-slate-700 rounded bg-slate-800 text-slate-100"
                  value={selectedSchoolId}
                  onChange={(e) => setSelectedSchoolId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">-- Choisissez une école --</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={loading || schoolsLoading}
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
    <>
      {showChangePassword && loggedInUser ? (
        <ChangePasswordView user={loggedInUser} onSuccess={() => finishLoginAfterPasswordChange(loggedInUser)} />
      ) : (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
          <img
            src={togoFlag}
            alt="Drapeau du Togo"
            className="absolute top-6 left-6 w-24 md:w-28 lg:w-32 h-auto object-contain rounded-md shadow-md z-10"
          />
          <form onSubmit={submit} className="bg-slate-900 text-slate-100 p-6 rounded-xl shadow-2xl w-full max-w-sm border border-slate-800">
            <div className="flex justify-center mb-6">
          <img src={logoImage} alt="ET Ecoles Track" className="w-24 h-24 object-contain" />
        </div>
        <h2 className="text-lg font-bold mb-4 text-center">Se connecter</h2>
        {sessionExpiredMessage && <div className="text-amber-300 mb-2">{sessionExpiredMessage}</div>}
        {error && <div className="text-rose-400 mb-2">{error}</div>}
        <label className="block text-sm mb-2">
          <RequiredLabel label="Email" required />
          <input className="w-full mt-1 p-2 border border-slate-700 rounded bg-slate-800 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label className="block text-sm mb-4">
          <RequiredLabel label="Mot de passe" required />
          <div className="relative mt-1">
            <input
              className="w-full pr-10 p-2 border border-slate-700 rounded bg-slate-800 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              required
            />
            <button
              type="button"
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              onClick={() => setShowPassword((current) => !current)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-100"
            >
              {showPassword ? (
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
        <button type="submit" disabled={loading} className="w-full px-4 py-2 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
    )}
    </>
  );
}
