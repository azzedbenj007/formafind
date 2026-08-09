"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Selecteur } from "@/components/ui/Champ";
import { TYPES_DOCUMENT } from "@/lib/constants";

export function FiltresDocuments() {
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
          placeholder="Rechercher par titre..."
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <Selecteur className="sm:w-56" value={searchParams.get("type") ?? ""} onChange={(e) => majParam("type", e.target.value)}>
        <option value="">Tous les types</option>
        {TYPES_DOCUMENT.map((t) => (
          <option key={t.valeur} value={t.valeur}>
            {t.label}
          </option>
        ))}
      </Selecteur>
    </div>
  );
}
