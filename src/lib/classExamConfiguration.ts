export interface ClassExamConfigurationScope {
  schoolId: number | null;
}

export function selectPreferredClassExamConfiguration<T extends ClassExamConfigurationScope>(
  configurations: T[],
  schoolId: number | null | undefined,
): T[] {
  const applicable = configurations.filter((configuration) => (
    schoolId == null
      ? configuration.schoolId == null
      : configuration.schoolId === schoolId || configuration.schoolId == null
  ));

  return [...applicable].sort((left, right) => {
    if (schoolId == null) return 0;
    return Number(right.schoolId === schoolId) - Number(left.schoolId === schoolId);
  });
}
