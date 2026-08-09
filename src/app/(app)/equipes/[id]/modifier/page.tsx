import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { EquipeForm } from "@/components/equipes/EquipeForm";
import { modifierEquipe } from "@/actions/equipes";
import { Carte } from "@/components/ui/Carte";
import type { Equipe } from "@/lib/types";

export const metadata = { title: "Modifier l'équipe" };

export default async function ModifierEquipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect(`/equipes/${id}`);

  const supabase = await createServerSupabaseClient();
  const [{ data: equipe }, { data: profiles }] = await Promise.all([
    supabase.from("equipes").select("*").eq("id", id).single(),
    supabase.from("profiles").select("id, nom_complet, email").order("nom_complet"),
  ]);

  if (!equipe) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/equipes/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la fiche
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Modifier l&apos;équipe</h1>
      </div>

      <Carte>
        <EquipeForm
          equipe={equipe as Equipe}
          profiles={profiles ?? []}
          onEnregistrer={(valeurs) => modifierEquipe(id, valeurs)}
        />
      </Carte>
    </div>
  );
}
