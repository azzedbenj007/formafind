"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Bot,
  CalendarClock,
  ClipboardList,
  FileSignature,
  FileText,
  LayoutDashboard,
  Settings,
  Stethoscope,
  Users,
  Wrench,
} from "lucide-react";
import { NAV_PRINCIPALE } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { peutGererUtilisateurs } from "@/lib/permissions";

const ICONES = {
  LayoutDashboard,
  Wrench,
  ClipboardList,
  CalendarClock,
  Users,
  FileText,
  FileSignature,
  Bot,
} as const;

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
      <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
          <Stethoscope className="h-5 w-5" />
        </div>
        <span className="font-semibold text-gray-900">GMAO Hospitalière</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_PRINCIPALE.map((item) => {
          const Icone = ICONES[item.icone];
          const actif = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                actif ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <Icone className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {peutGererUtilisateurs(role) && (
          <>
            <div className="my-2 border-t border-gray-100" />
            <Link
              href="/parametres/utilisateurs"
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/parametres") ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <Settings className="h-4 w-4" />
              Paramètres
            </Link>
          </>
        )}
      </nav>
    </aside>
  );
}
