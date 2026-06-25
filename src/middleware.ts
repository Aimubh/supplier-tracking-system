// Route protection: anyone not signed in is redirected to /login.
// NextAuth's withAuth wraps the request and checks the JWT session.

export { default } from "next-auth/middleware";

export const config = {
  // Protect everything except the login page, the auth API, and Next internals.
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
