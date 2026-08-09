"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, Search } from "lucide-react";
import clsx from "clsx";
import { Selecteur } from "@/components/ui/Champ";
import { PRIORITES, STATUTS_INTERVENTION, TYPES_INTERVENTION } from "@/lib/constants";

export function FiltresInterventions() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [recherche, setRecherche] = useState(searchParams.get("recherche") ?? "");
  const vue = searchParams.get("vue") === "kanban" ? "kanban" : "liste";

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
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Titre, numéro..."
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <Selecteur className="sm:w-44" value={searchParams.get("statut") ?? ""} onChange={(e) => majParam("statut", e.target.value)}>
          <option value="">Tous les statuts</option>
          {STATUTS_INTERVENTION.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {s.label}
            </option>
          ))}
        </Selecteur>

        <Selecteur className="sm:w-44" value={searchParams.get("type") ?? ""} onChange={(e) => majParam("type", e.target.value)}>
          <option value="">Tous les types</option>
          {TYPES_INTERVENTION.map((t) => (
            <option key={t.valeur} value={t.valeur}>
              {t.label}
            </option>
          ))}
        </Selecteur>

        <Selecteur className="sm:w-40" value={searchParams.get("priorite") ?? ""} onChange={(e) => majParam("priorite", e.target.value)}>
          <option value="">Toute priorité</option>
          {PRIORITES.map((p) => (
            <option key={p.valeur} value={p.valeur}>
              {p.label}
            </option>
          ))}
        </Selecteur>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={searchParams.get("en_retard") === "1"}
            onChange={(e) => majParam("en_retard", e.target.checked ? "1" : "")}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          En retard uniquement
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 p-1">
        <button
          onClick={() => majParam("vue", "")}
          className={clsx("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", vue === "liste" ? "bg-primary-50 text-primary-700" : "text-gray-500 hover:bg-gray-100")}
        >
          <List className="h-3.5 w-3.5" /> Liste
        </button>
        <button
          onClick={() => majParam("vue", "kanban")}
          className={clsx("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", vue === "kanban" ? "bg-primary-50 text-primary-700" : "text-gray-500 hover:bg-gray-100")}
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Kanban
        </button>
      </div>
    </div>
  );
}
