import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { MessageAffiche } from "./useChat";

const LIBELLES_OUTILS: Record<string, string> = {
  rechercher_equipements: "Consultation du parc d'équipements...",
  obtenir_equipement: "Consultation de la fiche équipement...",
  compter_equipements: "Calcul des statistiques du parc...",
  rechercher_interventions: "Consultation des interventions...",
  obtenir_kpis: "Calcul des indicateurs...",
  rechercher_contrats: "Consultation des contrats...",
  lister_maintenances_dues: "Consultation des échéances de maintenance...",
  rechercher_documents: "Recherche de documents...",
  obtenir_charge_equipe: "Consultation de la charge des équipes...",
};

export function MessageBulle({ message }: { message: MessageAffiche }) {
  const estUtilisateur = message.role === "user";

  return (
    <div className={clsx("flex", estUtilisateur ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
          estUtilisateur ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-800"
        )}
      >
        {message.contenu ? (
          message.contenu
        ) : message.outilEnCours ? (
          <span className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {LIBELLES_OUTILS[message.outilEnCours] ?? "Recherche en cours..."}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Réflexion...
          </span>
        )}
      </div>
    </div>
  );
}
