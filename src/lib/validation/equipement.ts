import { z } from "zod";

export const schemaEquipement = z.object({
  code_interne: z.string().min(1, "Le code interne est requis").max(50),
  nom: z.string().min(1, "Le nom est requis").max(200),
  categorie_id: z.string().uuid().nullable().optional().or(z.literal("")),
  numero_serie: z.string().max(100).nullable().optional().or(z.literal("")),
  modele: z.string().max(200).nullable().optional().or(z.literal("")),
  fabricant: z.string().max(200).nullable().optional().or(z.literal("")),
  fournisseur_id: z.string().uuid().nullable().optional().or(z.literal("")),
  site_id: z.string().uuid("Le site est requis"),
  service_id: z.string().uuid().nullable().optional().or(z.literal("")),
  localisation_precise: z.string().max(200).nullable().optional().or(z.literal("")),
  statut: z.enum(["operationnel", "en_panne", "en_maintenance", "hors_service", "reforme"]),
  criticite: z.enum(["vitale", "haute", "moyenne", "basse"]),
  date_achat: z.string().nullable().optional().or(z.literal("")),
  date_mise_service: z.string().nullable().optional().or(z.literal("")),
  fin_garantie: z.string().nullable().optional().or(z.literal("")),
  cout_acquisition: z.coerce.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional().or(z.literal("")),
});

export type ValeursEquipement = z.infer<typeof schemaEquipement>;
