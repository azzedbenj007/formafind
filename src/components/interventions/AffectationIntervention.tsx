"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { affecterIntervention } from "@/actions/interventions";
import { Bouton } from "@/components/ui/Bouton";
import { Champ, Selecteur } from "@/components/ui/Champ";
import type { Equipe, Profile } from "@/lib/types";

export function AffectationIntervention({
  interventionId,
  equipementId,
  equipes,
  techniciens,
  equipeIdActuelle,
  technicienIdActuel,
}: {
  interventionId: string;
  equipementId: string;
  equipes: Equipe[];
  techniciens: Profile[];
  equipeIdActuelle: string | null;
  technicienIdActuel: string | null;
}) {
  const router = useRouter();
  const [equipeId, setEquipeId] = useState(equipeIdActuelle ?? "");
  const [technicienId, setTechnicienId] = useState(technicienIdActuel ?? "");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    const resultat = await affecterIntervention(interventionId, equipementId, equipeId || null, technicienId || null);
    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Champ label="Équipe" htmlFor="equipe_id">
        <Selecteur id="equipe_id" value={equipeId} onChange={(e) => setEquipeId(e.target.value)}>
          <option value="">— Non affectée —</option>
          {equipes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
            </option>
          ))}
        </Selecteur>
      </Champ>
      <Champ label="Technicien" htmlFor="technicien_id">
        <Selecteur id="technicien_id" value={technicienId} onChange={(e) => setTechnicienId(e.target.value)}>
          <option value="">— Non affecté —</option>
          {techniciens.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nom_complet || t.email}
            </option>
          ))}
        </Selecteur>
      </Champ>
      {erreur && <p className="text-xs text-danger-600">{erreur}</p>}
      <Bouton type="submit" variante="secondaire" enCours={enCours} className="w-full">
        Affecter
      </Bouton>
    </form>
  );
}
