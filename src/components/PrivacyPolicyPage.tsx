import { useEffect } from 'react';

const sections = [
  {
    title: '1. DONNEES COLLECTEES',
    content: (
      <>
        <p>Selon le profil de l'utilisateur et les fonctionnalites utilisees, EcolesTrack peut traiter :</p>
        <ul>
          <li>Nom et prenom</li>
          <li>Adresse e-mail</li>
          <li>Numero de telephone</li>
          <li>Informations necessaires a l'authentification</li>
          <li>Role de l'utilisateur : eleve, parent, enseignant, administrateur ou personnel scolaire</li>
          <li>Informations concernant les eleves</li>
          <li>Informations concernant les parents ou responsables</li>
          <li>Informations concernant les enseignants</li>
          <li>Classes et groupes scolaires</li>
          <li>Notes et resultats scolaires</li>
          <li>Presences et absences</li>
          <li>Emplois du temps</li>
          <li>Informations relatives aux activites scolaires</li>
          <li>Communications necessaires au fonctionnement du service</li>
          <li>Photos et documents fournis volontairement par les utilisateurs</li>
          <li>Donnees techniques necessaires au fonctionnement et a la securite du service</li>
        </ul>
      </>
    ),
  },
  {
    title: '2. UTILISATION DES DONNEES',
    content: (
      <>
        <p>Les donnees peuvent etre utilisees pour :</p>
        <ul>
          <li>creer et gerer les comptes utilisateurs ;</li>
          <li>permettre l'authentification ;</li>
          <li>gerer les profils des eleves, parents, enseignants et administrateurs ;</li>
          <li>assurer le suivi scolaire ;</li>
          <li>gerer les classes, notes, presences et emplois du temps ;</li>
          <li>permettre les communications entre utilisateurs autorises ;</li>
          <li>fournir les fonctionnalites demandees par les etablissements ;</li>
          <li>envoyer des notifications ;</li>
          <li>assurer la securite du service ;</li>
          <li>detecter et prevenir les utilisations frauduleuses ou abusives ;</li>
          <li>resoudre les problemes techniques ;</li>
          <li>ameliorer la fiabilite et les performances d'EcolesTrack.</li>
        </ul>
      </>
    ),
  },
  {
    title: '3. NOTIFICATIONS',
    content: <p>L'application Android peut utiliser Firebase Cloud Messaging (FCM) pour envoyer des notifications liees au service. Ces notifications peuvent informer les utilisateurs de nouvelles informations, evenements ou actions necessitant leur attention.</p>,
  },
  {
    title: '4. PHOTOS ET FICHIERS',
    content: <p>Lorsque l'utilisateur ou un etablissement ajoute volontairement une photo, un document ou un autre fichier, celui-ci peut etre stocke et traite afin de fournir la fonctionnalite correspondante.</p>,
  },
  {
    title: '5. DONNEES CONCERNANT LES ELEVES ET LES MINEURS',
    content: <p>EcolesTrack etant une plateforme destinee au contexte scolaire, certaines informations peuvent concerner des eleves mineurs. Ces informations doivent etre collectees et utilisees par les etablissements, responsables legaux ou personnes autorisees conformement aux lois et reglementations applicables. EcolesTrack traite ces informations dans le cadre des fonctionnalites proposees par la plateforme et selon les autorisations applicables.</p>,
  },
  {
    title: '6. PARTAGE DES DONNEES',
    content: (
      <>
        <p>EcolesTrack ne vend pas les donnees personnelles de ses utilisateurs.</p>
        <p>Certaines donnees peuvent etre traitees par des prestataires techniques necessaires au fonctionnement du service, notamment pour :</p>
        <ul>
          <li>l'hebergement ;</li>
          <li>le stockage ;</li>
          <li>l'authentification ;</li>
          <li>les notifications ;</li>
          <li>la securite ;</li>
          <li>la maintenance et le fonctionnement technique du service.</li>
        </ul>
      </>
    ),
  },
  {
    title: '7. FIREBASE',
    content: <p>EcolesTrack peut utiliser des services Firebase fournis par Google, notamment Firebase Cloud Messaging pour les notifications. Les services Firebase peuvent traiter certaines informations techniques necessaires a leur fonctionnement.</p>,
  },
  {
    title: '8. CONSERVATION DES DONNEES',
    content: <p>Les donnees sont conservees pendant la duree necessaire au fonctionnement du service et pendant toute periode supplementaire requise ou autorisee par la legislation applicable. Lorsqu'une donnee n'est plus necessaire, elle peut etre supprimee ou anonymisee, sous reserve des obligations legales ou des necessites legitimes de conservation.</p>,
  },
  {
    title: '9. SECURITE',
    content: <p>EcolesTrack met en œuvre des mesures techniques et organisationnelles raisonnables destinees a proteger les donnees contre l'acces non autorise, la perte, la modification ou la divulgation. Aucun service connecte a Internet ne peut toutefois garantir une securite absolue.</p>,
  },
  {
    title: '10. DROITS DES UTILISATEURS',
    content: (
      <>
        <p>Selon la legislation applicable, les utilisateurs peuvent notamment demander :</p>
        <ul>
          <li>l'acces a leurs donnees ;</li>
          <li>la rectification de donnees incorrectes ;</li>
          <li>la suppression de certaines donnees ;</li>
          <li>la limitation de certains traitements lorsque la legislation le prevoit ;</li>
          <li>le retrait d'un consentement lorsque le traitement repose sur le consentement.</li>
        </ul>
      </>
    ),
  },
  {
    title: '11. SUPPRESSION DU COMPTE ET DES DONNEES',
    content: <p>Les utilisateurs peuvent demander la suppression de leur compte et des donnees personnelles qui lui sont associees, sous reserve des obligations legales et des donnees devant etre conservees pour des raisons legitimes. La demande peut etre effectuee via les coordonnees de contact disponibles sur le site EcolesTrack. Lorsque certaines donnees sont gerees par un etablissement scolaire, la demande peut egalement necessiter l'intervention de l'etablissement concerne.</p>,
  },
  {
    title: '12. MODIFICATIONS DE LA POLITIQUE',
    content: <p>Cette politique peut etre modifiee lorsque les fonctionnalites d'EcolesTrack evoluent ou lorsque les exigences legales changent. La date de derniere mise a jour doit toujours etre affichee en haut de la page.</p>,
  },
  {
    title: '13. CONTACT',
    content: (
      <>
        <p>Pour toute question concernant cette politique de confidentialite ou le traitement des donnees personnelles, l'utilisateur peut contacter EcolesTrack via les coordonnees officielles disponibles sur le site.</p>
        <p>
          Site officiel :{' '}
          <a href="https://ecolestrack.online">https://ecolestrack.online</a>
        </p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = 'Politique de confidentialite — EcolesTrack';
  }, []);

  return (
    <div className="min-h-screen bg-[#f4f7f5] text-slate-800">
      <header className="border-b border-emerald-950/10 bg-[#103c35] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <a href="/" className="font-display text-lg font-bold tracking-tight">EcolesTrack</a>
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-100">Confidentialite</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        <section className="border-b border-emerald-900/10 pb-10 sm:pb-14">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Document officiel</p>
          <h1 className="max-w-3xl font-display text-3xl font-bold leading-tight text-[#103c35] sm:text-5xl">
            Politique de confidentialite — EcolesTrack
          </h1>
          <p className="mt-5 text-sm text-slate-600">Date de derniere mise a jour : 25 septembre 2026</p>
          <p className="mt-8 max-w-3xl text-base leading-8 text-slate-700 sm:text-lg">
            EcolesTrack est une plateforme de gestion et de suivi scolaire accessible depuis le Web et une application Android. Cette politique explique quelles informations peuvent etre collectees et traitees lorsque les utilisateurs utilisent EcolesTrack, pourquoi elles sont utilisees et quels sont leurs droits.
          </p>
        </section>

        <div className="divide-y divide-emerald-900/10">
          {sections.map((section) => (
            <section key={section.title} className="py-8 first:pt-10 sm:py-10">
              <h2 className="font-display text-xl font-bold text-[#103c35] sm:text-2xl">{section.title}</h2>
              <div className="mt-4 max-w-3xl space-y-4 text-[15px] leading-8 text-slate-700 [&_a]:font-semibold [&_a]:text-emerald-700 [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
                {section.content}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t border-emerald-950/10 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-8 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© 2026 EcolesTrack</span>
          <a className="font-semibold text-emerald-700 underline underline-offset-4" href="/politique-confidentialite">Politique de confidentialite</a>
        </div>
      </footer>
    </div>
  );
}
