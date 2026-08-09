function echapper(valeur: unknown): string {
  const s = valeur === null || valeur === undefined ? "" : String(valeur);
  if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function versCsv(lignes: Record<string, unknown>[], colonnes: { cle: string; titre: string }[]): string {
  const entete = colonnes.map((c) => echapper(c.titre)).join(";");
  const corps = lignes.map((ligne) => colonnes.map((c) => echapper(ligne[c.cle])).join(";"));
  return ["﻿" + entete, ...corps].join("\n");
}
