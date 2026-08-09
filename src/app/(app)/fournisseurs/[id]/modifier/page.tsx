import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { FournisseurForm } from "@/components/fournisseurs/FournisseurForm";
import { modifierFournisseur } from "@/actions/fournisseurs";
import { Carte } from "@/components/ui/Carte";
import type { Fournisseur } from "@/lib/types";

export const metadata = { title: "Modifier le fournisseur" };

export default async function ModifierFournisseurPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect("/fournisseurs");

  const supabase = await createServerSupabaseClient();
  const { data: fournisseur } = await supabase.from("fournisseurs").select("*").eq("id", id).single();
  if (!fournisseur) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/fournisseurs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Modifier le fournisseur</h1>
      </div>

      <Carte>
        <FournisseurForm
          fournisseur={fournisseur as Fournisseur}
          onEnregistrer={(valeurs) => modifierFournisseur(id, valeurs)}
        />
      </Carte>
    </div>
  );
}
