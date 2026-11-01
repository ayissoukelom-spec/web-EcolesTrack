-- Raise the accepted GPS accuracy ceiling for both session start and end fixes.
BEGIN;

ALTER TABLE public.teacher_control_sessions
  DROP CONSTRAINT teacher_control_sessions_gps_values_check,
  ADD CONSTRAINT teacher_control_sessions_gps_values_check CHECK (
    (start_distance_meters IS NULL OR start_distance_meters >= 0)
    AND (start_accuracy_meters IS NULL OR start_accuracy_meters BETWEEN 0 AND 500)
    AND (start_geofence_radius_meters IS NULL OR start_geofence_radius_meters > 0)
    AND (end_distance_meters IS NULL OR end_distance_meters >= 0)
    AND (end_accuracy_meters IS NULL OR end_accuracy_meters BETWEEN 0 AND 500)
    AND (end_geofence_radius_meters IS NULL OR end_geofence_radius_meters > 0)
  );

COMMIT;
