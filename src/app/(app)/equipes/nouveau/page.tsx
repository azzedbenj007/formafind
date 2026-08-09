import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { EquipeForm } from "@/components/equipes/EquipeForm";
import { creerEquipe } from "@/actions/equipes";
import { Carte } from "@/components/ui/Carte";

export const metadata = { title: "Nouvelle équipe" };

export default async function NouvelleEquipePage() {
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect("/equipes");

  const supabase = await createServerSupabaseClient();
  const { data: profiles } = await supabase.from("profiles").select("id, nom_complet, email").order("nom_complet");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/equipes" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Nouvelle équipe</h1>
      </div>

      <Carte>
        <EquipeForm profiles={profiles ?? []} onEnregistrer={creerEquipe} />
      </Carte>
    </div>
  );
}
