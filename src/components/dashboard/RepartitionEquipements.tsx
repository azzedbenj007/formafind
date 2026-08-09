"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STATUTS_EQUIPEMENT } from "@/lib/constants";

const COULEURS: Record<string, string> = {
  operationnel: "#16a34a",
  en_panne: "#dc2626",
  en_maintenance: "#d97706",
  hors_service: "#6b7280",
  reforme: "#9ca3af",
};

export function RepartitionEquipements({ donnees }: { donnees: Record<string, number> }) {
  const data = STATUTS_EQUIPEMENT.map((s) => ({ nom: s.label, valeur: donnees[s.valeur] ?? 0, cle: s.valeur }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis type="category" dataKey="nom" width={110} tick={{ fontSize: 12 }} />
        <Tooltip cursor={{ fill: "#f9fafb" }} />
        <Bar dataKey="valeur" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.cle} fill={COULEURS[d.cle]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
