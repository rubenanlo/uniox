import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type CredentialRecord =
  | { type: 'password'; password: string }
  | { type: 'oauth-google'; clientId: string; clientSecret: string; refreshToken: string };

const GOOGLE_CLIENT_KEY = '_google_client';
const NOTION_TOKEN_KEY = '_notion_token';
const NOTION_CLIENT_KEY = '_notion_client';
const AI_KEY = '_ai_key';
const AI_MODEL_KEY = '_ai_model';

/**
 * Account credentials, encrypted with the OS keychain-backed safeStorage
 * (Keychain on macOS, DPAPI on Windows). Only ciphertext touches disk;
 * plaintext lives in the sync process's memory for active connections.
 */
export class CredentialStore {
  private readonly file: string;
  private cache: Record<string, string> = {};

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'credentials.json');
    if (existsSync(this.file)) {
      try {
        this.cache = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        this.cache = {};
      }
    }
  }

  private encrypt(plaintext: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS credential encryption unavailable');
    }
    return safeStorage.encryptString(plaintext).toString('base64');
  }

  private decrypt(key: string): string | null {
    const blob = this.cache[key];
    if (!blob) return null;
    try {
      return safeStorage.decryptString(Buffer.from(blob, 'base64'));
    } catch {
      return null;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.cache), { mode: 0o600 });
  }

  setRecord(accountId: string, record: CredentialRecord): void {
    this.cache[accountId] = this.encrypt(JSON.stringify(record));
    this.persist();
  }

  /** Legacy entries are raw password strings; treat them as password records. */
  getRecord(accountId: string): CredentialRecord | null {
    const plain = this.decrypt(accountId);
    if (plain === null) return null;
    try {
      const parsed = JSON.parse(plain) as CredentialRecord;
      if (parsed && (parsed.type === 'password' || parsed.type === 'oauth-google')) return parsed;
    } catch {
      /* legacy raw password */
    }
    return { type: 'password', password: plain };
  }

  /** Convenience for the common password path. */
  set(accountId: string, password: string): void {
    this.setRecord(accountId, { type: 'password', password });
  }

  /** Forget an account's stored secret (password or OAuth refresh token). */
  deleteRecord(accountId: string): void {
    if (accountId in this.cache) {
      delete this.cache[accountId];
      this.persist();
    }
  }

  setGoogleClient(clientId: string, clientSecret: string): void {
    this.cache[GOOGLE_CLIENT_KEY] = this.encrypt(JSON.stringify({ clientId, clientSecret }));
    this.persist();
  }

  setNotionToken(token: string): void {
    this.cache[NOTION_TOKEN_KEY] = this.encrypt(token);
    this.persist();
  }

  getNotionToken(): string | null {
    return this.decrypt(NOTION_TOKEN_KEY);
  }

  setNotionClient(clientId: string, clientSecret: string): void {
    this.cache[NOTION_CLIENT_KEY] = this.encrypt(JSON.stringify({ clientId, clientSecret }));
    this.persist();
  }

  getNotionClient(): { clientId: string; clientSecret: string } | null {
    const plain = this.decrypt(NOTION_CLIENT_KEY);
    if (!plain) return null;
    try {
      const parsed = JSON.parse(plain);
      if (parsed?.clientId && parsed?.clientSecret) return parsed;
    } catch {
      /* corrupt */
    }
    return null;
  }

  getGoogleClient(): { clientId: string; clientSecret: string } | null {
    const plain = this.decrypt(GOOGLE_CLIENT_KEY);
    if (!plain) return null;
    try {
      const parsed = JSON.parse(plain);
      if (parsed?.clientId && parsed?.clientSecret) return parsed;
    } catch {
      /* corrupt */
    }
    return null;
  }

  setAiKey(key: string): void {
    this.cache[AI_KEY] = this.encrypt(key);
    this.persist();
  }

  getAiKey(): string | null {
    return this.decrypt(AI_KEY);
  }

  /** The model is not a secret, but rides along in the same encrypted store. */
  setAiModel(model: string): void {
    this.cache[AI_MODEL_KEY] = this.encrypt(model);
    this.persist();
  }

  getAiModel(): string | null {
    return this.decrypt(AI_MODEL_KEY);
  }
}
