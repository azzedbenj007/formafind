import type {
  CriticiteEquipement,
  PrioriteIntervention,
  Role,
  StatutContrat,
  StatutEquipement,
  StatutIntervention,
  TypeContrat,
  TypeDocument,
  TypeIntervention,
} from "./types";

interface Libelle<T extends string> {
  valeur: T;
  label: string;
  classe: string; // classes Tailwind pour un badge (fond + texte)
}

export const ROLES: Libelle<Role>[] = [
  { valeur: "admin", label: "Administrateur", classe: "bg-primary-100 text-primary-700" },
  { valeur: "responsable_maintenance", label: "Responsable maintenance", classe: "bg-purple-100 text-purple-700" },
  { valeur: "technicien", label: "Technicien", classe: "bg-sky-100 text-sky-700" },
  { valeur: "lecture_seule", label: "Lecture seule", classe: "bg-gray-100 text-gray-600" },
];

export const STATUTS_EQUIPEMENT: Libelle<StatutEquipement>[] = [
  { valeur: "operationnel", label: "Opérationnel", classe: "bg-success-100 text-success-700" },
  { valeur: "en_panne", label: "En panne", classe: "bg-danger-100 text-danger-700" },
  { valeur: "en_maintenance", label: "En maintenance", classe: "bg-warning-100 text-warning-700" },
  { valeur: "hors_service", label: "Hors service", classe: "bg-gray-200 text-gray-700" },
  { valeur: "reforme", label: "Réformé", classe: "bg-gray-100 text-gray-500" },
];

export const CRITICITES: Libelle<CriticiteEquipement>[] = [
  { valeur: "vitale", label: "Vitale", classe: "bg-danger-100 text-danger-700" },
  { valeur: "haute", label: "Haute", classe: "bg-warning-100 text-warning-700" },
  { valeur: "moyenne", label: "Moyenne", classe: "bg-primary-100 text-primary-700" },
  { valeur: "basse", label: "Basse", classe: "bg-gray-100 text-gray-600" },
];

export const TYPES_INTERVENTION: Libelle<TypeIntervention>[] = [
  { valeur: "preventive", label: "Préventive", classe: "bg-primary-100 text-primary-700" },
  { valeur: "corrective", label: "Corrective", classe: "bg-danger-100 text-danger-700" },
  { valeur: "controle_reglementaire", label: "Contrôle réglementaire", classe: "bg-purple-100 text-purple-700" },
  { valeur: "amelioration", label: "Amélioration", classe: "bg-success-100 text-success-700" },
];

export const STATUTS_INTERVENTION: Libelle<StatutIntervention>[] = [
  { valeur: "a_faire", label: "À faire", classe: "bg-gray-200 text-gray-700" },
  { valeur: "en_cours", label: "En cours", classe: "bg-primary-100 text-primary-700" },
  { valeur: "en_attente_pieces", label: "En attente de pièces", classe: "bg-warning-100 text-warning-700" },
  { valeur: "terminee", label: "Terminée", classe: "bg-success-100 text-success-700" },
  { valeur: "annulee", label: "Annulée", classe: "bg-gray-100 text-gray-500" },
];

export const PRIORITES: Libelle<PrioriteIntervention>[] = [
  { valeur: "urgente", label: "Urgente", classe: "bg-danger-100 text-danger-700" },
  { valeur: "haute", label: "Haute", classe: "bg-warning-100 text-warning-700" },
  { valeur: "normale", label: "Normale", classe: "bg-primary-100 text-primary-700" },
  { valeur: "basse", label: "Basse", classe: "bg-gray-100 text-gray-600" },
];

export const TYPES_DOCUMENT: Libelle<TypeDocument>[] = [
  { valeur: "manuel", label: "Manuel", classe: "bg-primary-100 text-primary-700" },
  { valeur: "certificat", label: "Certificat", classe: "bg-success-100 text-success-700" },
  { valeur: "procedure", label: "Procédure", classe: "bg-purple-100 text-purple-700" },
  { valeur: "rapport_controle", label: "Rapport de contrôle", classe: "bg-warning-100 text-warning-700" },
  { valeur: "photo", label: "Photo", classe: "bg-gray-100 text-gray-600" },
  { valeur: "facture", label: "Facture", classe: "bg-gray-100 text-gray-600" },
  { valeur: "autre", label: "Autre", classe: "bg-gray-100 text-gray-600" },
];

export const TYPES_CONTRAT: Libelle<TypeContrat>[] = [
  { valeur: "maintenance_preventive", label: "Maintenance préventive", classe: "bg-primary-100 text-primary-700" },
  { valeur: "full_service", label: "Full service", classe: "bg-success-100 text-success-700" },
  { valeur: "garantie", label: "Garantie", classe: "bg-purple-100 text-purple-700" },
  { valeur: "location", label: "Location", classe: "bg-warning-100 text-warning-700" },
  { valeur: "assistance", label: "Assistance", classe: "bg-gray-100 text-gray-600" },
];

export const STATUTS_CONTRAT: Libelle<StatutContrat>[] = [
  { valeur: "actif", label: "Actif", classe: "bg-success-100 text-success-700" },
  { valeur: "expire", label: "Expiré", classe: "bg-danger-100 text-danger-700" },
  { valeur: "resilie", label: "Résilié", classe: "bg-gray-100 text-gray-500" },
  { valeur: "en_renouvellement", label: "En renouvellement", classe: "bg-warning-100 text-warning-700" },
];

function trouver<T extends string>(liste: Libelle<T>[], valeur: T): Libelle<T> {
  return liste.find((l) => l.valeur === valeur) ?? { valeur, label: valeur, classe: "bg-gray-100 text-gray-600" };
}

export const libelleRole = (v: Role) => trouver(ROLES, v);
export const libelleStatutEquipement = (v: StatutEquipement) => trouver(STATUTS_EQUIPEMENT, v);
export const libelleCriticite = (v: CriticiteEquipement) => trouver(CRITICITES, v);
export const libelleTypeIntervention = (v: TypeIntervention) => trouver(TYPES_INTERVENTION, v);
export const libelleStatutIntervention = (v: StatutIntervention) => trouver(STATUTS_INTERVENTION, v);
export const libellePriorite = (v: PrioriteIntervention) => trouver(PRIORITES, v);
export const libelleTypeDocument = (v: TypeDocument) => trouver(TYPES_DOCUMENT, v);
export const libelleTypeContrat = (v: TypeContrat) => trouver(TYPES_CONTRAT, v);
export const libelleStatutContrat = (v: StatutContrat) => trouver(STATUTS_CONTRAT, v);

export const NAV_PRINCIPALE = [
  { href: "/tableau-de-bord", label: "Tableau de bord", icone: "LayoutDashboard" },
  { href: "/equipements", label: "Équipements", icone: "Wrench" },
  { href: "/interventions", label: "Interventions", icone: "ClipboardList" },
  { href: "/plans-maintenance", label: "Plans de maintenance", icone: "CalendarClock" },
  { href: "/equipes", label: "Équipes", icone: "Users" },
  { href: "/documents", label: "Documents", icone: "FileText" },
  { href: "/contrats", label: "Contrats", icone: "FileSignature" },
  { href: "/assistant", label: "Assistant IA", icone: "Bot" },
] as const;
