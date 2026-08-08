"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function seDeconnecter() {
    await supabase.auth.signOut();
    router.push("/connexion");
    router.refresh();
  }

  return (
    <button
      onClick={seDeconnecter}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
      title="Se déconnecter"
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden sm:inline">Se déconnecter</span>
    </button>
  );
}
