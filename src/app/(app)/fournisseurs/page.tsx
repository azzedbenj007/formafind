import Link from "next/link";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { obtenirFournisseurs } from "@/lib/reference-data";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { Bouton } from "@/components/ui/Bouton";
import { Carte, EtatVide } from "@/components/ui/Carte";

export const metadata = { title: "Fournisseurs" };

export default async function FournisseursPage() {
  const [fournisseurs, profile] = await Promise.all([obtenirFournisseurs(), getCurrentProfile()]);
  const peutGerer = peutGererReferentiels(profile?.role);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/contrats" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour aux contrats
        </Link>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Fournisseurs</h1>
            <p className="text-sm text-gray-500">Prestataires et fournisseurs liés aux contrats et équipements.</p>
          </div>
          {peutGerer && (
            <Bouton href="/fournisseurs/nouveau">
              <Plus className="h-4 w-4" />
              Nouveau fournisseur
            </Bouton>
          )}
        </div>
      </div>

      {fournisseurs.length > 0 ? (
        <div className="space-y-2">
          {fournisseurs.map((f) => (
            <Carte key={f.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{f.nom}</p>
                  <p className="text-xs text-gray-500">
                    {f.contact_nom || "—"}
                    {f.email ? ` · ${f.email}` : ""}
                    {f.telephone ? ` · ${f.telephone}` : ""}
                  </p>
                </div>
                {peutGerer && (
                  <Bouton href={`/fournisseurs/${f.id}/modifier`} variante="secondaire" className="shrink-0">
                    <Pencil className="h-4 w-4" />
                    Modifier
                  </Bouton>
                )}
              </div>
            </Carte>
          ))}
        </div>
      ) : (
        <EtatVide
          titre="Aucun fournisseur enregistré"
          description="Ajoutez un fournisseur pour pouvoir lui rattacher des contrats et des équipements."
          action={
            peutGerer ? (
              <Bouton href="/fournisseurs/nouveau" variante="secondaire">
                <Plus className="h-4 w-4" />
                Ajouter un fournisseur
              </Bouton>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
