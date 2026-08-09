import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutCreerIntervention } from "@/lib/permissions";
import { obtenirEquipes } from "@/lib/reference-data";
import { InterventionForm } from "@/components/interventions/InterventionForm";
import { creerIntervention } from "@/actions/interventions";
import { Carte } from "@/components/ui/Carte";
import type { Profile } from "@/lib/types";

export const metadata = { title: "Nouvelle intervention" };

export default async function NouvelleInterventionPage({
  searchParams,
}: {
  searchParams: Promise<{ equipement?: string }>;
}) {
  const { equipement } = await searchParams;
  const profile = await getCurrentProfile();
  if (!peutCreerIntervention(profile?.role)) redirect("/interventions");

  const supabase = await createServerSupabaseClient();
  const [{ data: equipements }, equipes, { data: techniciens }] = await Promise.all([
    supabase.from("equipements").select("id, nom, code_interne").eq("actif", true).order("nom"),
    obtenirEquipes(),
    supabase.from("profiles").select("*").order("nom_complet"),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/interventions" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Nouvelle intervention</h1>
      </div>

      <Carte>
        <InterventionForm
          equipements={equipements ?? []}
          equipes={equipes}
          techniciens={(techniciens as Profile[]) ?? []}
          equipementPreselectionne={equipement}
          onEnregistrer={creerIntervention}
        />
      </Carte>
    </div>
  );
}
