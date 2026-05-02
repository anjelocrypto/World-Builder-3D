import * as THREE from "three";
import { useMemo } from "react";
import { BUILDINGS, RAMPS } from "../shared/cityData";

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[300, 300]} />
      <meshLambertMaterial color="#2c2c2c" />
    </mesh>
  );
}

function Roads() {
  const roadColor = "#1a1a1a";
  const lineColor = "#f0c040";
  const sideColor = "#333";
  return (
    <group>
      {/* N-S roads at x = -45, 0, 45 */}
      {[-45, 0, 45].map((x) => (
        <group key={`ns-${x}`}>
          <mesh position={[x, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[20, 200]} />
            <meshLambertMaterial color={roadColor} />
          </mesh>
          {/* Center line dashes */}
          {Array.from({ length: 20 }, (_, i) => (
            <mesh key={i} position={[x, 0.02, -95 + i * 10]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.3, 4]} />
              <meshLambertMaterial color={lineColor} />
            </mesh>
          ))}
          {/* Sidewalks */}
          <mesh position={[x - 11, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2, 200]} />
            <meshLambertMaterial color={sideColor} />
          </mesh>
          <mesh position={[x + 11, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2, 200]} />
            <meshLambertMaterial color={sideColor} />
          </mesh>
        </group>
      ))}
      {/* E-W roads at z = -45, 0, 45 */}
      {[-45, 0, 45].map((z) => (
        <group key={`ew-${z}`}>
          <mesh position={[0, 0.01, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[200, 20]} />
            <meshLambertMaterial color={roadColor} />
          </mesh>
          {Array.from({ length: 20 }, (_, i) => (
            <mesh key={i} position={[-95 + i * 10, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[4, 0.3]} />
              <meshLambertMaterial color={lineColor} />
            </mesh>
          ))}
          <mesh position={[0, 0.05, z - 11]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[200, 2]} />
            <meshLambertMaterial color={sideColor} />
          </mesh>
          <mesh position={[0, 0.05, z + 11]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[200, 2]} />
            <meshLambertMaterial color={sideColor} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b, i) => (
        <group key={i} position={[b.x, b.h / 2, b.z]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshLambertMaterial color={b.color} />
          </mesh>
          {/* Windows: thin emissive strips */}
          {Array.from({ length: Math.floor(b.h / 4) }, (_, wi) => (
            <mesh key={wi} position={[0, -b.h / 2 + 2 + wi * 4, b.d / 2 + 0.01]}>
              <planeGeometry args={[b.w * 0.6, 1.2]} />
              <meshBasicMaterial color="#ffffaa" transparent opacity={0.7} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function StreetLights() {
  const intersections = useMemo(() => {
    const pts: [number, number][] = [];
    for (const x of [-45, 0, 45]) {
      for (const z of [-45, 0, 45]) {
        pts.push([x, z]);
      }
    }
    return pts;
  }, []);

  return (
    <group>
      {intersections.map(([x, z], i) => (
        <group key={i} position={[x + 12, 0, z + 12]}>
          {/* Pole */}
          <mesh position={[0, 3, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 6, 6]} />
            <meshLambertMaterial color="#555" />
          </mesh>
          {/* Lamp head */}
          <mesh position={[0, 6.2, 0]}>
            <boxGeometry args={[0.8, 0.3, 0.8]} />
            <meshBasicMaterial color="#ffffc0" />
          </mesh>
          {/* Point light */}
          <pointLight position={[0, 6.5, 0]} color="#ffffa0" intensity={8} distance={18} decay={2} />
        </group>
      ))}
    </group>
  );
}

function Ramps() {
  return (
    <group>
      {RAMPS.map((r, i) => (
        <group key={i} position={[r.x, 0.5, r.z]} rotation={[0, r.rotY, 0]}>
          {/* Ramp surface */}
          <mesh position={[0, 0, 0]} rotation={[-0.3, 0, 0]}>
            <boxGeometry args={[8, 0.3, 6]} />
            <meshLambertMaterial color="#666" />
          </mesh>
          {/* Ramp supports */}
          <mesh position={[0, -0.5, 2.5]}>
            <boxGeometry args={[8, 1, 0.4]} />
            <meshLambertMaterial color="#555" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Skybox() {
  return (
    <mesh>
      <sphereGeometry args={[250, 16, 16]} />
      <meshBasicMaterial color="#0a0a1a" side={THREE.BackSide} />
    </mesh>
  );
}

export default function CityMap() {
  return (
    <group>
      <Skybox />
      <Ground />
      <Roads />
      <Buildings />
      <StreetLights />
      <Ramps />
      {/* Fog */}
      <fog attach="fog" args={["#0a0a1a", 60, 180]} />
    </group>
  );
}
