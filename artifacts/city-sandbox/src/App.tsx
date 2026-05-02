import { useState } from "react";
import Lobby from "@/pages/Lobby";
import Game from "@/pages/Game";

export default function App() {
  const [username, setUsername] = useState<string | null>(null);

  if (!username) {
    return (
      <Lobby
        onJoin={(name) => setUsername(name)}
        playerCount={1}
      />
    );
  }

  return <Game username={username} />;
}
