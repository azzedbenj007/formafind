import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { obtenirUrlSignee } from "@/lib/storage";

// Génère une URL signée à la demande pour un chemin du bucket privé "documents".
// Prévu pour de futurs boutons de téléchargement côté client ailleurs dans l'app.
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ erreur: "Non authentifié." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { chemin?: string } | null;
  const chemin = body?.chemin;
  if (!chemin) {
    return NextResponse.json({ erreur: "Chemin manquant." }, { status: 400 });
  }

  const url = await obtenirUrlSignee(chemin);
  if (!url) {
    return NextResponse.json({ erreur: "Fichier introuvable." }, { status: 404 });
  }

  return NextResponse.json({ url });
}
