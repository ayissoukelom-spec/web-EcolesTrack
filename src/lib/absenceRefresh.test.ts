import { describe, expect, it } from 'vitest';
import { createAbsenceRefreshSequence } from './absenceRefresh';

describe('absence refresh sequence', () => {
  it('prevents an older request response from replacing the latest response', () => {
    const sequence = createAbsenceRefreshSequence();
    let displayedAbsences: { id: number; studentName: string }[] = [];
    const olderRequest = sequence.begin();
    const newerRequest = sequence.begin();
    const applyResponse = (requestId: number, response: { id: number; studentName: string }[]) => {
      if (!sequence.isLatest(requestId)) return;
      displayedAbsences = response;
    };

    applyResponse(newerRequest, [{ id: 3, studentName: 'Latest absence' }]);
    applyResponse(olderRequest, [{ id: 2, studentName: 'Stale absence' }]);

    expect(displayedAbsences).toEqual([{ id: 3, studentName: 'Latest absence' }]);
  });
});
