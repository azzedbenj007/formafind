// Page détaillée d'une formation - Server Component
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Clock, MapPin, Users, CheckCircle, Award, Calendar,
  BookOpen, ArrowLeft, Building2, Star,
} from "lucide-react";
import { mockCourses, mockReviews } from "@/lib/mock-data";
import { FORMAT_LABELS, FORMAT_COLORS, CATEGORY_LABELS } from "@/lib/types";
import StarRating from "@/components/ui/StarRating";
import Badge from "@/components/ui/Badge";
import ReviewCard from "@/components/ui/ReviewCard";
import LeadForm from "@/components/forms/LeadForm";
import ReviewForm from "@/components/forms/ReviewForm";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const course = mockCourses.find((c) => c.id === id);
  if (!course) return { title: "Formation introuvable" };
  return {
    title: course.title,
    description: course.description.slice(0, 160),
  };
}

export default async function CourseDetailPage({ params }: Props) {
  const { id } = await params;

  // En production : requête Supabase avec JOIN school + reviews
  const course = mockCourses.find((c) => c.id === id);
  if (!course) notFound();

  const reviews = mockReviews.filter((r) => r.course_id === id);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Fil d'Ariane */}
      <nav className="mb-6">
        <Link
          href="/search"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary-600 transition-colors"
        >
          <ArrowLeft size={16} />
          Retour aux formations
        </Link>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ===== CONTENU PRINCIPAL (2/3) ===== */}
        <div className="lg:col-span-2 space-y-6">
          {/* En-tête de la formation */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 lg:p-8">
            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge className={FORMAT_COLORS[course.format]}>
                {FORMAT_LABELS[course.format]}
              </Badge>
              <Badge variant="default">
                {CATEGORY_LABELS[course.category]}
              </Badge>
              {course.school?.is_verified && (
                <Badge variant="success">
                  <CheckCircle size={11} />
                  École vérifiée
                </Badge>
              )}
            </div>

            <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-3">
              {course.title}
            </h1>

            {/* École */}
            {course.school && (
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={16} className="text-gray-400" />
                <span className="text-primary-600 font-medium">
                  {course.school.name}
                </span>
                <span className="text-gray-400">•</span>
                <MapPin size={14} className="text-gray-400" />
                <span className="text-gray-600 text-sm">{course.school.location}</span>
              </div>
            )}

            {/* Note globale */}
            {course.avg_rating !== undefined && course.avg_rating > 0 && (
              <div className="flex items-center gap-3 mb-6 p-3 bg-amber-50 rounded-xl border border-amber-100 w-fit">
                <StarRating rating={course.avg_rating} size="md" />
                <span className="font-bold text-gray-900">{course.avg_rating.toFixed(1)}</span>
                <span className="text-sm text-gray-500">
                  ({course.review_count} avis)
                </span>
              </div>
            )}

            <p className="text-gray-600 leading-relaxed">{course.description}</p>
          </div>

          {/* Informations clés */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-900 text-lg mb-4">
              Informations pratiques
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem icon={Clock} label="Durée" value={course.duration} />
              <InfoItem icon={Calendar} label="Horaires" value={course.schedule_details} />
              {course.prerequisites && (
                <InfoItem icon={BookOpen} label="Prérequis" value={course.prerequisites} />
              )}
              {course.certification && (
                <InfoItem icon={Award} label="Certification" value={course.certification} />
              )}
              {course.seats_available !== null && (
                <InfoItem
                  icon={Users}
                  label="Places disponibles"
                  value={
                    course.seats_available === 0
                      ? "Complet"
                      : `${course.seats_available} place${course.seats_available > 1 ? "s" : ""}`
                  }
                  highlight={course.seats_available > 0}
                />
              )}
            </div>
          </div>

          {/* Informations sur l'école */}
          {course.school && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 text-lg mb-4">
                À propos de l&apos;école
              </h2>
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center">
                  <span className="text-primary-700 font-bold text-xl">
                    {course.school.name[0]}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{course.school.name}</h3>
                    {course.school.is_verified && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <CheckCircle size={10} />
                        Vérifié
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mb-2">{course.school.location}</p>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {course.school.description}
                  </p>
                  <a
                    href={`mailto:${course.school.contact_email}`}
                    className="inline-block mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    {course.school.contact_email}
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Section avis */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-900 text-lg mb-4 flex items-center gap-2">
              <Star size={18} className="text-amber-400 fill-amber-400" />
              Avis des apprenants ({reviews.length})
            </h2>

            {reviews.length > 0 ? (
              <div className="space-y-4 mb-6">
                {reviews.map((review) => (
                  <ReviewCard key={review.id} review={review} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-6">
                Aucun avis pour l&apos;instant. Soyez le premier à donner votre avis !
              </p>
            )}

            <div className="border-t border-gray-100 pt-6">
              <h3 className="font-medium text-gray-900 mb-4">
                Laisser un avis (anciens élèves uniquement)
              </h3>
              <ReviewForm courseId={course.id} />
            </div>
          </div>
        </div>

        {/* ===== SIDEBAR (1/3) ===== */}
        <div className="space-y-4">
          {/* Carte prix + CTA */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 sticky top-24">
            <div className="text-center mb-6">
              <div className="text-4xl font-bold text-gray-900">
                {course.price === 0
                  ? "Gratuit"
                  : `${course.price.toLocaleString("fr-FR")} €`}
              </div>
              {course.price > 0 && (
                <p className="text-sm text-gray-400 mt-1">Prix total de la formation</p>
              )}
            </div>

            {course.seats_available !== null && course.seats_available <= 5 && course.seats_available > 0 && (
              <div className="bg-red-50 text-red-700 text-sm text-center py-2 px-3 rounded-lg mb-4 font-medium">
                ⚡ Plus que {course.seats_available} place{course.seats_available > 1 ? "s" : ""} !
              </div>
            )}

            <div className="border-t border-gray-100 pt-6">
              <h3 className="font-semibold text-gray-900 mb-4">
                Demander des informations
              </h3>
              <LeadForm course={course} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Composant helper pour les infos pratiques
function InfoItem({
  icon: Icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center mt-0.5">
        <Icon size={15} className="text-primary-600" />
      </div>
      <div>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-0.5">
          {label}
        </p>
        <p className={`text-sm font-medium ${highlight ? "text-green-600" : "text-gray-800"}`}>
          {value}
        </p>
      </div>
    </div>
  );
}
