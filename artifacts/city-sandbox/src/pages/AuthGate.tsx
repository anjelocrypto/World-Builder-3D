import { useState } from "react";
import MenuWorldPreview from "@/game/MenuWorldPreview";
import { useNemoWallet } from "@/hooks/useNemoWallet";
import type { AuthMode } from "@/shared/types";

// =============================================================
// AuthGate — the first screen (Batch A). The player chooses how to enter:
// wallet account, email account, or guest (explore-only). The chosen mode is
// passed up to App and ultimately into the socket join payload, but the SERVER
// owns the final mode. In Batch A, wallet/email use the existing username+token
// prototype flow; guest sends no token and gets no RP systems.
// =============================================================

interface AuthGateProps {
  /** walletAddress is supplied only for the "wallet" mode after Phantom connects. */
  onChoose: (mode: AuthMode, walletAddress?: string) => void;
}

const CARD = {
  background: "rgba(10, 10, 26, 0.55)",
  backdropFilter: "blur(14px) saturate(140%)",
  WebkitBackdropFilter: "blur(14px) saturate(140%)",
  border: "1px solid rgba(0,229,255,0.35)",
  borderRadius: 8,
  padding: "40px 48px",
  minWidth: 360,
  display: "flex",
  flexDirection: "column" as const,
  gap: 14,
  boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(0,229,255,0.08)",
};

function ModeButton({
  title, subtitle, onClick, accent = "#00e5ff", testid, disabled = false,
}: {
  title: string; subtitle: string; onClick?: () => void; accent?: string; testid: string; disabled?: boolean;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: "14px 16px",
        borderRadius: 6,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        color: "#e0e0e0",
        background: disabled ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.45)",
        border: `1px solid ${disabled ? "rgba(255,255,255,0.12)" : accent + "66"}`,
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.12s",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: "bold", color: disabled ? "#9aa" : accent, letterSpacing: 1 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "#9bb", marginTop: 3 }}>{subtitle}</div>
    </button>
  );
}

export default function AuthGate({ onChoose }: AuthGateProps) {
  const { available, connect, busy, error } = useNemoWallet();
  const [connecting, setConnecting] = useState(false);

  const onWallet = async () => {
    setConnecting(true);
    const pk = await connect();
    setConnecting(false);
    if (pk) onChoose("wallet", pk); // signature handshake happens at join (Game).
  };

  return (
    <div
      style={{
        position: "relative", width: "100vw", height: "100vh", overflow: "hidden",
        fontFamily: "'Courier New', monospace", color: "#e0e0e0", background: "#0a0a1a",
      }}
    >
      <MenuWorldPreview />
      <div
        style={{
          position: "absolute", inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(10,10,26,0.15) 0%, rgba(10,10,26,0.6) 70%, rgba(10,10,26,0.85) 100%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", zIndex: 2,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div
            style={{
              fontSize: 44, fontWeight: "bold", color: "#00e5ff", letterSpacing: 6,
              textShadow: "0 0 30px rgba(0,229,255,0.6), 0 4px 18px rgba(0,0,0,0.8)", marginBottom: 8,
            }}
          >
            HANTA CITY
          </div>
          <div style={{ fontSize: 14, color: "#9bb", letterSpacing: 3, textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}>
            CHOOSE HOW TO ENTER
          </div>
        </div>

        <div style={CARD}>
          <ModeButton
            testid="auth-wallet"
            title={connecting || busy ? "🪪  Connecting…" : "🪪  Connect Wallet"}
            subtitle={
              available
                ? "Solana wallet account. You'll sign to prove ownership."
                : "Phantom wallet not detected — install it to use this."
            }
            accent="#b06fff"
            disabled={!available || connecting || busy}
            onClick={onWallet}
          />
          {error && (
            <div style={{ fontSize: 11, color: "#ff9a9a", marginTop: -6 }}>{error}</div>
          )}
          <ModeButton
            testid="auth-email"
            title="✉️  Email Sign Up / Login"
            subtitle="Coming soon — use wallet or guest for now."
            disabled
          />
          <ModeButton
            testid="auth-guest"
            title="👣  Continue as Guest"
            subtitle="Explore the world. No account, no purchases, no progress."
            accent="#7CFC9A"
            onClick={() => onChoose("guest")}
          />
        </div>

        <div style={{ marginTop: 24, fontSize: 11, color: "#99a", textAlign: "center", maxWidth: 360, lineHeight: 1.7 }}>
          Guests can walk, look around, sit, and ride — but cannot use money, jobs,
          inventory, vehicles, gangs, or chat.
        </div>
      </div>
    </div>
  );
}
