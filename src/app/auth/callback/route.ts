import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// Échange le code (confirmation d'inscription, lien magique, réinitialisation
// de mot de passe) contre une session, puis redirige vers la page demandée.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const suivant = searchParams.get("suivant") ?? "/tableau-de-bord";

  if (code) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${suivant}`);
}
