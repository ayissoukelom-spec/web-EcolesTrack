export function resolveClassCreationSchoolId(args: {
  actorRole: string | null | undefined;
  requestedSchoolId?: number | string | null;
  actorSchoolId?: number | string | null;
}) {
  const { actorRole, requestedSchoolId, actorSchoolId } = args;

  if (actorRole === 'school_admin') {
    const candidate = requestedSchoolId ?? actorSchoolId;
    const parsed = candidate == null || candidate === '' || candidate === 'undefined' || candidate === 'null'
      ? null
      : Number(candidate);

    if (parsed == null || Number.isNaN(parsed)) {
      return { schoolId: null, error: 'schoolId is required to create a class' };
    }

    return { schoolId: parsed };
  }

  if (actorRole === 'super_admin') {
    const parsed = requestedSchoolId == null || requestedSchoolId === '' || requestedSchoolId === 'undefined' || requestedSchoolId === 'null'
      ? null
      : Number(requestedSchoolId);

    if (parsed == null || Number.isNaN(parsed)) {
      return { schoolId: null, error: 'schoolId is required to create a class' };
    }

    return { schoolId: parsed };
  }

  return { schoolId: null, error: 'Forbidden' };
}
