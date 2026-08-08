import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { ChatPanel } from "@/components/chat/ChatPanel";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  // Filet défensif : le middleware protège déjà ces routes, mais un profil
  // manquant (ex. trigger d'inscription non encore exécuté) doit renvoyer
  // vers la connexion plutôt que de planter le rendu.
  if (!profile) {
    redirect("/connexion");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar role={profile.role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar profile={profile} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
      <ChatPanel profile={profile} />
    </div>
  );
}
