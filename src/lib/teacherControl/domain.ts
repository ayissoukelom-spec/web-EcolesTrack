export const MAX_GPS_ACCURACY_METERS = 100;
export const TEACHER_CONTROL_DISPLAY_TIME_ZONE = 'Africa/Lome';
const EARTH_RADIUS_METERS = 6_371_000;

export interface TeacherControlGpsFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export interface TeacherControlGpsSite {
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
}

export type TeacherControlGpsValidation =
  | { accepted: true; distanceMeters: number; accuracyMeters: number }
  | { accepted: false; reason: 'invalid_position' | 'invalid_accuracy' | 'accuracy_too_low' | 'invalid_geofence' | 'outside_geofence' };

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function calculateDistanceMeters(
  first: Pick<TeacherControlGpsFix, 'latitude' | 'longitude'>,
  second: Pick<TeacherControlGpsSite, 'latitude' | 'longitude'>,
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function validateTeacherControlGpsFix(
  fix: TeacherControlGpsFix,
  site: TeacherControlGpsSite,
): TeacherControlGpsValidation {
  if (!isValidCoordinate(fix.latitude, fix.longitude)
    || !isValidCoordinate(site.latitude, site.longitude)) {
    return { accepted: false, reason: 'invalid_position' };
  }
  if (!Number.isFinite(fix.accuracyMeters) || fix.accuracyMeters < 0) {
    return { accepted: false, reason: 'invalid_accuracy' };
  }
  if (fix.accuracyMeters > MAX_GPS_ACCURACY_METERS) {
    return { accepted: false, reason: 'accuracy_too_low' };
  }
  if (!Number.isSafeInteger(site.geofenceRadiusMeters) || site.geofenceRadiusMeters <= 0) {
    return { accepted: false, reason: 'invalid_geofence' };
  }

  const distance = calculateDistanceMeters(fix, site);
  if (distance > site.geofenceRadiusMeters) {
    return { accepted: false, reason: 'outside_geofence' };
  }

  return {
    accepted: true,
    distanceMeters: Math.ceil(distance),
    accuracyMeters: Math.ceil(fix.accuracyMeters),
  };
}

export interface TeacherControlCompensation {
  durationMilliseconds: number | null;
  estimatedAmountXof: number | null;
}

export function calculateTeacherControlCompensation(input: {
  startedAt: Date;
  validatedEndedAt: Date | null;
  hourlyRateXof: number | null;
}): TeacherControlCompensation {
  if (input.validatedEndedAt == null) {
    return { durationMilliseconds: null, estimatedAmountXof: null };
  }
  if (!Number.isFinite(input.startedAt.getTime())
    || !Number.isFinite(input.validatedEndedAt.getTime())
    || input.validatedEndedAt < input.startedAt) {
    throw new RangeError('Validated session end must be a valid time after its start.');
  }

  const durationMilliseconds = input.validatedEndedAt.getTime() - input.startedAt.getTime();
  if (input.hourlyRateXof == null) {
    return { durationMilliseconds, estimatedAmountXof: null };
  }
  if (!Number.isSafeInteger(input.hourlyRateXof) || input.hourlyRateXof < 0) {
    throw new RangeError('Hourly rate must be a non-negative whole number of XOF.');
  }

  return {
    durationMilliseconds,
    estimatedAmountXof: Math.round(input.hourlyRateXof * durationMilliseconds / 3_600_000),
  };
}
