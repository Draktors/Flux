// Two Flux side by side: each profile keeps its own config, keys, settings, workspaces and queue
export type ProfileId = 'pro' | 'perso'

export const PROFILE_IDS: ProfileId[] = ['pro', 'perso']

export const PROFILE_LABEL: Record<ProfileId, string> = { pro: 'Pro', perso: 'Perso' }

export interface Profiles {
  // The profile this window shows; the other one sleeps until you switch
  active: ProfileId
  // Perso is offered once chosen in the welcome or the settings; Pro always exists
  perso: boolean
  list: { id: ProfileId; label: string; onboarded: boolean }[]
}

// Switching to another profile relaunches Flux on it
export interface ProfilesPatch {
  active?: ProfileId
  perso?: boolean
}
