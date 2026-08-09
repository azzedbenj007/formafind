import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, FileText, Pencil, ShieldCheck, Wrench } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { obtenirUrlSignee } from "@/lib/storage";
import { Badge } from "@/components/ui/Badge";
import { Bouton } from "@/components/ui/Bouton";
import { Carte } from "@/components/ui/Carte";
import {
  libelleCriticite,
  libelleStatutEquipement,
  libelleStatutIntervention,
  libelleTypeIntervention,
} from "@/lib/constants";
import { PhotoUploader } from "@/components/equipements/PhotoUploader";
import type { ContratDetail, DocumentGmao, EquipementDetail, InterventionDetail, PlanMaintenance } from "@/lib/types";

export default async function EquipementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const profile = await getCurrentProfile();

  const { data: equipement } = await supabase.from("vue_equipements_detail").select("*").eq("id", id).single();
  if (!equipement) notFound();
  const eq = equipement as EquipementDetail;

  const [{ data: interventions }, { data: plans }, { data: documents }, { data: contratsLies }, photoUrl] =
    await Promise.all([
      supabase
        .from("vue_interventions_detail")
        .select("*")
        .eq("equipement_id", id)
        .order("date_echeance", { ascending: false })
        .limit(10),
      supabase.from("plans_maintenance").select("*").eq("equipement_id", id).eq("actif", true).order("prochaine_echeance"),
      supabase.from("documents").select("*").eq("equipement_id", id).order("created_at", { ascending: false }),
      supabase
        .from("contrats_equipements")
        .select("contrats:contrat_id(*)")
        .eq("equipement_id", id),
      eq.photo_url ? obtenirUrlSignee(eq.photo_url) : Promise.resolve(null),
    ]);

  const statut = libelleStatutEquipement(eq.statut);
  const criticite = libelleCriticite(eq.criticite);
  const peutModifier = peutGererReferentiels(profile?.role);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/equipements" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4" />
            Retour à la liste
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{eq.nom}</h1>
            <Badge label={statut.label} classe={statut.classe} />
            <Badge label={criticite.label} classe={criticite.classe} />
            {eq.sous_contrat && <Badge label="Sous contrat" classe="bg-success-100 text-success-700" />}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {eq.code_interne}
            {eq.modele ? ` · ${eq.modele}` : ""}
            {eq.fabricant ? ` · ${eq.fabricant}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {profile?.role !== "lecture_seule" && (
            <Bouton href={`/interventions/nouvelle?equipement=${id}`} variante="secondaire">
              <Wrench className="h-4 w-4" />
              Déclarer une panne
            </Bouton>
          )}
          {peutModifier && (
            <Bouton href={`/equipements/${id}/modifier`}>
              <Pencil className="h-4 w-4" />
              Modifier
            </Bouton>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Carte>
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Informations générales</h2>
            <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-3">
              <InfoItem label="Catégorie" valeur={eq.categorie_nom} />
              <InfoItem label="N° de série" valeur={eq.numero_serie} />
              <InfoItem label="Site" valeur={eq.site_nom} />
              <InfoItem label="Service" valeur={eq.service_nom} />
              <InfoItem label="Localisation" valeur={eq.localisation_precise} />
              <InfoItem label="Fournisseur" valeur={eq.fournisseur_nom} />
              <InfoItem label="Date d'achat" valeur={formaterDate(eq.date_achat)} />
              <InfoItem label="Mise en service" valeur={formaterDate(eq.date_mise_service)} />
              <InfoItem label="Fin de garantie" valeur={formaterDate(eq.fin_garantie)} />
              <InfoItem
                label="Coût d'acquisition"
                valeur={eq.cout_acquisition ? `${eq.cout_acquisition.toLocaleString("fr-FR")} MAD` : null}
              />
            </dl>
            {eq.notes && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-xs font-medium uppercase text-gray-400">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{eq.notes}</p>
              </div>
            )}
          </Carte>

          <Carte>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Interventions récentes</h2>
              <Link href={`/interventions?equipement=${id}`} className="text-xs text-primary-600 hover:underline">
                Voir tout
              </Link>
            </div>
            {interventions && interventions.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {(interventions as InterventionDetail[]).map((i) => {
                  const s = libelleStatutIntervention(i.statut);
                  const t = libelleTypeIntervention(i.type);
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <Link href={`/interventions/${i.id}`} className="truncate text-sm font-medium text-gray-900 hover:underline">
                          {i.titre}
                        </Link>
                        <p className="text-xs text-gray-500">
                          {i.numero} · {t.label}
                          {i.date_echeance ? ` · échéance ${formaterDate(i.date_echeance)}` : ""}
                        </p>
                      </div>
                      <Badge label={s.label} classe={s.classe} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Aucune intervention enregistrée.</p>
            )}
          </Carte>

          <Carte>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <FileText className="h-4 w-4" /> Documents
              </h2>
              <Link href={`/documents?equipement=${id}`} className="text-xs text-primary-600 hover:underline">
                Voir tout
              </Link>
            </div>
            {documents && documents.length > 0 ? (
              <ul className="space-y-2">
                {(documents as DocumentGmao[]).slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-sm">
                    <span className="truncate text-gray-700">{d.titre}</span>
                    <span className="text-xs text-gray-400">{d.type_document}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Aucun document rattaché.</p>
            )}
          </Carte>
        </div>

        <div className="space-y-6">
          <Carte>
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Photo</h2>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt={eq.nom} className="mb-3 aspect-video w-full rounded-lg object-cover" />
            ) : (
              <div className="mb-3 flex aspect-video w-full items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400">
                Aucune photo
              </div>
            )}
            {peutModifier && <PhotoUploader equipementId={id} />}
          </Carte>

          <Carte>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CalendarClock className="h-4 w-4" /> Plans de maintenance
            </h2>
            {plans && plans.length > 0 ? (
              <ul className="space-y-3">
                {(plans as PlanMaintenance[]).map((p) => (
                  <li key={p.id} className="text-sm">
                    <p className="font-medium text-gray-800">{p.nom}</p>
                    <p className="text-xs text-gray-500">
                      Échéance : {formaterDate(p.prochaine_echeance)} · tous les {p.frequence_valeur} {p.frequence_unite}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Aucun plan de maintenance actif.</p>
            )}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <Link href="/plans-maintenance" className="text-xs text-primary-600 hover:underline">
                Gérer les plans de maintenance
              </Link>
            </div>
          </Carte>

          <Carte>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <ShieldCheck className="h-4 w-4" /> Contrats
            </h2>
            {contratsLies && contratsLies.length > 0 ? (
              <ul className="space-y-3">
                {contratsLies.map((c, idx) => {
                  const contrat = (c as unknown as { contrats: ContratDetail }).contrats;
                  if (!contrat) return null;
                  return (
                    <li key={idx} className="text-sm">
                      <Link href={`/contrats/${contrat.id}`} className="font-medium text-gray-800 hover:underline">
                        {contrat.intitule}
                      </Link>
                      <p className="text-xs text-gray-500">Jusqu&apos;au {formaterDate(contrat.date_fin)}</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Aucun contrat associé.</p>
            )}
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
