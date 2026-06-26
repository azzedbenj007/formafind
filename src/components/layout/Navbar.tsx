// Navigation principale de l'application
"use client";
import Link from "next/link";
import { GraduationCap, Search, LayoutDashboard, LogIn, Menu, X } from "lucide-react";
import { useState } from "react";

interface NavbarProps {
  userRole?: string | null;
}

export default function Navbar({ userRole }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-primary-700">
            <GraduationCap size={26} className="text-primary-600" />
            <span>FormaFind</span>
          </Link>

          {/* Navigation desktop */}
          <div className="hidden md:flex items-center gap-6">
            <Link
              href="/search"
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-primary-600 transition-colors"
            >
              <Search size={16} />
              Formations
            </Link>
            {userRole === "ecole" || userRole === "admin" ? (
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-primary-600 transition-colors"
              >
                <LayoutDashboard size={16} />
                Dashboard
              </Link>
            ) : null}
          </div>

          {/* Actions desktop */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/auth/login"
              className="text-sm text-gray-600 hover:text-primary-600 transition-colors font-medium"
            >
              Connexion
            </Link>
            <Link
              href="/auth/register"
              className="bg-primary-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors"
            >
              S&apos;inscrire
            </Link>
          </div>

          {/* Bouton menu mobile */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-gray-600"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {/* Menu mobile */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 py-4 space-y-3">
            <Link
              href="/search"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 text-sm text-gray-700 px-2 py-2 rounded-lg hover:bg-gray-50"
            >
              <Search size={16} />
              Formations
            </Link>
            {(userRole === "ecole" || userRole === "admin") && (
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 text-sm text-gray-700 px-2 py-2 rounded-lg hover:bg-gray-50"
              >
                <LayoutDashboard size={16} />
                Dashboard
              </Link>
            )}
            <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
              <Link
                href="/auth/login"
                className="flex items-center gap-2 text-sm text-gray-700 px-2 py-2 rounded-lg hover:bg-gray-50"
              >
                <LogIn size={16} />
                Connexion
              </Link>
              <Link
                href="/auth/register"
                className="bg-primary-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg text-center hover:bg-primary-700"
              >
                S&apos;inscrire gratuitement
              </Link>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
