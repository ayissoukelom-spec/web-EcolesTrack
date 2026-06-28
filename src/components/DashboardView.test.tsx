import { describe, expect, it } from 'vitest';
import { normalizeDashboardChartData } from './DashboardView';

describe('normalizeDashboardChartData', () => {
  it('normalizes backend chart rows into the shape required by Recharts', () => {
    const input = [
      { name: '6ème', taux: 87.5 },
      { label: '5ème', value: 92.1 },
      { className: '4ème', attendanceRate: 88 },
    ];

    expect(normalizeDashboardChartData(input)).toEqual([
      { name: '6ème', taux: 87.5 },
      { name: '5ème', taux: 92.1 },
      { name: '4ème', taux: 88 },
    ]);
  });

  it('ignores invalid rows', () => {
    expect(normalizeDashboardChartData([{ name: 'A' }, null, { label: 'B' }, { name: 'C', taux: 120 }])).toEqual([
      { name: 'C', taux: 100 },
    ]);
  });
});
