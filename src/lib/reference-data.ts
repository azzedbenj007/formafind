// Requêtes de référentiels partagées entre les formulaires (équipements,
// interventions, contrats...). Toujours appelées côté serveur.
import { createServerSupabaseClient } from "./supabase-server";
import type { CategorieEquipement, Competence, Equipe, Fournisseur, ServiceHospitalier, Site } from "./types";

export async function obtenirSites(): Promise<Site[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("sites").select("*").order("nom");
  return (data as Site[]) ?? [];
}

export async function obtenirServices(): Promise<ServiceHospitalier[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("services").select("*").order("nom");
  return (data as ServiceHospitalier[]) ?? [];
}

export async function obtenirCategories(): Promise<CategorieEquipement[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("categories_equipement").select("*").order("nom");
  return (data as CategorieEquipement[]) ?? [];
}

export async function obtenirFournisseurs(): Promise<Fournisseur[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("fournisseurs").select("*").order("nom");
  return (data as Fournisseur[]) ?? [];
}

export async function obtenirEquipes(): Promise<Equipe[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("equipes").select("*").order("nom");
  return (data as Equipe[]) ?? [];
}

export async function obtenirCompetences(): Promise<Competence[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("competences").select("*").order("nom");
  return (data as Competence[]) ?? [];
}
