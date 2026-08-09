"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ajouterCommentaireIntervention } from "@/actions/interventions";
import { Bouton } from "@/components/ui/Bouton";
import { ZoneTexte } from "@/components/ui/Champ";

export function FormulaireCommentaire({ interventionId }: { interventionId: string }) {
  const router = useRouter();
  const [commentaire, setCommentaire] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!commentaire.trim()) return;
    setErreur(null);
    setEnCours(true);
    const resultat = await ajouterCommentaireIntervention(interventionId, commentaire);
    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
      return;
    }
    setCommentaire("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <ZoneTexte
        rows={2}
        placeholder="Ajouter un commentaire..."
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
      />
      {erreur && <p className="text-xs text-danger-600">{erreur}</p>}
      <div className="flex justify-end">
        <Bouton type="submit" variante="secondaire" enCours={enCours}>
          Commenter
        </Bouton>
      </div>
    </form>
  );
}
