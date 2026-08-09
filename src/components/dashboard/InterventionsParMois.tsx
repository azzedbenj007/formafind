"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function InterventionsParMois({ donnees }: { donnees: { mois: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={donnees}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={30} />
        <Tooltip cursor={{ fill: "#f9fafb" }} />
        <Bar dataKey="total" fill="#2563eb" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
