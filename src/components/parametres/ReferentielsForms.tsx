"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { creerCategorie, creerService, creerSite } from "@/actions/referentiels";
import { Saisie, Selecteur } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import type { Site } from "@/lib/types";

export function FormulaireSite() {
  const router = useRouter();
  const [nom, setNom] = useState("");
  const [ville, setVille] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);
    const resultat = await creerSite(nom, ville);
    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
      return;
    }
    setNom("");
    setVille("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <Saisie placeholder="Nom du site" value={nom} onChange={(e) => setNom(e.target.value)} className="w-48" />
      <Saisie placeholder="Ville" value={ville} onChange={(e) => setVille(e.target.value)} className="w-40" />
      <Bouton type="submit" variante="secondaire" enCours={enCours}>
        Ajouter
      </Bouton>
      {erreur && <p className="w-full text-xs text-danger-600">{erreur}</p>}
    </form>
  );
}

export function FormulaireService({ sites }: { sites: Site[] }) {
  const router = useRouter();
  const [siteId, setSiteId] = useState("");
  const [nom, setNom] = useState("");
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);
    const resultat = await creerService(siteId, nom, code);
    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
      return;
    }
    setNom("");
    setCode("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <Selecteur value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-48">
        <option value="">— Site —</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nom}
          </option>
        ))}
      </Selecteur>
      <Saisie placeholder="Nom du service" value={nom} onChange={(e) => setNom(e.target.value)} className="w-48" />
      <Saisie placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} className="w-24" />
      <Bouton type="submit" variante="secondaire" enCours={enCours}>
        Ajouter
      </Bouton>
      {erreur && <p className="w-full text-xs text-danger-600">{erreur}</p>}
    </form>
  );
}

export function FormulaireCategorie() {
  const router = useRouter();
  const [nom, setNom] = useState("");
  const [famille, setFamille] = useState("biomedical");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);
    const resultat = await creerCategorie(nom, famille);
    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
      return;
    }
    setNom("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <Saisie placeholder="Nom de la catégorie" value={nom} onChange={(e) => setNom(e.target.value)} className="w-48" />
      <Selecteur value={famille} onChange={(e) => setFamille(e.target.value)} className="w-40">
        <option value="biomedical">Biomédical</option>
        <option value="technique">Technique</option>
        <option value="informatique">Informatique</option>
        <option value="autre">Autre</option>
      </Selecteur>
      <Bouton type="submit" variante="secondaire" enCours={enCours}>
        Ajouter
      </Bouton>
      {erreur && <p className="w-full text-xs text-danger-600">{erreur}</p>}
    </form>
  );
}
