import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { libellePriorite, libelleStatutIntervention, libelleTypeIntervention } from "@/lib/constants";
import type { InterventionDetail } from "@/lib/types";

function formaterDate(date: string | null) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("fr-FR");
}

export function CarteIntervention({ intervention }: { intervention: InterventionDetail }) {
  const statut = libelleStatutIntervention(intervention.statut);
  const type = libelleTypeIntervention(intervention.type);
  const priorite = libellePriorite(intervention.priorite);

  return (
    <Link
      href={`/interventions/${intervention.id}`}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-gray-900">{intervention.titre}</p>
          {intervention.en_retard && <AlertTriangle className="h-4 w-4 shrink-0 text-danger-600" />}
        </div>
        <p className="text-sm text-gray-500">
          {intervention.numero} · {intervention.equipement_nom} ({intervention.equipement_code_interne})
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {[intervention.service_nom, intervention.technicien_nom, formaterDate(intervention.date_echeance) && `échéance ${formaterDate(intervention.date_echeance)}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge label={type.label} classe={type.classe} />
        <Badge label={priorite.label} classe={priorite.classe} />
        <Badge label={statut.label} classe={statut.classe} />
      </div>
    </Link>
  );
}
