"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { schemaContrat, type ValeursContrat } from "@/lib/validation/contrat";
import { TYPES_CONTRAT, STATUTS_CONTRAT } from "@/lib/constants";
import { Champ, Etiquette, Saisie, Selecteur, ZoneTexte } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import type { Contrat, Fournisseur } from "@/lib/types";

interface EquipementOption {
  id: string;
  nom: string;
  code_interne: string;
}

interface Props {
  contrat?: Contrat;
  fournisseurs: Fournisseur[];
  equipements: EquipementOption[];
  equipementsCouvertsIds?: string[];
  onEnregistrer: (
    valeurs: ValeursContrat,
    equipementIds: string[]
  ) => Promise<{ erreur?: string; erreurs_champs?: Record<string, string> } | void>;
}

export function ContratForm({ contrat, fournisseurs, equipements, equipementsCouvertsIds = [], onEnregistrer }: Props) {
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [equipementsSelectionnes, setEquipementsSelectionnes] = useState<string[]>(equipementsCouvertsIds);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ValeursContrat>({
    resolver: zodResolver(schemaContrat),
    defaultValues: contrat
      ? {
          reference: contrat.reference,
          intitule: contrat.intitule,
          fournisseur_id: contrat.fournisseur_id,
          type_contrat: contrat.type_contrat,
          date_debut: contrat.date_debut,
          date_fin: contrat.date_fin,
          cout_annuel: contrat.cout_annuel ?? undefined,
          delai_intervention_heures: contrat.delai_intervention_heures ?? undefined,
          couverture_horaire: contrat.couverture_horaire ?? "",
          conditions: contrat.conditions ?? "",
          tacite_reconduction: contrat.tacite_reconduction,
          preavis_jours: contrat.preavis_jours ?? 90,
          statut: contrat.statut,
        }
      : { statut: "actif", tacite_reconduction: false, preavis_jours: 90 },
  });

  function basculerEquipement(id: string) {
    setEquipementsSelectionnes((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  }

  async function onSubmit(valeurs: ValeursContrat) {
    setErreurGlobale(null);
    setEnCours(true);
    const resultat = await onEnregistrer(valeurs, equipementsSelectionnes);
    setEnCours(false);
    if (resultat?.erreur) setErreurGlobale(resultat.erreur);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {erreurGlobale && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreurGlobale}</p>}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Identification</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Référence" htmlFor="reference" requis erreur={errors.reference?.message}>
            <Saisie id="reference" placeholder="ex. CTR-2026-014" {...register("reference")} />
          </Champ>
          <Champ label="Intitulé" htmlFor="intitule" requis erreur={errors.intitule?.message}>
            <Saisie id="intitule" placeholder="ex. Maintenance des respirateurs" {...register("intitule")} />
          </Champ>
          <Champ label="Fournisseur" htmlFor="fournisseur_id" requis erreur={errors.fournisseur_id?.message}>
            <Selecteur id="fournisseur_id" {...register("fournisseur_id")}>
              <option value="">— Sélectionner —</option>
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom}
                </option>
              ))}
            </Selecteur>
          </Champ>
          <Champ label="Type de contrat" htmlFor="type_contrat" requis>
            <Selecteur id="type_contrat" {...register("type_contrat")}>
              {TYPES_CONTRAT.map((t) => (
                <option key={t.valeur} value={t.valeur}>
                  {t.label}
                </option>
              ))}
            </Selecteur>
          </Champ>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Durée &amp; statut</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Champ label="Date de début" htmlFor="date_debut" requis erreur={errors.date_debut?.message}>
            <Saisie id="date_debut" type="date" {...register("date_debut")} />
          </Champ>
          <Champ label="Date de fin" htmlFor="date_fin" requis erreur={errors.date_fin?.message}>
            <Saisie id="date_fin" type="date" {...register("date_fin")} />
          </Champ>
          <Champ label="Statut" htmlFor="statut" requis>
            <Selecteur id="statut" {...register("statut")}>
              {STATUTS_CONTRAT.map((s) => (
                <option key={s.valeur} value={s.valeur}>
                  {s.label}
                </option>
              ))}
            </Selecteur>
          </Champ>
          <Champ label="Préavis (jours)" htmlFor="preavis_jours">
            <Saisie id="preavis_jours" type="number" min={0} {...register("preavis_jours")} />
          </Champ>
          <div className="flex items-center gap-2 pt-6">
            <input
              id="tacite_reconduction"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              {...register("tacite_reconduction")}
            />
            <Etiquette htmlFor="tacite_reconduction" className="mb-0">
              Tacite reconduction
            </Etiquette>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Conditions</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Coût annuel (MAD)" htmlFor="cout_annuel">
            <Saisie id="cout_annuel" type="number" step="0.01" min={0} {...register("cout_annuel")} />
          </Champ>
          <Champ label="Délai d'intervention (heures)" htmlFor="delai_intervention_heures">
            <Saisie id="delai_intervention_heures" type="number" min={0} {...register("delai_intervention_heures")} />
          </Champ>
          <Champ label="Couverture horaire" htmlFor="couverture_horaire" className="sm:col-span-2">
            <Saisie id="couverture_horaire" placeholder="ex. 8h-18h du lundi au vendredi" {...register("couverture_horaire")} />
          </Champ>
          <Champ label="Conditions particulières" htmlFor="conditions" className="sm:col-span-2">
            <ZoneTexte id="conditions" rows={3} {...register("conditions")} />
          </Champ>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Équipements couverts</h3>
        {equipements.length > 0 ? (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-3">
            {equipements.map((eq) => (
              <label key={eq.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  checked={equipementsSelectionnes.includes(eq.id)}
                  onChange={() => basculerEquipement(eq.id)}
                />
                <span className="text-gray-800">{eq.nom}</span>
                <span className="text-xs text-gray-400">({eq.code_interne})</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Aucun équipement disponible.</p>
        )}
      </section>

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <Bouton type="submit" enCours={enCours}>
          {contrat ? "Enregistrer les modifications" : "Créer le contrat"}
        </Bouton>
      </div>
    </form>
  );
}
