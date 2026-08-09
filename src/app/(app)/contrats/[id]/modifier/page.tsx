import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { obtenirFournisseurs } from "@/lib/reference-data";
import { ContratForm } from "@/components/contrats/ContratForm";
import { modifierContrat } from "@/actions/contrats";
import { Carte } from "@/components/ui/Carte";
import type { Contrat } from "@/lib/types";

export const metadata = { title: "Modifier le contrat" };

export default async function ModifierContratPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect(`/contrats/${id}`);

  const supabase = await createServerSupabaseClient();
  const [{ data: contrat }, fournisseurs, { data: equipements }, { data: equipementsCouverts }] = await Promise.all([
    supabase.from("contrats").select("*").eq("id", id).single(),
    obtenirFournisseurs(),
    supabase.from("equipements").select("id, nom, code_interne").eq("actif", true).order("nom"),
    supabase.from("contrats_equipements").select("equipement_id").eq("contrat_id", id),
  ]);

  if (!contrat) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/contrats/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la fiche
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Modifier le contrat</h1>
      </div>

      <Carte>
        <ContratForm
          contrat={contrat as Contrat}
          fournisseurs={fournisseurs}
          equipements={equipements ?? []}
          equipementsCouvertsIds={(equipementsCouverts ?? []).map((e) => e.equipement_id)}
          onEnregistrer={(valeurs, equipementIds) => modifierContrat(id, valeurs, equipementIds)}
        />
      </Carte>
    </div>
  );
}
