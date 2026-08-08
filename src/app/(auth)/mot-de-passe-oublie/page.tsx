"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Bouton } from "@/components/ui/Bouton";
import { Champ, Saisie } from "@/components/ui/Champ";

export default function MotDePasseOubliePage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [envoye, setEnvoye] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnCours(true);
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?suivant=/parametres`,
    });
    setEnCours(false);
    setEnvoye(true);
  }

  if (envoye) {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Email envoyé</h2>
        <p className="text-sm text-gray-600">Si un compte existe pour {email}, un lien de réinitialisation vient d’être envoyé.</p>
        <Bouton href="/connexion" variante="secondaire" className="w-full">
          Retour à la connexion
        </Bouton>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Mot de passe oublié</h2>
      <p className="text-sm text-gray-500">Saisissez votre email pour recevoir un lien de réinitialisation.</p>

      <Champ label="Email" htmlFor="email" requis>
        <Saisie id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Champ>

      <Bouton type="submit" enCours={enCours} className="w-full">
        Envoyer le lien
      </Bouton>

      <p className="text-center text-sm text-gray-500">
        <Link href="/connexion" className="text-primary-600 hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </form>
  );
}
