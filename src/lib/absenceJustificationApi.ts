import { apiFetch } from './api.ts';

export async function reexamineAbsenceJustification(absenceId: number): Promise<void> {
  await apiFetch(`/api/absences/${absenceId}/justification/reexamine`, {
    method: 'PUT',
    body: JSON.stringify({}),
  });
}
