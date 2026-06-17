import * as THREE from 'three';
import { Gugugaga } from '../characters/Gugugaga';
import { useGameStore } from '../../../store/useGameStore';
import { CASINO_SEATS, CASINO_TABLE } from '../../../lib/zones';

const flat = (color: string) => new THREE.MeshBasicMaterial({ color });

/** 纯色块材质缓存 */
const MAT = {
  floor: flat('#f5efe6'),
  rug: flat('#ebe0d0'),
  wall: flat('#e8ddd0'),
  wallTrim: flat('#d4c8b8'),
  sofaBody: flat('#8b7355'),
  sofaCushion: flat('#d4c8b8'),
  leather: flat('#c9b896'),
  leatherDark: flat('#b8a486'),
  felt: flat('#4a8f62'),
  feltLine: flat('#3d7a52'),
  chipGold: flat('#d4af37'),
  chipGreen: flat('#48d093'),
  chipBlue: flat('#56a3ff'),
  cardWhite: flat('#f8f8f8'),
  cardRed: flat('#e85050'),
  cardBlack: flat('#2a2a2a'),
};

function FlatFloor({ w, d, color }: { w: number; d: number; color: THREE.MeshBasicMaterial }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={color}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

/** 休闲区半围合隔断 */
function LoungePartition() {
  return (
    <group>
      <mesh position={[0, 0.55, 5.2]} material={MAT.wall}>
        <boxGeometry args={[14, 1.1, 0.14]} />
      </mesh>
      <mesh position={[-6.8, 0.55, 3.2]} material={MAT.wall}>
        <boxGeometry args={[0.14, 1.1, 4.2]} />
      </mesh>
      <mesh position={[6.8, 0.55, 3.2]} material={MAT.wall}>
        <boxGeometry args={[0.14, 1.1, 4.2]} />
      </mesh>
      <mesh position={[0, 1.05, 5.2]} material={MAT.wallTrim}>
        <boxGeometry args={[14.2, 0.08, 0.18]} />
      </mesh>
    </group>
  );
}

/** 环绕牌桌的空闲沙发座位（俯视扁卡通） */
function PlayerSeat({ x, z, rotY }: { x: number; z: number; rotY: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.22, 0.28]} material={MAT.sofaBody}>
        <boxGeometry args={[1.05, 0.38, 0.55]} />
      </mesh>
      <mesh position={[0, 0.38, -0.18]} material={MAT.sofaBody}>
        <boxGeometry args={[1.05, 0.42, 0.22]} />
      </mesh>
      <mesh position={[0, 0.42, 0.05]} material={MAT.sofaCushion}>
        <boxGeometry args={[0.92, 0.1, 0.48]} />
      </mesh>
      <mesh position={[-0.48, 0.32, 0.05]} material={MAT.sofaBody}>
        <boxGeometry args={[0.12, 0.32, 0.62]} />
      </mesh>
      <mesh position={[0.48, 0.32, 0.05]} material={MAT.sofaBody}>
        <boxGeometry args={[0.12, 0.32, 0.62]} />
      </mesh>
    </group>
  );
}

function ChipStack({ x, z, color, count = 3 }: { x: number; z: number; color: THREE.MeshBasicMaterial; count?: number }) {
  return (
    <group position={[x, 0.52, z]}>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} position={[0, i * 0.035, 0]} material={color}>
          <cylinderGeometry args={[0.1, 0.1, 0.03, 12]} />
        </mesh>
      ))}
    </group>
  );
}

function PlayingCard({ x, z, rotY, suit }: { x: number; z: number; rotY: number; suit: 'red' | 'black' }) {
  return (
    <group position={[x, 0.545, z]} rotation={[0, rotY, 0]}>
      <mesh material={MAT.cardWhite}>
        <boxGeometry args={[0.16, 0.008, 0.22]} />
      </mesh>
      <mesh position={[0, 0.006, 0.06]} material={suit === 'red' ? MAT.cardRed : MAT.cardBlack}>
        <circleGeometry args={[0.035, 8]} />
      </mesh>
    </group>
  );
}

/** 俯视德州牌桌 — 浅皮革台面 + 绿色牌面区 */
function PokerTable() {
  const { x, z } = CASINO_TABLE;
  return (
    <group position={[x, 0, z]}>
      {/* 浅皮革外圈 */}
      <mesh position={[0, 0.46, 0]} material={MAT.leather}>
        <cylinderGeometry args={[2.35, 2.35, 0.1, 32]} />
      </mesh>
      <mesh position={[0, 0.52, 0]} material={MAT.leatherDark}>
        <cylinderGeometry args={[2.15, 2.15, 0.04, 32]} />
      </mesh>
      {/* 绿色牌面 */}
      <mesh position={[0, 0.54, 0]} material={MAT.felt}>
        <cylinderGeometry args={[1.55, 1.55, 0.02, 32]} />
      </mesh>
      <mesh position={[0, 0.545, 0]} rotation={[Math.PI / 2, 0, 0]} material={MAT.feltLine}>
        <torusGeometry args={[1.2, 0.025, 8, 32]} />
      </mesh>

      {/* 公共牌 */}
      {[-0.36, -0.18, 0, 0.18, 0.36].map((ox, i) => (
        <PlayingCard key={i} x={ox} z={0} rotY={0} suit={i % 2 === 0 ? 'red' : 'black'} />
      ))}

      {/* 金币筹码 */}
      <ChipStack x={-0.75} z={0.55} color={MAT.chipGold} count={4} />
      <ChipStack x={0.75} z={-0.45} color={MAT.chipGreen} count={3} />
      <ChipStack x={0.55} z={0.65} color={MAT.chipBlue} count={3} />
      <ChipStack x={-0.55} z={-0.55} color={MAT.chipGold} count={2} />

      {/* 荷官侧备用牌堆 */}
      <group position={[-1.05, 0.52, -0.15]}>
        {[0, 1, 2].map(i => (
          <mesh key={i} position={[i * 0.02, i * 0.012, 0]} rotation={[0, 0.15 * i, 0]} material={MAT.cardWhite}>
            <boxGeometry args={[0.14, 0.008, 0.19]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export interface CasinoLoungeProps {
  onSelectDealer: () => void;
  onSelectTable: () => void;
}

/** 德州 lounge — 俯视扁卡通 2.5D 牌桌场景 */
export function CasinoLounge({ onSelectDealer, onSelectTable }: CasinoLoungeProps) {
  return (
    <group>
      <FlatFloor w={20} d={14} color={MAT.floor} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0.5]} material={MAT.rug}>
        <planeGeometry args={[12, 9]} />
      </mesh>

      <LoungePartition />

      {CASINO_SEATS.map(seat => (
        <PlayerSeat key={seat.id} x={seat.x} z={seat.z} rotY={seat.rotY} />
      ))}

      <PokerTable />

      {/* 暖色柔光 */}
      <pointLight color="#ffe8c8" intensity={0.55} distance={14} position={[0, 4, 0]} />
      <pointLight color="#fff0d8" intensity={0.25} distance={10} position={[-2, 2.5, 2]} />

      {/* 荷官企鹅 — 站在牌桌西侧 */}
      <group
        position={[CASINO_TABLE.x - 3.6, 0, CASINO_TABLE.z + 0.2]}
        onClick={(e) => { e.stopPropagation(); onSelectDealer(); }}
      >
        <Gugugaga
          role="dealer"
          accentColor="#d4af37"
          label="荷官 Jack"
          status="德州扑克"
          scale={1.05}
          onClick={onSelectDealer}
        />
      </group>

      {/* 牌桌点击区 */}
      <mesh
        position={[CASINO_TABLE.x, 0.5, CASINO_TABLE.z]}
        onClick={(e) => { e.stopPropagation(); onSelectTable(); }}
      >
        <cylinderGeometry args={[2.6, 2.6, 0.08, 20]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
