"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function creerSite(nom: string, ville: string) {
  if (!nom.trim()) return { erreur: "Le nom est requis." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("sites").insert({ nom: nom.trim(), ville: ville.trim() || null });
  if (error) return { erreur: error.message };
  revalidatePath("/parametres/referentiels");
  return { succes: true };
}

export async function creerService(siteId: string, nom: string, code: string) {
  if (!siteId || !nom.trim()) return { erreur: "Le site et le nom sont requis." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("services").insert({ site_id: siteId, nom: nom.trim(), code: code.trim() || null });
  if (error) return { erreur: error.message };
  revalidatePath("/parametres/referentiels");
  return { succes: true };
}

export async function creerCategorie(nom: string, famille: string) {
  if (!nom.trim()) return { erreur: "Le nom est requis." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("categories_equipement").insert({ nom: nom.trim(), famille });
  if (error) return { erreur: error.message };
  revalidatePath("/parametres/referentiels");
  return { succes: true };
}
