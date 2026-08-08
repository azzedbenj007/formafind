import clsx from "clsx";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type Variante = "primaire" | "secondaire" | "danger" | "fantome";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  href?: string;
  enCours?: boolean;
}

const CLASSES_VARIANTE: Record<Variante, string> = {
  primaire: "bg-primary-600 text-white hover:bg-primary-700 disabled:bg-primary-300",
  secondaire: "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:text-gray-400",
  danger: "bg-danger-600 text-white hover:bg-danger-700 disabled:bg-danger-300",
  fantome: "text-gray-600 hover:bg-gray-100 disabled:text-gray-300",
};

const CLASSE_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed";

export function Bouton({ variante = "primaire", href, enCours, className, children, disabled, ...props }: Props) {
  const classes = clsx(CLASSE_BASE, CLASSES_VARIANTE[variante], className);

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} disabled={disabled || enCours} {...props}>
      {enCours && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
