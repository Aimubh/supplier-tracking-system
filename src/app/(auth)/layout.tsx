export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="app-bg min-h-screen">{children}</div>;
}
