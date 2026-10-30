import React, { useCallback, useEffect, useState } from 'react'
import {
  FolderKanban,
  Container,
  Shield,
  KeyRound,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Info,
  X,
  Cloud
} from 'lucide-react'
import {
  AWS_REGIONS,
  type AwsIdentity,
  type SavedProfileMeta,
  type TransferProgressEvent
} from '@shared/types'
import { LoginSmartPaste } from './components/LoginSmartPaste'
import { S3Explorer } from './components/S3Explorer'
import { EcrManager } from './components/EcrManager'
import { ProfilesPanel } from './components/ProfilesPanel'
import { TransferStatusBar } from './components/TransferStatusBar'

type ActiveSection = 's3' | 'ecr' | 'profiles'

interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

export default function App(): JSX.Element {
  const [identity, setIdentity] = useState<AwsIdentity | null>(null)
  const [activeSection, setActiveSection] = useState<ActiveSection>('s3')

  // Estado de boveda cifrada (safeStorage / DPAPI)
  const [savedProfiles, setSavedProfiles] = useState<SavedProfileMeta[]>([])
  const [recentS3Uris, setRecentS3Uris] = useState<string[]>([])
  const [encryptionAvailable, setEncryptionAvailable] = useState(false)

  // Modal de renovacion / cambio de token sin perder contexto
  const [showTokenModal, setShowTokenModal] = useState(false)
  const [expiredTokenMessage, setExpiredTokenMessage] = useState<string | null>(null)

  // Navegacion cruzada desde Perfiles -> S3 Explorer
  const [pendingS3Uri, setPendingS3Uri] = useState<string | null>(null)

  // Cola de transferencias en tiempo real (S3 + Docker)
  const [transfers, setTransfers] = useState<TransferProgressEvent[]>([])

  // Notificaciones tipo Toast
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const notify = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((prev) => [...prev.slice(-3), { id, type, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5500)
  }, [])

  const loadInitialState = useCallback(async () => {
    const [sessionResp, vaultResp] = await Promise.all([
      window.api.getSession(),
      window.api.getVaultState()
    ])

    if (sessionResp.success && sessionResp.data) {
      setIdentity(sessionResp.data)
    }

    if (vaultResp.success) {
      setSavedProfiles(vaultResp.data.profiles)
      setRecentS3Uris(vaultResp.data.recentS3Uris)
      setEncryptionAvailable(vaultResp.data.encryptionAvailable)
    }
  }, [])

  useEffect(() => {
    void loadInitialState()
  }, [loadInitialState])

  useEffect(() => {
    const unsubscribe = window.api.onTransferProgress((event) => {
      setTransfers((prev) => {
        const idx = prev.findIndex((item) => item.id === event.id)
        if (idx >= 0) {
          const copy = [...prev]
          copy[idx] = event
          return copy
        }
        return [event, ...prev].slice(0, 25)
      })
    })
    return unsubscribe
  }, [])

  const handleConnected = (
    newIdentity: AwsIdentity,
    updatedProfiles?: SavedProfileMeta[]
  ) => {
    setIdentity(newIdentity)
    if (updatedProfiles) {
      setSavedProfiles(updatedProfiles)
    }
    setShowTokenModal(false)
    setExpiredTokenMessage(null)
    notify('success', `Sesion conectada en cuenta ${newIdentity.accountId} (${newIdentity.region}).`)
  }

  const handleExpiredToken = useCallback((msg: string) => {
    setExpiredTokenMessage(msg)
    setShowTokenModal(true)
  }, [])

  const handleRegionChange = async (newRegion: string) => {
    const resp = await window.api.changeRegion(newRegion)
    if (!resp.success) {
      notify('error', resp.error)
      return
    }
    setIdentity(resp.data)
    notify('info', `Region activa cambiada a ${newRegion}.`)
  }

  const handleDisconnect = async () => {
    await window.api.disconnectAws()
    setIdentity(null)
    setExpiredTokenMessage(null)
    setShowTokenModal(false)
    setTransfers([])
  }

  const handleDeleteProfile = async (profileId: string) => {
    const resp = await window.api.deleteSavedProfile(profileId)
    if (resp.success) {
      setSavedProfiles(resp.data)
      notify('info', 'Perfil cifrado eliminado de este equipo.')
    } else {
      notify('error', resp.error)
    }
  }

  const handleSaveCurrentSession = async (name: string) => {
    const resp = await window.api.saveCurrentSession(name)
    if (!resp.success) {
      notify('error', resp.error)
      return
    }
    const vaultResp = await window.api.getVaultState()
    if (vaultResp.success) {
      setSavedProfiles(vaultResp.data.profiles)
    }
    notify('success', `Perfil '${resp.data.name}' guardado cifrado con Windows DPAPI.`)
  }

  const handleAddRecentUri = async (uri: string) => {
    const resp = await window.api.addRecentS3Uri(uri)
    if (resp.success) {
      setRecentS3Uris(resp.data)
    }
  }

  const handleRemoveRecentUri = async (uri: string) => {
    const resp = await window.api.removeRecentS3Uri(uri)
    if (resp.success) {
      setRecentS3Uris(resp.data)
    }
  }

  const handleCancelTransfer = async (transferId: string) => {
    await window.api.cancelTransfer(transferId)
  }

  const handleClearFinishedTransfers = () => {
    setTransfers((prev) => prev.filter((t) => t.status === 'running'))
  }

  // Pantalla de bloqueo inicial si aun no hay sesion en RAM
  if (!identity) {
    return (
      <LoginSmartPaste
        mode="fullscreen"
        savedProfiles={savedProfiles}
        encryptionAvailable={encryptionAvailable}
        onConnected={handleConnected}
        onDeleteProfile={handleDeleteProfile}
      />
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* ==================== CABECERA SUPERIOR ==================== */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-slate-950 shadow">
            <Cloud className="h-5 w-5 stroke-[2.2]" />
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight text-white">NoCLI AWS</span>
            <span className="ml-2 hidden sm:inline-block rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
              Desktop S3 &amp; ECR
            </span>
          </div>
        </div>

        {/* Estado de Sesion, Region y Botones */}
        <div className="flex items-center gap-3">
          {/* Badge de Cuenta y Rol */}
          <div
            className={`hidden md:flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs ${
              expiredTokenMessage
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            }`}
            title={identity.arn}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                expiredTokenMessage ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'
              }`}
            />
            <span className="font-semibold font-mono">Cuenta {identity.accountId}</span>
            <span className="text-slate-500">|</span>
            <span className="max-w-[220px] truncate text-slate-200">{identity.shortPrincipal}</span>
          </div>

          {/* Selector rapido de Region */}
          <select
            value={identity.region}
            onChange={(e) => void handleRegionChange(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-amber-300 focus:border-amber-500 focus:outline-none"
            title="Cambiar region activa de AWS"
          >
            {AWS_REGIONS.map((reg) => (
              <option key={reg.code} value={reg.code}>
                {reg.code}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowTokenModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            <KeyRound className="h-3.5 w-3.5 text-amber-400" />
            <span>Cambiar Token</span>
          </button>

          <button
            type="button"
            onClick={() => void handleDisconnect()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 transition"
            title="Cerrar sesion y limpiar memoria RAM"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Banner persistente si se detecto token expirado y el usuario cerro el modal */}
      {expiredTokenMessage && !showTokenModal && (
        <div className="flex items-center justify-between bg-amber-500/15 border-b border-amber-500/40 px-5 py-2 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              <strong>Tu sesion temporal de AWS ha expirado.</strong> Pega un nuevo token para
              seguir operando en esta ventana.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowTokenModal(true)}
            className="rounded-lg bg-amber-500 px-3 py-1 font-semibold text-slate-950 hover:bg-amber-400"
          >
            Pegar Nuevo Token
          </button>
        </div>
      )}

      {/* ==================== CUERPO PRINCIPAL: MENU LATERAL + AREA DE TRABAJO ==================== */}
      <div className="flex flex-1 overflow-hidden">
        {/* Menu Lateral */}
        <aside className="flex w-52 shrink-0 flex-col justify-between border-r border-slate-800 bg-slate-900/60 p-3">
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => setActiveSection('s3')}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-medium transition ${
                activeSection === 's3'
                  ? 'bg-amber-500 text-slate-950 font-semibold shadow'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <FolderKanban className="h-4 w-4 shrink-0" />
              S3 Explorer
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('ecr')}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-medium transition ${
                activeSection === 'ecr'
                  ? 'bg-amber-500 text-slate-950 font-semibold shadow'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <Container className="h-4 w-4 shrink-0" />
              ECR &amp; Docker
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('profiles')}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-medium transition ${
                activeSection === 'profiles'
                  ? 'bg-amber-500 text-slate-950 font-semibold shadow'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <Shield className="h-4 w-4 shrink-0" />
              Sesion y Perfiles
            </button>
          </nav>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-[11px] text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">Sesion en Memoria</p>
            <p className="truncate font-mono text-[10px] text-slate-500">{identity.userId}</p>
            <p className="text-[10px] text-emerald-400">
              {identity.isTemporaryToken ? 'Credenciales STS activas' : 'Llave IAM activa'}
            </p>
          </div>
        </aside>

        {/* Area de Trabajo (Se mantienen montados S3 y ECR para no perder estado al cambiar de pestana) */}
        <main className="flex-1 overflow-hidden bg-slate-950">
          <div className={activeSection === 's3' ? 'h-full' : 'hidden'}>
            <S3Explorer
              region={identity.region}
              recentS3Uris={recentS3Uris}
              initialUriToOpen={pendingS3Uri}
              onClearInitialUri={() => setPendingS3Uri(null)}
              onAddRecentUri={handleAddRecentUri}
              onRemoveRecentUri={handleRemoveRecentUri}
              onExpiredToken={handleExpiredToken}
              onNotify={notify}
            />
          </div>

          <div className={activeSection === 'ecr' ? 'h-full' : 'hidden'}>
            <EcrManager
              identity={identity}
              onExpiredToken={handleExpiredToken}
              onNotify={notify}
            />
          </div>

          {activeSection === 'profiles' && (
            <ProfilesPanel
              identity={identity}
              savedProfiles={savedProfiles}
              recentS3Uris={recentS3Uris}
              encryptionAvailable={encryptionAvailable}
              onSaveCurrentSession={handleSaveCurrentSession}
              onDeleteProfile={handleDeleteProfile}
              onRemoveRecentUri={handleRemoveRecentUri}
              onOpenS3Uri={(uri) => {
                setPendingS3Uri(uri)
                setActiveSection('s3')
              }}
            />
          )}
        </main>
      </div>

      {/* ==================== BARRA INFERIOR DE TRANSFERENCIAS ==================== */}
      <TransferStatusBar
        transfers={transfers}
        onCancelTransfer={(id) => void handleCancelTransfer(id)}
        onClearFinished={handleClearFinishedTransfers}
      />

      {/* ==================== MODAL DE RENOVACION DE TOKEN ==================== */}
      {showTokenModal && (
        <LoginSmartPaste
          mode="modal"
          defaultRegion={identity.region}
          savedProfiles={savedProfiles}
          encryptionAvailable={encryptionAvailable}
          expiredMessage={expiredTokenMessage}
          onConnected={handleConnected}
          onDeleteProfile={handleDeleteProfile}
          onCloseModal={() => setShowTokenModal(false)}
        />
      )}

      {/* ==================== NOTIFICACIONES TOAST ==================== */}
      <div className="fixed bottom-12 right-5 z-50 flex flex-col gap-2 max-w-md">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs shadow-xl backdrop-blur-md ${
              toast.type === 'success'
                ? 'border-emerald-500/40 bg-slate-900/95 text-emerald-200'
                : toast.type === 'error'
                  ? 'border-red-500/40 bg-slate-900/95 text-red-200'
                  : 'border-sky-500/40 bg-slate-900/95 text-sky-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
            ) : toast.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            ) : (
              <Info className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" />
            )}
            <span className="leading-relaxed">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="ml-1 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

