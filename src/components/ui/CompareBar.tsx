// Barre flottante de comparaison de formations
"use client";
import Link from "next/link";
import { X, GitCompare } from "lucide-react";
import { Course } from "@/lib/types";

interface CompareBarProps {
  courses: Course[];
  onRemove: (courseId: string) => void;
  onClear: () => void;
}

export default function CompareBar({ courses, onRemove, onClear }: CompareBarProps) {
  if (courses.length === 0) return null;

  const compareUrl = `/compare?ids=${courses.map((c) => c.id).join(",")}`;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <GitCompare size={16} className="text-primary-600" />
            <span>Comparer ({courses.length}/3)</span>
          </div>

          <div className="flex items-center gap-2 flex-1 flex-wrap">
            {courses.map((course) => (
              <div
                key={course.id}
                className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5"
              >
                <span className="text-sm text-gray-700 line-clamp-1 max-w-[150px]">
                  {course.title}
                </span>
                <button
                  onClick={() => onRemove(course.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClear}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Effacer
            </button>
            <Link
              href={compareUrl}
              className={`bg-primary-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors ${
                courses.length < 2 ? "opacity-50 pointer-events-none" : ""
              }`}
            >
              Comparer {courses.length > 1 ? `les ${courses.length} formations` : "(min. 2)"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
