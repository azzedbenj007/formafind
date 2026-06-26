// Pied de page de l'application
import Link from "next/link";
import { GraduationCap } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-2 text-white font-bold text-xl mb-3">
              <GraduationCap size={24} />
              FormaFind
            </Link>
            <p className="text-sm text-gray-400 leading-relaxed max-w-xs">
              La marketplace de la formation professionnelle. Trouvez et comparez
              facilement les meilleures formations adaptées à votre projet.
            </p>
          </div>

          {/* Liens apprenants */}
          <div>
            <h3 className="text-white font-semibold text-sm mb-4">Apprenants</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/search" className="hover:text-white transition-colors">Toutes les formations</Link></li>
              <li><Link href="/search?category=informatique" className="hover:text-white transition-colors">Informatique & Tech</Link></li>
              <li><Link href="/search?category=langues" className="hover:text-white transition-colors">Langues</Link></li>
              <li><Link href="/search?category=commerce" className="hover:text-white transition-colors">Commerce & Marketing</Link></li>
            </ul>
          </div>

          {/* Liens centres */}
          <div>
            <h3 className="text-white font-semibold text-sm mb-4">Centres de formation</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/auth/register" className="hover:text-white transition-colors">Inscrire mon école</Link></li>
              <li><Link href="/dashboard" className="hover:text-white transition-colors">Tableau de bord</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-gray-500">
          <p>© {new Date().getFullYear()} FormaFind. Tous droits réservés.</p>
          <div className="flex gap-4">
            <Link href="#" className="hover:text-gray-300 transition-colors">Mentions légales</Link>
            <Link href="#" className="hover:text-gray-300 transition-colors">Confidentialité</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
