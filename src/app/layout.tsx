import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GMAO Hospitalière",
    template: "%s | GMAO Hospitalière",
  },
  description:
    "Gestion de maintenance assistée par ordinateur pour établissements hospitaliers : équipements biomédicaux, interventions, contrats, documents et assistant IA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
