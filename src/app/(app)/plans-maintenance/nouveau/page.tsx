import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { obtenirEquipes } from "@/lib/reference-data";
import { PlanForm } from "@/components/plans-maintenance/PlanForm";
import { creerPlanMaintenance } from "@/actions/plans-maintenance";
import { Carte } from "@/components/ui/Carte";

export const metadata = { title: "Nouveau plan de maintenance" };

export default async function NouveauPlanPage() {
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect("/plans-maintenance");

  const supabase = await createServerSupabaseClient();
  const [{ data: equipements }, equipes] = await Promise.all([
    supabase.from("equipements").select("id, nom, code_interne").eq("actif", true).order("nom"),
    obtenirEquipes(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/plans-maintenance" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Nouveau plan de maintenance</h1>
      </div>

      <Carte>
        <PlanForm equipements={equipements ?? []} equipes={equipes} onEnregistrer={creerPlanMaintenance} />
      </Carte>
    </div>
  );
}
