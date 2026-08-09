import Link from "next/link";
import { AlertTriangle, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { libelleCriticite, libelleStatutEquipement } from "@/lib/constants";
import type { EquipementDetail } from "@/lib/types";

export function CarteEquipement({ equipement }: { equipement: EquipementDetail }) {
  const statut = libelleStatutEquipement(equipement.statut);
  const criticite = libelleCriticite(equipement.criticite);

  return (
    <Link
      href={`/equipements/${equipement.id}`}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-gray-900">{equipement.nom}</p>
          {equipement.criticite === "vitale" && equipement.statut === "en_panne" && (
            <AlertTriangle className="h-4 w-4 shrink-0 text-danger-600" />
          )}
        </div>
        <p className="text-sm text-gray-500">
          {equipement.code_interne}
          {equipement.modele ? ` · ${equipement.modele}` : ""}
          {equipement.categorie_nom ? ` · ${equipement.categorie_nom}` : ""}
        </p>
        {(equipement.service_nom || equipement.localisation_precise) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
            <MapPin className="h-3 w-3" />
            {[equipement.service_nom, equipement.localisation_precise].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {equipement.nb_interventions_ouvertes > 0 && (
          <span className="text-xs text-gray-400">{equipement.nb_interventions_ouvertes} intervention(s) ouverte(s)</span>
        )}
        <Badge label={criticite.label} classe={criticite.classe} />
        <Badge label={statut.label} classe={statut.classe} />
      </div>
    </Link>
  );
}
