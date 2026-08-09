import Link from "next/link";
import { STATUTS_INTERVENTION, libellePriorite } from "@/lib/constants";
import type { InterventionDetail } from "@/lib/types";
import type { StatutIntervention } from "@/lib/types";

export function KanbanInterventions({ interventions }: { interventions: InterventionDetail[] }) {
  const colonnes: StatutIntervention[] = ["a_faire", "en_cours", "en_attente_pieces", "terminee", "annulee"];

  return (
    <div className="grid grid-cols-1 gap-4 overflow-x-auto sm:grid-cols-2 lg:grid-cols-5">
      {colonnes.map((statut) => {
        const libelle = STATUTS_INTERVENTION.find((s) => s.valeur === statut)!;
        const items = interventions.filter((i) => i.statut === statut);
        return (
          <div key={statut} className="min-w-[240px] rounded-xl bg-gray-100 p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">{libelle.label}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((i) => {
                const priorite = libellePriorite(i.priorite);
                return (
                  <Link
                    key={i.id}
                    href={`/interventions/${i.id}`}
                    className="block rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <p className="truncate text-sm font-medium text-gray-900">{i.titre}</p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">{i.equipement_code_interne}</p>
                    <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${priorite.classe}`}>
                      {priorite.label}
                    </span>
                  </Link>
                );
              })}
              {items.length === 0 && <p className="px-1 text-xs text-gray-400">Aucune intervention</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
