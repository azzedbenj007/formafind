import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

// Génère les interventions préventives dues (fn_generer_interventions_preventives,
// idempotente). Destinée à être appelée quotidiennement par pg_cron (voir
// supabase/schema.sql §10) ou, à défaut, par un ordonnanceur externe.
export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ erreur: "Non autorisé" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("fn_generer_interventions_preventives");

  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ interventions_generees: data });
}
