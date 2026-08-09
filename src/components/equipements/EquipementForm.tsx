"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { schemaEquipement, type ValeursEquipement } from "@/lib/validation/equipement";
import { STATUTS_EQUIPEMENT, CRITICITES } from "@/lib/constants";
import { Champ, Saisie, Selecteur, ZoneTexte } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import type { CategorieEquipement, Equipement, Fournisseur, ServiceHospitalier, Site } from "@/lib/types";

interface Props {
  equipement?: Equipement;
  sites: Site[];
  services: ServiceHospitalier[];
  categories: CategorieEquipement[];
  fournisseurs: Fournisseur[];
  onEnregistrer: (valeurs: ValeursEquipement) => Promise<{ erreur?: string; erreurs_champs?: Record<string, string> } | void>;
}

export function EquipementForm({ equipement, sites, services, categories, fournisseurs, onEnregistrer }: Props) {
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ValeursEquipement>({
    resolver: zodResolver(schemaEquipement),
    defaultValues: equipement
      ? {
          code_interne: equipement.code_interne,
          nom: equipement.nom,
          categorie_id: equipement.categorie_id ?? "",
          numero_serie: equipement.numero_serie ?? "",
          modele: equipement.modele ?? "",
          fabricant: equipement.fabricant ?? "",
          fournisseur_id: equipement.fournisseur_id ?? "",
          site_id: equipement.site_id,
          service_id: equipement.service_id ?? "",
          localisation_precise: equipement.localisation_precise ?? "",
          statut: equipement.statut,
          criticite: equipement.criticite,
          date_achat: equipement.date_achat ?? "",
          date_mise_service: equipement.date_mise_service ?? "",
          fin_garantie: equipement.fin_garantie ?? "",
          cout_acquisition: equipement.cout_acquisition ?? undefined,
          notes: equipement.notes ?? "",
        }
      : { statut: "operationnel", criticite: "moyenne" },
  });

  const siteSelectionne = watch("site_id");
  const servicesFiltres = services.filter((s) => s.site_id === siteSelectionne);

  async function onSubmit(valeurs: ValeursEquipement) {
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
        <h3 className="text-sm font-semibold text-gray-900">Identification</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Code interne" htmlFor="code_interne" requis erreur={errors.code_interne?.message}>
            <Saisie id="code_interne" placeholder="ex. RESP-042" {...register("code_interne")} />
          </Champ>
          <Champ label="Nom de l'équipement" htmlFor="nom" requis erreur={errors.nom?.message}>
            <Saisie id="nom" placeholder="ex. Respirateur Evita V500" {...register("nom")} />
          </Champ>
          <Champ label="Catégorie" htmlFor="categorie_id">
            <Selecteur id="categorie_id" {...register("categorie_id")}>
              <option value="">— Aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </Selecteur>
          </Champ>
          <Champ label="Numéro de série" htmlFor="numero_serie">
            <Saisie id="numero_serie" {...register("numero_serie")} />
          </Champ>
          <Champ label="Modèle" htmlFor="modele">
            <Saisie id="modele" {...register("modele")} />
          </Champ>
          <Champ label="Fabricant" htmlFor="fabricant">
            <Saisie id="fabricant" {...register("fabricant")} />
          </Champ>
          <Champ label="Fournisseur" htmlFor="fournisseur_id">
            <Selecteur id="fournisseur_id" {...register("fournisseur_id")}>
              <option value="">— Aucun —</option>
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom}
                </option>
              ))}
            </Selecteur>
          </Champ>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Localisation</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Site" htmlFor="site_id" requis erreur={errors.site_id?.message}>
            <Selecteur id="site_id" {...register("site_id")}>
              <option value="">— Sélectionner —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </Selecteur>
          </Champ>
          <Champ label="Service" htmlFor="service_id">
            <Selecteur id="service_id" {...register("service_id")} disabled={!siteSelectionne}>
              <option value="">— Aucun —</option>
              {servicesFiltres.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </Selecteur>
          </Champ>
          <Champ label="Localisation précise" htmlFor="localisation_precise" className="sm:col-span-2">
            <Saisie id="localisation_precise" placeholder="ex. Chambre 214, poste 3" {...register("localisation_precise")} />
          </Champ>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">État</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Statut" htmlFor="statut" requis>
            <Selecteur id="statut" {...register("statut")}>
              {STATUTS_EQUIPEMENT.map((s) => (
                <option key={s.valeur} value={s.valeur}>
                  {s.label}
                </option>
              ))}
            </Selecteur>
          </Champ>
          <Champ label="Criticité" htmlFor="criticite" requis>
            <Selecteur id="criticite" {...register("criticite")}>
              {CRITICITES.map((c) => (
                <option key={c.valeur} value={c.valeur}>
                  {c.label}
                </option>
              ))}
            </Selecteur>
          </Champ>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Dates &amp; coûts</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Champ label="Date d'achat" htmlFor="date_achat">
            <Saisie id="date_achat" type="date" {...register("date_achat")} />
          </Champ>
          <Champ label="Mise en service" htmlFor="date_mise_service">
            <Saisie id="date_mise_service" type="date" {...register("date_mise_service")} />
          </Champ>
          <Champ label="Fin de garantie" htmlFor="fin_garantie">
            <Saisie id="fin_garantie" type="date" {...register("fin_garantie")} />
          </Champ>
          <Champ label="Coût d'acquisition (MAD)" htmlFor="cout_acquisition">
            <Saisie id="cout_acquisition" type="number" step="0.01" min={0} {...register("cout_acquisition")} />
          </Champ>
        </div>
      </section>

      <section className="space-y-4">
        <Champ label="Notes" htmlFor="notes">
          <ZoneTexte id="notes" rows={3} {...register("notes")} />
        </Champ>
      </section>

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <Bouton type="submit" enCours={enCours}>
          {equipement ? "Enregistrer les modifications" : "Créer l'équipement"}
        </Bouton>
      </div>
    </form>
  );
}
