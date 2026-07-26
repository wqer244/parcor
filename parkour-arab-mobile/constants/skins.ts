// ────────────────────────────────────────────────────────
// Skins — recolor presets for the procedural character rig
// built in GameRenderer3D.tsx. Adding a skin here is enough
// to make it selectable in the in-game skin picker.
// ────────────────────────────────────────────────────────

export interface Skin {
  id: string;
  name: string;      // Arabic display name shown in the picker
  suit: string;       // shirt / torso color
  pants: string;      // pants / legs color
  accent: string;      // glow trim, stripe, shoes, visor — also used for the minimap dot
  skin: string;        // skin tone
  hair: string;         // hair color
  isModel?: boolean;    // true = render the bundled GLB model instead of the procedural rig
}

// Bundled GLB character (Avaturn export, textures stripped and replaced
// with flat colors — see GameRenderer3D.tsx for the loader). Metro needs
// a static require() like this to include the file in the app bundle.
export const CHARACTER_MODEL = require('../assets/models/character.glb');

export const DEFAULT_SKIN_ID = 'neon-cyan';

export const SKINS: Skin[] = [
  { id: 'neon-cyan',   name: 'نيون سماوي',   suit: '#0b0b1f', pants: '#0b0b1f', accent: '#00ffcc', skin: '#d8956a', hair: '#1a1108' },
  { id: 'neon-blue',   name: 'نيون أزرق',    suit: '#0b0b1f', pants: '#0b0b1f', accent: '#00aaff', skin: '#d8956a', hair: '#1a1108' },
  { id: 'neon-pink',   name: 'نيون وردي',    suit: '#0b0b1f', pants: '#0b0b1f', accent: '#ff00aa', skin: '#d8956a', hair: '#1a1108' },
  { id: 'neon-amber',  name: 'نيون كهرماني', suit: '#0b0b1f', pants: '#0b0b1f', accent: '#ffaa00', skin: '#d8956a', hair: '#1a1108' },
  { id: 'neon-violet', name: 'نيون بنفسجي',  suit: '#0b0b1f', pants: '#0b0b1f', accent: '#aa00ff', skin: '#d8956a', hair: '#1a1108' },
  { id: 'neon-red',    name: 'نيون أحمر',    suit: '#0b0b1f', pants: '#0b0b1f', accent: '#ff3333', skin: '#d8956a', hair: '#1a1108' },
  { id: 'neon-green',  name: 'نيون أخضر',    suit: '#0b0b1f', pants: '#0b0b1f', accent: '#33ff33', skin: '#d8956a', hair: '#1a1108' },
  { id: 'neon-orange', name: 'نيون برتقالي', suit: '#0b0b1f', pants: '#0b0b1f', accent: '#ff6600', skin: '#d8956a', hair: '#1a1108' },
  // New skin — the actual 3D avatar generated from the reference photo
  // (Avaturn export). Textures were stripped at build time (see
  // assets/models/character.glb) and replaced with these flat colors,
  // so this entry's suit/pants/skin/hair are also the model's colors.
  {
    id: 'never-underestimate',
    name: 'Never Underestimate',
    suit: '#2b3d66',
    pants: '#15161a',
    accent: '#e8e8e8',
    skin: '#c98a5b',
    hair: '#0e0b08',
    isModel: true,
  },
];

export function getSkin(id: string | undefined | null): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN_ID)!;
}
