"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { supprimerDocument } from "@/actions/documents";
import { Bouton } from "@/components/ui/Bouton";

export function BoutonSupprimerDocument({ id }: { id: string }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm("Supprimer définitivement ce document ?")) return;
    setErreur(null);
    setEnCours(true);
    const resultat = await supprimerDocument(id);
    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end">
      <Bouton
        variante="fantome"
        type="button"
        enCours={enCours}
        onClick={onClick}
        className="text-danger-600 hover:bg-danger-50"
      >
        <Trash2 className="h-4 w-4" />
        Supprimer
      </Bouton>
      {erreur && <p className="mt-1 text-xs text-danger-600">{erreur}</p>}
    </div>
  );
}
