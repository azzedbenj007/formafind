"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { schemaFournisseur, type ValeursFournisseur } from "@/lib/validation/fournisseur";

function videVersNull<T>(v: T | "" | null | undefined): T | null {
  return v === "" || v === undefined ? null : v;
}

function normaliser(valeurs: ValeursFournisseur) {
  return {
    nom: valeurs.nom.trim(),
    contact_nom: videVersNull(valeurs.contact_nom),
    email: videVersNull(valeurs.email),
    telephone: videVersNull(valeurs.telephone),
    adresse: videVersNull(valeurs.adresse),
    siret: videVersNull(valeurs.siret),
    notes: videVersNull(valeurs.notes),
  };
}

export type EtatFormulaireFournisseur = { erreur?: string; erreurs_champs?: Record<string, string> };

export async function creerFournisseur(
  valeursBrutes: ValeursFournisseur
): Promise<EtatFormulaireFournisseur | never> {
  const analyse = schemaFournisseur.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("fournisseurs").insert(normaliser(analyse.data));

  if (error) {
    return { erreur: "Impossible de créer le fournisseur : " + error.message };
  }

  revalidatePath("/fournisseurs");
  redirect("/fournisseurs");
}

export async function modifierFournisseur(
  id: string,
  valeursBrutes: ValeursFournisseur
): Promise<EtatFormulaireFournisseur | never> {
  const analyse = schemaFournisseur.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("fournisseurs").update(normaliser(analyse.data)).eq("id", id);

  if (error) {
    return { erreur: "Impossible de modifier le fournisseur : " + error.message };
  }

  revalidatePath("/fournisseurs");
  redirect("/fournisseurs");
}
