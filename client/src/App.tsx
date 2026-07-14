import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stats } from "@react-three/drei";
import type { Mesh } from "three";
import { APP_NAME } from "@caysonverse/shared/constants";

/** Slowly rotating box — smoke-tests react + fiber + drei + three together. */
function SpinningBox() {
  const ref = useRef<Mesh>(null);
  useFrame((_state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.x += delta * 0.4;
    ref.current.rotation.y += delta * 0.6;
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#5b8cff" />
    </mesh>
  );
}

export default function App() {
  return (
    <>
      <Canvas camera={{ position: [3, 3, 3], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <SpinningBox />
        <Stats />
      </Canvas>
      <div
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          color: "#e6e9f2",
          font: "600 18px/1.2 system-ui, sans-serif",
          letterSpacing: "0.02em",
          pointerEvents: "none",
        }}
      >
        {APP_NAME}
      </div>
    </>
  );
}
