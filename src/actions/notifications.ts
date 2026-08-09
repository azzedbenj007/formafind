"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function marquerNotificationLue(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("notifications").update({ lu: true }).eq("id", id);
  if (error) return { erreur: error.message };
  revalidatePath("/notifications");
  return { succes: true };
}

export async function marquerToutesLues() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erreur: "Non authentifié." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  const { error } = await supabase
    .from("notifications")
    .update({ lu: true })
    .or(`profile_id.eq.${user.id},role_cible.eq.${profile?.role}`)
    .eq("lu", false);

  if (error) return { erreur: error.message };
  revalidatePath("/notifications");
  return { succes: true };
}
