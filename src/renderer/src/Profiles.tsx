import { Briefcase, EyeOff, House, Plus, type LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { PROFILE_LABEL, type ProfileId, type Profiles, type ProfilesPatch } from '../../shared/profiles'

export const PROFILE_ICON: Record<ProfileId, LucideIcon> = { pro: Briefcase, perso: House }

export const otherProfile = (id: ProfileId): ProfileId => (id === 'pro' ? 'perso' : 'pro')

// Pro | Perso next to the logo; picking the other one relaunches Flux on its own settings
export function ProfileSwitch({
  profiles,
  onError,
}: {
  profiles: Profiles
  onError(message: string): void
}) {
  const [leaving, setLeaving] = useState<ProfileId | null>(null)

  const pick = (id: ProfileId) => {
    if (id === profiles.active || leaving) return
    setLeaving(id)
    window.flux.setProfiles({ active: id }).catch(error => {
      setLeaving(null)
      onError(`Changement de profil impossible : ${(error as Error).message}`)
    })
  }

  return (
    <nav className="tabs glass lens profile-switch" aria-label="Profil">
      {profiles.list.map(profile => {
        const Icon = PROFILE_ICON[profile.id]
        const current = (leaving ?? profiles.active) === profile.id
        return (
          <button
            type="button"
            key={profile.id}
            aria-current={current ? 'page' : undefined}
            disabled={leaving !== null}
            title={
              profile.id === profiles.active
                ? `Profil ${profile.label}`
                : `Passer à ${profile.label} : Flux redémarre sur ses réglages`
            }
            onClick={() => pick(profile.id)}
          >
            <Icon size={13} aria-hidden="true" />
            <span className="profile-label">{PROFILE_LABEL[profile.id]}</span>
          </button>
        )
      })}
    </nav>
  )
}

// The Profil line of the settings: add Perso, hide it again, or switch to the other profile
export function ProfilesField({
  profiles,
  onChange,
  onError,
}: {
  profiles: Profiles
  onChange(profiles: Profiles): void
  onError(message: string): void
}) {
  const [busy, setBusy] = useState(false)
  const active = PROFILE_LABEL[profiles.active]
  const other = otherProfile(profiles.active)
  const OtherIcon = PROFILE_ICON[other]

  // A switch relaunches Flux, so only adding or hiding Perso comes back here
  const update = async (patch: ProfilesPatch) => {
    setBusy(true)
    try {
      await window.flux.setProfiles(patch)
      onChange(await window.flux.profiles())
    } catch (error) {
      onError(`Profils non enregistrés : ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="field settings-profiles">
      <span>Profil</span>
      <small>
        {profiles.perso
          ? `Ces réglages sont ceux de ${active}. ${PROFILE_LABEL[other]} garde ses propres comptes, clefs, espaces et file.`
          : 'Un seul profil. Ajoute Perso pour suivre tes projets perso à part, avec leurs propres comptes et clefs.'}
      </small>
      <div className="settings-row">
        {profiles.perso ? (
          <>
            <button
              type="button"
              className="pill glass small"
              disabled={busy}
              title="Flux redémarre sur les réglages de l’autre profil"
              onClick={() => void update({ active: other })}
            >
              <OtherIcon size={14} aria-hidden="true" />
              Passer à {PROFILE_LABEL[other]}
            </button>
            {profiles.active === 'pro' && (
              <button
                type="button"
                className="pill glass small"
                disabled={busy}
                title="Le sélecteur disparaît ; les réglages de Perso restent sur ce Mac"
                onClick={() => void update({ perso: false })}
              >
                <EyeOff size={14} aria-hidden="true" />
                Masquer Perso
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="pill glass small"
            disabled={busy}
            onClick={() => void update({ perso: true })}
          >
            <Plus size={14} aria-hidden="true" />
            Ajouter Perso
          </button>
        )}
      </div>
    </section>
  )
}
