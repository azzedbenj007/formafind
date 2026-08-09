"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { schemaFournisseur, type ValeursFournisseur } from "@/lib/validation/fournisseur";
import { Champ, Saisie, ZoneTexte } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import type { Fournisseur } from "@/lib/types";

interface Props {
  fournisseur?: Fournisseur;
  onEnregistrer: (valeurs: ValeursFournisseur) => Promise<{ erreur?: string; erreurs_champs?: Record<string, string> } | void>;
}

export function FournisseurForm({ fournisseur, onEnregistrer }: Props) {
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ValeursFournisseur>({
    resolver: zodResolver(schemaFournisseur),
    defaultValues: fournisseur
      ? {
          nom: fournisseur.nom,
          contact_nom: fournisseur.contact_nom ?? "",
          email: fournisseur.email ?? "",
          telephone: fournisseur.telephone ?? "",
          adresse: fournisseur.adresse ?? "",
          siret: fournisseur.siret ?? "",
          notes: fournisseur.notes ?? "",
        }
      : {},
  });

  async function onSubmit(valeurs: ValeursFournisseur) {
    setErreurGlobale(null);
    setEnCours(true);
    const resultat = await onEnregistrer(valeurs);
    setEnCours(false);
    if (resultat?.erreur) setErreurGlobale(resultat.erreur);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {erreurGlobale && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreurGlobale}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Nom du fournisseur" htmlFor="nom" requis erreur={errors.nom?.message} className="sm:col-span-2">
          <Saisie id="nom" placeholder="ex. MedTech Services" {...register("nom")} />
        </Champ>
        <Champ label="Nom du contact" htmlFor="contact_nom">
          <Saisie id="contact_nom" {...register("contact_nom")} />
        </Champ>
        <Champ label="Téléphone" htmlFor="telephone">
          <Saisie id="telephone" {...register("telephone")} />
        </Champ>
        <Champ label="E-mail" htmlFor="email" erreur={errors.email?.message}>
          <Saisie id="email" type="email" {...register("email")} />
        </Champ>
        <Champ label="SIRET" htmlFor="siret">
          <Saisie id="siret" {...register("siret")} />
        </Champ>
        <Champ label="Adresse" htmlFor="adresse" className="sm:col-span-2">
          <Saisie id="adresse" {...register("adresse")} />
        </Champ>
        <Champ label="Notes" htmlFor="notes" className="sm:col-span-2">
          <ZoneTexte id="notes" rows={3} {...register("notes")} />
        </Champ>
      </div>

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <Bouton type="submit" enCours={enCours}>
          {fournisseur ? "Enregistrer les modifications" : "Créer le fournisseur"}
        </Bouton>
      </div>
    </form>
  );
}
