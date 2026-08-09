"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Selecteur } from "@/components/ui/Champ";
import { STATUTS_EQUIPEMENT, CRITICITES } from "@/lib/constants";
import type { CategorieEquipement, ServiceHospitalier } from "@/lib/types";

export function FiltresEquipements({
  services,
  categories,
}: {
  services: ServiceHospitalier[];
  categories: CategorieEquipement[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [recherche, setRecherche] = useState(searchParams.get("recherche") ?? "");

  const majParam = useCallback(
    (cle: string, valeur: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (valeur) params.set(cle, valeur);
      else params.delete(cle);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  useEffect(() => {
    const delai = setTimeout(() => {
      if (recherche !== (searchParams.get("recherche") ?? "")) majParam("recherche", recherche);
    }, 350);
    return () => clearTimeout(delai);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recherche]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Nom, code interne, n° de série..."
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <Selecteur
        className="sm:w-48"
        value={searchParams.get("statut") ?? ""}
        onChange={(e) => majParam("statut", e.target.value)}
      >
        <option value="">Tous les statuts</option>
        {STATUTS_EQUIPEMENT.map((s) => (
          <option key={s.valeur} value={s.valeur}>
            {s.label}
          </option>
        ))}
      </Selecteur>

      <Selecteur
        className="sm:w-40"
        value={searchParams.get("criticite") ?? ""}
        onChange={(e) => majParam("criticite", e.target.value)}
      >
        <option value="">Toute criticité</option>
        {CRITICITES.map((c) => (
          <option key={c.valeur} value={c.valeur}>
            {c.label}
          </option>
        ))}
      </Selecteur>

      <Selecteur
        className="sm:w-48"
        value={searchParams.get("service") ?? ""}
        onChange={(e) => majParam("service", e.target.value)}
      >
        <option value="">Tous les services</option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nom}
          </option>
        ))}
      </Selecteur>

      <Selecteur
        className="sm:w-48"
        value={searchParams.get("categorie") ?? ""}
        onChange={(e) => majParam("categorie", e.target.value)}
      >
        <option value="">Toutes catégories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nom}
          </option>
        ))}
      </Selecteur>
    </div>
  );
}
