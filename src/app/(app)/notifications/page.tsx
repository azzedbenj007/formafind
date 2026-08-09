import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/auth";
import { EtatVide } from "@/components/ui/Carte";
import { NotificationLigne } from "@/components/notifications/NotificationLigne";
import { BoutonToutMarquerLu } from "@/components/notifications/BoutonToutMarquerLu";
import type { Notification } from "@/lib/types";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");

  const supabase = await createServerSupabaseClient();
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("*")
    .or(`profile_id.eq.${profile.id},role_cible.eq.${profile.role}`)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500">Alertes de maintenance préventive, retards et échéances de contrats.</p>
        </div>
        {notifications && notifications.some((n) => !n.lu) && <BoutonToutMarquerLu />}
      </div>

      {error && <p className="text-sm text-danger-600">Erreur de chargement : {error.message}</p>}

      {notifications && notifications.length > 0 ? (
        <div className="space-y-2">
          {(notifications as Notification[]).map((n) => (
            <NotificationLigne key={n.id} notification={n} />
          ))}
        </div>
      ) : (
        <EtatVide titre="Aucune notification" description="Vous êtes à jour." />
      )}
    </div>
  );
}
