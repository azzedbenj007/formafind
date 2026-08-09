"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { schemaIntervention, type ValeursIntervention } from "@/lib/validation/intervention";
import { PRIORITES, TYPES_INTERVENTION } from "@/lib/constants";
import { Champ, Saisie, Selecteur, ZoneTexte } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import type { Equipe, Profile } from "@/lib/types";

interface EquipementOption {
  id: string;
  nom: string;
  code_interne: string;
}

interface Props {
  equipements: EquipementOption[];
  equipes: Equipe[];
  techniciens: Profile[];
  equipementPreselectionne?: string;
  onEnregistrer: (valeurs: ValeursIntervention) => Promise<{ erreur?: string; erreurs_champs?: Record<string, string> } | void>;
}

export function InterventionForm({ equipements, equipes, techniciens, equipementPreselectionne, onEnregistrer }: Props) {
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ValeursIntervention>({
    resolver: zodResolver(schemaIntervention),
    defaultValues: {
      type: "corrective",
      priorite: "normale",
      equipement_id: equipementPreselectionne ?? "",
      arret_equipement: false,
    },
  });

  async function onSubmit(valeurs: ValeursIntervention) {
    setErreurGlobale(null);
    setEnCours(true);
    const resultat = await onEnregistrer(valeurs);
    setEnCours(false);
    if (resultat?.erreur) setErreurGlobale(resultat.erreur);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {erreurGlobale && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreurGlobale}</p>}

      <Champ label="Titre" htmlFor="titre" requis erreur={errors.titre?.message}>
        <Saisie id="titre" placeholder="ex. Alarme haute pression persistante" {...register("titre")} />
      </Champ>

      <Champ label="Équipement" htmlFor="equipement_id" requis erreur={errors.equipement_id?.message}>
        <Selecteur id="equipement_id" {...register("equipement_id")}>
          <option value="">— Sélectionner —</option>
          {equipements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom} ({e.code_interne})
            </option>
          ))}
        </Selecteur>
      </Champ>

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Type" htmlFor="type" requis>
          <Selecteur id="type" {...register("type")}>
            {TYPES_INTERVENTION.map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.label}
              </option>
            ))}
          </Selecteur>
        </Champ>
        <Champ label="Priorité" htmlFor="priorite" requis>
          <Selecteur id="priorite" {...register("priorite")}>
            {PRIORITES.map((p) => (
              <option key={p.valeur} value={p.valeur}>
                {p.label}
              </option>
            ))}
          </Selecteur>
        </Champ>
      </div>

      <Champ label="Description" htmlFor="description">
        <ZoneTexte id="description" rows={3} {...register("description")} />
      </Champ>

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Équipe" htmlFor="equipe_id">
          <Selecteur id="equipe_id" {...register("equipe_id")}>
            <option value="">— Non affectée —</option>
            {equipes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom}
              </option>
            ))}
          </Selecteur>
        </Champ>
        <Champ label="Technicien" htmlFor="technicien_id">
          <Selecteur id="technicien_id" {...register("technicien_id")}>
            <option value="">— Non affecté —</option>
            {techniciens.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nom_complet || t.email}
              </option>
            ))}
          </Selecteur>
        </Champ>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Date planifiée" htmlFor="date_planifiee">
          <Saisie id="date_planifiee" type="datetime-local" {...register("date_planifiee")} />
        </Champ>
        <Champ label="Échéance" htmlFor="date_echeance">
          <Saisie id="date_echeance" type="datetime-local" {...register("date_echeance")} />
        </Champ>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" {...register("arret_equipement")} />
        Cette intervention nécessite l&apos;arrêt de l&apos;équipement
      </label>

      <div className="flex justify-end border-t border-gray-100 pt-4">
        <Bouton type="submit" enCours={enCours}>
          Créer l&apos;intervention
        </Bouton>
      </div>
    </form>
  );
}
