"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { mettreAJourPhotoEquipement } from "@/actions/equipements";
import { Bouton } from "@/components/ui/Bouton";

export function PhotoUploader({ equipementId }: { equipementId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    setErreur(null);
    setEnCours(true);

    const formData = new FormData();
    formData.set("photo", fichier);
    const resultat = await mettreAJourPhotoEquipement(equipementId, formData);

    setEnCours(false);
    if (resultat?.erreur) {
      setErreur(resultat.erreur);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onChange} />
      <Bouton variante="secondaire" type="button" enCours={enCours} className="w-full" onClick={() => inputRef.current?.click()}>
        <Upload className="h-4 w-4" />
        {enCours ? "Envoi..." : "Changer la photo"}
      </Bouton>
      {erreur && <p className="mt-2 text-xs text-danger-600">{erreur}</p>}
    </div>
  );
}
