import { z } from "zod";

export const schemaIntervention = z.object({
  titre: z.string().min(1, "Le titre est requis").max(200),
  description: z.string().max(2000).nullable().optional().or(z.literal("")),
  type: z.enum(["preventive", "corrective", "controle_reglementaire", "amelioration"]),
  equipement_id: z.string().uuid("L'équipement est requis"),
  equipe_id: z.string().uuid().nullable().optional().or(z.literal("")),
  technicien_id: z.string().uuid().nullable().optional().or(z.literal("")),
  priorite: z.enum(["urgente", "haute", "normale", "basse"]),
  date_planifiee: z.string().nullable().optional().or(z.literal("")),
  date_echeance: z.string().nullable().optional().or(z.literal("")),
  arret_equipement: z.boolean().optional(),
});

export type ValeursIntervention = z.infer<typeof schemaIntervention>;

export const schemaChangementStatut = z.object({
  statut: z.enum(["a_faire", "en_cours", "en_attente_pieces", "terminee", "annulee"]),
  compte_rendu: z.string().max(4000).nullable().optional().or(z.literal("")),
  cout_pieces: z.coerce.number().nonnegative().optional(),
  cout_main_oeuvre: z.coerce.number().nonnegative().optional(),
});

export type ValeursChangementStatut = z.infer<typeof schemaChangementStatut>;
