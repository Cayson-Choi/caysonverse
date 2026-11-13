/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Content hashes of public/models files by URL path (vite.config.ts modelHashes). */
declare const __MODEL_HASHES__: Record<string, string>;
