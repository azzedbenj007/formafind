import { z } from "zod";

export const schemaFournisseur = z.object({
  nom: z.string().min(1, "Le nom est requis").max(200),
  contact_nom: z.string().max(200).nullable().optional().or(z.literal("")),
  email: z.string().email("Adresse e-mail invalide").max(200).nullable().optional().or(z.literal("")),
  telephone: z.string().max(50).nullable().optional().or(z.literal("")),
  adresse: z.string().max(300).nullable().optional().or(z.literal("")),
  siret: z.string().max(50).nullable().optional().or(z.literal("")),
  notes: z.string().max(2000).nullable().optional().or(z.literal("")),
});

export type ValeursFournisseur = z.infer<typeof schemaFournisseur>;
