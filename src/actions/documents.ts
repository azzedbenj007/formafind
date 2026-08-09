"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { supprimerFichier } from "@/lib/storage";
import { TYPES_DOCUMENT } from "@/lib/constants";
import type { TypeDocument } from "@/lib/types";

function videVersNull(v: FormDataEntryValue | null): string | null {
  const s = v ? String(v).trim() : "";
  return s === "" ? null : s;
}

export type EtatFormulaireDocument = { erreur: string };

export async function uploaderDocument(formData: FormData): Promise<EtatFormulaireDocument | void> {
  const titre = String(formData.get("titre") ?? "").trim();
  const typeDocument = String(formData.get("type_document") ?? "") as TypeDocument;
  const description = videVersNull(formData.get("description"));
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const equipementId = videVersNull(formData.get("equipement_id"));
  const contratId = videVersNull(formData.get("contrat_id"));
  const interventionId = videVersNull(formData.get("intervention_id"));
  const fichier = formData.get("fichier") as File | null;

  if (!titre) return { erreur: "Le titre est requis." };
  if (!typeDocument || !TYPES_DOCUMENT.some((t) => t.valeur === typeDocument)) {
    return { erreur: "Le type de document est requis." };
  }
  if (!fichier || fichier.size === 0) return { erreur: "Veuillez sélectionner un fichier." };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let chemin: string;
  if (equipementId) chemin = `equipements/${equipementId}/${Date.now()}-${fichier.name}`;
  else if (contratId) chemin = `contrats/${contratId}/${Date.now()}-${fichier.name}`;
  else if (interventionId) chemin = `interventions/${interventionId}/${Date.now()}-${fichier.name}`;
  else chemin = `divers/${Date.now()}-${fichier.name}`;

  const { error: erreurUpload } = await supabase.storage.from("documents").upload(chemin, fichier, {
    contentType: fichier.type,
    upsert: false,
  });
  if (erreurUpload) return { erreur: "Échec de l'envoi du fichier : " + erreurUpload.message };

  const { error: erreurInsertion } = await supabase.from("documents").insert({
    titre,
    type_document: typeDocument,
    chemin_stockage: chemin,
    nom_fichier: fichier.name,
    mime_type: fichier.type || null,
    taille_octets: fichier.size,
    equipement_id: equipementId,
    contrat_id: contratId,
    intervention_id: interventionId,
    tags,
    description,
    uploaded_by: user?.id ?? null,
  });

  if (erreurInsertion) {
    // Le fichier est déjà envoyé sur le Storage : on le retire pour éviter un fichier orphelin sans ligne en base.
    await supprimerFichier(chemin);
    return { erreur: "Fichier envoyé mais échec de l'enregistrement : " + erreurInsertion.message };
  }

  revalidatePath("/documents");
  if (equipementId) revalidatePath(`/equipements/${equipementId}`);
  if (contratId) revalidatePath(`/contrats/${contratId}`);
  if (interventionId) revalidatePath(`/interventions/${interventionId}`);

  redirect("/documents");
}

export async function supprimerDocument(id: string): Promise<{ erreur?: string; succes?: boolean }> {
  const supabase = await createServerSupabaseClient();

  const { data: document, error: erreurLecture } = await supabase
    .from("documents")
    .select("chemin_stockage, equipement_id, contrat_id, intervention_id")
    .eq("id", id)
    .single();

  if (erreurLecture || !document) {
    return { erreur: "Document introuvable." };
  }

  await supprimerFichier(document.chemin_stockage);

  // RLS n'autorise la suppression qu'à l'auteur ou à un admin/responsable maintenance :
  // si la ligne n'a pas pu être retirée, on remonte l'erreur au lieu de supposer que ça a marché.
  const { error: erreurSuppression } = await supabase.from("documents").delete().eq("id", id);
  if (erreurSuppression) {
    return { erreur: "Suppression impossible : " + erreurSuppression.message };
  }

  revalidatePath("/documents");
  if (document.equipement_id) revalidatePath(`/equipements/${document.equipement_id}`);
  if (document.contrat_id) revalidatePath(`/contrats/${document.contrat_id}`);
  if (document.intervention_id) revalidatePath(`/interventions/${document.intervention_id}`);

  return { succes: true };
}
