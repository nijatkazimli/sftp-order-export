import type { PrismaClient } from "@prisma/client";
import { Session } from "@shopify/shopify-app-react-router/server";
import type { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { decrypt, encrypt, isCurrentKey } from "../utils/crypto.server";

type Inner = Pick<
  PrismaSessionStorage<PrismaClient>,
  | "storeSession"
  | "loadSession"
  | "deleteSession"
  | "deleteSessions"
  | "findSessionsByShop"
  | "isReady"
>;

const PREFIX = "enc:v1:";

export function seal(value: string | undefined, sessionId: string) {
  if (!value) return value;
  const { encrypted, iv } = encrypt(value, sessionId);
  return `${PREFIX}${iv}:${encrypted}`;
}

// Values without the prefix are legacy plaintext; they're re-encrypted on the next store.
export function open(value: string | undefined, sessionId: string) {
  if (!value?.startsWith(PREFIX)) return value;
  const [iv, encrypted] = value.slice(PREFIX.length).split(":");
  return decrypt({ encrypted, iv }, sessionId);
}

export function sealedWithCurrentKey(value: string, sessionId: string) {
  if (!value.startsWith(PREFIX)) return false;
  const [iv, encrypted] = value.slice(PREFIX.length).split(":");
  return isCurrentKey({ encrypted, iv }, sessionId);
}

function transform(
  session: Session,
  fn: (value: string | undefined, sessionId: string) => string | undefined,
) {
  return new Session({
    ...session.toObject(),
    accessToken: fn(session.accessToken, session.id),
    refreshToken: fn(session.refreshToken, session.id),
  });
}

/** Encrypts access and refresh tokens at rest; everything else is delegated unchanged. */
export class EncryptedSessionStorage {
  constructor(private readonly inner: Inner) {}

  storeSession(session: Session) {
    return this.inner.storeSession(transform(session, seal));
  }

  async loadSession(id: string) {
    const session = await this.inner.loadSession(id);
    if (!session) return undefined;
    try {
      return transform(session, open);
    } catch {
      // Unreadable (e.g. key changed): treat as missing so the shop re-authenticates.
      return undefined;
    }
  }

  deleteSession(id: string) {
    return this.inner.deleteSession(id);
  }

  deleteSessions(ids: string[]) {
    return this.inner.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string) {
    const sessions = await this.inner.findSessionsByShop(shop);
    return sessions.flatMap((session) => {
      try {
        return [transform(session, open)];
      } catch {
        return [];
      }
    });
  }

  isReady() {
    return this.inner.isReady();
  }
}
