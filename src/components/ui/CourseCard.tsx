// Carte de formation affichant le résumé d'un cours
import Link from "next/link";
import { Clock, MapPin, Users, CheckCircle, GitCompare } from "lucide-react";
import { Course, FORMAT_LABELS, FORMAT_COLORS, CATEGORY_LABELS } from "@/lib/types";
import StarRating from "./StarRating";
import Badge from "./Badge";

interface CourseCardProps {
  course: Course;
  onCompare?: (course: Course) => void;
  isInComparison?: boolean;
}

export default function CourseCard({
  course,
  onCompare,
  isInComparison = false,
}: CourseCardProps) {
  const formatColor = FORMAT_COLORS[course.format];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-primary-200 transition-all duration-200 flex flex-col overflow-hidden group">
      {/* En-tête de la carte */}
      <div className="p-5 flex-1">
        {/* Badges */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Badge className={formatColor}>
            {FORMAT_LABELS[course.format]}
          </Badge>
          <Badge variant="default">
            {CATEGORY_LABELS[course.category]}
          </Badge>
          {course.school?.is_verified && (
            <Badge variant="success">
              <CheckCircle size={11} />
              Vérifié
            </Badge>
          )}
        </div>

        {/* Titre */}
        <h3 className="font-semibold text-gray-900 text-base leading-snug mb-1 group-hover:text-primary-600 transition-colors line-clamp-2">
          {course.title}
        </h3>

        {/* École */}
        {course.school && (
          <p className="text-sm text-primary-600 font-medium mb-3">
            {course.school.name}
          </p>
        )}

        {/* Description courte */}
        <p className="text-sm text-gray-500 line-clamp-2 mb-4 leading-relaxed">
          {course.description}
        </p>

        {/* Métadonnées */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock size={14} className="text-gray-400 shrink-0" />
            <span>{course.duration}</span>
          </div>
          {course.school?.location && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin size={14} className="text-gray-400 shrink-0" />
              <span>{course.school.location}</span>
            </div>
          )}
          {course.seats_available !== null && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Users size={14} className="text-gray-400 shrink-0" />
              <span>
                {course.seats_available === 0
                  ? <span className="text-red-500 font-medium">Complet</span>
                  : <span className="text-green-600">{course.seats_available} place{course.seats_available > 1 ? "s" : ""} disponible{course.seats_available > 1 ? "s" : ""}</span>}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Pied de carte */}
      <div className="px-5 py-4 bg-gray-50 border-t border-gray-100">
        {/* Note et prix */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {course.avg_rating !== undefined && course.avg_rating > 0 ? (
              <>
                <StarRating rating={course.avg_rating} size="sm" />
                <span className="text-sm font-medium text-gray-700">
                  {course.avg_rating.toFixed(1)}
                </span>
                {course.review_count !== undefined && (
                  <span className="text-xs text-gray-400">
                    ({course.review_count} avis)
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400">Aucun avis</span>
            )}
          </div>
          <div className="text-right">
            <span className="text-xl font-bold text-gray-900">
              {course.price === 0 ? "Gratuit" : `${course.price.toLocaleString("fr-FR")} €`}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Link
            href={`/course/${course.id}`}
            className="flex-1 bg-primary-600 text-white text-sm font-medium py-2 px-4 rounded-lg text-center hover:bg-primary-700 transition-colors"
          >
            Voir la formation
          </Link>
          {onCompare && (
            <button
              onClick={() => onCompare(course)}
              title={isInComparison ? "Retirer de la comparaison" : "Ajouter à la comparaison"}
              className={`p-2 rounded-lg border transition-colors ${
                isInComparison
                  ? "bg-primary-100 border-primary-300 text-primary-700"
                  : "border-gray-200 text-gray-500 hover:border-primary-300 hover:text-primary-600"
              }`}
            >
              <GitCompare size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
