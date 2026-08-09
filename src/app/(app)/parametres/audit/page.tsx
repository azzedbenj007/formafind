import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererUtilisateurs } from "@/lib/permissions";
import { Carte, EtatVide } from "@/components/ui/Carte";

export const metadata = { title: "Journal d'audit" };

const LIBELLES_ACTION: Record<string, string> = { INSERT: "Création", UPDATE: "Modification", DELETE: "Suppression" };
const LIBELLES_TABLE: Record<string, string> = {
  equipements: "Équipement",
  interventions: "Intervention",
  contrats: "Contrat",
  profiles: "Profil utilisateur",
};

export default async function JournalAuditPage() {
  const profile = await getCurrentProfile();
  if (!peutGererUtilisateurs(profile?.role)) redirect("/tableau-de-bord");

  const supabase = await createServerSupabaseClient();
  const { data: entrees, error } = await supabase
    .from("journal_audit")
    .select("*, profiles:profile_id(nom_complet, email)")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Journal d&apos;audit</h1>
        <p className="text-sm text-gray-500">Traçabilité des créations, modifications et suppressions sur les données sensibles.</p>
      </div>

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      {entrees && entrees.length > 0 ? (
        <Carte className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Utilisateur</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Table</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entrees.map((e) => {
                const auteur = (e as unknown as { profiles: { nom_complet: string | null; email: string } | null }).profiles;
                return (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 text-gray-500">{new Date(e.created_at).toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2.5 text-gray-700">{auteur?.nom_complet || auteur?.email || "Système"}</td>
                    <td className="px-4 py-2.5 text-gray-700">{LIBELLES_ACTION[e.action] || e.action}</td>
                    <td className="px-4 py-2.5 text-gray-700">{LIBELLES_TABLE[e.table_concernee] || e.table_concernee}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Carte>
      ) : (
        <EtatVide titre="Aucune entrée" description="Le journal d'audit est vide pour le moment." />
      )}
    </div>
  );
}
