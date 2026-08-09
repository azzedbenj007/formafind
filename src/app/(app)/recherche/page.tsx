import { createServerSupabaseClient } from "@/lib/supabase-server";
import { CarteEquipement } from "@/components/equipements/CarteEquipement";
import { CarteIntervention } from "@/components/interventions/CarteIntervention";
import { EtatVide } from "@/components/ui/Carte";
import type { EquipementDetail, InterventionDetail } from "@/lib/types";

export const metadata = { title: "Recherche" };

export default async function RecherchePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const requete = (q ?? "").trim();

  if (!requete) {
    return <EtatVide titre="Recherche" description="Saisissez un terme dans la barre de recherche en haut de page." />;
  }

  const supabase = await createServerSupabaseClient();
  const motNettoye = requete.replace(/[%,]/g, "");

  const [{ data: equipements }, { data: interventions }] = await Promise.all([
    supabase
      .from("vue_equipements_detail")
      .select("*")
      .eq("actif", true)
      .or(`nom.ilike.%${motNettoye}%,code_interne.ilike.%${motNettoye}%,numero_serie.ilike.%${motNettoye}%`)
      .limit(20),
    supabase
      .from("vue_interventions_detail")
      .select("*")
      .or(`titre.ilike.%${motNettoye}%,numero.ilike.%${motNettoye}%`)
      .limit(20),
  ]);

  const aucunResultat = (equipements?.length ?? 0) === 0 && (interventions?.length ?? 0) === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Résultats pour « {requete} »</h1>
      </div>

      {aucunResultat && <EtatVide titre="Aucun résultat" description="Essayez un autre terme de recherche." />}

      {equipements && equipements.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Équipements ({equipements.length})</h2>
          <div className="space-y-2">
            {(equipements as EquipementDetail[]).map((e) => (
              <CarteEquipement key={e.id} equipement={e} />
            ))}
          </div>
        </section>
      )}

      {interventions && interventions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Interventions ({interventions.length})</h2>
          <div className="space-y-2">
            {(interventions as InterventionDetail[]).map((i) => (
              <CarteIntervention key={i.id} intervention={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
