import { create } from 'zustand'
import { api } from '../lib/api'

export interface PetInfo {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
  author: string
  tags: string[]
  frameCounts?: number[]
}

interface PetStore {
  pets: PetInfo[]
  adoptedId: string | null
  loading: boolean
  loadPets: () => Promise<void>
  adopt: (id: string) => Promise<void>
  abandon: () => Promise<void>
  initFromUser: (adoptedPetId: string) => void
}

export const usePetStore = create<PetStore>((set, get) => ({
  pets: [],
  adoptedId: localStorage.getItem('adopted-pet-id') || null,
  loading: false,

  loadPets: async () => {
    if (get().pets.length > 0) return
    set({ loading: true })
    try {
      const petDirs = ['clippit', 'dario', 'nyako-shigure', 'slavik', 'trump', 'tux', 'yelling-dario', 'yorha-sit-2b']
      const pets: PetInfo[] = []
      for (const dir of petDirs) {
        try {
          const res = await fetch(`/pets/${dir}/pet.json`)
          if (res.ok) {
            const data = await res.json()
            pets.push({
              id: data.id,
              displayName: data.displayName,
              description: data.description,
              spritesheetPath: `/pets/${dir}/${data.spritesheetPath || 'spritesheet.webp'}`,
              author: data.author,
              tags: data.tags || [],
              frameCounts: data.frameCounts,
            })
          }
        } catch { /* skip unavailable pets */ }
      }
      set({ pets, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  initFromUser: (adoptedPetId: string) => {
    // If the server has a pet and local doesn't, use server value
    // If local has one but server doesn't, that'll be synced on next adopt/abandon
    if (adoptedPetId && !get().adoptedId) {
      localStorage.setItem('adopted-pet-id', adoptedPetId)
      set({ adoptedId: adoptedPetId })
    }
  },

  adopt: async (id: string) => {
    localStorage.setItem('adopted-pet-id', id)
    set({ adoptedId: id })
    try { await api.auth.updatePet(id) } catch { /* sync on next login */ }
  },

  abandon: async () => {
    localStorage.removeItem('adopted-pet-id')
    set({ adoptedId: null })
    try { await api.auth.updatePet('') } catch { /* sync on next login */ }
  },
}))
