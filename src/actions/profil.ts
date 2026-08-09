"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function modifierMonProfil(nomComplet: string, telephone: string) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erreur: "Non authentifié." };

  const { error } = await supabase
    .from("profiles")
    .update({ nom_complet: nomComplet.trim() || null, telephone: telephone.trim() || null })
    .eq("id", user.id);

  if (error) return { erreur: "Impossible de mettre à jour le profil : " + error.message };

  revalidatePath("/parametres");
  return { succes: true };
}
