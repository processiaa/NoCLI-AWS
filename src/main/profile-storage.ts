import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { AwsCredentialsInput, SavedProfileMeta } from '../shared/types'

interface StoredEncryptedProfile {
  id: string
  name: string
  accountId?: string
  shortPrincipal?: string
  region: string
  isTemporaryToken: boolean
  savedAt: string
  encryptedPayloadBase64: string
}

interface VaultData {
  profiles: StoredEncryptedProfile[]
  recentS3Uris: string[]
}

const DEFAULT_VAULT: VaultData = {
  profiles: [],
  recentS3Uris: []
}

class ProfileStorage {
  private getVaultPath(): string {
    return path.join(app.getPath('userData'), 'nocli-aws-vault.json')
  }

  private readVault(): VaultData {
    try {
      const vaultPath = this.getVaultPath()
      if (!fs.existsSync(vaultPath)) {
        return { ...DEFAULT_VAULT, profiles: [], recentS3Uris: [] }
      }
      const raw = fs.readFileSync(vaultPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<VaultData>
      return {
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        recentS3Uris: Array.isArray(parsed.recentS3Uris) ? parsed.recentS3Uris : []
      }
    } catch {
      return { ...DEFAULT_VAULT, profiles: [], recentS3Uris: [] }
    }
  }

  private writeVault(data: VaultData): void {
    const vaultPath = this.getVaultPath()
    fs.mkdirSync(path.dirname(vaultPath), { recursive: true })
    fs.writeFileSync(vaultPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  listProfiles(): SavedProfileMeta[] {
    const vault = this.readVault()
    const available = this.isEncryptionAvailable()
    return vault.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      accountId: p.accountId,
      shortPrincipal: p.shortPrincipal,
      region: p.region,
      isTemporaryToken: p.isTemporaryToken,
      savedAt: p.savedAt,
      encryptionAvailable: available
    }))
  }

  saveProfile(
    name: string,
    credentials: AwsCredentialsInput,
    meta?: { accountId?: string; shortPrincipal?: string }
  ): SavedProfileMeta {
    if (!this.isEncryptionAvailable()) {
      throw new Error(
        'El cifrado nativo del sistema operativo (DPAPI / Keychain) no esta disponible en este entorno.'
      )
    }

    const serialized = JSON.stringify(credentials)
    const encryptedBuffer = safeStorage.encryptString(serialized)
    const encryptedPayloadBase64 = encryptedBuffer.toString('base64')

    const vault = this.readVault()
    const trimmedName = name.trim() || `Perfil ${meta?.accountId || credentials.region}`

    // Si ya existe un perfil con el mismo nombre, actualizarlo
    const existingIdx = vault.profiles.findIndex(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
    )

    const record: StoredEncryptedProfile = {
      id: existingIdx >= 0 ? vault.profiles[existingIdx].id : crypto.randomUUID(),
      name: trimmedName,
      accountId: meta?.accountId,
      shortPrincipal: meta?.shortPrincipal,
      region: credentials.region,
      isTemporaryToken: Boolean(credentials.sessionToken),
      savedAt: new Date().toISOString(),
      encryptedPayloadBase64
    }

    if (existingIdx >= 0) {
      vault.profiles[existingIdx] = record
    } else {
      vault.profiles.unshift(record)
    }

    this.writeVault(vault)

    return {
      id: record.id,
      name: record.name,
      accountId: record.accountId,
      shortPrincipal: record.shortPrincipal,
      region: record.region,
      isTemporaryToken: record.isTemporaryToken,
      savedAt: record.savedAt,
      encryptionAvailable: true
    }
  }

  loadProfileCredentials(profileId: string): AwsCredentialsInput {
    if (!this.isEncryptionAvailable()) {
      throw new Error('No se puede descifrar el perfil porque safeStorage no esta disponible.')
    }

    const vault = this.readVault()
    const profile = vault.profiles.find((p) => p.id === profileId)
    if (!profile) {
      throw new Error('El perfil seleccionado no existe o fue eliminado.')
    }

    const encryptedBuffer = Buffer.from(profile.encryptedPayloadBase64, 'base64')
    const decryptedJson = safeStorage.decryptString(encryptedBuffer)
    return JSON.parse(decryptedJson) as AwsCredentialsInput
  }

  deleteProfile(profileId: string): void {
    const vault = this.readVault()
    vault.profiles = vault.profiles.filter((p) => p.id !== profileId)
    this.writeVault(vault)
  }

  listRecentS3Uris(): string[] {
    return this.readVault().recentS3Uris
  }

  addRecentS3Uri(uri: string): string[] {
    const cleaned = uri.trim()
    if (!cleaned) return this.listRecentS3Uris()

    const vault = this.readVault()
    vault.recentS3Uris = [
      cleaned,
      ...vault.recentS3Uris.filter((item) => item.toLowerCase() !== cleaned.toLowerCase())
    ].slice(0, 12)
    this.writeVault(vault)
    return vault.recentS3Uris
  }

  removeRecentS3Uri(uri: string): string[] {
    const vault = this.readVault()
    vault.recentS3Uris = vault.recentS3Uris.filter(
      (item) => item.toLowerCase() !== uri.trim().toLowerCase()
    )
    this.writeVault(vault)
    return vault.recentS3Uris
  }
}

export const profileStorage = new ProfileStorage()

