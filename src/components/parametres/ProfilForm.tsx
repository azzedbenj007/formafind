"use client";

import { useState } from "react";
import { modifierMonProfil } from "@/actions/profil";
import { Champ, Saisie } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import type { Profile } from "@/lib/types";

export function ProfilForm({ profile }: { profile: Profile }) {
  const [nomComplet, setNomComplet] = useState(profile.nom_complet ?? "");
  const [telephone, setTelephone] = useState(profile.telephone ?? "");
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ type: "succes" | "erreur"; texte: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setMessage(null);
    const resultat = await modifierMonProfil(nomComplet, telephone);
    setEnCours(false);
    setMessage(
      resultat?.erreur ? { type: "erreur", texte: resultat.erreur } : { type: "succes", texte: "Profil mis à jour." }
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Champ label="Email" htmlFor="email">
        <Saisie id="email" value={profile.email} disabled />
      </Champ>
      <Champ label="Nom complet" htmlFor="nom_complet">
        <Saisie id="nom_complet" value={nomComplet} onChange={(e) => setNomComplet(e.target.value)} />
      </Champ>
      <Champ label="Téléphone" htmlFor="telephone">
        <Saisie id="telephone" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
      </Champ>
      {message && (
        <p className={message.type === "erreur" ? "text-sm text-danger-600" : "text-sm text-success-700"}>{message.texte}</p>
      )}
      <Bouton type="submit" enCours={enCours}>
        Enregistrer
      </Bouton>
    </form>
  );
}
