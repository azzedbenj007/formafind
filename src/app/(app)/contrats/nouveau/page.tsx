import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { obtenirFournisseurs } from "@/lib/reference-data";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ContratForm } from "@/components/contrats/ContratForm";
import { creerContrat } from "@/actions/contrats";
import { Carte } from "@/components/ui/Carte";

export const metadata = { title: "Nouveau contrat" };

export default async function NouveauContratPage() {
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect("/contrats");

  const supabase = await createServerSupabaseClient();
  const [fournisseurs, { data: equipements }] = await Promise.all([
    obtenirFournisseurs(),
    supabase.from("equipements").select("id, nom, code_interne").eq("actif", true).order("nom"),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/contrats" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Nouveau contrat</h1>
      </div>

      <Carte>
        <ContratForm fournisseurs={fournisseurs} equipements={equipements ?? []} onEnregistrer={creerContrat} />
      </Carte>
    </div>
  );
}
