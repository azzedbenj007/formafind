// Page de recherche avec filtres avancés - Server Component
import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import SearchBar from "@/components/ui/SearchBar";
import CourseCard from "@/components/ui/CourseCard";
import { mockCourses } from "@/lib/mock-data";
import { Course, CourseCategory, CourseFormat, CATEGORY_LABELS } from "@/lib/types";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    format?: string;
    minPrice?: string;
    maxPrice?: string;
    sortBy?: string;
  }>;
}

export const metadata: Metadata = {
  title: "Rechercher des formations",
  description: "Recherchez et filtrez parmi toutes les formations disponibles sur FormaFind.",
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const filters = await searchParams;
  const { q = "", category = "", format = "", minPrice, maxPrice, sortBy = "rating" } = filters;

  // Filtrage côté serveur (en production : requête Supabase filtrée)
  let results: Course[] = mockCourses;

  if (q) {
    const lq = q.toLowerCase();
    results = results.filter(
      (c) =>
        c.title.toLowerCase().includes(lq) ||
        c.description.toLowerCase().includes(lq) ||
        c.school?.name.toLowerCase().includes(lq)
    );
  }

  if (category) {
    results = results.filter((c) => c.category === category);
  }

  if (format) {
    results = results.filter((c) => c.format === format);
  }

  if (minPrice) {
    results = results.filter((c) => c.price >= parseFloat(minPrice));
  }

  if (maxPrice) {
    results = results.filter((c) => c.price <= parseFloat(maxPrice));
  }

  // Tri
  if (sortBy === "price_asc") results.sort((a, b) => a.price - b.price);
  else if (sortBy === "price_desc") results.sort((a, b) => b.price - a.price);
  else if (sortBy === "newest") results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  else results.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));

  const hasFilters = q || category || format || minPrice || maxPrice;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* En-tête de recherche */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          {q ? `Résultats pour "${q}"` : category ? `Formations en ${CATEGORY_LABELS[category as CourseCategory]}` : "Toutes les formations"}
        </h1>
        <SearchBar
          initialQuery={q}
          initialCategory={category}
          initialFormat={format}
          compact
        />
      </div>

      {/* Résultats */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{results.length}</span>{" "}
          formation{results.length !== 1 ? "s" : ""} trouvée{results.length !== 1 ? "s" : ""}
          {hasFilters && " avec vos filtres"}
        </p>

        {/* Tri */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-gray-400" />
          <select
            defaultValue={sortBy}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-gray-700"
            onChange={(e) => {
              const url = new URL(window.location.href);
              url.searchParams.set("sortBy", e.target.value);
              window.location.href = url.toString();
            }}
          >
            <option value="rating">Mieux notées</option>
            <option value="price_asc">Prix croissant</option>
            <option value="price_desc">Prix décroissant</option>
            <option value="newest">Plus récentes</option>
          </select>
        </div>
      </div>

      {results.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {results.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Aucune formation trouvée
          </h3>
          <p className="text-gray-500 mb-6">
            Essayez d&apos;élargir vos critères de recherche ou de modifier vos filtres.
          </p>
        </div>
      )}
    </div>
  );
}
