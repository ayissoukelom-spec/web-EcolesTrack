export function createAbsenceRefreshSequence() {
  let latestRequestId = 0;
  return {
    begin: () => ++latestRequestId,
    isLatest: (requestId: number) => requestId === latestRequestId,
  };
}
