// Hook de gestion de la comparaison de formations
"use client";
import { useState, useCallback } from "react";
import { Course } from "@/lib/types";

const MAX_COMPARE = 3;

export function useCompare() {
  const [compareList, setCompareList] = useState<Course[]>([]);

  const addToCompare = useCallback((course: Course) => {
    setCompareList((prev) => {
      if (prev.find((c) => c.id === course.id)) return prev;
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, course];
    });
  }, []);

  const removeFromCompare = useCallback((courseId: string) => {
    setCompareList((prev) => prev.filter((c) => c.id !== courseId));
  }, []);

  const clearCompare = useCallback(() => setCompareList([]), []);

  const toggleCompare = useCallback(
    (course: Course) => {
      const isIn = compareList.find((c) => c.id === course.id);
      if (isIn) removeFromCompare(course.id);
      else addToCompare(course);
    },
    [compareList, addToCompare, removeFromCompare]
  );

  const isInComparison = useCallback(
    (courseId: string) => !!compareList.find((c) => c.id === courseId),
    [compareList]
  );

  return {
    compareList,
    addToCompare,
    removeFromCompare,
    clearCompare,
    toggleCompare,
    isInComparison,
    canAddMore: compareList.length < MAX_COMPARE,
  };
}
