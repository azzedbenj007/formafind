import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { Bouton } from "@/components/ui/Bouton";
import { Carte, EtatVide } from "@/components/ui/Carte";

export const metadata = { title: "Équipes" };

interface EquipeAvecCompte {
  id: string;
  nom: string;
  specialite: string | null;
  description: string | null;
  responsable: { nom_complet: string | null } | null;
  membres_equipe: { count: number }[];
}

export default async function EquipesPage() {
  const supabase = await createServerSupabaseClient();
  const [profile, { data: equipes, error }] = await Promise.all([
    getCurrentProfile(),
    supabase
      .from("equipes")
      .select("id, nom, specialite, description, responsable:responsable_id(nom_complet), membres_equipe(count)")
      .order("nom"),
  ]);

  const peutGerer = peutGererReferentiels(profile?.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Équipes</h1>
          <p className="text-sm text-gray-500">Équipes de maintenance et leurs membres.</p>
        </div>
        {peutGerer && (
          <Bouton href="/equipes/nouveau">
            <Plus className="h-4 w-4" />
            Nouvelle équipe
          </Bouton>
        )}
      </div>

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      {equipes && equipes.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(equipes as unknown as EquipeAvecCompte[]).map((e) => (
            <Link key={e.id} href={`/equipes/${e.id}`}>
              <Carte className="h-full transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-gray-900">{e.nom}</h2>
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                    <Users className="h-3.5 w-3.5" />
                    {e.membres_equipe?.[0]?.count ?? 0}
                  </span>
                </div>
                {e.specialite && <p className="mt-1 text-xs text-gray-500">{e.specialite}</p>}
                {e.responsable?.nom_complet && (
                  <p className="mt-2 text-xs text-gray-400">Responsable : {e.responsable.nom_complet}</p>
                )}
              </Carte>
            </Link>
          ))}
        </div>
      ) : (
        <EtatVide
          titre="Aucune équipe trouvée"
          description="Créez une équipe pour organiser vos techniciens et responsables de maintenance."
          action={
            peutGerer ? (
              <Bouton href="/equipes/nouveau" variante="secondaire">
                <Users className="h-4 w-4" />
                Créer une équipe
              </Bouton>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
