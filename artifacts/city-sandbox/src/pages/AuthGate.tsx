import { useState } from "react";
import MenuWorldPreview from "@/game/MenuWorldPreview";
import { useNemoWallet } from "@/hooks/useNemoWallet";
import type { AuthMode } from "@/shared/types";

// =============================================================
// AuthGate — NEMOVERSE landing / entry screen.
// -------------------------------------------------------------
// VISUAL/branding layer only. Red + white over near-black, cinematic over the
// live 3D city preview. Auth logic is unchanged: Connect Wallet → onWallet,
// Email disabled, Continue as Guest → onChoose("guest"). data-testids preserved.
// =============================================================

interface AuthGateProps {
  /** walletAddress is supplied only for the "wallet" mode after Phantom connects. */
  onChoose: (mode: AuthMode, walletAddress?: string) => void;
}

const STYLES = `
.ng-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Arial,sans-serif;}
.ng-btn{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;
  padding:14px 18px;border-radius:12px;cursor:pointer;text-align:left;
  transition:transform .12s ease,box-shadow .22s ease,background .22s ease,border-color .22s ease;}
.ng-btn:active{transform:translateY(1px) scale(.996);}
.ng-primary{background:linear-gradient(180deg,#ff2d3a 0%,#c20f1c 100%);border:1px solid rgba(255,255,255,.20);color:#fff;
  box-shadow:0 12px 34px rgba(226,29,43,.40),inset 0 1px 0 rgba(255,255,255,.28);}
.ng-primary:hover{transform:translateY(-1px);box-shadow:0 16px 46px rgba(226,29,43,.58),inset 0 1px 0 rgba(255,255,255,.34);}
.ng-ghost{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.16);color:#fff;}
.ng-ghost:hover{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.30);}
.ng-disabled{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.08);color:#7a7d85;cursor:default;}
.ng-arrow{font-size:20px;opacity:.85;line-height:1;}
@media (max-width:480px){
  .ng-panel{padding:22px 20px !important;}
  .ng-title{letter-spacing:4px !important;}
}
`;

function EntryButton({
  testid, title, subtitle, variant, onClick, arrow = false, disabled = false,
}: {
  testid: string; title: string; subtitle: string;
  variant: "primary" | "ghost" | "disabled";
  onClick?: () => void; arrow?: boolean; disabled?: boolean;
}) {
  const isDisabled = variant === "disabled" || disabled;
  const subColor =
    variant === "primary" ? "rgba(255,255,255,.88)"
    : variant === "ghost" ? "#b8bcc4"
    : "#6c6f77";
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      disabled={isDisabled}
      className={`ng-btn ng-${variant}`}
      style={isDisabled && variant !== "disabled" ? { opacity: 0.5, cursor: "default" } : undefined}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 700, letterSpacing: 0.4 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12.5, marginTop: 3, color: subColor, lineHeight: 1.35 }}>{subtitle}</span>
      </span>
      {variant === "disabled" ? (
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "#c20f1c",
          background: "rgba(226,29,43,.12)", border: "1px solid rgba(226,29,43,.35)",
          padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
        }}>SOON</span>
      ) : arrow ? (
        <span className="ng-arrow" aria-hidden>›</span>
      ) : null}
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

  const walletBusy = connecting || busy;

  return (
    <div
      className="ng-root"
      style={{
        position: "relative", width: "100vw", height: "100vh", overflow: "hidden",
        color: "#fff", background: "#08080a",
      }}
    >
      <style>{STYLES}</style>

      {/* Live cinematic 3D city behind everything. */}
      <MenuWorldPreview />

      {/* Cinematic grade: near-black vignette + red top/bottom wash for drama
          while keeping the panel readable. */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background:
          "radial-gradient(ellipse at 50% 36%, rgba(8,8,10,0.10) 0%, rgba(6,6,8,0.70) 60%, rgba(2,2,4,0.94) 100%)",
      }} />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background:
          "linear-gradient(180deg, rgba(150,12,20,0.22) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 58%, rgba(120,10,16,0.30) 100%)",
      }} />

      {/* Foreground */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 2,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "24px", boxSizing: "border-box",
      }}>
        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: 34 }}>
          <div style={{
            display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: 6,
            color: "#ff3b46", marginBottom: 14, textTransform: "uppercase",
          }}>
            ◆ Enter the world
          </div>
          <div
            className="ng-title"
            style={{
              fontSize: "clamp(44px, 9vw, 88px)", fontWeight: 900, color: "#fff",
              letterSpacing: 8, lineHeight: 0.95,
              textShadow: "0 0 44px rgba(226,29,43,0.45), 0 8px 34px rgba(0,0,0,0.85)",
            }}
          >
            NEMOVERSE
          </div>
          <div style={{
            margin: "16px auto 0", width: 64, height: 3, borderRadius: 2,
            background: "linear-gradient(90deg, rgba(226,29,43,0) 0%, #ff2d3a 50%, rgba(226,29,43,0) 100%)",
          }} />
          <div style={{
            marginTop: 16, fontSize: "clamp(12px, 2.4vw, 15px)", fontWeight: 600,
            color: "#d6d8de", letterSpacing: 4, textShadow: "0 2px 10px rgba(0,0,0,0.85)",
          }}>
            OWN THE CITY. ENTER THE WORLD.
          </div>
        </div>

        {/* Entry panel — dark glass / metal */}
        <div
          className="ng-panel"
          style={{
            width: "min(92vw, 400px)", boxSizing: "border-box",
            background: "rgba(12,12,14,0.62)",
            backdropFilter: "blur(16px) saturate(120%)",
            WebkitBackdropFilter: "blur(16px) saturate(120%)",
            border: "1px solid rgba(226,29,43,0.22)",
            borderRadius: 16, padding: "26px 26px",
            display: "flex", flexDirection: "column", gap: 12,
            boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px rgba(226,29,43,0.10)",
          }}
        >
          <EntryButton
            testid="auth-wallet"
            variant="primary"
            arrow
            disabled={!available || walletBusy}
            title={walletBusy ? "Connecting…" : "Connect Wallet"}
            subtitle={available ? "Sign with your Solana wallet" : "Phantom not detected — install to use"}
            onClick={onWallet}
          />
          {error && (
            <div style={{ fontSize: 11.5, color: "#ff8a90", marginTop: -4, letterSpacing: 0.3 }}>{error}</div>
          )}

          <EntryButton
            testid="auth-email"
            variant="disabled"
            title="Email Sign Up / Login"
            subtitle="Coming soon"
          />

          <EntryButton
            testid="auth-guest"
            variant="ghost"
            arrow
            title="Continue as Guest"
            subtitle="Explore only. No progress saved."
            onClick={() => onChoose("guest")}
          />
        </div>

        <div style={{
          marginTop: 20, fontSize: 11.5, color: "#8a8d95", textAlign: "center",
          maxWidth: 380, lineHeight: 1.7, letterSpacing: 0.2,
        }}>
          Guests can walk, look, sit, and ride — but money, jobs, inventory,
          vehicles, gangs, and chat need an account.
        </div>
      </div>
    </div>
  );
}
