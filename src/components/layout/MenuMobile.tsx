"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Menu, Stethoscope, X } from "lucide-react";
import { NAV_PRINCIPALE } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { peutGererUtilisateurs } from "@/lib/permissions";

export function MenuMobile({ role }: { role: Role }) {
  const [ouvert, setOuvert] = useState(false);
  const pathname = usePathname();

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOuvert(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
        aria-label="Ouvrir le menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {ouvert && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setOuvert(false)} />
          <div className="relative flex w-64 flex-col bg-white">
            <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
                  <Stethoscope className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold text-gray-900">GMAO Hospitalière</span>
              </div>
              <button onClick={() => setOuvert(false)} aria-label="Fermer le menu">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {NAV_PRINCIPALE.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOuvert(false)}
                  className={clsx(
                    "block rounded-lg px-3 py-2 text-sm font-medium",
                    pathname.startsWith(item.href) ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:bg-gray-100"
                  )}
                >
                  {item.label}
                </Link>
              ))}
              {peutGererUtilisateurs(role) && (
                <Link
                  href="/parametres/utilisateurs"
                  onClick={() => setOuvert(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  Paramètres
                </Link>
              )}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
