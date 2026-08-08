// Client Supabase avec la clé service_role — contourne le RLS.
// SERVEUR UNIQUEMENT. Réservé aux routes /api/cron/* (protégées par
// CRON_SECRET) qui doivent agir sur l'ensemble des données sans contexte
// utilisateur. Ne jamais importer ce fichier depuis un composant "use client"
// ni depuis un Server Action déclenché directement par une requête utilisateur.
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
