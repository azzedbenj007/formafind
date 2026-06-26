// Page de comparaison côte à côte des formations
import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, ArrowLeft } from "lucide-react";
import { mockCourses } from "@/lib/mock-data";
import { FORMAT_LABELS, CATEGORY_LABELS } from "@/lib/types";
import StarRating from "@/components/ui/StarRating";

interface Props {
  searchParams: Promise<{ ids?: string }>;
}

export const metadata: Metadata = {
  title: "Comparer des formations",
};

export default async function ComparePage({ searchParams }: Props) {
  const { ids = "" } = await searchParams;
  const idList = ids.split(",").filter(Boolean).slice(0, 3);

  const courses = idList
    .map((id) => mockCourses.find((c) => c.id === id))
    .filter(Boolean) as (typeof mockCourses)[0][];

  if (courses.length < 2) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">⚖️</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Comparaison de formations
        </h1>
        <p className="text-gray-500 mb-6">
          Sélectionnez au moins 2 formations depuis la page de recherche pour les comparer.
        </p>
        <Link
          href="/search"
          className="inline-flex items-center gap-2 bg-primary-600 text-white font-medium px-6 py-3 rounded-xl hover:bg-primary-700 transition-colors"
        >
          <ArrowLeft size={16} />
          Retour à la recherche
        </Link>
      </div>
    );
  }

  // Lignes de comparaison
  const rows = [
    { label: "Prix", key: "price", render: (c: (typeof courses)[0]) => `${c.price.toLocaleString("fr-FR")} €` },
    { label: "Durée", key: "duration", render: (c: (typeof courses)[0]) => c.duration },
    { label: "Format", key: "format", render: (c: (typeof courses)[0]) => FORMAT_LABELS[c.format] },
    { label: "Domaine", key: "category", render: (c: (typeof courses)[0]) => CATEGORY_LABELS[c.category] },
    { label: "Horaires", key: "schedule_details", render: (c: (typeof courses)[0]) => c.schedule_details },
    { label: "Prérequis", key: "prerequisites", render: (c: (typeof courses)[0]) => c.prerequisites || "Aucun" },
    { label: "Certification", key: "certification", render: (c: (typeof courses)[0]) => c.certification || "Non certifiante" },
    { label: "Places dispo.", key: "seats_available", render: (c: (typeof courses)[0]) => c.seats_available === null ? "Illimité" : c.seats_available === 0 ? "Complet" : `${c.seats_available} places` },
    { label: "École vérifiée", key: "is_verified", render: (c: (typeof courses)[0]) => c.school?.is_verified ? <Check size={18} className="text-green-600 mx-auto" /> : <X size={18} className="text-gray-300 mx-auto" /> },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link
          href="/search"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary-600 transition-colors"
        >
          <ArrowLeft size={16} />
          Retour à la recherche
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-8">
        Comparaison de {courses.length} formations
      </h1>

      {/* Tableau de comparaison */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          {/* En-têtes des formations */}
          <thead>
            <tr>
              <th className="w-44 p-4 text-left text-sm font-semibold text-gray-500 bg-gray-50 rounded-tl-xl">
                Critère
              </th>
              {courses.map((course, i) => (
                <th key={course.id} className={`p-4 text-left bg-white border-x border-t border-gray-100 ${i === courses.length - 1 ? "rounded-tr-xl" : ""}`}>
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-gray-900 text-sm leading-snug">
                      {course.title}
                    </span>
                    {course.school && (
                      <span className="text-xs text-primary-600">{course.school.name}</span>
                    )}
                    {course.avg_rating !== undefined && course.avg_rating > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        <StarRating rating={course.avg_rating} size="sm" />
                        <span className="text-xs text-gray-500">{course.avg_rating.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Corps du tableau */}
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={row.key} className={rowIdx % 2 === 0 ? "bg-gray-50/50" : "bg-white"}>
                <td className="p-4 text-sm font-medium text-gray-600 bg-gray-50/80">
                  {row.label}
                </td>
                {courses.map((course) => (
                  <td key={course.id} className="p-4 text-sm text-gray-800 border-x border-gray-100 text-center">
                    {row.render(course)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>

          {/* Pied : boutons CTA */}
          <tfoot>
            <tr>
              <td className="p-4 bg-gray-50 rounded-bl-xl" />
              {courses.map((course, i) => (
                <td key={course.id} className={`p-4 bg-white border-x border-b border-gray-100 ${i === courses.length - 1 ? "rounded-br-xl" : ""}`}>
                  <Link
                    href={`/course/${course.id}`}
                    className="block text-center bg-primary-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    Voir la formation
                  </Link>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
