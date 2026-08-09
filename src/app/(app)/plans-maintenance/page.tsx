import Link from "next/link";
import { Plus } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { libellePriorite } from "@/lib/constants";
import { Bouton } from "@/components/ui/Bouton";
import { Carte, EtatVide } from "@/components/ui/Carte";
import { Badge } from "@/components/ui/Badge";
import type { PlanMaintenance } from "@/lib/types";

export const metadata = { title: "Plans de maintenance" };

interface PlanAvecEquipement extends PlanMaintenance {
  equipements: { id: string; nom: string; code_interne: string } | null;
  equipes: { nom: string } | null;
}

export default async function PlansMaintenancePage() {
  const supabase = await createServerSupabaseClient();
  const profile = await getCurrentProfile();

  const { data: plans, error } = await supabase
    .from("plans_maintenance")
    .select("*, equipements:equipement_id(id, nom, code_interne), equipes:equipe_id(nom)")
    .eq("actif", true)
    .order("prochaine_echeance");

  const aujourdHui = new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Plans de maintenance</h1>
          <p className="text-sm text-gray-500">Maintenance préventive récurrente et contrôles réglementaires.</p>
        </div>
        {peutGererReferentiels(profile?.role) && (
          <Bouton href="/plans-maintenance/nouveau">
            <Plus className="h-4 w-4" />
            Nouveau plan
          </Bouton>
        )}
      </div>

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      {plans && plans.length > 0 ? (
        <div className="space-y-2">
          {(plans as unknown as PlanAvecEquipement[]).map((p) => {
            const priorite = libellePriorite(p.priorite);
            const echeance = new Date(p.prochaine_echeance);
            const proche = echeance.getTime() - aujourdHui.getTime() < p.jours_anticipation * 86400000;
            return (
              <Carte key={p.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/plans-maintenance/${p.id}/modifier`} className="font-medium text-gray-900 hover:underline">
                    {p.nom}
                  </Link>
                  <p className="text-sm text-gray-500">
                    {p.equipements?.nom} ({p.equipements?.code_interne}) · tous les {p.frequence_valeur} {p.frequence_unite}
                    {p.equipes ? ` · ${p.equipes.nom}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={proche ? "text-sm font-medium text-warning-700" : "text-sm text-gray-500"}>
                    Échéance : {echeance.toLocaleDateString("fr-FR")}
                  </span>
                  <Badge label={priorite.label} classe={priorite.classe} />
                </div>
              </Carte>
            );
          })}
        </div>
      ) : (
        <EtatVide
          titre="Aucun plan de maintenance actif"
          description="Créez un plan pour automatiser la génération des interventions préventives."
        />
      )}
    </div>
  );
}
