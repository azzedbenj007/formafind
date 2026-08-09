"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { marquerToutesLues } from "@/actions/notifications";
import { Bouton } from "@/components/ui/Bouton";

export function BoutonToutMarquerLu() {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);

  async function onClick() {
    setEnCours(true);
    await marquerToutesLues();
    setEnCours(false);
    router.refresh();
  }

  return (
    <Bouton variante="secondaire" onClick={onClick} enCours={enCours}>
      Tout marquer comme lu
    </Bouton>
  );
}
