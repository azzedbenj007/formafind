import { Download, Plus } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutCreerIntervention } from "@/lib/permissions";
import { FiltresInterventions } from "@/components/interventions/FiltresInterventions";
import { CarteIntervention } from "@/components/interventions/CarteIntervention";
import { KanbanInterventions } from "@/components/interventions/KanbanInterventions";
import { Bouton } from "@/components/ui/Bouton";
import { EtatVide } from "@/components/ui/Carte";
import type { InterventionDetail } from "@/lib/types";

export const metadata = { title: "Interventions" };

interface SearchParams {
  statut?: string;
  type?: string;
  priorite?: string;
  equipement?: string;
  en_retard?: string;
  recherche?: string;
  vue?: string;
}

export default async function InterventionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const profile = await getCurrentProfile();

  let requete = supabase.from("vue_interventions_detail").select("*").order("date_echeance", { ascending: true, nullsFirst: false });

  if (params.statut) requete = requete.eq("statut", params.statut);
  if (params.type) requete = requete.eq("type", params.type);
  if (params.priorite) requete = requete.eq("priorite", params.priorite);
  if (params.equipement) requete = requete.eq("equipement_id", params.equipement);
  if (params.en_retard === "1") requete = requete.eq("en_retard", true);
  if (params.recherche) {
    const q = params.recherche.replace(/[%,]/g, "");
    requete = requete.or(`titre.ilike.%${q}%,numero.ilike.%${q}%`);
  }

  const { data: interventions, error } = await requete.limit(300);
  const vueKanban = params.vue === "kanban";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Interventions</h1>
          <p className="text-sm text-gray-500">Ordres de travail préventifs et correctifs.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={`/api/export/interventions?${new URLSearchParams(params as Record<string, string>).toString()}`}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Exporter
          </a>
          {peutCreerIntervention(profile?.role) && (
            <Bouton href="/interventions/nouvelle">
              <Plus className="h-4 w-4" />
              Nouvelle intervention
            </Bouton>
          )}
        </div>
      </div>

      <FiltresInterventions />

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      {interventions && interventions.length > 0 ? (
        vueKanban ? (
          <KanbanInterventions interventions={interventions as InterventionDetail[]} />
        ) : (
          <div className="space-y-2">
            {(interventions as InterventionDetail[]).map((i) => (
              <CarteIntervention key={i.id} intervention={i} />
            ))}
          </div>
        )
      ) : (
        <EtatVide
          titre="Aucune intervention trouvée"
          description="Ajustez vos filtres ou créez une nouvelle intervention."
        />
      )}
    </div>
  );
}
