import Link from "next/link";
import { Bell, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { libelleRole } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { SignOutButton } from "./SignOutButton";
import { MenuMobile } from "./MenuMobile";

export function Topbar({ profile, notificationsNonLues = 0 }: { profile: Profile; notificationsNonLues?: number }) {
  const role = libelleRole(profile.role);

  return (
    <header className="flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4 lg:px-6">
      <MenuMobile role={profile.role} />

      <div className="hidden flex-1 items-center gap-2 md:flex">
        <form action="/recherche" method="GET" className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            name="q"
            placeholder="Rechercher un équipement, une intervention..."
            className="w-full rounded-lg border border-gray-300 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </form>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        <Link
          href="/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
          {notificationsNonLues > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger-600" />
          )}
        </Link>

        <div className="hidden items-center gap-2 pl-2 sm:flex">
          <div className="text-right">
            <p className="text-sm font-medium text-gray-900">{profile.nom_complet || profile.email}</p>
            <Badge label={role.label} classe={role.classe} />
          </div>
        </div>

        <SignOutButton />
      </div>
    </header>
  );
}
