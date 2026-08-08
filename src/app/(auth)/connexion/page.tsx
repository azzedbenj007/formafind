"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Bouton } from "@/components/ui/Bouton";
import { Champ, Saisie } from "@/components/ui/Champ";

function FormulaireConnexion() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });

    if (error) {
      setErreur("Identifiants incorrects. Vérifiez votre email et votre mot de passe.");
      setEnCours(false);
      return;
    }

    router.push(searchParams.get("suivant") || "/tableau-de-bord");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Connexion</h2>
      {erreur && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreur}</p>}

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
          autoComplete="current-password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
        />
      </Champ>

      <div className="flex items-center justify-between text-sm">
        <Link href="/mot-de-passe-oublie" className="text-primary-600 hover:underline">
          Mot de passe oublié ?
        </Link>
      </div>

      <Bouton type="submit" enCours={enCours} className="w-full">
        Se connecter
      </Bouton>

      <p className="text-center text-sm text-gray-500">
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="text-primary-600 hover:underline">
          Créer un compte
        </Link>
      </p>
    </form>
  );
}

export default function ConnexionPage() {
  return (
    <Suspense>
      <FormulaireConnexion />
    </Suspense>
  );
}
