export function shouldInitializeDatabaseAtStartup(
  nodeEnv: string | undefined,
  skipLocalDatabaseInitialization: string | undefined,
): boolean {
  return nodeEnv !== 'development' || skipLocalDatabaseInitialization !== 'true';
}
