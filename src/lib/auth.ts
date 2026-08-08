import { createServerSupabaseClient } from "./supabase-server";
import type { Profile } from "./types";

// Récupère l'utilisateur connecté + son profil (rôle inclus) côté serveur.
// Retourne null si non authentifié — le middleware garantit déjà la
// redirection vers /connexion pour les routes protégées, cet appel sert
// surtout à obtenir le rôle pour l'affichage conditionnel de l'UI.
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (profile as Profile) ?? null;
}
