import type express from 'express';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { students, users } from '../db/schema.ts';
import { requireRole, verifyToken } from '../middleware/auth.ts';
import { canonicalizeUserPhone } from './phoneCanonicalization.ts';
import { getParentChildStudentIds } from './parentStudentAccess.ts';

interface ParentSchoolAdminWhatsAppActor {
  id?: number | null;
  role: string;
}

interface RegisterParentSchoolAdminWhatsAppRouteOptions {
  resolveActor: (req: any) => Promise<ParentSchoolAdminWhatsAppActor | null>;
  verifyMiddleware?: express.RequestHandler;
  accessMiddleware?: express.RequestHandler;
}

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const whatsappMessage = 'Bonjour, je souhaite contacter l’administration de l’école.';

export const registerParentSchoolAdminWhatsAppRoute = (
  app: express.Express,
  options: RegisterParentSchoolAdminWhatsAppRouteOptions,
) => {
  const {
    resolveActor,
    verifyMiddleware = verifyToken as any,
    accessMiddleware = requireRole(['parent']) as any,
  } = options;

  app.get('/api/parent/whatsapp-contact', verifyMiddleware, accessMiddleware, async (req: any, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor || actor.role !== 'parent' || actor.id == null) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const childId = parsePositiveInteger(req.query?.studentId);
      if (childId == null) return res.status(400).json({ error: 'Valid studentId is required' });

      const childIds = await getParentChildStudentIds(actor.id);
      if (!childIds.includes(childId)) return res.status(404).json({ error: 'Student not found' });

      const [child] = await db.select({ schoolId: students.schoolId })
        .from(students)
        .where(and(eq(students.id, childId), inArray(students.id, childIds)));
      if (!child || child.schoolId == null) return res.json({ whatsappUrl: null });

      const administrators = await db.select({ phone: users.phone })
        .from(users)
        .where(and(
          eq(users.role, 'school_admin'),
          eq(users.schoolId, child.schoolId),
          eq(users.isDeleted, false),
          isNotNull(users.phone),
        ))
        .orderBy(asc(users.id));

      for (const administrator of administrators) {
        const canonicalPhone = canonicalizeUserPhone(administrator.phone);
        if (!canonicalPhone) continue;
        const whatsappNumber = canonicalPhone.replace(/\D/g, '');
        if (!/^[1-9]\d{1,14}$/.test(whatsappNumber)) continue;
        const message = encodeURIComponent(whatsappMessage);
        return res.json({ whatsappUrl: `https://wa.me/${whatsappNumber}?text=${message}` });
      }

      return res.json({ whatsappUrl: null });
    } catch (error) {
      console.error('Failed to resolve parent school WhatsApp contact:', error);
      return res.status(500).json({ error: 'Failed to resolve school WhatsApp contact' });
    }
  });
};
