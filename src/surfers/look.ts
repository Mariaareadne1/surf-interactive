import * as THREE from 'three';
import { seededRandom } from '../scene/noise';

/**
 * Who a surfer is, from their seed: skin, hair (and how long), swimsuit and
 * its cut, and the board's colour and stripe. Colours from the reference's
 * palette (see docs/ART_DIRECTION.md); hex is parsed as sRGB, stored linear.
 */

export type BoardKind = 'short' | 'long';

const SKIN = ['#f1c7a6', '#e3a882', '#c98d64', '#9a6544', '#6e4630'];
const HAIR = ['#3a2a22', '#6b4a32', '#a9825a', '#1f1a18', '#c9a46a', '#5a3a2a'];
const SUIT = ['#e2554a', '#2f3f6b', '#8a63b8', '#6fae54', '#f2c94c', '#2d8f8f', '#e98a3b'];
const BOARD = ['#f7f5ef', '#f7f5ef', '#f2c94c', '#f2a03a', '#f7f5ef', '#f2c94c'];
const STRIPE = ['#f2a03a', '#e2554a', '#2d8f8f', '#f7f5ef', '#2f3f6b'];

export interface SurferLook {
  skin: THREE.Color;
  hair: THREE.Color;
  suit: THREE.Color;
  board: THREE.Color;
  stripe: THREE.Color;
  /** Long hair falls down the back. */
  longHair: boolean;
  /** 0 trunks (bare top), 1 one-piece, 2 rash vest and trunks. */
  cut: number;
  /** 0 none, 1 a stripe down the middle, 2 a coloured nose. */
  stripeStyle: number;
}

export function lookFromSeed(seed: number): SurferLook {
  const r = seededRandom(seed * 7919 + 17);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length) % a.length];
  const longHair = r() < 0.45;
  return {
    skin: new THREE.Color(pick(SKIN)),
    hair: new THREE.Color(pick(HAIR)),
    suit: new THREE.Color(pick(SUIT)),
    board: new THREE.Color(pick(BOARD)),
    stripe: new THREE.Color(pick(STRIPE)),
    longHair,
    cut: longHair ? (r() < 0.75 ? 1 : 2) : r() < 0.7 ? 0 : 2,
    stripeStyle: Math.floor(r() * 3) % 3,
  };
}

/** The colour of the pigment that blooms on the water as this surfer is painted in. */
export function bloomColor(look: SurferLook): THREE.Color {
  return look.board.clone().lerp(look.suit, 0.35).lerp(new THREE.Color('#ffffff'), 0.25);
}
