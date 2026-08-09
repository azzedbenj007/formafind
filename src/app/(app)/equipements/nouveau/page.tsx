import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { obtenirCategories, obtenirFournisseurs, obtenirServices, obtenirSites } from "@/lib/reference-data";
import { EquipementForm } from "@/components/equipements/EquipementForm";
import { creerEquipement } from "@/actions/equipements";
import { Carte } from "@/components/ui/Carte";

export const metadata = { title: "Nouvel équipement" };

export default async function NouvelEquipementPage() {
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect("/equipements");

  const [sites, services, categories, fournisseurs] = await Promise.all([
    obtenirSites(),
    obtenirServices(),
    obtenirCategories(),
    obtenirFournisseurs(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/equipements" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Nouvel équipement</h1>
      </div>

      <Carte>
        <EquipementForm
          sites={sites}
          services={services}
          categories={categories}
          fournisseurs={fournisseurs}
          onEnregistrer={creerEquipement}
        />
      </Carte>
    </div>
  );
}
