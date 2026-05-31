import { useEffect, useRef, useState } from "react";
import { useNemoWallet } from "../hooks/useNemoWallet";

// =============================================================
// Nemo Gang wallet-verify modal (Batch C, client UI).
// -------------------------------------------------------------
// Flow: Connect Phantom → request a server nonce → sign the SERVER-PROVIDED
// message → submit { pubkey, signature }. The server verifies the signature and
// the on-chain $NEMOCLAW balance and decides eligibility. This modal never
// decides anything; it only collects a wallet signature. Display-only env vars
// (VITE_NEMOCLAW_MINT / VITE_SOLANA_NETWORK) show the token + network.
// =============================================================

const MINT_DISPLAY = (import.meta.env.VITE_NEMOCLAW_MINT as string | undefined) ?? "";
const NETWORK_DISPLAY = (import.meta.env.VITE_SOLANA_NETWORK as string | undefined) ?? "mainnet-beta";

type Step = "idle" | "connecting" | "awaiting_nonce" | "signing" | "verifying" | "done" | "error";

interface WalletConnectHUDProps {
  onClose: () => void;
  /** Server-issued message to sign (carries a fresh nonce). Bumps each request. */
  nemoSign: { message: string; token: number } | null;
  /** Current membership (drives the success state). */
  isMember: boolean;
  emitNemoRequestNonce: () => void;
  emitNemoVerify: (pubkey: string, signature: string) => void;
}

export default function WalletConnectHUD({
  onClose,
  nemoSign,
  isMember,
  emitNemoRequestNonce,
  emitNemoVerify,
}: WalletConnectHUDProps) {
  const { available, connect, signMessage, error: walletError } = useNemoWallet();
  const [step, setStep] = useState<Step>("idle");
  const [note, setNote] = useState<string>("");
  const pubkeyRef = useRef<string | null>(null);
  const handledTokenRef = useRef<number>(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Membership flipping to true (server granted) → success state.
  useEffect(() => { if (isMember) { setStep("done"); setNote("Verified — welcome to the Nemo Gang."); } }, [isMember]);

  // When a fresh signing message arrives (we requested a nonce), sign it and
  // submit. The server message is signed verbatim; we never craft our own text.
  useEffect(() => {
    if (!nemoSign || nemoSign.token === handledTokenRef.current) return;
    if (step !== "awaiting_nonce" || !pubkeyRef.current) return;
    handledTokenRef.current = nemoSign.token;
    const pk = pubkeyRef.current;
    setStep("signing");
    setNote("Approve the signature in your wallet…");
    void (async () => {
      const sig = await signMessage(nemoSign.message);
      if (!sig) { setStep("error"); setNote("Signature was rejected."); return; }
      setStep("verifying");
      setNote("Verifying your $NEMOCLAW balance on-chain…");
      emitNemoVerify(pk, sig);
    })();
  }, [nemoSign, step, signMessage, emitNemoVerify]);

  const startVerify = async () => {
    setStep("connecting");
    setNote("Connecting to Phantom…");
    const pk = await connect();
    if (!pk) { setStep("error"); setNote(walletError ?? "Could not connect wallet."); return; }
    pubkeyRef.current = pk;
    setStep("awaiting_nonce");
    setNote("Requesting a one-time challenge…");
    emitNemoRequestNonce();
  };

  const busy = step === "connecting" || step === "awaiting_nonce" || step === "signing" || step === "verifying";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 3000, display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "rgba(4,6,16,0.72)", fontFamily: "'Courier New', monospace",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380, background: "rgba(18,12,30,0.97)",
          border: "1px solid rgba(176,111,255,0.5)", borderRadius: 12, padding: 22,
          color: "#e7dcff", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
        data-testid="wallet-connect-hud"
      >
        <div style={{ fontSize: 18, fontWeight: "bold", letterSpacing: 1, marginBottom: 4 }}>
          🐾 Join the Nemo Gang
        </div>
        <div style={{ fontSize: 12, color: "#b9a8d8", lineHeight: 1.5, marginBottom: 14 }}>
          Verify a Solana wallet holding <b>$NEMOCLAW</b> to unlock the gang hood as your spawn.
          Connecting only proves ownership — the server checks the balance by mint address.
        </div>

        <div style={{ fontSize: 11, color: "#8f7fb0", marginBottom: 14, wordBreak: "break-all" }}>
          <div>network: {NETWORK_DISPLAY}</div>
          {MINT_DISPLAY && <div>mint: {MINT_DISPLAY}</div>}
        </div>

        {isMember ? (
          <div style={{ fontSize: 13, color: "#7CFC9A", marginBottom: 16 }}>
            ✓ Verified — you’re a Nemo Gang member. Your spawn is the hood.
          </div>
        ) : (
          <>
            {!available && (
              <div style={{ fontSize: 12, color: "#ff9a9a", marginBottom: 12 }}>
                Phantom wallet not detected. Install Phantom, then reopen this panel.
              </div>
            )}
            {note && (
              <div style={{ fontSize: 12, color: step === "error" ? "#ff9a9a" : "#cbb8f0", marginBottom: 12 }}>
                {note}
              </div>
            )}
            <button
              onClick={startVerify}
              disabled={!available || busy}
              data-testid="wallet-connect-btn"
              style={{
                width: "100%", padding: "10px 0", borderRadius: 8, cursor: !available || busy ? "default" : "pointer",
                fontFamily: "inherit", fontSize: 14, fontWeight: "bold", letterSpacing: 1,
                color: "#1a0f2a", background: !available || busy ? "#6b5a8a" : "#b06fff", border: "none",
              }}
            >
              {busy ? "Working…" : "Connect wallet & verify"}
            </button>
          </>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%", marginTop: 10, padding: "8px 0", borderRadius: 8, cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, color: "#b9a8d8",
            background: "transparent", border: "1px solid rgba(176,111,255,0.3)",
          }}
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}
