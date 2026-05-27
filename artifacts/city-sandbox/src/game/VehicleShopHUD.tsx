/**
 * VehicleShopHUD — Dealership purchase overlay (Phase 3).
 *
 * Shows when the player is near the dealership and presses E (GameScene passes
 * `open={true}`). Displays the vehicle catalog with color swatches and a Buy
 * button. Emits rp:buyVehicle on confirm; server validates and replies via
 * rp:profileUpdate + rp:toast.
 *
 * Design:
 *   - Dark overlay panel, bottom-center of screen.
 *   - One column per vehicle model. Selected model is highlighted.
 *   - Color swatches below each model. Selected color is outlined.
 *   - "BUY — $NNN" button: disabled if player lacks cash or license.
 *   - Close button (×) dismisses without purchasing.
 */

import { useState, useCallback } from "react";
import type { RpProfile, VehicleShopItem } from "../shared/rpTypes";
import { VEHICLE_SHOP_CATALOG } from "../shared/rpTypes";

interface VehicleShopHUDProps {
  open:          boolean;
  rpProfile:     RpProfile | null;
  onClose:       () => void;
  onBuy:         (model: string, variant: string, color: string) => void;
}

const MODEL_LABELS: Record<string, string> = {
  compact: "Compact",
  sedan:   "Sedan",
  taxi:    "Taxi",
  van:     "Van",
};

const MODEL_ICONS: Record<string, string> = {
  compact: "🚗",
  sedan:   "🚙",
  taxi:    "🚕",
  van:     "🚐",
};

export default function VehicleShopHUD({
  open,
  rpProfile,
  onClose,
  onBuy,
}: VehicleShopHUDProps) {
  const [selectedModel, setSelectedModel] = useState<string>(VEHICLE_SHOP_CATALOG[0].model);
  const [selectedColor, setSelectedColor] = useState<string>(
    VEHICLE_SHOP_CATALOG[0].colors[0],
  );

  const catalogEntry: VehicleShopItem | undefined = VEHICLE_SHOP_CATALOG.find(
    (c) => c.model === selectedModel,
  );

  const handleSelectModel = useCallback(
    (item: VehicleShopItem) => {
      setSelectedModel(item.model);
      // Reset color to first valid color for this model
      setSelectedColor(item.colors[0]);
    },
    [],
  );

  const handleBuy = useCallback(() => {
    if (!catalogEntry) return;
    onBuy(catalogEntry.model, catalogEntry.variant, selectedColor);
  }, [catalogEntry, selectedColor, onBuy]);

  if (!open) return null;

  const cash         = rpProfile?.cash ?? 0;
  const hasLicense   = rpProfile?.driverLicense ?? false;
  const canAfford    = catalogEntry ? cash >= catalogEntry.price : false;
  const canBuy       = hasLicense && canAfford;

  const disabledReason = !hasLicense
    ? "Need Driver License"
    : !canAfford
    ? `Need $${(catalogEntry?.price ?? 0) - cash} more`
    : null;

  return (
    <div
      style={{
        position:   "fixed",
        bottom:     "80px",
        left:       "50%",
        transform:  "translateX(-50%)",
        background: "rgba(8, 12, 24, 0.97)",
        border:     "1px solid rgba(255, 180, 0, 0.45)",
        borderRadius: "10px",
        padding:    "18px 22px 16px",
        minWidth:   "460px",
        maxWidth:   "560px",
        color:      "#f0f0f0",
        fontFamily: "'Courier New', monospace",
        userSelect: "none",
        zIndex:     1000,
        boxShadow:  "0 4px 32px rgba(0,0,0,0.7)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: "bold", color: "#ffb300", letterSpacing: 2 }}>
          🏪 NEM AUTO DEALER
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border:     "none",
            color:      "#888",
            fontSize:   18,
            cursor:     "pointer",
            padding:    "0 4px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Model grid */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        {VEHICLE_SHOP_CATALOG.map((item) => {
          const isSelected = item.model === selectedModel;
          return (
            <button
              key={item.model}
              onClick={() => handleSelectModel(item)}
              style={{
                flex:         1,
                background:   isSelected ? "rgba(255, 179, 0, 0.15)" : "rgba(255,255,255,0.04)",
                border:       isSelected ? "1px solid #ffb300" : "1px solid rgba(255,255,255,0.12)",
                borderRadius: 7,
                color:        isSelected ? "#ffb300" : "#ccc",
                padding:      "10px 6px",
                cursor:       "pointer",
                fontFamily:   "inherit",
                fontSize:     12,
                transition:   "all 0.1s",
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 4 }}>{MODEL_ICONS[item.model]}</div>
              <div style={{ fontWeight: "bold", marginBottom: 2 }}>{MODEL_LABELS[item.model] ?? item.model}</div>
              <div style={{ color: isSelected ? "#ffd54f" : "#8ab4ff", fontSize: 13, fontWeight: "bold" }}>
                ${item.price}
              </div>
            </button>
          );
        })}
      </div>

      {/* Color picker */}
      {catalogEntry && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#777", marginBottom: 7, letterSpacing: 1 }}>
            COLOUR
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {catalogEntry.colors.map((c) => {
              const isChosen = c === selectedColor;
              return (
                <button
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  title={c}
                  style={{
                    width:        30,
                    height:       30,
                    borderRadius: "50%",
                    background:   c,
                    border:       isChosen ? "2px solid #fff" : "2px solid transparent",
                    cursor:       "pointer",
                    outline:      isChosen ? "2px solid #ffb300" : "none",
                    outlineOffset: "1px",
                    transition:   "outline 0.1s",
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Footer: cash + buy button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#9abcff" }}>
          Cash: <span style={{ color: "#fff", fontWeight: "bold" }}>${cash.toLocaleString()}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {disabledReason && (
            <div style={{ fontSize: 11, color: "#e57373" }}>{disabledReason}</div>
          )}
          <button
            onClick={canBuy ? handleBuy : undefined}
            disabled={!canBuy}
            style={{
              background:   canBuy ? "rgba(255, 179, 0, 0.9)" : "rgba(80, 60, 0, 0.5)",
              border:       "none",
              borderRadius: 6,
              color:        canBuy ? "#0a0a0a" : "#555",
              fontFamily:   "inherit",
              fontWeight:   "bold",
              fontSize:     13,
              padding:      "8px 20px",
              cursor:       canBuy ? "pointer" : "default",
              letterSpacing: 1,
              transition:   "background 0.15s",
            }}
          >
            BUY — ${catalogEntry?.price ?? 0}
          </button>
        </div>
      </div>
    </div>
  );
}
