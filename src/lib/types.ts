// Types métier — reflètent les tables et vues de supabase/schema.sql.
// NB : le client Supabase n'est pas paramétré par des types générés
// (`supabase gen types typescript`) car aucun projet Supabase réel n'est
// encore connecté à ce dépôt. Une fois le projet créé, générez
// `src/lib/database.types.ts` et migrez progressivement vers
// `createClient<Database>()` pour un typage bout-en-bout.

export type Role = "admin" | "responsable_maintenance" | "technicien" | "lecture_seule";

export type StatutEquipement = "operationnel" | "en_panne" | "en_maintenance" | "hors_service" | "reforme";
export type CriticiteEquipement = "vitale" | "haute" | "moyenne" | "basse";
export type FamilleCategorie = "biomedical" | "technique" | "informatique" | "autre";

export type TypeIntervention = "preventive" | "corrective" | "controle_reglementaire" | "amelioration";
export type StatutIntervention = "a_faire" | "en_cours" | "en_attente_pieces" | "terminee" | "annulee";
export type PrioriteIntervention = "urgente" | "haute" | "normale" | "basse";

export type TypeDocument = "manuel" | "certificat" | "procedure" | "rapport_controle" | "photo" | "facture" | "autre";
export type StatutIndexation = "non_indexe" | "en_cours" | "indexe" | "erreur";

export type TypeContrat = "maintenance_preventive" | "full_service" | "garantie" | "location" | "assistance";
export type StatutContrat = "actif" | "expire" | "resilie" | "en_renouvellement";

export type FrequenceUnite = "jours" | "semaines" | "mois" | "annees";

export type TypeNotification =
  | "maintenance_due"
  | "intervention_retard"
  | "contrat_expire"
  | "equipement_panne"
  | "affectation";

export interface Profile {
  id: string;
  email: string;
  nom_complet: string | null;
  telephone: string | null;
  role: Role;
  avatar_url: string | null;
  actif: boolean;
  created_at: string;
}

export interface Site {
  id: string;
  nom: string;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  created_at: string;
}

export interface ServiceHospitalier {
  id: string;
  site_id: string;
  nom: string;
  code: string | null;
  etage: string | null;
  responsable_nom: string | null;
  telephone: string | null;
  created_at: string;
}

export interface CategorieEquipement {
  id: string;
  nom: string;
  famille: FamilleCategorie;
  description: string | null;
  criticite_par_defaut: CriticiteEquipement | null;
  created_at: string;
}

export interface Fournisseur {
  id: string;
  nom: string;
  contact_nom: string | null;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  siret: string | null;
  notes: string | null;
  created_at: string;
}

export interface Equipement {
  id: string;
  code_interne: string;
  nom: string;
  categorie_id: string | null;
  numero_serie: string | null;
  modele: string | null;
  fabricant: string | null;
  fournisseur_id: string | null;
  site_id: string;
  service_id: string | null;
  localisation_precise: string | null;
  statut: StatutEquipement;
  criticite: CriticiteEquipement;
  date_achat: string | null;
  date_mise_service: string | null;
  fin_garantie: string | null;
  cout_acquisition: number | null;
  photo_url: string | null;
  notes: string | null;
  actif: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EquipementDetail extends Equipement {
  categorie_nom: string | null;
  categorie_famille: FamilleCategorie | null;
  service_nom: string | null;
  site_nom: string | null;
  fournisseur_nom: string | null;
  derniere_intervention_le: string | null;
  nb_interventions_ouvertes: number;
  sous_contrat: boolean;
}

export interface Equipe {
  id: string;
  nom: string;
  specialite: string | null;
  description: string | null;
  responsable_id: string | null;
  created_at: string;
}

export interface MembreEquipe {
  equipe_id: string;
  profile_id: string;
  role_dans_equipe: string | null;
  date_affectation: string | null;
}

export interface Competence {
  id: string;
  nom: string;
  description: string | null;
}

export interface ProfilCompetence {
  profile_id: string;
  competence_id: string;
  niveau: number;
  date_certification: string | null;
}

export interface PlanMaintenance {
  id: string;
  equipement_id: string;
  nom: string;
  description: string | null;
  type_intervention: "preventive" | "controle_reglementaire";
  frequence_valeur: number;
  frequence_unite: FrequenceUnite;
  prochaine_echeance: string;
  derniere_execution: string | null;
  duree_estimee_min: number | null;
  equipe_id: string | null;
  priorite: PrioriteIntervention;
  checklist: { libelle: string; obligatoire: boolean }[];
  jours_anticipation: number;
  actif: boolean;
  created_at: string;
}

export interface Intervention {
  id: string;
  numero: string | null;
  titre: string;
  description: string | null;
  type: TypeIntervention;
  equipement_id: string;
  plan_maintenance_id: string | null;
  demandeur_id: string | null;
  equipe_id: string | null;
  technicien_id: string | null;
  statut: StatutIntervention;
  priorite: PrioriteIntervention;
  date_planifiee: string | null;
  date_echeance: string | null;
  date_debut: string | null;
  date_fin: string | null;
  duree_reelle_min: number | null;
  arret_equipement: boolean;
  compte_rendu: string | null;
  checklist_resultats: { libelle: string; obligatoire: boolean; fait?: boolean }[] | null;
  cout_pieces: number;
  cout_main_oeuvre: number;
  created_at: string;
  updated_at: string;
}

export interface InterventionDetail extends Intervention {
  equipement_nom: string;
  equipement_code_interne: string;
  equipement_criticite: CriticiteEquipement;
  service_nom: string | null;
  equipe_nom: string | null;
  technicien_nom: string | null;
  en_retard: boolean;
}

export interface InterventionHistoriqueEntry {
  id: string;
  intervention_id: string;
  profile_id: string | null;
  type_evenement: "creation" | "changement_statut" | "affectation" | "commentaire" | "cloture";
  ancien_statut: string | null;
  nouveau_statut: string | null;
  commentaire: string | null;
  created_at: string;
}

export interface Contrat {
  id: string;
  reference: string;
  intitule: string;
  fournisseur_id: string;
  type_contrat: TypeContrat;
  date_debut: string;
  date_fin: string;
  cout_annuel: number | null;
  delai_intervention_heures: number | null;
  couverture_horaire: string | null;
  conditions: string | null;
  tacite_reconduction: boolean;
  preavis_jours: number | null;
  statut: StatutContrat;
  created_at: string;
  updated_at: string;
}

export interface ContratDetail extends Contrat {
  fournisseur_nom: string;
  nb_equipements_couverts: number;
  jours_avant_expiration: number;
}

export interface DocumentGmao {
  id: string;
  titre: string;
  type_document: TypeDocument;
  chemin_stockage: string;
  nom_fichier: string | null;
  mime_type: string | null;
  taille_octets: number | null;
  equipement_id: string | null;
  contrat_id: string | null;
  intervention_id: string | null;
  tags: string[];
  description: string | null;
  statut_indexation: StatutIndexation;
  indexe_le: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  profile_id: string | null;
  role_cible: Role | null;
  type: TypeNotification;
  titre: string;
  message: string | null;
  lien: string | null;
  lu: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  profile_id: string;
  titre: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageChat {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  contenu: string;
  outils_utilises: { nom: string; arguments?: unknown }[];
  tokens_entree: number | null;
  tokens_sortie: number | null;
  created_at: string;
}

export interface KpiGlobal {
  total_equipements: number;
  equipements_en_panne: number;
  equipements_vitaux_en_panne: number;
  taux_disponibilite: number;
  interventions_ouvertes: number;
  interventions_en_retard: number;
  preventif_du_30j: number;
  contrats_expirant_90j: number;
  mttr_heures_30j: number | null;
}
