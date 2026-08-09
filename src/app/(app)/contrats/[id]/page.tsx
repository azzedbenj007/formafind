import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Pencil, Wrench } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { libelleStatutContrat, libelleStatutEquipement, libelleTypeContrat, libelleTypeDocument } from "@/lib/constants";
import { Badge } from "@/components/ui/Badge";
import { Bouton } from "@/components/ui/Bouton";
import { Carte } from "@/components/ui/Carte";
import { RetirerEquipementBouton } from "@/components/contrats/RetirerEquipementBouton";
import type { ContratDetail, DocumentGmao, Equipement, StatutEquipement } from "@/lib/types";

export default async function ContratDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const profile = await getCurrentProfile();

  const { data: contrat } = await supabase.from("vue_contrats_detail").select("*").eq("id", id).single();
  if (!contrat) notFound();
  const c = contrat as ContratDetail;

  const [{ data: equipementsLies }, { data: documents }] = await Promise.all([
    supabase.from("contrats_equipements").select("equipements:equipement_id(id, nom, code_interne, statut)").eq("contrat_id", id),
    supabase.from("documents").select("*").eq("contrat_id", id).order("created_at", { ascending: false }),
  ]);

  const type = libelleTypeContrat(c.type_contrat);
  const statut = libelleStatutContrat(c.statut);
  const peutModifier = peutGererReferentiels(profile?.role);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/contrats" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4" />
            Retour à la liste
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{c.intitule}</h1>
            <Badge label={type.label} classe={type.classe} />
            <Badge label={statut.label} classe={statut.classe} />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {c.reference} · {c.fournisseur_nom}
          </p>
        </div>
        {peutModifier && (
          <Bouton href={`/contrats/${id}/modifier`}>
            <Pencil className="h-4 w-4" />
            Modifier
          </Bouton>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Carte>
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Informations générales</h2>
            <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-3">
              <InfoItem label="Fournisseur" valeur={c.fournisseur_nom} />
              <InfoItem label="Date de début" valeur={formaterDate(c.date_debut)} />
              <InfoItem label="Date de fin" valeur={formaterDate(c.date_fin)} />
              <InfoItem
                label="Coût annuel"
                valeur={c.cout_annuel ? `${c.cout_annuel.toLocaleString("fr-FR")} MAD` : null}
              />
              <InfoItem
                label="Délai d'intervention"
                valeur={c.delai_intervention_heures ? `${c.delai_intervention_heures} h` : null}
              />
              <InfoItem label="Couverture horaire" valeur={c.couverture_horaire} />
              <InfoItem label="Tacite reconduction" valeur={c.tacite_reconduction ? "Oui" : "Non"} />
              <InfoItem label="Préavis" valeur={c.preavis_jours ? `${c.preavis_jours} jours` : null} />
              <InfoItem label="Équipements couverts" valeur={String(c.nb_equipements_couverts)} />
            </dl>
            {c.conditions && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-xs font-medium uppercase text-gray-400">Conditions particulières</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{c.conditions}</p>
              </div>
            )}
          </Carte>

          <Carte>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Wrench className="h-4 w-4" /> Équipements couverts
            </h2>
            {equipementsLies && equipementsLies.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {equipementsLies.map((ligne, idx) => {
                  const eq = (ligne as unknown as { equipements: Pick<Equipement, "id" | "nom" | "code_interne" | "statut"> })
                    .equipements;
                  if (!eq) return null;
                  const s = libelleStatutEquipement(eq.statut as StatutEquipement);
                  return (
                    <li key={idx} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <Link href={`/equipements/${eq.id}`} className="truncate text-sm font-medium text-gray-900 hover:underline">
                          {eq.nom}
                        </Link>
                        <p className="text-xs text-gray-500">{eq.code_interne}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge label={s.label} classe={s.classe} />
                        {peutModifier && <RetirerEquipementBouton contratId={id} equipementId={eq.id} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Aucun équipement couvert par ce contrat.</p>
            )}
          </Carte>
        </div>

        <div className="space-y-6">
          <Carte>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <FileText className="h-4 w-4" /> Documents
            </h2>
            {documents && documents.length > 0 ? (
              <ul className="space-y-2">
                {(documents as DocumentGmao[]).map((d) => {
                  const t = libelleTypeDocument(d.type_document);
                  return (
                    <li key={d.id} className="flex items-center justify-between text-sm">
                      <span className="truncate text-gray-700">{d.titre}</span>
                      <span className="text-xs text-gray-400">{t.label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Aucun document rattaché.</p>
            )}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <Link href={`/documents?contrat=${id}`} className="text-xs text-primary-600 hover:underline">
                Gérer les documents
              </Link>
            </div>
          </Carte>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, valeur }: { label: string; valeur: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-gray-400">{label}</dt>
      <dd className="text-gray-800">{valeur || "—"}</dd>
    </div>
  );
}

function formaterDate(date: string | null | undefined) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("fr-FR");
}
