import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { obtenirEquipes } from "@/lib/reference-data";
import { PlanForm } from "@/components/plans-maintenance/PlanForm";
import { basculerActifPlanMaintenance, modifierPlanMaintenance } from "@/actions/plans-maintenance";
import { Carte } from "@/components/ui/Carte";
import { Bouton } from "@/components/ui/Bouton";
import type { PlanMaintenance } from "@/lib/types";

export const metadata = { title: "Modifier le plan de maintenance" };

export default async function ModifierPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect("/plans-maintenance");

  const supabase = await createServerSupabaseClient();
  const [{ data: plan }, { data: equipements }, equipes] = await Promise.all([
    supabase.from("plans_maintenance").select("*").eq("id", id).single(),
    supabase.from("equipements").select("id, nom, code_interne").eq("actif", true).order("nom"),
    obtenirEquipes(),
  ]);

  if (!plan) notFound();
  const p = plan as PlanMaintenance;

  async function desactiver() {
    "use server";
    await basculerActifPlanMaintenance(id, false, p.equipement_id);
    redirect("/plans-maintenance");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/plans-maintenance" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4" />
            Retour à la liste
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">Modifier le plan de maintenance</h1>
        </div>
        <form action={desactiver}>
          <Bouton type="submit" variante="danger">
            Désactiver le plan
          </Bouton>
        </form>
      </div>

      <Carte>
        <PlanForm
          plan={p}
          equipements={equipements ?? []}
          equipes={equipes}
          onEnregistrer={(valeurs) => modifierPlanMaintenance(id, valeurs)}
        />
      </Carte>
    </div>
  );
}
