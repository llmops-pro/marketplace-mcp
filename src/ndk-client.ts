// Thin wrapper around @nostr-dev-kit/ndk. Identical shape to nostr-ops-mcp's
// wrapper — same `NOSTR_PRIVATE_KEY` (nsec) vs `NOSTR_NIP46_URI` (bunker) logic,
// same lazy bunker handshake via `ensureSignerReady()`. Buyers can point both
// MCPs at the same signer with no extra setup.

import NDK, {
  type NDKSigner,
  NDKPrivateKeySigner,
  NDKNip46Signer,
} from "@nostr-dev-kit/ndk";
import type { Config } from "./config.js";

export class NdkClient {
  readonly ndk: NDK;
  readonly signer?: NDKSigner;
  private connected = false;
  private signerReady = false;

  constructor(config: Config) {
    this.ndk = new NDK({ explicitRelayUrls: [...config.NOSTR_RELAYS] });
    if (config.NOSTR_PRIVATE_KEY) {
      this.signer = new NDKPrivateKeySigner(config.NOSTR_PRIVATE_KEY);
    } else if (config.NOSTR_NIP46_URI) {
      this.signer = NDKNip46Signer.bunker(this.ndk, config.NOSTR_NIP46_URI);
    }
    if (this.signer) this.ndk.signer = this.signer;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.ndk.connect();
    this.connected = true;
  }

  hasSigner(): boolean {
    return Boolean(this.signer);
  }

  async ensureSignerReady(): Promise<void> {
    if (!this.signer) {
      throw new Error("no signer configured (set NOSTR_PRIVATE_KEY or NOSTR_NIP46_URI)");
    }
    if (this.signerReady) return;
    await this.signer.blockUntilReady();
    this.signerReady = true;
  }

  async getSignerPubkeyHex(): Promise<string | null> {
    if (!this.signer) return null;
    const user = await this.signer.user();
    return user.pubkey;
  }
}
