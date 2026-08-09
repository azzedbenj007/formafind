"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  schemaChangementStatut,
  schemaIntervention,
  type ValeursChangementStatut,
  type ValeursIntervention,
} from "@/lib/validation/intervention";

function videVersNull<T>(v: T | "" | null | undefined): T | null {
  return v === "" || v === undefined ? null : v;
}

type EtatFormulaire = { erreur?: string; erreurs_champs?: Record<string, string> };

export async function creerIntervention(valeursBrutes: ValeursIntervention): Promise<EtatFormulaire | never> {
  const analyse = schemaIntervention.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }
  const v = analyse.data;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("interventions")
    .insert({
      titre: v.titre.trim(),
      description: videVersNull(v.description),
      type: v.type,
      equipement_id: v.equipement_id,
      equipe_id: videVersNull(v.equipe_id),
      technicien_id: videVersNull(v.technicien_id),
      priorite: v.priorite,
      date_planifiee: videVersNull(v.date_planifiee),
      date_echeance: videVersNull(v.date_echeance),
      arret_equipement: v.arret_equipement ?? false,
      demandeur_id: user?.id ?? null,
      statut: "a_faire",
    })
    .select("id")
    .single();

  if (error) return { erreur: "Impossible de créer l'intervention : " + error.message };

  revalidatePath("/interventions");
  revalidatePath(`/equipements/${v.equipement_id}`);
  redirect(`/interventions/${data.id}`);
}

export async function changerStatutIntervention(
  interventionId: string,
  equipementId: string,
  valeursBrutes: ValeursChangementStatut
): Promise<EtatFormulaire> {
  const analyse = schemaChangementStatut.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }
  const v = analyse.data;

  if (v.statut === "terminee" && !v.compte_rendu?.trim()) {
    return { erreur: "Un compte-rendu est requis pour clôturer une intervention." };
  }

  const supabase = await createServerSupabaseClient();
  const { data: actuelle } = await supabase
    .from("interventions")
    .select("date_debut, date_fin")
    .eq("id", interventionId)
    .single();

  const maj: Record<string, unknown> = { statut: v.statut };
  if (v.compte_rendu) maj.compte_rendu = v.compte_rendu.trim();
  if (v.cout_pieces !== undefined) maj.cout_pieces = v.cout_pieces;
  if (v.cout_main_oeuvre !== undefined) maj.cout_main_oeuvre = v.cout_main_oeuvre;

  const maintenant = new Date().toISOString();
  if (v.statut === "en_cours" && !actuelle?.date_debut) {
    maj.date_debut = maintenant;
  }
  if (v.statut === "terminee") {
    maj.date_fin = maintenant;
    const debut = actuelle?.date_debut ? new Date(actuelle.date_debut).getTime() : null;
    if (debut) maj.duree_reelle_min = Math.round((Date.now() - debut) / 60000);
  }

  const { error } = await supabase.from("interventions").update(maj).eq("id", interventionId);
  if (error) return { erreur: "Impossible de mettre à jour le statut : " + error.message };

  revalidatePath(`/interventions/${interventionId}`);
  revalidatePath("/interventions");
  revalidatePath(`/equipements/${equipementId}`);
  return {};
}

export async function affecterIntervention(
  interventionId: string,
  equipementId: string,
  equipeId: string | null,
  technicienId: string | null
) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("interventions")
    .update({ equipe_id: equipeId, technicien_id: technicienId })
    .eq("id", interventionId);

  if (error) return { erreur: "Impossible d'affecter l'intervention : " + error.message };

  revalidatePath(`/interventions/${interventionId}`);
  revalidatePath("/interventions");
  revalidatePath(`/equipements/${equipementId}`);
  return {};
}

export async function ajouterCommentaireIntervention(interventionId: string, commentaire: string) {
  if (!commentaire.trim()) return { erreur: "Le commentaire ne peut pas être vide." };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("interventions_historique").insert({
    intervention_id: interventionId,
    profile_id: user?.id ?? null,
    type_evenement: "commentaire",
    commentaire: commentaire.trim(),
  });

  if (error) return { erreur: "Impossible d'ajouter le commentaire : " + error.message };

  revalidatePath(`/interventions/${interventionId}`);
  return {};
}
