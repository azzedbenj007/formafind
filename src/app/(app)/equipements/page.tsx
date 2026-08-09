import { Plus, Wrench } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { obtenirCategories, obtenirServices } from "@/lib/reference-data";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { FiltresEquipements } from "@/components/equipements/FiltresEquipements";
import { CarteEquipement } from "@/components/equipements/CarteEquipement";
import { Bouton } from "@/components/ui/Bouton";
import { EtatVide } from "@/components/ui/Carte";
import type { EquipementDetail } from "@/lib/types";

export const metadata = { title: "Équipements" };

interface SearchParams {
  statut?: string;
  criticite?: string;
  service?: string;
  categorie?: string;
  recherche?: string;
}

export default async function EquipementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const [profile, services, categories] = await Promise.all([getCurrentProfile(), obtenirServices(), obtenirCategories()]);

  let requete = supabase.from("vue_equipements_detail").select("*").eq("actif", true).order("nom");

  if (params.statut) requete = requete.eq("statut", params.statut);
  if (params.criticite) requete = requete.eq("criticite", params.criticite);
  if (params.service) requete = requete.eq("service_id", params.service);
  if (params.categorie) requete = requete.eq("categorie_id", params.categorie);
  if (params.recherche) {
    const q = params.recherche.replace(/[%,]/g, "");
    requete = requete.or(`nom.ilike.%${q}%,code_interne.ilike.%${q}%,numero_serie.ilike.%${q}%`);
  }

  const { data: equipements, error } = await requete.limit(200);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Équipements</h1>
          <p className="text-sm text-gray-500">Parc biomédical et technique de l&apos;établissement.</p>
        </div>
        {peutGererReferentiels(profile?.role) && (
          <Bouton href="/equipements/nouveau">
            <Plus className="h-4 w-4" />
            Nouvel équipement
          </Bouton>
        )}
      </div>

      <FiltresEquipements services={services} categories={categories} />

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      {equipements && equipements.length > 0 ? (
        <div className="space-y-2">
          {(equipements as EquipementDetail[]).map((e) => (
            <CarteEquipement key={e.id} equipement={e} />
          ))}
        </div>
      ) : (
        <EtatVide
          titre="Aucun équipement trouvé"
          description="Ajustez vos filtres ou ajoutez un nouvel équipement au parc."
          action={
            peutGererReferentiels(profile?.role) ? (
              <Bouton href="/equipements/nouveau" variante="secondaire">
                <Wrench className="h-4 w-4" />
                Ajouter un équipement
              </Bouton>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
