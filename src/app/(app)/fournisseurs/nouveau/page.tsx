import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { FournisseurForm } from "@/components/fournisseurs/FournisseurForm";
import { creerFournisseur } from "@/actions/fournisseurs";
import { Carte } from "@/components/ui/Carte";

export const metadata = { title: "Nouveau fournisseur" };

export default async function NouveauFournisseurPage() {
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect("/fournisseurs");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/fournisseurs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Nouveau fournisseur</h1>
      </div>

      <Carte>
        <FournisseurForm onEnregistrer={creerFournisseur} />
      </Carte>
    </div>
  );
}
