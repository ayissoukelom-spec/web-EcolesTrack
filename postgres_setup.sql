DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ecole_admin') THEN
    CREATE ROLE ecole_admin WITH LOGIN PASSWORD 'EcoleTrack2026!';
  ELSE
    ALTER ROLE ecole_admin WITH LOGIN PASSWORD 'EcoleTrack2026!';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ecoletrack') THEN
    CREATE DATABASE ecoletrack OWNER ecole_admin;
  END IF;
END
$$ LANGUAGE plpgsql;
