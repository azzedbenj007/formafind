"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Role } from "@/lib/types";

export async function modifierRoleUtilisateur(profileId: string, role: Role) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", profileId);
  if (error) return { erreur: "Impossible de modifier le rôle : " + error.message };

  revalidatePath("/parametres/utilisateurs");
  return { succes: true };
}

export async function basculerActifUtilisateur(profileId: string, actif: boolean) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ actif }).eq("id", profileId);
  if (error) return { erreur: "Impossible de mettre à jour le compte : " + error.message };

  revalidatePath("/parametres/utilisateurs");
  return { succes: true };
}
