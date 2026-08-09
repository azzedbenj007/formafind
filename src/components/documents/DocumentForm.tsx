"use client";

import { useState } from "react";
import { uploaderDocument } from "@/actions/documents";
import { TYPES_DOCUMENT } from "@/lib/constants";
import { Champ, Saisie, Selecteur, ZoneTexte } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";

interface EquipementOption {
  id: string;
  nom: string;
  code_interne: string;
}

interface ContratOption {
  id: string;
  intitule: string;
  reference: string;
}

interface Props {
  equipements: EquipementOption[];
  contrats: ContratOption[];
  equipementIdPreselectionne?: string;
}

export function DocumentForm({ equipements, contrats, equipementIdPreselectionne }: Props) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErreur(null);

    const formData = new FormData(e.currentTarget);
    const titre = String(formData.get("titre") ?? "").trim();
    const typeDocument = String(formData.get("type_document") ?? "");
    const fichier = formData.get("fichier") as File | null;

    if (!titre) {
      setErreur("Le titre est requis.");
      return;
    }
    if (!typeDocument) {
      setErreur("Le type de document est requis.");
      return;
    }
    if (!fichier || fichier.size === 0) {
      setErreur("Veuillez sélectionner un fichier.");
      return;
    }

    setEnCours(true);
    const resultat = await uploaderDocument(formData);
    setEnCours(false);
    if (resultat?.erreur) setErreur(resultat.erreur);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {erreur && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreur}</p>}

      <Champ label="Titre" htmlFor="titre" requis>
        <Saisie id="titre" name="titre" placeholder="ex. Manuel d'utilisation Evita V500" required />
      </Champ>

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Type de document" htmlFor="type_document" requis>
          <Selecteur id="type_document" name="type_document" defaultValue="" required>
            <option value="" disabled>
              — Sélectionner —
            </option>
            {TYPES_DOCUMENT.map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.label}
              </option>
            ))}
          </Selecteur>
        </Champ>

        <Champ label="Tags" htmlFor="tags">
          <Saisie id="tags" name="tags" placeholder="ex. urgence, electrique" />
          <p className="mt-1 text-xs text-gray-400">Séparez les tags par une virgule.</p>
        </Champ>
      </div>

      <Champ label="Description" htmlFor="description">
        <ZoneTexte id="description" name="description" rows={3} />
      </Champ>

      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Équipement lié" htmlFor="equipement_id">
          <Selecteur id="equipement_id" name="equipement_id" defaultValue={equipementIdPreselectionne ?? ""}>
            <option value="">— Aucun —</option>
            {equipements.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.nom} ({eq.code_interne})
              </option>
            ))}
          </Selecteur>
        </Champ>

        <Champ label="Contrat lié" htmlFor="contrat_id">
          <Selecteur id="contrat_id" name="contrat_id" defaultValue="">
            <option value="">— Aucun —</option>
            {contrats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.intitule} ({c.reference})
              </option>
            ))}
          </Selecteur>
        </Champ>
      </div>

      <Champ label="Fichier" htmlFor="fichier" requis>
        <input
          id="fichier"
          name="fichier"
          type="file"
          required
          className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
        />
      </Champ>

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <Bouton type="submit" enCours={enCours}>
          Envoyer le document
        </Bouton>
      </div>
    </form>
  );
}
