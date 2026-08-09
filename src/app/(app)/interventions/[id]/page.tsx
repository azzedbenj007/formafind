import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile, getMesEquipeIds } from "@/lib/auth";
import { peutGererReferentiels, peutModifierIntervention } from "@/lib/permissions";
import { obtenirEquipes } from "@/lib/reference-data";
import { Badge } from "@/components/ui/Badge";
import { Carte } from "@/components/ui/Carte";
import {
  libelleCriticite,
  libellePriorite,
  libelleStatutIntervention,
  libelleTypeIntervention,
} from "@/lib/constants";
import { ChangerStatut } from "@/components/interventions/ChangerStatut";
import { AffectationIntervention } from "@/components/interventions/AffectationIntervention";
import { FormulaireCommentaire } from "@/components/interventions/FormulaireCommentaire";
import type { InterventionDetail, InterventionHistoriqueEntry, Profile } from "@/lib/types";

function formaterDateHeure(date: string | null) {
  if (!date) return null;
  return new Date(date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

const LIBELLES_EVENEMENT: Record<string, string> = {
  creation: "a créé l'intervention",
  changement_statut: "a changé le statut",
  affectation: "a modifié l'affectation",
  commentaire: "a commenté",
  cloture: "a clôturé l'intervention",
};

export default async function InterventionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const [profile, mesEquipeIds] = await Promise.all([getCurrentProfile(), getMesEquipeIds()]);

  const { data: intervention } = await supabase.from("vue_interventions_detail").select("*").eq("id", id).single();
  if (!intervention) notFound();
  const it = intervention as InterventionDetail;

  const [{ data: historique }, equipes, { data: techniciens }] = await Promise.all([
    supabase
      .from("interventions_historique")
      .select("*, profiles:profile_id(nom_complet, email)")
      .eq("intervention_id", id)
      .order("created_at", { ascending: false }),
    obtenirEquipes(),
    supabase.from("profiles").select("*").order("nom_complet"),
  ]);

  const statut = libelleStatutIntervention(it.statut);
  const type = libelleTypeIntervention(it.type);
  const priorite = libellePriorite(it.priorite);
  const criticite = libelleCriticite(it.equipement_criticite);

  const peutModifier = peutModifierIntervention(
    profile?.role,
    profile?.id,
    { technicien_id: it.technicien_id, equipe_id: it.equipe_id },
    mesEquipeIds
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/interventions" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900">{it.titre}</h1>
          <Badge label={statut.label} classe={statut.classe} />
          <Badge label={type.label} classe={type.classe} />
          <Badge label={priorite.label} classe={priorite.classe} />
        </div>
        <p className="mt-1 text-sm text-gray-500">{it.numero}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Carte>
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Détails</h2>
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase text-gray-400">Équipement</dt>
                <dd>
                  <Link href={`/equipements/${it.equipement_id}`} className="text-primary-600 hover:underline">
                    {it.equipement_nom} ({it.equipement_code_interne})
                  </Link>
                  {it.equipement_criticite === "vitale" && <Badge label={criticite.label} classe={`${criticite.classe} ml-2`} />}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-400">Service</dt>
                <dd className="text-gray-800">{it.service_nom || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-400">Équipe</dt>
                <dd className="text-gray-800">{it.equipe_nom || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-400">Technicien</dt>
                <dd className="text-gray-800">{it.technicien_nom || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-400">Date planifiée</dt>
                <dd className="text-gray-800">{formaterDateHeure(it.date_planifiee) || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-400">Échéance</dt>
                <dd className={it.en_retard ? "font-medium text-danger-600" : "text-gray-800"}>
                  {formaterDateHeure(it.date_echeance) || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-400">Début</dt>
                <dd className="text-gray-800">{formaterDateHeure(it.date_debut) || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-400">Fin</dt>
                <dd className="text-gray-800">{formaterDateHeure(it.date_fin) || "—"}</dd>
              </div>
            </dl>
            {it.description && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-xs font-medium uppercase text-gray-400">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{it.description}</p>
              </div>
            )}
            {it.compte_rendu && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-xs font-medium uppercase text-gray-400">Compte-rendu</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{it.compte_rendu}</p>
              </div>
            )}
          </Carte>

          <Carte>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Clock className="h-4 w-4" /> Historique
            </h2>
            <ul className="space-y-3">
              {(historique as (InterventionHistoriqueEntry & { profiles: Profile | null })[] | null)?.map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="text-gray-700">
                    <span className="font-medium">{h.profiles?.nom_complet || h.profiles?.email || "Quelqu'un"}</span>{" "}
                    {LIBELLES_EVENEMENT[h.type_evenement] || h.type_evenement}
                    {h.nouveau_statut && h.type_evenement === "changement_statut" ? ` → ${libelleStatutIntervention(h.nouveau_statut as InterventionDetail["statut"]).label}` : ""}
                  </p>
                  {h.commentaire && <p className="mt-0.5 text-gray-600">{h.commentaire}</p>}
                  <p className="text-xs text-gray-400">{formaterDateHeure(h.created_at)}</p>
                </li>
              ))}
              {(!historique || historique.length === 0) && <p className="text-sm text-gray-500">Aucun historique.</p>}
            </ul>
            <div className="mt-4 border-t border-gray-100 pt-4">
              <FormulaireCommentaire interventionId={id} />
            </div>
          </Carte>
        </div>

        <div className="space-y-6">
          {peutModifier && (
            <Carte>
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Mettre à jour le statut</h2>
              <ChangerStatut
                interventionId={id}
                equipementId={it.equipement_id}
                statutActuel={it.statut}
                compteRenduActuel={it.compte_rendu}
              />
            </Carte>
          )}

          {peutGererReferentiels(profile?.role) && (
            <Carte>
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Affectation</h2>
              <AffectationIntervention
                interventionId={id}
                equipementId={it.equipement_id}
                equipes={equipes}
                techniciens={(techniciens as Profile[]) ?? []}
                equipeIdActuelle={it.equipe_id}
                technicienIdActuel={it.technicien_id}
              />
            </Carte>
          )}
        </div>
      </div>
    </div>
  );
}
