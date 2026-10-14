import type { ReactNode } from "react";

export function LegalLayout({
  title,
  updated,
  children,
}: Readonly<{
  title: string;
  updated: string;
  children: ReactNode;
}>) {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "2rem 1rem 4rem",
        fontFamily: "Inter, system-ui, sans-serif",
        lineHeight: 1.65,
        color: "#202223",
      }}
    >
      <h1>{title}</h1>
      <p>
        <small>Last updated: {updated}</small>
      </p>
      {children}
    </main>
  );
}
