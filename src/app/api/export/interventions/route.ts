import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { versCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  let requete = supabase.from("vue_interventions_detail").select("*").order("date_echeance", { ascending: false });

  const statut = searchParams.get("statut");
  const type = searchParams.get("type");
  const priorite = searchParams.get("priorite");
  const equipement = searchParams.get("equipement");
  const enRetard = searchParams.get("en_retard");
  const recherche = searchParams.get("recherche");

  if (statut) requete = requete.eq("statut", statut);
  if (type) requete = requete.eq("type", type);
  if (priorite) requete = requete.eq("priorite", priorite);
  if (equipement) requete = requete.eq("equipement_id", equipement);
  if (enRetard === "1") requete = requete.eq("en_retard", true);
  if (recherche) {
    const q = recherche.replace(/[%,]/g, "");
    requete = requete.or(`titre.ilike.%${q}%,numero.ilike.%${q}%`);
  }

  const { data, error } = await requete.limit(2000);
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });

  const csv = versCsv(data ?? [], [
    { cle: "numero", titre: "Numéro" },
    { cle: "titre", titre: "Titre" },
    { cle: "type", titre: "Type" },
    { cle: "statut", titre: "Statut" },
    { cle: "priorite", titre: "Priorité" },
    { cle: "equipement_nom", titre: "Équipement" },
    { cle: "equipement_code_interne", titre: "Code interne" },
    { cle: "service_nom", titre: "Service" },
    { cle: "equipe_nom", titre: "Équipe" },
    { cle: "technicien_nom", titre: "Technicien" },
    { cle: "date_planifiee", titre: "Date planifiée" },
    { cle: "date_echeance", titre: "Échéance" },
    { cle: "date_fin", titre: "Date de fin" },
    { cle: "cout_pieces", titre: "Coût pièces" },
    { cle: "cout_main_oeuvre", titre: "Coût main d'œuvre" },
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="interventions.csv"`,
    },
  });
}
