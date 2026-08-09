import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { Carte } from "@/components/ui/Carte";

export function CarteKpi({
  titre,
  valeur,
  icone: Icone,
  tonalite = "neutre",
  sousTitre,
}: {
  titre: string;
  valeur: string | number;
  icone: LucideIcon;
  tonalite?: "neutre" | "danger" | "warning" | "success";
  sousTitre?: string;
}) {
  const classesIcone = {
    neutre: "bg-primary-50 text-primary-600",
    danger: "bg-danger-50 text-danger-600",
    warning: "bg-warning-50 text-warning-600",
    success: "bg-success-50 text-success-600",
  }[tonalite];

  return (
    <Carte className="flex items-start justify-between">
      <div>
        <p className="text-sm text-gray-500">{titre}</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{valeur}</p>
        {sousTitre && <p className="mt-1 text-xs text-gray-400">{sousTitre}</p>}
      </div>
      <div className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", classesIcone)}>
        <Icone className="h-5 w-5" />
      </div>
    </Carte>
  );
}
