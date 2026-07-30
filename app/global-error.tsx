"use client";

// 0141: global-error apanha erros no próprio root layout (onde o error.tsx
// de segmento já não corre). Tem de renderizar <html>/<body> próprios.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#faf9f6",
          color: "#1a1a1a",
        }}
      >
        <div style={{ maxWidth: 360, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Algo correu mal</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#6b7280" }}>
            Ocorreu um erro inesperado. Tenta recarregar a página.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 24,
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#c9a227",
              color: "#1a1a1a",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
