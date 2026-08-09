"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { modifierRoleUtilisateur } from "@/actions/utilisateurs";
import { ROLES } from "@/lib/constants";
import { Selecteur } from "@/components/ui/Champ";
import type { Role } from "@/lib/types";

export function SelecteurRoleUtilisateur({ profileId, roleActuel }: { profileId: string; roleActuel: Role }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setEnCours(true);
    await modifierRoleUtilisateur(profileId, e.target.value as Role);
    setEnCours(false);
    router.refresh();
  }

  return (
    <Selecteur defaultValue={roleActuel} onChange={onChange} disabled={enCours} className="w-52">
      {ROLES.map((r) => (
        <option key={r.valeur} value={r.valeur}>
          {r.label}
        </option>
      ))}
    </Selecteur>
  );
}
