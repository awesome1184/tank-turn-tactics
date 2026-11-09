/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}
interface ImportMeta { readonly env: ImportMetaEnv; }