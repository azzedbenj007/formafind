import { z } from "zod";

export const schemaItemChecklist = z.object({
  libelle: z.string().min(1),
  obligatoire: z.boolean(),
});

export const schemaPlanMaintenance = z.object({
  equipement_id: z.string().uuid("L'équipement est requis"),
  nom: z.string().min(1, "Le nom est requis").max(200),
  description: z.string().max(2000).nullable().optional().or(z.literal("")),
  type_intervention: z.enum(["preventive", "controle_reglementaire"]),
  frequence_valeur: z.coerce.number().int().positive("Doit être supérieur à 0"),
  frequence_unite: z.enum(["jours", "semaines", "mois", "annees"]),
  prochaine_echeance: z.string().min(1, "L'échéance est requise"),
  duree_estimee_min: z.coerce.number().int().nonnegative().optional(),
  equipe_id: z.string().uuid().nullable().optional().or(z.literal("")),
  priorite: z.enum(["urgente", "haute", "normale", "basse"]),
  jours_anticipation: z.coerce.number().int().nonnegative(),
  checklist: z.array(schemaItemChecklist).default([]),
  actif: z.boolean().optional(),
});

export type ValeursPlanMaintenance = z.infer<typeof schemaPlanMaintenance>;
