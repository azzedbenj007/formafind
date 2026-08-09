import Link from "next/link";
import { subMonths, format } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, Clock, FileSignature, Gauge, ShieldAlert, Wrench } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { CarteKpi } from "@/components/dashboard/CarteKpi";
import { RepartitionEquipements } from "@/components/dashboard/RepartitionEquipements";
import { InterventionsParMois } from "@/components/dashboard/InterventionsParMois";
import { Carte, EtatVide } from "@/components/ui/Carte";
import { Badge } from "@/components/ui/Badge";
import { libelleStatutIntervention } from "@/lib/constants";
import type { KpiGlobal } from "@/lib/types";

export const metadata = { title: "Tableau de bord" };

export default async function TableauDeBordPage() {
  const supabase = await createServerSupabaseClient();
  const depuis6Mois = subMonths(new Date(), 5);
  depuis6Mois.setDate(1);

  const [
    { data: kpi },
    { data: equipementsStatuts },
    { data: interventionsRecentes },
    { data: equipementsVitauxEnPanne },
    { data: interventionsEnRetard },
    { data: contratsExpirants },
  ] = await Promise.all([
    supabase.from("vue_kpi_global").select("*").single(),
    supabase.from("equipements").select("statut").eq("actif", true),
    supabase.from("interventions").select("created_at").gte("created_at", depuis6Mois.toISOString()),
    supabase
      .from("vue_equipements_detail")
      .select("*")
      .eq("actif", true)
      .eq("statut", "en_panne")
      .eq("criticite", "vitale")
      .limit(5),
    supabase.from("vue_interventions_detail").select("*").eq("en_retard", true).order("date_echeance").limit(5),
    supabase
      .from("contrats")
      .select("id, intitule, date_fin")
      .eq("statut", "actif")
      .lte("date_fin", new Date(Date.now() + 90 * 86400000).toISOString())
      .order("date_fin")
      .limit(5),
  ]);

  const k = kpi as KpiGlobal | null;

  const repartitionStatuts = (equipementsStatuts ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.statut] = (acc[e.statut] ?? 0) + 1;
    return acc;
  }, {});

  const moisBuckets: { mois: string; total: number }[] = Array.from({ length: 6 }).map((_, i) => {
    const date = subMonths(new Date(), 5 - i);
    return { mois: format(date, "MMM", { locale: fr }), total: 0, cle: format(date, "yyyy-MM") } as never;
  });
  (interventionsRecentes ?? []).forEach((i) => {
    const cle = format(new Date(i.created_at), "yyyy-MM");
    const bucket = moisBuckets.find((b) => (b as unknown as { cle: string }).cle === cle);
    if (bucket) bucket.total += 1;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tableau de bord</h1>
        <p className="text-sm text-gray-500">Vue d&apos;ensemble du parc et de la maintenance.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CarteKpi
          titre="Taux de disponibilité"
          valeur={k ? `${k.taux_disponibilite}%` : "—"}
          icone={Gauge}
          tonalite={k && k.taux_disponibilite < 90 ? "warning" : "success"}
        />
        <CarteKpi
          titre="Équipements en panne"
          valeur={k?.equipements_en_panne ?? 0}
          sousTitre={k ? `dont ${k.equipements_vitaux_en_panne} vitaux` : undefined}
          icone={Wrench}
          tonalite={k && k.equipements_vitaux_en_panne > 0 ? "danger" : "neutre"}
        />
        <CarteKpi
          titre="Interventions en retard"
          valeur={k?.interventions_en_retard ?? 0}
          sousTitre={k ? `${k.interventions_ouvertes} ouvertes au total` : undefined}
          icone={Clock}
          tonalite={k && k.interventions_en_retard > 0 ? "danger" : "neutre"}
        />
        <CarteKpi
          titre="Contrats à renouveler"
          valeur={k?.contrats_expirant_90j ?? 0}
          sousTitre="Sous 90 jours"
          icone={FileSignature}
          tonalite={k && k.contrats_expirant_90j > 0 ? "warning" : "neutre"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Carte>
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Répartition des équipements par statut</h2>
          <RepartitionEquipements donnees={repartitionStatuts} />
        </Carte>
        <Carte>
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Interventions créées par mois</h2>
          <InterventionsParMois donnees={moisBuckets} />
        </Carte>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Carte>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <ShieldAlert className="h-4 w-4 text-danger-600" /> Équipements vitaux en panne
          </h2>
          {equipementsVitauxEnPanne && equipementsVitauxEnPanne.length > 0 ? (
            <ul className="space-y-2">
              {equipementsVitauxEnPanne.map((e) => (
                <li key={e.id} className="text-sm">
                  <Link href={`/equipements/${e.id}`} className="font-medium text-gray-800 hover:underline">
                    {e.nom}
                  </Link>
                  <span className="text-gray-400"> · {e.code_interne}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">Aucun équipement vital en panne.</p>
          )}
        </Carte>

        <Carte>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <AlertTriangle className="h-4 w-4 text-warning-600" /> Interventions en retard
          </h2>
          {interventionsEnRetard && interventionsEnRetard.length > 0 ? (
            <ul className="space-y-2">
              {interventionsEnRetard.map((i) => (
                <li key={i.id} className="flex items-center justify-between text-sm">
                  <Link href={`/interventions/${i.id}`} className="min-w-0 truncate font-medium text-gray-800 hover:underline">
                    {i.titre}
                  </Link>
                  <Badge label={libelleStatutIntervention(i.statut).label} classe={libelleStatutIntervention(i.statut).classe} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">Aucune intervention en retard.</p>
          )}
        </Carte>

        <Carte>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <FileSignature className="h-4 w-4 text-warning-600" /> Contrats bientôt expirés
          </h2>
          {contratsExpirants && contratsExpirants.length > 0 ? (
            <ul className="space-y-2">
              {contratsExpirants.map((c) => (
                <li key={c.id} className="text-sm">
                  <Link href={`/contrats/${c.id}`} className="font-medium text-gray-800 hover:underline">
                    {c.intitule}
                  </Link>
                  <span className="text-gray-400"> · {new Date(c.date_fin).toLocaleDateString("fr-FR")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">Aucun contrat proche de l&apos;expiration.</p>
          )}
        </Carte>
      </div>

      {!k && <EtatVide titre="Données indisponibles" description="Impossible de charger les indicateurs pour le moment." />}
    </div>
  );
}
