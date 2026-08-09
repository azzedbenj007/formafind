import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { obtenirCategories, obtenirFournisseurs, obtenirServices, obtenirSites } from "@/lib/reference-data";
import { EquipementForm } from "@/components/equipements/EquipementForm";
import { modifierEquipement } from "@/actions/equipements";
import { Carte } from "@/components/ui/Carte";
import type { Equipement } from "@/lib/types";

export const metadata = { title: "Modifier l'équipement" };

export default async function ModifierEquipementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect(`/equipements/${id}`);

  const supabase = await createServerSupabaseClient();
  const [{ data: equipement }, sites, services, categories, fournisseurs] = await Promise.all([
    supabase.from("equipements").select("*").eq("id", id).single(),
    obtenirSites(),
    obtenirServices(),
    obtenirCategories(),
    obtenirFournisseurs(),
  ]);

  if (!equipement) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/equipements/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la fiche
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Modifier l&apos;équipement</h1>
      </div>

      <Carte>
        <EquipementForm
          equipement={equipement as Equipement}
          sites={sites}
          services={services}
          categories={categories}
          fournisseurs={fournisseurs}
          onEnregistrer={(valeurs) => modifierEquipement(id, valeurs)}
        />
      </Carte>
    </div>
  );
}
