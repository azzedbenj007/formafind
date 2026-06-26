// Composant d'affichage et de saisie des étoiles
"use client";
import { Star } from "lucide-react";

interface StarRatingProps {
  rating: number;
  maxRating?: number;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  onRate?: (rating: number) => void;
}

const sizeMap = { sm: 12, md: 16, lg: 20 };

export default function StarRating({
  rating,
  maxRating = 5,
  size = "md",
  interactive = false,
  onRate,
}: StarRatingProps) {
  const px = sizeMap[size];

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: maxRating }, (_, i) => {
        const filled = i < Math.floor(rating);
        const partial = !filled && i < rating;

        return (
          <button
            key={i}
            type="button"
            disabled={!interactive}
            onClick={() => interactive && onRate?.(i + 1)}
            className={interactive ? "cursor-pointer hover:scale-110 transition-transform" : "cursor-default"}
          >
            <Star
              width={px}
              height={px}
              className={
                filled
                  ? "fill-amber-400 text-amber-400"
                  : partial
                  ? "fill-amber-200 text-amber-400"
                  : "fill-gray-200 text-gray-300"
              }
            />
          </button>
        );
      })}
    </div>
  );
}
