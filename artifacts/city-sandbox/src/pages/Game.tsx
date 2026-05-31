import { useEffect, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import { useNemoWallet } from "../hooks/useNemoWallet";
import { useRpSocket } from "../hooks/useRpSocket";
import { useProximityVoice } from "../hooks/useProximityVoice";
import GameScene from "../game/GameScene";
import type { CharacterId } from "../game/character/characterCatalog";

interface GameProps {
  username: string;
  character?: CharacterId;
  authMode?: import("../shared/types").AuthMode;
  /** Verified-at-AuthGate Solana address (wallet mode only). */
  walletAddress?: string | null;
}

export default function Game({ username, character = "classic", authMode = "wallet", walletAddress = null }: GameProps) {
  const isGuest = authMode === "guest";
  // Batch B: Phantom signer for the pre-join wallet-ownership handshake.
  const { signMessage } = useNemoWallet();
  const {
    socket,
    myId,
    connected,
    playerCount,
    gameState,
    setGameState,
    emitPlayerUpdate,
    emitVehicleUpdate,
  } = useSocket(username, character, authMode, walletAddress, signMessage);

  // Attach rp:profile / rp:profileUpdate / rp:toast listeners as soon as
  // the socket instance exists — BEFORE the myId/ready guard below. This
  // prevents the race where the server emits rp:profile during the join
  // handshake but GameScene hasn't mounted yet (it waits for myId).
  const {
    rpProfile,
    rpToasts,
    dismissToast,
    pushToast,
    canDriveVehicle,
    wantedByPlayerId,
    cuffedPlayers,
    pendingFine,
    emitInteract,
    emitLicenseCheckpoint,
    emitBuyVehicle,
    emitToggleLock,
    emitToggleDuty,
    emitJobCheckpoint,
    emitBankDeposit,
    emitBankWithdraw,
    emitIssueWarrant,
    emitArrest,
    emitCuff,
    emitUncuff,
    emitIssueFine,
    emitRespondFine,
    factionMessages,
    emitFactionChat,
    factions,
    onlineFactionPlayers,
    emitListFactions,
    emitListOnlinePlayers,
    emitAdminSetFaction,
    gangStatus,
    gangPresenceEvents,
    emitGangStatus,
    emitGangAction,
    gangJoinRequests,
    gangJoinResult,
    gangJoinRequestSent,
    emitGangJoinRequest,
    emitGangJoinResponse,
    dismissGangJoinResult,
    gangRoster,
    emitGangRoster,
    emitGangSetRank,
    emitGangRemoveMember,
    activeGangMission,
    missionCooldownUntil,
    emitGangMissionStart,
    emitGangMissionCheckpoint,
    gangTerritoryStatus,
    emitGangTerritoryStatus,
    emitGangTerritoryPulse,
    cityAnnouncements,
    emitCityAnnounce,
    cityConfig,
    emitSetTaxRate,
    emitCityGrant,
    cityProjects,
    emitCityProjectFund,
    cityDashboard,
    emitGetCityDashboard,
    cityLedger,
    emitGetCityLedger,
    receivedID,
    emitShowID,
    emitPoliceInspectID,
    dismissReceivedID,
    playerInventory,
    emitGetInventory,
    houses,
    nemoGang,
    nemoSign,
    emitNemoRequestNonce,
    emitNemoVerify,
    houseTeleportRef,
    emitGetHouses,
    emitBuyHouse,
    emitEnterHouse,
    emitExitHouse,
    globalMessages,
    emitGlobalChat,
  } = useRpSocket(socket);

  // Phase comms: proximity voice. getSelfPos / getPeerPos read live positions
  // from the authoritative gameState so the volume-falloff loop tracks movement.
  const getSelfPos = () => {
    const me = gameState.players[myId];
    return me ? { x: me.x, z: me.z } : { x: 0, z: 0 };
  };
  const getPeerPos = (peerId: string) => {
    const p = gameState.players[peerId];
    return p ? { x: p.x, z: p.z } : null;
  };
  const { micOn, speaking, toggleMic } = useProximityVoice(socket, myId, getPeerPos, getSelfPos);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (myId) setReady(true);
  }, [myId]);

  if (!ready) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#0a0a1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Courier New', monospace",
          color: "#00e5ff",
          fontSize: 20,
          letterSpacing: 4,
        }}
      >
        CONNECTING...
      </div>
    );
  }

  return (
    <GameScene
      myId={myId}
      username={username}
      character={character}
      playerCount={playerCount}
      connected={connected}
      gameState={gameState}
      setGameState={setGameState}
      emitPlayerUpdate={emitPlayerUpdate}
      emitVehicleUpdate={emitVehicleUpdate}
      rpProfile={rpProfile}
      rpToasts={rpToasts}
      dismissToast={dismissToast}
      pushToast={pushToast}
      canDriveVehicle={canDriveVehicle}
      emitRpInteract={emitInteract}
      emitLicenseCheckpoint={emitLicenseCheckpoint}
      emitBuyVehicle={emitBuyVehicle}
      emitToggleLock={emitToggleLock}
      emitToggleDuty={emitToggleDuty}
      emitJobCheckpoint={emitJobCheckpoint}
      emitBankDeposit={emitBankDeposit}
      emitBankWithdraw={emitBankWithdraw}
      emitIssueWarrant={emitIssueWarrant}
      emitArrest={emitArrest}
      wantedByPlayerId={wantedByPlayerId}
      cuffedPlayers={cuffedPlayers}
      emitCuff={emitCuff}
      emitUncuff={emitUncuff}
      pendingFine={pendingFine}
      emitIssueFine={emitIssueFine}
      emitRespondFine={emitRespondFine}
      factionMessages={factionMessages}
      emitFactionChat={emitFactionChat}
      factions={factions}
      onlineFactionPlayers={onlineFactionPlayers}
      emitListFactions={emitListFactions}
      emitListOnlinePlayers={emitListOnlinePlayers}
      emitAdminSetFaction={emitAdminSetFaction}
      gangStatus={gangStatus}
      gangPresenceEvents={gangPresenceEvents}
      emitGangStatus={emitGangStatus}
      emitGangAction={emitGangAction}
      gangJoinRequests={gangJoinRequests}
      gangJoinResult={gangJoinResult}
      gangJoinRequestSent={gangJoinRequestSent}
      emitGangJoinRequest={emitGangJoinRequest}
      emitGangJoinResponse={emitGangJoinResponse}
      dismissGangJoinResult={dismissGangJoinResult}
      gangRoster={gangRoster}
      emitGangRoster={emitGangRoster}
      emitGangSetRank={emitGangSetRank}
      emitGangRemoveMember={emitGangRemoveMember}
      activeGangMission={activeGangMission}
      missionCooldownUntil={missionCooldownUntil}
      emitGangMissionStart={emitGangMissionStart}
      emitGangMissionCheckpoint={emitGangMissionCheckpoint}
      gangTerritoryStatus={gangTerritoryStatus}
      emitGangTerritoryStatus={emitGangTerritoryStatus}
      emitGangTerritoryPulse={emitGangTerritoryPulse}
      cityAnnouncements={cityAnnouncements}
      emitCityAnnounce={emitCityAnnounce}
      cityConfig={cityConfig}
      emitSetTaxRate={emitSetTaxRate}
      emitCityGrant={emitCityGrant}
      cityProjects={cityProjects}
      emitCityProjectFund={emitCityProjectFund}
      cityDashboard={cityDashboard}
      emitGetCityDashboard={emitGetCityDashboard}
      cityLedger={cityLedger}
      emitGetCityLedger={emitGetCityLedger}
      receivedID={receivedID}
      emitShowID={emitShowID}
      emitPoliceInspectID={emitPoliceInspectID}
      dismissReceivedID={dismissReceivedID}
      playerInventory={playerInventory}
      emitGetInventory={emitGetInventory}
      houses={houses}
      isGuest={isGuest}
      nemoGang={nemoGang}
      nemoSign={nemoSign}
      emitNemoRequestNonce={emitNemoRequestNonce}
      emitNemoVerify={emitNemoVerify}
      houseTeleportRef={houseTeleportRef}
      emitGetHouses={emitGetHouses}
      emitBuyHouse={emitBuyHouse}
      emitEnterHouse={emitEnterHouse}
      emitExitHouse={emitExitHouse}
      globalMessages={globalMessages}
      emitGlobalChat={emitGlobalChat}
      micOn={micOn}
      toggleMic={toggleMic}
      voiceSpeaking={speaking}
    />
  );
}
