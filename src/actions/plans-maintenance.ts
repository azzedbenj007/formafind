"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { schemaPlanMaintenance, type ValeursPlanMaintenance } from "@/lib/validation/plan-maintenance";

function videVersNull<T>(v: T | "" | null | undefined): T | null {
  return v === "" || v === undefined ? null : v;
}

type EtatFormulaire = { erreur?: string; erreurs_champs?: Record<string, string> };

function normaliser(v: ValeursPlanMaintenance) {
  return {
    equipement_id: v.equipement_id,
    nom: v.nom.trim(),
    description: videVersNull(v.description),
    type_intervention: v.type_intervention,
    frequence_valeur: v.frequence_valeur,
    frequence_unite: v.frequence_unite,
    prochaine_echeance: v.prochaine_echeance,
    duree_estimee_min: v.duree_estimee_min ?? null,
    equipe_id: videVersNull(v.equipe_id),
    priorite: v.priorite,
    jours_anticipation: v.jours_anticipation,
    checklist: v.checklist ?? [],
  };
}

export async function creerPlanMaintenance(valeursBrutes: ValeursPlanMaintenance): Promise<EtatFormulaire | never> {
  const analyse = schemaPlanMaintenance.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("plans_maintenance").insert(normaliser(analyse.data));

  if (error) return { erreur: "Impossible de créer le plan : " + error.message };

  revalidatePath("/plans-maintenance");
  revalidatePath(`/equipements/${analyse.data.equipement_id}`);
  redirect("/plans-maintenance");
}

export async function modifierPlanMaintenance(
  id: string,
  valeursBrutes: ValeursPlanMaintenance
): Promise<EtatFormulaire | never> {
  const analyse = schemaPlanMaintenance.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("plans_maintenance").update(normaliser(analyse.data)).eq("id", id);

  if (error) return { erreur: "Impossible de modifier le plan : " + error.message };

  revalidatePath("/plans-maintenance");
  revalidatePath(`/equipements/${analyse.data.equipement_id}`);
  redirect("/plans-maintenance");
}

export async function basculerActifPlanMaintenance(id: string, actif: boolean, equipementId: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("plans_maintenance").update({ actif }).eq("id", id);
  if (error) return { erreur: "Impossible de mettre à jour le plan : " + error.message };

  revalidatePath("/plans-maintenance");
  revalidatePath(`/equipements/${equipementId}`);
  return {};
}
