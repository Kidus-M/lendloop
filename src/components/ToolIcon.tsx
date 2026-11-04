import {
  Axe,
  Brush,
  ChefHat,
  CookingPot,
  Drill,
  Flame,
  Flashlight,
  Hammer,
  Leaf,
  type LucideIcon,
  Paintbrush,
  Ruler,
  Scissors,
  Shovel,
  SprayCan,
  Tent,
  ToolCase,
  Truck,
  Wrench,
} from "lucide-react";
import type { Category } from "@convex/lib/domain";

/** Checked in order against the tool's name, so "hedge trimmer" gets shears, not a leaf. */
const NAME_ICONS: [RegExp, LucideIcon][] = [
  [/drill|driver/i, Drill],
  [/hammer|mallet/i, Hammer],
  [/wrench|socket|spanner|plier/i, Wrench],
  [/axe|hatchet/i, Axe],
  [/shovel|spade/i, Shovel],
  [/trimmer|shear|clipper|scissors/i, Scissors],
  [/wheelbarrow|trailer|dolly/i, Truck],
  [/level|ruler|tape measure/i, Ruler],
  [/paint|roller/i, Paintbrush],
  [/washer|sprayer/i, SprayCan],
  [/cleaner|vacuum|broom/i, Brush],
  [/tent|tarp/i, Tent],
  [/stove|grill|burner/i, Flame],
  [/lantern|flashlight|torch/i, Flashlight],
  [/mixer|canner|pot|pan|cooker/i, CookingPot],
];

const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  power_tools: Drill,
  hand_tools: Hammer,
  garden: Leaf,
  kitchen: ChefHat,
  camping: Tent,
  cleaning: Brush,
  other: ToolCase,
};

export function ToolIcon({ name, category }: { name: string; category: Category }) {
  const match = NAME_ICONS.find(([pattern]) => pattern.test(name));
  const Icon = match?.[1] ?? CATEGORY_ICONS[category];
  return <Icon aria-hidden="true" />;
}
