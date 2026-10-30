import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Container,
  Cloud,
  Laptop,
  RefreshCw,
  Search,
  KeyRound,
  Terminal,
  ArrowRight,
  ArrowLeft,
  Plus,
  Copy,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  Eye,
  EyeOff,
  PanelLeftOpen,
  PanelLeftClose,
  Clock,
  Archive
} from 'lucide-react'
import type {
  AwsIdentity,
  EcrImageItem,
  EcrLifecyclePolicyResult,
  EcrLifecyclePreviewItem,
  EcrLifecyclePreviewResult,
  EcrRepositoryItem,
  LocalDockerImage,
  LocalDockerStatus,
  PowerShellCommandBundle
} from '@shared/types'
import { formatBytes, formatDaysAge, formatRelativeOrShortDate } from '../utils/formatters'
import { EcrLifecycleDrawer } from './EcrLifecycleDrawer'

interface EcrManagerProps {
  identity: AwsIdentity
  onExpiredToken: (msg: string) => void
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void
}

export const EcrManager: React.FC<EcrManagerProps> = ({
  identity,
  onExpiredToken,
  onNotify
}) => {
  // Panel deslizable de Docker Local (Cerrado por defecto para no estorbar si no se usa Docker)
  const [isDockerDrawerOpen, setIsDockerDrawerOpen] = useState(false)
  const [dockerStatus, setDockerStatus] = useState<LocalDockerStatus>({ connected: false })
  const [localImages, setLocalImages] = useState<LocalDockerImage[]>([])
  const [localFilter, setLocalFilter] = useState('')
  const [loadingLocal, setLoadingLocal] = useState(false)
  const [authenticatingDocker, setAuthenticatingDocker] = useState(false)

  // Estado Amazon ECR (Vista Principal)
  const [repositories, setRepositories] = useState<EcrRepositoryItem[]>([])
  const [selectedRepoName, setSelectedRepoName] = useState<string>('')
  const [manualRepoInput, setManualRepoInput] = useState<string>('')
  const [ecrImages, setEcrImages] = useState<EcrImageItem[]>([])
  const [repoFilter, setRepoFilter] = useState('')
  const [imageFilter, setImageFilter] = useState('')
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [loadingEcrImages, setLoadingEcrImages] = useState(false)
  const [ecrErrorBanner, setEcrErrorBanner] = useState<string | null>(null)

  // Estado Lifecycle de Imagenes ECR
  const [isLifecycleDrawerOpen, setIsLifecycleDrawerOpen] = useState(false)
  const [lifecyclePolicy, setLifecyclePolicy] = useState<EcrLifecyclePolicyResult | null>(null)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [loadingLifecycle, setLoadingLifecycle] = useState(false)
  const [lifecyclePreview, setLifecyclePreview] = useState<EcrLifecyclePreviewResult | null>(null)
  const [loadingLifecyclePreview, setLoadingLifecyclePreview] = useState(false)

  // Acciones en curso (Pull / Push)
  const [pullingUri, setPullingUri] = useState<string | null>(null)
  const [pushingInProgress, setPushingInProgress] = useState(false)

  // Modal: Crear Repositorio ECR
  const [showCreateRepoModal, setShowCreateRepoModal] = useState(false)
  const [newRepoName, setNewRepoName] = useState('')
  const [creatingRepo, setCreatingRepo] = useState(false)

  // Modal: Asistente Visual de Push (Local -> ECR)
  const [pushWizardImage, setPushWizardImage] = useState<LocalDockerImage | null>(null)
  const [pushTargetRepoUri, setPushTargetRepoUri] = useState('')
  const [pushTargetTag, setPushTargetTag] = useState('latest')

  // Modal: Generador de Comandos PowerShell (Fallback)
  const [psModalState, setPsModalState] = useState<{
    open: boolean
    loading: boolean
    title: string
    tab: 'direct' | 'awscli'
    revealToken: boolean
    copied: boolean
    bundle?: PowerShellCommandBundle
  } | null>(null)

  const registryHost = `${identity.accountId}.dkr.ecr.${identity.region}.amazonaws.com`

  const refreshLocalDocker = useCallback(async () => {
    setLoadingLocal(true)
    try {
      const statusResp = await window.api.getDockerStatus()
      if (statusResp.success) {
        setDockerStatus(statusResp.data)
        if (statusResp.data.connected) {
          const imgsResp = await window.api.listLocalDockerImages()
          if (imgsResp.success) {
            setLocalImages(imgsResp.data)
          }
        } else {
          setLocalImages([])
        }
      }
    } finally {
      setLoadingLocal(false)
    }
  }, [])

  const loadLifecycleForRepo = useCallback(
    async (repoName: string) => {
      if (!repoName) {
        setLifecyclePolicy(null)
        setLifecycleError(null)
        setLifecyclePreview(null)
        return
      }
      setLoadingLifecycle(true)
      setLifecycleError(null)
      try {
        const resp = await window.api.getEcrLifecyclePolicy(repoName)
        if (!resp.success) {
          if (resp.isExpiredToken) {
            onExpiredToken(resp.error)
            return
          }
          setLifecyclePolicy(null)
          setLifecycleError(resp.error)
          return
        }
        setLifecyclePolicy(resp.data)
      } finally {
        setLoadingLifecycle(false)
      }
    },
    [onExpiredToken]
  )

  const loadImagesForRepo = useCallback(
    async (repoName: string, repoUri?: string) => {
      if (!repoName) {
        setEcrImages([])
        return
      }
      setLoadingEcrImages(true)
      setEcrErrorBanner(null)
      setLifecyclePreview(null)
      try {
        const [imagesResp] = await Promise.all([
          window.api.listEcrImages({
            repositoryName: repoName,
            repositoryUri: repoUri
          }),
          loadLifecycleForRepo(repoName)
        ])

        if (!imagesResp.success) {
          if (imagesResp.isExpiredToken) {
            onExpiredToken(imagesResp.error)
            return
          }
          setEcrErrorBanner(imagesResp.error)
          setEcrImages([])
          return
        }

        setEcrImages(imagesResp.data)
      } finally {
        setLoadingEcrImages(false)
      }
    },
    [loadLifecycleForRepo, onExpiredToken]
  )

  const refreshEcrRepositories = useCallback(async () => {
    setLoadingRepos(true)
    setEcrErrorBanner(null)
    try {
      const resp = await window.api.listEcrRepositories()
      if (!resp.success) {
        if (resp.isExpiredToken) {
          onExpiredToken(resp.error)
          return
        }
        setEcrErrorBanner(resp.error)
        return
      }

      setRepositories(resp.data)
      if (resp.data.length > 0) {
        const currentStillExists = resp.data.find((r) => r.repositoryName === selectedRepoName)
        const target = currentStillExists || resp.data[0]
        setSelectedRepoName(target.repositoryName)
        await loadImagesForRepo(target.repositoryName, target.repositoryUri)
      } else {
        setSelectedRepoName('')
        setEcrImages([])
        setLifecyclePolicy(null)
      }
    } finally {
      setLoadingRepos(false)
    }
  }, [loadImagesForRepo, onExpiredToken, selectedRepoName])

  useEffect(() => {
    void refreshEcrRepositories()
    // Verificar estado de Docker silenciosamente sin abrir el panel
    void window.api.getDockerStatus().then((resp) => {
      if (resp.success) setDockerStatus(resp.data)
    })
  }, [identity.region, identity.accountId])

  const handleToggleDockerDrawer = () => {
    const nextOpen = !isDockerDrawerOpen
    setIsDockerDrawerOpen(nextOpen)
    if (nextOpen) {
      void refreshLocalDocker()
    }
  }

  const selectedRepoObj = useMemo(
    () => repositories.find((r) => r.repositoryName === selectedRepoName),
    [repositories, selectedRepoName]
  )

  const previewImpactByDigest = useMemo(() => {
    const map = new Map<string, EcrLifecyclePreviewItem>()
    for (const item of lifecyclePreview?.items || []) {
      if (item.imageDigest) {
        map.set(item.imageDigest, item)
      }
    }
    return map
  }, [lifecyclePreview])

  const filteredLocalImages = useMemo(() => {
    if (!localFilter.trim()) return localImages
    const q = localFilter.toLowerCase()
    return localImages.filter(
      (img) =>
        img.primaryTag.toLowerCase().includes(q) ||
        img.shortId.toLowerCase().includes(q) ||
        img.repoTags.some((t) => t.toLowerCase().includes(q))
    )
  }, [localImages, localFilter])

  const filteredRepositories = useMemo(() => {
    if (!repoFilter.trim()) return repositories
    const q = repoFilter.toLowerCase()
    return repositories.filter((r) => r.repositoryName.toLowerCase().includes(q))
  }, [repositories, repoFilter])

  const filteredEcrImages = useMemo(() => {
    if (!imageFilter.trim()) return ecrImages
    const q = imageFilter.toLowerCase()
    return ecrImages.filter(
      (img) =>
        img.imageDigest.toLowerCase().includes(q) ||
        img.imageTags.some((t) => t.toLowerCase().includes(q))
    )
  }, [ecrImages, imageFilter])

  // ==================== ACCIONES LIFECYCLE ====================

  const handleRunLifecyclePreview = async () => {
    if (!selectedRepoName) return
    setLoadingLifecyclePreview(true)
    try {
      const resp = await window.api.previewEcrLifecyclePolicy(selectedRepoName)
      if (!resp.success) {
        if (resp.isExpiredToken) onExpiredToken(resp.error)
        else onNotify('error', resp.error)
        return
      }
      setLifecyclePreview(resp.data)
    } finally {
      setLoadingLifecyclePreview(false)
    }
  }

  const handleSaveLifecyclePolicy = async (jsonText: string): Promise<boolean> => {
    if (!selectedRepoName) return false
    const resp = await window.api.putEcrLifecyclePolicy({
      repositoryName: selectedRepoName,
      lifecyclePolicyText: jsonText
    })

    if (!resp.success) {
      if (resp.isExpiredToken) onExpiredToken(resp.error)
      else onNotify('error', resp.error)
      return false
    }

    setLifecyclePolicy(resp.data)
    setLifecycleError(null)
    setLifecyclePreview(null)
    onNotify('success', `Politica de Lifecycle aplicada en '${selectedRepoName}'.`)
    return true
  }

  // ==================== ACCIONES DOCKER & ECR ====================

  const handleOneClickDockerLogin = async () => {
    setAuthenticatingDocker(true)
    try {
      const resp = await window.api.loginLocalDockerToEcr()
      if (!resp.success) {
        if (resp.isExpiredToken) onExpiredToken(resp.error)
        else onNotify('error', resp.error)
        return
      }

      const cliText = resp.data.cliConfigSaved
        ? ' (sesion guardada tambien en tu configuracion local de Docker)'
        : ''
      onNotify(
        'success',
        `Docker local autenticado con exito contra ${resp.data.registryHost}${cliText}.`
      )
      if (isDockerDrawerOpen) {
        await refreshLocalDocker()
      } else {
        const statusResp = await window.api.getDockerStatus()
        if (statusResp.success) setDockerStatus(statusResp.data)
      }
    } finally {
      setAuthenticatingDocker(false)
    }
  }

  const handleOpenPowerShellModal = async (params: {
    title: string
    mode: 'login' | 'pull' | 'push'
    ecrImageUri?: string
    localImageTag?: string
    targetRepositoryUri?: string
    targetTag?: string
  }) => {
    setPsModalState({
      open: true,
      loading: true,
      title: params.title,
      tab: 'direct',
      revealToken: false,
      copied: false
    })

    const resp = await window.api.getEcrPowerShellCommands({
      mode: params.mode,
      ecrImageUri: params.ecrImageUri,
      localImageTag: params.localImageTag,
      targetRepositoryUri: params.targetRepositoryUri,
      targetTag: params.targetTag
    })

    if (!resp.success) {
      setPsModalState(null)
      if (resp.isExpiredToken) onExpiredToken(resp.error)
      else onNotify('error', resp.error)
      return
    }

    setPsModalState({
      open: true,
      loading: false,
      title: params.title,
      tab: 'direct',
      revealToken: false,
      copied: false,
      bundle: resp.data
    })
  }

  const handlePullImage = async (img: EcrImageItem) => {
    const statusCheck = await window.api.getDockerStatus()
    const isConnected = statusCheck.success && statusCheck.data.connected
    if (statusCheck.success) setDockerStatus(statusCheck.data)

    if (!isConnected) {
      onNotify(
        'info',
        'Docker Desktop no se detecta abierto. Te generamos el comando de PowerShell listo para copiar.'
      )
      await handleOpenPowerShellModal({
        title: `Comandos para descargar ${img.repositoryName}`,
        mode: 'pull',
        ecrImageUri: img.imageUri
      })
      return
    }

    setPullingUri(img.imageUri)
    try {
      const resp = await window.api.pullEcrImageToLocal(img.imageUri)
      if (!resp.success) {
        if (resp.isExpiredToken) onExpiredToken(resp.error)
        else onNotify('error', resp.error)
        return
      }

      onNotify('success', `Imagen descargada correctamente a tu Docker local: ${img.imageUri}`)
      if (isDockerDrawerOpen) {
        await refreshLocalDocker()
      }
    } finally {
      setPullingUri(null)
    }
  }

  const openPushWizard = (localImg: LocalDockerImage) => {
    let defaultTag = 'latest'
    if (localImg.repoTags.length > 0) {
      const parts = localImg.repoTags[0].split(':')
      if (parts.length > 1 && parts[parts.length - 1]) {
        defaultTag = parts[parts.length - 1]
      }
    }

    const defaultRepoUri =
      selectedRepoObj?.repositoryUri ||
      repositories[0]?.repositoryUri ||
      `${registryHost}/mi-repositorio`

    setPushWizardImage(localImg)
    setPushTargetRepoUri(defaultRepoUri)
    setPushTargetTag(defaultTag)
  }

  const handleExecutePush = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pushWizardImage || !pushTargetRepoUri.trim()) return

    setPushingInProgress(true)
    try {
      const localRef = pushWizardImage.repoTags[0] || pushWizardImage.id
      const resp = await window.api.pushLocalImageToEcr({
        localImageRef: localRef,
        targetRepositoryUri: pushTargetRepoUri.trim(),
        targetTag: pushTargetTag.trim() || 'latest'
      })

      if (!resp.success) {
        if (resp.isExpiredToken) onExpiredToken(resp.error)
        else onNotify('error', resp.error)
        return
      }

      onNotify('success', `Imagen subida con exito a Amazon ECR: ${resp.data.pushedUri}`)
      setPushWizardImage(null)

      const pushedRepoName = pushTargetRepoUri.trim().split('/').slice(1).join('/')
      if (pushedRepoName) {
        setSelectedRepoName(pushedRepoName)
        await loadImagesForRepo(pushedRepoName, pushTargetRepoUri.trim())
      }
      await refreshLocalDocker()
    } finally {
      setPushingInProgress(false)
    }
  }

  const handleCreateRepository = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRepoName.trim()) return
    setCreatingRepo(true)
    try {
      const resp = await window.api.createEcrRepository(newRepoName.trim())
      if (!resp.success) {
        if (resp.isExpiredToken) onExpiredToken(resp.error)
        else onNotify('error', resp.error)
        return
      }

      onNotify('success', `Repositorio '${resp.data.repositoryName}' creado en Amazon ECR.`)
      setNewRepoName('')
      setShowCreateRepoModal(false)
      await refreshEcrRepositories()
      setSelectedRepoName(resp.data.repositoryName)
      await loadImagesForRepo(resp.data.repositoryName, resp.data.repositoryUri)
    } finally {
      setCreatingRepo(false)
    }
  }

  const handleManualRepoLoad = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = manualRepoInput.trim()
    if (!clean) return
    setSelectedRepoName(clean)
    await loadImagesForRepo(clean, `${registryHost}/${clean}`)
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* ==================== BARRA SUPERIOR DE CONTROLES ECR ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/70 px-5 py-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Boton para deslizar / abrir o cerrar el panel de Docker Local */}
          <button
            type="button"
            onClick={handleToggleDockerDrawer}
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-1.5 text-xs font-medium transition ${
              isDockerDrawerOpen
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                : 'border-slate-700 bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
            title="Mostrar u ocultar el panel deslizable de Docker Local"
          >
            {isDockerDrawerOpen ? (
              <PanelLeftClose className="h-4 w-4 text-sky-400" />
            ) : (
              <PanelLeftOpen className="h-4 w-4 text-sky-400" />
            )}
            <span>{isDockerDrawerOpen ? 'Ocultar Docker Local' : 'Abrir Docker Local'}</span>
            <span
              className={`h-2 w-2 rounded-full ${
                dockerStatus.connected ? 'bg-emerald-400' : 'bg-slate-500'
              }`}
              title={
                dockerStatus.connected
                  ? `Docker activo (v${dockerStatus.version})`
                  : 'Docker local cerrado'
              }
            />
          </button>

          <span className="hidden xl:inline-block font-mono text-xs text-slate-400">
            Registro: <strong className="text-slate-200">{registryHost}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {selectedRepoName && (
            <button
              type="button"
              onClick={() => setIsLifecycleDrawerOpen(true)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                lifecyclePolicy?.hasPolicy
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span>
                Lifecycle{' '}
                {lifecyclePolicy?.hasPolicy
                  ? `(${lifecyclePolicy.rules.length} regla${
                      lifecyclePolicy.rules.length === 1 ? '' : 's'
                    })`
                  : '(Ver / Configurar)'}
              </span>
            </button>
          )}

          <button
            type="button"
            disabled={authenticatingDocker}
            onClick={() => void handleOneClickDockerLogin()}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition shadow-sm"
          >
            {authenticatingDocker ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" />
            )}
            Autenticar Docker (1 Clic)
          </button>

          <button
            type="button"
            onClick={() =>
              void handleOpenPowerShellModal({
                title: 'Comando de Login en PowerShell para Amazon ECR',
                mode: 'login'
              })
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            <Terminal className="h-3.5 w-3.5 text-sky-400" />
            PowerShell
          </button>
        </div>
      </div>

      {/* Mensaje de error ECR (ej. AccessDenied IAM) */}
      {ecrErrorBanner && (
        <div className="mx-5 mt-3 flex items-start justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <span>{ecrErrorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setEcrErrorBanner(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ==================== CUERPO FLEXIBLE: DRAWER DESLIZABLE DOCKER + ECR 100% ==================== */}
      <div className="flex flex-1 overflow-hidden">
        {/* Pestana lateral delgada cuando Docker esta cerrado para abrir deslizando con 1 clic */}
        {!isDockerDrawerOpen && (
          <button
            type="button"
            onClick={handleToggleDockerDrawer}
            className="group flex w-9 shrink-0 flex-col items-center justify-center gap-3 border-r border-slate-800/90 bg-slate-900/50 hover:bg-slate-800/80 transition"
            title="Deslizar panel de Docker Local"
          >
            <PanelLeftOpen className="h-4 w-4 text-slate-400 group-hover:text-sky-400 transition" />
            <span
              className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 group-hover:text-slate-200 transition"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              Docker Local
            </span>
          </button>
        )}

        {/* PANEL IZQUIERDO DESLIZABLE: TU PC - DOCKER LOCAL */}
        <aside
          className={`flex flex-col overflow-hidden bg-slate-950/60 transition-all duration-300 ease-in-out ${
            isDockerDrawerOpen
              ? 'w-[370px] xl:w-[420px] shrink-0 border-r border-slate-800 opacity-100'
              : 'w-0 shrink-0 border-r-0 opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 bg-slate-900/50 min-w-[370px]">
            <div className="flex items-center gap-2">
              <Laptop className="h-4 w-4 text-sky-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                Tu PC - Docker ({localImages.length})
              </h2>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={loadingLocal}
                onClick={() => void refreshLocalDocker()}
                className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700"
                title="Refrescar imagenes locales"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingLocal ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => setIsDockerDrawerOpen(false)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 hover:text-white"
                title="Cerrar y deslizar panel de Docker"
              >
                <PanelLeftClose className="h-3.5 w-3.5 text-sky-400" />
                Cerrar
              </button>
            </div>
          </div>

          {dockerStatus.connected && (
            <div className="border-b border-slate-800/80 bg-slate-900/30 px-4 py-2 min-w-[370px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={localFilter}
                  onChange={(e) => setLocalFilter(e.target.value)}
                  placeholder="Filtrar imagenes de tu PC..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-w-[370px]">
            {loadingLocal ? (
              <div className="flex h-44 items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
                Consultando Docker Desktop...
              </div>
            ) : !dockerStatus.connected ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-center space-y-3">
                <Container className="mx-auto h-8 w-8 text-amber-400" />
                <h3 className="text-xs font-semibold text-white">Docker Desktop no esta abierto</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Si deseas subir imagenes desde tu PC, inicia Docker Desktop y pulsa Reintentar. Si
                  no vas a usar Docker ahora, puedes cerrar este panel lateral para trabajar a
                  pantalla completa.
                </p>
                <div className="flex items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void refreshLocalDocker()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500/15 border border-sky-500/30 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reintentar
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDockerDrawerOpen(false)}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    Ocultar Panel
                  </button>
                </div>
              </div>
            ) : filteredLocalImages.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center text-xs text-slate-400">
                {localImages.length === 0
                  ? 'No tienes imagenes locales en Docker todavia.'
                  : 'Ninguna imagen local coincide con tu filtro.'}
              </div>
            ) : (
              filteredLocalImages.map((img) => (
                <div
                  key={img.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/75 p-3.5 hover:border-slate-700 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className="font-mono text-xs font-semibold text-white truncate"
                        title={img.primaryTag}
                      >
                        {img.primaryTag}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span className="font-mono">ID: {img.shortId}</span>
                        <span>|</span>
                        <span>{formatBytes(img.sizeInBytes)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openPushWizard(img)}
                      className="inline-flex items-center gap-1 rounded-lg bg-sky-500/15 border border-sky-500/30 px-2.5 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 shrink-0 transition"
                    >
                      Push
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ==================== AREA PRINCIPAL (100% EXPANDIBLE): AMAZON ECR ==================== */}
        <section className="flex flex-1 flex-col overflow-hidden bg-slate-950/20">
          {/* Selector y buscador de Repositorio ECR */}
          <div className="border-b border-slate-800 bg-slate-900/40 px-5 py-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-amber-400" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Repositorios Amazon ECR ({repositories.length})
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNewRepoName('')
                    setShowCreateRepoModal(true)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 transition"
                >
                  <Plus className="h-3.5 w-3.5 text-amber-400" />
                  Nuevo Repo
                </button>

                <button
                  type="button"
                  disabled={loadingRepos || loadingEcrImages}
                  onClick={() => void refreshEcrRepositories()}
                  className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700"
                  title="Refrescar repositorios e imagenes ECR"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      loadingRepos || loadingEcrImages ? 'animate-spin' : ''
                    }`}
                  />
                </button>
              </div>
            </div>

            {repositories.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-12">
                <div className="sm:col-span-3 relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
                  <input
                    type="text"
                    value={repoFilter}
                    onChange={(e) => setRepoFilter(e.target.value)}
                    placeholder="Filtrar repos..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-7 pr-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-6">
                  <select
                    value={selectedRepoName}
                    onChange={(e) => {
                      const nextName = e.target.value
                      setSelectedRepoName(nextName)
                      const found = repositories.find((r) => r.repositoryName === nextName)
                      void loadImagesForRepo(nextName, found?.repositoryUri)
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-amber-300 focus:border-amber-500 focus:outline-none"
                  >
                    {filteredRepositories.map((repo) => (
                      <option key={repo.repositoryName} value={repo.repositoryName}>
                        {repo.repositoryName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3 relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
                  <input
                    type="text"
                    value={imageFilter}
                    onChange={(e) => setImageFilter(e.target.value)}
                    placeholder="Filtrar tag o sha256..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-7 pr-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <form onSubmit={handleManualRepoLoad} className="flex gap-2">
                <input
                  type="text"
                  value={manualRepoInput}
                  onChange={(e) => setManualRepoInput(e.target.value)}
                  placeholder="Nombre directo del repositorio ECR (ej. backend/pagos-api)"
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  Abrir Repo
                </button>
              </form>
            )}
          </div>

          {/* Lista de Imagenes y Resumen de Lifecycle del Repositorio Seleccionado */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {selectedRepoName && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-slate-300 truncate selectable-text">
                    {selectedRepoObj?.repositoryUri || `${registryHost}/${selectedRepoName}`}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const uri =
                        selectedRepoObj?.repositoryUri || `${registryHost}/${selectedRepoName}`
                      await navigator.clipboard.writeText(uri)
                      onNotify('success', 'URI del repositorio copiada al portapapeles.')
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 shrink-0"
                  >
                    <Copy className="h-3 w-3" />
                    Copiar
                  </button>
                </div>

                {/* Resumen rapido de Lifecycle clicable */}
                <button
                  type="button"
                  onClick={() => setIsLifecycleDrawerOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-amber-300 transition"
                >
                  <Clock className="h-3.5 w-3.5 text-amber-400" />
                  {loadingLifecycle ? (
                    <span>Consultando Lifecycle...</span>
                  ) : lifecyclePolicy?.hasPolicy ? (
                    <span>
                      Politica Lifecycle activa:{' '}
                      <strong className="text-emerald-300">
                        {lifecyclePolicy.rules.length} regla(s)
                      </strong>{' '}
                      (Ver detalle)
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      Sin politica de retencion Lifecycle (Configurar)
                    </span>
                  )}
                </button>
              </div>
            )}

            {loadingRepos || loadingEcrImages ? (
              <div className="flex h-48 items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                Consultando imagenes en Amazon ECR...
              </div>
            ) : !selectedRepoName ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-xs text-slate-400">
                No hay repositorios seleccionados en esta region ({identity.region}). Puedes crear
                uno nuevo o cambiar de region arriba.
              </div>
            ) : filteredEcrImages.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-xs text-slate-400">
                {ecrImages.length === 0
                  ? `El repositorio '${selectedRepoName}' aun no tiene imagenes subidas.`
                  : 'Ninguna imagen coincide con el filtro de tags.'}
              </div>
            ) : (
              filteredEcrImages.map((img) => {
                const isPulling = pullingUri === img.imageUri
                const shortDigest = img.imageDigest.replace('sha256:', '').slice(0, 14)
                const lifecycleImpact = previewImpactByDigest.get(img.imageDigest)
                const isArchived = img.imageStatus === 'ARCHIVED'

                return (
                  <div
                    key={img.imageDigest || img.imageUri}
                    className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 hover:border-slate-700 transition space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      {/* Etiquetas (Tags) + Badges de Estado de Ciclo de Vida */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {img.imageTags.length > 0 ? (
                          img.imageTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-amber-300"
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">
                            &lt;sin-tag&gt;
                          </span>
                        )}

                        {isArchived && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                            <Archive className="h-3 w-3" />
                            Archive Tier
                          </span>
                        )}

                        {lifecycleImpact && (
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                              lifecycleImpact.actionType.toUpperCase() === 'EXPIRE'
                                ? 'border-red-500/35 bg-red-500/15 text-red-300'
                                : 'border-sky-500/35 bg-sky-500/15 text-sky-300'
                            }`}
                          >
                            {lifecycleImpact.actionType.toUpperCase() === 'EXPIRE'
                              ? `Expirara por Regla #${lifecycleImpact.appliedRulePriority}`
                              : `Pasara a Archive (Regla #${lifecycleImpact.appliedRulePriority})`}
                          </span>
                        )}
                      </div>

                      {/* Botones Pull y PowerShell */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isPulling}
                          onClick={() => void handlePullImage(img)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
                        >
                          {isPulling ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ArrowLeft className="h-3.5 w-3.5" />
                          )}
                          Descargar a mi PC
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void handleOpenPowerShellModal({
                              title: `Comandos PowerShell para Pull (${selectedRepoName})`,
                              mode: 'pull',
                              ecrImageUri: img.imageUri
                            })
                          }
                          className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700"
                          title="Ver comando PowerShell para esta imagen"
                        >
                          <Terminal className="h-3.5 w-3.5 text-sky-400" />
                        </button>
                      </div>
                    </div>

                    {/* Metadatos e Informacion de Ciclo de Vida por Imagen */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-0.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span>
                          Tamano:{' '}
                          <strong className="font-mono text-slate-200">
                            {formatBytes(img.imageSizeInBytes)}
                          </strong>
                        </span>
                        <span className="text-slate-600">|</span>
                        <span>
                          Subida: <strong className="text-slate-300">{formatRelativeOrShortDate(img.imagePushedAt)}</strong>{' '}
                          <span className="text-slate-500">({formatDaysAge(img.imagePushedAt)})</span>
                        </span>
                        <span className="text-slate-600">|</span>
                        <span>
                          Ultimo pull:{' '}
                          <strong className="text-slate-300">
                            {img.lastRecordedPullTime
                              ? formatRelativeOrShortDate(img.lastRecordedPullTime)
                              : 'Sin registro reciente'}
                          </strong>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-500" title={img.imageDigest}>
                          sha256:{shortDigest}...
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(img.imageUri)
                            onNotify('success', 'URI completa de la imagen copiada.')
                          }}
                          className="inline-flex items-center gap-1 text-slate-300 hover:text-amber-300"
                        >
                          <Copy className="h-3 w-3" />
                          URI
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      {/* ==================== DRAWER DERECHO: LIFECYCLE DE IMAGENES ==================== */}
      <EcrLifecycleDrawer
        open={isLifecycleDrawerOpen}
        repositoryName={selectedRepoName}
        policyResult={lifecyclePolicy}
        policyError={lifecycleError}
        loadingPolicy={loadingLifecycle}
        previewResult={lifecyclePreview}
        loadingPreview={loadingLifecyclePreview}
        onClose={() => setIsLifecycleDrawerOpen(false)}
        onRefreshPolicy={() => loadLifecycleForRepo(selectedRepoName)}
        onRunPreview={handleRunLifecyclePreview}
        onSavePolicy={handleSaveLifecyclePolicy}
        onNotify={onNotify}
      />

      {/* ==================== MODAL: ASISTENTE VISUAL DE PUSH (LOCAL -> ECR) ==================== */}
      {pushWizardImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleExecutePush}
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Enviar Imagen Local hacia Amazon ECR (Push)
              </h3>
              <button
                type="button"
                onClick={() => setPushWizardImage(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
              <p className="text-slate-400">Imagen origen en tu PC:</p>
              <p className="font-mono font-semibold text-sky-300 mt-0.5">
                {pushWizardImage.primaryTag} ({formatBytes(pushWizardImage.sizeInBytes)})
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Repositorio destino en Amazon ECR
              </label>
              {repositories.length > 0 ? (
                <select
                  value={pushTargetRepoUri}
                  onChange={(e) => setPushTargetRepoUri(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
                >
                  {repositories.map((repo) => (
                    <option key={repo.repositoryUri} value={repo.repositoryUri}>
                      {repo.repositoryName} ({repo.repositoryUri})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={pushTargetRepoUri}
                  onChange={(e) => setPushTargetRepoUri(e.target.value)}
                  placeholder={`${registryHost}/nombre-repositorio`}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Tag (Version de la imagen en ECR)
              </label>
              <input
                type="text"
                value={pushTargetTag}
                onChange={(e) => setPushTargetTag(e.target.value)}
                placeholder="latest o v1.0.0"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs">
              <p className="text-[11px] text-amber-200/80">Se etiquetara y subira como:</p>
              <p className="font-mono text-amber-300 break-all mt-0.5">
                {pushTargetRepoUri}:{pushTargetTag || 'latest'}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  const localRef = pushWizardImage.repoTags[0] || pushWizardImage.shortId
                  void handleOpenPowerShellModal({
                    title: 'Comandos PowerShell para Etiquetar y Subir (Push)',
                    mode: 'push',
                    localImageTag: localRef,
                    targetRepositoryUri: pushTargetRepoUri,
                    targetTag: pushTargetTag || 'latest'
                  })
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs text-slate-200 hover:bg-slate-700"
              >
                <Terminal className="h-3.5 w-3.5 text-sky-400" />
                Copiar Comandos PS
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pushingInProgress}
                  onClick={() => setPushWizardImage(null)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pushingInProgress || !pushTargetRepoUri.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  {pushingInProgress ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Subiendo...
                    </>
                  ) : (
                    <>
                      Subir Ahora
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: CREAR REPOSITORIO ECR ==================== */}
      {showCreateRepoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateRepository}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Crear Repositorio en Amazon ECR</h3>
              <button
                type="button"
                onClick={() => setShowCreateRepoModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">
                Nombre del repositorio (en {identity.region})
              </label>
              <input
                type="text"
                autoFocus
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
                placeholder="Ej. microservicios/usuarios-api"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCreateRepoModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creatingRepo || !newRepoName.trim()}
                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {creatingRepo ? 'Creando...' : 'Crear Repositorio'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: GENERADOR DE COMANDOS POWERSHELL ==================== */}
      {psModalState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">{psModalState.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPsModalState(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setPsModalState({ ...psModalState, tab: 'direct', copied: false })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    psModalState.tab === 'direct'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Directo (Sin instalar AWS CLI)
                </button>
                <button
                  type="button"
                  onClick={() => setPsModalState({ ...psModalState, tab: 'awscli', copied: false })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    psModalState.tab === 'awscli'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Estandar (Con AWS CLI)
                </button>
              </div>

              {psModalState.tab === 'direct' && !psModalState.loading && (
                <button
                  type="button"
                  onClick={() =>
                    setPsModalState({
                      ...psModalState,
                      revealToken: !psModalState.revealToken
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"
                >
                  {psModalState.revealToken ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      Ocultar token en pantalla
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      Mostrar token completo
                    </>
                  )}
                </button>
              )}
            </div>

            {psModalState.loading ? (
              <div className="flex h-36 items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                Generando token temporal de ECR...
              </div>
            ) : (
              psModalState.bundle && (
                <div className="space-y-3">
                  <pre className="max-h-60 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-sky-300 whitespace-pre-wrap break-all selectable-text">
                    {psModalState.tab === 'direct'
                      ? psModalState.revealToken
                        ? psModalState.bundle.directNoCliScript
                        : maskPowerShellToken(psModalState.bundle.directNoCliScript)
                      : psModalState.bundle.standardAwsCliScript}
                  </pre>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      {psModalState.tab === 'direct'
                        ? 'Al copiar se incluye el token real listo para pegar en PowerShell.'
                        : 'Requiere tener instalado aws-cli en tu sistema.'}
                    </span>

                    <button
                      type="button"
                      onClick={async () => {
                        if (!psModalState.bundle) return
                        const scriptToCopy =
                          psModalState.tab === 'direct'
                            ? psModalState.bundle.directNoCliScript
                            : psModalState.bundle.standardAwsCliScript
                        await navigator.clipboard.writeText(scriptToCopy)
                        setPsModalState({ ...psModalState, copied: true })
                        onNotify('success', 'Comandos de PowerShell copiados al portapapeles.')
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                    >
                      {psModalState.copied ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Copiado al Portapapeles
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copiar Comando Exacto
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function maskPowerShellToken(script: string): string {
  return script.replace(/^'([^']{14})[^']+'(\s*\|\s*docker login)/m, "'$1...[TOKEN_OCULTO]'$2")
}
