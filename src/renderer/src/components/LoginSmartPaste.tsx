import React, { useMemo, useState } from 'react'
import {
  KeyRound,
  ClipboardPaste,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  Lock,
  X,
  ArrowRight
} from 'lucide-react'
import {
  AWS_REGIONS,
  type AwsCredentialsInput,
  type AwsIdentity,
  type SavedProfileMeta
} from '@shared/types'
import { parseRawCredentials } from '@shared/credentialParser'
import { formatRelativeOrShortDate } from '../utils/formatters'

interface LoginSmartPasteProps {
  mode: 'fullscreen' | 'modal'
  defaultRegion?: string
  savedProfiles: SavedProfileMeta[]
  encryptionAvailable: boolean
  expiredMessage?: string | null
  onConnected: (identity: AwsIdentity, updatedProfiles?: SavedProfileMeta[]) => void
  onDeleteProfile: (profileId: string) => Promise<void>
  onCloseModal?: () => void
}

export const LoginSmartPaste: React.FC<LoginSmartPasteProps> = ({
  mode,
  defaultRegion = 'us-east-1',
  savedProfiles,
  encryptionAvailable,
  expiredMessage,
  onConnected,
  onDeleteProfile,
  onCloseModal
}) => {
  const [activeTab, setActiveTab] = useState<'smart' | 'manual'>('smart')
  const [rawPasteText, setRawPasteText] = useState('')
  const [selectedRegion, setSelectedRegion] = useState(defaultRegion)

  // Campos manuales
  const [manualAccessKey, setManualAccessKey] = useState('')
  const [manualSecretKey, setManualSecretKey] = useState('')
  const [manualSessionToken, setManualSessionToken] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  // Opcion de guardado cifrado DPAPI
  const [saveEncrypted, setSaveEncrypted] = useState(false)
  const [profileAlias, setProfileAlias] = useState('')

  // Estado de carga y error
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const parsedResult = useMemo(
    () => parseRawCredentials(rawPasteText, selectedRegion),
    [rawPasteText, selectedRegion]
  )

  const handlePasteFromClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText()
      if (clipText) {
        setRawPasteText(clipText)
        setErrorMessage(null)
        const detected = parseRawCredentials(clipText, selectedRegion)
        if (detected?.credentials.region) {
          setSelectedRegion(detected.credentials.region)
        }
      }
    } catch {
      setErrorMessage('No se pudo leer el portapapeles automaticamente. Usa Ctrl + V en la caja.')
    }
  }

  const handleRawTextChange = (text: string) => {
    setRawPasteText(text)
    setErrorMessage(null)
    const detected = parseRawCredentials(text, selectedRegion)
    if (detected && /REGION/i.test(text)) {
      setSelectedRegion(detected.credentials.region)
    }
  }

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    let credentialsToUse: AwsCredentialsInput | null = null

    if (activeTab === 'smart') {
      if (!parsedResult) {
        setErrorMessage(
          'No se detectaron llaves validas en el texto pegado. Asegurate de pegar el bloque con AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY.'
        )
        return
      }
      credentialsToUse = {
        ...parsedResult.credentials,
        region: selectedRegion
      }
    } else {
      if (!manualAccessKey.trim() || !manualSecretKey.trim()) {
        setErrorMessage('Debes completar al menos Access Key ID y Secret Access Key.')
        return
      }
      credentialsToUse = {
        accessKeyId: manualAccessKey.trim(),
        secretAccessKey: manualSecretKey.trim(),
        sessionToken: manualSessionToken.trim() || undefined,
        region: selectedRegion
      }
    }

    setIsConnecting(true)
    try {
      const resp = await window.api.connectAws(
        credentialsToUse,
        saveEncrypted && encryptionAvailable
          ? {
              save: true,
              profileName: profileAlias.trim() || `Sesion ${selectedRegion}`
            }
          : undefined
      )

      if (!resp.success) {
        setErrorMessage(resp.error)
        return
      }

      let refreshedProfiles: SavedProfileMeta[] | undefined
      if (resp.data.savedProfile) {
        const vaultResp = await window.api.getVaultState()
        if (vaultResp.success) {
          refreshedProfiles = vaultResp.data.profiles
        }
      }

      onConnected(resp.data.identity, refreshedProfiles)
    } catch (err: any) {
      setErrorMessage(err?.message || 'Ocurrio un error inesperado al validar las credenciales.')
    } finally {
      setIsConnecting(false)
    }
  }

  const handleConnectSavedProfile = async (profileId: string) => {
    setErrorMessage(null)
    setConnectingProfileId(profileId)
    try {
      const resp = await window.api.connectSavedProfile(profileId)
      if (!resp.success) {
        setErrorMessage(resp.error)
        return
      }
      onConnected(resp.data)
    } finally {
      setConnectingProfileId(null)
    }
  }

  const asiaMissingTokenWarning =
    activeTab === 'smart'
      ? Boolean(
          parsedResult &&
            parsedResult.credentials.accessKeyId.startsWith('ASIA') &&
            !parsedResult.credentials.sessionToken
        )
      : manualAccessKey.trim().startsWith('ASIA') && !manualSessionToken.trim()

  const cardContent = (
    <div className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900/95 shadow-2xl overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-5">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white tracking-tight">
              {mode === 'modal' ? 'Renovar o Cambiar Sesion AWS' : 'NoCLI AWS Desktop'}
            </h1>
            <p className="text-xs text-slate-400">
              {mode === 'modal'
                ? 'Pega tus nuevas credenciales temporales para continuar trabajando sin cerrar la aplicacion.'
                : 'Gestiona Amazon S3 y ECR de forma visual sin tocar PowerShell ni instalar AWS CLI.'}
            </p>
          </div>
        </div>

        {mode === 'modal' && onCloseModal && (
          <button
            type="button"
            onClick={onCloseModal}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Alerta si el token anterior expiro */}
      {expiredMessage && (
        <div className="mx-6 mt-5 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
          <div>
            <p className="font-medium text-amber-300">Sesion expirada detectada</p>
            <p className="text-xs text-amber-200/90 mt-0.5">{expiredMessage}</p>
          </div>
        </div>
      )}

      <div
        className={`grid gap-0 ${
          savedProfiles.length > 0 ? 'lg:grid-cols-12' : 'grid-cols-1'
        }`}
      >
        {/* Columna Principal: Smart Paste / Manual */}
        <form
          onSubmit={handleConnect}
          className={`p-6 space-y-5 ${
            savedProfiles.length > 0 ? 'lg:col-span-8 lg:border-r lg:border-slate-800' : ''
          }`}
        >
          {/* Selector de Pestanas */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('smart')
                  setErrorMessage(null)
                }}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                  activeTab === 'smart'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Pegado Inteligente (Smart Paste)
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('manual')
                  setErrorMessage(null)
                }}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                  activeTab === 'manual'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Formulario Manual
              </button>
            </div>

            {activeTab === 'smart' && (
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:border-slate-600 transition"
              >
                <ClipboardPaste className="h-3.5 w-3.5 text-amber-400" />
                Pegar del portapapeles
              </button>
            )}
          </div>

          {activeTab === 'smart' ? (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-300">
                Pega el bloque completo que te entregaron (PowerShell, Bash, CMD, INI o JSON)
              </label>
              <textarea
                rows={6}
                value={rawPasteText}
                onChange={(e) => handleRawTextChange(e.target.value)}
                placeholder={`Ejemplo PowerShell:\n$env:AWS_ACCESS_KEY_ID="ASIAIOSFODNN7EXAMPLE"\n$env:AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"\n$env:AWS_SESSION_TOKEN="IQoJb3JpZ2luX2VjE..."`}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />

              {/* Indicadores de deteccion en vivo */}
              {rawPasteText.trim().length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3">
                  {parsedResult ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                          Formato detectado: {parsedResult.detectedFormat}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">
                          Key: {parsedResult.credentials.accessKeyId.slice(0, 4)}...
                          {parsedResult.credentials.accessKeyId.slice(-4)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-emerald-300">
                          Access Key lista
                        </span>
                        <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-emerald-300">
                          Secret Key lista
                        </span>
                        {parsedResult.credentials.sessionToken ? (
                          <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-emerald-300">
                            Session Token incluido ({parsedResult.credentials.sessionToken.length}{' '}
                            caracteres)
                          </span>
                        ) : (
                          <span className="rounded-md bg-slate-800 border border-slate-700 px-2 py-0.5 text-slate-400">
                            Sin Session Token
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Aun no se reconocen AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY en el texto.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  AWS Access Key ID
                </label>
                <input
                  type="text"
                  value={manualAccessKey}
                  onChange={(e) => setManualAccessKey(e.target.value)}
                  placeholder="ASIA... o AKIA..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  AWS Secret Access Key
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={manualSecretKey}
                    onChange={(e) => setManualSecretKey(e.target.value)}
                    placeholder="Clave secreta..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-3.5 pr-10 py-2 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  AWS Session Token (Requerido para credenciales temporales ASIA...)
                </label>
                <textarea
                  rows={3}
                  value={manualSessionToken}
                  onChange={(e) => setManualSessionToken(e.target.value)}
                  placeholder="IQoJb3JpZ2luX2VjE..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Advertencia si es llave ASIA sin token */}
          {asiaMissingTokenWarning && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <span>
                Tu Access Key comienza con <strong>ASIA</strong> (credencial temporal), pero falta el{' '}
                <strong>AWS_SESSION_TOKEN</strong>. Verifica que hayas copiado las 3 lineas completas.
              </span>
            </div>
          )}

          {/* Region + Guardado opcional cifrado */}
          <div className="grid gap-4 sm:grid-cols-2 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Region por defecto
              </label>
              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                {AWS_REGIONS.map((reg) => (
                  <option key={reg.code} value={reg.code}>
                    {reg.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col justify-end">
              <label
                className={`flex items-center gap-2 text-xs ${
                  encryptionAvailable
                    ? 'text-slate-300 cursor-pointer'
                    : 'text-slate-500 cursor-not-allowed'
                }`}
              >
                <input
                  type="checkbox"
                  checked={saveEncrypted}
                  disabled={!encryptionAvailable}
                  onChange={(e) => setSaveEncrypted(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500 focus:ring-amber-500"
                />
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3.5 w-3.5 text-amber-400" />
                  Guardar perfil cifrado en Windows (DPAPI)
                </span>
              </label>
              <p className="text-[11px] text-slate-500 mt-1 pl-6">
                {saveEncrypted
                  ? 'Se cifrara en el llavero nativo de tu usuario Windows.'
                  : 'Por defecto solo vive en memoria RAM hasta cerrar la app.'}
              </p>
            </div>
          </div>

          {saveEncrypted && encryptionAvailable && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Nombre para identificar este perfil
              </label>
              <input
                type="text"
                value={profileAlias}
                onChange={(e) => setProfileAlias(e.target.value)}
                placeholder="Ej. Cuenta QA Corporativa / Proyecto Datos"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          )}

          {/* Mensaje de error amigable */}
          {errorMessage && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Boton Conectar */}
          <div className="flex items-center justify-between pt-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              No modifica tu archivo ~/.aws/credentials
            </span>

            <button
              type="submit"
              disabled={isConnecting}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-500/20 hover:bg-amber-400 disabled:opacity-50 transition"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Validando con AWS STS...
                </>
              ) : (
                <>
                  Validar y Conectar
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Columna Derecha: Perfiles Guardados Cifrados */}
        {savedProfiles.length > 0 && (
          <div className="lg:col-span-4 bg-slate-950/60 p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="h-4 w-4 text-amber-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Perfiles Cifrados ({savedProfiles.length})
              </h2>
            </div>
            <p className="text-[11px] text-slate-400 mb-4">
              Reconecta en un clic usando perfiles guardados con cifrado nativo de Windows.
            </p>

            <div className="space-y-2.5 overflow-y-auto max-h-96 pr-1">
              {savedProfiles.map((prof) => {
                const isBusy = connectingProfileId === prof.id
                return (
                  <div
                    key={prof.id}
                    className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 hover:border-slate-700 transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{prof.name}</p>
                        {prof.accountId && (
                          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                            Cuenta: {prof.accountId} ({prof.region})
                          </p>
                        )}
                        {prof.shortPrincipal && (
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {prof.shortPrincipal}
                          </p>
                        )}
                        <p className="text-[10px] text-slate-500 mt-1">
                          Guardado: {formatRelativeOrShortDate(prof.savedAt)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void onDeleteProfile(prof.id)}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition"
                        title="Eliminar perfil guardado"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy || isConnecting}
                      onClick={() => void handleConnectSavedProfile(prof.id)}
                      className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition"
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Conectando...
                        </>
                      ) : (
                        'Conectar con este perfil'
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
        {cardContent}
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 overflow-y-auto">
      {cardContent}
    </div>
  )
}

