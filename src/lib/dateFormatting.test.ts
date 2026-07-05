import { describe, expect, it } from 'vitest';
import { formatPublicationDateTime, getPublicationLabel } from './dateFormatting';

describe('date formatting helpers', () => {
  it('formats published dates in French locale', () => {
    const formatted = formatPublicationDateTime('2026-07-05T14:30:00.000Z');

    expect(formatted).toContain('05/07/2026');
    expect(formatted).toContain('14:30');
  });

  it('returns a publication label when a timestamp exists', () => {
    expect(getPublicationLabel('2026-07-05T14:30:00.000Z')).toContain('Publié le');
  });

  it('returns null for missing or invalid timestamps', () => {
    expect(formatPublicationDateTime(undefined)).toBeNull();
    expect(formatPublicationDateTime('invalid-date')).toBeNull();
    expect(getPublicationLabel('')).toBeNull();
  });
});
