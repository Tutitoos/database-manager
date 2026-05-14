import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Database Manager",
  description: "Local database manager with plugin providers"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
