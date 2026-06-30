import React, { useState, useRef, useEffect } from 'react';
import { Shield, Settings, BookOpen, Users, Bell, Smartphone, RefreshCw } from 'lucide-react';
import { getSimulatedRole, getSimulatedUser, setSimulatedRole, setSimulatedUser, clearSimulatedRole, clearSimulatedUser, apiFetch, findTeacherProfileFromSimulatedUser } from '../lib/api';
import { School, AcademicYear, Class, Teacher, Student, Parent, User } from '../types';
import CustomDropdown from './CustomDropdown';
import RequiredLabel from './RequiredLabel';
import ModalOverlay from './ModalOverlay';

interface SimulatorHeaderProps {
  currentRole: string;
  schoolsList: School[];
  classesList?: Class[];
  teachersList?: Teacher[];
  usersList?: User[];
  studentsList?: Student[];
  parentsList?: Parent[];
  yearsList: AcademicYear[];
  approvedSubjectsList?: { id: number; name: string; status?: string }[];
  onRoleChange: (newRole: string) => void;
  onRefreshData: () => void;
  isSyncing: boolean;
  onManageAccounts?: () => void;
  onLogout?: () => void;
}

export default function SimulatorHeader({
  currentRole,
  schoolsList,
  classesList = [],
  teachersList = [],
  usersList = [],
  studentsList = [],
  parentsList = [],
  yearsList = [],
  approvedSubjectsList = [],
  onRoleChange,
  onRefreshData,
  isSyncing,
  onManageAccounts,
  onLogout,
}: SimulatorHeaderProps) {
  const [simUser, setSimUser] = useState<any | null>(getSimulatedUser());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileFirstName, setProfileFirstName] = useState(simUser?.firstName || '');
  const [profileLastName, setProfileLastName] = useState(simUser?.lastName || '');
  const [profilePhone, setProfilePhone] = useState(simUser?.phone || '');
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(simUser?.avatarUrl || null);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!profileRef.current) return;
      if (e.target instanceof Node && !profileRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!profileEditOpen) return;

    const firstName = simUser?.firstName ?? (simUser?.name ? String(simUser.name).split(' ')[0] : '');
    const lastName = simUser?.lastName ?? (simUser?.name ? String(simUser.name).split(' ').slice(1).join(' ') : '');

    setProfileFirstName(firstName);
    setProfileLastName(lastName);
    setProfilePhone(simUser?.phone || '');
    setProfilePhotoPreview(simUser?.avatarUrl || null);
    setProfilePhotoFile(null);
  }, [profileEditOpen, simUser]);

  const handleProfilePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setProfilePhotoFile(null);
      setProfilePhotoPreview(simUser?.avatarUrl || null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfilePhotoFile(file);
      setProfilePhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const saveProfileChanges = () => {
    if (!simUser) return;
    const firstName = profileFirstName.trim() || simUser.firstName || '';
    const lastName = profileLastName.trim() || simUser.lastName || '';
    const displayName = [firstName, lastName].filter(Boolean).join(' ') || simUser.name;
    const updatedUser = {
      ...simUser,
      firstName,
      lastName,
      name: displayName,
      phone: profilePhone.trim() || simUser.phone,
      avatarUrl: profilePhotoPreview || undefined,
    };
    setSimUser(updatedUser);
    setSimulatedUser(updatedUser);
    setProfileEditOpen(false);
    setProfileMenuOpen(false);
  };

  const profileAvatar = simUser?.avatarUrl || null;
  const profileDisplayName = simUser ? ((simUser.firstName || simUser.lastName) ? `${simUser.firstName || ''} ${simUser.lastName || ''}`.trim() : simUser.name) : 'Profil';
  const defaultSchoolId = schoolsList.length > 0 ? String(schoolsList[0].id) : '';
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginRole, setLoginRole] = useState(currentRole);
  const [loginSchoolId, setLoginSchoolId] = useState(defaultSchoolId);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [createAccountOpen, setCreateAccountOpen] = useState(false);

  React.useEffect(() => {
    if (!loginSchoolId && defaultSchoolId) {
      setLoginSchoolId(defaultSchoolId);
    }
  }, [defaultSchoolId, loginSchoolId]);
  const [createEmail, setCreateEmail] = useState('');
  const [createFirstName, setCreateFirstName] = useState('');
  const [createLastName, setCreateLastName] = useState('');
  const [createPhonePrefix, setCreatePhonePrefix] = useState('+228');
  const [createPhone, setCreatePhone] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState('');
  const [createRole, setCreateRole] = useState('teacher');
  const [createGender, setCreateGender] = useState('');
  const [createSchoolId, setCreateSchoolId] = useState('');
  const [createAcademicYearId, setCreateAcademicYearId] = useState('');
  const [createParentSchoolId, setCreateParentSchoolId] = useState('');
  const [createParentClassId, setCreateParentClassId] = useState('');
  const [createSpecializations, setCreateSpecializations] = useState<string[]>([]);
  const [createAssignedClassIds, setCreateAssignedClassIds] = useState<number[]>([]);
  const [showClassSelection, setShowClassSelection] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const createTeacherSchoolId = createRole === 'teacher'
    ? (currentRole === 'school_admin' ? Number(simUser?.schoolId) : (Number(createSchoolId) || undefined))
    : undefined;
  const isApprovedForSchool = (cls: Class, schoolId?: number | null) => {
    if (schoolId == null) {
      if (cls.status != null) return cls.status === 'approved';
      return true;
    }
    if (cls.schoolId === schoolId) return true;
    return cls.schoolId == null && cls.status === 'approved';
  };

  const teacherSpecializations = approvedSubjectsList && approvedSubjectsList.length > 0
    ? approvedSubjectsList.map((subject) => String(subject.name || '').trim()).filter(Boolean)
    : [];
  const roles = [
    {
      id: 'super_admin',
      label: 'Super Admin',
      color: 'bg-red-500/10 text-red-700 border-red-200 hover:bg-red-500/20',
      activeColor: 'bg-red-600 text-white border-red-600 focus:ring-red-500',
      description: 'Gestion globale des établissements et des comptes'
    },
    {
      id: 'school_admin',
      label: 'Admin École',
      color: 'bg-amber-500/10 text-amber-700 border-amber-200 hover:bg-amber-500/20',
      activeColor: 'bg-amber-600 text-white border-amber-600 focus:ring-amber-500',
      description: 'Administration de son lycée, classes et inscrits'
    },
    {
      id: 'teacher',
      label: 'Enseignant',
      color: 'bg-indigo-500/10 text-indigo-700 border-indigo-200 hover:bg-indigo-500/20',
      activeColor: 'bg-indigo-600 text-white border-indigo-600 focus:ring-indigo-500',
      headerBg: 'from-indigo-950/90 via-indigo-900/85 to-slate-950/80',
      description: 'Saisie des notes, appel des absences, évaluations'
    },
    {
      id: 'parent',
      label: 'Parent',
      color: 'bg-emerald-500/10 text-emerald-700 border-emerald-200 hover:bg-emerald-500/20',
      activeColor: 'bg-emerald-600 text-white border-emerald-600 focus:ring-emerald-500',
      headerBg: 'from-emerald-950/90 via-emerald-900/85 to-slate-950/80',
      description: 'Suivi des notes, justifications, notifications push'
    },
  ];

  const activeRoleDetails = roles.find((r) => r.id === currentRole) || roles[0];

  const getFlagImageUrl = (flag: string) => {
    if (!flag || flag.length < 2) return '';
    const code = Array.from(flag)
      .slice(0, 2)
      .map((char) => String.fromCodePoint(char.codePointAt(0)! - 0x1f1e6 + 0x61))
      .join('');
    return code ? `https://flagcdn.com/w40/${code.toLowerCase()}.png` : '';
  };

  const countryOptions = [
    { code: '+93', name: 'Afghanistan', flag: '🇦🇫' },
    { code: '+355', name: 'Albanie', flag: '🇦🇱' },
    { code: '+213', name: 'Algérie', flag: '🇩🇿' },
    { code: '+376', name: 'Andorre', flag: '🇦🇩' },
    { code: '+244', name: 'Angola', flag: '🇦🇴' },
    { code: '+54', name: 'Argentine', flag: '🇦🇷' },
    { code: '+374', name: 'Arménie', flag: '🇦🇲' },
    { code: '+61', name: 'Australie', flag: '🇦🇺' },
    { code: '+43', name: 'Autriche', flag: '🇦🇹' },
    { code: '+994', name: 'Azerbaïdjan', flag: '🇦🇿' },
    { code: '+973', name: 'Bahreïn', flag: '🇧🇭' },
    { code: '+880', name: 'Bangladesh', flag: '🇧🇩' },
    { code: '+375', name: 'Biélorussie', flag: '🇧🇾' },
    { code: '+32', name: 'Belgique', flag: '🇧🇪' },
    { code: '+501', name: 'Belize', flag: '🇧🇿' },
    { code: '+229', name: 'Bénin', flag: '🇧🇯' },
    { code: '+975', name: 'Bhoutan', flag: '🇧🇹' },
    { code: '+591', name: 'Bolivie', flag: '🇧🇴' },
    { code: '+387', name: 'Bosnie-Herzégovine', flag: '🇧🇦' },
    { code: '+267', name: 'Botswana', flag: '🇧🇼' },
    { code: '+55', name: 'Brésil', flag: '🇧🇷' },
    { code: '+673', name: 'Brunei', flag: '🇧🇳' },
    { code: '+359', name: 'Bulgarie', flag: '🇧🇬' },
    { code: '+226', name: 'Burkina Faso', flag: '🇧🇫' },
    { code: '+257', name: 'Burundi', flag: '🇧🇮' },
    { code: '+237', name: 'Cameroun', flag: '🇨🇲' },
    { code: '+1', name: 'Canada', flag: '🇨🇦' },
    { code: '+238', name: 'Cap-Vert', flag: '🇨🇻' },
    { code: '+236', name: 'République centrafricaine', flag: '🇨🇫' },
    { code: '+235', name: 'Tchad', flag: '🇹🇩' },
    { code: '+56', name: 'Chili', flag: '🇨🇱' },
    { code: '+86', name: 'Chine', flag: '🇨🇳' },
    { code: '+57', name: 'Colombie', flag: '🇨🇴' },
    { code: '+269', name: 'Comores', flag: '🇰🇲' },
    { code: '+242', name: 'Congo', flag: '🇨🇬' },
    { code: '+243', name: 'République démocratique du Congo', flag: '🇨🇩' },
    { code: '+682', name: 'Îles Cook', flag: '🇨🇰' },
    { code: '+506', name: 'Costa Rica', flag: '🇨🇷' },
    { code: '+225', name: 'Côte d’Ivoire', flag: '🇨🇮' },
    { code: '+385', name: 'Croatie', flag: '🇭🇷' },
    { code: '+53', name: 'Cuba', flag: '🇨🇺' },
    { code: '+357', name: 'Chypre', flag: '🇨🇾' },
    { code: '+420', name: 'République tchèque', flag: '🇨🇿' },
    { code: '+45', name: 'Danemark', flag: '🇩🇰' },
    { code: '+253', name: 'Djibouti', flag: '🇩🇯' },
    { code: '+1767', name: 'Dominique', flag: '🇩🇲' },
    { code: '+1', name: 'République dominicaine', flag: '🇩🇴' },
    { code: '+593', name: 'Équateur', flag: '🇪🇨' },
    { code: '+20', name: 'Égypte', flag: '🇪🇬' },
    { code: '+503', name: 'El Salvador', flag: '🇸🇻' },
    { code: '+240', name: 'Guinée équatoriale', flag: '🇬🇶' },
    { code: '+291', name: 'Érythrée', flag: '🇪🇷' },
    { code: '+372', name: 'Estonie', flag: '🇪🇪' },
    { code: '+251', name: 'Éthiopie', flag: '🇪🇹' },
    { code: '+298', name: 'Îles Féroé', flag: '🇫🇴' },
    { code: '+679', name: 'Fidji', flag: '🇫🇯' },
    { code: '+358', name: 'Finlande', flag: '🇫🇮' },
    { code: '+33', name: 'France', flag: '🇫🇷' },
    { code: '+594', name: 'Guyane française', flag: '🇬🇫' },
    { code: '+689', name: 'Polynésie française', flag: '🇵🇫' },
    { code: '+241', name: 'Gabon', flag: '🇬🇦' },
    { code: '+220', name: 'Gambie', flag: '🇬🇲' },
    { code: '+995', name: 'Géorgie', flag: '🇬🇪' },
    { code: '+49', name: 'Allemagne', flag: '🇩🇪' },
    { code: '+233', name: 'Ghana', flag: '🇬🇭' },
    { code: '+350', name: 'Gibraltar', flag: '🇬🇮' },
    { code: '+30', name: 'Grèce', flag: '🇬🇷' },
    { code: '+299', name: 'Groenland', flag: '🇬🇱' },
    { code: '+502', name: 'Guatemala', flag: '🇬🇹' },
    { code: '+224', name: 'Guinée', flag: '🇬🇳' },
    { code: '+245', name: 'Guinée-Bissau', flag: '🇬🇼' },
    { code: '+592', name: 'Guyana', flag: '🇬🇾' },
    { code: '+509', name: 'Haïti', flag: '🇭🇹' },
    { code: '+504', name: 'Honduras', flag: '🇭🇳' },
    { code: '+36', name: 'Hongrie', flag: '🇭🇺' },
    { code: '+354', name: 'Islande', flag: '🇮🇸' },
    { code: '+91', name: 'Inde', flag: '🇮🇳' },
    { code: '+62', name: 'Indonésie', flag: '🇮🇩' },
    { code: '+98', name: 'Iran', flag: '🇮🇷' },
    { code: '+964', name: 'Irak', flag: '🇮🇶' },
    { code: '+353', name: 'Irlande', flag: '🇮🇪' },
    { code: '+972', name: 'Israël', flag: '🇮🇱' },
    { code: '+39', name: 'Italie', flag: '🇮🇹' },
    { code: '+1876', name: 'Jamaïque', flag: '🇯🇲' },
    { code: '+81', name: 'Japon', flag: '🇯🇵' },
    { code: '+962', name: 'Jordanie', flag: '🇯🇴' },
    { code: '+7', name: 'Kazakhstan/Russie', flag: '🇰🇿' },
    { code: '+254', name: 'Kenya', flag: '🇰🇪' },
    { code: '+970', name: 'Palestine', flag: '🇵🇸' },
    { code: '+996', name: 'Kirghizistan', flag: '🇰🇬' },
    { code: '+856', name: 'Laos', flag: '🇱🇦' },
    { code: '+371', name: 'Lettonie', flag: '🇱🇻' },
    { code: '+961', name: 'Liban', flag: '🇱🇧' },
    { code: '+266', name: 'Lesotho', flag: '🇱🇸' },
    { code: '+231', name: 'Libéria', flag: '🇱🇷' },
    { code: '+218', name: 'Libye', flag: '🇱🇾' },
    { code: '+423', name: 'Liechtenstein', flag: '🇱🇮' },
    { code: '+370', name: 'Lituanie', flag: '🇱🇹' },
    { code: '+352', name: 'Luxembourg', flag: '🇱🇺' },
    { code: '+853', name: 'Macau', flag: '🇲🇴' },
    { code: '+389', name: 'Macédoine du Nord', flag: '🇲🇰' },
    { code: '+261', name: 'Madagascar', flag: '🇲🇬' },
    { code: '+265', name: 'Malawi', flag: '🇲🇼' },
    { code: '+60', name: 'Malaisie', flag: '🇲🇾' },
    { code: '+960', name: 'Maldives', flag: '🇲🇻' },
    { code: '+223', name: 'Mali', flag: '🇲🇱' },
    { code: '+356', name: 'Malte', flag: '🇲🇹' },
    { code: '+692', name: 'Îles Marshall', flag: '🇲🇭' },
    { code: '+596', name: 'Martinique', flag: '🇲🇶' },
    { code: '+222', name: 'Mauritanie', flag: '🇲🇷' },
    { code: '+230', name: 'Maurice', flag: '🇲🇺' },
    { code: '+262', name: 'Mayotte', flag: '🇾🇹' },
    { code: '+52', name: 'Mexique', flag: '🇲🇽' },
    { code: '+373', name: 'Moldavie', flag: '🇲🇩' },
    { code: '+377', name: 'Monaco', flag: '🇲🇨' },
    { code: '+976', name: 'Mongolie', flag: '🇲🇳' },
    { code: '+382', name: 'Monténégro', flag: '🇲🇪' },
    { code: '+212', name: 'Maroc', flag: '🇲🇦' },
    { code: '+258', name: 'Mozambique', flag: '🇲🇿' },
    { code: '+95', name: 'Myanmar', flag: '🇲🇲' },
    { code: '+264', name: 'Namibie', flag: '🇳🇦' },
    { code: '+674', name: 'Nauru', flag: '🇳🇷' },
    { code: '+977', name: 'Népal', flag: '🇳🇵' },
    { code: '+31', name: 'Pays-Bas', flag: '🇳🇱' },
    { code: '+687', name: 'Nouvelle-Calédonie', flag: '🇳🇨' },
    { code: '+64', name: 'Nouvelle-Zélande', flag: '🇳🇿' },
    { code: '+505', name: 'Nicaragua', flag: '🇳🇮' },
    { code: '+227', name: 'Niger', flag: '🇳🇪' },
    { code: '+234', name: 'Nigéria', flag: '🇳🇬' },
    { code: '+47', name: 'Norvège', flag: '🇳🇴' },
    { code: '+968', name: 'Oman', flag: '🇴🇲' },
    { code: '+92', name: 'Pakistan', flag: '🇵🇰' },
    { code: '+680', name: 'Palaos', flag: '🇵🇼' },
    { code: '+507', name: 'Panama', flag: '🇵🇦' },
    { code: '+675', name: 'Papouasie-Nouvelle-Guinée', flag: '🇵🇬' },
    { code: '+51', name: 'Pérou', flag: '🇵🇪' },
    { code: '+63', name: 'Philippines', flag: '🇵🇭' },
    { code: '+48', name: 'Pologne', flag: '🇵🇱' },
    { code: '+351', name: 'Portugal', flag: '🇵🇹' },
    { code: '+1', name: 'Porto Rico', flag: '🇵🇷' },
    { code: '+974', name: 'Qatar', flag: '🇶🇦' },
    { code: '+40', name: 'Roumanie', flag: '🇷🇴' },
    { code: '+7', name: 'Russie', flag: '🇷🇺' },
    { code: '+250', name: 'Rwanda', flag: '🇷🇼' },
    { code: '+685', name: 'Samoa', flag: '🇼🇸' },
    { code: '+378', name: 'Saint-Marin', flag: '🇸🇲' },
    { code: '+966', name: 'Arabie saoudite', flag: '🇸🇦' },
    { code: '+221', name: 'Sénégal', flag: '🇸🇳' },
    { code: '+381', name: 'Serbie', flag: '🇷🇸' },
    { code: '+248', name: 'Seychelles', flag: '🇸🇨' },
    { code: '+232', name: 'Sierra Leone', flag: '🇸🇱' },
    { code: '+65', name: 'Singapour', flag: '🇸🇬' },
    { code: '+421', name: 'Slovaquie', flag: '🇸🇰' },
    { code: '+386', name: 'Slovénie', flag: '🇸🇮' },
    { code: '+677', name: 'Îles Salomon', flag: '🇸🇧' },
    { code: '+252', name: 'Somalie', flag: '🇸🇴' },
    { code: '+27', name: 'Afrique du Sud', flag: '🇿🇦' },
    { code: '+82', name: 'Corée du Sud', flag: '🇰🇷' },
    { code: '+211', name: 'Soudan du Sud', flag: '🇸🇸' },
    { code: '+34', name: 'Espagne', flag: '🇪🇸' },
    { code: '+94', name: 'Sri Lanka', flag: '🇱🇰' },
    { code: '+249', name: 'Soudan', flag: '🇸🇩' },
    { code: '+597', name: 'Suriname', flag: '🇸🇷' },
    { code: '+268', name: 'Eswatini', flag: '🇸🇿' },
    { code: '+46', name: 'Suède', flag: '🇸🇪' },
    { code: '+41', name: 'Suisse', flag: '🇨🇭' },
    { code: '+963', name: 'Syrie', flag: '🇸🇾' },
    { code: '+886', name: 'Taïwan', flag: '🇹🇼' },
    { code: '+992', name: 'Tadjikistan', flag: '🇹🇯' },
    { code: '+255', name: 'Tanzanie', flag: '🇹🇿' },
    { code: '+66', name: 'Thaïlande', flag: '🇹🇭' },
    { code: '+228', name: 'Togo', flag: '🇹🇬' },
    { code: '+676', name: 'Tonga', flag: '🇹🇴' },
    { code: '+216', name: 'Tunisie', flag: '🇹🇳' },
    { code: '+90', name: 'Turquie', flag: '🇹🇷' },
    { code: '+993', name: 'Turkménistan', flag: '🇹🇲' },
    { code: '+688', name: 'Tuvalu', flag: '🇹🇻' },
    { code: '+256', name: 'Ouganda', flag: '🇺🇬' },
    { code: '+380', name: 'Ukraine', flag: '🇺🇦' },
    { code: '+971', name: 'Émirats arabes unis', flag: '🇦🇪' },
    { code: '+44', name: 'Royaume-Uni', flag: '🇬🇧' },
    { code: '+1', name: 'États-Unis', flag: '🇺🇸' },
    { code: '+598', name: 'Uruguay', flag: '🇺🇾' },
    { code: '+998', name: 'Ouzbékistan', flag: '🇺🇿' },
    { code: '+678', name: 'Vanuatu', flag: '🇻🇺' },
    { code: '+39', name: 'Vatican', flag: '🇻🇦' },
    { code: '+58', name: 'Venezuela', flag: '🇻🇪' },
    { code: '+84', name: 'Vietnam', flag: '🇻🇳' },
    { code: '+263', name: 'Zimbabwe', flag: '🇿🇼' },
    { code: '+260', name: 'Zambie', flag: '🇿🇲' }
  ].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

  // resolve teacher profile from teachersList when role is teacher
  const teacherProfile = findTeacherProfileFromSimulatedUser(currentRole, simUser, teachersList || [], usersList || []);
  const teacherClassIds = teacherProfile ? (teacherProfile.classIds || []) : [];
  const teacherClassCount = teacherClassIds.length;
  const teacherClasses = (classesList || []).filter((c) => teacherClassIds.includes(c.id));
  const teacherStudents = (studentsList || []).filter((s) => teacherClassIds.includes(s.classId));
  const [fetchedSchoolName, setFetchedSchoolName] = useState<string | null>(null);

  // resolve parent profile when role is parent
  const parentProfile = (parentsList || []).find((p) => {
    const byUid = simUser?.uid && String(p.userId) === String(simUser.uid);
    const byEmail = simUser?.email && p.email?.toLowerCase() === simUser.email.toLowerCase();
    return Boolean(byUid || byEmail);
  });

  const displayName = currentRole === 'parent'
    ? (parentProfile ? `${parentProfile.firstName} ${parentProfile.lastName}` : (simUser?.name || simUser?.displayName || simUser?.email || 'Parent connecté'))
    : (simUser?.name || simUser?.displayName || simUser?.email || 'Utilisateur');

  useEffect(() => {
    let sid = teacherProfile?.schoolId ?? null;
    let cancelled = false;
    (async () => {
      try {
        if (!sid) {
          // Try debug endpoint to resolve teacherRow when teachersList doesn't include it
          if (currentRole === 'teacher') {
            const dbg = await apiFetch('/api/debug/sim-profile');
            sid = dbg?.teacherRow?.schoolId ?? null;
          }
        }
        if (!sid) return;
        // If schoolsList doesn't contain the teacher's school, fetch it individually
        const found = schoolsList.find((s) => Number(s.id) === Number(sid));
        if (found) {
          if (!cancelled) setFetchedSchoolName(found.name);
          return;
        }
        const res = await apiFetch(`/api/schools/${sid}`);
        if (!cancelled && res && res.name) setFetchedSchoolName(res.name);
      } catch (e) {
        // ignore; permission may be denied or endpoint missing
      }
    })();
    return () => { cancelled = true; };
  }, [teacherProfile?.schoolId, schoolsList]);

  return (
    <div className="bg-slate-900 text-white border-b border-slate-800" id="simulator-header">
      {/* Simulation Sandbox indicator */}
      <div className={`px-4 py-2 bg-gradient-to-r ${activeRoleDetails.headerBg ?? 'from-indigo-900 via-purple-950 to-indigo-900'} flex flex-wrap justify-between items-center text-xs gap-2`}>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <div className="text-slate-200 text-sm">
          {simUser ? (
            (() => {
              const sid = simUser?.schoolId ?? simUser?.school?.id ?? teacherProfile?.schoolId ?? null;
              const schoolName = sid ? (schoolsList.find((s) => s.id === Number(sid))?.name || fetchedSchoolName) : null;
              return (
                <>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      {currentRole === 'teacher' ? (
                        <>
                          <span>
                            {teacherProfile
                              ? Array.isArray(teacherProfile.specialization)
                                ? teacherProfile.specialization.join(', ')
                                : teacherProfile.specialization || 'Enseignant'
                              : 'Enseignant'
                            }
                          </span>
                          {schoolName ? <span className="ml-2 text-slate-400">— {schoolName}</span> : null}
                        </>
                      ) : (
                        <>
                          <span>{displayName}</span>
                          {schoolName ? <span className="ml-2 text-slate-400">— {schoolName}</span> : null}
                        </>
                      )}
                    </div>
                    {currentRole === 'teacher' ? (
                      <div className="text-xs text-slate-400 mt-1">
                        Classes: {teacherClasses.map((cls) => cls.name).filter(Boolean).join(', ') || `${teacherClassCount} classe(s)`}
                      </div>
                    ) : null}
                  </div>
                </>
              );
            })()
          ) : 'Aucun utilisateur connecté'}
        </div>
      </div>
      {/* Login modal */}
      <ModalOverlay isOpen={loginOpen} onClose={() => setLoginOpen(false)} backdropClassName="bg-black/50" contentClassName="max-w-md w-full">
        <div className="bg-white rounded-2xl p-6 text-slate-800">
          <h3 className="font-bold mb-3">Se connecter (simulation)</h3>
          <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs">
                  <RequiredLabel label="Rôle" required />
                </label>
                <select
                  className="w-full p-2 border rounded"
                  value={loginRole}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setLoginRole(nextRole);
                    if (nextRole !== 'super_admin') {
                      setLoginSchoolId(defaultSchoolId);
                    }
                  }}
                >
                  <option value="super_admin">Super Admin</option>
                  <option value="school_admin">Admin École</option>
                  <option value="teacher">Enseignant</option>
                  <option value="parent">Parent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs">
                  <RequiredLabel label="Email" required />
                </label>
                <input
                  className="w-full p-2 border rounded"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="email@exemple.fr"
                />
              </div>

              <div>
                <label className="block text-xs">
                  <RequiredLabel label="Nom" required />
                </label>
                <input
                  className="w-full p-2 border rounded"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  placeholder="M. Koffi"
                />
              </div>

              {loginRole !== 'super_admin' && (
                <div>
                  <label className="block text-xs">
                    <RequiredLabel label="École" required />
                  </label>
                  <select
                    className="w-full p-2 border rounded"
                    value={loginSchoolId}
                    onChange={(e) => setLoginSchoolId(e.target.value)}
                  >
                    <option value="">-- Choisissez l'école --</option>
                    {schoolsList.map((school) => (
                      <option key={school.id} value={String(school.id)}>{school.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {loginError && <div className="text-rose-600 text-sm">{loginError}</div>}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded bg-slate-100"
                  onClick={() => setLoginOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded bg-indigo-600 text-white"
                  onClick={async () => {
                    try {
                      setLoginError(null);
                      const uid = `${loginRole}_${Date.now()}`;
                      const name = loginName || `${loginRole} Test`;
                      const email = loginEmail || `${uid}@example.test`;
                      const resolvedSchoolId = loginRole === 'super_admin' ? undefined : (Number(loginSchoolId) || undefined);
                      if (loginRole !== 'super_admin' && !resolvedSchoolId) {
                        setLoginError('Veuillez sélectionner une école pour ce rôle.');
                        return;
                      }
                      // Persist simulation headers
                      setSimulatedRole(loginRole as any);
                      setSimulatedUser({ uid, email, name, schoolId: resolvedSchoolId });
                      setSimUser({ uid, email, name, schoolId: resolvedSchoolId });
                      // Trigger backend register-or-login to ensure user profile exists
                      try {
                        await apiFetch('/api/auth/register-or-login', { method: 'POST' });
                      } catch (e) {
                        // ignore; user may already exist
                      }
                      onRoleChange(loginRole);
                      onRefreshData();
                      setLoginOpen(false);
                    } catch (err: any) {
                      setLoginError(err?.message || 'Erreur de connexion');
                    }
                  }}
                >
                  Se connecter
                </button>
              </div>
            </div>
          </div>
      </ModalOverlay>

      {/* Create Account modal */}
      <ModalOverlay isOpen={createAccountOpen} onClose={() => setCreateAccountOpen(false)} backdropClassName="bg-black/50" contentClassName="max-w-3xl w-full">
        <div className="bg-white rounded-2xl p-6 max-h-[90vh] overflow-auto text-slate-800 shadow-xl relative z-[10000]">
          <div className="flex items-start justify-between mb-4">
            <h3 className="font-bold">Créer un nouveau compte</h3>
            <button aria-label="Fermer" className="text-slate-400 hover:text-slate-600 font-bold text-lg" onClick={() => setCreateAccountOpen(false)}>✕</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <label className="block text-xs">
                  <RequiredLabel label="Rôle" required />
                </label>
                <select
                  className="w-full p-2 border rounded"
                  value={createRole}
                  onChange={(e) => {
                    const selectedRole = e.target.value;
                    setCreateRole(selectedRole);
                    if (selectedRole !== 'school_admin' && !(selectedRole === 'teacher' && currentRole === 'school_admin')) {
                      setCreateSchoolId('');
                    }
                    if (selectedRole !== 'school_admin') {
                      setCreateAcademicYearId('');
                    }
                    if (selectedRole === 'teacher' && currentRole === 'school_admin') {
                      setCreateSchoolId(String(simUser?.schoolId ?? ''));
                    }
                    if (selectedRole === 'parent' && currentRole === 'school_admin') {
                      setCreateParentSchoolId(String(simUser?.schoolId ?? ''));
                      setCreateParentClassId('');
                    }
                    if (selectedRole !== 'teacher') {
                      setCreateAssignedClassIds([]);
                    }
                    if (selectedRole !== 'parent') {
                      setCreateParentSchoolId('');
                      setCreateParentClassId('');
                    }
                  }}
                >
                  {currentRole === 'super_admin' ? (
                    <>
                      <option value="super_admin">Super Admin</option>
                      <option value="school_admin">Admin École</option>
                    </>
                  ) : null}
                  <option value="teacher">Enseignant</option>
                  <option value="parent">Parent</option>
                </select>
              </div>

              {createRole === 'school_admin' && (
                <>
                  <div>
                    <label className="block text-xs">
                      <RequiredLabel label="École" required />
                    </label>
                    <select className="w-full p-2 border rounded" value={createSchoolId} onChange={(e) => {
                      setCreateSchoolId(e.target.value);
                      setCreateAcademicYearId('');
                    }}>
                      <option value="">-- Choisir une école --</option>
                      {schoolsList.length > 0 ? (
                        schoolsList.map((school) => (
                          <option key={school.id} value={String(school.id)}>{school.name}</option>
                        ))
                      ) : (
                        <option value="">Aucune école disponible</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs">
                      <RequiredLabel label="Année scolaire" required />
                    </label>
                    <select className="w-full p-2 border rounded" value={createAcademicYearId} onChange={(e) => setCreateAcademicYearId(e.target.value)}>
                      <option value="">-- Choisir une année --</option>
                      {yearsList.length > 0 ? (
                        yearsList
                          .filter((year) => year.schoolId == null)
                          .map((year) => (
                            <option key={year.id} value={String(year.id)}>{year.name}</option>
                          ))
                      ) : (
                        <option value="">Aucune année disponible</option>
                      )}
                    </select>
                  </div>
                </>
              )}

              {createRole === 'parent' && (
                <>
                  <div>
                    <label className="block text-xs">
                      <RequiredLabel label="École" required />
                    </label>
                    {currentRole === 'school_admin' ? (
                      <div className="w-full p-2 border rounded bg-slate-50 text-slate-600">
                        {schoolsList.find((s) => s.id === simUser?.schoolId)?.name || 'École assignée automatiquement'}
                      </div>
                    ) : (
                      <select className="w-full p-2 border rounded" value={createParentSchoolId} onChange={(e) => {
                        setCreateParentSchoolId(e.target.value);
                        setCreateParentClassId('');
                      }}>
                        <option value="">-- Choisir une école --</option>
                        {schoolsList.length > 0 ? (
                          schoolsList.map((school) => (
                            <option key={school.id} value={String(school.id)}>{school.name}</option>
                          ))
                        ) : (
                          <option value="">Aucune école disponible</option>
                        )}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs">
                      <RequiredLabel label="Classe" required />
                    </label>
                    <select className="w-full p-2 border rounded" value={createParentClassId} onChange={(e) => {
                      setCreateParentClassId(e.target.value);
                    }}>
                      <option value="">-- Choisir une classe --</option>
                      {createParentSchoolId ? (
                        (classesList || [])
                          .filter((cls) => String(cls.schoolId) === createParentSchoolId && isApprovedForSchool(cls, Number(createParentSchoolId)))
                          .map((cls) => (
                            <option key={cls.id} value={String(cls.id)}>{cls.name}</option>
                          ))
                      ) : (
                        <option value="">Sélectionnez d'abord une école</option>
                      )}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs">
                  <RequiredLabel label="Email" required />
                </label>
                <input className="w-full p-2 border rounded" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="email@exemple.fr" />
              </div>

              <div>
                <label className="block text-xs">
                  <RequiredLabel label="Nom" required />
                </label>
                <input className="w-full p-2 border rounded" value={createLastName} onChange={(e) => setCreateLastName(e.target.value)} placeholder="Dupont" />
              </div>

              <div>
                <label className="block text-xs">
                  <RequiredLabel label="Prénom(s)" required />
                </label>
                <input className="w-full p-2 border rounded" value={createFirstName} onChange={(e) => setCreateFirstName(e.target.value)} placeholder="Jean" />
              </div>

              <div>
                <label className="block text-xs">
                  <RequiredLabel label="Numéro de téléphone" required />
                </label>
                <div className="flex items-stretch border rounded overflow-hidden">
                  <CustomDropdown
                    options={countryOptions.map((c) => ({
                      value: c.code,
                      label: (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${c.name} ${c.code}`}>
                          <img
                            src={getFlagImageUrl(c.flag)}
                            alt={c.name}
                            className="h-4 w-6 rounded-sm object-cover shrink-0"
                            loading="lazy"
                          />
                          <span className="text-xs font-semibold text-slate-700">{c.code}</span>
                        </span>
                      ),
                    }))}
                    value={createPhonePrefix}
                    onChange={setCreatePhonePrefix}
                    placeholder="Pays"
                    className="w-[96px] shrink-0 sm:w-[108px]"
                  />
                  <input className="flex-1 min-w-0 p-2 border-0 outline-none" type="tel" value={createPhone} onChange={(e) => setCreatePhone(e.target.value.replace(/\D/g, '').slice(0, createPhonePrefix === '+228' ? 8 : 20))} placeholder="90000000" maxLength={createPhonePrefix === '+228' ? 8 : 20} />
                </div>
              </div>

              {(createRole === 'teacher' || createRole === 'parent') && (
                <div>
                  <label className="block text-xs">
                    <RequiredLabel label="Sexe" required />
                  </label>
                  <select className="w-full p-2 border rounded" value={createGender} onChange={(e) => setCreateGender(e.target.value)}>
                    <option value="">-- Choisir le sexe --</option>
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
              )}

              {createRole === 'teacher' && (
                <>
                  <div>
                    <label className="block text-xs">
                      <RequiredLabel label="École" required />
                    </label>
                    {currentRole === 'school_admin' ? (
                      <div className="w-full p-2 border rounded bg-slate-50 text-slate-600">
                        {schoolsList.find((s) => s.id === simUser?.schoolId)?.name || 'École assignée automatiquement'}
                      </div>
                    ) : (
                      <select
                        className="w-full p-2 border rounded"
                        value={createSchoolId}
                        onChange={(e) => {
                          setCreateSchoolId(e.target.value);
                          setCreateAssignedClassIds([]);
                        }}
                      >
                        <option value="">-- Choisir une école --</option>
                        {schoolsList.map((school) => (
                          <option key={school.id} value={String(school.id)}>{school.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs">
                      <RequiredLabel label="Classes assignées" required />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50 text-sm">
                      {(classesList || [])
                        .filter((cls) => !createTeacherSchoolId || isApprovedForSchool(cls, createTeacherSchoolId))
                        .map((cls) => (
                          <label key={cls.id} className="flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer hover:bg-slate-100 border border-transparent hover:border-slate-200">
                            <input
                              type="checkbox"
                              checked={createAssignedClassIds.includes(cls.id)}
                              onChange={() => {
                                if (createAssignedClassIds.includes(cls.id)) {
                                  setCreateAssignedClassIds(createAssignedClassIds.filter((id) => id !== cls.id));
                                } else {
                                  setCreateAssignedClassIds([...createAssignedClassIds, cls.id]);
                                }
                              }}
                              className="h-4 w-4 accent-indigo-600"
                            />
                            <span className="truncate">{cls.name}</span>
                          </label>
                        ))}
                      {(classesList || []).filter((cls) => !createTeacherSchoolId || isApprovedForSchool(cls, createTeacherSchoolId)).length === 0 && (
                        <div className="text-slate-500">Sélectionnez d'abord une école pour afficher les classes disponibles.</div>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Les classes sont prises en compte immédiatement à chaque sélection.</p>
                    {createAssignedClassIds.length > 0 && (
                      <div className="mt-2 text-xs text-slate-700 bg-slate-100 p-2 rounded-lg border border-slate-200">
                        <strong>Classes sélectionnées :</strong>{' '}
                        {(classesList || [])
                          .filter((cls) => createAssignedClassIds.includes(cls.id))
                          .map((cls) => cls.name)
                          .join(', ')}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs">
                      <RequiredLabel label="Spécialisation" required />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 rounded-lg p-2 bg-slate-50 max-h-56 overflow-auto">
                      {teacherSpecializations.map((subject) => (
                        <label key={subject} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={createSpecializations.includes(subject)}
                            onChange={() => {
                              if (createSpecializations.includes(subject)) {
                                setCreateSpecializations(createSpecializations.filter((item) => item !== subject));
                              } else {
                                setCreateSpecializations([...createSpecializations, subject]);
                              }
                            }}
                            className="h-4 w-4 accent-indigo-600"
                          />
                          <span className="text-sm text-slate-700">{subject}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs">
                    <RequiredLabel label="Mot de passe" required />
                  </label>
                  <input className="w-full p-2 border rounded" type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="••••••••" />
                </div>

                <div>
                  <label className="block text-xs">
                    <RequiredLabel label="Confirmer le mot de passe" required />
                  </label>
                  <input className="w-full p-2 border rounded" type="password" value={createPasswordConfirm} onChange={(e) => setCreatePasswordConfirm(e.target.value)} placeholder="••••••••" />
                </div>
              </div>
            </div>

            <div className="mt-2">
              {createError && <div className="text-rose-600 text-sm">{createError}</div>}
            </div>

            <div className="flex justify-end gap-2 mt-3">
              <button className="px-3 py-2 rounded bg-slate-100" onClick={() => setCreateAccountOpen(false)} disabled={isCreating}>Annuler</button>
              <button className="px-3 py-2 rounded bg-emerald-600 text-white" onClick={async () => {
                try {
                  setCreateError(null);
                  if (createPhonePrefix === '+228') {
                    if (createPhone.length !== 8) {
                      setCreateError('Le numéro de téléphone doit contenir 8 chiffres pour +228');
                      return;
                    }
                  } else {
                    if (createPhone.length < 4) {
                      setCreateError('Le numéro de téléphone est trop court');
                      return;
                    }
                  }
                  if (!createEmail) {
                    setCreateError('L’email est requis');
                    return;
                  }
                  if (!createPassword || createPassword.length < 6) {
                    setCreateError('Le mot de passe doit contenir au moins 6 caractères');
                    return;
                  }
                  if (createRole === 'school_admin' && !createSchoolId) {
                    setCreateError('Une école est requise pour un Admin École');
                    return;
                  }
                  if (createRole === 'school_admin' && !createAcademicYearId) {
                    setCreateError('Une année scolaire est requise pour un Admin École');
                    return;
                  }
                  if (createRole === 'parent' && !createParentSchoolId) {
                    setCreateError('Une école est requise pour un parent');
                    return;
                  }
                  if (createRole === 'teacher' || createRole === 'parent') {
                    if (!createGender) {
                      setCreateError('Le sexe est requis pour les parents et les enseignants');
                      return;
                    }
                  }
                  if (createRole === 'teacher') {
                    if (currentRole !== 'school_admin' && !createSchoolId) {
                      setCreateError('Une école est requise pour un enseignant');
                      return;
                    }
                    if (!Array.isArray(createSpecializations) || createSpecializations.length === 0) {
                      setCreateError('Au moins une spécialisation est requise pour un enseignant');
                      return;
                    }
                    if (!Array.isArray(createAssignedClassIds) || createAssignedClassIds.length === 0) {
                      setCreateError('Veuillez sélectionner au moins une classe pour l\'enseignant');
                      return;
                    }
                  }
                  if (createPassword !== createPasswordConfirm) {
                    setCreateError('Les mots de passe ne correspondent pas');
                    return;
                  }
                  setIsCreating(true);
                  const name = `${createFirstName} ${createLastName}`.trim() || `${createRole} Test`;
                  const payload: any = {
                    email: createEmail,
                    name,
                    role: createRole,
                    phone: `${createPhonePrefix}${createPhone}`,
                    specialization: createRole === 'teacher' ? createSpecializations : undefined,
                  };
                  if (createRole === 'school_admin') {
                    payload.schoolId = parseInt(createSchoolId);
                    payload.academicYearId = parseInt(createAcademicYearId);
                  } else if (createRole === 'teacher') {
                    payload.schoolId = currentRole === 'school_admin'
                      ? simUser?.schoolId
                      : parseInt(createSchoolId);
                    payload.classIds = createAssignedClassIds;
                  } else if (createRole === 'parent') {
                    payload.schoolId = parseInt(createParentSchoolId);
                  }

                  if (createRole === 'teacher' || createRole === 'parent') {
                    payload.gender = createGender;
                  }

                  const createdUser = await apiFetch('/api/admin/users', {
                    method: 'POST',
                    body: JSON.stringify({ ...payload, password: createPassword }),
                  });

                  setCreateAccountOpen(false);
                  setCreateEmail('');
                  setCreateFirstName('');
                  setCreateLastName('');
                  setCreatePhone('');
                  setCreatePhonePrefix('+228');
                  setCreatePassword('');
                  setCreatePasswordConfirm('');
                  setCreateRole('teacher');
                  setCreateSchoolId('');
                  setCreateAcademicYearId('');
                  setCreateParentSchoolId('');
                  setCreateParentClassId('');
                  setCreateSpecializations([]);
                  setCreateAssignedClassIds([]);
                  setCreateGender('');
                  onRefreshData();
                } catch (err: any) {
                  setCreateError(err?.message || 'Erreur lors de la création du compte');
                } finally {
                  setIsCreating(false);
                }
              }} disabled={isCreating}>
                {isCreating ? 'Création...' : 'Créer'}
              </button>
            </div>
          </div>
      </ModalOverlay>

      <div className="max-w-7xl mx-auto p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600 rounded-xl leading-none">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              EcoleTrack <span className="text-xs bg-slate-800 border border-slate-700 text-indigo-400 px-2 py-0.5 rounded-full">v1.0-STABLE</span>
            </h1>
            <p className="text-xs text-slate-400">Architecture REST, PostgreSQL, Firebase Messaging</p>
          </div>
        </div>

        {/* Dynamic Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          {/* Quick role switch */}
          <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {roles
              .filter(role => role.id === currentRole)
              .map((role) => {
              const isActive = role.id === currentRole;
              return (
                <button
                  key={role.id}
                  onClick={() => onRoleChange(role.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    isActive
                      ? role.activeColor + ' shadow-md shadow-indigo-950/50'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                  title={role.description}
                  id={`btn-sim-${role.id}`}
                >
                  {role.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={onRefreshData}
            disabled={isSyncing}
            className={`flex items-center justify-center gap-2 px-3 py-1.5 md:py-2 text-xs font-medium rounded-xl transition-colors border ${activeRoleDetails.activeColor} ${currentRole === 'teacher' ? 'shadow-lg shadow-indigo-900/30' : currentRole === 'parent' ? 'shadow-lg shadow-emerald-900/30' : currentRole === 'school_admin' ? 'shadow-lg shadow-amber-900/30' : 'shadow-lg shadow-red-900/30'} disabled:opacity-50`}
            title="Rafraîchir les données"
            id="btn-sim-refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {"Données"}
          </button>

          {/* Profile menu */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileMenuOpen(!profileMenuOpen)}
              className={`ml-2 px-3 py-1.5 flex items-center gap-2 text-xs font-medium rounded-xl transition-colors border ${activeRoleDetails.activeColor} ${currentRole === 'teacher' ? 'shadow-lg shadow-indigo-900/30' : currentRole === 'parent' ? 'shadow-lg shadow-emerald-900/30' : currentRole === 'school_admin' ? 'shadow-lg shadow-amber-900/30' : 'shadow-lg shadow-red-900/30'}`}
              title="Profil"
              id="btn-sim-profile"
            >
              {profileAvatar ? (
                <img src={profileAvatar} alt="Avatar" className="h-7 w-7 rounded-full border border-white/20 object-cover" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">{profileDisplayName}</span>
            </button>

            {profileMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white text-slate-800 rounded shadow-lg z-40">
                <div className="p-3 border-b text-sm">
                  <div className="font-semibold">{simUser ? simUser.name : 'Aucun utilisateur'}</div>
                  <div className="text-xs text-slate-500">{simUser ? simUser.email : ''}</div>
                </div>
                <div className="p-2 flex flex-col gap-1">
                  {currentRole !== 'parent' && currentRole !== 'teacher' && (
                    <button
                      type="button"
                      className="text-left px-2 py-2 text-sm hover:bg-slate-100 rounded text-indigo-600 font-medium"
                      onClick={() => {
                        setCreateAccountOpen(true);
                        setProfileMenuOpen(false);
                      }}
                    >
                      ➕ Créer un compte
                    </button>
                  )}
                  <button type="button" className="text-left px-2 py-2 text-sm hover:bg-slate-100 rounded text-indigo-600 font-medium" onClick={() => { setProfileEditOpen(true); setProfileMenuOpen(false); }}>✏️ Modifier mon profil</button>
                  <button type="button" className="text-left px-2 py-2 text-sm hover:bg-slate-100 rounded text-indigo-600 font-medium" onClick={() => { if (onManageAccounts) onManageAccounts(); setProfileMenuOpen(false); }}>⚙️ Gestion des comptes</button>
                  <button type="button" className="text-left px-2 py-2 text-sm hover:bg-slate-100 rounded" onClick={async () => {
                    setProfileMenuOpen(false);
                    if (onLogout) await onLogout();
                  }}>Se déconnecter</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Context disclaimer */}
      <div className="bg-slate-950/60 border-t border-slate-800/80 px-4 py-2.5 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex items-center gap-2">
          <Shield className="h-4 w-4 text-slate-400 shrink-0" />
          <span>
            Rôle Actif : <strong className="text-slate-200">{activeRoleDetails.label}</strong> — {activeRoleDetails.description}
          </span>
        </div>
      </div>
      <ModalOverlay isOpen={profileEditOpen} onClose={() => setProfileEditOpen(false)} backdropClassName="bg-slate-950/70" contentClassName="max-w-md w-full">
        <div className="w-full overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Modifier le profil</h2>
              <p className="text-sm text-slate-500">Mettez à jour votre nom, téléphone et photo de profil.</p>
            </div>
            <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => setProfileEditOpen(false)} aria-label="Fermer le formulaire de profil">✕</button>
          </div>
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-4">
              <label htmlFor="profile-photo-input" className="flex cursor-pointer items-center gap-4 rounded-full border border-slate-200 bg-slate-100 p-1 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50">
                <div className="h-16 w-16 overflow-hidden rounded-full bg-slate-100 border border-slate-200">
                  {profilePhotoPreview ? (
                    <img src={profilePhotoPreview} alt="Aperçu" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                      <Users className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <div className="font-medium">Photo de profil</div>
                  <div className="text-slate-500 text-xs">Cliquer pour modifier</div>
                </div>
              </label>
              <input
                id="profile-photo-input"
                type="file"
                accept="image/*"
                onChange={handleProfilePhotoChange}
                className="hidden"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <div className="text-slate-700 font-medium">Nom</div>
                <input
                  value={profileLastName}
                  onChange={(event) => setProfileLastName(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label className="block text-sm">
                <div className="text-slate-700 font-medium">Prénom</div>
                <input
                  value={profileFirstName}
                  onChange={(event) => setProfileFirstName(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </label>
            </div>

            <label className="block text-sm">
              <div className="text-slate-700 font-medium">Téléphone</div>
              <input
                value={profilePhone}
                onChange={(event) => setProfilePhone(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setProfileEditOpen(false)}>
              Annuler
            </button>
            <button type="button" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800" onClick={saveProfileChanges}>
              Enregistrer
            </button>
          </div>
        </div>
      </ModalOverlay>
    </div>
  );
}
