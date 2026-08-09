import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { peutGererReferentiels, peutGererUtilisateurs } from "@/lib/permissions";
import { Carte } from "@/components/ui/Carte";
import { ProfilForm } from "@/components/parametres/ProfilForm";

export const metadata = { title: "Paramètres" };

export default async function ParametresPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Paramètres</h1>
        <p className="text-sm text-gray-500">Votre profil et l&apos;administration de la GMAO.</p>
      </div>

      <Carte>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Mon profil</h2>
        <ProfilForm profile={profile} />
      </Carte>

      {(peutGererUtilisateurs(profile.role) || peutGererReferentiels(profile.role)) && (
        <Carte>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Administration</h2>
          <div className="space-y-2 text-sm">
            {peutGererUtilisateurs(profile.role) && (
              <Link href="/parametres/utilisateurs" className="block text-primary-600 hover:underline">
                Gérer les utilisateurs et leurs rôles
              </Link>
            )}
            {peutGererReferentiels(profile.role) && (
              <Link href="/parametres/referentiels" className="block text-primary-600 hover:underline">
                Gérer les référentiels (sites, services, catégories)
              </Link>
            )}
            {peutGererReferentiels(profile.role) && (
              <Link href="/fournisseurs" className="block text-primary-600 hover:underline">
                Gérer les fournisseurs
              </Link>
            )}
            {peutGererUtilisateurs(profile.role) && (
              <Link href="/parametres/audit" className="block text-primary-600 hover:underline">
                Journal d&apos;audit
              </Link>
            )}
          </div>
        </Carte>
      )}
    </div>
  );
}
