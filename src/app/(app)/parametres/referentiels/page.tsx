import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels } from "@/lib/permissions";
import { obtenirCategories, obtenirServices, obtenirSites } from "@/lib/reference-data";
import { Carte } from "@/components/ui/Carte";
import { FormulaireCategorie, FormulaireService, FormulaireSite } from "@/components/parametres/ReferentielsForms";

export const metadata = { title: "Référentiels" };

export default async function ReferentielsPage() {
  const profile = await getCurrentProfile();
  if (!peutGererReferentiels(profile?.role)) redirect("/tableau-de-bord");

  const [sites, services, categories] = await Promise.all([obtenirSites(), obtenirServices(), obtenirCategories()]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Référentiels</h1>
        <p className="text-sm text-gray-500">Sites, services et catégories d&apos;équipement utilisés dans toute l&apos;application.</p>
      </div>

      <Carte>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Sites</h2>
        <FormulaireSite />
        <ul className="mt-4 space-y-1 text-sm text-gray-700">
          {sites.map((s) => (
            <li key={s.id}>
              {s.nom} {s.ville ? `— ${s.ville}` : ""}
            </li>
          ))}
        </ul>
      </Carte>

      <Carte>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Services</h2>
        <FormulaireService sites={sites} />
        <ul className="mt-4 space-y-1 text-sm text-gray-700">
          {services.map((s) => (
            <li key={s.id}>
              {s.nom} {s.code ? `(${s.code})` : ""}
            </li>
          ))}
        </ul>
      </Carte>

      <Carte>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Catégories d&apos;équipement</h2>
        <FormulaireCategorie />
        <ul className="mt-4 space-y-1 text-sm text-gray-700">
          {categories.map((c) => (
            <li key={c.id}>
              {c.nom} <span className="text-gray-400">({c.famille})</span>
            </li>
          ))}
        </ul>
      </Carte>
    </div>
  );
}
