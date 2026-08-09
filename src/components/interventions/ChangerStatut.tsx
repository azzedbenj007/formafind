"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changerStatutIntervention } from "@/actions/interventions";
import { STATUTS_INTERVENTION } from "@/lib/constants";
import { Bouton } from "@/components/ui/Bouton";
import { Champ, Selecteur, ZoneTexte } from "@/components/ui/Champ";
import type { StatutIntervention } from "@/lib/types";

export function ChangerStatut({
  interventionId,
  equipementId,
  statutActuel,
  compteRenduActuel,
}: {
  interventionId: string;
  equipementId: string;
  statutActuel: StatutIntervention;
  compteRenduActuel: string | null;
}) {
  const router = useRouter();
  const [statut, setStatut] = useState<StatutIntervention>(statutActuel);
  const [compteRendu, setCompteRendu] = useState(compteRenduActuel ?? "");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    const resultat = await changerStatutIntervention(interventionId, equipementId, { statut, compte_rendu: compteRendu });
    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
      return;
    }
    router.refresh();
  }

  const inchange = statut === statutActuel && compteRendu === (compteRenduActuel ?? "");

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Champ label="Statut" htmlFor="statut">
        <Selecteur id="statut" value={statut} onChange={(e) => setStatut(e.target.value as StatutIntervention)}>
          {STATUTS_INTERVENTION.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {s.label}
            </option>
          ))}
        </Selecteur>
      </Champ>
      <Champ label="Compte-rendu" htmlFor="compte_rendu" requis={statut === "terminee"}>
        <ZoneTexte id="compte_rendu" rows={3} value={compteRendu} onChange={(e) => setCompteRendu(e.target.value)} />
      </Champ>
      {erreur && <p className="text-xs text-danger-600">{erreur}</p>}
      <Bouton type="submit" variante="secondaire" enCours={enCours} disabled={inchange} className="w-full">
        Mettre à jour
      </Bouton>
    </form>
  );
}
