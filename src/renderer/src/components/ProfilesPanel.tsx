import React, { useState } from 'react'
import {
  ShieldCheck,
  Lock,
  Trash2,
  Bookmark,
  Save,
  Copy,
  Check,
  ExternalLink
} from 'lucide-react'
import type { AwsIdentity, SavedProfileMeta } from '@shared/types'
import { formatRelativeOrShortDate } from '../utils/formatters'

interface ProfilesPanelProps {
  identity: AwsIdentity
  savedProfiles: SavedProfileMeta[]
  recentS3Uris: string[]
  encryptionAvailable: boolean
  onSaveCurrentSession: (name: string) => Promise<void>
  onDeleteProfile: (id: string) => Promise<void>
  onRemoveRecentUri: (uri: string) => Promise<void>
  onOpenS3Uri: (uri: string) => void
}

export const ProfilesPanel: React.FC<ProfilesPanelProps> = ({
  identity,
  savedProfiles,
  recentS3Uris,
  encryptionAvailable,
  onSaveCurrentSession,
  onDeleteProfile,
  onRemoveRecentUri,
  onOpenS3Uri
}) => {
  const [newProfileName, setNewProfileName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [copiedArn, setCopiedArn] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProfileName.trim()) return
    setIsSaving(true)
    try {
      await onSaveCurrentSession(newProfileName.trim())
      setNewProfileName('')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopyArn = async () => {
    await navigator.clipboard.writeText(identity.arn)
    setCopiedArn(true)
    setTimeout(() => setCopiedArn(false), 2000)
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Detalle de la Sesion Activa */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <h2 className="text-base font-semibold text-white">Detalles de tu Sesion Activa en RAM</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Account ID</p>
            <p className="mt-1 font-mono text-sm font-semibold text-white">{identity.accountId}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Region Activa</p>
            <p className="mt-1 font-mono text-sm font-semibold text-amber-400">{identity.region}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Tipo de Credencial</p>
            <p className="mt-1 text-sm font-semibold text-slate-200">
              {identity.isTemporaryToken ? 'Token Temporal (STS)' : 'Llave IAM Permanente'}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">ARN Completo (STS)</p>
            <p className="mt-1 font-mono text-xs text-slate-200 truncate selectable-text">
              {identity.arn}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyArn}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 shrink-0"
          >
            {copiedArn ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copiar ARN
              </>
            )}
          </button>
        </div>

        {/* Guardar sesion actual en boveda DPAPI */}
        {encryptionAvailable && (
          <form onSubmit={handleSave} className="mt-5 pt-5 border-t border-slate-800">
            <label className="block text-xs font-medium text-slate-300 mb-2">
              Guardar esta sesion como perfil cifrado en Windows (DPAPI)
            </label>
            <div className="flex gap-2.5 max-w-xl">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Ej. Ambiente Desarrollo / Bucket Reportes"
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSaving || !newProfileName.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
              >
                <Save className="h-3.5 w-3.5" />
                Guardar Perfil Cifrado
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Perfiles Guardados y Rutas S3 Recientes */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">
              Perfiles Cifrados en Este Equipo ({savedProfiles.length})
            </h3>
          </div>

          {savedProfiles.length === 0 ? (
            <p className="text-xs text-slate-400">
              No tienes perfiles guardados en disco. Tus credenciales actuales solo viven en memoria
              RAM y se eliminaran al cerrar la ventana.
            </p>
          ) : (
            <div className="space-y-2.5">
              {savedProfiles.map((prof) => (
                <div
                  key={prof.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{prof.name}</p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Cuenta {prof.accountId || '-'} | {prof.region}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Actualizado: {formatRelativeOrShortDate(prof.savedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDeleteProfile(prof.id)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-500/15 hover:text-red-400 transition"
                    title="Eliminar perfil"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Bookmark className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">
              Rutas Directas de S3 Guardadas ({recentS3Uris.length})
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Accesos directos para entrar a tus buckets corporativos cuando tu rol IAM no permite
            listar todos los buckets.
          </p>

          {recentS3Uris.length === 0 ? (
            <p className="text-xs text-slate-500">
              Cuando navegues a una ruta s3://mi-bucket/carpeta/ en el explorador S3, quedara
              guardada aqui para abrirla con un clic.
            </p>
          ) : (
            <div className="space-y-2">
              {recentS3Uris.map((uri) => (
                <div
                  key={uri}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5"
                >
                  <button
                    type="button"
                    onClick={() => onOpenS3Uri(uri)}
                    className="inline-flex items-center gap-2 font-mono text-xs text-sky-300 hover:text-sky-200 truncate text-left"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{uri}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRemoveRecentUri(uri)}
                    className="rounded p-1 text-slate-500 hover:text-red-400"
                    title="Quitar de recientes"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

