"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { ajouterMembre } from "@/actions/equipes";
import { Champ, Saisie, Selecteur } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";

interface ProfilOption {
  id: string;
  nom_complet: string | null;
  email: string;
}

export function GestionMembres({ equipeId, profilesDisponibles }: { equipeId: string; profilesDisponibles: ProfilOption[] }) {
  const [profileId, setProfileId] = useState("");
  const [roleDansEquipe, setRoleDansEquipe] = useState("technicien");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    const resultat = await ajouterMembre(equipeId, profileId, roleDansEquipe);
    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
    } else {
      setProfileId("");
      setRoleDansEquipe("technicien");
    }
  }

  if (profilesDisponibles.length === 0) {
    return <p className="text-sm text-gray-500">Tous les utilisateurs disponibles font déjà partie de l&apos;équipe.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {erreur && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreur}</p>}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Champ label="Utilisateur" htmlFor="nouveau_membre">
          <Selecteur id="nouveau_membre" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {profilesDisponibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom_complet || p.email}
              </option>
            ))}
          </Selecteur>
        </Champ>
        <Champ label="Rôle dans l'équipe" htmlFor="role_dans_equipe">
          <Saisie
            id="role_dans_equipe"
            value={roleDansEquipe}
            onChange={(e) => setRoleDansEquipe(e.target.value)}
            placeholder="ex. technicien"
          />
        </Champ>
        <Bouton type="submit" enCours={enCours} disabled={!profileId}>
          <UserPlus className="h-4 w-4" />
          Ajouter
        </Bouton>
      </div>
    </form>
  );
}
