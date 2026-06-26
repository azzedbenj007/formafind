// Carte d'avis utilisateur
import { Review } from "@/lib/types";
import StarRating from "./StarRating";

interface ReviewCardProps {
  review: Review;
}

export default function ReviewCard({ review }: ReviewCardProps) {
  const name = review.profile?.full_name || "Apprenant anonyme";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const date = new Date(review.created_at).toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
  });

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="shrink-0 w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-semibold text-sm">
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          {/* En-tête */}
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <span className="font-medium text-gray-900 text-sm">{name}</span>
            <span className="text-xs text-gray-400">{date}</span>
          </div>

          {/* Note */}
          <div className="mb-2">
            <StarRating rating={review.rating} size="sm" />
          </div>

          {/* Commentaire */}
          <p className="text-sm text-gray-600 leading-relaxed">{review.comment}</p>
        </div>
      </div>
    </div>
  );
}
