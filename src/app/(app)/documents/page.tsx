import { FileText, Plus } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutUploaderDocument } from "@/lib/permissions";
import { obtenirUrlsSignees } from "@/lib/storage";
import { Bouton } from "@/components/ui/Bouton";
import { Carte, EtatVide } from "@/components/ui/Carte";
import { Badge } from "@/components/ui/Badge";
import { libelleTypeDocument } from "@/lib/constants";
import { FiltresDocuments } from "@/components/documents/FiltresDocuments";
import { BoutonSupprimerDocument } from "@/components/documents/BoutonSupprimerDocument";
import type { DocumentGmao } from "@/lib/types";

export const metadata = { title: "Documents" };

interface SearchParams {
  equipement?: string;
  type?: string;
  recherche?: string;
}

interface DocumentAvecLiens extends DocumentGmao {
  equipements: { nom: string; code_interne: string } | null;
  contrats: { intitule: string } | null;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const profile = await getCurrentProfile();

  let requete = supabase
    .from("documents")
    .select("*, equipements(nom, code_interne), contrats(intitule)")
    .order("created_at", { ascending: false });

  if (params.equipement) requete = requete.eq("equipement_id", params.equipement);
  if (params.type) requete = requete.eq("type_document", params.type);
  if (params.recherche) {
    const q = params.recherche.replace(/[%,]/g, "");
    requete = requete.ilike("titre", `%${q}%`);
  }

  const { data: documents, error } = await requete.limit(200);

  const docs = (documents as DocumentAvecLiens[] | null) ?? [];
  const urlsSignees = await obtenirUrlsSignees(docs.map((d) => d.chemin_stockage));

  const hrefNouveau = params.equipement ? `/documents/nouveau?equipement=${params.equipement}` : "/documents/nouveau";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-500">Manuels, certificats, rapports et autres pièces jointes.</p>
        </div>
        {peutUploaderDocument(profile?.role) && (
          <Bouton href={hrefNouveau}>
            <Plus className="h-4 w-4" />
            Ajouter un document
          </Bouton>
        )}
      </div>

      <FiltresDocuments />

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      {docs.length > 0 ? (
        <div className="space-y-2">
          {docs.map((d) => {
            const type = libelleTypeDocument(d.type_document);
            const peutSupprimer =
              profile?.role === "admin" || profile?.role === "responsable_maintenance" || profile?.id === d.uploaded_by;
            const sousTitre = [
              d.equipements ? `${d.equipements.nom} (${d.equipements.code_interne})` : null,
              d.contrats ? d.contrats.intitule : null,
              d.nom_fichier,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <Carte key={d.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{d.titre}</p>
                    <Badge label={type.label} classe={type.classe} />
                  </div>
                  {sousTitre && <p className="mt-1 truncate text-xs text-gray-500">{sousTitre}</p>}
                  {d.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.tags.map((t) => (
                        <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {urlsSignees[d.chemin_stockage] && (
                    <a
                      href={urlsSignees[d.chemin_stockage]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary-600 hover:underline"
                    >
                      Télécharger
                    </a>
                  )}
                  {peutSupprimer && <BoutonSupprimerDocument id={d.id} />}
                </div>
              </Carte>
            );
          })}
        </div>
      ) : (
        <EtatVide
          titre="Aucun document trouvé"
          description="Ajustez vos filtres ou ajoutez un nouveau document."
          action={
            peutUploaderDocument(profile?.role) ? (
              <Bouton href={hrefNouveau} variante="secondaire">
                <FileText className="h-4 w-4" />
                Ajouter un document
              </Bouton>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
