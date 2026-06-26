// Barre de recherche avec filtres de catégorie et format
"use client";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CATEGORY_LABELS, FORMAT_LABELS, CourseCategory, CourseFormat } from "@/lib/types";

interface SearchBarProps {
  initialQuery?: string;
  initialCategory?: string;
  initialFormat?: string;
  compact?: boolean;
}

export default function SearchBar({
  initialQuery = "",
  initialCategory = "",
  initialFormat = "",
  compact = false,
}: SearchBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [format, setFormat] = useState(initialFormat);
  const [showFilters, setShowFilters] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category) params.set("category", category);
    if (format) params.set("format", format);
    startTransition(() => {
      router.push(`/search?${params.toString()}`);
    });
  };

  const clearFilters = () => {
    setQuery("");
    setCategory("");
    setFormat("");
  };

  const hasActiveFilters = category || format;

  return (
    <form onSubmit={handleSearch} className="w-full">
      <div className={`flex flex-col gap-3 ${compact ? "" : "max-w-3xl mx-auto"}`}>
        {/* Ligne principale : recherche */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher une formation, un domaine..."
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl border transition-colors ${
              showFilters || hasActiveFilters
                ? "bg-primary-50 border-primary-300 text-primary-700"
                : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            <SlidersHorizontal size={18} />
            {!compact && <span className="hidden sm:inline">Filtres</span>}
            {hasActiveFilters && (
              <span className="bg-primary-600 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">
                {(category ? 1 : 0) + (format ? 1 : 0)}
              </span>
            )}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-xl font-medium transition-colors disabled:opacity-70"
          >
            {isPending ? "..." : "Rechercher"}
          </button>
        </div>

        {/* Filtres avancés */}
        {showFilters && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex-1 w-full sm:w-auto">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Domaine
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-gray-900"
              >
                <option value="">Tous les domaines</option>
                {(Object.entries(CATEGORY_LABELS) as [CourseCategory, string][]).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="flex-1 w-full sm:w-auto">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Format
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-gray-900"
              >
                <option value="">Tous les formats</option>
                {(Object.entries(FORMAT_LABELS) as [CourseFormat, string][]).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-500 transition-colors whitespace-nowrap"
              >
                <X size={14} />
                Réinitialiser
              </button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
