import { Suspense, lazy, useState } from "react";
import Lobby from "@/pages/Lobby";

// Lazy-load Game so its module graph (GameScene → LocalPlayer → CharacterAvatar
// → AnimatedCharacter, which calls useGLTF.preload(...) at module top level)
// does not evaluate while the user is still on the Lobby. This is what keeps
// the heavy character GLBs from being fetched before JOIN WORLD is clicked.
const Game = lazy(() => import("@/pages/Game"));

type CharacterChoice = "classic" | "simple";

export default function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [character, setCharacter] = useState<CharacterChoice>("classic");

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
      <Game username={username} character={character} />
    </Suspense>
  );
}
