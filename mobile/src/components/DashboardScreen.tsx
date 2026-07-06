import type { UserRole } from '../types';

interface Props {
  role: UserRole;
  schoolId: string;
  classId: string;
  notifications: string[];
  onClassIdChange: (classId: string) => void;
  onOpenNotes: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}

export default function DashboardScreen({
  role,
  schoolId,
  classId,
  notifications,
  onClassIdChange,
  onOpenNotes,
  onRefresh,
  onLogout,
}: Props) {
  return (
    <div className="card">
      <div className="dashboard-header">
        <div>
          <h2>Dashboard mobile</h2>
          <p>{role} - école {schoolId}</p>
        </div>
        <button className="secondary" type="button" onClick={onLogout}>Déconnexion</button>
      </div>

      <div className="field-row">
        <label>Classe</label>
        <select value={classId} onChange={(event) => onClassIdChange(event.target.value)}>
          <option value="1">Classe 1</option>
          <option value="2">Classe 2</option>
          <option value="3">Classe 3</option>
        </select>
      </div>

      <div className="action-row">
        <button type="button" onClick={onRefresh}>Rafraîchir</button>
        <button type="button" onClick={onOpenNotes}>Voir les notes</button>
      </div>

      <div className="section">
        <h3>Notifications</h3>
        {notifications.length === 0 ? (
          <div className="empty-state">Aucune notification</div>
        ) : (
          <div className="notification-list">
            {notifications.map((message, idx) => (
              <div key={idx} className="notification-card">{message}</div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h3>Accès rapide</h3>
        <div className="grid-row">
          <button type="button" disabled>Devoirs</button>
          <button type="button" disabled>Absences</button>
        </div>
        <p className="hint">Fonctionnalités supplémentaires à intégrer.</p>
      </div>
    </div>
  );
}
