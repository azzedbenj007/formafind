import clsx from "clsx";

export function Badge({ label, classe }: { label: string; classe: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", classe)}>
      {label}
    </span>
  );
}
