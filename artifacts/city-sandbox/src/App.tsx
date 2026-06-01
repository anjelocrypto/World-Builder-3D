import { Suspense, lazy, useState } from "react";
import AuthGate from "@/pages/AuthGate";
import Lobby from "@/pages/Lobby";
import type { AuthMode } from "@/shared/types";

// Lazy-load Game so its module graph (GameScene → LocalPlayer → CharacterAvatar
// → AnimatedCharacter, which calls useGLTF.preload(...) at module top level)
// does not evaluate while the user is still on the Lobby. This is what keeps
// the heavy character GLBs from being fetched before JOIN WORLD is clicked.
const Game = lazy(() => import("@/pages/Game"));

import type { CharacterId } from "@/game/character/characterCatalog";

export default function App() {
  // Batch A: entry flow is AuthGate → Lobby (name + character) → Game. The mode
  // chosen here is the client's REQUEST; the server validates + owns the final
  // authMode (guests get no token / no RP).
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  // Admin passcode (dev/testing) — held in memory only, sent once to the server
  // handshake at join (useSocket) and never persisted.
  const [adminPasscode, setAdminPasscode] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [character, setCharacter] = useState<CharacterId>("classic");

  if (!authMode) {
    return (
      <AuthGate
        onChoose={(mode, extra) => {
          // `extra` carries the wallet address for "wallet", or the admin
          // passcode for "admin". Route it to the right slot.
          if (mode === "admin") {
            setAdminPasscode(extra ?? null);
            setWalletAddress(null);
          } else {
            setWalletAddress(extra ?? null);
            setAdminPasscode(null);
          }
          setAuthMode(mode);
        }}
      />
    );
  }

  if (!username) {
    return (
      <Lobby
        onJoin={(name, char) => {
          setCharacter(char);
          setUsername(name);
        }}
      />
    );
  }

  return (
    <Suspense fallback={<div style={{ width: "100vw", height: "100vh", background: "#0a0a1a" }} />}>
      <Game username={username} character={character} authMode={authMode} walletAddress={walletAddress} adminPasscode={adminPasscode} />
    </Suspense>
  );
}
