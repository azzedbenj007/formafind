"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { schemaContrat, type ValeursContrat } from "@/lib/validation/contrat";

function videVersNull<T>(v: T | "" | null | undefined): T | null {
  return v === "" || v === undefined ? null : v;
}

function normaliser(valeurs: ValeursContrat) {
  return {
    reference: valeurs.reference.trim(),
    intitule: valeurs.intitule.trim(),
    fournisseur_id: valeurs.fournisseur_id,
    type_contrat: valeurs.type_contrat,
    date_debut: valeurs.date_debut,
    date_fin: valeurs.date_fin,
    cout_annuel: valeurs.cout_annuel ?? null,
    delai_intervention_heures: valeurs.delai_intervention_heures ?? null,
    couverture_horaire: videVersNull(valeurs.couverture_horaire),
    conditions: videVersNull(valeurs.conditions),
    tacite_reconduction: valeurs.tacite_reconduction,
    preavis_jours: valeurs.preavis_jours ?? null,
    statut: valeurs.statut,
  };
}

export type EtatFormulaireContrat = { erreur?: string; erreurs_champs?: Record<string, string> };

export async function creerContrat(
  valeursBrutes: ValeursContrat,
  equipementIds: string[] = []
): Promise<EtatFormulaireContrat | never> {
  const analyse = schemaContrat.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("contrats").insert(normaliser(analyse.data)).select("id").single();

  if (error) {
    return { erreur: "Impossible de créer le contrat : " + error.message };
  }

  if (equipementIds.length > 0) {
    const lignes = equipementIds.map((equipement_id) => ({ contrat_id: data.id, equipement_id }));
    const { error: erreurAssoc } = await supabase.from("contrats_equipements").insert(lignes);
    if (erreurAssoc) {
      return { erreur: "Contrat créé mais échec de l'association des équipements : " + erreurAssoc.message };
    }
  }

  revalidatePath("/contrats");
  redirect(`/contrats/${data.id}`);
}

// equipementIds optionnel : quand fourni, remplace intégralement les équipements
// couverts avant la redirection (même logique que creerContrat — évite de
// chaîner deux Server Actions séparées autour d'un redirect()).
export async function modifierContrat(
  id: string,
  valeursBrutes: ValeursContrat,
  equipementIds?: string[]
): Promise<EtatFormulaireContrat | never> {
  const analyse = schemaContrat.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("contrats").update(normaliser(analyse.data)).eq("id", id);

  if (error) {
    return { erreur: "Impossible de modifier le contrat : " + error.message };
  }

  if (equipementIds !== undefined) {
    const resultatAssociation = await associerEquipements(id, equipementIds);
    if (resultatAssociation?.erreur) return resultatAssociation;
  }

  revalidatePath("/contrats");
  revalidatePath(`/contrats/${id}`);
  redirect(`/contrats/${id}`);
}

// Remplace l'ensemble des équipements couverts par un contrat (suppression puis
// réinsertion complète — plus simple et robuste qu'un diff ligne à ligne).
export async function associerEquipements(contratId: string, equipementIds: string[]) {
  const supabase = await createServerSupabaseClient();

  const { error: erreurSuppression } = await supabase
    .from("contrats_equipements")
    .delete()
    .eq("contrat_id", contratId);
  if (erreurSuppression) {
    return { erreur: "Impossible de mettre à jour les équipements couverts : " + erreurSuppression.message };
  }

  if (equipementIds.length > 0) {
    const lignes = equipementIds.map((equipement_id) => ({ contrat_id: contratId, equipement_id }));
    const { error: erreurInsertion } = await supabase.from("contrats_equipements").insert(lignes);
    if (erreurInsertion) {
      return { erreur: "Impossible de mettre à jour les équipements couverts : " + erreurInsertion.message };
    }
  }

  revalidatePath(`/contrats/${contratId}`);
  return { succes: true };
}

export async function dissocierEquipement(contratId: string, equipementId: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("contrats_equipements")
    .delete()
    .eq("contrat_id", contratId)
    .eq("equipement_id", equipementId);

  if (error) {
    return { erreur: "Impossible de retirer l'équipement : " + error.message };
  }

  revalidatePath(`/contrats/${contratId}`);
  return { succes: true };
}
