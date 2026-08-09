"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { schemaEquipe, type ValeursEquipe } from "@/lib/validation/equipe";
import { Champ, Saisie, Selecteur, ZoneTexte } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import type { Equipe } from "@/lib/types";

interface ProfilOption {
  id: string;
  nom_complet: string | null;
  email: string;
}

interface Props {
  equipe?: Equipe;
  profiles: ProfilOption[];
  onEnregistrer: (valeurs: ValeursEquipe) => Promise<{ erreur?: string; erreurs_champs?: Record<string, string> } | void>;
}

export function EquipeForm({ equipe, profiles, onEnregistrer }: Props) {
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ValeursEquipe>({
    resolver: zodResolver(schemaEquipe),
    defaultValues: equipe
      ? {
          nom: equipe.nom,
          specialite: equipe.specialite ?? "",
          description: equipe.description ?? "",
          responsable_id: equipe.responsable_id ?? "",
        }
      : { nom: "", specialite: "", description: "", responsable_id: "" },
  });

  async function onSubmit(valeurs: ValeursEquipe) {
    setErreurGlobale(null);
    setEnCours(true);
    const resultat = await onEnregistrer(valeurs);
    setEnCours(false);
    if (resultat?.erreur) setErreurGlobale(resultat.erreur);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {erreurGlobale && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreurGlobale}</p>}

      <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Nom de l'équipe" htmlFor="nom" requis erreur={errors.nom?.message}>
            <Saisie id="nom" placeholder="ex. Équipe biomédicale" {...register("nom")} />
          </Champ>
          <Champ label="Spécialité" htmlFor="specialite">
            <Saisie id="specialite" placeholder="ex. Électronique médicale" {...register("specialite")} />
          </Champ>
          <Champ label="Responsable" htmlFor="responsable_id" className="sm:col-span-2">
            <Selecteur id="responsable_id" {...register("responsable_id")}>
              <option value="">— Aucun —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom_complet || p.email}
                </option>
              ))}
            </Selecteur>
          </Champ>
          <Champ label="Description" htmlFor="description" className="sm:col-span-2">
            <ZoneTexte id="description" rows={3} {...register("description")} />
          </Champ>
        </div>
      </section>

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <Bouton type="submit" enCours={enCours}>
          {equipe ? "Enregistrer les modifications" : "Créer l'équipe"}
        </Bouton>
      </div>
    </form>
  );
}
