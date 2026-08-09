"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { dissocierEquipement } from "@/actions/contrats";

export function RetirerEquipementBouton({ contratId, equipementId }: { contratId: string; equipementId: string }) {
  const [enCours, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function retirer() {
    if (!confirm("Retirer cet équipement de la couverture du contrat ?")) return;
    setErreur(null);
    startTransition(async () => {
      const resultat = await dissocierEquipement(contratId, equipementId);
      if (resultat?.erreur) setErreur(resultat.erreur);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={retirer}
        disabled={enCours}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
        Retirer
      </button>
      {erreur && <span className="text-xs text-danger-600">{erreur}</span>}
    </div>
  );
}
