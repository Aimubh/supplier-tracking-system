// Route protection: anyone not signed in is redirected to /login.
// NextAuth's withAuth wraps the request and checks the JWT session.
//
// IMPORTANT: API routes are NOT redirected here. The withAuth middleware
// redirects unauthenticated requests to the login PAGE (HTML), which breaks
// fetch() callers expecting JSON (they get an HTML login page and res.json()
// throws). Instead we let /api/* pass the middleware and rely on each route's
// own guard (requireTabAccess / requireAdmin) to return a proper JSON 401/403.
// Only page navigations are redirected to /login.

export { default } from "next-auth/middleware";

export const config = {
  // Protect pages, but exclude: login, ALL /api routes, and Next internals.
  // (API auth is enforced inside each route handler, returning JSON errors.)
  matcher: [
    "/((?!login|api|_next/static|_next/image|favicon.ico).*)",
  ],
};
