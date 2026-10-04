import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";

export type CropGrowthArchetype = "Seedling" | "Vegetative" | "Flowering" | "Fruit Dev";

export interface TelemetryBadge {
  id: string;
  label: string;
  value: string;
  interpretation: string;
  x: number;
  y: number;
}

export interface CropDigitalTwinVisualProps {
  stage?: string;
  age?: number;
  daysSincePlanting?: number;
  simMode: "Past" | "Current" | "Prediction";
  foliarHealth: number;       // 0 - 100
  ndvi: number;               // 0.0 - 1.0
  waterStress?: number;       // 0 - 100
  yieldEst?: string;
  harvestReadyPct?: number;
  telemetryBadges: TelemetryBadge[];
  hoveredBadge: string | null;
  onHoverBadge: (id: string | null) => void;
  onBadgeClick: (badge: TelemetryBadge) => void;
  previewStageOverride?: CropGrowthArchetype | null;
  onSelectStageOverride?: (stage: CropGrowthArchetype | null) => void;
}

/**
 * Calculates the exact days since planting from plot metadata, age, or stage.
 * Defaults to 1095 days (3 years) for mature/fruit-bearing oil palm plots.
 */
export function calculateDaysSincePlanting(plot?: {
  plantingDate?: string;
  age?: number;
  stage?: string | null;
}): number {
  if (!plot) return 1095;
  if (plot.plantingDate) {
    const diff = Math.floor((Date.now() - new Date(plot.plantingDate).getTime()) / (1000 * 60 * 60 * 24));
    if (!isNaN(diff) && diff > 0) return diff;
  }
  if (typeof plot.age === "number" && plot.age > 0) {
    return Math.round(plot.age * 365);
  }
  const s = (plot.stage || "").toLowerCase();
  if (s.includes("fruit") || s.includes("mature") || s.includes("harvest") || s.includes("ffb")) {
    return 1095;
  }
  if (s.includes("flowering") || s.includes("bloom")) {
    return 800;
  }
  if (s.includes("vegetative") || s.includes("branch")) {
    return 500;
  }
  return 120;
}

/**
 * Calculates the active developmental archetype from timeline data (days since planting, age, stage) and simulation mode.
 * Matches 'Fruit Dev' for 3-year-old crops (1095 days).
 */
export function getGrowthStageArchetype(
  stageString?: string | null,
  age?: number,
  daysSincePlanting?: number,
  simMode: "Past" | "Current" | "Prediction" = "Current"
): CropGrowthArchetype {
  // 1. Determine timeline days since planting from explicit parameter or age
  const days = daysSincePlanting !== undefined && daysSincePlanting > 0
    ? daysSincePlanting
    : (age !== undefined && age > 0 ? Math.round(age * 365) : undefined);

  const s = (stageString || "").toLowerCase().trim();

  let base: CropGrowthArchetype;

  // 2. Timeline physiological progression:
  // - 0 to 364 days (< 1 yr): Seedling
  // - 365 to 729 days (1 to 2 yrs): Vegetative
  // - 730 to 999 days (2 to 2.7 yrs): Flowering
  // - 1000+ days (2.7+ yrs, matching 3-year-old crops with 1095 days): Fruit Dev
  if (days !== undefined) {
    if (days >= 1000) {
      base = "Fruit Dev";
    } else if (days >= 730) {
      base = "Flowering";
    } else if (days >= 365) {
      base = "Vegetative";
    } else {
      base = "Seedling";
    }
  } else if (age !== undefined) {
    if (age >= 2.7) {
      base = "Fruit Dev";
    } else if (age >= 2.0) {
      base = "Flowering";
    } else if (age >= 1.0) {
      base = "Vegetative";
    } else {
      base = "Seedling";
    }
  } else {
    // If neither days nor age is available, fall back to stage text
    if (s.includes("fruit") || s.includes("mature") || s.includes("harvest") || s.includes("ffb")) {
      base = "Fruit Dev";
    } else if (s.includes("flowering") || s.includes("bloom")) {
      base = "Flowering";
    } else if (s.includes("vegetative") || s.includes("branch")) {
      base = "Vegetative";
    } else if (s.includes("seedling") || s.includes("sprout") || s.includes("nursery")) {
      base = "Seedling";
    } else {
      base = "Fruit Dev";
    }
  }

  // Explicit stage string overrides (unless it's an unverified "seedling" default on an older crop)
  if (s.includes("fruit") || s.includes("mature") || s.includes("harvest") || s.includes("ffb")) {
    base = "Fruit Dev";
  } else if ((s.includes("flowering") || s.includes("bloom")) && (days === undefined || days < 1400)) {
    base = "Flowering";
  } else if ((s.includes("vegetative") || s.includes("branch")) && (days === undefined || days < 730)) {
    base = "Vegetative";
  }

  // 3. Adjust for simMode timeline progression:
  // "Past": shifts back one developmental stage
  // "Prediction": advances forward one developmental stage
  if (simMode === "Past") {
    if (base === "Fruit Dev") return "Flowering";
    if (base === "Flowering") return "Vegetative";
    if (base === "Vegetative") return "Seedling";
    return "Seedling";
  }

  if (simMode === "Prediction") {
    if (base === "Seedling") return "Vegetative";
    if (base === "Vegetative") return "Flowering";
    if (base === "Flowering") return "Fruit Dev";
    return "Fruit Dev";
  }

  return base;
}

// Stage-specific coordinates for telemetry hotspot badges to overlay naturally
const BADGE_POSITIONS: Record<CropGrowthArchetype, Record<string, { x: number; y: number }>> = {
  "Seedling": {
    temp: { x: 26, y: 38 },
    humidity: { x: 74, y: 44 },
    moisture: { x: 30, y: 75 },
    ndvi: { x: 65, y: 46 },
    health: { x: 50, y: 28 },
    wind: { x: 44, y: 60 }
  },
  "Vegetative": {
    temp: { x: 20, y: 35 },
    humidity: { x: 78, y: 36 },
    moisture: { x: 24, y: 74 },
    ndvi: { x: 74, y: 48 },
    health: { x: 50, y: 22 },
    wind: { x: 38, y: 64 }
  },
  "Flowering": {
    temp: { x: 20, y: 35 },
    humidity: { x: 78, y: 36 },
    moisture: { x: 24, y: 74 },
    ndvi: { x: 74, y: 48 },
    health: { x: 50, y: 22 },
    wind: { x: 38, y: 64 }
  },
  "Fruit Dev": {
    temp: { x: 18, y: 32 },
    humidity: { x: 82, y: 36 },
    moisture: { x: 18, y: 78 },
    ndvi: { x: 80, y: 52 },
    health: { x: 50, y: 16 },
    wind: { x: 42, y: 68 }
  }
};

export const CropDigitalTwinVisual: React.FC<CropDigitalTwinVisualProps> = ({
  stage,
  age,
  daysSincePlanting,
  simMode,
  foliarHealth,
  ndvi,
  waterStress = 0,
  yieldEst,
  harvestReadyPct = 72,
  telemetryBadges,
  hoveredBadge,
  onHoverBadge,
  onBadgeClick,
  previewStageOverride,
  onSelectStageOverride
}) => {
  // Determine effective archetype directly from timeline data
  const computedArchetype = getGrowthStageArchetype(stage, age, daysSincePlanting, simMode);
  const activeArchetype = previewStageOverride || computedArchetype;

  // Frond coloration reactive to foliar health & NDVI
  const isHealthy = foliarHealth >= 70;
  const isStressed = foliarHealth < 50 || waterStress > 60;
  
  const frondColorPrimary = isStressed
    ? "#ca8a04" // amber/yellow-green
    : isHealthy
    ? "#16a34a" // lush emerald
    : "#22c55e"; // bright green

  const frondColorSecondary = isStressed
    ? "#854d0e"
    : isHealthy
    ? "#14532d"
    : "#15803d";

  const leafTipGlow = isHealthy ? "#4ade80" : isStressed ? "#facc15" : "#86efac";

  // Position lookup for current archetype
  const currentBadgeCoords = BADGE_POSITIONS[activeArchetype] || BADGE_POSITIONS["Fruit Dev"];

  const stagesList: Array<{ id: CropGrowthArchetype; label: string; icon: string; desc: string }> = [
    { id: "Seedling", label: "Seedling", icon: "🌱", desc: "Root & shoot emergence (0-1 yr)" },
    { id: "Vegetative", label: "Vegetative", icon: "🌿", desc: "Canopy architecture (1-2 yrs)" },
    { id: "Flowering", label: "Flowering", icon: "🌼", desc: "Inflorescence & bloom (2-2.7 yrs)" },
    { id: "Fruit Dev", label: "Fruit Dev", icon: "🌴", desc: "Mature bunches & canopy (2.8+ yrs, 1095d)" }
  ];

  // =========================================================================
  // CONDITIONAL ASSET MAPPING: Dedicated sub-renderers for each archetype
  // =========================================================================

  // Asset 1: Minimalist sprout and root structure
  const renderSeedlingAsset = () => (
    <g id="seedling-stage-asset">
      {/* Minimalist Root Structure */}
      <g id="seedling-roots">
        <path
          d="M 100 144 C 99 156, 102 168, 100 182"
          stroke="url(#rootGrad)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M 100 152 Q 88 158 82 165"
          stroke="#b45309"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.8"
        />
        <path
          d="M 100 158 Q 112 164 118 172"
          stroke="#b45309"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.8"
        />
        <path
          d="M 100 166 Q 92 172 88 178"
          stroke="#d97706"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.7"
        />

        {/* Animated Nutrient Uptake Pulse Dot */}
        <circle cx="100" cy="178" r="1.5" fill="#34d399">
          <animate
            attributeName="cy"
            values="180;144"
            dur="2.8s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.2;1;0"
            dur="2.8s"
            repeatCount="indefinite"
          />
        </circle>
      </g>

      {/* Seed / Nursery Germination Hull */}
      <ellipse cx="100" cy="144" rx="7" ry="4.5" fill="#451a03" stroke="#78350f" strokeWidth="1" />
      <ellipse cx="100" cy="143" rx="4" ry="2" fill="#78350f" opacity="0.6" />

      {/* Gentle Swaying Shoot & Sprout Leaves */}
      <g id="seedling-shoot" style={{ transformOrigin: "100px 144px" }}>
        <path
          d="M 100 142 C 99 125, 102 108, 100 88"
          stroke="url(#seedlingShootGrad)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />

        {/* Left Juvenile Cotyledon / Leaflet */}
        <path
          d="M 100 115 C 85 108, 72 100, 68 86 C 80 88, 92 98, 100 115 Z"
          fill="url(#seedlingLeafGrad)"
          stroke="#15803d"
          strokeWidth="0.8"
        />
        <path d="M 100 115 Q 84 102 70 88" stroke="#86efac" strokeWidth="0.7" fill="none" opacity="0.7" />

        {/* Right Juvenile Cotyledon / Leaflet */}
        <path
          d="M 100 106 C 114 98, 126 90, 130 76 C 120 78, 108 88, 100 106 Z"
          fill="url(#seedlingLeafGrad)"
          stroke="#15803d"
          strokeWidth="0.8"
        />
        <path d="M 100 106 Q 116 94 128 78" stroke="#86efac" strokeWidth="0.7" fill="none" opacity="0.7" />

        {/* Center Emerging Spear Leaf / Plumule */}
        <path
          d="M 100 90 C 97 78, 98 62, 100 52 C 102 62, 103 78, 100 90 Z"
          fill="#86efac"
          stroke="#22c55e"
          strokeWidth="0.8"
        />
        <circle cx="100" cy="51" r="1.5" fill="#4ade80" />
      </g>
    </g>
  );

  // Asset 2: Branching developing plant canopy structure (with flower buds if Flowering)
  const renderVegetativeFloweringAsset = (isFlowering: boolean) => (
    <g id="branching-canopy-asset">
      {/* Subterranean Roots */}
      <g id="veg-roots">
        <path d="M 100 145 C 96 160 84 172 78 184" stroke="url(#rootGrad)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M 100 145 C 104 160 116 172 122 184" stroke="url(#rootGrad)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M 100 152 C 92 162 70 166 62 172" stroke="#b45309" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 100 152 C 108 162 130 166 138 172" stroke="#b45309" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 100 160 C 98 172 100 182 99 188" stroke="#d97706" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.7" />
      </g>

      {/* Developing Trunk with Frond Bases */}
      <g id="veg-trunk">
        <path
          d="M 94 145 L 96 100 L 104 100 L 106 145 Z"
          fill="#5c3a21"
          stroke="#3f1d0b"
          strokeWidth="1"
        />
        {/* Leaf Base Scars */}
        <line x1="95" y1="135" x2="105" y2="135" stroke="#78350f" strokeWidth="1.5" />
        <line x1="96" y1="123" x2="104" y2="123" stroke="#78350f" strokeWidth="1.5" />
        <line x1="96" y1="111" x2="104" y2="111" stroke="#78350f" strokeWidth="1.5" />
      </g>

      {/* Branching Developing Fronds */}
      <g id="veg-canopy" style={{ transformOrigin: "100px 100px" }}>
        <path d="M 100 100 C 65 92 40 94 24 112" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M 100 100 C 135 92 160 94 176 112" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M 100 100 C 72 82 52 64 42 45" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M 100 100 C 128 82 148 64 158 45" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M 100 100 C 82 72 74 48 80 28" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M 100 100 C 118 72 126 48 120 28" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M 100 100 C 96 68 96 46 98 22" fill="none" stroke="#4ade80" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M 100 100 C 104 68 104 46 102 22" fill="none" stroke="#86efac" strokeWidth="2" strokeLinecap="round" />

        {/* Developing Pinnae Foliage Texture */}
        <path d="M 50 94 L 46 88 M 60 92 L 56 84 M 70 92 L 67 82" stroke={frondColorPrimary} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M 150 94 L 154 88 M 140 92 L 144 84 M 130 92 L 133 82" stroke={frondColorPrimary} strokeWidth="1.2" strokeLinecap="round" />
      </g>

      {/* Flowering Inflorescence / Bloom Additions */}
      {isFlowering && (
        <g id="flowering-inflorescence">
          <g transform="translate(90, 96)">
            <ellipse cx="0" cy="0" rx="4.5" ry="3" fill="url(#flowerGrad)" stroke="#ca8a04" strokeWidth="0.8" />
            <circle cx="-1" cy="-0.5" r="1" fill="#fef08a" />
            <circle cx="2" cy="0.5" r="0.8" fill="#fef08a" />
          </g>

          <g transform="translate(110, 96)">
            <ellipse cx="0" cy="0" rx="4.5" ry="3" fill="url(#flowerGrad)" stroke="#ca8a04" strokeWidth="0.8" />
            <circle cx="1" cy="-0.5" r="1" fill="#fef08a" />
            <circle cx="-2" cy="0.5" r="0.8" fill="#fef08a" />
          </g>

          <circle cx="88" cy="91" r="1" fill="#fef08a" opacity="0.8">
            <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="112" cy="91" r="1" fill="#fef08a" opacity="0.8">
            <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.2s" repeatCount="indefinite" />
          </circle>
        </g>
      )}
    </g>
  );

  // Asset 3: Fully developed canopy and heavy root system matching advanced crop age
  const renderFruitDevMatureAsset = () => (
    <g id="fruit-dev-mature-asset">
      {/* Heavy Anchor Roots */}
      <g id="mature-roots">
        <path d="M 100 148 C 92 165 74 175 65 188" stroke="url(#rootGrad)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        <path d="M 100 148 C 108 165 126 175 135 188" stroke="url(#rootGrad)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        <path d="M 98 155 C 80 166 58 170 48 178" stroke="#92400e" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 102 155 C 120 166 142 170 152 178" stroke="#92400e" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 100 165 C 98 176 100 186 100 192" stroke="#b45309" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.8" />
      </g>

      {/* Sturdy Textured Palm Trunk */}
      <g id="mature-trunk">
        <path
          d="M 92 148 L 95 102 L 105 102 L 108 148 Z"
          fill="url(#matureTrunkGrad)"
          stroke="#271005"
          strokeWidth="1.2"
        />
        {/* Diamond Palm Frond Scars */}
        <polygon points="98,140 102,140 100,135" fill="#271005" opacity="0.7" />
        <polygon points="98,128 102,128 100,123" fill="#271005" opacity="0.7" />
        <polygon points="98,116 102,116 100,111" fill="#271005" opacity="0.7" />
        <line x1="93" y1="142" x2="107" y2="142" stroke="#5c260a" strokeWidth="1.2" />
        <line x1="94" y1="130" x2="106" y2="130" stroke="#5c260a" strokeWidth="1.2" />
        <line x1="95" y1="118" x2="105" y2="118" stroke="#5c260a" strokeWidth="1.2" />
      </g>

      {/* Fully Expanded Umbrella Palm Canopy */}
      <g id="mature-canopy" style={{ transformOrigin: "100px 102px" }}>
        <path d="M 100 102 C 55 95 30 102 14 122" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="3" strokeLinecap="round" />
        <path d="M 100 102 C 145 95 170 102 186 122" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="3" strokeLinecap="round" />
        <path d="M 100 102 C 60 84 32 68 20 48" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M 100 102 C 140 84 168 68 180 48" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M 100 102 C 75 70 56 46 64 24" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M 100 102 C 125 70 144 46 136 24" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M 100 102 C 88 62 86 38 90 16" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M 100 102 C 112 62 114 38 110 16" fill="none" stroke="url(#dynamicFrondGrad)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M 100 102 C 98 60 98 35 100 12" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" />

        {/* Rich Pinnate Fringe Texture across Fronds */}
        <path d="M 38 102 L 32 94 M 48 98 L 44 88 M 58 96 L 54 84 M 68 94 L 64 82" stroke={frondColorPrimary} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M 162 102 L 168 94 M 152 98 L 156 88 M 142 96 L 146 84 M 132 94 L 136 82" stroke={frondColorPrimary} strokeWidth="1.2" strokeLinecap="round" />
      </g>

      {/* Oil Palm Fresh Fruit Bunches (FFB) Clusters at Crown Axil */}
      <g id="oil-palm-fruit-bunches">
        <g transform="translate(86, 102)">
          <ellipse cx="0" cy="0" rx="8" ry="6" fill="url(#ffbGrad)" stroke="#7c2d12" strokeWidth="1" />
          <circle cx="-4" cy="-2" r="2.2" fill="#f97316" />
          <circle cx="0" cy="-3" r="2.4" fill="#ea580c" />
          <circle cx="4" cy="-2" r="2.2" fill="#c2410c" />
          <circle cx="-3" cy="2" r="2.4" fill="#ea580c" />
          <circle cx="2" cy="2" r="2.4" fill="#f97316" />
          <circle cx="0" cy="0" r="1.5" fill="#fef08a" opacity="0.6" />
        </g>

        <g transform="translate(114, 102)">
          <ellipse cx="0" cy="0" rx="8" ry="6" fill="url(#ffbGrad)" stroke="#7c2d12" strokeWidth="1" />
          <circle cx="-4" cy="-2" r="2.2" fill="#c2410c" />
          <circle cx="0" cy="-3" r="2.4" fill="#ea580c" />
          <circle cx="4" cy="-2" r="2.2" fill="#f97316" />
          <circle cx="-2" cy="2" r="2.4" fill="#f97316" />
          <circle cx="3" cy="2" r="2.4" fill="#ea580c" />
          <circle cx="0" cy="0" r="1.5" fill="#fef08a" opacity="0.6" />
        </g>
      </g>
    </g>
  );

  // Switch / Mapping Function satisfying Requirement 2
  const renderGrowthStageAsset = (stageType: CropGrowthArchetype) => {
    switch (stageType) {
      case "Seedling":
        return renderSeedlingAsset();
      case "Vegetative":
        return renderVegetativeFloweringAsset(false);
      case "Flowering":
        return renderVegetativeFloweringAsset(true);
      case "Fruit Dev":
      default:
        return renderFruitDevMatureAsset();
    }
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* Visual Canvas Area */}
      <div className="my-4 flex justify-center items-center relative h-72 w-full select-none">
        
        {/* Dynamic Biometric Scanning Laser Beam */}
        <motion.div
          animate={{ top: ["12%", "88%", "12%"] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
          className="absolute left-6 right-6 h-[1.5px] bg-emerald-400/30 shadow-[0_0_12px_rgba(52,211,153,0.8)] z-10 pointer-events-none"
        >
          <div className="w-full flex justify-between px-2 text-[7px] font-mono text-emerald-300 opacity-60">
            <span>SCAN_ZONE_A</span>
            <span>NDVI: {ndvi.toFixed(2)}</span>
            <span>CHL: {Math.round(foliarHealth)}%</span>
          </div>
        </motion.div>

        {/* Morphing Dynamic Plant SVG Asset */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeArchetype}
            initial={{ opacity: 0, scale: 0.9, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -6 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full h-full flex items-center justify-center relative z-10"
          >
            <svg
              className="w-full h-full max-w-sm"
              viewBox="0 0 200 200"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="seedlingShootGrad" x1="100" y1="135" x2="100" y2="70" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#15803d" />
                  <stop offset="60%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#86efac" />
                </linearGradient>

                <linearGradient id="seedlingLeafGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#4ade80" />
                  <stop offset="100%" stopColor="#16a34a" />
                </linearGradient>

                <linearGradient id="rootGrad" x1="100" y1="135" x2="100" y2="185" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#92400e" />
                  <stop offset="70%" stopColor="#b45309" />
                  <stop offset="100%" stopColor="#d97706" stopOpacity="0.4" />
                </linearGradient>

                <linearGradient id="matureTrunkGrad" x1="90" y1="100" x2="110" y2="150" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#451a03" />
                  <stop offset="50%" stopColor="#78350f" />
                  <stop offset="100%" stopColor="#3f1d0b" />
                </linearGradient>

                <linearGradient id="dynamicFrondGrad" x1="100" y1="110" x2="100" y2="20" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor={frondColorSecondary} />
                  <stop offset="70%" stopColor={frondColorPrimary} />
                  <stop offset="100%" stopColor={leafTipGlow} />
                </linearGradient>

                <radialGradient id="ffbGrad" cx="50%" cy="40%" r="60%">
                  <stop offset="0%" stopColor="#ea580c" />
                  <stop offset="60%" stopColor="#c2410c" />
                  <stop offset="100%" stopColor="#7c2d12" />
                </radialGradient>

                <radialGradient id="flowerGrad" cx="50%" cy="40%" r="50%">
                  <stop offset="0%" stopColor="#fef08a" />
                  <stop offset="50%" stopColor="#eab308" />
                  <stop offset="100%" stopColor="#ca8a04" />
                </radialGradient>

                <linearGradient id="soilHorizonGrad" x1="10" y1="145" x2="190" y2="145" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="rgba(16,185,129,0)" />
                  <stop offset="50%" stopColor="rgba(16,185,129,0.15)" />
                  <stop offset="100%" stopColor="rgba(16,185,129,0)" />
                </linearGradient>
              </defs>

              {/* Subterranean Horizon line */}
              <line x1="15" y1="145" x2="185" y2="145" stroke="url(#soilHorizonGrad)" strokeWidth="1.5" strokeDasharray="4 4" />
              <text x="18" y="154" fill="rgba(148,163,184,0.35)" fontSize="6" fontFamily="monospace">SOIL HORIZON (ROOT ZONE)</text>

              {/* Grid / Calibration lines */}
              <line x1="20" y1="50" x2="180" y2="50" stroke="rgba(16, 185, 129, 0.05)" strokeDasharray="3 3" />
              <line x1="20" y1="95" x2="180" y2="95" stroke="rgba(16, 185, 129, 0.05)" strokeDasharray="3 3" />

              {/* RENDER ACTIVE GROWTH STAGE ASSET VIA CONDITIONAL SWITCH */}
              {renderGrowthStageAsset(activeArchetype)}

              {/* Optical Perspective Frame Polygon */}
              <polygon points="40,35 160,35 100,165" fill="rgba(16, 185, 129, 0.015)" stroke="rgba(16, 185, 129, 0.03)" strokeWidth="1" />
            </svg>
          </motion.div>
        </AnimatePresence>

        {/* Interactive Telemetry Hotspot Badges (Positioned dynamically per stage) */}
        {telemetryBadges.map((badge) => {
          const coords = currentBadgeCoords[badge.id] || { x: badge.x, y: badge.y };
          const isHovered = hoveredBadge === badge.id;

          return (
            <motion.div
              key={badge.id}
              animate={{ top: `${coords.y}%`, left: `${coords.x}%` }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
            >
              <button
                onMouseEnter={() => onHoverBadge(badge.id)}
                onMouseLeave={() => onHoverBadge(null)}
                onClick={() => onBadgeClick(badge)}
                className="w-3.5 h-3.5 rounded-full bg-emerald-400 hover:bg-white border-2 border-slate-950 flex items-center justify-center cursor-pointer shadow-md shadow-emerald-500/20 active:scale-95 transition-all animate-pulse"
                title={`${badge.label}: ${badge.value}`}
              />

              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 5 }}
                    animate={{ opacity: 1, scale: 1, y: -10 }}
                    exit={{ opacity: 0, scale: 0.9, y: 5 }}
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 w-48 bg-slate-900/95 backdrop-blur-md p-3 rounded-2xl border border-slate-800 shadow-2xl z-30 pointer-events-none text-left"
                  >
                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">{badge.label}</p>
                    <p className="text-sm font-black text-white mt-1 leading-none">{badge.value}</p>
                    <p className="text-[9px] text-slate-400 leading-normal mt-1">{badge.interpretation}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Stage Switcher & Reactive Timeline Bar */}
      <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-3 mt-1">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-emerald-400" />
              Growth Timeline State:
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-extrabold flex items-center gap-1">
              {activeArchetype === "Seedling" && "🌱 Seedling (Sprout)"}
              {activeArchetype === "Vegetative" && "🌿 Vegetative (Branching)"}
              {activeArchetype === "Flowering" && "🌼 Flowering (Budding)"}
              {activeArchetype === "Fruit Dev" && "🌴 Fruit Dev (Mature FFB)"}
              {simMode !== "Current" && (
                <span className="ml-1 opacity-70 text-[9px]">({simMode})</span>
              )}
            </span>
          </div>

          {/* Interactive stage selector pills */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {stagesList.map((s) => {
              const isSelected = activeArchetype === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => onSelectStageOverride && onSelectStageOverride(isSelected && previewStageOverride ? null : s.id)}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer border-0 flex items-center gap-1 ${
                    isSelected
                      ? "bg-emerald-500 text-slate-950 font-black shadow-xs"
                      : "text-slate-400 hover:text-white bg-transparent"
                  }`}
                  title={s.desc}
                >
                  <span>{s.icon}</span>
                  <span className="hidden md:inline">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic stage biological metrics caption */}
        <div className="mt-2 pt-2 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[9px] font-mono text-slate-400">
          <div>
            <span className="text-slate-500 block text-[8px] uppercase">Silhouette</span>
            <span className="text-slate-200 font-bold">
              {activeArchetype === "Seedling" ? "Minimalist Sprout" : activeArchetype === "Fruit Dev" ? "Full Umbrella Dome" : activeArchetype === "Flowering" ? "Branching & Bloom" : "Branching Canopy"}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[8px] uppercase">Root Depth</span>
            <span className="text-slate-200 font-bold">
              {activeArchetype === "Seedling" ? "0.3m (Fine Taproot)" : activeArchetype === "Fruit Dev" ? "2.8m (Anchor Grid)" : activeArchetype === "Flowering" ? "1.8m (Deep Spread)" : "1.4m (Branching)"}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[8px] uppercase">Canopy Fronds</span>
            <span className="text-slate-200 font-bold">
              {activeArchetype === "Seedling" ? "3 Spear Leaflets" : activeArchetype === "Fruit Dev" ? "14+ Lush Fronds" : activeArchetype === "Flowering" ? "10 Arching Fronds" : "8 Arching Fronds"}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[8px] uppercase">Yield Phase</span>
            <span className="text-slate-200 font-bold">
              {activeArchetype === "Fruit Dev" ? (yieldEst ? `${yieldEst} · ${harvestReadyPct}% Ready` : `${harvestReadyPct}% Harvest Ready`) : activeArchetype === "Flowering" ? "Flower Setting" : activeArchetype === "Vegetative" ? "Vegetative Flush" : "Pre-productive"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
