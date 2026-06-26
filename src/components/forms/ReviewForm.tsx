// Formulaire de dépôt d'un avis sur une formation
"use client";
import { useState } from "react";
import { CheckCircle } from "lucide-react";
import StarRating from "@/components/ui/StarRating";

interface ReviewFormProps {
  courseId: string;
  onSuccess?: () => void;
}

export default function ReviewForm({ courseId, onSuccess }: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      setError("Veuillez sélectionner une note.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const { createClient } = await import("@/lib/supabase");
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Vous devez être connecté pour laisser un avis.");
        return;
      }

      const { error: dbError } = await supabase.from("reviews").insert({
        course_id: courseId,
        user_id: user.id,
        rating,
        comment,
      });

      if (dbError) {
        if (dbError.code === "23505") {
          setError("Vous avez déjà laissé un avis pour cette formation.");
        } else {
          throw dbError;
        }
        return;
      }

      setSuccess(true);
      onSuccess?.();
    } catch {
      setError("Une erreur est survenue. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center gap-3">
        <CheckCircle size={24} className="text-green-600 shrink-0" />
        <div>
          <p className="font-medium text-green-800">Avis publié avec succès !</p>
          <p className="text-sm text-green-700">Merci pour votre retour.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Votre note *
        </label>
        <StarRating
          rating={rating}
          size="lg"
          interactive
          onRate={setRating}
        />
        {rating > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {["", "Très décevant", "Décevant", "Correct", "Bien", "Excellent"][rating]}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Votre avis *
        </label>
        <textarea
          required
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Partagez votre expérience : points forts, points faibles, ce que vous avez appris..."
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="bg-primary-600 text-white font-medium px-6 py-2.5 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-70"
      >
        {loading ? "Publication..." : "Publier mon avis"}
      </button>
    </form>
  );
}
