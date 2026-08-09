import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Users } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { libelleRole } from "@/lib/constants";
import { Badge } from "@/components/ui/Badge";
import { Bouton } from "@/components/ui/Bouton";
import { Carte } from "@/components/ui/Carte";
import { BoutonRetirerMembre } from "@/components/equipes/BoutonRetirerMembre";
import { GestionMembres } from "@/components/equipes/GestionMembres";
import type { Role } from "@/lib/types";

interface EquipeDetail {
  id: string;
  nom: string;
  specialite: string | null;
  description: string | null;
  responsable: { nom_complet: string | null; email: string } | null;
}

interface MembreLigne {
  profile_id: string;
  role_dans_equipe: string | null;
  date_affectation: string | null;
  profiles: { id: string; nom_complet: string | null; email: string; role: Role } | null;
}

interface CompetenceLigne {
  profile_id: string;
  niveau: number;
  competences: { nom: string } | null;
}

export default async function EquipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const profile = await getCurrentProfile();

  const { data: equipe } = await supabase
    .from("equipes")
    .select("id, nom, specialite, description, responsable:responsable_id(nom_complet, email)")
    .eq("id", id)
    .single();
  if (!equipe) notFound();
  const eq = equipe as unknown as EquipeDetail;

  const { data: membres } = await supabase
    .from("membres_equipe")
    .select("profile_id, role_dans_equipe, date_affectation, profiles:profile_id(id, nom_complet, email, role)")
    .eq("equipe_id", id)
    .order("date_affectation");

  const membresListe = (membres as unknown as MembreLigne[]) ?? [];
  const membreIds = membresListe.map((m) => m.profile_id);

  const [{ data: tousProfiles }, { data: competences }] = await Promise.all([
    supabase.from("profiles").select("id, nom_complet, email").order("nom_complet"),
    membreIds.length > 0
      ? supabase
          .from("profil_competences")
          .select("profile_id, niveau, competences:competence_id(nom)")
          .in("profile_id", membreIds)
      : Promise.resolve({ data: [] }),
  ]);

  const competencesParMembre = new Map<string, CompetenceLigne[]>();
  for (const c of (competences as unknown as CompetenceLigne[]) ?? []) {
    const liste = competencesParMembre.get(c.profile_id) ?? [];
    liste.push(c);
    competencesParMembre.set(c.profile_id, liste);
  }

  const profilesDisponibles = (tousProfiles ?? []).filter((p) => !membreIds.includes(p.id));
  const peutModifier = peutGererReferentiels(profile?.role);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/equipes" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4" />
            Retour à la liste
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">{eq.nom}</h1>
          {eq.specialite && <p className="mt-1 text-sm text-gray-500">{eq.specialite}</p>}
        </div>
        {peutModifier && (
          <Bouton href={`/equipes/${id}/modifier`}>
            <Pencil className="h-4 w-4" />
            Modifier
          </Bouton>
        )}
      </div>

      <Carte>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Informations générales</h2>
        <dl className="grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase text-gray-400">Responsable</dt>
            <dd className="text-gray-800">{eq.responsable?.nom_complet || eq.responsable?.email || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-gray-400">Nombre de membres</dt>
            <dd className="text-gray-800">{membresListe.length}</dd>
          </div>
        </dl>
        {eq.description && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-xs font-medium uppercase text-gray-400">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{eq.description}</p>
          </div>
        )}
      </Carte>

      <Carte>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Users className="h-4 w-4" /> Membres
        </h2>
        {membresListe.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {membresListe.map((m) => {
              const p = m.profiles;
              const competencesMembre = competencesParMembre.get(m.profile_id) ?? [];
              return (
                <li key={m.profile_id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{p?.nom_complet || p?.email}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {m.role_dans_equipe || "technicien"}
                      {p?.role && <> · {libelleRole(p.role).label}</>}
                      {m.date_affectation ? ` · depuis le ${new Date(m.date_affectation).toLocaleDateString("fr-FR")}` : ""}
                    </p>
                    {competencesMembre.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {competencesMembre.map((c, idx) => (
                          <Badge
                            key={idx}
                            label={`${c.competences?.nom ?? "?"} (niv. ${c.niveau})`}
                            classe="bg-gray-100 text-gray-600"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {peutModifier && <BoutonRetirerMembre equipeId={id} profileId={m.profile_id} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Aucun membre affecté à cette équipe.</p>
        )}

        {peutModifier && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Ajouter un membre</h3>
            <GestionMembres equipeId={id} profilesDisponibles={profilesDisponibles} />
          </div>
        )}
      </Carte>
    </div>
  );
}
