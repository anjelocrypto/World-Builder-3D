/**
 * ATMHUD — Phase 5F: Bank / ATM panel.
 *
 * Shown when the player stands near an ATM and presses E.
 * Lets the player deposit cash → bank or withdraw bank → cash.
 *
 * Rules:
 *  - Client sends { amount } only. Server validates balance + proximity.
 *  - No optimistic balance update — balance updates come back via rp:profileUpdate.
 *  - Quick-amount buttons: $100, $500, $1 000, Max Cash (deposit), Max Bank (withdraw).
 *  - Amount input: integer only, clamped [1, 100 000].
 *  - Close: X button or pressing Escape.
 */

import { useState, useCallback, useEffect } from "react";

interface ATMHUDProps {
  /** Cash the player currently holds (from rpProfile). */
  cash:           number;
  /** Amount the player currently has in the bank (from rpProfile). */
  bank:           number;
  /** Emit rp:bankDeposit { amount }. From useRpSocket. */
  onDeposit:      (amount: number) => void;
  /** Emit rp:bankWithdraw { amount }. From useRpSocket. */
  onWithdraw:     (amount: number) => void;
  /** Close the ATM panel. */
  onClose:        () => void;
}

const QUICK_AMOUNTS = [100, 500, 1_000] as const;
const MAX_AMOUNT    = 100_000;

export default function ATMHUD({
  cash,
  bank,
  onDeposit,
  onWithdraw,
  onClose,
}: ATMHUDProps) {
  const [rawInput, setRawInput] = useState<string>("");
  const [tab, setTab]           = useState<"deposit" | "withdraw">("deposit");

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const parsedAmount = (() => {
    const n = parseInt(rawInput, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(n, MAX_AMOUNT);
  })();

  const handleQuick = useCallback(
    (amount: number) => setRawInput(String(amount)),
    [],
  );

  const handleMaxCash = useCallback(
    () => setRawInput(String(Math.min(cash, MAX_AMOUNT))),
    [cash],
  );

  const handleMaxBank = useCallback(
    () => setRawInput(String(Math.min(bank, MAX_AMOUNT))),
    [bank],
  );

  const handleSubmit = useCallback(() => {
    if (!parsedAmount) return;
    if (tab === "deposit")  onDeposit(parsedAmount);
    else                    onWithdraw(parsedAmount);
    setRawInput("");
  }, [parsedAmount, tab, onDeposit, onWithdraw]);

  const fmtCurrency = (v: number) =>
    "$" + v.toLocaleString("en-US");

  return (
    <div
      style={{
        position:        "fixed",
        top:             "50%",
        left:            "50%",
        transform:       "translate(-50%, -50%)",
        width:           340,
        background:      "linear-gradient(160deg, #0a1a14 0%, #051410 100%)",
        border:          "1.5px solid #00cc88",
        borderRadius:    12,
        padding:         "20px 24px 24px",
        color:           "#e0fff4",
        fontFamily:      "monospace",
        zIndex:          3000,
        boxShadow:       "0 0 32px rgba(0,204,136,0.25), 0 8px 24px rgba(0,0,0,0.7)",
        userSelect:      "none",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20, color: "#00cc88" }}>$</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 1 }}>ATM</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border:     "1px solid #00664a",
            borderRadius: 6,
            color:      "#00cc88",
            cursor:     "pointer",
            padding:    "2px 10px",
            fontSize:   14,
            lineHeight: 1.4,
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Balance strip ── */}
      <div
        style={{
          display:         "flex",
          justifyContent:  "space-between",
          background:      "rgba(0,204,136,0.07)",
          border:          "1px solid rgba(0,204,136,0.2)",
          borderRadius:    8,
          padding:         "8px 12px",
          marginBottom:    16,
          fontSize:        13,
        }}
      >
        <div>
          <div style={{ color: "#80ffcc", fontSize: 11, marginBottom: 2 }}>CASH</div>
          <div style={{ fontWeight: 700, color: "#00ff99" }}>{fmtCurrency(cash)}</div>
        </div>
        <div style={{ width: 1, background: "rgba(0,204,136,0.2)" }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#80ffcc", fontSize: 11, marginBottom: 2 }}>BANK</div>
          <div style={{ fontWeight: 700, color: "#00ff99" }}>{fmtCurrency(bank)}</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["deposit", "withdraw"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setRawInput(""); }}
            style={{
              flex:         1,
              padding:      "7px 0",
              border:       tab === t ? "1.5px solid #00cc88" : "1px solid #00664a",
              borderRadius: 8,
              background:   tab === t ? "rgba(0,204,136,0.15)" : "transparent",
              color:        tab === t ? "#00ff99" : "#669988",
              fontFamily:   "monospace",
              fontSize:     13,
              fontWeight:   tab === t ? 700 : 400,
              cursor:       "pointer",
              textTransform: "capitalize",
              transition:   "all 0.15s",
            }}
          >
            {t === "deposit" ? "⬆ Deposit" : "⬇ Withdraw"}
          </button>
        ))}
      </div>

      {/* ── Amount input ── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "#80ffcc", marginBottom: 5 }}>AMOUNT</div>
        <input
          type="number"
          min={1}
          max={MAX_AMOUNT}
          step={1}
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          onKeyDown={(e) => { if (e.code === "Enter") handleSubmit(); }}
          placeholder="0"
          style={{
            width:        "100%",
            boxSizing:    "border-box",
            padding:      "9px 12px",
            background:   "rgba(0,40,28,0.8)",
            border:       "1px solid #00664a",
            borderRadius: 8,
            color:        "#00ff99",
            fontFamily:   "monospace",
            fontSize:     18,
            fontWeight:   700,
            outline:      "none",
          }}
          autoFocus
        />
      </div>

      {/* ── Quick buttons ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {QUICK_AMOUNTS.map((a) => (
          <button
            key={a}
            onClick={() => handleQuick(a)}
            style={{
              padding:      "5px 10px",
              border:       "1px solid #00664a",
              borderRadius: 6,
              background:   "transparent",
              color:        "#80ffcc",
              fontFamily:   "monospace",
              fontSize:     12,
              cursor:       "pointer",
            }}
          >
            ${a.toLocaleString()}
          </button>
        ))}
        {tab === "deposit" && (
          <button
            onClick={handleMaxCash}
            style={{
              padding:      "5px 10px",
              border:       "1px solid #00664a",
              borderRadius: 6,
              background:   "transparent",
              color:        "#80ffcc",
              fontFamily:   "monospace",
              fontSize:     12,
              cursor:       "pointer",
            }}
          >
            Max Cash
          </button>
        )}
        {tab === "withdraw" && (
          <button
            onClick={handleMaxBank}
            style={{
              padding:      "5px 10px",
              border:       "1px solid #00664a",
              borderRadius: 6,
              background:   "transparent",
              color:        "#80ffcc",
              fontFamily:   "monospace",
              fontSize:     12,
              cursor:       "pointer",
            }}
          >
            Max Bank
          </button>
        )}
      </div>

      {/* ── Submit button ── */}
      <button
        onClick={handleSubmit}
        disabled={!parsedAmount}
        style={{
          width:          "100%",
          padding:        "11px 0",
          border:         "none",
          borderRadius:   8,
          background:     parsedAmount ? "rgba(0,204,136,0.85)" : "rgba(0,80,50,0.4)",
          color:          parsedAmount ? "#001a10" : "#336655",
          fontFamily:     "monospace",
          fontSize:       15,
          fontWeight:     700,
          cursor:         parsedAmount ? "pointer" : "not-allowed",
          letterSpacing:  0.5,
          transition:     "background 0.15s",
        }}
      >
        {tab === "deposit" ? "Deposit" : "Withdraw"}
      </button>

      <div style={{ textAlign: "center", color: "#336655", fontSize: 10, marginTop: 10 }}>
        Press Esc to close
      </div>
    </div>
  );
}
