import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildSchoolLogoRelativePath, isSupportedSchoolLogo, SCHOOL_LOGO_MAX_SIZE } from '../server.ts';

describe('school logo infrastructure', () => {
  it('accepts PNG and JPG/JPEG files only', () => {
    expect(isSupportedSchoolLogo({ mimetype: 'image/png', originalname: 'logo.png' })).toBe(true);
    expect(isSupportedSchoolLogo({ mimetype: 'image/jpeg', originalname: 'logo.jpg' })).toBe(true);
    expect(isSupportedSchoolLogo({ mimetype: 'image/jpeg', originalname: 'logo.jpeg' })).toBe(true);
    expect(isSupportedSchoolLogo({ mimetype: 'application/pdf', originalname: 'logo.pdf' })).toBe(false);
    expect(isSupportedSchoolLogo({ mimetype: 'image/svg+xml', originalname: 'logo.svg' })).toBe(false);
    expect(isSupportedSchoolLogo({ mimetype: 'image/png', originalname: 'logo.jpg' })).toBe(false);
  });

  it('uses a bounded size and a collision-resistant relative storage reference', () => {
    expect(SCHOOL_LOGO_MAX_SIZE).toBe(2 * 1024 * 1024);
    expect(buildSchoolLogoRelativePath('../unsafe-logo.png')).toBe('school-logos/unsafe-logo.png');
  });

  it('keeps the schema, migration, route, authorization and PDF transport contracts', () => {
    const schema = fs.readFileSync(path.resolve('src/db/schema.ts'), 'utf8');
    const migration = fs.readFileSync(path.resolve('drizzle/0107_add_school_logo_path.sql'), 'utf8');
    const server = fs.readFileSync(path.resolve('server.ts'), 'utf8');
    const pdf = fs.readFileSync(path.resolve('src/lib/bulletinPdfApi.ts'), 'utf8');

    expect(schema).toContain("logoPath: text('logo_path')");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS logo_path text');
    expect(server).toContain("app.post('/api/schools/:id/logo'");
    expect(server).toContain("app.get('/api/schools/:id/logo'");
    expect(server).toContain("if (actor.role !== 'super_admin' && actor.role !== 'school_admin')");
    expect(server).toContain("if (actor.role === 'school_admin' && actor.schoolId !== id)");
    expect(server).toContain("path.join(process.cwd(), 'uploads', 'school-logos')");
    expect(pdf).toContain('logoPath: schools.logoPath');
    expect(pdf).toContain('logoPath: header.school.logoPath ?? null');
    expect(server).not.toContain("src/assets/logo.png");
  });
});
