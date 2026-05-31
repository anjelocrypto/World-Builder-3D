import { useCallback, useState } from "react";

// =============================================================
// Phantom (window.solana) wallet bridge — Batch C, client side.
// -------------------------------------------------------------
// Thin wrapper over the injected Phantom provider. NO wallet-adapter packages
// and NO @solana/web3.js on the client. The wallet only ever proves ownership
// (connect + sign a server-issued message); it has NO authority — the server
// verifies the signature and checks the on-chain $NEMOCLAW balance.
// =============================================================

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
}

function getProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const sol = (window as unknown as { solana?: PhantomProvider }).solana;
  return sol?.isPhantom ? sol : null;
}

/** base64-encode raw signature bytes (server accepts base64 or base58). */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function useNemoWallet() {
  const [available] = useState(() => !!getProvider());
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Prompt Phantom to connect; returns the base58 pubkey or null. */
  const connect = useCallback(async (): Promise<string | null> => {
    const p = getProvider();
    if (!p) {
      setError("Phantom wallet not found. Install it to join the Nemo Gang.");
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await p.connect();
      const pk = res.publicKey.toString();
      setPubkey(pk);
      return pk;
    } catch {
      setError("Wallet connection was cancelled.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Sign a server-provided message verbatim; returns base64 signature or null. */
  const signMessage = useCallback(async (message: string): Promise<string | null> => {
    const p = getProvider();
    if (!p) return null;
    setBusy(true);
    try {
      const encoded = new TextEncoder().encode(message);
      const { signature } = await p.signMessage(encoded, "utf8");
      return toBase64(signature);
    } catch {
      setError("Signature request was rejected.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { available, pubkey, busy, error, connect, signMessage };
}
