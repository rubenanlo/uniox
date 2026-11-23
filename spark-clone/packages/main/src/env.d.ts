interface ImportMetaEnv {
  /** Built-in Google OAuth client from .env — see .env.example. */
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string;
  /** Optional overrides for the Uniox cloud backend behind "Sync with phone". */
  readonly MAIN_VITE_UNIOX_CLOUD_URL?: string;
  readonly MAIN_VITE_UNIOX_CLOUD_KEY?: string;
}
