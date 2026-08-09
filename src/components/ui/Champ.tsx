import clsx from "clsx";
import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const CLASSE_CONTROLE =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-500";

export function Etiquette({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={clsx("mb-1 block text-sm font-medium text-gray-700", className)} {...props} />;
}

export function Saisie({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(CLASSE_CONTROLE, className)} {...props} />;
}

export function ZoneTexte({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(CLASSE_CONTROLE, className)} {...props} />;
}

export function Selecteur({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(CLASSE_CONTROLE, "bg-white", className)} {...props}>
      {children}
    </select>
  );
}

export function MessageErreur({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-danger-600">{message}</p>;
}

export function Champ({
  label,
  htmlFor,
  erreur,
  requis,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  erreur?: string;
  requis?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Etiquette htmlFor={htmlFor}>
        {label}
        {requis && <span className="text-danger-600"> *</span>}
      </Etiquette>
      {children}
      <MessageErreur message={erreur} />
    </div>
  );
}
