import { z } from "zod";

export const schemaEquipe = z.object({
  nom: z.string().min(1, "Le nom est requis").max(200),
  specialite: z.string().max(200).nullable().optional().or(z.literal("")),
  description: z.string().max(2000).nullable().optional().or(z.literal("")),
  responsable_id: z.string().uuid().nullable().optional().or(z.literal("")),
});

export type ValeursEquipe = z.infer<typeof schemaEquipe>;
