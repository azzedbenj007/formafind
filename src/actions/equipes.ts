"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { schemaEquipe, type ValeursEquipe } from "@/lib/validation/equipe";

function videVersNull<T>(v: T | "" | null | undefined): T | null {
  return v === "" || v === undefined ? null : v;
}

function normaliser(valeurs: ValeursEquipe) {
  return {
    nom: valeurs.nom.trim(),
    specialite: videVersNull(valeurs.specialite),
    description: videVersNull(valeurs.description),
    responsable_id: videVersNull(valeurs.responsable_id),
  };
}

export type EtatFormulaireEquipe = { erreur?: string; erreurs_champs?: Record<string, string> };

export async function creerEquipe(valeursBrutes: ValeursEquipe): Promise<EtatFormulaireEquipe | never> {
  const analyse = schemaEquipe.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("equipes").insert(normaliser(analyse.data)).select("id").single();

  if (error) {
    return { erreur: "Impossible de créer l'équipe : " + error.message };
  }

  revalidatePath("/equipes");
  redirect(`/equipes/${data.id}`);
}

export async function modifierEquipe(id: string, valeursBrutes: ValeursEquipe): Promise<EtatFormulaireEquipe | never> {
  const analyse = schemaEquipe.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("equipes").update(normaliser(analyse.data)).eq("id", id);

  if (error) {
    return { erreur: "Impossible de modifier l'équipe : " + error.message };
  }

  revalidatePath("/equipes");
  revalidatePath(`/equipes/${id}`);
  redirect(`/equipes/${id}`);
}

export async function ajouterMembre(equipeId: string, profileId: string, roleDansEquipe: string) {
  if (!profileId) return { erreur: "Sélectionnez un membre à ajouter." };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("membres_equipe").insert({
    equipe_id: equipeId,
    profile_id: profileId,
    role_dans_equipe: roleDansEquipe.trim() || "technicien",
  });

  if (error) {
    return { erreur: "Impossible d'ajouter ce membre : " + error.message };
  }

  revalidatePath(`/equipes/${equipeId}`);
  return { succes: true };
}

export async function retirerMembre(equipeId: string, profileId: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("membres_equipe")
    .delete()
    .eq("equipe_id", equipeId)
    .eq("profile_id", profileId);

  if (error) {
    return { erreur: "Impossible de retirer ce membre : " + error.message };
  }

  revalidatePath(`/equipes/${equipeId}`);
  return { succes: true };
}
