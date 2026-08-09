"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { schemaPlanMaintenance, type ValeursPlanMaintenance } from "@/lib/validation/plan-maintenance";
import { PRIORITES } from "@/lib/constants";
import { Champ, Saisie, Selecteur, ZoneTexte } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import type { Equipe, PlanMaintenance } from "@/lib/types";

interface EquipementOption {
  id: string;
  nom: string;
  code_interne: string;
}

interface Props {
  plan?: PlanMaintenance;
  equipements: EquipementOption[];
  equipes: Equipe[];
  onEnregistrer: (valeurs: ValeursPlanMaintenance) => Promise<{ erreur?: string; erreurs_champs?: Record<string, string> } | void>;
}

export function PlanForm({ plan, equipements, equipes, onEnregistrer }: Props) {
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ValeursPlanMaintenance>({
    resolver: zodResolver(schemaPlanMaintenance),
    defaultValues: plan
      ? {
          equipement_id: plan.equipement_id,
          nom: plan.nom,
          description: plan.description ?? "",
          type_intervention: plan.type_intervention,
          frequence_valeur: plan.frequence_valeur,
          frequence_unite: plan.frequence_unite,
          prochaine_echeance: plan.prochaine_echeance,
          duree_estimee_min: plan.duree_estimee_min ?? undefined,
          equipe_id: plan.equipe_id ?? "",
          priorite: plan.priorite,
          jours_anticipation: plan.jours_anticipation,
          checklist: plan.checklist ?? [],
        }
      : {
          type_intervention: "preventive",
          frequence_valeur: 3,
          frequence_unite: "mois",
          priorite: "normale",
          jours_anticipation: 7,
          checklist: [],
        },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "checklist" });

  async function onSubmit(valeurs: ValeursPlanMaintenance) {
    setErreurGlobale(null);
    setEnCours(true);
    const resultat = await onEnregistrer(valeurs);
    setEnCours(false);
    if (resultat?.erreur) setErreurGlobale(resultat.erreur);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {erreurGlobale && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreurGlobale}</p>}

      <Champ label="Nom du plan" htmlFor="nom" requis erreur={errors.nom?.message}>
        <Saisie id="nom" placeholder="ex. Contrôle préventif trimestriel" {...register("nom")} />
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

      <Champ label="Description" htmlFor="description">
        <ZoneTexte id="description" rows={2} {...register("description")} />
      </Champ>

      <div className="grid gap-4 sm:grid-cols-3">
        <Champ label="Type" htmlFor="type_intervention" requis>
          <Selecteur id="type_intervention" {...register("type_intervention")}>
            <option value="preventive">Préventive</option>
            <option value="controle_reglementaire">Contrôle réglementaire</option>
          </Selecteur>
        </Champ>
        <Champ label="Fréquence" htmlFor="frequence_valeur" requis erreur={errors.frequence_valeur?.message}>
          <Saisie id="frequence_valeur" type="number" min={1} {...register("frequence_valeur")} />
        </Champ>
        <Champ label="Unité" htmlFor="frequence_unite" requis>
          <Selecteur id="frequence_unite" {...register("frequence_unite")}>
            <option value="jours">Jours</option>
            <option value="semaines">Semaines</option>
            <option value="mois">Mois</option>
            <option value="annees">Années</option>
          </Selecteur>
        </Champ>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Champ label="Prochaine échéance" htmlFor="prochaine_echeance" requis erreur={errors.prochaine_echeance?.message}>
          <Saisie id="prochaine_echeance" type="date" {...register("prochaine_echeance")} />
        </Champ>
        <Champ label="Anticipation (jours)" htmlFor="jours_anticipation" requis>
          <Saisie id="jours_anticipation" type="number" min={0} {...register("jours_anticipation")} />
        </Champ>
        <Champ label="Durée estimée (min)" htmlFor="duree_estimee_min">
          <Saisie id="duree_estimee_min" type="number" min={0} {...register("duree_estimee_min")} />
        </Champ>
      </div>

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

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Checklist</span>
          <button
            type="button"
            onClick={() => append({ libelle: "", obligatoire: true })}
            className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter un point
          </button>
        </div>
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <Saisie placeholder="Point de contrôle" {...register(`checklist.${index}.libelle` as const)} />
              <label className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-500">
                <input type="checkbox" {...register(`checklist.${index}.obligatoire` as const)} />
                Obligatoire
              </label>
              <button type="button" onClick={() => remove(index)} className="text-gray-400 hover:text-danger-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {fields.length === 0 && <p className="text-xs text-gray-400">Aucun point de contrôle défini.</p>}
        </div>
      </div>

      <div className="flex justify-end border-t border-gray-100 pt-4">
        <Bouton type="submit" enCours={enCours}>
          {plan ? "Enregistrer les modifications" : "Créer le plan"}
        </Bouton>
      </div>
    </form>
  );
}
