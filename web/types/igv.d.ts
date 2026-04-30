// igv v2 ships no TypeScript types; declare it as a module of any so
// strict-mode TS doesn't fail the build. Runtime usage is constrained in
// components/IgvBrowser.tsx with a defensive `typeof createBrowser` check.
declare module "igv";
