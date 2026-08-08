import clsx from "clsx";

export function Carte({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx("rounded-2xl border border-gray-200 bg-white p-5 shadow-sm", className)}>{children}</div>;
}

export function EtatVide({ titre, description, action }: { titre: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-16 text-center">
      <p className="text-sm font-medium text-gray-700">{titre}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
