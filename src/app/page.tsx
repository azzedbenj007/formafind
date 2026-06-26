// Page d'accueil - Server Component pour le SEO
import Link from "next/link";
import { ArrowRight, Star, Users, Building2, TrendingUp } from "lucide-react";
import SearchBar from "@/components/ui/SearchBar";
import CourseCard from "@/components/ui/CourseCard";
import { mockCourses, mockSchools } from "@/lib/mock-data";
import { CATEGORY_LABELS, CourseCategory } from "@/lib/types";

// Statistiques de la plateforme
const stats = [
  { label: "formations disponibles", value: "500+", icon: TrendingUp },
  { label: "centres partenaires", value: "120+", icon: Building2 },
  { label: "apprenants satisfaits", value: "8 000+", icon: Users },
  { label: "note moyenne", value: "4.7/5", icon: Star },
];

// Catégories mises en avant sur la page d'accueil
const featuredCategories: { key: CourseCategory; emoji: string }[] = [
  { key: "informatique", emoji: "💻" },
  { key: "langues", emoji: "🌍" },
  { key: "commerce", emoji: "📈" },
  { key: "gestion", emoji: "📊" },
  { key: "sante", emoji: "🏥" },
  { key: "art", emoji: "🎨" },
];

export default function HomePage() {
  // Les 6 formations les mieux notées (données mock en attendant Supabase)
  const featuredCourses = mockCourses.slice(0, 6);

  return (
    <div>
      {/* ===== HERO SECTION ===== */}
      <section className="relative bg-gradient-to-br from-primary-900 via-primary-800 to-primary-700 text-white overflow-hidden">
        {/* Motif décoratif */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 rounded-full bg-white blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white/90 text-sm font-medium px-4 py-2 rounded-full mb-6 border border-white/20">
              <Star size={14} className="fill-amber-400 text-amber-400" />
              La marketplace #1 de la formation professionnelle
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              Trouvez la formation{" "}
              <span className="text-amber-400">qui change</span>{" "}
              votre carrière
            </h1>

            <p className="text-lg text-blue-100 mb-10 leading-relaxed">
              Comparez plus de 500 formations certifiantes. Avis vérifiés, prix
              transparents, horaires flexibles. Lancez votre reconversion dès aujourd&apos;hui.
            </p>

            {/* Barre de recherche */}
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
              <SearchBar />
            </div>

            {/* Recherches populaires */}
            <div className="mt-4 flex items-center gap-2 flex-wrap justify-center text-sm text-blue-200">
              <span>Populaire :</span>
              {["React", "Anglais professionnel", "Marketing digital", "Python"].map((s) => (
                <Link
                  key={s}
                  href={`/search?q=${encodeURIComponent(s)}`}
                  className="hover:text-white transition-colors underline underline-offset-2"
                >
                  {s}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== STATISTIQUES ===== */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className="text-center">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-50 mb-2">
                  <Icon size={20} className="text-primary-600" />
                </div>
                <div className="text-2xl font-bold text-gray-900">{value}</div>
                <div className="text-sm text-gray-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CATÉGORIES ===== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Explorer par domaine</h2>
          <Link
            href="/search"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
          >
            Tous les domaines <ArrowRight size={15} />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {featuredCategories.map(({ key, emoji }) => (
            <Link
              key={key}
              href={`/search?category=${key}`}
              className="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border border-gray-100 hover:border-primary-200 hover:shadow-md transition-all group"
            >
              <span className="text-3xl">{emoji}</span>
              <span className="text-xs font-medium text-gray-700 text-center group-hover:text-primary-700 transition-colors">
                {CATEGORY_LABELS[key]}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ===== FORMATIONS EN VEDETTE ===== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-14">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Formations populaires</h2>
          <Link
            href="/search"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
          >
            Voir tout <ArrowRight size={15} />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuredCourses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      </section>

      {/* ===== CTA CENTRES DE FORMATION ===== */}
      <section className="bg-gradient-to-r from-primary-600 to-primary-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-2xl mx-auto text-center">
            <Building2 size={40} className="mx-auto mb-4 text-blue-200" />
            <h2 className="text-3xl font-bold mb-4">
              Vous êtes un centre de formation ?
            </h2>
            <p className="text-blue-100 mb-8 text-lg">
              Rejoignez FormaFind et donnez de la visibilité à vos formations.
              Gérez vos fiches, recevez des leads qualifiés et boostez vos inscriptions.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/auth/register"
                className="bg-white text-primary-700 font-semibold px-8 py-3.5 rounded-xl hover:bg-blue-50 transition-colors"
              >
                Inscrire mon école gratuitement
              </Link>
              <Link
                href="/dashboard"
                className="border border-white/30 text-white font-medium px-8 py-3.5 rounded-xl hover:bg-white/10 transition-colors"
              >
                Voir le dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== ÉCOLES PARTENAIRES ===== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">
          Centres de formation partenaires
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {mockSchools.map((school) => (
            <div
              key={school.id}
              className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-shadow"
            >
              {/* Logo placeholder */}
              <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center mb-4">
                <span className="text-primary-700 font-bold text-lg">
                  {school.name[0]}
                </span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{school.name}</h3>
              <p className="text-sm text-gray-500 mb-3 line-clamp-2">{school.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{school.location}</span>
                {school.is_verified && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    ✓ Vérifié
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
