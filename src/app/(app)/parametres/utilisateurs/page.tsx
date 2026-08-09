import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererUtilisateurs } from "@/lib/permissions";
import { Carte } from "@/components/ui/Carte";
import { SelecteurRoleUtilisateur } from "@/components/parametres/SelecteurRoleUtilisateur";
import type { Profile } from "@/lib/types";

export const metadata = { title: "Utilisateurs" };

export default async function UtilisateursPage() {
  const profile = await getCurrentProfile();
  if (!peutGererUtilisateurs(profile?.role)) redirect("/tableau-de-bord");

  const supabase = await createServerSupabaseClient();
  const { data: utilisateurs, error } = await supabase.from("profiles").select("*").order("nom_complet");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Utilisateurs</h1>
        <p className="text-sm text-gray-500">Attribuez un rôle à chaque compte. Par défaut, un nouveau compte est en lecture seule.</p>
      </div>

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      <Carte className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rôle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(utilisateurs as Profile[] | null)?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2.5 text-gray-800">{u.nom_complet || "—"}</td>
                <td className="px-4 py-2.5 text-gray-500">{u.email}</td>
                <td className="px-4 py-2.5">
                  <SelecteurRoleUtilisateur profileId={u.id} roleActuel={u.role} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Carte>
    </div>
  );
}
