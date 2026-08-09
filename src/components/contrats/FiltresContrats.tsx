"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Selecteur } from "@/components/ui/Champ";
import { STATUTS_CONTRAT } from "@/lib/constants";

export function FiltresContrats() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function majStatut(valeur: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (valeur) params.set("statut", valeur);
    else params.delete("statut");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Selecteur className="sm:w-56" value={searchParams.get("statut") ?? ""} onChange={(e) => majStatut(e.target.value)}>
      <option value="">Tous les statuts</option>
      {STATUTS_CONTRAT.map((s) => (
        <option key={s.valeur} value={s.valeur}>
          {s.label}
        </option>
      ))}
    </Selecteur>
  );
}
