import { useState } from 'react';
import type { UserRole } from '../types';

interface Props {
  onLogin: (role: UserRole, schoolId: string) => void;
}

const roles: UserRole[] = ['parent', 'teacher', 'school_admin', 'super_admin'];

export default function LoginScreen({ onLogin }: Props) {
  const [role, setRole] = useState<UserRole>('parent');
  const [schoolId, setSchoolId] = useState('1');

  return (
    <div className="card">
      <h2>Connexion mobile</h2>
      <div className="field-row">
        <label>Rôle</label>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          {roles.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label>École</label>
        <input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} />
      </div>
      <button type="button" onClick={() => onLogin(role, schoolId)}>Se connecter</button>
    </div>
  );
}
