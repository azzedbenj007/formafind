import type Anthropic from "@anthropic-ai/sdk";

// Tous les outils sont en lecture seule. Les schémas sont volontairement
// stricts (additionalProperties: false) pour garantir des arguments valides.
export const OUTILS_GMAO: Anthropic.Tool[] = [
  {
    name: "rechercher_equipements",
    description:
      "Recherche des équipements du parc biomédical/technique selon des filtres. Appelle cet outil pour toute question sur une liste d'équipements (par statut, criticité, service, catégorie, ou recherche textuelle).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        statut: { type: "string", enum: ["operationnel", "en_panne", "en_maintenance", "hors_service", "reforme"] },
        criticite: { type: "string", enum: ["vitale", "haute", "moyenne", "basse"] },
        service: { type: "string", description: "Nom (partiel) du service hospitalier, ex. 'Réanimation'." },
        recherche: { type: "string", description: "Recherche libre sur le nom, code interne ou numéro de série." },
        limite: { type: "integer", minimum: 1, maximum: 50, description: "Nombre maximum de résultats (défaut 20)." },
      },
      required: [],
    },
  },
  {
    name: "obtenir_equipement",
    description:
      "Récupère la fiche complète d'un équipement précis (statut, criticité, localisation, dernières interventions, contrats couvrants, plans de maintenance) à partir de son code interne, son nom ou son numéro de série.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        identifiant: { type: "string", description: "Code interne (ex. RESP-014), nom ou numéro de série." },
      },
      required: ["identifiant"],
    },
  },
  {
    name: "compter_equipements",
    description: "Compte les équipements du parc, groupés par statut, criticité, service ou catégorie.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        dimension: { type: "string", enum: ["statut", "criticite", "service", "categorie"] },
      },
      required: ["dimension"],
    },
  },
  {
    name: "rechercher_interventions",
    description:
      "Recherche des interventions (ordres de travail) selon des filtres : statut, type, priorité, équipement, en retard, période. Appelle cet outil pour toute question sur des interventions passées, en cours ou planifiées.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        statut: { type: "string", enum: ["a_faire", "en_cours", "en_attente_pieces", "terminee", "annulee"] },
        type: { type: "string", enum: ["preventive", "corrective", "controle_reglementaire", "amelioration"] },
        priorite: { type: "string", enum: ["urgente", "haute", "normale", "basse"] },
        equipement: { type: "string", description: "Nom ou code interne de l'équipement concerné." },
        service: { type: "string", description: "Nom (partiel) du service hospitalier." },
        en_retard: { type: "boolean", description: "Si vrai, ne renvoie que les interventions en retard." },
        limite: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: [],
    },
  },
  {
    name: "obtenir_kpis",
    description:
      "Renvoie les indicateurs clés globaux de la GMAO : taux de disponibilité du parc, nombre d'équipements en panne (dont vitaux), interventions ouvertes/en retard, préventif dû sous 30 jours, contrats expirant sous 90 jours, MTTR.",
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "rechercher_contrats",
    description: "Recherche des contrats de maintenance/garantie, avec filtre optionnel sur le statut ou l'expiration prochaine.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        statut: { type: "string", enum: ["actif", "expire", "resilie", "en_renouvellement"] },
        expire_dans_jours: { type: "integer", minimum: 1, description: "Ne renvoie que les contrats actifs expirant dans les N prochains jours." },
        limite: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: [],
    },
  },
  {
    name: "lister_maintenances_dues",
    description: "Liste les plans de maintenance préventive actifs dont l'échéance approche.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        dans_jours: { type: "integer", minimum: 1, description: "Horizon en jours (défaut 30)." },
        limite: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: [],
    },
  },
  {
    name: "rechercher_documents",
    description:
      "Recherche des documents (manuels, certificats, procédures, rapports...) par équipement ou type. Ne renvoie que les métadonnées (titre, type, date) — le contenu des fichiers n'est pas encore consultable.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        equipement: { type: "string", description: "Nom ou code interne de l'équipement." },
        type_document: { type: "string", enum: ["manuel", "certificat", "procedure", "rapport_controle", "photo", "facture", "autre"] },
        recherche: { type: "string" },
        limite: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: [],
    },
  },
  {
    name: "obtenir_charge_equipe",
    description: "Renvoie la charge de travail (interventions ouvertes, en retard, clôturées récemment) par équipe ou par technicien.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        equipe: { type: "string", description: "Nom (partiel) de l'équipe." },
      },
      required: [],
    },
  },
];
