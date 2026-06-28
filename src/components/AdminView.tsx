import React, { useState, useRef, useEffect } from 'react';
import AdminModal from './AdminModal';
import SubjectsView from './SubjectsView';
import { School, AcademicYear, Class, Teacher, Student, Parent, SystemNotification, User, UserRole } from '../types.ts';
import {
  Building2,
  Calendar,
  Layers,
  UserCheck,
  GraduationCap,
  Users2,
  Plus,
  Search,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HeartHandshake,
  UserPlus,
  Settings,
  Eye,
  BookOpen
} from 'lucide-react';
import { getSimulatedSchoolId, getSimulatedUser } from '../lib/api.ts';
import { sortClasses } from '../lib/classOrdering';
import * as XLSX from 'xlsx';
import RequiredLabel from './RequiredLabel';

const teacherSpecializations = [
  'Anglais',
  'Français',
  'Histoire-Géographie',
  'Physique-Chimie',
  'SVT',
  'ECM',
  'Couture',
  'Philosophie',
  'Allemand',
  'Espagnol',
  'Mathématiques',
] as const;

const validateRecords = (records: any[]) => {
    const rowErrors: {row: number; errors: string[]}[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i] || {};
      const errs: string[] = [];
      // birthDate YYYY-MM-DD
      if (!r.birthDate) {
        errs.push('birthDate manquant');
      } else if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(r.birthDate))) {
        errs.push('birthDate au format YYYY-MM-DD attendu');
      } else {
        const t = Date.parse(String(r.birthDate));
        if (isNaN(t)) errs.push('birthDate invalide');
      }
      // numeric ids
      ['schoolId','classId','parentId','academicYearId','teacherId','schoolAdminId'].forEach((f) => {
        if (r[f] !== undefined && String(r[f]).trim() !== '') {
          if (isNaN(Number(String(r[f]).toString()))) errs.push(`${f} doit être numérique`);
        }
      });
      // email
      if (r.parentEmail && String(r.parentEmail).trim() !== '') {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(String(r.parentEmail))) errs.push('parentEmail invalide');
      }
      // phone
      if (r.parentPhone && String(r.parentPhone).trim() !== '') {
        const digits = String(r.parentPhone).replace(/\D/g, '');
        if (digits.length !== 8) errs.push('parentPhone doit contenir 8 chiffres');
      }
      if (errs.length > 0) rowErrors.push({ row: i, errors: errs });
    }
    const summary = rowErrors.length > 0 ? [`${rowErrors.length} lignes contiennent des erreurs de format`] : [];
    return { rowErrors, summary };
  };

  const parseDateFlexible = (input: string) => {
    const s = String(input || '').trim();
    if (!s) return null;
    // already YYYY-MM-DD
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) return s;
    // DD/MM/YYYY or DD-MM-YYYY
    const m1 = s.match(/^([0-9]{2})[\/-]([0-9]{2})[\/-]([0-9]{4})$/);
    if (m1) {
      const d = m1[1], mo = m1[2], y = m1[3];
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // MM/DD/YYYY
    const m2 = s.match(/^([0-9]{2})[\/]([0-9]{2})[\/]([0-9]{4})$/);
    if (m2) {
      const mo = m2[1], d = m2[2], y = m2[3];
      // ambiguous with DD/MM; prefer DD/MM earlier, so this unlikely
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // Excel serialized date number (e.g. 39550)
    const asNumber = Number(s);
    if (!isNaN(asNumber) && asNumber > 0 && asNumber < 60000) {
      const excelOrigin = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelOrigin.getTime() + (asNumber * 24 * 60 * 60 * 1000));
      const y = date.getUTCFullYear();
      const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${mo}-${dd}`;
    }
    const ts = Date.parse(s);
    if (!isNaN(ts)) {
      const d = new Date(ts);
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${mo}-${dd}`;
    }
    return null;
  };

  const normalizeRecords = (records: any[]) => {
    return records.map((r: any) => {
      const out: any = {};
      // copy and trim strings
      Object.keys(r || {}).forEach((k) => { out[k] = String(r[k] ?? '').trim(); });
      // normalize date
      if (out.birthDate) {
        const parsed = parseDateFlexible(out.birthDate);
        out.birthDate = parsed || out.birthDate;
      }
      // normalize emails
      if (out.parentEmail) out.parentEmail = String(out.parentEmail).trim().toLowerCase();
      // normalize phone digits
      if (out.parentPhone) out.parentPhone = String(out.parentPhone).replace(/\D/g, '');
      // numeric ids to numbers where appropriate
      ['schoolId','classId','parentId','academicYearId','teacherId','schoolAdminId'].forEach((f) => {
        if (out[f] !== undefined && out[f] !== '') {
          const n = Number(out[f]);
          out[f] = isNaN(n) ? out[f] : n;
        } else {
          delete out[f];
        }
      });
      return out;
    });
  };

const parentPhonePrefixes = [
  { value: '+1', label: '+1 (USA/Canada)' },
  { value: '+7', label: '+7 (Russie/Kazakhstan)' },
  { value: '+20', label: '+20 (Égypte)' },
  { value: '+27', label: '+27 (Afrique du Sud)' },
  { value: '+30', label: '+30 (Grèce)' },
  { value: '+31', label: '+31 (Pays-Bas)' },
  { value: '+32', label: '+32 (Belgique)' },
  { value: '+34', label: '+34 (Espagne)' },
  { value: '+36', label: '+36 (Hongrie)' },
  { value: '+39', label: '+39 (Italie)' },
  { value: '+40', label: '+40 (Roumanie)' },
  { value: '+41', label: '+41 (Suisse)' },
  { value: '+43', label: '+43 (Autriche)' },
  { value: '+44', label: '+44 (Royaume-Uni)' },
  { value: '+45', label: '+45 (Danemark)' },
  { value: '+46', label: '+46 (Suède)' },
  { value: '+47', label: '+47 (Norvège)' },
  { value: '+48', label: '+48 (Pologne)' },
  { value: '+49', label: '+49 (Allemagne)' },
  { value: '+51', label: '+51 (Pérou)' },
  { value: '+52', label: '+52 (Mexique)' },
  { value: '+53', label: '+53 (Cuba)' },
  { value: '+54', label: '+54 (Argentine)' },
  { value: '+55', label: '+55 (Brésil)' },
  { value: '+56', label: '+56 (Chili)' },
  { value: '+57', label: '+57 (Colombie)' },
  { value: '+58', label: '+58 (Venezuela)' },
  { value: '+60', label: '+60 (Malaisie)' },
  { value: '+61', label: '+61 (Australie)' },
  { value: '+62', label: '+62 (Indonésie)' },
  { value: '+63', label: '+63 (Philippines)' },
  { value: '+64', label: '+64 (Nouvelle-Zélande)' },
  { value: '+65', label: '+65 (Singapour)' },
  { value: '+66', label: '+66 (Thaïlande)' },
  { value: '+81', label: '+81 (Japon)' },
  { value: '+82', label: '+82 (Corée du Sud)' },
  { value: '+84', label: '+84 (Vietnam)' },
  { value: '+86', label: '+86 (Chine)' },
  { value: '+90', label: '+90 (Turquie)' },
  { value: '+91', label: '+91 (Inde)' },
  { value: '+92', label: '+92 (Pakistan)' },
  { value: '+93', label: '+93 (Afghanistan)' },
  { value: '+94', label: '+94 (Sri Lanka)' },
  { value: '+95', label: '+95 (Myanmar)' },
  { value: '+98', label: '+98 (Iran)' },
  { value: '+211', label: '+211 (Soudan du Sud)' },
  { value: '+212', label: '+212 (Maroc)' },
  { value: '+213', label: '+213 (Algérie)' },
  { value: '+216', label: '+216 (Tunisie)' },
  { value: '+218', label: '+218 (Libye)' },
  { value: '+220', label: '+220 (Gambie)' },
  { value: '+221', label: '+221 (Sénégal)' },
  { value: '+222', label: '+222 (Mauritanie)' },
  { value: '+223', label: '+223 (Mali)' },
  { value: '+224', label: '+224 (Guinée)' },
  { value: '+225', label: '+225 (Côte d’Ivoire)' },
  { value: '+226', label: '+226 (Burkina Faso)' },
  { value: '+227', label: '+227 (Niger)' },
  { value: '+228', label: '+228 (Togo)' },
  { value: '+229', label: '+229 (Bénin)' },
  { value: '+230', label: '+230 (Maurice)' },
  { value: '+231', label: '+231 (Libéria)' },
  { value: '+232', label: '+232 (Sierra Leone)' },
  { value: '+233', label: '+233 (Ghana)' },
  { value: '+234', label: '+234 (Nigéria)' },
  { value: '+235', label: '+235 (Tchad)' },
  { value: '+236', label: '+236 (République centrafricaine)' },
  { value: '+237', label: '+237 (Cameroun)' },
  { value: '+238', label: '+238 (Cap-Vert)' },
  { value: '+239', label: '+239 (Sao Tomé-et-Principe)' },
  { value: '+240', label: '+240 (Guinée équatoriale)' },
  { value: '+241', label: '+241 (Gabon)' },
  { value: '+242', label: '+242 (Congo)' },
  { value: '+243', label: '+243 (République démocratique du Congo)' },
  { value: '+244', label: '+244 (Angola)' },
  { value: '+245', label: '+245 (Guinée-Bissau)' },
  { value: '+246', label: '+246 (Îles Chagos)' },
  { value: '+247', label: '+247 (Ascension)' },
  { value: '+248', label: '+248 (Seychelles)' },
  { value: '+249', label: '+249 (Soudan)' },
  { value: '+250', label: '+250 (Rwanda)' },
  { value: '+251', label: '+251 (Éthiopie)' },
  { value: '+252', label: '+252 (Somalie)' },
  { value: '+253', label: '+253 (Djibouti)' },
  { value: '+254', label: '+254 (Kenya)' },
  { value: '+255', label: '+255 (Tanzanie)' },
  { value: '+256', label: '+256 (Ouganda)' },
  { value: '+257', label: '+257 (Burundi)' },
  { value: '+258', label: '+258 (Mozambique)' },
  { value: '+260', label: '+260 (Zambie)' },
  { value: '+261', label: '+261 (Madagascar)' },
  { value: '+262', label: '+262 (Réunion / Mayotte)' },
  { value: '+263', label: '+263 (Zimbabwe)' },
  { value: '+264', label: '+264 (Namibie)' },
  { value: '+265', label: '+265 (Malawi)' },
  { value: '+266', label: '+266 (Lesotho)' },
  { value: '+267', label: '+267 (Botswana)' },
  { value: '+268', label: '+268 (Eswatini)' },
  { value: '+269', label: '+269 (Comores)' },
  { value: '+291', label: '+291 (Érythrée)' },
  { value: '+297', label: '+297 (Aruba)' },
  { value: '+298', label: '+298 (Îles Féroé)' },
  { value: '+299', label: '+299 (Groenland)' },
  { value: '+350', label: '+350 (Gibraltar)' },
  { value: '+351', label: '+351 (Portugal)' },
  { value: '+352', label: '+352 (Luxembourg)' },
  { value: '+353', label: '+353 (Irlande)' },
  { value: '+354', label: '+354 (Islande)' },
  { value: '+355', label: '+355 (Albanie)' },
  { value: '+356', label: '+356 (Malte)' },
  { value: '+357', label: '+357 (Chypre)' },
  { value: '+358', label: '+358 (Finlande)' },
  { value: '+359', label: '+359 (Bulgarie)' },
  { value: '+370', label: '+370 (Lituanie)' },
  { value: '+371', label: '+371 (Lettonie)' },
  { value: '+372', label: '+372 (Estonie)' },
  { value: '+373', label: '+373 (Moldavie)' },
  { value: '+374', label: '+374 (Arménie)' },
  { value: '+375', label: '+375 (Biélorussie)' },
  { value: '+376', label: '+376 (Andorre)' },
  { value: '+377', label: '+377 (Monaco)' },
  { value: '+378', label: '+378 (Saint-Marin)' },
  { value: '+380', label: '+380 (Ukraine)' },
  { value: '+381', label: '+381 (Serbie)' },
  { value: '+382', label: '+382 (Monténégro)' },
  { value: '+383', label: '+383 (Kosovo)' },
  { value: '+385', label: '+385 (Croatie)' },
  { value: '+386', label: '+386 (Slovénie)' },
  { value: '+387', label: '+387 (Bosnie-Herzégovine)' },
  { value: '+389', label: '+389 (Macédoine du Nord)' },
  { value: '+420', label: '+420 (République tchèque)' },
  { value: '+421', label: '+421 (Slovaquie)' },
  { value: '+423', label: '+423 (Liechtenstein)' },
  { value: '+500', label: '+500 (Îles Falkland)' },
  { value: '+501', label: '+501 (Belize)' },
  { value: '+502', label: '+502 (Guatemala)' },
  { value: '+503', label: '+503 (Salvador)' },
  { value: '+504', label: '+504 (Honduras)' },
  { value: '+505', label: '+505 (Nicaragua)' },
  { value: '+506', label: '+506 (Costa Rica)' },
  { value: '+507', label: '+507 (Panama)' },
  { value: '+508', label: '+508 (Saint-Pierre-et-Miquelon)' },
  { value: '+509', label: '+509 (Haïti)' },
  { value: '+590', label: '+590 (Guadeloupe / Martinique / Saint-Barthélémy)' },
  { value: '+591', label: '+591 (Bolivie)' },
  { value: '+592', label: '+592 (Guyana)' },
  { value: '+593', label: '+593 (Équateur)' },
  { value: '+594', label: '+594 (Guyane française)' },
  { value: '+595', label: '+595 (Paraguay)' },
  { value: '+596', label: '+596 (Martinique)' },
  { value: '+597', label: '+597 (Suriname)' },
  { value: '+598', label: '+598 (Uruguay)' },
  { value: '+599', label: '+599 (Caraïbes néerlandaises)' },
  { value: '+670', label: '+670 (Timor oriental)' },
  { value: '+672', label: '+672 (Territoires australiens)' },
  { value: '+673', label: '+673 (Brunei)' },
  { value: '+674', label: '+674 (Nauru)' },
  { value: '+675', label: '+675 (Papouasie-Nouvelle-Guinée)' },
  { value: '+676', label: '+676 (Tonga)' },
  { value: '+677', label: '+677 (Îles Salomon)' },
  { value: '+678', label: '+678 (Vanuatu)' },
  { value: '+679', label: '+679 (Fidji)' },
  { value: '+680', label: '+680 (Palaos)' },
  { value: '+681', label: '+681 (Wallis-et-Futuna)' },
  { value: '+682', label: '+682 (Îles Cook)' },
  { value: '+683', label: '+683 (Niue)' },
  { value: '+684', label: '+684 (Samoa américaines)' },
  { value: '+685', label: '+685 (Samoa)' },
  { value: '+686', label: '+686 (Kiribati)' },
  { value: '+687', label: '+687 (Nouvelle-Calédonie)' },
  { value: '+688', label: '+688 (Tuvalu)' },
  { value: '+689', label: '+689 (Polynésie française)' },
  { value: '+690', label: '+690 (Tokelau)' },
  { value: '+691', label: '+691 (Micronésie)' },
  { value: '+692', label: '+692 (Îles Marshall)' },
  { value: '+850', label: '+850 (Corée du Nord)' },
  { value: '+852', label: '+852 (Hong Kong)' },
  { value: '+853', label: '+853 (Macau)' },
  { value: '+855', label: '+855 (Cambodge)' },
  { value: '+856', label: '+856 (Laos)' },
  { value: '+870', label: '+870 (Inmarsat)' },
  { value: '+878', label: '+878 (Universal Personal Telecommunications)' },
  { value: '+880', label: '+880 (Bangladesh)' },
  { value: '+881', label: '+881 (Satellite services)' },
  { value: '+882', label: '+882 (Réservoir de codes E.164)' },
  { value: '+883', label: '+883 (Services satelitaires)' },
  { value: '+886', label: '+886 (Taïwan)' },
  { value: '+888', label: '+888 (IDSN)' },
  { value: '+960', label: '+960 (Maldives)' },
  { value: '+961', label: '+961 (Liban)' },
  { value: '+962', label: '+962 (Jordanie)' },
  { value: '+963', label: '+963 (Syrie)' },
  { value: '+964', label: '+964 (Irak)' },
  { value: '+965', label: '+965 (Koweït)' },
  { value: '+966', label: '+966 (Arabie Saoudite)' },
  { value: '+967', label: '+967 (Yémen)' },
  { value: '+968', label: '+968 (Oman)' },
  { value: '+970', label: '+970 (Palestine)' },
  { value: '+971', label: '+971 (Émirats arabes unis)' },
  { value: '+972', label: '+972 (Israël)' },
  { value: '+973', label: '+973 (Bahreïn)' },
  { value: '+974', label: '+974 (Qatar)' },
  { value: '+975', label: '+975 (Bhoutan)' },
  { value: '+976', label: '+976 (Mongolie)' },
  { value: '+977', label: '+977 (Népal)' },
  { value: '+979', label: '+979 (UPU réserves)' },
  { value: '+992', label: '+992 (Tadjikistan)' },
  { value: '+993', label: '+993 (Turkménistan)' },
  { value: '+994', label: '+994 (Azerbaïdjan)' },
  { value: '+995', label: '+995 (Géorgie)' },
  { value: '+996', label: '+996 (Kirghizistan)' },
  { value: '+998', label: '+998 (Ouzbékistan)' },
] as const;

const sortedParentPhonePrefixes = [...parentPhonePrefixes].sort((a, b) => {
  const getCountry = (label: string) => label.replace(/^\+\d+\s*\((.+)\)$/, '$1');
  return getCountry(a.label).localeCompare(getCountry(b.label), 'fr', { sensitivity: 'base' });
});

interface AdminViewProps {
  userRole: UserRole;
  schoolsList: School[];
  yearsList: AcademicYear[];
  classesList: Class[];
  teachersList: Teacher[];
  studentsList: Student[];
  parentsList: Parent[];
  usersList: User[];
  subjectsList?: any[];
  onAddSchool: (data: { name: string; address: string; phone: string; classNames?: string[] }) => Promise<any>;
  onUpdateSchool?: (id: number, data: { name: string; address: string; phone: string; classNames?: string[] }) => Promise<any>;
  onUpdateStudent?: (id: number, data: { firstName: string; lastName: string; birthDate: string | null; schoolId?: number; classId: number; parentId: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number }) => Promise<any>;
  onAddYear: (data: { name: string; isActive: boolean; schoolId?: number }) => void;
  onAddClass: (data: { name: string; schoolId: number; academicYearId: number; teacherId?: number }) => Promise<void>;
  onAddTeacher: (data: { name: string; email: string; phone: string; specialization: string | string[]; schoolId: number; classIds?: number[]; gender?: string }) => Promise<any>;
  onAddParent: (data: { name: string; email: string; phone: string; address: string; schoolId?: number; studentId?: number; gender?: string }) => Promise<any>;
  onAddStudent: (data: { firstName: string; lastName: string; birthDate: string; schoolId: number; classId: number; parentId?: number; academicYearId?: number; teacherIds?: number[]; schoolAdminId?: number; gender?: string }) => void;
  onBatchCreateStudents?: (records: any[]) => void;
  onBatchCreateParents?: (records: any[]) => void;
  importResult?: any | null;
  onCreateUser?: (data: { uid?: string; email: string; name: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string | string[]; gender?: string; password?: string; classIds?: number[] }) => Promise<any>;
  onUpdateUser?: (id: number, data: { email: string; name: string; role: string; schoolId?: number; academicYearId?: number; phone?: string; specialization?: string; classIds?: number[] }) => Promise<any>;
  onSetPassword?: (userId: number, password: string) => Promise<any>;
  onDeleteUser?: (id: number) => Promise<void>;
  onDeleteClass: (id: number) => void;
  onDeleteSchool: (id: number) => void;
  onAddSubject?: (data: { name: string; code?: string; schoolId?: number }) => Promise<any>;
  onUpdateSubject?: (id: number, data: { name: string; code?: string }) => Promise<any>;
  onDeleteSubject?: (id: number) => Promise<void>;
  onApproveSubject?: (id: number) => Promise<any>;
  onRejectSubject?: (id: number) => Promise<any>;
  currentSchoolId?: number | null;
}

export default function AdminView({
  userRole,
  schoolsList,
  yearsList,
  classesList,
  teachersList,
  studentsList,
  parentsList,
  subjectsList = [],
  onAddSchool,
  onUpdateSchool,
  onUpdateStudent,
  onAddYear,
  onAddClass,
  onAddTeacher,
  onAddParent,
  onAddStudent,
  onBatchCreateStudents,
  onBatchCreateParents,
  importResult,
  onCreateUser,
  usersList,
  onDeleteClass,
  onDeleteSchool,
  onUpdateUser,
  onSetPassword,
  onDeleteUser,
  onAddSubject,
  onUpdateSubject,
  onDeleteSubject,
  onApproveSubject,
  onRejectSubject,
  currentSchoolId,
}: AdminViewProps) {
  const getDefaultTab = () => {
    if (typeof window === 'undefined') return userRole === 'super_admin' ? 'schools' : 'years';
    const savedTab = window.localStorage.getItem('ecoletrack-admin-active-tab') as
      | 'schools'
      | 'years'
      | 'classes'
      | 'teachers'
      | 'students'
      | 'parents'
      | 'accounts'
      | null;
    const validTabs = userRole === 'super_admin'
      ? ['schools', 'years', 'classes', 'teachers', 'students', 'parents', 'accounts']
      : ['years', 'classes', 'teachers', 'students', 'parents', 'accounts'];
    if (savedTab && validTabs.includes(savedTab)) return savedTab;
    return userRole === 'super_admin' ? 'schools' : 'years';
  };

  const [activeTab, setActiveTab] = useState<'schools' | 'years' | 'classes' | 'teachers' | 'students' | 'parents' | 'accounts' | 'matieres'>(getDefaultTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [superAdminSchoolFilterId, setSuperAdminSchoolFilterId] = useState<number | null>(null);
  const [accountRoleFilter, setAccountRoleFilter] = useState<string>('');
  const [studentClassFilterId, setStudentClassFilterId] = useState<number | null>(null);
  const [teacherClassFilterId, setTeacherClassFilterId] = useState<number | null>(null);
  
  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const parentFileInputRef = useRef<HTMLInputElement | null>(null);

  // New item forms state
  const [schoolForm, setSchoolForm] = useState({ name: '', address: '', phone: '', phoneDigits: '', selectedClassNames: [] as string[] });
  const [editSchoolForm, setEditSchoolForm] = useState({ name: '', address: '', phone: '', phoneDigits: '', classNames: [] as string[] });
  const [yearForm, setYearForm] = useState({ name: '2026-2027', isActive: true, schoolId: '' });
  const [classForm, setClassForm] = useState({ cycle: '', stream: '', section: '', group: '', schoolId: '' });
  const [teacherForm, setTeacherForm] = useState({ name: '', email: '', phone: '', specializations: [] as string[], schoolId: '', assignedClassIds: [] as number[], gender: '' });
  const [parentForm, setParentForm] = useState({ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '', studentId: '', gender: '' });
  const [studentForm, setStudentForm] = useState({ firstName: '', lastName: '', birthDate: '', schoolId: '', classId: '', parentId: '', academicYearId: '', teacherIds: [] as number[], schoolAdminId: '', gender: '' });
  const [studentError, setStudentError] = useState<string | null>(null);
  const [newParentMode, setNewParentMode] = useState(false);
  const [newParentForm, setNewParentForm] = useState({ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '', gender: '' });
  const [newTeacherMode, setNewTeacherMode] = useState(false);
  const [newTeacherForm, setNewTeacherForm] = useState({ name: '', email: '', phone: '', specializations: [] as string[], schoolId: '', assignedClassIds: [] as number[], gender: '' });
  const [allowSelectOverflow, setAllowSelectOverflow] = useState(false);
  const autoAssignedSchoolId = userRole === 'school_admin' ? (currentSchoolId ?? getSimulatedSchoolId()) : undefined;
  const autoAssignedSchoolName = schoolsList.find((s) => s.id === autoAssignedSchoolId)?.name || 'École assignée automatiquement';

  useEffect(() => {
    if (userRole === 'school_admin') {
      setNewUserForm((prev) => ({
        ...prev,
        schoolId: String(currentSchoolId || ''),
      }));
    }
  }, [userRole, currentSchoolId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const validTabs = userRole === 'super_admin'
      ? ['schools', 'years', 'classes', 'teachers', 'students', 'parents', 'accounts', 'matieres']
      : ['years', 'classes', 'teachers', 'students', 'parents', 'accounts', 'matieres'];
    if (!validTabs.includes(activeTab)) {
      setActiveTab(validTabs[0] as typeof activeTab);
      return;
    }
    window.localStorage.setItem('ecoletrack-admin-active-tab', activeTab);
  }, [activeTab, userRole]);

  const [creationDayOpen, setCreationDayOpen] = useState(false);
  const [creationMonthOpen, setCreationMonthOpen] = useState(false);
  const [creationYearOpen, setCreationYearOpen] = useState(false);
  const [editDayOpen, setEditDayOpen] = useState(false);
  const [editMonthOpen, setEditMonthOpen] = useState(false);
  const [editYearOpen, setEditYearOpen] = useState(false);
  const [studentBDay, setStudentBDay] = useState('');
  const [studentBMonth, setStudentBMonth] = useState('');
  const [studentBYear, setStudentBYear] = useState('');
  const [editBDay, setEditBDay] = useState('');
  const [editBMonth, setEditBMonth] = useState('');
  const [editBYear, setEditBYear] = useState('');

  // Custom dropdown to replace native <select> for date parts
  function CustomDropdown({ value, options, placeholder, onChange }: { value: string; options: { value: string; label: string }[]; placeholder?: string; onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      function onDoc(e: MouseEvent) {
        if (!ref.current) return;
        if (!ref.current.contains(e.target as Node)) setOpen(false);
      }
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    const selectedLabel = options.find((o) => o.value === value)?.label || '';

    return (
      <div className="relative" ref={ref}>
        <button type="button" onClick={() => setOpen((s) => !s)} className="w-full text-left px-3 py-2 bg-slate-50 border border-slate-200 text-xs sm:text-sm rounded-xl">
          {selectedLabel || placeholder}
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded shadow-lg z-50 max-h-56 overflow-auto">
            {options.map((opt) => (
              <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false); }} className={`w-full text-left px-3 py-2 hover:bg-slate-100 ${opt.value === value ? 'bg-slate-100 font-semibold' : ''}`}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Filter items
  const filterBySearch = (text: string) => {
    if (!text) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const filteredTeachersList = teachersList.filter((t) =>
    (userRole !== 'super_admin' || !superAdminSchoolFilterId || t.schoolId === superAdminSchoolFilterId) &&
    (!teacherClassFilterId || (t.classIds || []).includes(teacherClassFilterId)) &&
    filterBySearch(t.name)
  );

  const simulatedUser = getSimulatedUser();
  const currentTeacherUserId = simulatedUser?.uid || null;
  
  // Get current user for school_admin to pre-fill schoolAdminId
  const currentUser = usersList.find((u) => String(u.uid) === String(simulatedUser?.uid) || (u.email && simulatedUser?.email && u.email.toLowerCase() === simulatedUser.email.toLowerCase()));
  const currentUserId = currentUser?.id;
  
  // Robust resolution of the current teacher profile:
  // 1) try teachersList by email
  // 2) try to find corresponding user in usersList by uid/email and then find teacher by userId
  const currentTeacher = (() => {
    if (userRole !== 'teacher') return undefined;
    const simEmail = simulatedUser?.email?.toLowerCase?.() ?? null;
    // 1) match by teacher email
    const byEmail = teachersList.find((t) => t.email && simEmail && t.email.toLowerCase() === simEmail);
    if (byEmail) return byEmail;
    // 2) match by simulated uid or email to a User, then find teacher by userId
    const matchedUser = usersList.find((u) => String(u.uid) === String(simulatedUser?.uid) || (u.email && simEmail && u.email.toLowerCase() === simEmail));
    if (matchedUser) {
      const byUserId = teachersList.find((t) => t.userId === matchedUser.id);
      if (byUserId) return byUserId;
    }
    return undefined;
  })();

  const currentTeacherClassIds = currentTeacher ? (currentTeacher.classIds || []) : [];

  const currentParent = (() => {
    if (userRole !== 'parent') return undefined;
    const simEmail = simulatedUser?.email?.toLowerCase?.() ?? null;
    const byUserId = parentsList.find((p) => currentUserId && p.userId === currentUserId);
    if (byUserId) return byUserId;
    return parentsList.find((p) => p.email && simEmail && p.email.toLowerCase() === simEmail);
  })();

  const filteredStudentsList = studentsList.filter((st) =>
    (userRole !== 'super_admin' || !superAdminSchoolFilterId || st.schoolId === superAdminSchoolFilterId) &&
    (userRole !== 'teacher' || currentTeacherClassIds.includes(st.classId)) &&
    (userRole !== 'parent' || (currentParent ? st.parentId === currentParent.id : false)) &&
    (!studentClassFilterId || st.classId === studentClassFilterId) &&
    filterBySearch(`${st.firstName} ${st.lastName} ${st.className || ''} ${st.parentName || ''} ${st.yearName || ''}`)
  );

  const filteredAccountsList = usersList.filter((u) => {
    if (userRole === 'school_admin' && ['super_admin', 'school_admin'].includes(u.role)) {
      return false;
    }
    if (userRole === 'super_admin' && superAdminSchoolFilterId && u.schoolId !== superAdminSchoolFilterId) {
      return false;
    }
    if (userRole === 'super_admin' && accountRoleFilter && u.role !== accountRoleFilter) {
      return false;
    }
    return filterBySearch(`${u.name} ${u.email} ${u.role}`);
  });

  const selectedStudentSchoolId = studentForm.schoolId ? parseInt(studentForm.schoolId) : undefined;
  const defaultSchoolId = currentSchoolId || schoolsList[0]?.id || 1;
  const defaultAcademicYearId = yearsList.find((y) => y.isActive)?.id || yearsList[0]?.id || 1;
  const getYearsForSchool = (schoolId?: string | number | undefined) => {
    const sid = schoolId !== undefined && schoolId !== '' ? Number(schoolId) : (userRole === 'school_admin' ? currentSchoolId : undefined);
    return yearsList.filter((y) => y.schoolId == null || (sid !== undefined && sid !== null && y.schoolId === sid));
  };
  const visibleYearsList = userRole === 'super_admin' ? yearsList : getYearsForSchool(undefined);
  const sortedClasses = sortClasses(classesList || []);
  const classNamePreview = [classForm.cycle, classForm.stream, classForm.section, classForm.group].filter(Boolean).join(' ');
  const availableSchoolAdmins = usersList.filter((u) => u.role === 'school_admin' && (!selectedStudentSchoolId || u.schoolId === selectedStudentSchoolId));

  const currentYear = new Date().getFullYear();
  const birthYearRangeStart = currentYear - 60;
  const birthYearRangeEnd = currentYear - 3;
  const birthDateYearOptions = Array.from({ length: birthYearRangeEnd - birthYearRangeStart + 1 }, (_, index) => String(birthYearRangeStart + index));
  const birthDateMonthOptions = Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label: new Date(0, index).toLocaleString('fr-FR', { month: 'long' }),
  }));
  const birthDateDayOptions = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'));
  const parseDateParts = (value: string) => {
    const [year = '', month = '', day = ''] = value.split('-');
    return { year, month, day };
  };
  const formatDateParts = (day: string, month: string, year: string) => {
    return year && month && day ? `${year}-${month}-${day}` : '';
  };

  const handleSaveNewParent = async () => {
    setStudentError(null);
    if (!newParentForm.name.trim() || !newParentForm.email.trim() || !newParentForm.phone.trim()) {
      setStudentError('Le parent rattaché doit contenir un nom, un email et un téléphone.');
      return;
    }
    const newParentPhoneDigits = newParentForm.phone.replace(/\D/g, '');
    if (newParentForm.phonePrefix === '+228' && !/^[0-9]{8}$/.test(newParentPhoneDigits)) {
      setStudentError('Le numéro de téléphone du parent doit contenir exactement 8 chiffres pour +228.');
      return;
    }

    try {
      const simSchoolId = getSimulatedSchoolId();
      const targetSchoolId = userRole === 'school_admin'
        ? (currentSchoolId ?? simSchoolId ?? schoolsList[0]?.id)
        : parseInt(newParentForm.schoolId);
      if (!targetSchoolId) {
        setStudentError('L’école du parent doit être sélectionnée.');
        return;
      }
      const createdParent = await onAddParent({
        name: newParentForm.name,
        email: newParentForm.email,
        phone: `${newParentForm.phonePrefix} ${newParentForm.phone}`,
        address: newParentForm.address,
        schoolId: targetSchoolId,
        gender: newParentForm.gender,
      });
      const resolvedParentId = createdParent?.parentId || createdParent?.id;
      if (!resolvedParentId) {
        setStudentError('Impossible de créer le parent rattaché.');
        return;
      }

      setStudentForm((prev) => ({ ...prev, parentId: String(resolvedParentId) }));
      setNewParentMode(false);
      setNewParentForm({ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '', gender: '' });
    } catch (err: any) {
      setStudentError(err?.message || 'Erreur lors de la création du parent.');
      console.error('Failed to save new parent:', err);
    }
  };

  const handleSaveNewTeacher = async () => {
    setStudentError(null);
    const simSchoolId = getSimulatedSchoolId();
    const targetSchoolId = userRole === 'school_admin'
      ? (currentSchoolId ?? simSchoolId ?? schoolsList[0]?.id)
      : parseInt(newTeacherForm.schoolId);

    if (!newTeacherForm.name.trim() || !newTeacherForm.email.trim() || !newTeacherForm.phone.trim()) {
      setStudentError('L’enseignant doit contenir un nom, un email et un téléphone.');
      return;
    }
    if (userRole !== 'school_admin' && !newTeacherForm.schoolId) {
      setStudentError('L’enseignant doit contenir une école.');
      return;
    }
    if (!targetSchoolId) {
      setStudentError('Impossible de déterminer l’école de l’enseignant.');
      return;
    }

    const phoneDigits = newTeacherForm.phone.trim();
    if (!/^[0-9]{8}$/.test(phoneDigits)) {
      setStudentError('Le numéro de téléphone de l’enseignant doit contenir exactement 8 chiffres.');
      return;
    }

    if (!Array.isArray(newTeacherForm.assignedClassIds) || newTeacherForm.assignedClassIds.length === 0) {
      setStudentError("L'enseignant doit être affecté à au moins une classe.");
      return;
    }

    try {
      const createdTeacher = await onAddTeacher({
        name: newTeacherForm.name,
        email: newTeacherForm.email,
        phone: `+228 ${phoneDigits}`,
        specialization: newTeacherForm.specializations,
        schoolId: targetSchoolId,
        classIds: newTeacherForm.assignedClassIds,
        gender: newTeacherForm.gender,
      });
      const resolvedTeacherId = createdTeacher?.teacherId || createdTeacher?.id;
      if (!resolvedTeacherId) {
        setStudentError('Impossible de créer l’enseignant.');
        return;
      }

      setStudentForm({ ...studentForm, teacherId: String(resolvedTeacherId) });
      setNewTeacherMode(false);
      setNewTeacherForm({ name: '', email: '', phone: '', specializations: [], schoolId: '', assignedClassIds: [], gender: '' });
    } catch (err: any) {
      setStudentError(err?.message || 'Erreur lors de la création de l’enseignant.');
      console.error('Failed to save new teacher:', err);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'schools') {
      // Validate school phone has exactly 8 digits
      const phoneDigits = schoolForm.phoneDigits.trim();
      if (!phoneDigits || phoneDigits.length !== 8 || !/^[0-9]{8}$/.test(phoneDigits)) {
        setStudentError('Le numéro de téléphone doit contenir exactement 8 chiffres.');
        return;
      }
      const fullPhone = `+228 ${phoneDigits}`;
      const selectedClassNames = (schoolForm.selectedClassNames || []).filter((name) => name.trim() !== '');
      try {
        await onAddSchool({ name: schoolForm.name, address: schoolForm.address, phone: fullPhone, classNames: selectedClassNames });
        setSchoolForm({ name: '', address: '', phone: '', phoneDigits: '', selectedClassNames: [] });
        setStudentError(null);
        setIsModalOpen(false);
        setSearchQuery('');
      } catch (err: any) {
        setStudentError(err?.message || 'Impossible d’ajouter l’école.');
      }
    } else if (activeTab === 'years') {
      if (userRole !== 'super_admin') {
        setStudentError('Seul le super admin peut créer des années scolaires globales.');
        return;
      }

      onAddYear({
        name: yearForm.name,
        isActive: yearForm.isActive,
      });
      setYearForm({ name: '2026-2027', isActive: true, schoolId: '' });
    } else if (activeTab === 'classes') {
      const className = [classForm.cycle, classForm.stream, classForm.section, classForm.group].filter(Boolean).join(' ');
      if (!classForm.schoolId) {
        setStudentError('Veuillez sélectionner une école pour la classe.');
        return;
      }
      if (!className.trim()) {
        setStudentError('Veuillez sélectionner au moins un champ pour créer une classe.');
        return;
      }
      const schoolId = parseInt(classForm.schoolId);
      // Check for duplicate class name in the same school and academic year
      const isDuplicate = classesList.some(c => 
        c.name.trim() === className.trim() && 
        c.schoolId === schoolId && 
        c.academicYearId === defaultAcademicYearId
      );
      if (isDuplicate) {
        setStudentError(`Une classe nommée "${className}" existe déjà dans cette école pour cette année académique.`);
        return;
      }
      try {
        await onAddClass({
          name: className,
          schoolId,
          academicYearId: defaultAcademicYearId,
          teacherId: undefined,
        });
        setClassForm({ cycle: '', stream: '', section: '', group: '', schoolId: '' });
        setStudentError(null);
        setActiveTab('classes');
        setIsModalOpen(false);
        return;
      } catch (err: any) {
        setStudentError(`Erreur lors de la création: ${err?.message || 'Vérifiez que la classe n\'existe pas déjà.'}`);
      }
    } else if (activeTab === 'teachers') {
      const simSchoolId = getSimulatedSchoolId();
      const teacherSchoolId = userRole === 'school_admin'
        ? (currentSchoolId ?? simSchoolId ?? schoolsList[0]?.id)
        : parseInt(teacherForm.schoolId);
      if (!teacherForm.name.trim() || !teacherForm.email.trim() || !teacherForm.phone.trim()) {
        setStudentError('L’enseignant doit contenir un nom, un email et un téléphone.');
        return;
      }
      if (userRole !== 'school_admin' && !teacherForm.schoolId) {
        setStudentError('Veuillez sélectionner une école pour l’enseignant.');
        return;
      }
      if (!teacherSchoolId) {
        setStudentError('Impossible de déterminer l’école de l’enseignant.');
        return;
      }
      const phoneDigits = teacherForm.phone.trim();
      if (!phoneDigits || phoneDigits.length !== 8 || !/^\d{8}$/.test(phoneDigits)) {
        setStudentError('Le numéro de téléphone de l’enseignant doit contenir exactement 8 chiffres.');
        return;
      }
      if (!Array.isArray(teacherForm.assignedClassIds) || teacherForm.assignedClassIds.length === 0) {
        setStudentError("L'enseignant doit être affecté à au moins une classe.");
        return;
      }
      await onAddTeacher({
        name: teacherForm.name,
        email: teacherForm.email,
        phone: `+228 ${phoneDigits}`,
        specialization: teacherForm.specializations,
        schoolId: teacherSchoolId,
        classIds: teacherForm.assignedClassIds,
        gender: teacherForm.gender,
      });
      setTeacherForm({ name: '', email: '', phone: '', specializations: [], schoolId: userRole === 'school_admin' ? String(currentSchoolId || schoolsList[0]?.id || '') : '', assignedClassIds: [], gender: '' });
    } else if (activeTab === 'parents') {
      if (!parentForm.schoolId) {
        setStudentError('Veuillez sélectionner une école pour le parent.');
        return;
      }
      if (!parentForm.studentId) {
        setStudentError('Veuillez sélectionner l’élève rattaché.');
        return;
      }
      const parentPhoneDigits = parentForm.phone.replace(/\D/g, '');
      if (parentForm.phonePrefix === '+228' && !/^[0-9]{8}$/.test(parentPhoneDigits)) {
        setStudentError('Le numéro de téléphone du parent doit contenir exactement 8 chiffres pour +228.');
        return;
      }
      await onAddParent({
        name: parentForm.name,
        email: parentForm.email,
        phone: `${parentForm.phonePrefix} ${parentPhoneDigits}`,
        address: parentForm.address,
        schoolId: parseInt(parentForm.schoolId),
        studentId: parseInt(parentForm.studentId),
        gender: parentForm.gender,
      });
      setParentForm({ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: userRole === 'school_admin' ? String(currentSchoolId || schoolsList[0]?.id || '') : '', studentId: '', gender: '' });
    } else if (activeTab === 'students') {
      const simSchoolId = getSimulatedSchoolId();
      const targetSchoolId = parseInt(studentForm.schoolId) || (userRole === 'school_admin' ? (currentSchoolId ?? simSchoolId ?? schoolsList[0]?.id) : schoolsList[0]?.id);
      const selectedSchoolAdminId = studentForm.schoolAdminId ? parseInt(studentForm.schoolAdminId) : undefined;

      if (newParentMode) {
        if (!newParentForm.name.trim() || !newParentForm.email.trim() || !newParentForm.phone.trim()) {
          setStudentError('Le parent rattaché doit contenir un nom, un email et un téléphone.');
          return;
        }
        const createdParent = await onAddParent({
          name: newParentForm.name,
          email: newParentForm.email,
          phone: `${newParentForm.phonePrefix} ${newParentForm.phone}`,
          address: newParentForm.address,
          schoolId: targetSchoolId,
        });
        const resolvedParentId = createdParent?.parentId || createdParent?.id;
        if (!resolvedParentId) {
          setStudentError('Impossible de créer le parent rattaché.');
          return;
        }
        setStudentForm({ ...studentForm, parentId: String(resolvedParentId) });
        setNewParentMode(false);
        setNewParentForm({ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '' });
        setStudentError(null);
        return;
      }

      if (newTeacherMode) {
        if (!newTeacherForm.name.trim() || !newTeacherForm.email.trim() || !newTeacherForm.phone.trim()) {
          setStudentError('L’enseignant doit contenir un nom, un email et un téléphone.');
          return;
        }
        const createdTeacher = await onAddTeacher({
          ...newTeacherForm,
          schoolId: targetSchoolId,
        });
        const resolvedTeacherId = createdTeacher?.teacherId || createdTeacher?.id;
        if (!resolvedTeacherId) {
          setStudentError('Impossible de créer l’enseignant.');
          return;
        }
        setStudentForm({ ...studentForm, teacherId: String(resolvedTeacherId) });
        setNewTeacherMode(false);
        setNewTeacherForm({ name: '', email: '', phone: '', specializations: [], gender: '' });
        setStudentError(null);
        return;
      }

      if (userRole === 'super_admin' && !selectedSchoolAdminId) {
        setStudentError('Un compte Admin École doit être sélectionné pour chaque élève.');
        return;
      }

      const resolvedParentId = studentForm.parentId ? parseInt(studentForm.parentId) : undefined;
      const resolvedTeacherIds = studentForm.teacherIds && studentForm.teacherIds.length > 0 ? studentForm.teacherIds : undefined;

      setStudentError(null);
      await onAddStudent({
        firstName: studentForm.firstName,
        lastName: studentForm.lastName,
        birthDate: studentForm.birthDate,
        schoolId: targetSchoolId,
        classId: parseInt(studentForm.classId) || classesList[0]?.id,
        parentId: resolvedParentId,
        academicYearId: parseInt(studentForm.academicYearId) || yearsList[0]?.id,
        teacherIds: resolvedTeacherIds,
        schoolAdminId: selectedSchoolAdminId,
        gender: studentForm.gender,
      });
      setStudentForm({ firstName: '', lastName: '', birthDate: '', schoolId: '', classId: '', parentId: '', academicYearId: '', teacherIds: [], schoolAdminId: '', gender: '' });
      setNewParentMode(false);
      setNewParentForm({ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '', gender: '' });
      setNewTeacherMode(false);
      setNewTeacherForm({ name: '', email: '', phone: '', specializations: [], gender: '' });
    }
    setIsModalOpen(false);
  };

  const downloadTemplate = () => {
    // public endpoint that returns a CSV template
    window.open('/api/students/template', '_blank');
  };

  const downloadParentsTemplate = () => {
    window.open('/api/parents/template', '_blank');
  };

  const parentHandleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = (file.name || '').toLowerCase();
    try {
      let records: any[] = [];
      if (name.endsWith('.csv')) {
        const text = await file.text();
        // reuse CSV parser from students area (simple RFC4180-ish)
        const delimiter = text.indexOf(';') >= 0 && text.indexOf(',') === -1 ? ';' : ',';
        const rows: string[][] = [];
        let cur = '';
        let row: string[] = [];
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQuotes) {
            if (ch === '"') {
              if (text[i+1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
            } else { cur += ch; }
          } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === delimiter) { row.push(cur); cur = ''; }
            else if (ch === '\n' || ch === '\r') {
              if (cur !== '' || row.length > 0) { row.push(cur); cur = ''; rows.push(row); row = []; }
            } else { cur += ch; }
          }
        }
        if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
        const header = (rows[0] || []).map((h) => String(h || '').trim());
        const recordsArr: any[] = [];
        for (let i = 1; i < rows.length; i++) {
          const r: any = {};
          for (let j = 0; j < header.length; j++) {
            r[header[j]] = rows[i][j] ?? '';
          }
          recordsArr.push(r);
        }
        records = recordsArr;
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const first = wb.SheetNames[0];
        const sheet = wb.Sheets[first];
        records = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];
      } else {
        setImportErrorsList(['Format de fichier non supporté. Utilisez CSV ou Excel.']);
        setImportPreviewRecords([]);
        setImportPreviewHeaders([]);
        setImportRowErrors(null);
        setShowImportDetails(true);
        return;
      }

      if (!records || records.length === 0) {
        setImportErrorsList(['Aucun enregistrement trouvé dans ce fichier.']);
        setImportPreviewRecords([]);
        setImportPreviewHeaders([]);
        setImportRowErrors(null);
        setShowImportDetails(true);
        return;
      }

      // Validate parent-specific columns
      const headerKeys = Object.keys(records[0] || {});
      const missing: string[] = [];
      ['name','email'].forEach((h) => { if (!headerKeys.includes(h)) missing.push(h); });
      if (missing.length > 0) {
        setImportErrorsList([`Colonnes manquantes pour parents: ${missing.join(', ')}`]);
        setImportPreviewRecords([]);
        setImportPreviewHeaders(headerKeys);
        setImportRowErrors(null);
        setShowImportDetails(true);
        return;
      }

      // normalize: trim, lowercase email
      const normalized = records.map((r) => {
        const out: any = {};
        Object.keys(r || {}).forEach((k) => { out[k] = String(r[k] ?? '').trim(); });
        if (out.email) out.email = out.email.toLowerCase();
        if (out.phone) out.phone = out.phone.replace(/\D/g, '');
        return out;
      });

      // validate rows (email format)
      const rowErrors: {row:number; errors:string[]}[] = [];
      const valid: any[] = [];
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (let i = 0; i < normalized.length; i++) {
        const r = normalized[i];
        const errs: string[] = [];
        if (!r.name) errs.push('name manquant');
        if (!r.email) errs.push('email manquant');
        else if (!emailRe.test(r.email)) errs.push('email invalide');
        if (r.phone && r.phone.length !== 8) errs.push('phone doit contenir 8 chiffres');
        if (errs.length > 0) rowErrors.push({ row: i, errors: errs }); else valid.push(r);
      }

      if (rowErrors.length > 0) {
        setImportRowErrors(rowErrors);
        setImportErrorsList([`${rowErrors.length} lignes contiennent des erreurs`]);
      } else {
        setImportRowErrors(null);
        setImportErrorsList(null);
      }

      setValidImportRecords(valid.length > 0 ? valid : null);
      setImportPreviewRecords(normalized.slice(0, 100));
      setImportPreviewHeaders(Object.keys(normalized[0] || {}));
      setShowImportDetails(true);

    } catch (err: any) {
      setImportErrorsList([err?.message || 'Erreur lors de la lecture du fichier']);
      setImportPreviewRecords([]);
      setImportPreviewHeaders([]);
      setImportRowErrors(null);
      setShowImportDetails(true);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = (file.name || '').toLowerCase();
    try {
      if (name.endsWith('.csv')) {
        const text = await file.text();
        // Robust CSV parsing (RFC4180-ish): handles quoted fields and escaped quotes
        const parseCSV = (csvText: string) => {
          if (!csvText) return [] as string[][];
          // strip BOM
          if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1);
          const delimiter = csvText.indexOf(';') >= 0 && csvText.indexOf(',') === -1 ? ';' : ',';
          const rows: string[][] = [];
          let cur: string = '';
          let row: string[] = [];
          let inQuotes = false;
          for (let i = 0; i < csvText.length; i++) {
            const ch = csvText[i];
            if (inQuotes) {
              if (ch === '"') {
                if (csvText[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
              } else {
                cur += ch;
              }
            } else {
              if (ch === '"') {
                inQuotes = true;
              } else if (ch === delimiter) {
                row.push(cur);
                cur = '';
              } else if (ch === '\r') {
                // ignore CR, will handle on LF
              } else if (ch === '\n') {
                row.push(cur);
                rows.push(row);
                row = [];
                cur = '';
              } else {
                cur += ch;
              }
            }
          }
          // push last
          if (inQuotes) {
            row.push(cur);
            rows.push(row);
          } else if (cur !== '' || row.length > 0) {
            row.push(cur);
            rows.push(row);
          }
          return rows;
        };
        const rows = parseCSV(text).filter(r => r.some((c) => c !== undefined && String(c).trim() !== ''));
        if (rows.length <= 1) {
          setImportErrorsList(['Aucun enregistrement trouvé dans ce fichier CSV. Vérifiez le format et la présence d’une ligne d’en-tête.']);
          setImportPreviewRecords([]);
          setImportPreviewHeaders([]);
          setImportRowErrors(null);
          setShowImportDetails(true);
          return;
        }
        const header = rows.shift()!.map((h) => String(h || '').trim());
        const records: any[] = rows.map((cols) => {
          const obj: any = {};
          for (let i = 0; i < header.length; i++) {
            obj[header[i]] = String(cols[i] ?? '').trim();
          }
          return obj;
        }).filter((r) => r.firstName && r.lastName);
        if (records.length === 0) {
          setImportErrorsList(['Aucune ligne valide trouvée. Vérifiez que les colonnes firstName et lastName sont présentes et remplies.']);
          setImportPreviewRecords([]);
          setImportPreviewHeaders(header);
          setImportRowErrors(null);
          setShowImportDetails(true);
          return;
        }
        const required = ['firstName', 'lastName', 'birthDate', 'schoolId', 'classId'];
        const present = Object.keys(records[0] || {}).map((k) => String(k).trim());
        const missing = required.filter((r) => !present.includes(r));
        if (missing.length > 0) {
          setImportErrorsList([`Colonnes manquantes: ${missing.join(', ')}`]);
          setImportPreviewRecords(records.slice(0, 20));
          setImportPreviewHeaders(present);
          setImportRowErrors(null);
          setShowImportDetails(true);
        } else {
          const normalized = normalizeRecords(records);
          const { rowErrors, summary } = validateRecords(normalized);
          const invalidIndexes = new Set(rowErrors.map((r) => r.row));
          const validRecords = normalized.filter((_, idx) => !invalidIndexes.has(idx));
          const previewRecords = validRecords.length > 0 ? validRecords : normalized;
          const messages = [] as string[];
          if (rowErrors.length > 0) {
            messages.push(`${validRecords.length} ligne(s) valides, ${rowErrors.length} ligne(s) invalides`);
          }
          if (summary.length > 0) {
            messages.push(...summary);
          }
          setValidImportRecords(validRecords.length > 0 ? validRecords : null);
          setImportRowErrors(rowErrors.length > 0 ? rowErrors : null);
          setImportErrorsList(messages.length > 0 ? messages : null);
          setImportPreviewRecords(previewRecords.slice(0, 100));
          setImportPreviewHeaders(Object.keys(normalized[0] || {}));
          setShowImportDetails(true);
        }
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          setImportErrorsList(['Aucune feuille trouvée dans le fichier Excel.']);
          setImportPreviewRecords([]);
          setImportPreviewHeaders([]);
          setImportRowErrors(null);
          setShowImportDetails(true);
        } else {
          const json: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          const records = json.map((row) => {
            const obj: any = {};
            Object.keys(row).forEach((k) => { obj[String(k).trim()] = String(row[k] ?? '').trim(); });
            return obj;
          }).filter((r) => r.firstName && r.lastName);
          if (records.length === 0) {
            setImportErrorsList(['Aucune ligne valide trouvée. Vérifiez que les colonnes firstName et lastName sont présentes et remplies.']);
            setImportPreviewRecords([]);
            setImportPreviewHeaders(Object.keys(json[0] || {}).map((k) => String(k).trim()));
            setImportRowErrors(null);
            setShowImportDetails(true);
          } else {
            const required = ['firstName', 'lastName', 'birthDate', 'schoolId', 'classId'];
            const present = Object.keys(records[0] || {}).map((k) => String(k).trim());
            const missing = required.filter((r) => !present.includes(r));
            if (missing.length > 0) {
              setValidImportRecords(null);
              setImportErrorsList([`Colonnes manquantes: ${missing.join(', ')}`]);
              setImportPreviewRecords(records.slice(0, 20));
              setImportPreviewHeaders(present);
              setImportRowErrors(null);
              setShowImportDetails(true);
            } else {
              const normalized = normalizeRecords(records);
              const { rowErrors, summary } = validateRecords(normalized);
              const invalidIndexes = new Set(rowErrors.map((r) => r.row));
              const validRecords = normalized.filter((_, idx) => !invalidIndexes.has(idx));
              const previewRecords = validRecords.length > 0 ? validRecords : normalized;
              const messages = [] as string[];
              if (rowErrors.length > 0) {
                messages.push(`${validRecords.length} ligne(s) valides, ${rowErrors.length} ligne(s) invalides`);
              }
              if (summary.length > 0) {
                messages.push(...summary);
              }
              setValidImportRecords(validRecords.length > 0 ? validRecords : null);
              setImportRowErrors(rowErrors.length > 0 ? rowErrors : null);
              setImportErrorsList(messages.length > 0 ? messages : null);
              setImportPreviewRecords(previewRecords.slice(0, 100));
              setImportPreviewHeaders(Object.keys(normalized[0] || {}));
              setShowImportDetails(true);
            }
          }
        }
      } else {
        setImportErrorsList(['Type de fichier non supporté. Utilisez un fichier .csv, .xlsx ou .xls.']);
        setImportPreviewRecords([]);
        setImportPreviewHeaders([]);
        setImportRowErrors(null);
        setShowImportDetails(true);
      }
    } finally {
      // reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const [showImportDetails, setShowImportDetails] = useState(false);
  const [validImportRecords, setValidImportRecords] = useState<any[] | null>(null);
  const [importPreviewRecords, setImportPreviewRecords] = useState<any[] | null>(null);
  const [importPreviewHeaders, setImportPreviewHeaders] = useState<string[] | null>(null);
  const [importErrorsList, setImportErrorsList] = useState<string[] | null>(null);
  const [importRowErrors, setImportRowErrors] = useState<{row: number; errors: string[]}[] | null>(null);

  const confirmImport = async () => {
    if (!importPreviewRecords || importPreviewRecords.length === 0) return;
    if (activeTab === 'parents') {
      const recordsToImport = validImportRecords && validImportRecords.length > 0 ? validImportRecords : importPreviewRecords;
      try {
        if (onBatchCreateParents) await onBatchCreateParents(recordsToImport || []);
      } finally {
        setValidImportRecords(null);
        setImportPreviewRecords(null);
        setImportPreviewHeaders(null);
        setImportErrorsList(null);
        setImportRowErrors(null);
        setShowImportDetails(false);
      }
      return;
    }

    // students flow
    const recordsToImport = validImportRecords && validImportRecords.length > 0 ? validImportRecords : importPreviewRecords;
    const normalized = normalizeRecords(recordsToImport);
    const { rowErrors, summary } = validateRecords(normalized);
    if (rowErrors.length > 0) {
      // show errors and halt import if validation still fails
      setImportRowErrors(rowErrors);
      setImportErrorsList(summary.length > 0 ? summary : null);
      setImportPreviewRecords(normalized.slice(0, 100));
      setImportPreviewHeaders(Object.keys(normalized[0] || {}));
      return;
    }
    try {
      if (onBatchCreateStudents) await onBatchCreateStudents(normalized);
    } finally {
      setValidImportRecords(null);
      setImportPreviewRecords(null);
      setImportPreviewHeaders(null);
      setImportErrorsList(null);
      setImportRowErrors(null);
      setShowImportDetails(false);
    }
  };
  const getDefaultNewUserForm = () => ({
    uid: '',
    email: '',
    name: '',
    role: userRole === 'super_admin' ? 'school_admin' : 'teacher',
    schoolId: userRole === 'school_admin' ? String(currentSchoolId || '') : '',
    academicYearId: '',
    phone: '',
    specialization: [] as string[],
    gender: '',
  });
  const [showCreateUserForm, setShowCreateUserForm] = useState(false);
  const [newUserForm, setNewUserForm] = useState(getDefaultNewUserForm);
  const [newUserAssignedClassIds, setNewUserAssignedClassIds] = useState<number[]>([]);
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState('');
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [createdUserPreview, setCreatedUserPreview] = useState<any | null>(null);
  const [showCreatedUserPreview, setShowCreatedUserPreview] = useState(false);
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [studentDetail, setStudentDetail] = useState<Student | null>(null);
  const [teacherDetailOpen, setTeacherDetailOpen] = useState(false);
  const [teacherDetail, setTeacherDetail] = useState<Teacher | null>(null);
  const [parentDetailOpen, setParentDetailOpen] = useState(false);
  const [parentDetail, setParentDetail] = useState<Parent | null>(null);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({ email: '', name: '', role: 'teacher', schoolId: '' , academicYearId: '', phone: '', specialization: '', gender: '', assignedClassIds: [] as number[] });
  const [editUserPassword, setEditUserPassword] = useState('');
  const [editUserPasswordConfirm, setEditUserPasswordConfirm] = useState('');
  const [editUserError, setEditUserError] = useState<string | null>(null);
  const [deleteUserOpen, setDeleteUserOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteUserError, setDeleteUserError] = useState<string | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [deleteUserSuccess, setDeleteUserSuccess] = useState(false);

  // States for school editing
  const [editSchoolOpen, setEditSchoolOpen] = useState(false);
  const [schoolToEdit, setSchoolToEdit] = useState<School | null>(null);
  const [editSchoolError, setEditSchoolError] = useState<string | null>(null);

  // States for student editing
  const [editStudentOpen, setEditStudentOpen] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState<Student | null>(null);
  const [editStudentForm, setEditStudentForm] = useState({ firstName: '', lastName: '', birthDate: '', schoolId: '', classId: '', parentId: '', academicYearId: '', teacherIds: [] as number[], schoolAdminId: '', gender: '' });
  const [editStudentError, setEditStudentError] = useState<string | null>(null);

  // treat any open modal/panel as blocking the global search input
  const anyModalOpen = (
    showImportDetails || showCreateUserForm || showCreatedUserPreview || studentDetailOpen || teacherDetailOpen || parentDetailOpen || editUserOpen || deleteUserOpen || editSchoolOpen || editStudentOpen || isModalOpen || newParentMode || newTeacherMode
  );

  // close all modals/panels (used by clicking the global overlay)
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmMessage, setConfirmMessage] = React.useState('');
  const [onConfirmAction, setOnConfirmAction] = React.useState<() => void>(() => () => {});

  const performCloseAllModals = () => {
    setShowImportDetails(false);
    setShowCreateUserForm(false);
    setShowCreatedUserPreview(false);
    setEditUserOpen(false);
    setDeleteUserOpen(false);
    setEditSchoolOpen(false);
    setEditStudentOpen(false);
    setTeacherDetailOpen(false);
    setTeacherDetail(null);
    setParentDetailOpen(false);
    setParentDetail(null);
    setIsModalOpen(false);
  };

  const closeAllModals = () => {
    // detect unsaved changes in common forms
    const formHasValues = (obj: any) => Object.values(obj || {}).some((v: any) => String(v || '').trim() !== '');
    const newUserDirty = showCreateUserForm && (formHasValues(newUserForm) || newUserPassword.trim() !== '' || newUserPasswordConfirm.trim() !== '');
    const studentFormDirty = isModalOpen && formHasValues(studentForm);
    const editStudentDirty = editStudentOpen && formHasValues(editStudentForm);
    const yearFormDirty = formHasValues(yearForm);

    const hasUnsaved = newUserDirty || studentFormDirty || editStudentDirty || yearFormDirty;
    if (hasUnsaved) {
      setConfirmMessage(
        "Vous avez des modifications non sauvegardées dans le formulaire. Si vous fermez maintenant, ces données seront perdues. Voulez-vous vraiment continuer et fermer ?"
      );
      setOnConfirmAction(() => performCloseAllModals);
      setConfirmOpen(true);
      return;
    }

    setStudentDetailOpen(false);
    setStudentDetail(null);
    performCloseAllModals();
  };

  const openStudentDetail = (student: Student) => {
    setStudentDetail(student);
    setStudentDetailOpen(true);
  };

  const openTeacherDetail = (teacher: Teacher) => {
    setTeacherDetail(teacher);
    setTeacherDetailOpen(true);
  };

  const openParentDetail = (parent: Parent) => {
    setParentDetail(parent);
    setParentDetailOpen(true);
  };

  // keep local parts in sync so partial selections are visible immediately
  useEffect(() => {
    const p = parseDateParts(studentForm.birthDate);
    setStudentBDay(p.day || ''); setStudentBMonth(p.month || ''); setStudentBYear(p.year || '');
  }, [studentForm.birthDate]);
  useEffect(() => {
    const p = parseDateParts(editStudentForm.birthDate);
    setEditBDay(p.day || ''); setEditBMonth(p.month || ''); setEditBYear(p.year || '');
  }, [editStudentForm.birthDate]);

  const selectedEditStudentSchoolId = editStudentForm.schoolId ? parseInt(editStudentForm.schoolId) : undefined;
  const availableEditSchoolAdmins = usersList.filter((u) => u.role === 'school_admin' && (!selectedEditStudentSchoolId || u.schoolId === selectedEditStudentSchoolId));

  return (
    <div className="space-y-6" id="admin-view">
      <input
        type="file"
        ref={fileInputRef}
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        type="file"
        ref={parentFileInputRef}
        accept=".xlsx,.xls,.csv"
        onChange={parentHandleFileChange}
        className="hidden"
      />
      {/* Global overlay shown when any modal/panel is open (animated) */}
      <div
        aria-hidden={!anyModalOpen}
        onClick={closeAllModals}
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${anyModalOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="w-full h-full bg-black/40 cursor-pointer" />
      </div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Module Administration Scolaire</h2>
          <p className="text-sm text-slate-500">Gérez les établissements, les classes, les enseignants, les élèves et les tuteurs légaux</p>
        </div>
        
        {/* Only enable some global setup if super/school admin */}
        {['super_admin', 'school_admin'].includes(userRole) && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {userRole === 'super_admin' && activeTab === 'students' && (
              <button
                onClick={() => {
                  // Pre-fill default selectors in forms
                  if (schoolsList.length > 0) {
                    setYearForm({ ...yearForm, schoolId: String(schoolsList[0].id) });
                    // Only preselect the academic year by default. Do not auto-select school/class/parent.
                    setStudentForm((prev) => ({ ...prev, academicYearId: String(yearsList[0]?.id || '') }));
                  }
                  setStudentError(null);
                  setIsModalOpen(true);
                }}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md shadow-indigo-600/10 transition-colors cursor-pointer w-full sm:w-auto justify-center"
                id="btn-admin-add"
              >
                <Plus className="h-4.5 w-4.5" />
                <span>Nouveau Registre</span>
              </button>
            )}

            {activeTab === 'students' && (
              <>
                <button
                  onClick={downloadTemplate}
                  className="hidden sm:inline-flex items-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs px-3 py-2 rounded-lg border border-slate-100"
                  title="Télécharger un modèle Excel d'exemple"
                >
                  Modèle Excel
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="hidden sm:inline-flex items-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs px-3 py-2 rounded-lg border border-slate-100"
                  title="Importer Excel"
                >
                  Importer Excel
                </button>
              </>
            )}

            {activeTab === 'parents' && (
              <>
                <button
                  onClick={downloadParentsTemplate}
                  className="hidden sm:inline-flex items-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs px-3 py-2 rounded-lg border border-slate-100"
                  title="Télécharger le modèle Parents"
                >
                  Modèle Parents
                </button>

                <button
                  onClick={() => parentFileInputRef.current?.click()}
                  className="hidden sm:inline-flex items-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs px-3 py-2 rounded-lg border border-slate-100"
                  title="Importer Parents"
                >
                  Importer Parents
                </button>
              </>
            )}
          </div>
        )}

        {/* Edit School Modal */}
        {editSchoolOpen && schoolToEdit && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4 z-50 overflow-x-hidden">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4 text-slate-800">Modifier l'école</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    <RequiredLabel label="Nom de l'établissement" required />
                  </label>
                  <input
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                    placeholder="C.S LE SAVOIR"
                    value={editSchoolForm.name}
                    onChange={(e) => setEditSchoolForm({ ...editSchoolForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Adresse</label>
                  <input
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                    placeholder="ex. 123 Rue de l'École"
                    value={editSchoolForm.address}
                    onChange={(e) => setEditSchoolForm({ ...editSchoolForm, address: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Téléphone</label>
                  <div className="flex gap-2">
                    <input type="text" disabled value="+228" className="w-20 px-3 py-2 bg-slate-200 border border-slate-300 text-slate-700 rounded-xl font-bold cursor-not-allowed" />
                    <input
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-slate-800 focus:outline-indigo-500"
                      placeholder="90000000"
                      value={editSchoolForm.phoneDigits}
                      onChange={(e) => setEditSchoolForm({ ...editSchoolForm, phoneDigits: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                      maxLength={8}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Classes déjà assignées</label>
                  <div className="flex flex-wrap gap-2">
                    {schoolToEdit && Array.from(new Set(classesList.filter((c) => c.schoolId === schoolToEdit.id).map((c) => c.name).filter(Boolean))).length > 0 ? (
                      Array.from(new Set(classesList.filter((c) => c.schoolId === schoolToEdit.id).map((c) => c.name).filter(Boolean))).map((name) => (
                        <span key={name} className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-1 text-xs font-medium">
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">Aucune classe assignée actuellement.</span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ajouter des classes à cette école</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-auto border border-slate-200 rounded-xl bg-slate-50 p-3">
                    {Array.from(new Set(sortClasses(classesList || []).map((c) => c.name)))
                      .filter((name) => !classesList.some((c) => c.schoolId === schoolToEdit?.id && c.name === name))
                      .map((name) => (
                        <label key={name} className="flex items-center gap-2 rounded-xl px-3 py-2 cursor-pointer hover:bg-slate-100">
                          <input
                            type="checkbox"
                            checked={editSchoolForm.classNames.includes(name)}
                            onChange={(e) => {
                              const current = editSchoolForm.classNames || [];
                              const next = e.target.checked
                                ? [...current, name]
                                : current.filter((n) => n !== name);
                              setEditSchoolForm({ ...editSchoolForm, classNames: next });
                            }}
                            className="h-4 w-4 text-indigo-600 border-slate-300 rounded"
                          />
                          <span className="text-sm text-slate-700">{name}</span>
                        </label>
                      ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Sélectionnez les classes à ajouter à cette école si elles n'ont pas été créées lors de son enregistrement.</p>
                </div>
              </div>

              {editSchoolError && (
                <div className="mt-3 p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{editSchoolError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => {
                    setEditSchoolOpen(false);
                    setSchoolToEdit(null);
                    setEditSchoolError(null);
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={async () => {
                    try {
                      setEditSchoolError(null);
                      if (!editSchoolForm.name.trim()) {
                        setEditSchoolError('Le nom de l\'établissement est requis');
                        return;
                      }
                      if (onUpdateSchool && schoolToEdit) {
                        const phoneDigits = editSchoolForm.phoneDigits.trim();
                        if (phoneDigits && phoneDigits.length !== 8) {
                          setEditSchoolError('Le numéro de téléphone doit contenir exactement 8 chiffres.');
                          return;
                        }
                        await onUpdateSchool(schoolToEdit.id, {
                          name: editSchoolForm.name.trim(),
                          address: editSchoolForm.address.trim(),
                          phone: phoneDigits ? `+228 ${phoneDigits}` : '',
                          classNames: editSchoolForm.classNames?.filter((name) => name.trim() !== ''),
                        });
                        setEditSchoolOpen(false);
                        setSchoolToEdit(null);
                      }
                    } catch (err: any) {
                      setEditSchoolError(err?.message || 'Impossible de modifier l\'école');
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Student Modal */}
        {editStudentOpen && studentToEdit && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4 z-50 overflow-x-hidden">
              <div className="bg-white rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] relative">
                <h3 className="text-lg font-bold mb-4 text-slate-800">Modifier l'élève</h3>
                <div className={`space-y-3 text-sm max-h-[70vh] ${allowSelectOverflow ? 'overflow-visible' : 'overflow-auto'} pr-2`}>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    <RequiredLabel label="Prénom" required />
                  </label>
                  <input
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                    placeholder="ex. Koffi"
                    value={editStudentForm.firstName}
                    onChange={(e) => setEditStudentForm({ ...editStudentForm, firstName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    <RequiredLabel label="Nom" required />
                  </label>
                  <input
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                    placeholder="ex. ABALO"
                    value={editStudentForm.lastName}
                    onChange={(e) => setEditStudentForm({ ...editStudentForm, lastName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date de naissance</label>
                  <div className="grid grid-cols-3 gap-2">
                    <CustomDropdown
                      value={editBDay || parseDateParts(editStudentForm.birthDate).day}
                      options={birthDateDayOptions.map((d) => ({ value: d, label: d }))}
                      placeholder="Jour"
                      onChange={(v) => {
                        setEditBDay(v);
                        const m = editBMonth || parseDateParts(editStudentForm.birthDate).month;
                        const y = editBYear || parseDateParts(editStudentForm.birthDate).year;
                        if (v && m && y) setEditStudentForm({ ...editStudentForm, birthDate: formatDateParts(v, m, y) });
                      }}
                    />
                    <CustomDropdown
                      value={editBMonth || parseDateParts(editStudentForm.birthDate).month}
                      options={birthDateMonthOptions}
                      placeholder="Mois"
                      onChange={(v) => {
                        setEditBMonth(v);
                        const d = editBDay || parseDateParts(editStudentForm.birthDate).day;
                        const y = editBYear || parseDateParts(editStudentForm.birthDate).year;
                        if (d && v && y) setEditStudentForm({ ...editStudentForm, birthDate: formatDateParts(d, v, y) });
                      }}
                    />
                    <CustomDropdown
                      value={editBYear || parseDateParts(editStudentForm.birthDate).year}
                      options={birthDateYearOptions.map((y) => ({ value: y, label: y }))}
                      placeholder="Année"
                      onChange={(v) => {
                        setEditBYear(v);
                        const d = editBDay || parseDateParts(editStudentForm.birthDate).day;
                        const m = editBMonth || parseDateParts(editStudentForm.birthDate).month;
                        if (d && m && v) setEditStudentForm({ ...editStudentForm, birthDate: formatDateParts(d, m, v) });
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">École</label>
                  <select
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500 mb-2"
                    value={editStudentForm.schoolId}
                    onChange={(e) => setEditStudentForm({ ...editStudentForm, schoolId: e.target.value, classId: '' })}
                  >
                    <option value="">-- Sélectionner une école --</option>
                    {schoolsList.map((s) => (
                      <option key={s.id} value={String(s.id)}>{s.name}</option>
                    ))}
                  </select>

                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Année scolaire</label>
                  <select
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500 mb-2"
                    value={editStudentForm.academicYearId}
                    onChange={(e) => setEditStudentForm({ ...editStudentForm, academicYearId: e.target.value })}
                  >
                    <option value="">-- Sélectionner une année --</option>
                    {getYearsForSchool(editStudentForm.schoolId).map((y) => (
                      <option key={y.id} value={String(y.id)}>{y.name}</option>
                    ))}
                  </select>

                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Enseignants intervenant dans la classe (sélection multiple)</label>
                  <div className="space-y-2 mb-2">
                    {(() => {
                      const selectedClassId = editStudentForm.classId ? parseInt(editStudentForm.classId) : null;
                      if (!selectedClassId) return <p className="text-xs text-slate-500 italic">Veuillez d'abord sélectionner une classe</p>;
                      const classTeachers = teachersList.filter((t) => 
                        (!editStudentForm.schoolId || t.schoolId === parseInt(editStudentForm.schoolId)) &&
                        (t.classIds || []).includes(selectedClassId)
                      );
                      if (classTeachers.length === 0) return <p className="text-xs text-slate-500 italic">Aucun enseignant assigné à cette classe</p>;
                      return (
                        <>
                          {classTeachers.map((t) => (
                            <label key={t.id} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-slate-100">
                              <input
                                type="checkbox"
                                checked={(editStudentForm.teacherIds || []).includes(t.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setEditStudentForm({ ...editStudentForm, teacherIds: [...(editStudentForm.teacherIds || []), t.id] });
                                  } else {
                                    setEditStudentForm({ ...editStudentForm, teacherIds: (editStudentForm.teacherIds || []).filter(id => id !== t.id) });
                                  }
                                }}
                                className="w-4 h-4"
                              />
                              <span className="text-xs text-slate-700">{t.name}</span>
                            </label>
                          ))}
                          <button
                            type="button"
                            className="mt-2 text-xs text-indigo-600 font-semibold hover:underline"
                            onClick={() => {
                              const allTeacherIds = classTeachers.map((t) => t.id);
                              setEditStudentForm({ ...editStudentForm, teacherIds: allTeacherIds });
                            }}
                          >
                            Sélectionner tous
                          </button>
                        </>
                      );
                    })()}
                  </div>

                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    <RequiredLabel label="Classe" required />
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                    value={editStudentForm.classId}
                    onChange={(e) => setEditStudentForm({ ...editStudentForm, classId: e.target.value })}
                  >
                    <option value="">-- Sélectionner une classe --</option>
                    {sortedClasses.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    <RequiredLabel label="Parent / Tuteur" required />
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                    value={editStudentForm.parentId}
                    onChange={(e) => setEditStudentForm({ ...editStudentForm, parentId: e.target.value })}
                  >
                    <option value="">-- Sélectionner un parent --</option>
                    {parentsList.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Admin École</label>
                  <select
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                    value={editStudentForm.schoolAdminId}
                    onChange={(e) => setEditStudentForm({ ...editStudentForm, schoolAdminId: e.target.value })}
                  >
                    <option value="">-- Sélectionner un Admin École --</option>
                    {availableEditSchoolAdmins.map((a) => (
                      <option key={a.id} value={String(a.id)}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {editStudentError && (
                <div className="mt-3 p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{editStudentError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => {
                    setEditStudentOpen(false);
                    setStudentToEdit(null);
                    setEditStudentError(null);
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={async () => {
                    try {
                      setEditStudentError(null);
                      if (!editStudentForm.firstName.trim()) {
                        setEditStudentError('Le prénom est requis');
                        return;
                      }
                      if (!editStudentForm.lastName.trim()) {
                        setEditStudentError('Le nom est requis');
                        return;
                      }
                      if (!editStudentForm.classId) {
                        setEditStudentError('Une classe doit être sélectionnée');
                        return;
                      }
                      if (!editStudentForm.parentId) {
                        setEditStudentError('Un parent doit être sélectionné');
                        return;
                      }
                      if (onUpdateStudent && studentToEdit) {
                        await onUpdateStudent(studentToEdit.id, {
                          firstName: editStudentForm.firstName.trim(),
                          lastName: editStudentForm.lastName.trim(),
                          birthDate: editStudentForm.birthDate || null,
                          schoolId: editStudentForm.schoolId ? parseInt(editStudentForm.schoolId) : undefined,
                          classId: parseInt(editStudentForm.classId),
                          parentId: parseInt(editStudentForm.parentId),
                          academicYearId: editStudentForm.academicYearId ? parseInt(editStudentForm.academicYearId) : undefined,
                          teacherIds: editStudentForm.teacherIds && editStudentForm.teacherIds.length > 0 ? editStudentForm.teacherIds : undefined,
                          schoolAdminId: editStudentForm.schoolAdminId ? parseInt(editStudentForm.schoolAdminId) : undefined,
                        });
                        setEditStudentOpen(false);
                        setStudentToEdit(null);
                      }
                    } catch (err: any) {
                      setEditStudentError(err?.message || 'Impossible de modifier l\'élève');
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Deprecated popup removed; creation is inline now. */}
        {editUserOpen && userToEdit && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold mb-3">Modifier le compte</h3>
              <div className="space-y-3 text-sm">
                <input className="w-full p-2 border rounded" placeholder="Email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
                <input className="w-full p-2 border rounded" placeholder="M. Koffi" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
                <select className="w-full p-2 border rounded" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                  {userRole === 'super_admin' && (
                    <>
                      <option value="super_admin">Super Admin</option>
                      <option value="school_admin">Admin École</option>
                    </>
                  )}
                  <option value="teacher">Enseignant</option>
                  <option value="parent">Parent</option>
                </select>
                <select className="w-full p-2 border rounded" value={userForm.schoolId} onChange={(e) => setUserForm({ ...userForm, schoolId: e.target.value, assignedClassIds: userForm.role === 'teacher' ? [] : userForm.assignedClassIds })}>
                  <option value="">-- Sélectionner une école (optionnel) --</option>
                  {schoolsList.map((s) => (<option key={s.id} value={String(s.id)}>{s.name}</option>))}
                </select>
                {userForm.role === 'teacher' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Classes attribuées</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto border border-slate-200 rounded p-2 bg-slate-50 text-sm">
                      {(classesList || [])
                        .filter((c) => {
                          if (!userForm.schoolId) return true;
                          return c.schoolId === parseInt(userForm.schoolId, 10);
                        })
                        .map((cls) => (
                          <label key={cls.id} className="flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer hover:bg-slate-100 border border-transparent hover:border-slate-200">
                            <input
                              type="checkbox"
                              checked={userForm.assignedClassIds.includes(cls.id)}
                              onChange={() => {
                                if (userForm.assignedClassIds.includes(cls.id)) {
                                  setUserForm({ ...userForm, assignedClassIds: userForm.assignedClassIds.filter((id) => id !== cls.id) });
                                } else {
                                  setUserForm({ ...userForm, assignedClassIds: [...userForm.assignedClassIds, cls.id] });
                                }
                              }}
                              className="h-4 w-4 accent-indigo-600"
                            />
                            <span className="truncate">{cls.name}</span>
                          </label>
                        ))}
                      {(classesList || []).filter((c) => {
                        if (!userForm.schoolId) return true;
                        return c.schoolId === parseInt(userForm.schoolId, 10);
                      }).length === 0 && (
                        <div className="text-slate-500">Sélectionnez d'abord une école pour afficher les classes disponibles.</div>
                      )}
                    </div>
                    {userForm.assignedClassIds.length > 0 && (
                      <div className="mt-2 text-xs text-slate-700 bg-slate-100 p-2 rounded border border-slate-200">
                        <strong>Classes sélectionnées :</strong>{' '}
                        {(classesList || [])
                          .filter((cls) => userForm.assignedClassIds.includes(cls.id))
                          .map((cls) => cls.name)
                          .join(', ')}
                      </div>
                    )}
                  </div>
                )}
                {userForm.role === 'school_admin' && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Année scolaire</label>
                    <select
                      className="w-full p-2 border rounded"
                      value={userForm.academicYearId}
                      onChange={(e) => setUserForm({ ...userForm, academicYearId: e.target.value })}
                    >
                      <option value="">-- Choisir une année --</option>
                      {getYearsForSchool(userForm.schoolId).map((year) => (
                        <option key={year.id} value={String(year.id)}>{year.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {userForm.role !== 'parent' ? (
                  <div className="flex items-center border rounded overflow-hidden">
                    <span className="px-3 py-2 bg-slate-100 text-slate-500 text-sm font-medium">+228</span>
                    <input
                      className="flex-1 p-2 border-0 outline-none"
                      type="tel"
                      value={userForm.phone}
                      onChange={(e) => setUserForm({ ...userForm, phone: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                      placeholder="90000000"
                      maxLength={8}
                    />
                  </div>
                ) : (
                  <input
                    className="w-full p-2 border rounded"
                    type="tel"
                    value={userForm.phone}
                    onChange={(e) => setUserForm({ ...userForm, phone: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                    placeholder="90000000"
                    maxLength={8}
                  />
                )}
                <select className="w-full p-2 border rounded" value={userForm.specialization} onChange={(e) => setUserForm({ ...userForm, specialization: e.target.value })}>
                  <option value="">-- Choisissez une matière --</option>
                  {teacherSpecializations.map((subject) => (
                    <option key={subject} value={subject}>{subject}</option>
                  ))}
                </select>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Mot de passe (laissez vide pour ne pas modifier)</label>
                  <input
                    className="w-full p-2 border rounded"
                    type="password"
                    placeholder="Nouveau mot de passe"
                    value={editUserPassword}
                    onChange={(e) => setEditUserPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Confirmer mot de passe</label>
                  <input
                    className="w-full p-2 border rounded"
                    type="password"
                    placeholder="Confirmer le nouveau mot de passe"
                    value={editUserPasswordConfirm}
                    onChange={(e) => setEditUserPasswordConfirm(e.target.value)}
                  />
                </div>
                {editUserError && <div className="text-rose-600 text-sm">{editUserError}</div>}
                <div className="flex justify-end gap-2 mt-3">
                  <button className="px-3 py-2 rounded bg-slate-100" onClick={() => { setEditUserOpen(false); setUserToEdit(null); setEditUserError(null); }}>Annuler</button>
                  <button className="px-3 py-2 rounded bg-indigo-600 text-white" onClick={async () => {
                    try {
                      if (!onUpdateUser || !userToEdit) return;
                      setEditUserError(null);
                      if (!userForm.email.trim()) {
                        setEditUserError("L'email est requis");
                        return;
                      }
                      if (!userForm.name.trim()) {
                        setEditUserError('Le nom complet est requis');
                        return;
                      }
                      const rawPhoneDigits = userForm.phone.replace(/\D/g, '');
                      const normalizedPhoneDigits = rawPhoneDigits.length === 11 && rawPhoneDigits.startsWith('228')
                        ? rawPhoneDigits.slice(3)
                        : rawPhoneDigits;
                      if (userForm.phone && normalizedPhoneDigits.length !== 8) {
                        setEditUserError('Le numéro de téléphone doit contenir exactement 8 chiffres');
                        return;
                      }
                      if (editUserPassword && editUserPassword.length < 6) {
                        setEditUserError('Le mot de passe doit contenir au moins 6 caractères');
                        return;
                      }
                      if (editUserPassword && editUserPassword !== editUserPasswordConfirm) {
                        setEditUserError('Les mots de passe ne correspondent pas');
                        return;
                      }
                      await onUpdateUser(userToEdit.id, {
                        email: userForm.email.trim(),
                        name: userForm.name.trim(),
                        role: userForm.role,
                        schoolId: userForm.schoolId ? parseInt(userForm.schoolId) : undefined,
                        academicYearId: userForm.role === 'school_admin' && userForm.academicYearId ? parseInt(userForm.academicYearId) : undefined,
                        phone: userForm.phone ? (userForm.role !== 'parent' ? `+228${normalizedPhoneDigits}` : userForm.phone) : undefined,
                        specialization: userForm.specialization,
                        classIds: userForm.role === 'teacher' ? userForm.assignedClassIds : undefined,
                      });
                      if (editUserPassword && onSetPassword) {
                        await onSetPassword(userToEdit.id, editUserPassword);
                      }
                      setEditUserOpen(false);
                      setUserToEdit(null);
                      setEditUserPassword('');
                      setEditUserPasswordConfirm('');
                    } catch (e: any) {
                      setEditUserError(e?.message || 'Échec de la mise à jour');
                    }
                  }}>Enregistrer</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Created user preview modal */}
        {showCreatedUserPreview && createdUserPreview && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <h3 className="font-bold mb-3">Compte créé</h3>
              <div className="text-sm text-slate-700 space-y-2">
                <div><strong>Nom:</strong> {createdUserPreview.name}</div>
                <div><strong>Email:</strong> {createdUserPreview.email}</div>
                <div><strong>Rôle:</strong> {createdUserPreview.role}</div>
                <div><strong>UID:</strong> {createdUserPreview.uid}</div>
                <div><strong>ID interne:</strong> {createdUserPreview.id}</div>
                {createdUserPreview.schoolId && (
                  <div>
                    <strong>École:</strong> {schoolsList.find((s) => s.id === createdUserPreview.schoolId)?.name || createdUserPreview.schoolId}
                  </div>
                )}
                {createdUserPreview.academicYearId && (
                  <div>
                    <strong>Année scolaire:</strong> {yearsList.find((y) => y.id === createdUserPreview.academicYearId)?.name || createdUserPreview.academicYearId}
                  </div>
                )}
                {createdUserPreview.specialization && <div><strong>Spécialisation:</strong> {createdUserPreview.specialization}</div>}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button className="px-3 py-2 rounded bg-slate-100" onClick={() => { setShowCreatedUserPreview(false); setCreatedUserPreview(null); }}>Fermer</button>
              </div>
            </div>
          </div>
        )}

        {studentDetailOpen && studentDetail && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="font-bold text-lg">Détails de l'élève</h3>
                  <p className="text-sm text-slate-500">Informations liées au profil et aux comptes associés</p>
                </div>
                <button
                  className="text-slate-400 hover:text-slate-600 font-bold text-lg"
                  onClick={() => { setStudentDetailOpen(false); setStudentDetail(null); }}
                  aria-label="Fermer"
                >
                  ✕
                </button>
              </div>
              <div className="text-sm text-slate-700 space-y-3">
                <div><strong>Nom complet:</strong> {studentDetail.firstName} {studentDetail.lastName}</div>
                <div><strong>Date de naissance:</strong> {studentDetail.birthDate || '—'}</div>
                <div><strong>École:</strong> {schoolsList.find((s) => s.id === studentDetail.schoolId)?.name || '—'}</div>
                <div><strong>Classe:</strong> {studentDetail.className || '—'}</div>
                <div><strong>Année scolaire:</strong> {studentDetail.yearName || yearsList.find((y) => y.id === studentDetail.yearId)?.name || '—'}</div>
                <div><strong>Parent / tuteur:</strong> {studentDetail.parentName || '—'}</div>
                {studentDetail.parentId && (
                  <div><strong>Email parent:</strong> {parentsList.find((p) => p.id === studentDetail.parentId)?.email || '—'}</div>
                )}
                {studentDetail.parentId && (
                  <div><strong>Téléphone parent:</strong> {parentsList.find((p) => p.id === studentDetail.parentId)?.phone || '—'}</div>
                )}
                <div><strong>Admin école lié:</strong> {studentDetail.schoolAdminId ? (usersList.find((u) => u.id === studentDetail.schoolAdminId)?.name || `ID ${studentDetail.schoolAdminId}`) : '—'}</div>
                <div><strong>ID élève:</strong> {studentDetail.id}</div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button className="px-3 py-2 rounded bg-slate-100" onClick={() => { setStudentDetailOpen(false); setStudentDetail(null); }}>Fermer</button>
              </div>
            </div>
          </div>
        )}

        {teacherDetailOpen && teacherDetail && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="font-bold text-lg">Détails de l'enseignant</h3>
                  <p className="text-sm text-slate-500">Informations liées au profil et aux classes affectées</p>
                </div>
                <button
                  className="text-slate-400 hover:text-slate-600 font-bold text-lg"
                  onClick={() => { setTeacherDetailOpen(false); setTeacherDetail(null); }}
                  aria-label="Fermer"
                >
                  ✕
                </button>
              </div>
              <div className="text-sm text-slate-700 space-y-3">
                <div><strong>Nom complet:</strong> {teacherDetail.name}</div>
                <div><strong>Email:</strong> {teacherDetail.email}</div>
                <div><strong>École:</strong> {schoolsList.find((s) => s.id === teacherDetail.schoolId)?.name || '—'}</div>
                <div><strong>Spécialité:</strong> {Array.isArray(teacherDetail.specialization) ? teacherDetail.specialization.join(', ') : (teacherDetail.specialization || 'Général')}</div>
                <div><strong>Téléphone:</strong> {teacherDetail.phone || '—'}</div>
                <div><strong>Classes assignées:</strong> {(teacherDetail.classIds || []).map((id) => classesList.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || 'Aucune'}</div>
                <div><strong>ID enseignant:</strong> {teacherDetail.id}</div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button className="px-3 py-2 rounded bg-slate-100" onClick={() => { setTeacherDetailOpen(false); setTeacherDetail(null); }}>Fermer</button>
              </div>
            </div>
          </div>
        )}

        {parentDetailOpen && parentDetail && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="font-bold text-lg">Détails du parent</h3>
                  <p className="text-sm text-slate-500">Informations de contact et lien avec l'élève</p>
                </div>
                <button
                  className="text-slate-400 hover:text-slate-600 font-bold text-lg"
                  onClick={() => { setParentDetailOpen(false); setParentDetail(null); }}
                  aria-label="Fermer"
                >
                  ✕
                </button>
              </div>
              <div className="text-sm text-slate-700 space-y-3">
                <div><strong>Nom du tuteur:</strong> {parentDetail.name}</div>
                <div><strong>Email:</strong> {parentDetail.email || '—'}</div>
                <div><strong>Téléphone:</strong> {parentDetail.phone || '—'}</div>
                <div><strong>Adresse:</strong> {parentDetail.address || '—'}</div>
                <div><strong>Élève associé:</strong> {parentDetail.studentFirstName && parentDetail.studentLastName ? `${parentDetail.studentFirstName} ${parentDetail.studentLastName}` : '—'}</div>
                <div><strong>École de l'élève:</strong> {
                  parentDetail.schoolName || (parentDetail.studentSchoolId ? schoolsList.find((s) => s.id === parentDetail.studentSchoolId)?.name : null) || parentDetail.studentSchoolName ||
                  schoolsList.find((s) => s.id === studentsList.find((st) => st.id === parentDetail.studentId || st.parentId === parentDetail.id)?.schoolId)?.name ||
                  '—'
                }</div>
                <div><strong>ID parent:</strong> {parentDetail.id}</div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button className="px-3 py-2 rounded bg-slate-100" onClick={() => { setParentDetailOpen(false); setParentDetail(null); }}>Fermer</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete user confirmation modal */}
        {deleteUserOpen && userToDelete && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <h3 className="font-bold mb-3">Confirmer la suppression</h3>
              <p className="text-sm text-slate-600">Voulez-vous vraiment désactiver le compte de <strong>{userToDelete.name}</strong> ({userToDelete.email}) ? Ce compte sera désactivé mais toutes les données liées (élèves, notes, absences) resteront intactes et accessibles.</p>
              {deleteUserError && <div className="text-rose-600 text-sm mt-3">{deleteUserError}</div>}
              {deleteUserSuccess && !deleteUserError && (
                <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-700 text-sm">
                  Le compte a bien été désactivé. Toutes les données associées restent intactes.
                </div>
              )}
              <div className="flex justify-end gap-2 mt-5">
                <button className="px-3 py-2 rounded bg-slate-100" onClick={() => { setDeleteUserOpen(false); setUserToDelete(null); setDeleteUserError(null); setDeleteUserSuccess(false); }}>
                  {deleteUserSuccess ? 'Fermer' : 'Annuler'}
                </button>
                <button
                  className={`px-3 py-2 rounded text-white flex items-center gap-2 ${deleteUserSuccess ? 'bg-slate-300 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-700'}`}
                  onClick={async () => {
                    try {
                      if (deleteUserSuccess) return;
                      setDeleteUserError(null);
                      if (!onDeleteUser || !userToDelete) return;
                      setIsDeletingUser(true);
                      await onDeleteUser(userToDelete.id);
                      setIsDeletingUser(false);
                      setDeleteUserSuccess(true);
                    } catch (err: any) {
                      setIsDeletingUser(false);
                      setDeleteUserError(err?.message || 'Impossible de désactiver le compte');
                    }
                  }}
                  disabled={deleteUserSuccess || isDeletingUser}
                >
                  {isDeletingUser ? 'Désactivation...' : deleteUserSuccess ? 'Désactivé' : 'Désactiver'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Confirmation modal (replace window.confirm) */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
            <p className="text-sm text-slate-700 mb-4">{confirmMessage}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 bg-slate-200 rounded text-sm"
              >
                Non
              </button>
              <button
                onClick={() => {
                  try { onConfirmAction(); } catch (e) { /* ignore */ }
                  setConfirmOpen(false);
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded text-sm"
              >
                Oui
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs navigation panel */}
      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-2">
        {userRole === 'super_admin' && (
          <button
            onClick={() => { setActiveTab('schools'); setSearchQuery(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'schools' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-50'
            }`}
            id="tab-admin-schools"
          >
            <Building2 className="h-4 w-4" />
            Écoles
          </button>
        )}

        {['super_admin', 'school_admin'].includes(userRole) && (
          <button
            onClick={() => { setActiveTab('years'); setSearchQuery(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'years' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-50'
            }`}
            id="tab-admin-years"
          >
            <Calendar className="h-4 w-4" />
            Années Scolaires
          </button>
        )}

        {userRole !== 'parent' && (
          <button
            onClick={() => { setActiveTab('teachers'); setSearchQuery(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'teachers' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-50'
            }`}
            id="tab-admin-teachers"
          >
            <UserCheck className="h-4 w-4" />
            Enseignants
          </button>
        )}

        {['super_admin', 'school_admin'].includes(userRole) && (
          <button
            onClick={() => { setActiveTab('classes'); setSearchQuery(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'classes' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-50'
            }`}
            id="tab-admin-classes"
          >
            <Layers className="h-4 w-4" />
            Classes
          </button>
        )}

        <button
          onClick={() => { setActiveTab('students'); setSearchQuery(''); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'students' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-50'
          }`}
          id="tab-admin-students"
        >
          <GraduationCap className="h-4 w-4" />
          Élèves
        </button>

        <button
          onClick={() => { setActiveTab('parents'); setSearchQuery(''); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'parents' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-50'
          }`}
          id="tab-admin-parents"
        >
          <Users2 className="h-4 w-4" />
          Parents & Tuteurs
        </button>

        {['super_admin', 'school_admin'].includes(userRole) && (
          <button
            onClick={() => { setActiveTab('accounts'); setSearchQuery(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'accounts' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-50'
            }`}
            id="tab-admin-accounts"
          >
            <Settings className="h-4 w-4" />
            Comptes
          </button>
        )}

        {['super_admin', 'school_admin'].includes(userRole) && (
          <button
            onClick={() => { setActiveTab('matieres'); setSearchQuery(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'matieres' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-50'
            }`}
            id="tab-admin-matieres"
          >
            <BookOpen className="h-4 w-4" />
            Matières
          </button>
        )}
      </div>

      {/* Create User Modal */}
      {showCreateUserForm && activeTab === 'accounts' && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-auto shadow-lg relative">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-indigo-600" />
                <h3 className="text-lg font-bold text-slate-800">Créer un nouveau compte utilisateur</h3>
              </div>
              <button
                onClick={() => setShowCreateUserForm(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg cursor-pointer"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
              <div className="p-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                    <RequiredLabel label="Email" required />
                  </label>
                  <input
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500 focus:border-indigo-500"
                    type="email"
                    placeholder="utilisateur@exemple.com"
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                    <RequiredLabel label="Nom complet" required />
                  </label>
                  <input
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                    type="text"
                    placeholder="M. Koffi"
                    value={newUserForm.name}
                    onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                    <RequiredLabel label="Rôle" required />
                  </label>
                  <select
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                    value={newUserForm.role}
                    onChange={(e) => {
                      const selectedRole = e.target.value;
                      setNewUserForm({
                        ...newUserForm,
                        role: selectedRole,
                        schoolId: selectedRole === 'school_admin'
                          ? newUserForm.schoolId
                          : userRole === 'school_admin' && ['teacher', 'parent'].includes(selectedRole)
                            ? String(currentSchoolId || '')
                            : '',
                        academicYearId: selectedRole === 'school_admin' ? newUserForm.academicYearId : '',
                      });
                    }}
                  >
                    {userRole === 'super_admin' && (
                      <>
                        <option value="super_admin">Super Admin</option>
                        <option value="school_admin">Admin École</option>
                      </>
                    )}
                    <option value="teacher">Enseignant</option>
                    <option value="parent">Parent</option>
                  </select>
                </div>

                {newUserForm.role === 'teacher' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                      <RequiredLabel label="École" required />
                    </label>
                    {userRole === 'school_admin' ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        {autoAssignedSchoolName}
                      </div>
                    ) : (
                      <select
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                        value={newUserForm.schoolId}
                        onChange={(e) => {
                          setNewUserForm({ ...newUserForm, schoolId: e.target.value });
                          setNewUserAssignedClassIds([]);
                        }}
                      >
                        <option value="">-- Choisissez une école --</option>
                        {schoolsList.map((s) => (
                          <option key={s.id} value={String(s.id)}>{s.name}</option>
                        ))}
                      </select>
                    )}

                    <div className="mt-3">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                        <RequiredLabel label="Classes assignées" required />
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto border border-slate-200 rounded p-2 bg-slate-50 text-sm">
                        {(classesList || [])
                          .filter((cls) => !newUserForm.schoolId || cls.schoolId === Number(newUserForm.schoolId) || (userRole === 'school_admin' && cls.schoolId === currentSchoolId))
                          .map((cls) => (
                            <label key={cls.id} className="flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer hover:bg-slate-100 border border-transparent hover:border-slate-200">
                              <input
                                type="checkbox"
                                checked={newUserAssignedClassIds.includes(cls.id)}
                                onChange={() => {
                                  if (newUserAssignedClassIds.includes(cls.id)) {
                                    setNewUserAssignedClassIds(newUserAssignedClassIds.filter((id) => id !== cls.id));
                                  } else {
                                    setNewUserAssignedClassIds([...newUserAssignedClassIds, cls.id]);
                                  }
                                }}
                                className="h-4 w-4 accent-indigo-600"
                              />
                              <span className="truncate">{cls.name}</span>
                            </label>
                          ))}
                        {(classesList || []).filter((cls) => !newUserForm.schoolId || cls.schoolId === Number(newUserForm.schoolId)).length === 0 && (
                          <div className="text-slate-500">Sélectionnez d'abord une école pour afficher les classes disponibles.</div>
                        )}
                      </div>

                      {newUserAssignedClassIds.length > 0 && (
                        <div className="mt-2 text-xs text-slate-700 bg-slate-100 p-2 rounded border border-slate-200">
                          <strong>Classes sélectionnées :</strong>{' '}
                          {(classesList || [])
                            .filter((cls) => newUserAssignedClassIds.includes(cls.id))
                            .map((cls) => cls.name)
                            .join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {newUserForm.role === 'parent' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                      <RequiredLabel label="École" required />
                    </label>
                    {userRole === 'school_admin' ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        {autoAssignedSchoolName}
                      </div>
                    ) : (
                      <select
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                        value={newUserForm.schoolId}
                        onChange={(e) => setNewUserForm({ ...newUserForm, schoolId: e.target.value })}
                      >
                        <option value="">-- Choisissez une école --</option>
                        {schoolsList.map((s) => (
                          <option key={s.id} value={String(s.id)}>{s.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {newUserForm.role === 'school_admin' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                        <RequiredLabel label="École" required />
                      </label>
                      <select
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                        value={newUserForm.schoolId}
                        onChange={(e) => setNewUserForm({ ...newUserForm, schoolId: e.target.value, academicYearId: '' })}
                      >
                        <option value="">-- Choisir une école --</option>
                        {schoolsList.map((s) => (
                          <option key={s.id} value={String(s.id)}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                        <RequiredLabel label="Année scolaire" required />
                      </label>
                      <select
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                        value={newUserForm.academicYearId}
                        onChange={(e) => setNewUserForm({ ...newUserForm, academicYearId: e.target.value })}
                      >
                        <option value="">-- Choisir une année --</option>
                        {getYearsForSchool(newUserForm.schoolId).map((year) => (
                          <option key={year.id} value={String(year.id)}>{year.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Téléphone</label>
                  {newUserForm.role !== 'parent' ? (
                    <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
                      <span className="px-3 py-2.5 bg-slate-100 text-slate-500 text-sm font-semibold">+228</span>
                      <input
                        className="flex-1 px-3 py-2.5 border-0 outline-none text-sm"
                        type="tel"
                        placeholder="90000000"
                        value={newUserForm.phone}
                        onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                        maxLength={8}
                      />
                    </div>
                  ) : (
                    <input
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm"
                      type="tel"
                      placeholder="90000000"
                      value={newUserForm.phone}
                      onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                      maxLength={8}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Genre</label>
                  <select
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                    value={newUserForm.gender}
                    onChange={(e) => setNewUserForm({ ...newUserForm, gender: e.target.value })}
                  >
                    <option value="">-- Choisissez un genre --</option>
                    <option value="male">Masculin</option>
                    <option value="female">Féminin</option>
                    <option value="other">Autre</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Spécialisation(s) (enseignant)</label>
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3">
                    {teacherSpecializations.map((subject) => {
                      const selectedValues = Array.isArray(newUserForm.specialization)
                        ? newUserForm.specialization
                        : typeof newUserForm.specialization === 'string' && newUserForm.specialization
                          ? [newUserForm.specialization]
                          : [];
                      const isSelected = selectedValues.includes(subject);

                      return (
                        <label
                          key={subject}
                          className="flex items-center gap-2 rounded-xl border px-3 py-2 text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const nextValues = e.target.checked
                                ? [...selectedValues, subject]
                                : selectedValues.filter((value) => value !== subject);
                              setNewUserForm({ ...newUserForm, specialization: nextValues });
                            }}
                            className="h-4 w-4 text-indigo-600 border-slate-300 rounded"
                          />
                          <span className="text-sm">{subject}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                    <RequiredLabel label="Mot de passe" required />
                  </label>
                  <input
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                    type="password"
                    placeholder="Min. 6 caractères"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="sm:col-span-2 mt-4">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                  <RequiredLabel label="Confirmer mot de passe" required />
                </label>
                <input
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-indigo-500"
                  type="password"
                  placeholder="Confirmer"
                  value={newUserPasswordConfirm}
                  onChange={(e) => setNewUserPasswordConfirm(e.target.value)}
                />
              </div>

              {createUserError && (
                <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{createUserError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCreateUserForm(false);
                    setNewUserForm(getDefaultNewUserForm());
                  }}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={async () => {
                    try {
                      setCreateUserError(null);
                      if (!newUserForm.email.trim()) {
                        setCreateUserError("L'email est requis");
                        return;
                      }
                      if (!newUserForm.name.trim()) {
                        setCreateUserError('Le nom complet est requis');
                        return;
                      }
                      const phoneDigits = newUserForm.phone.replace(/\D/g, '');
                      if (phoneDigits.length !== 8) {
                        setCreateUserError('Le numéro de téléphone doit contenir exactement 8 chiffres');
                        return;
                      }
                      if (!newUserPassword || newUserPassword.length < 6) {
                        setCreateUserError('Le mot de passe doit contenir au moins 6 caractères');
                        return;
                      }
                      if (newUserPassword !== newUserPasswordConfirm) {
                        setCreateUserError('Les mots de passe ne correspondent pas');
                        return;
                      }
                      if (newUserForm.role === 'school_admin' && !newUserForm.schoolId) {
                        setCreateUserError('Une école est requise pour un Admin École');
                        return;
                      }
                      if (newUserForm.role === 'school_admin' && !newUserForm.academicYearId) {
                        setCreateUserError('Une année scolaire est requise pour un Admin École');
                        return;
                      }
                      if (newUserForm.role === 'parent' && userRole !== 'school_admin' && !newUserForm.schoolId) {
                        setCreateUserError('Une école est requise pour un parent');
                        return;
                      }
                      if (newUserForm.role === 'teacher' && userRole !== 'school_admin' && !newUserForm.schoolId) {
                        setCreateUserError('Une école est requise pour un enseignant');
                        return;
                      }
                      if (newUserForm.role === 'teacher' && (!Array.isArray(newUserForm.specialization) || newUserForm.specialization.length === 0)) {
                        setCreateUserError('La spécialisation est requise pour un enseignant');
                        return;
                      }
                      if (newUserForm.role === 'teacher' && (!Array.isArray(newUserAssignedClassIds) || newUserAssignedClassIds.length === 0)) {
                        setCreateUserError('Veuillez sélectionner au moins une classe pour l\'enseignant');
                        return;
                      }
                      if (onCreateUser) {
                        const resolvedSchoolId = newUserForm.schoolId
                          ? parseInt(newUserForm.schoolId)
                          : newUserForm.role === 'teacher' && userRole === 'school_admin'
                            ? (currentSchoolId ?? getSimulatedSchoolId())
                            : undefined;
                        const created = await onCreateUser({
                          uid: newUserForm.uid || undefined,
                          email: newUserForm.email.trim(),
                          name: newUserForm.name.trim(),
                          role: newUserForm.role,
                          schoolId: resolvedSchoolId,
                          academicYearId: newUserForm.role === 'school_admin' ? parseInt(newUserForm.academicYearId) : undefined,
                          phone: newUserForm.role !== 'parent' ? `+228${phoneDigits}` : newUserForm.phone,
                          specialization: newUserForm.specialization,
                          gender: newUserForm.gender || undefined,
                          password: newUserPassword,
                          classIds: newUserForm.role === 'teacher' ? newUserAssignedClassIds : undefined,
                        });
                        setShowCreateUserForm(false);
                        setCreatedUserPreview(created || null);
                        setShowCreatedUserPreview(true);
                        setNewUserForm({ uid: '', email: '', name: '', role: 'school_admin', schoolId: '', academicYearId: '', phone: '', specialization: [], gender: '' });
                        setNewUserPassword('');
                        setNewUserPasswordConfirm('');
                      }
                    } catch (e: any) {
                      const message = e?.message || 'Échec de création du compte';
                      if (/Forbidden/.test(message)) {
                        setCreateUserError('Vous n’êtes pas autorisé à créer ce compte pour cette école ou ce rôle.');
                      } else {
                        setCreateUserError(message);
                      }
                    }
                  }}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm transition-colors cursor-pointer shadow-md shadow-indigo-600/20"
                >
                  Créer le compte
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Panels Contents */}
      <div className="bg-white border border-slate-50 rounded-2xl shadow-sm overflow-visible" id="admin-table-container">
        {/* Searching filter */}
        {!anyModalOpen && (
          <div className="relative p-4 border-b border-slate-100">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Rechercher parmi les ${
                activeTab === 'schools' ? 'écoles' :
                activeTab === 'years' ? 'années scolaires' :
                activeTab === 'classes' ? 'classes' :
                activeTab === 'teachers' ? 'enseignants' :
                activeTab === 'students' ? 'étudiants' :
                activeTab === 'parents' ? 'parents' :
                activeTab === 'accounts' ? 'comptes' :
                'éléments'
              }...`}
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder-slate-400 text-slate-800"
              id="search-admin"
            />
          </div>
        )}

        {/* Import results panel */}
        {importResult && (
          <div className="p-4 border-b border-slate-100 bg-slate-50 text-sm">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="font-bold">Import CSV: {importResult.insertedCount ?? 0} insérés</div>
                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="text-slate-600 text-xs mt-2">
                    <div className="font-semibold">Erreurs ({importResult.errors.length}):</div>
                    <ul className="list-disc list-inside mt-1">
                      {importResult.errors.slice(0, 20).map((err: any, idx: number) => (
                        <li key={idx} className="text-rose-700">
                          Ligne {((typeof err.row === 'number') ? err.row + 1 : '?')}: {err.email ? `${err.email} — ` : ''}{err.error || err.reason || 'Erreur inconnue'}
                        </li>
                      ))}
                    </ul>
                    {importResult.errors.length > 20 && <div className="text-xs text-slate-400">...seules les 20 premières erreurs sont affichées</div>}
                  </div>
                )}
              </div>
              <button onClick={() => { if (typeof window !== 'undefined') window.location.reload(); }} className="text-xs text-indigo-600 font-semibold">Fermer</button>
            </div>
          </div>
        )}
        {/* Import preview / validation modal */}
        {showImportDetails && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-3xl max-h-[80vh] overflow-auto shadow-lg">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-bold">Aperçu avant import</h3>
                <button className="text-slate-400 hover:text-slate-600" onClick={() => { setShowImportDetails(false); setValidImportRecords(null); setImportPreviewRecords(null); setImportPreviewHeaders(null); setImportErrorsList(null); setImportRowErrors(null); }}>✕</button>
              </div>
              {(importErrorsList && importErrorsList.length > 0) || (importRowErrors && importRowErrors.length > 0) ? (
                <div className="space-y-4">
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded text-rose-700 text-sm">
                    {importErrorsList && importErrorsList.map((err, i) => <div key={i}>{err}</div>)}
                    {importRowErrors && importRowErrors.slice(0, 50).map((r) => (
                      <div key={r.row}>Ligne {r.row + 1}: {r.errors.join('; ')}</div>
                    ))}
                  </div>
                  {importPreviewRecords && importPreviewRecords.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-sm text-slate-600">Aperçu des lignes valides ({importPreviewRecords.length} affichées jusqu'à 50):</div>
                      <div className="overflow-x-auto border rounded">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                            <tr>
                              {importPreviewHeaders?.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {importPreviewRecords.slice(0, 50).map((row, idx) => (
                              <tr key={idx} className="border-t">
                                {importPreviewHeaders?.map((h) => <td key={h} className="px-3 py-2 text-slate-700">{String(row[h] ?? '')}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-slate-600">Colonnes détectées: {importPreviewHeaders?.join(', ')}</div>
                  <div className="overflow-x-auto border rounded">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                        <tr>
                          {importPreviewHeaders?.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(importPreviewRecords || []).slice(0, 50).map((row, idx) => (
                          <tr key={idx} className="border-t">
                            {importPreviewHeaders?.map((h) => <td key={h} className="px-3 py-2 text-slate-700">{String(row[h] ?? '')}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button className="px-4 py-2 bg-slate-100 rounded" onClick={() => { setShowImportDetails(false); setValidImportRecords(null); setImportPreviewRecords(null); setImportPreviewHeaders(null); setImportErrorsList(null); setImportRowErrors(null); }}>Annuler</button>
                {(validImportRecords && validImportRecords.length > 0) ? (
                  <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={confirmImport}>Importer les lignes valides</button>
                ) : (!(importErrorsList && importErrorsList.length > 0) && !(importRowErrors && importRowErrors.length > 0)) ? (
                  <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={confirmImport}>Confirmer l'import</button>
                ) : null}
              </div>
            </div>
          </div>
        )}
        
        {/* TAB 1: SCHOOLS */}
        {activeTab === 'schools' && (
          <div>
            {userRole === 'super_admin' && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => {
                    setSchoolForm({ name: '', address: '', phone: '', phoneDigits: '', selectedClassNames: [] });
                    setActiveTab('schools');
                    setStudentError(null);
                    setIsModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-3 py-2 rounded-lg"
                >
                  Créer une école
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm text-slate-600">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4">Nom de l’établissement</th>
                    <th className="px-6 py-4">Adresse</th>
                    <th className="px-6 py-4">Téléphone</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schoolsList.filter((s) => filterBySearch(s.name)).map((sc) => (
                    <tr key={sc.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800">{sc.name}</td>
                      <td className="px-6 py-4 text-slate-500">{sc.address || '—'}</td>
                      <td className="px-6 py-4 text-slate-500">{sc.phone || '—'}</td>
                      <td className="px-6 py-4 text-right">
                        {userRole === 'super_admin' ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setSchoolToEdit(sc);
                                const phoneDigits = sc.phone ? sc.phone.replace(/\D/g, '').slice(-8) : '';
                                setEditSchoolForm({ name: sc.name, address: sc.address || '', phone: sc.phone || '', phoneDigits, classNames: [] });
                                setEditSchoolOpen(true);
                                setEditSchoolError(null);
                              }}
                              className="p-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-600 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                              title="Éditer"
                            >
                              <Settings className="h-3.5 w-3.5 inline" />
                            </button>
                            <button
                              onClick={() => onDeleteSchool(sc.id)}
                              className="p-1 px-2.5 bg-rose-50 hover:bg-rose-100 border border-rose-100 text-rose-600 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 className="h-3.5 w-3.5 inline" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">Non autorisé</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {schoolsList.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-slate-400 text-xs">Aucune école disponible.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: ACADEMIC YEARS */}
        {activeTab === 'years' && (
          <div>
            {userRole === 'super_admin' && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => {
                    setYearForm({
                      name: String(new Date().getFullYear()) + '-' + String(new Date().getFullYear() + 1),
                      isActive: true,
                      schoolId: '',
                    });
                    setActiveTab('years');
                    setStudentError(null);
                    setIsModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-3 py-2 rounded-lg"
                >
                  Créer une année
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4">Label Année Scolaire</th>
                  <th className="px-6 py-4">Statut</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleYearsList.filter((y) => filterBySearch(y.name)).map((yr) => (
                  <tr key={yr.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-800">{yr.name}</td>
                    <td className="px-6 py-4">
                      {yr.isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-100">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Année Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 bg-slate-100 text-slate-500 text-xs font-semibold rounded-full">
                          Historique
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-slate-400 text-xs">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

        {/* TAB 3: CLASSES */}
        {activeTab === 'classes' && (
          <div>
            {['super_admin', 'school_admin'].includes(userRole) && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                  {userRole === 'super_admin' && (
                    <>
                      <label className="text-slate-600 text-xs sm:text-sm font-semibold">Filtrer par école</label>
                      <select
                        className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs sm:text-sm"
                        value={superAdminSchoolFilterId ?? ''}
                        onChange={(e) => setSuperAdminSchoolFilterId(e.target.value ? parseInt(e.target.value, 10) : null)}
                      >
                        <option value="">Toutes les écoles</option>
                        {schoolsList.map((school) => (
                          <option key={school.id} value={String(school.id)}>{school.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                {userRole === 'super_admin' && (
                  <button
                    onClick={() => {
                      setClassForm({ cycle: '', stream: '', section: '', group: '', schoolId: String(currentSchoolId || schoolsList[0]?.id || '') });
                      setActiveTab('classes');
                      setStudentError(null);
                      setIsModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-3 py-2 rounded-lg"
                  >
                    Créer une classe
                  </button>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4">Nom de la classe</th>
                  <th className="px-6 py-4">Enseignant Principal</th>
                  <th className="px-6 py-4">Lien Année</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classesList
                  .filter((c) => (!superAdminSchoolFilterId || c.schoolId === superAdminSchoolFilterId) && filterBySearch(c.name))
                  .map((cls) => (
                    <tr key={cls.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800">{cls.name}</td>
                      <td className="px-6 py-4 text-indigo-600 font-semibold">{cls.teacherName || 'Non assigné'}</td>
                      <td className="px-6 py-4 text-slate-500">{cls.yearName || 'N/A'}</td>
                      <td className="px-6 py-4 text-right">
                        {userRole === 'super_admin' && (
                          <button
                            onClick={() => onDeleteClass(cls.id)}
                            className="p-1 px-2.5 bg-rose-50 hover:bg-rose-100 border border-rose-100 text-rose-600 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                            title="Retirer la classe"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                {classesList.filter((c) => (!superAdminSchoolFilterId || c.schoolId === superAdminSchoolFilterId) && filterBySearch(c.name)).length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-slate-400 text-xs">Aucune classe trouvée.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

        {/* TAB 4: TEACHERS */}
        {activeTab === 'teachers' && (
          <div>
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
              {userRole === 'super_admin' && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                  <label className="text-slate-600 text-xs sm:text-sm font-semibold">Filtrer par école</label>
                  <select
                    className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs sm:text-sm"
                    value={superAdminSchoolFilterId ?? ''}
                    onChange={(e) => setSuperAdminSchoolFilterId(e.target.value ? parseInt(e.target.value, 10) : null)}
                  >
                    <option value="">Toutes les écoles</option>
                    {schoolsList.map((school) => (
                      <option key={school.id} value={String(school.id)}>{school.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                <label className="text-slate-600 text-xs sm:text-sm font-semibold">Filtrer par classe</label>
                <select
                  className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs sm:text-sm"
                  value={teacherClassFilterId ?? ''}
                  onChange={(e) => setTeacherClassFilterId(e.target.value ? parseInt(e.target.value, 10) : null)}
                >
                  <option value="">Toutes les classes</option>
                  {classesList
                    .filter((c) => !superAdminSchoolFilterId || c.schoolId === superAdminSchoolFilterId)
                    .map((cls) => (
                      <option key={cls.id} value={String(cls.id)}>{cls.name}</option>
                    ))}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4">Nom complet</th>
                  <th className="px-6 py-4">Adresse Email</th>
                  <th className="px-6 py-4">École</th>
                  <th className="px-6 py-4">Spécialité enseignée</th>
                  <th className="px-6 py-4">Téléphone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTeachersList.map((tc) => (
                  <tr key={tc.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-800">{tc.name}</td>
                    <td className="px-6 py-4 text-slate-500 font-mono text-xs">{tc.email}</td>
                    <td className="px-6 py-4 text-slate-500">{schoolsList.find((s) => s.id === tc.schoolId)?.name || '—'}</td>
                    <td className="px-6 py-4 text-indigo-700 font-semibold text-xs bg-indigo-50/40 inline-block my-2 mx-6 py-1 px-2.5 rounded-lg border border-indigo-100">{tc.specialization || 'Général'}</td>
                    <td className="px-6 py-4 text-slate-500">{tc.phone || '—'}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => openTeacherDetail(tc)}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 text-xs font-semibold transition-colors"
                        title="Voir le détail de l'enseignant"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Voir
                      </button>
                          <button
                            onClick={() => {
                              const user = usersList.find((u) => u.id === tc.userId);
                              if (!user) return;
                              const assignedClassIds = tc.classIds || [];
                              setUserToEdit(user);
                              setUserForm({
                                email: user.email,
                                name: user.name,
                                role: 'teacher',
                                schoolId: user.schoolId ? String(user.schoolId) : '',
                                academicYearId: '',
                                phone: (user as any).phone || '',
                                specialization: (user as any).specialization || '',
                                assignedClassIds,
                              });
                              setEditUserOpen(true);
                            }}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-indigo-700 text-xs font-semibold transition-colors"
                        title="Modifier l\'enseignant"
                      >
                        Modifier
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredTeachersList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-400 text-xs">Aucun enseignant trouvé.</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* TAB 5: STUDENTS */}
        {activeTab === 'students' && (
          <div>
            {['super_admin', 'school_admin'].includes(userRole) && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                  {userRole === 'super_admin' && (
                    <>
                      <label className="text-slate-600 text-xs sm:text-sm font-semibold">Filtrer par école</label>
                      <select
                        className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs sm:text-sm"
                        value={superAdminSchoolFilterId ?? ''}
                        onChange={(e) => {
                          const value = e.target.value ? parseInt(e.target.value, 10) : null;
                          setSuperAdminSchoolFilterId(value);
                          setStudentClassFilterId(null);
                        }}
                      >
                        <option value="">Toutes les écoles</option>
                        {schoolsList.map((school) => (
                          <option key={school.id} value={String(school.id)}>{school.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <div className="flex items-center gap-3">
                    <label className="text-slate-600 text-xs sm:text-sm font-semibold">Filtrer par classe</label>
                    <select
                      className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs sm:text-sm"
                      value={studentClassFilterId ?? ''}
                      onChange={(e) => setStudentClassFilterId(e.target.value ? parseInt(e.target.value, 10) : null)}
                    >
                      <option value="">Toutes les classes</option>
                      {classesList
                        .filter((c) => !superAdminSchoolFilterId || c.schoolId === superAdminSchoolFilterId)
                        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
                        .map((cls) => (
                          <option key={cls.id} value={String(cls.id)}>{cls.name}</option>
                        ))}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end w-full sm:w-auto">
                  <button
                    onClick={() => {
                      setStudentForm({
                        firstName: '',
                        lastName: '',
                        birthDate: '',
                        schoolId: String(currentSchoolId || schoolsList[0]?.id || ''),
                        classId: '',
                        parentId: '',
                        academicYearId: String(yearsList.length === 1 ? yearsList[0]?.id : (defaultAcademicYearId || '')),
                        teacherId: '',
                        schoolAdminId: userRole === 'school_admin' ? String(currentUserId || '') : '',
                      });
                      setStudentError(null);
                      setActiveTab('students');
                      setIsModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-3 py-2 rounded-lg"
                  >
                    Créer un élève
                  </button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm text-slate-600">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4">Nom</th>
                    <th className="px-6 py-4">Classe</th>
                    <th className="px-6 py-4">Année scolaire</th>
                    <th className="px-6 py-4">Tuteur</th>
                    <th className="px-6 py-4">École</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStudentsList.map((st) => (
                    <tr key={st.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800">{st.firstName} {st.lastName}</td>
                      <td className="px-6 py-4 text-slate-500">{st.className || '—'}</td>
                      <td className="px-6 py-4 text-slate-500">{yearsList.find((y) => y.id === classesList.find((c) => c.id === st.classId)?.academicYearId)?.name || st.yearName || '—'}</td>
                      <td className="px-6 py-4 text-slate-500">{st.parentName || '—'}</td>
                      <td className="px-6 py-4 text-slate-500">{schoolsList.find((s) => s.id === st.schoolId)?.name || '—'}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => openStudentDetail(st)}
                          className="inline-flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 text-xs font-semibold transition-colors"
                          title="Voir le détail de l'élève"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Voir
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredStudentsList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-400 text-xs">Aucun élève trouvé.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: PARENTS */}
        {activeTab === 'parents' && (
          <div>
            {userRole === 'super_admin' && (
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-slate-600 text-xs sm:text-sm font-semibold">Filtrer par école</label>
                <select
                  className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs sm:text-sm"
                  value={superAdminSchoolFilterId ?? ''}
                  onChange={(e) => setSuperAdminSchoolFilterId(e.target.value ? parseInt(e.target.value, 10) : null)}
                >
                  <option value="">Toutes les écoles</option>
                  {schoolsList.map((school) => (
                    <option key={school.id} value={String(school.id)}>{school.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4">Nom du tuteur</th>
                  <th className="px-6 py-4">Téléphone mobile</th>
                  <th className="px-6 py-4">Élève associé</th>
                  <th className="px-6 py-4">École de l'élève</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parentsList.filter((p) => 
                  (userRole !== 'super_admin' || !superAdminSchoolFilterId || (p as any).schoolId === superAdminSchoolFilterId) &&
                  (userRole !== 'parent' || (currentParent ? p.id === currentParent.id : false)) &&
                  filterBySearch(p.name)
                ).map((pt) => (
                  <tr key={pt.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-800">{pt.name}</td>
                    <td className="px-6 py-4 text-slate-500">{pt.phone || '—'}</td>
                    <td className="px-6 py-4 text-slate-500">{pt.studentFirstName && pt.studentLastName ? `${pt.studentFirstName} ${pt.studentLastName}` : '—'}</td>
                    <td className="px-6 py-4 text-slate-500">{pt.schoolName || (pt.studentSchoolId ? schoolsList.find((s) => s.id === pt.studentSchoolId)?.name : null) || pt.studentSchoolName || schoolsList.find((s) => s.id === studentsList.find((st) => st.id === pt.studentId || st.parentId === pt.id)?.schoolId)?.name || '—'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openParentDetail(pt)}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 text-xs font-semibold transition-colors"
                        title="Voir le détail du parent"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Voir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* TAB 7: ACCOUNTS */}
        {activeTab === 'accounts' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Comptes utilisateurs</h3>
                <p className="text-sm text-slate-500">Créez et gérez les comptes, y compris les admins écoles.</p>
              </div>
            </div>
            {userRole === 'super_admin' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <label className="text-slate-600 text-xs sm:text-sm font-semibold">Filtrer par école</label>
                  <select
                    className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs sm:text-sm"
                    value={superAdminSchoolFilterId ?? ''}
                    onChange={(e) => setSuperAdminSchoolFilterId(e.target.value ? parseInt(e.target.value, 10) : null)}
                  >
                    <option value="">Toutes les écoles</option>
                    {schoolsList.map((school) => (
                      <option key={school.id} value={String(school.id)}>{school.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <label className="text-slate-600 text-xs sm:text-sm font-semibold">Filtrer par rôle</label>
                  <select
                    className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs sm:text-sm"
                    value={accountRoleFilter}
                    onChange={(e) => setAccountRoleFilter(e.target.value)}
                  >
                    <option value="">Tous les rôles</option>
                    <option value="super_admin">Super Admin</option>
                    <option value="school_admin">Admin École</option>
                    <option value="teacher">Enseignant</option>
                    <option value="parent">Parent</option>
                  </select>
                </div>
              </div>
            )}
            <div className="flex justify-end">
              {['super_admin', 'school_admin'].includes(userRole) && (
                <button
                  onClick={() => {
                    setNewUserForm(getDefaultNewUserForm());
                    setNewUserAssignedClassIds([]);
                    setCreateUserError(null);
                    setShowCreateUserForm(true);
                  }}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md shadow-indigo-600/10 transition-colors"
                >
                  <Plus className="h-4.5 w-4.5" />
                  Créer un compte
                </button>
              )}
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[56vh] min-h-[18rem] pb-2">
              <table className="w-full text-left text-xs sm:text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4">Nom complet</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Rôle</th>
                  <th className="px-6 py-4">École</th>
                  <th className="px-6 py-4">Année scolaire</th>
                  <th className="px-6 py-4">Spécialisation</th>
                  <th className="px-6 py-4">Téléphone</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAccountsList.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-800">{user.name}</td>
                    <td className="px-6 py-4 text-slate-500 font-mono text-xs">{user.email}</td>
                    <td className="px-6 py-4 text-slate-700 capitalize">{user.role.replace('_', ' ')}</td>
                    <td className="px-6 py-4 text-slate-500">{(() => {
                      const teacherProfile = teachersList.find((t) => t.userId === user.id);
                      const sid = user.schoolId ?? teacherProfile?.schoolId ?? null;
                      return sid ? (schoolsList.find((s) => s.id === Number(sid))?.name || '—') : '—';
                    })()}</td>
                    <td className="px-6 py-4 text-slate-500">{yearsList.find((y) => y.id === (user as any).academicYearId)?.name || '—'}</td>
                    <td className="px-6 py-4 text-slate-500">{(user as any).specialization || '—'}</td>
                    <td className="px-6 py-4 text-slate-500">{(user as any).phone || '—'}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => {
                          const teacherProfile = teachersList.find((t) => t.userId === user.id);
                          const assignedClassIds = teacherProfile ? (teacherProfile.classIds || []) : [];
                          const rawPhone = (user as any).phone || '';
                          const strippedPhoneDigits = rawPhone.replace(/\D/g, '');
                          const normalizedPhone = strippedPhoneDigits.length === 11 && strippedPhoneDigits.startsWith('228')
                            ? strippedPhoneDigits.slice(3)
                            : strippedPhoneDigits;
                          setUserToEdit(user);
                          setUserForm({
                            email: user.email,
                            name: user.name,
                            role: user.role,
                            schoolId: user.schoolId ? String(user.schoolId) : '',
                            academicYearId: (user as any).academicYearId ? String((user as any).academicYearId) : '',
                            phone: normalizedPhone,
                            specialization: (user as any).specialization || '',
                            assignedClassIds,
                          });
                          setEditUserOpen(true);
                        }}
                        className="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                        title="Modifier"
                      >
                        Modifier
                      </button>
                      {userRole !== 'school_admin' && (
                        <button
                          onClick={() => {
                            setUserToDelete(user);
                            setDeleteUserOpen(true);
                            setDeleteUserError(null);
                          }}
                          className="p-1 px-2.5 bg-rose-50 hover:bg-rose-100 border border-rose-100 text-rose-600 rounded-lg text-xs font-semibold transition-colors"
                          title="Supprimer"
                        >
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {usersList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-400 text-xs">Aucun compte de connexion disponible.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 8: SUBJECTS/MATIÈRES */}
      {activeTab === 'matieres' && (
        <SubjectsView
          subjectsList={subjectsList}
          userRole={userRole}
          schoolId={currentSchoolId}
          schoolsList={schoolsList}
          onAddSubject={onAddSubject || (() => {})}
          onUpdateSubject={onUpdateSubject || (() => {})}
          onDeleteSubject={onDeleteSubject || (() => {})}
          onApproveSubject={onApproveSubject || (() => {})}
          onRejectSubject={onRejectSubject || (() => {})}
        />
      )}
      </div>

      {/* CREATION MODAL OVERLAY */}
      <AdminModal
        isModalOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        activeTab={activeTab}
        handleFormSubmit={handleFormSubmit}
        schoolForm={schoolForm}
        setSchoolForm={setSchoolForm}
        yearForm={yearForm}
        setYearForm={setYearForm}
        classForm={classForm}
        setClassForm={setClassForm}
        teacherForm={teacherForm}
        setTeacherForm={setTeacherForm}
        parentForm={parentForm}
        setParentForm={setParentForm}
        studentForm={studentForm}
        setStudentForm={setStudentForm}
        studentError={studentError}
        newParentMode={newParentMode}
        setNewParentMode={setNewParentMode}
        newParentForm={newParentForm}
        setNewParentForm={setNewParentForm}
        newTeacherMode={newTeacherMode}
        setNewTeacherMode={setNewTeacherMode}
        newTeacherForm={newTeacherForm}
        setNewTeacherForm={setNewTeacherForm}
        allowSelectOverflow={allowSelectOverflow}
        setAllowSelectOverflow={setAllowSelectOverflow}
        sortedParentPhonePrefixes={sortedParentPhonePrefixes}
        teacherSpecializations={teacherSpecializations}
        schoolsList={schoolsList}
        yearsList={yearsList}
        teachersList={teachersList}
        parentsList={parentsList}
        studentsList={studentsList}
        availableSchoolAdmins={availableSchoolAdmins}
        sortedClasses={sortedClasses}
        defaultAcademicYearId={defaultAcademicYearId}
        handleSaveNewParent={handleSaveNewParent}
        handleSaveNewTeacher={handleSaveNewTeacher}
        userRole={userRole}
        currentSchoolId={currentSchoolId}
      />
      {/* Admin modal rendered above */}
    </div>
  );
}
