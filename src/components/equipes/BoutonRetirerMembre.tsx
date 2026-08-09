"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { retirerMembre } from "@/actions/equipes";

export function BoutonRetirerMembre({ equipeId, profileId }: { equipeId: string; profileId: string }) {
  const [enCours, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function retirer() {
    if (!confirm("Retirer ce membre de l'équipe ?")) return;
    setErreur(null);
    startTransition(async () => {
      const resultat = await retirerMembre(equipeId, profileId);
      if (resultat?.erreur) setErreur(resultat.erreur);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={retirer}
        disabled={enCours}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger-600 hover:bg-danger-50 disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
        Retirer
      </button>
      {erreur && <p className="text-xs text-danger-600">{erreur}</p>}
    </div>
  );
}
