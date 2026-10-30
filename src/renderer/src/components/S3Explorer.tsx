import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Folder,
  FolderPlus,
  Upload,
  FolderUp,
  RefreshCw,
  Search,
  ChevronRight,
  CornerLeftUp,
  Download,
  Link2,
  Trash2,
  Eye,
  Database,
  AlertCircle,
  Bookmark,
  X,
  Copy,
  Check,
  FileText,
  FileJson,
  FileSpreadsheet,
  Image as ImageIcon,
  FileArchive,
  File as FileIcon,
  Loader2
} from 'lucide-react'
import type {
  S3BucketItem,
  S3FolderItem,
  S3ObjectItem,
  S3PreviewResult
} from '@shared/types'
import { parseS3Uri } from '@shared/credentialParser'
import {
  formatBytes,
  formatPrettyJson,
  formatRelativeOrShortDate,
  parseCsvPreview
} from '../utils/formatters'

interface S3ExplorerProps {
  region: string
  recentS3Uris: string[]
  initialUriToOpen?: string | null
  onClearInitialUri?: () => void
  onAddRecentUri: (uri: string) => Promise<void>
  onRemoveRecentUri: (uri: string) => Promise<void>
  onExpiredToken: (msg: string) => void
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void
}

const PRESIGN_OPTIONS = [
  { label: '15 minutos', seconds: 15 * 60 },
  { label: '1 hora', seconds: 3600 },
  { label: '6 horas', seconds: 6 * 3600 },
  { label: '12 horas', seconds: 12 * 3600 },
  { label: '24 horas', seconds: 24 * 3600 },
  { label: '7 dias (Maximo S3)', seconds: 7 * 24 * 3600 }
]

export const S3Explorer: React.FC<S3ExplorerProps> = ({
  region,
  recentS3Uris,
  initialUriToOpen,
  onClearInitialUri,
  onAddRecentUri,
  onRemoveRecentUri,
  onExpiredToken,
  onNotify
}) => {
  // Estado de ubicacion
  const [currentBucket, setCurrentBucket] = useState<string | null>(null)
  const [currentPrefix, setCurrentPrefix] = useState<string>('')
  const [uriInput, setUriInput] = useState<string>('s3://')

  // Datos de vista raiz (Buckets)
  const [buckets, setBuckets] = useState<S3BucketItem[]>([])
  const [listRestricted, setListRestricted] = useState(false)
  const [restrictionMessage, setRestrictionMessage] = useState<string | null>(null)

  // Datos dentro de un Bucket
  const [folders, setFolders] = useState<S3FolderItem[]>([])
  const [objects, setObjects] = useState<S3ObjectItem[]>([])
  const [nextToken, setNextToken] = useState<string | undefined>(undefined)

  // Filtros y estados visuales
  const [searchFilter, setSearchFilter] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)

  // Modales: Nueva Carpeta, Vista Previa, Presigned URL, Confirmar Borrado
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

  const [previewTarget, setPreviewTarget] = useState<{
    object: S3ObjectItem
    loading: boolean
    result?: S3PreviewResult
    rawCsvMode?: boolean
  } | null>(null)

  const [presignTarget, setPresignTarget] = useState<{
    object: S3ObjectItem
    expiresInSeconds: number
    loading: boolean
    generatedUrl?: string
    temporaryWarning?: boolean
    copied?: boolean
  } | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<{
    name: string
    key: string
    isFolder: boolean
    deleting: boolean
  } | null>(null)

  const loadBuckets = useCallback(async () => {
    setIsLoading(true)
    setErrorBanner(null)
    try {
      const resp = await window.api.listS3Buckets()
      if (!resp.success) {
        if (resp.isExpiredToken) {
          onExpiredToken(resp.error)
          return
        }
        setErrorBanner(resp.error)
        return
      }

      setBuckets(resp.data.buckets)
      setListRestricted(resp.data.listRestricted)
      setRestrictionMessage(resp.data.restrictionMessage || null)
    } finally {
      setIsLoading(false)
    }
  }, [onExpiredToken])

  const loadObjects = useCallback(
    async (bucket: string, prefix: string, appendToken?: string) => {
      if (appendToken) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setErrorBanner(null)
      }

      try {
        const resp = await window.api.listS3Objects({
          bucket,
          prefix,
          continuationToken: appendToken
        })

        if (!resp.success) {
          if (resp.isExpiredToken) {
            onExpiredToken(resp.error)
            return
          }
          setErrorBanner(resp.error)
          return
        }

        if (appendToken) {
          setFolders((prev) => {
            const existing = new Set(prev.map((f) => f.prefix))
            return [...prev, ...resp.data.folders.filter((f) => !existing.has(f.prefix))]
          })
          setObjects((prev) => [...prev, ...resp.data.objects])
        } else {
          setFolders(resp.data.folders)
          setObjects(resp.data.objects)
        }

        setNextToken(resp.data.isTruncated ? resp.data.nextContinuationToken : undefined)
      } finally {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    },
    [onExpiredToken]
  )

  const navigateTo = useCallback(
    async (bucket: string | null, prefix = '', saveRecent = false) => {
      setSearchFilter('')
      if (!bucket) {
        setCurrentBucket(null)
        setCurrentPrefix('')
        setUriInput('s3://')
        await loadBuckets()
        return
      }

      const cleanPrefix = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : ''
      const formattedUri = `s3://${bucket}/${cleanPrefix}`
      setCurrentBucket(bucket)
      setCurrentPrefix(cleanPrefix)
      setUriInput(formattedUri)
      await loadObjects(bucket, cleanPrefix)

      if (saveRecent) {
        await onAddRecentUri(formattedUri)
      }
    },
    [loadBuckets, loadObjects, onAddRecentUri]
  )

  // Carga inicial o cuando cambia la region
  useEffect(() => {
    if (currentBucket) {
      void loadObjects(currentBucket, currentPrefix)
    } else {
      void loadBuckets()
    }
  }, [region])

  // Si desde el panel de perfiles se solicito abrir una ruta S3 especifica
  useEffect(() => {
    if (initialUriToOpen) {
      const parsed = parseS3Uri(initialUriToOpen)
      if (parsed) {
        void navigateTo(parsed.bucket, parsed.prefix, false)
      }
      onClearInitialUri?.()
    }
  }, [initialUriToOpen, navigateTo, onClearInitialUri])

  const handleDirectUriSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const raw = uriInput.trim()
    if (!raw || raw.toLowerCase() === 's3://') {
      await navigateTo(null)
      return
    }

    const parsed = parseS3Uri(raw)
    if (!parsed) {
      onNotify(
        'error',
        'Formato de ruta invalido. Escribe algo como s3://mi-bucket/ o s3://mi-bucket/carpeta/'
      )
      return
    }

    await navigateTo(parsed.bucket, parsed.prefix, true)
  }

  const handleGoUpLevel = () => {
    if (!currentBucket) return
    if (!currentPrefix) {
      void navigateTo(null)
      return
    }
    const parts = currentPrefix.replace(/\/$/, '').split('/')
    parts.pop()
    const parentPrefix = parts.length > 0 ? `${parts.join('/')}/` : ''
    void navigateTo(currentBucket, parentPrefix)
  }

  const breadcrumbSegments = useMemo(() => {
    if (!currentPrefix) return []
    const parts = currentPrefix.replace(/\/$/, '').split('/').filter(Boolean)
    return parts.map((part, idx) => ({
      label: part,
      prefix: `${parts.slice(0, idx + 1).join('/')}/`
    }))
  }, [currentPrefix])

  // Filtrado local
  const filteredBuckets = useMemo(() => {
    if (!searchFilter.trim()) return buckets
    const q = searchFilter.toLowerCase()
    return buckets.filter((b) => b.name.toLowerCase().includes(q))
  }, [buckets, searchFilter])

  const filteredFolders = useMemo(() => {
    if (!searchFilter.trim()) return folders
    const q = searchFilter.toLowerCase()
    return folders.filter((f) => f.name.toLowerCase().includes(q))
  }, [folders, searchFilter])

  const filteredObjects = useMemo(() => {
    if (!searchFilter.trim()) return objects
    const q = searchFilter.toLowerCase()
    return objects.filter((o) => o.name.toLowerCase().includes(q))
  }, [objects, searchFilter])

  // ==================== ACCIONES S3 ====================

  const handlePickUpload = async (directory: boolean) => {
    if (!currentBucket) return
    const resp = await window.api.pickAndUploadS3({
      bucket: currentBucket,
      prefix: currentPrefix,
      directory
    })

    if (!resp.success) {
      if (resp.isExpiredToken) onExpiredToken(resp.error)
      else onNotify('error', resp.error)
      return
    }

    if (!resp.data.cancelled) {
      onNotify(
        'success',
        `Se subieron ${resp.data.uploadedFiles} archivo(s) (${formatBytes(resp.data.totalBytes)}) a S3.`
      )
      await loadObjects(currentBucket, currentPrefix)
    }
  }

  // Drag & Drop desde el Escritorio / Explorador de Windows
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!currentBucket) return
    dragCounter.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!currentBucket) return
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDraggingOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDraggingOver(false)

    if (!currentBucket) {
      onNotify('info', 'Abre primero un bucket de S3 para soltar y subir tus archivos.')
      return
    }

    const droppedFiles = Array.from(e.dataTransfer.files)
    const localPaths = droppedFiles
      .map((f) => window.api.getPathForFile(f))
      .filter((p) => Boolean(p))

    if (localPaths.length === 0) {
      onNotify('error', 'No se pudieron obtener las rutas locales de los elementos arrastrados.')
      return
    }

    const resp = await window.api.uploadPathsToS3({
      bucket: currentBucket,
      prefix: currentPrefix,
      localPaths
    })

    if (!resp.success) {
      if (resp.isExpiredToken) onExpiredToken(resp.error)
      else onNotify('error', resp.error)
      return
    }

    onNotify(
      'success',
      `Subida completada: ${resp.data.uploadedFiles} archivo(s) (${formatBytes(resp.data.totalBytes)}).`
    )
    await loadObjects(currentBucket, currentPrefix)
  }

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentBucket || !newFolderName.trim()) return

    setIsCreatingFolder(true)
    try {
      const resp = await window.api.createS3Folder({
        bucket: currentBucket,
        prefix: currentPrefix,
        folderName: newFolderName.trim()
      })

      if (!resp.success) {
        if (resp.isExpiredToken) onExpiredToken(resp.error)
        else onNotify('error', resp.error)
        return
      }

      onNotify('success', `Carpeta '${newFolderName.trim()}' creada correctamente.`)
      setNewFolderName('')
      setShowNewFolderModal(false)
      await loadObjects(currentBucket, currentPrefix)
    } finally {
      setIsCreatingFolder(false)
    }
  }

  const handleDownload = async (obj: S3ObjectItem) => {
    if (!currentBucket) return
    const resp = await window.api.downloadS3Object({
      bucket: currentBucket,
      key: obj.key
    })

    if (!resp.success) {
      if (resp.isExpiredToken) onExpiredToken(resp.error)
      else onNotify('error', resp.error)
      return
    }

    if (!resp.data.cancelled) {
      onNotify('success', `Archivo guardado en ${resp.data.savedPath}`)
    }
  }

  const handleOpenPreview = async (obj: S3ObjectItem) => {
    if (!currentBucket) return
    setPreviewTarget({ object: obj, loading: true })

    const resp = await window.api.previewS3Object({
      bucket: currentBucket,
      key: obj.key
    })

    if (!resp.success) {
      setPreviewTarget(null)
      if (resp.isExpiredToken) onExpiredToken(resp.error)
      else onNotify('error', resp.error)
      return
    }

    setPreviewTarget({
      object: obj,
      loading: false,
      result: resp.data,
      rawCsvMode: false
    })
  }

  const handleGeneratePresigned = async (obj: S3ObjectItem, expiresInSeconds: number) => {
    if (!currentBucket) return
    setPresignTarget({
      object: obj,
      expiresInSeconds,
      loading: true
    })

    const resp = await window.api.getS3PresignedUrl({
      bucket: currentBucket,
      key: obj.key,
      expiresInSeconds
    })

    if (!resp.success) {
      setPresignTarget(null)
      if (resp.isExpiredToken) onExpiredToken(resp.error)
      else onNotify('error', resp.error)
      return
    }

    await navigator.clipboard.writeText(resp.data.url)
    setPresignTarget({
      object: obj,
      expiresInSeconds,
      loading: false,
      generatedUrl: resp.data.url,
      temporaryWarning: resp.data.temporaryTokenWarning,
      copied: true
    })
  }

  const handleConfirmDelete = async () => {
    if (!currentBucket || !deleteTarget) return
    setDeleteTarget({ ...deleteTarget, deleting: true })

    const resp = await window.api.deleteS3Item({
      bucket: currentBucket,
      key: deleteTarget.key,
      isFolder: deleteTarget.isFolder
    })

    if (!resp.success) {
      setDeleteTarget(null)
      if (resp.isExpiredToken) onExpiredToken(resp.error)
      else onNotify('error', resp.error)
      return
    }

    onNotify(
      'success',
      deleteTarget.isFolder
        ? `Carpeta '${deleteTarget.name}' eliminada (${resp.data} objeto(s)).`
        : `Archivo '${deleteTarget.name}' eliminado.`
    )
    setDeleteTarget(null)
    await loadObjects(currentBucket, currentPrefix)
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Overlay visual de Drag & Drop */}
      {isDraggingOver && currentBucket && (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-amber-400 bg-slate-950/90 backdrop-blur-sm">
          <Upload className="h-12 w-12 text-amber-400 mb-3 animate-bounce" />
          <p className="text-base font-semibold text-white">
            Suelta tus archivos o carpetas aqui para subirlos
          </p>
          <p className="mt-1 font-mono text-xs text-amber-300">
            Destino: s3://{currentBucket}/{currentPrefix}
          </p>
        </div>
      )}

      {/* Barra Superior de Ruta Directa S3 */}
      <div className="border-b border-slate-800 bg-slate-900/70 px-5 py-3.5 space-y-2.5">
        <form onSubmit={handleDirectUriSubmit} className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-amber-400">
              Ruta S3:
            </span>
            <input
              type="text"
              value={uriInput}
              onChange={(e) => setUriInput(e.target.value)}
              placeholder="s3://mi-bucket-corporativo/carpeta/"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-20 pr-4 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition shrink-0"
          >
            Ir a Ruta
          </button>

          {currentBucket && (
            <button
              type="button"
              onClick={() => {
                const uri = `s3://${currentBucket}/${currentPrefix}`
                void onAddRecentUri(uri)
                onNotify('success', `Ruta guardada en accesos rapidos: ${uri}`)
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 transition shrink-0"
              title="Guardar esta ruta S3 como acceso directo"
            >
              <Bookmark className="h-3.5 w-3.5 text-amber-400" />
              Guardar Ruta
            </button>
          )}
        </form>

        {/* Chips de rutas recientes / guardadas */}
        {recentS3Uris.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="text-[11px] text-slate-500 shrink-0 mr-1">Accesos rapidos:</span>
            {recentS3Uris.map((uri) => (
              <div
                key={uri}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] font-mono text-slate-300 hover:border-slate-700 shrink-0"
              >
                <button
                  type="button"
                  onClick={() => {
                    const parsed = parseS3Uri(uri)
                    if (parsed) void navigateTo(parsed.bucket, parsed.prefix, false)
                  }}
                  className="hover:text-amber-300 transition"
                >
                  {uri}
                </button>
                <button
                  type="button"
                  onClick={() => void onRemoveRecentUri(uri)}
                  className="text-slate-500 hover:text-red-400 ml-0.5"
                  title="Quitar acceso rapido"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Barra de Breadcrumbs + Acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/40 px-5 py-2.5">
        {/* Migas de pan (Breadcrumbs) */}
        <div className="flex items-center gap-1 text-xs overflow-x-auto min-w-0">
          {currentBucket && (
            <button
              type="button"
              onClick={handleGoUpLevel}
              className="mr-1.5 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 transition shrink-0"
              title="Subir un nivel"
            >
              <CornerLeftUp className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void navigateTo(null)}
            className={`rounded-md px-2 py-1 font-medium transition shrink-0 ${
              !currentBucket
                ? 'bg-amber-500/15 text-amber-300'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Buckets
          </button>

          {currentBucket && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
              <button
                type="button"
                onClick={() => void navigateTo(currentBucket, '')}
                className={`rounded-md px-2 py-1 font-mono font-medium transition shrink-0 ${
                  breadcrumbSegments.length === 0
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {currentBucket}
              </button>
            </>
          )}

          {breadcrumbSegments.map((seg, idx) => {
            const isLast = idx === breadcrumbSegments.length - 1
            return (
              <React.Fragment key={seg.prefix}>
                <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                <button
                  type="button"
                  onClick={() => currentBucket && void navigateTo(currentBucket, seg.prefix)}
                  className={`rounded-md px-2 py-1 font-mono transition shrink-0 ${
                    isLast
                      ? 'bg-amber-500/15 text-amber-300 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {seg.label}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        {/* Botones de Accion + Filtro */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder={currentBucket ? 'Filtrar carpeta...' : 'Filtrar buckets...'}
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {currentBucket && (
            <>
              <button
                type="button"
                onClick={() => void handlePickUpload(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition"
              >
                <Upload className="h-3.5 w-3.5" />
                Subir Archivos
              </button>

              <button
                type="button"
                onClick={() => void handlePickUpload(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
              >
                <FolderUp className="h-3.5 w-3.5 text-amber-400" />
                Subir Carpeta
              </button>

              <button
                type="button"
                onClick={() => {
                  setNewFolderName('')
                  setShowNewFolderModal(true)
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
              >
                <FolderPlus className="h-3.5 w-3.5 text-sky-400" />
                Nueva Carpeta
              </button>
            </>
          )}

          <button
            type="button"
            disabled={isLoading}
            onClick={() =>
              currentBucket
                ? void loadObjects(currentBucket, currentPrefix)
                : void loadBuckets()
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition"
            title="Refrescar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mensaje de Error de Permisos IAM o Bucket */}
      {errorBanner && (
        <div className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Contenido Principal */}
      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="flex h-60 flex-col items-center justify-center text-slate-400 gap-2.5">
            <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
            <p className="text-xs">Consultando Amazon S3...</p>
          </div>
        ) : !currentBucket ? (
          /* VISTA DE LISTA DE BUCKETS */
          <div className="space-y-4">
            {listRestricted && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-semibold text-amber-200">
                      Listado general de buckets restringido por tu rol IAM
                    </h3>
                    <p className="text-xs text-amber-200/80 leading-relaxed">
                      {restrictionMessage ||
                        'En entornos corporativos es normal que tu token solo tenga acceso a un bucket especifico y no permita listar toda la cuenta (s3:ListAllMyBuckets).'}
                    </p>
                    <p className="text-xs text-white font-medium pt-1">
                      Escribe directamente tu ruta arriba (por ejemplo:{' '}
                      <code className="rounded bg-slate-950 px-1.5 py-0.5 text-amber-300">
                        s3://nombre-de-tu-bucket/carpeta/
                      </code>
                      ) y presiona &quot;Ir a Ruta&quot;.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!listRestricted && filteredBuckets.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center">
                <Database className="mx-auto h-10 w-10 text-slate-600 mb-3" />
                <p className="text-sm font-medium text-slate-300">
                  {buckets.length === 0
                    ? 'No se encontraron buckets en esta cuenta.'
                    : 'Ningun bucket coincide con tu filtro.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredBuckets.map((bucket) => (
                  <button
                    key={bucket.name}
                    type="button"
                    onClick={() => void navigateTo(bucket.name, '', true)}
                    className="group flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-left hover:border-amber-500/50 hover:bg-slate-900 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20">
                        <Database className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold text-white truncate">
                          {bucket.name}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Creado: {formatRelativeOrShortDate(bucket.creationDate)}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-amber-400 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* VISTA DE ARCHIVOS Y CARPETAS DENTRO DEL BUCKET */
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/70 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 pl-4 pr-3">Nombre</th>
                    <th className="py-3 px-3 w-28">Tamano</th>
                    <th className="py-3 px-3 w-44">Ultima Modificacion</th>
                    <th className="py-3 pl-3 pr-4 text-right w-52">Acciones Rapidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {/* Carpetas (Prefijos) */}
                  {filteredFolders.map((folder) => (
                    <tr
                      key={folder.prefix}
                      onDoubleClick={() => void navigateTo(currentBucket, folder.prefix)}
                      className="group hover:bg-slate-800/50 cursor-pointer transition"
                    >
                      <td
                        onClick={() => void navigateTo(currentBucket, folder.prefix)}
                        className="py-2.5 pl-4 pr-3"
                      >
                        <div className="flex items-center gap-2.5">
                          <Folder className="h-4 w-4 shrink-0 text-amber-400 fill-amber-400/20" />
                          <span className="font-medium text-slate-100 group-hover:text-amber-300">
                            {folder.name}/
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">-</td>
                      <td className="py-2.5 px-3 text-slate-500">Carpeta</td>
                      <td className="py-2.5 pl-3 pr-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget({
                              name: folder.name,
                              key: folder.prefix,
                              isFolder: true,
                              deleting: false
                            })
                          }}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-slate-400 hover:bg-red-500/15 hover:text-red-400 transition"
                          title="Borrar carpeta y su contenido"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Borrar
                        </button>
                      </td>
                    </tr>
                  ))}

                  {/* Archivos (Objetos) */}
                  {filteredObjects.map((obj) => (
                    <tr key={obj.key} className="group hover:bg-slate-800/40 transition">
                      <td className="py-2.5 pl-4 pr-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {renderFileTypeIcon(obj.name)}
                          <span
                            className="truncate text-slate-200 selectable-text"
                            title={obj.name}
                          >
                            {obj.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                        {formatBytes(obj.size)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {formatRelativeOrShortDate(obj.lastModified)}
                      </td>
                      <td className="py-2.5 pl-3 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void handleOpenPreview(obj)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-sky-300 transition"
                            title="Vista previa rapida"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDownload(obj)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-emerald-300 transition"
                            title="Descargar a mi PC"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleGeneratePresigned(obj, 3600)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-amber-300 transition"
                            title="Compartir enlace temporal (Presigned URL)"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTarget({
                                name: obj.name,
                                key: obj.key,
                                isFolder: false,
                                deleting: false
                              })
                            }
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/15 hover:text-red-400 transition"
                            title="Borrar archivo"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredFolders.length === 0 && filteredObjects.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-slate-400">
                        <Upload className="mx-auto h-8 w-8 text-slate-600 mb-2" />
                        <p className="text-sm font-medium text-slate-300">
                          {folders.length === 0 && objects.length === 0
                            ? 'Esta carpeta esta vacia'
                            : 'No hay resultados para tu filtro'}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Arrastra archivos o carpetas desde tu PC hacia esta ventana para subirlos.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginacion si hay mas de 1000 objetos */}
            {nextToken && (
              <div className="flex justify-center">
                <button
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => void loadObjects(currentBucket, currentPrefix, nextToken)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Cargar mas elementos...
                </button>
              </div>
            )}

            {/* Zona inferior recordatoria de Drag & Drop */}
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 py-3 px-4 text-center text-[11px] text-slate-500">
              Arrastra archivos o carpetas completas desde el Explorador de Windows aqui para
              subirlos con subida multiparte automatica.
            </div>
          </div>
        )}
      </div>

      {/* ==================== MODAL: NUEVA CARPETA ==================== */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateFolder}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Crear Nueva Carpeta en S3</h3>
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                Nombre de la carpeta dentro de{' '}
                <code className="text-amber-300">
                  s3://{currentBucket}/{currentPrefix}
                </code>
              </label>
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Ej. reportes-2026"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isCreatingFolder || !newFolderName.trim()}
                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {isCreatingFolder ? 'Creando...' : 'Crear Carpeta'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: VISTA PREVIA ==================== */}
      {previewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-6">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white truncate">
                  {previewTarget.object.name}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Tamano total: {formatBytes(previewTarget.object.size)}
                  {previewTarget.result?.truncated
                    ? ' (Mostrando los primeros 512 KB)'
                    : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {previewTarget.result?.kind === 'csv' && (
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewTarget((prev) =>
                        prev ? { ...prev, rawCsvMode: !prev.rawCsvMode } : null
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    {previewTarget.rawCsvMode ? 'Ver como Tabla' : 'Ver Texto Crudo'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleDownload(previewTarget.object)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Descargar
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewTarget(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-5 bg-slate-950">
              {previewTarget.loading ? (
                <div className="flex h-52 items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                  Cargando vista previa...
                </div>
              ) : previewTarget.result?.kind === 'image' && previewTarget.result.imageDataUrl ? (
                <div className="flex items-center justify-center">
                  <img
                    src={previewTarget.result.imageDataUrl}
                    alt={previewTarget.result.fileName}
                    className="max-h-[65vh] rounded-lg border border-slate-800 object-contain"
                  />
                </div>
              ) : previewTarget.result?.kind === 'csv' && !previewTarget.rawCsvMode ? (
                <CsvTableView raw={previewTarget.result.textContent || ''} />
              ) : previewTarget.result?.kind === 'json' ? (
                <pre className="font-mono text-xs text-emerald-300 whitespace-pre-wrap break-words selectable-text">
                  {formatPrettyJson(previewTarget.result.textContent || '')}
                </pre>
              ) : previewTarget.result?.kind === 'text' || previewTarget.rawCsvMode ? (
                <pre className="font-mono text-xs text-slate-200 whitespace-pre-wrap break-words selectable-text">
                  {previewTarget.result?.textContent || ''}
                </pre>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400">
                  {previewTarget.result?.message || 'Vista previa no disponible para este archivo.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: PRESIGNED URL ==================== */}
      {presignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">
                  Compartir Enlace Temporal (Presigned URL)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPresignTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Archivo: <strong className="text-slate-200">{presignTarget.object.name}</strong>
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Tiempo de validez del enlace
              </label>
              <select
                value={presignTarget.expiresInSeconds}
                onChange={(e) =>
                  void handleGeneratePresigned(presignTarget.object, Number(e.target.value))
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
              >
                {PRESIGN_OPTIONS.map((opt) => (
                  <option key={opt.seconds} value={opt.seconds}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {presignTarget.temporaryWarning && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[11px] text-amber-200">
                Nota: Como conectaste usando un token temporal (STS), el enlace dejara de funcionar
                cuando caduque tu token actual de AWS, incluso si elegiste una duracion mayor.
              </div>
            )}

            {presignTarget.loading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                Firmando URL...
              </div>
            ) : (
              presignTarget.generatedUrl && (
                <div className="space-y-2.5">
                  <textarea
                    readOnly
                    rows={3}
                    value={presignTarget.generatedUrl}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-[11px] text-slate-300 focus:outline-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" />
                      Copiado automaticamente al portapapeles
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!presignTarget.generatedUrl) return
                        await navigator.clipboard.writeText(presignTarget.generatedUrl)
                        onNotify('success', 'Enlace firmado copiado al portapapeles.')
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Volver a Copiar
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ==================== MODAL: CONFIRMAR BORRADO ==================== */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white">
              Confirmar eliminacion en Amazon S3
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Estas a punto de eliminar permanentemente{' '}
              {deleteTarget.isFolder ? 'la carpeta y todo su contenido:' : 'el archivo:'}{' '}
              <strong className="font-mono text-red-300">{deleteTarget.name}</strong>. Esta accion
              no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleteTarget.deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteTarget.deleting}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteTarget.deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Si, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function renderFileTypeIcon(fileName: string) {
  const lower = fileName.toLowerCase()
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/.test(lower)) {
    return <ImageIcon className="h-4 w-4 shrink-0 text-pink-400" />
  }
  if (/\.(json|yaml|yml|xml|toml)$/.test(lower)) {
    return <FileJson className="h-4 w-4 shrink-0 text-emerald-400" />
  }
  if (/\.(csv|tsv|xlsx|xls)$/.test(lower)) {
    return <FileSpreadsheet className="h-4 w-4 shrink-0 text-teal-400" />
  }
  if (/\.(zip|tar|gz|rar|7z)$/.test(lower)) {
    return <FileArchive className="h-4 w-4 shrink-0 text-purple-400" />
  }
  if (/\.(txt|md|log|sql|py|js|ts)$/.test(lower)) {
    return <FileText className="h-4 w-4 shrink-0 text-sky-400" />
  }
  return <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
}

const CsvTableView: React.FC<{ raw: string }> = ({ raw }) => {
  const rows = useMemo(() => parseCsvPreview(raw, 80), [raw])
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">Archivo CSV vacio.</p>
  }
  const header = rows[0]
  const body = rows.slice(1)

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="bg-slate-900 border-b border-slate-800 text-slate-300">
            {header.map((col, idx) => (
              <th key={idx} className="px-3 py-2 font-semibold whitespace-nowrap">
                {col || `Col ${idx + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {body.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-slate-900/50">
              {header.map((_, cIdx) => (
                <td
                  key={cIdx}
                  className="px-3 py-1.5 text-slate-300 font-mono whitespace-nowrap selectable-text"
                >
                  {row[cIdx] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

