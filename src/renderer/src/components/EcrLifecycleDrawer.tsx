import React, { useEffect, useState } from 'react'
import {
  Clock,
  ShieldAlert,
  Play,
  FileJson,
  ListChecks,
  X,
  Loader2,
  Copy,
  Check,
  Save,
  Sparkles,
  Archive,
  Trash2,
  Info
} from 'lucide-react'
import type {
  EcrLifecyclePolicyResult,
  EcrLifecyclePreviewItem,
  EcrLifecyclePreviewResult,
  EcrLifecycleRuleParsed
} from '@shared/types'
import { formatPrettyJson, formatRelativeOrShortDate } from '../utils/formatters'

interface EcrLifecycleDrawerProps {
  open: boolean
  repositoryName: string
  policyResult: EcrLifecyclePolicyResult | null
  policyError: string | null
  loadingPolicy: boolean
  previewResult: EcrLifecyclePreviewResult | null
  loadingPreview: boolean
  onClose: () => void
  onRefreshPolicy: () => Promise<void>
  onRunPreview: () => Promise<void>
  onSavePolicy: (jsonText: string) => Promise<boolean>
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void
}

const LIFECYCLE_TEMPLATES: Array<{ label: string; description: string; json: object }> = [
  {
    label: 'Borrar sin tag (7 dias)',
    description: 'Elimina imagenes huerfanas (<untagged>) con mas de 7 dias desde su subida.',
    json: {
      rules: [
        {
          rulePriority: 1,
          description: 'Eliminar imagenes sin etiqueta despues de 7 dias',
          selection: {
            tagStatus: 'untagged',
            countType: 'sinceImagePushed',
            countUnit: 'days',
            countNumber: 7
          },
          action: {
            type: 'expire'
          }
        }
      ]
    }
  },
  {
    label: 'Conservar ultimas 15',
    description: 'Mantiene unicamente las 15 imagenes mas recientes del repositorio.',
    json: {
      rules: [
        {
          rulePriority: 1,
          description: 'Conservar solo las 15 imagenes mas recientes',
          selection: {
            tagStatus: 'any',
            countType: 'imageCountMoreThan',
            countNumber: 15
          },
          action: {
            type: 'expire'
          }
        }
      ]
    }
  },
  {
    label: 'Combinada recomendada',
    description: 'Borra imagenes sin tag a los 7 dias y conserva las ultimas 20 imagenes en total.',
    json: {
      rules: [
        {
          rulePriority: 1,
          description: 'Limpiar imagenes sin tag mayores a 7 dias',
          selection: {
            tagStatus: 'untagged',
            countType: 'sinceImagePushed',
            countUnit: 'days',
            countNumber: 7
          },
          action: {
            type: 'expire'
          }
        },
        {
          rulePriority: 2,
          description: 'Retener maximo 20 imagenes en el repositorio',
          selection: {
            tagStatus: 'any',
            countType: 'imageCountMoreThan',
            countNumber: 20
          },
          action: {
            type: 'expire'
          }
        }
      ]
    }
  }
]

export const EcrLifecycleDrawer: React.FC<EcrLifecycleDrawerProps> = ({
  open,
  repositoryName,
  policyResult,
  policyError,
  loadingPolicy,
  previewResult,
  loadingPreview,
  onClose,
  onRefreshPolicy,
  onRunPreview,
  onSavePolicy,
  onNotify
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'preview' | 'json'>('rules')
  const [jsonEditorText, setJsonEditorText] = useState('')
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)

  useEffect(() => {
    if (policyResult?.lifecyclePolicyText) {
      setJsonEditorText(formatPrettyJson(policyResult.lifecyclePolicyText))
    } else {
      setJsonEditorText('')
    }
  }, [policyResult])

  const handleCopyJson = async () => {
    if (!jsonEditorText.trim()) return
    await navigator.clipboard.writeText(jsonEditorText)
    setCopiedJson(true)
    setTimeout(() => setCopiedJson(false), 2000)
    onNotify('success', 'JSON de Lifecycle copiado al portapapeles.')
  }

  const handleSave = async () => {
    if (!jsonEditorText.trim()) return
    setSavingPolicy(true)
    try {
      const ok = await onSavePolicy(jsonEditorText)
      if (ok) {
        setActiveTab('rules')
      }
    } finally {
      setSavingPolicy(false)
    }
  }

  return (
    <>
      {/* Fondo semitransparente al deslizar */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Panel lateral derecho deslizable */}
      <aside
        className={`fixed right-0 top-14 bottom-8 z-50 flex w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Cabecera del Drawer */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">
                Lifecycle de Imagenes ECR
              </h3>
              <p className="font-mono text-[11px] text-amber-300 truncate">
                {repositoryName || 'Sin repositorio seleccionado'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title="Cerrar panel de Lifecycle"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Pestanas del Inspector de Lifecycle */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-5 py-2.5">
          <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'rules'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ListChecks className="h-3.5 w-3.5" />
              Reglas ({policyResult?.rules.length ?? 0})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'preview'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Play className="h-3.5 w-3.5" />
              Impacto en Imagenes
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('json')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'json'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileJson className="h-3.5 w-3.5" />
              JSON y Plantillas
            </button>
          </div>

          <button
            type="button"
            disabled={loadingPolicy}
            onClick={() => void onRefreshPolicy()}
            className="text-xs text-slate-400 hover:text-white transition"
          >
            {loadingPolicy ? 'Consultando...' : 'Actualizar'}
          </button>
        </div>

        {/* Contenido Principal del Drawer */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {policyError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-200">
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{policyError}</span>
            </div>
          )}

          {loadingPolicy ? (
            <div className="flex h-48 items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
              Cargando politica de ciclo de vida desde Amazon ECR...
            </div>
          ) : activeTab === 'rules' ? (
            /* ==================== TAB 1: REGLAS VISUALES ==================== */
            <div className="space-y-4">
              {policyResult?.hasPolicy ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs">
                    <span className="font-medium text-emerald-300">
                      Politica activa con {policyResult.rules.length} regla(s) configurada(s)
                    </span>
                    {policyResult.lastEvaluatedAt && (
                      <span className="text-emerald-200/80">
                        Ultima evaluacion AWS:{' '}
                        {formatRelativeOrShortDate(policyResult.lastEvaluatedAt)}
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {policyResult.rules.map((rule) => (
                      <RuleCard key={rule.rulePriority} rule={rule} />
                    ))}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('preview')
                        void onRunPreview()
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Simular Que Imagenes Expiraran
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-8 text-center space-y-3">
                  <Clock className="mx-auto h-10 w-10 text-slate-600" />
                  <h4 className="text-sm font-semibold text-white">
                    Este repositorio no tiene politica de Lifecycle
                  </h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    Todas las imagenes subidas a <strong>{repositoryName}</strong> se conservaran de
                    forma indefinida hasta que se borren manualmente o se configure una regla de
                    retencion.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('json')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Usar una Plantilla de Retencion
                  </button>
                </div>
              )}
            </div>
          ) : activeTab === 'preview' ? (
            /* ==================== TAB 2: SIMULACION DE IMPACTO (PREVIEW) ==================== */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-white">
                    Simulacion Oficial de AWS (Dry-Run)
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Evalua que imagenes actuales serian eliminadas o archivadas sin borrar nada.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={loadingPreview || !policyResult?.hasPolicy}
                  onClick={() => void onRunPreview()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
                >
                  {loadingPreview ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Evaluando...
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      Ejecutar Simulacion
                    </>
                  )}
                </button>
              </div>

              {!policyResult?.hasPolicy ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-400">
                  Configura primero una politica de Lifecycle para simular su impacto sobre las
                  imagenes del repositorio.
                </div>
              ) : loadingPreview ? (
                <div className="flex h-44 items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                  AWS ECR esta calculando las imagenes afectadas...
                </div>
              ) : !previewResult ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-8 text-center text-xs text-slate-400">
                  Haz clic en <strong>Ejecutar Simulacion</strong> arriba para ver que imagenes del
                  repositorio cumplen las condiciones de expiracion o archivado.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Resumen numerico */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                      <p className="text-[11px] text-slate-400">Imagenes por Expirar (Borrar)</p>
                      <p className="mt-1 font-mono text-lg font-bold text-red-400">
                        {previewResult.expiringImageTotalCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                      <p className="text-[11px] text-slate-400">Imagenes por Archivar</p>
                      <p className="mt-1 font-mono text-lg font-bold text-sky-400">
                        {previewResult.archiveImageTotalCount}
                      </p>
                    </div>
                  </div>

                  {previewResult.status === 'IN_PROGRESS' && (
                    <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
                      <span>AWS sigue procesando la evaluacion en segundo plano...</span>
                      <button
                        type="button"
                        onClick={() => void onRunPreview()}
                        className="font-semibold text-amber-300 underline"
                      >
                        Consultar resultado
                      </button>
                    </div>
                  )}

                  {previewResult.items.length === 0 && previewResult.status === 'COMPLETE' ? (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-xs text-emerald-200">
                      Ninguna imagen actual del repositorio sera eliminada ni archivada con las
                      reglas vigentes.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {previewResult.items.map((item: EcrLifecyclePreviewItem) => (
                        <div
                          key={item.imageDigest}
                          className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {item.imageTags.length > 0 ? (
                                item.imageTags.map((t) => (
                                  <span
                                    key={t}
                                    className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-amber-300"
                                  >
                                    {t}
                                  </span>
                                ))
                              ) : (
                                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">
                                  &lt;sin-tag&gt;
                                </span>
                              )}
                            </div>

                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                                item.actionType.toUpperCase() === 'EXPIRE'
                                  ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                                  : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                              }`}
                            >
                              {item.actionType.toUpperCase() === 'EXPIRE'
                                ? 'Expirar'
                                : 'Archivar'}{' '}
                              (Regla #{item.appliedRulePriority})
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span className="font-mono">
                              {item.imageDigest.replace('sha256:', '').slice(0, 16)}...
                            </span>
                            <span>
                              Subida: {formatRelativeOrShortDate(item.imagePushedAt)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ==================== TAB 3: JSON Y PLANTILLAS ==================== */
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-300">
                  Plantillas rapidas de retencion (1 clic para cargar en el editor):
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {LIFECYCLE_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => setJsonEditorText(JSON.stringify(tpl.json, null, 2))}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-left hover:border-amber-500/50 transition"
                    >
                      <p className="text-xs font-semibold text-amber-300">{tpl.label}</p>
                      <p className="mt-1 text-[11px] text-slate-400 leading-snug">
                        {tpl.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">
                    Definicion JSON de la Politica
                  </label>
                  <button
                    type="button"
                    disabled={!jsonEditorText.trim()}
                    onClick={() => void handleCopyJson()}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white disabled:opacity-40"
                  >
                    {copiedJson ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copiar JSON
                      </>
                    )}
                  </button>
                </div>

                <textarea
                  rows={12}
                  value={jsonEditorText}
                  onChange={(e) => setJsonEditorText(e.target.value)}
                  placeholder='Selecciona una plantilla arriba o pega una politica JSON de Amazon ECR...'
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3.5 font-mono text-xs text-emerald-300 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Info className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                  Requiere permiso IAM ecr:PutLifecyclePolicy en tu token
                </span>

                <button
                  type="button"
                  disabled={savingPolicy || !jsonEditorText.trim()}
                  onClick={() => void handleSave()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
                >
                  {savingPolicy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      Aplicar Politica en ECR
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

const RuleCard: React.FC<{ rule: EcrLifecycleRuleParsed }> = ({ rule }) => {
  const isExpire = rule.actionType.toLowerCase() === 'expire'

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs font-semibold text-white">
          Prioridad #{rule.rulePriority}
        </span>

        <span
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
            isExpire
              ? 'border-red-500/30 bg-red-500/15 text-red-300'
              : 'border-sky-500/30 bg-sky-500/15 text-sky-300'
          }`}
        >
          {isExpire ? (
            <>
              <Trash2 className="h-3.5 w-3.5" />
              Accion: Expirar (Eliminar)
            </>
          ) : (
            <>
              <Archive className="h-3.5 w-3.5" />
              Accion: Mover a {rule.targetStorageClass || 'Archive'}
            </>
          )}
        </span>
      </div>

      {rule.description && (
        <p className="text-xs font-medium text-slate-200">{rule.description}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 pt-1 text-xs">
        <div className="rounded-lg border border-slate-800/90 bg-slate-900/70 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Seleccion de Imagenes
          </p>
          <p className="mt-0.5 text-slate-200">{describeTagSelection(rule)}</p>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-slate-900/70 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Condicion de Disparo
          </p>
          <p className="mt-0.5 text-amber-300 font-medium">{describeCountCondition(rule)}</p>
        </div>
      </div>
    </div>
  )
}

function describeTagSelection(rule: EcrLifecycleRuleParsed): string {
  const status = rule.tagStatus.toLowerCase()
  if (status === 'untagged') {
    return 'Solo imagenes sin etiqueta (<untagged>)'
  }
  if (status === 'tagged') {
    if (rule.tagPrefixList && rule.tagPrefixList.length > 0) {
      return `Con tags que inicien por: ${rule.tagPrefixList.join(', ')}`
    }
    if (rule.tagPatternList && rule.tagPatternList.length > 0) {
      return `Con tags que coincidan con: ${rule.tagPatternList.join(', ')}`
    }
    return 'Imagenes etiquetadas'
  }
  return 'Cualquier imagen (con o sin etiqueta)'
}

function describeCountCondition(rule: EcrLifecycleRuleParsed): string {
  const unit = rule.countUnit === 'days' || !rule.countUnit ? 'dias' : rule.countUnit
  switch (rule.countType) {
    case 'sinceImagePushed':
      return `Mas de ${rule.countNumber} ${unit} desde su fecha de subida`
    case 'imageCountMoreThan':
      return `Cuando superen las ${rule.countNumber} imagenes (conserva las ${rule.countNumber} mas nuevas)`
    case 'sinceImagePulled':
      return `Mas de ${rule.countNumber} ${unit} sin haber sido descargada (pull)`
    case 'sinceImageTransitioned':
      return `Mas de ${rule.countNumber} ${unit} en almacenamiento Archive`
    default:
      return `${rule.countType}: ${rule.countNumber}`
  }
}

