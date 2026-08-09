import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

// Rafraîchit les statuts des contrats expirés et génère les alertes
// d'expiration à venir (fn_generer_alertes_contrats, idempotente sur 7 jours).
export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ erreur: "Non autorisé" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("fn_generer_alertes_contrats", { p_jours: 90 });

  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ alertes_generees: data });
}
