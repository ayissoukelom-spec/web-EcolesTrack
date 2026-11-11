import { sql } from 'drizzle-orm';
import { lateArrivals } from '../db/schema.ts';

const excludedJustificationStatuses: readonly string[] = ['APPROVED'];

export const isLateArrivalCountedInBulletin = (
  justificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null,
): boolean => justificationStatus == null || !excludedJustificationStatuses.includes(justificationStatus);

export const unjustifiedLateArrivalCondition = () => sql`
  NOT EXISTS (
    SELECT 1
    FROM late_arrival_justifications laj
    WHERE laj.late_arrival_id = ${lateArrivals.id}
      AND laj.status IN (${sql.join(excludedJustificationStatuses.map((status) => sql`${status}`), sql`, `)})
  )
`;
