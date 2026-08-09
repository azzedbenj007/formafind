import { z } from "zod";

export const schemaContrat = z
  .object({
    reference: z.string().min(1, "La référence est requise").max(100),
    intitule: z.string().min(1, "L'intitulé est requis").max(200),
    fournisseur_id: z.string().uuid("Le fournisseur est requis"),
    type_contrat: z.enum(["maintenance_preventive", "full_service", "garantie", "location", "assistance"]),
    date_debut: z.string().min(1, "La date de début est requise"),
    date_fin: z.string().min(1, "La date de fin est requise"),
    cout_annuel: z.coerce.number().nonnegative().nullable().optional(),
    delai_intervention_heures: z.coerce.number().int().nonnegative().nullable().optional(),
    couverture_horaire: z.string().max(200).nullable().optional().or(z.literal("")),
    conditions: z.string().max(2000).nullable().optional().or(z.literal("")),
    tacite_reconduction: z.boolean().default(false),
    preavis_jours: z.coerce.number().int().nonnegative().nullable().optional().default(90),
    statut: z.enum(["actif", "expire", "resilie", "en_renouvellement"]).default("actif"),
  })
  .refine((v) => !v.date_debut || !v.date_fin || v.date_fin > v.date_debut, {
    message: "La date de fin doit être postérieure à la date de début.",
    path: ["date_fin"],
  });

export type ValeursContrat = z.infer<typeof schemaContrat>;
