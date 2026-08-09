import { createServerSupabaseClient } from "./supabase-server";

const BUCKET = "documents";

// Génère une URL signée temporaire pour un fichier du bucket privé
// "documents". Le bucket n'expose jamais d'URL publique — tout accès en
// lecture passe par ici, côté serveur.
export async function obtenirUrlSignee(chemin: string, expirationSecondes = 3600): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(chemin, expirationSecondes);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function obtenirUrlsSignees(
  chemins: string[],
  expirationSecondes = 3600
): Promise<Record<string, string>> {
  if (chemins.length === 0) return {};
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chemins, expirationSecondes);
  if (error || !data) return {};
  const resultat: Record<string, string> = {};
  data.forEach((d) => {
    if (d.signedUrl && d.path) resultat[d.path] = d.signedUrl;
  });
  return resultat;
}

export async function supprimerFichier(chemin: string) {
  const supabase = await createServerSupabaseClient();
  return supabase.storage.from(BUCKET).remove([chemin]);
}
