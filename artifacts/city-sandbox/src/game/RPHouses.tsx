/**
 * Phase 12A: RPHouses — low-poly sealed shells for the starter player houses.
 *
 * Each house is a SEALED 8×8 shell (4 solid walls, NO walk-in gap) matching the
 * RP_HOUSE_WALL_BOXES colliders exactly. The "door" is a decorative panel on the
 * front face plus a subtle ground marker at the interaction point; there is no
 * physical opening — owner-only entry is granted only by the server teleport.
 *
 * Purely visual + data-driven from RP_HOUSES. Ownership/prompts are handled in
 * the HUD; this component renders the same geometry for everyone.
 */

import { RP_HOUSES, RP_WALL_THICKNESS, type RpHouseDef } from "../shared/rpTypes";

const WALL_HEIGHT = 3.2;
const WALL_COLOR = "#6b5d4f";
const ROOF_COLOR = "#7a4b3a";
const FLOOR_COLOR = "#4a4036";
const DOOR_COLOR = "#3a2c20";
const SIGN_COLOR = "#caa84a";
const MARKER_COLOR = "#5fae5f";

function HouseMesh({ h }: { h: RpHouseDef }) {
  const hw = h.w / 2;
  const hd = h.d / 2;
  const t = RP_WALL_THICKNESS;

  // Which face holds the (decorative) door — derived from the door point's
  // offset from the house centre, so geometry follows the data.
  const dxDoor = h.door[0] - h.x;
  const dzDoor = h.door[2] - h.z;
  const doorOnZ = Math.abs(dzDoor) >= Math.abs(dxDoor);
  const doorSign = doorOnZ ? Math.sign(dzDoor) || 1 : Math.sign(dxDoor) || 1;

  return (
    <group>
      {/* Interior floor */}
      <mesh position={[h.x, 0.02, h.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[h.w - t, h.d - t]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={0.95} metalness={0.03} />
      </mesh>

      {/* 4 solid walls (mirror rpHouseWallBoxes) */}
      <mesh position={[h.x, WALL_HEIGHT / 2, h.z - hd]} castShadow receiveShadow>
        <boxGeometry args={[h.w, WALL_HEIGHT, t]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.82} metalness={0.05} />
      </mesh>
      <mesh position={[h.x, WALL_HEIGHT / 2, h.z + hd]} castShadow receiveShadow>
        <boxGeometry args={[h.w, WALL_HEIGHT, t]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.82} metalness={0.05} />
      </mesh>
      <mesh position={[h.x - hw, WALL_HEIGHT / 2, h.z]} castShadow receiveShadow>
        <boxGeometry args={[t, WALL_HEIGHT, h.d]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.82} metalness={0.05} />
      </mesh>
      <mesh position={[h.x + hw, WALL_HEIGHT / 2, h.z]} castShadow receiveShadow>
        <boxGeometry args={[t, WALL_HEIGHT, h.d]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.82} metalness={0.05} />
      </mesh>

      {/* Roof */}
      <mesh position={[h.x, WALL_HEIGHT + 0.15, h.z]} castShadow>
        <boxGeometry args={[h.w + 0.6, 0.3, h.d + 0.6]} />
        <meshStandardMaterial color={ROOF_COLOR} roughness={0.7} metalness={0.06} />
      </mesh>

      {/* Decorative door panel on the front face */}
      <mesh
        position={
          doorOnZ
            ? [h.x, 1.05, h.z + doorSign * (hd + 0.01)]
            : [h.x + doorSign * (hw + 0.01), 1.05, h.z]
        }
        castShadow
      >
        <boxGeometry args={doorOnZ ? [1.4, 2.1, 0.12] : [0.12, 2.1, 1.4]} />
        <meshStandardMaterial color={DOOR_COLOR} roughness={0.6} metalness={0.1} />
      </mesh>

      {/* Subtle name plaque above the door */}
      <mesh
        position={
          doorOnZ
            ? [h.x, 2.55, h.z + doorSign * (hd + 0.02)]
            : [h.x + doorSign * (hw + 0.02), 2.55, h.z]
        }
      >
        <boxGeometry args={doorOnZ ? [1.8, 0.4, 0.08] : [0.08, 0.4, 1.8]} />
        <meshStandardMaterial color={SIGN_COLOR} emissive={SIGN_COLOR} emissiveIntensity={0.25} roughness={0.5} />
      </mesh>

      {/* Subtle ground marker at the interaction door point */}
      <mesh position={[h.door[0], 0.04, h.door[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.25, 28]} />
        <meshStandardMaterial color={MARKER_COLOR} emissive={MARKER_COLOR} emissiveIntensity={0.35} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

export default function RPHouses() {
  return (
    <group>
      {RP_HOUSES.map((h) => (
        <HouseMesh key={h.slug} h={h} />
      ))}
    </group>
  );
}
