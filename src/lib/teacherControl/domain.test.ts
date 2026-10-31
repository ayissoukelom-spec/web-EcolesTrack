import { describe, expect, it } from 'vitest';
import {
  calculateTeacherControlCompensation,
  MAX_GPS_ACCURACY_METERS,
  TEACHER_CONTROL_DISPLAY_TIME_ZONE,
  validateTeacherControlGpsFix,
} from './domain.ts';

describe('teacher control GPS and compensation rules', () => {
  it('uses the approved school-local display timezone', () => {
    expect(TEACHER_CONTROL_DISPLAY_TIME_ZONE).toBe('Africa/Lome');
  });

  it('accepts a GPS fix at the accuracy threshold and within the configured geofence', () => {
    const result = validateTeacherControlGpsFix(
      { latitude: 0, longitude: 0.001, accuracyMeters: MAX_GPS_ACCURACY_METERS },
      { latitude: 0, longitude: 0, geofenceRadiusMeters: 200 },
    );

    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.distanceMeters).toBeGreaterThan(100);
      expect(result.distanceMeters).toBeLessThanOrEqual(200);
      expect(result.accuracyMeters).toBe(100);
    }
  });

  it('rejects accuracy above 100 m without expanding the school geofence', () => {
    const result = validateTeacherControlGpsFix(
      { latitude: 0, longitude: 0, accuracyMeters: 100.01 },
      { latitude: 0, longitude: 0, geofenceRadiusMeters: 2_000 },
    );

    expect(result).toEqual({ accepted: false, reason: 'accuracy_too_low' });
  });

  it('rejects a valid-accuracy fix outside the school geofence', () => {
    const result = validateTeacherControlGpsFix(
      { latitude: 0, longitude: 0.003, accuracyMeters: 25 },
      { latitude: 0, longitude: 0, geofenceRadiusMeters: 200 },
    );

    expect(result).toEqual({ accepted: false, reason: 'outside_geofence' });
  });

  it('rejects invalid coordinates and non-positive geofence radii', () => {
    expect(validateTeacherControlGpsFix(
      { latitude: 91, longitude: 0, accuracyMeters: 10 },
      { latitude: 0, longitude: 0, geofenceRadiusMeters: 200 },
    )).toEqual({ accepted: false, reason: 'invalid_position' });
    expect(validateTeacherControlGpsFix(
      { latitude: 0, longitude: 0, accuracyMeters: 10 },
      { latitude: 0, longitude: 0, geofenceRadiusMeters: 0 },
    )).toEqual({ accepted: false, reason: 'invalid_geofence' });
  });

  it('calculates compensation only from a validated end and an optional hourly rate', () => {
    const startedAt = new Date('2026-10-31T07:00:00.000Z');
    const validatedEndedAt = new Date('2026-10-31T08:30:00.000Z');

    expect(calculateTeacherControlCompensation({
      startedAt,
      validatedEndedAt,
      hourlyRateXof: 1_000,
    })).toEqual({
      durationMilliseconds: 5_400_000,
      estimatedAmountXof: 1_500,
    });
    expect(calculateTeacherControlCompensation({
      startedAt,
      validatedEndedAt: null,
      hourlyRateXof: 1_000,
    })).toEqual({ durationMilliseconds: null, estimatedAmountXof: null });
    expect(calculateTeacherControlCompensation({
      startedAt,
      validatedEndedAt,
      hourlyRateXof: null,
    })).toEqual({ durationMilliseconds: 5_400_000, estimatedAmountXof: null });
  });

  it('rounds estimated compensation to the nearest XOF and rejects reversed validated times', () => {
    expect(calculateTeacherControlCompensation({
      startedAt: new Date('2026-10-31T07:00:00.000Z'),
      validatedEndedAt: new Date('2026-10-31T07:00:30.000Z'),
      hourlyRateXof: 1,
    }).estimatedAmountXof).toBe(0);
    expect(() => calculateTeacherControlCompensation({
      startedAt: new Date('2026-10-31T08:00:00.000Z'),
      validatedEndedAt: new Date('2026-10-31T07:00:00.000Z'),
      hourlyRateXof: 1_000,
    })).toThrow(RangeError);
  });
});
