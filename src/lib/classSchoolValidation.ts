export function resolveClassCreationSchoolId(args: {
  actorRole: string | null | undefined;
  requestedSchoolId?: number | string | null;
  actorSchoolId?: number | string | null;
}) {
  const { actorRole, requestedSchoolId, actorSchoolId } = args;

  if (actorRole === 'school_admin' || actorRole === 'school_accountant') {
    const activeSchoolId = actorSchoolId == null || actorSchoolId === '' || actorSchoolId === 'undefined' || actorSchoolId === 'null'
      ? null
      : Number(actorSchoolId);
    const requested = requestedSchoolId == null || requestedSchoolId === '' || requestedSchoolId === 'undefined' || requestedSchoolId === 'null'
      ? activeSchoolId
      : Number(requestedSchoolId);

    if (activeSchoolId == null || !Number.isSafeInteger(activeSchoolId) || activeSchoolId <= 0) {
      return { schoolId: null, error: 'schoolId is required to create a class' };
    }
    if (!Number.isSafeInteger(requested) || requested !== activeSchoolId) {
      return { schoolId: null, error: 'Cannot create in another school' };
    }

    return { schoolId: activeSchoolId };
  }

  if (actorRole === 'super_admin') {
    const parsed = requestedSchoolId == null || requestedSchoolId === '' || requestedSchoolId === 'undefined' || requestedSchoolId === 'null'
      ? null
      : Number(requestedSchoolId);

    if (parsed != null && Number.isNaN(parsed)) {
      return { schoolId: null, error: 'Invalid schoolId' };
    }

    return { schoolId: parsed };
  }

  return { schoolId: null, error: 'Forbidden' };
}
