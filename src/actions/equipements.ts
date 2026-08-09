"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { schemaEquipement, type ValeursEquipement } from "@/lib/validation/equipement";

function videVersNull<T>(v: T | "" | null | undefined): T | null {
  return v === "" || v === undefined ? null : v;
}

function normaliser(valeurs: ValeursEquipement) {
  return {
    code_interne: valeurs.code_interne.trim(),
    nom: valeurs.nom.trim(),
    categorie_id: videVersNull(valeurs.categorie_id),
    numero_serie: videVersNull(valeurs.numero_serie),
    modele: videVersNull(valeurs.modele),
    fabricant: videVersNull(valeurs.fabricant),
    fournisseur_id: videVersNull(valeurs.fournisseur_id),
    site_id: valeurs.site_id,
    service_id: videVersNull(valeurs.service_id),
    localisation_precise: videVersNull(valeurs.localisation_precise),
    statut: valeurs.statut,
    criticite: valeurs.criticite,
    date_achat: videVersNull(valeurs.date_achat),
    date_mise_service: videVersNull(valeurs.date_mise_service),
    fin_garantie: videVersNull(valeurs.fin_garantie),
    cout_acquisition: valeurs.cout_acquisition ?? null,
    notes: videVersNull(valeurs.notes),
  };
}

export type EtatFormulaireEquipement = { erreur?: string; erreurs_champs?: Record<string, string> };

export async function creerEquipement(
  valeursBrutes: ValeursEquipement
): Promise<EtatFormulaireEquipement | never> {
  const analyse = schemaEquipement.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("equipements")
    .insert({ ...normaliser(analyse.data), created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { erreur: "Ce code interne est déjà utilisé par un autre équipement." };
    }
    return { erreur: "Impossible de créer l'équipement : " + error.message };
  }

  revalidatePath("/equipements");
  redirect(`/equipements/${data.id}`);
}

export async function modifierEquipement(
  id: string,
  valeursBrutes: ValeursEquipement
): Promise<EtatFormulaireEquipement | never> {
  const analyse = schemaEquipement.safeParse(valeursBrutes);
  if (!analyse.success) {
    return { erreur: "Formulaire invalide.", erreurs_champs: analyse.error.flatten().fieldErrors as Record<string, string> };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("equipements").update(normaliser(analyse.data)).eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { erreur: "Ce code interne est déjà utilisé par un autre équipement." };
    }
    return { erreur: "Impossible de modifier l'équipement : " + error.message };
  }

  revalidatePath("/equipements");
  revalidatePath(`/equipements/${id}`);
  redirect(`/equipements/${id}`);
}

export async function mettreAJourPhotoEquipement(equipementId: string, formData: FormData) {
  const fichier = formData.get("photo") as File | null;
  if (!fichier || fichier.size === 0) return { erreur: "Aucun fichier sélectionné." };

  const supabase = await createServerSupabaseClient();
  const chemin = `equipements/${equipementId}/${Date.now()}-${fichier.name}`;

  const { error: erreurUpload } = await supabase.storage.from("documents").upload(chemin, fichier, {
    contentType: fichier.type,
    upsert: false,
  });
  if (erreurUpload) return { erreur: "Échec de l'envoi du fichier : " + erreurUpload.message };

  const { error: erreurMaj } = await supabase.from("equipements").update({ photo_url: chemin }).eq("id", equipementId);
  if (erreurMaj) return { erreur: "Fichier envoyé mais échec de la mise à jour : " + erreurMaj.message };

  revalidatePath(`/equipements/${equipementId}`);
  return { succes: true };
}

export async function supprimerEquipement(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("equipements").delete().eq("id", id);
  if (error) {
    return { erreur: "Suppression impossible (l'équipement a probablement un historique d'interventions) : " + error.message };
  }
  revalidatePath("/equipements");
  redirect("/equipements");
}
