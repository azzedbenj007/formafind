import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { libelleStatutContrat, libelleTypeContrat } from "@/lib/constants";
import { Bouton } from "@/components/ui/Bouton";
import { Carte, EtatVide } from "@/components/ui/Carte";
import { Badge } from "@/components/ui/Badge";
import { FiltresContrats } from "@/components/contrats/FiltresContrats";
import type { ContratDetail } from "@/lib/types";

export const metadata = { title: "Contrats" };

interface SearchParams {
  statut?: string;
}

export default async function ContratsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const profile = await getCurrentProfile();

  let requete = supabase.from("vue_contrats_detail").select("*").order("date_fin");
  if (params.statut) requete = requete.eq("statut", params.statut);

  const { data: contrats, error } = await requete.limit(200);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Contrats</h1>
          <p className="text-sm text-gray-500">Contrats de maintenance, garanties et prestations fournisseurs.</p>
        </div>
        <div className="flex gap-2">
          <Bouton href="/fournisseurs" variante="secondaire">
            Gérer les fournisseurs
          </Bouton>
          {peutGererReferentiels(profile?.role) && (
            <Bouton href="/contrats/nouveau">
              <Plus className="h-4 w-4" />
              Nouveau contrat
            </Bouton>
          )}
        </div>
      </div>

      <FiltresContrats />

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      {contrats && contrats.length > 0 ? (
        <div className="space-y-2">
          {(contrats as ContratDetail[]).map((c) => (
            <LigneContrat key={c.id} contrat={c} />
          ))}
        </div>
      ) : (
        <EtatVide
          titre="Aucun contrat trouvé"
          description="Ajustez vos filtres ou ajoutez un nouveau contrat."
          action={
            peutGererReferentiels(profile?.role) ? (
              <Bouton href="/contrats/nouveau" variante="secondaire">
                <FileSignature className="h-4 w-4" />
                Ajouter un contrat
              </Bouton>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

function LigneContrat({ contrat }: { contrat: ContratDetail }) {
  const type = libelleTypeContrat(contrat.type_contrat);
  const statut = libelleStatutContrat(contrat.statut);
  const urgence = obtenirUrgence(contrat);

  return (
    <Link href={`/contrats/${contrat.id}`}>
      <Carte className="transition-colors hover:border-primary-300">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-gray-900">{contrat.intitule}</p>
              <Badge label={type.label} classe={type.classe} />
              <Badge label={statut.label} classe={statut.classe} />
              {urgence && <Badge label={urgence.label} classe={urgence.classe} />}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {contrat.reference} · {contrat.fournisseur_nom} · {contrat.nb_equipements_couverts} équipement(s) couvert(s)
            </p>
          </div>
          <div className="shrink-0 text-right text-xs text-gray-500">
            <p>Échéance : {formaterDate(contrat.date_fin)}</p>
          </div>
        </div>
      </Carte>
    </Link>
  );
}

function obtenirUrgence(contrat: ContratDetail): { label: string; classe: string } | null {
  if (contrat.statut !== "actif") return null;
  const jours = contrat.jours_avant_expiration;
  if (jours <= 30) return { label: `Expire dans ${jours} jour(s)`, classe: "bg-danger-100 text-danger-700" };
  if (jours <= 90) return { label: `Expire dans ${jours} jour(s)`, classe: "bg-warning-100 text-warning-700" };
  return null;
}

function formaterDate(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR");
}
