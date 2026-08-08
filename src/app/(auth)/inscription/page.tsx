"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Bouton } from "@/components/ui/Bouton";
import { Champ, Saisie } from "@/components/ui/Champ";

export default function InscriptionPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [nomComplet, setNomComplet] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);

    const { error } = await supabase.auth.signUp({
      email,
      password: motDePasse,
      options: { data: { nom_complet: nomComplet } },
    });

    setEnCours(false);

    if (error) {
      setErreur(error.message);
      return;
    }

    setSucces(true);
  }

  if (succes) {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Compte créé</h2>
        <p className="text-sm text-gray-600">
          Vérifiez votre boîte mail pour confirmer votre adresse. Un administrateur devra ensuite vous attribuer un
          rôle (par défaut : lecture seule).
        </p>
        <Bouton href="/connexion" variante="secondaire" className="w-full">
          Retour à la connexion
        </Bouton>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Créer un compte</h2>
      <p className="text-xs text-gray-500">
        Les comptes sont créés en accès « lecture seule » par défaut. Un administrateur vous attribuera ensuite le
        rôle adapté à votre fonction.
      </p>
      {erreur && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreur}</p>}

      <Champ label="Nom complet" htmlFor="nom-complet" requis>
        <Saisie id="nom-complet" required value={nomComplet} onChange={(e) => setNomComplet(e.target.value)} />
      </Champ>

      <Champ label="Email" htmlFor="email" requis>
        <Saisie
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Champ>

      <Champ label="Mot de passe" htmlFor="mot-de-passe" requis>
        <Saisie
          id="mot-de-passe"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
        />
      </Champ>

      <Bouton type="submit" enCours={enCours} className="w-full">
        Créer mon compte
      </Bouton>

      <p className="text-center text-sm text-gray-500">
        Déjà un compte ?{" "}
        <Link href="/connexion" className="text-primary-600 hover:underline">
          Se connecter
        </Link>
      </p>
    </form>
  );
}
