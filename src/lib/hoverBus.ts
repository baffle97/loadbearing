import { useSyncExternalStore } from 'react'

export interface Hover {
  index: number
  x: number
  y: number
}

let value: Hover | null = null
const listeners = new Set<() => void>()

/** A tiny store, so moving the pointer over the tower never re-renders the 3D scene. */
export function setHover(next: Hover | null): void {
  value = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useHover(): Hover | null {
  return useSyncExternalStore(subscribe, () => value)
}
