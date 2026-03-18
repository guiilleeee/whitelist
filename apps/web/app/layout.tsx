import "./globals.css";

export const metadata = {
  title: "Genesis Community | Whitelist",
  description: "Sistema profesional de whitelist para Genesis Community"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="min-h-screen starfield">
          {children}
        </div>
      </body>
    </html>
  );
}
