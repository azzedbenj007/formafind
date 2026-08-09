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
  let requete = supabase.from("vue_equipements_detail").select("*").eq("actif", true).order("nom");

  const statut = searchParams.get("statut");
  const criticite = searchParams.get("criticite");
  const service = searchParams.get("service");
  const categorie = searchParams.get("categorie");
  const recherche = searchParams.get("recherche");

  if (statut) requete = requete.eq("statut", statut);
  if (criticite) requete = requete.eq("criticite", criticite);
  if (service) requete = requete.eq("service_id", service);
  if (categorie) requete = requete.eq("categorie_id", categorie);
  if (recherche) {
    const q = recherche.replace(/[%,]/g, "");
    requete = requete.or(`nom.ilike.%${q}%,code_interne.ilike.%${q}%,numero_serie.ilike.%${q}%`);
  }

  const { data, error } = await requete.limit(2000);
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });

  const csv = versCsv(data ?? [], [
    { cle: "code_interne", titre: "Code interne" },
    { cle: "nom", titre: "Nom" },
    { cle: "categorie_nom", titre: "Catégorie" },
    { cle: "modele", titre: "Modèle" },
    { cle: "fabricant", titre: "Fabricant" },
    { cle: "numero_serie", titre: "N° de série" },
    { cle: "site_nom", titre: "Site" },
    { cle: "service_nom", titre: "Service" },
    { cle: "localisation_precise", titre: "Localisation" },
    { cle: "statut", titre: "Statut" },
    { cle: "criticite", titre: "Criticité" },
    { cle: "fin_garantie", titre: "Fin de garantie" },
    { cle: "cout_acquisition", titre: "Coût d'acquisition" },
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="equipements.csv"`,
    },
  });
}
