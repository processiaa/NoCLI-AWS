import React, { useState } from 'react'
import {
  ArrowUpCircle,
  ArrowDownCircle,
  CheckCircle2,
  XCircle,
  ChevronUp,
  ChevronDown,
  X,
  Trash2
} from 'lucide-react'
import type { TransferProgressEvent } from '@shared/types'
import { formatBytes } from '../utils/formatters'

interface TransferStatusBarProps {
  transfers: TransferProgressEvent[]
  onCancelTransfer: (id: string) => void
  onClearFinished: () => void
}

export const TransferStatusBar: React.FC<TransferStatusBarProps> = ({
  transfers,
  onCancelTransfer,
  onClearFinished
}) => {
  const [expanded, setExpanded] = useState(false)

  if (transfers.length === 0) {
    return (
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-slate-800 bg-slate-950 px-4 text-[11px] text-slate-500">
        <span>Barra de estado: Sin transferencias en curso</span>
        <span>AWS SDK v3 Nativo (Sin dependencia de AWS CLI)</span>
      </footer>
    )
  }

  const runningTransfers = transfers.filter((t) => t.status === 'running')
  const primary = runningTransfers[0] || transfers[0]
  const hasFinished = transfers.some((t) => t.status !== 'running')

  return (
    <footer className="shrink-0 border-t border-slate-800 bg-slate-900/95">
      {/* Panel expandido con historial de tareas */}
      {expanded && (
        <div className="max-h-52 overflow-y-auto border-b border-slate-800 bg-slate-950/90 px-4 py-2.5 space-y-2">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold text-slate-300">
              Cola de Transferencias S3 y Docker ({transfers.length})
            </span>
            {hasFinished && (
              <button
                type="button"
                onClick={onClearFinished}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
              >
                <Trash2 className="h-3 w-3" />
                Limpiar completadas
              </button>
            )}
          </div>

          {transfers.map((item) => {
            const isUpload = item.category === 's3-upload' || item.category === 'docker-push'
            const canCancel =
              item.status === 'running' &&
              (item.category === 's3-upload' || item.category === 's3-download')

            return (
              <div
                key={item.id}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {item.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : item.status === 'error' || item.status === 'cancelled' ? (
                      <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                    ) : isUpload ? (
                      <ArrowUpCircle className="h-4 w-4 shrink-0 text-amber-400 animate-pulse" />
                    ) : (
                      <ArrowDownCircle className="h-4 w-4 shrink-0 text-sky-400 animate-pulse" />
                    )}
                    <span className="font-medium text-slate-200 truncate">{item.title}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.totalBytes && item.totalBytes > 0 ? (
                      <span className="font-mono text-[11px] text-slate-400">
                        {formatBytes(item.loadedBytes || 0)} / {formatBytes(item.totalBytes)}
                      </span>
                    ) : null}
                    <span className="font-mono text-[11px] font-semibold text-slate-200">
                      {item.percentage}%
                    </span>
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => onCancelTransfer(item.id)}
                        className="rounded p-0.5 text-slate-400 hover:bg-red-500/20 hover:text-red-300"
                        title="Cancelar transferencia"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {item.status === 'running' && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-amber-500 transition-all duration-150"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                )}

                {(item.detail || item.error) && (
                  <p
                    className={`mt-1 truncate text-[11px] ${
                      item.error ? 'text-red-400' : 'text-slate-400'
                    }`}
                  >
                    {item.error || item.detail}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Barra compacta inferior */}
      <div className="flex h-10 items-center justify-between gap-4 px-4 text-xs">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {primary.status === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : primary.status === 'error' ? (
            <XCircle className="h-4 w-4 shrink-0 text-red-400" />
          ) : (
            <ArrowUpCircle className="h-4 w-4 shrink-0 text-amber-400 animate-pulse" />
          )}

          <span className="truncate text-slate-200 font-medium">{primary.title}</span>

          {primary.status === 'running' && (
            <div className="hidden sm:flex items-center gap-2.5 w-52 shrink-0">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-amber-500 transition-all duration-150"
                  style={{ width: `${primary.percentage}%` }}
                />
              </div>
              <span className="font-mono text-[11px] text-amber-300 w-9 text-right">
                {primary.percentage}%
              </span>
            </div>
          )}

          {primary.error && (
            <span className="truncate text-[11px] text-red-400">{primary.error}</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-700 transition shrink-0"
        >
          {runningTransfers.length > 0
            ? `${runningTransfers.length} activa(s)`
            : `${transfers.length} reciente(s)`}
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>
    </footer>
  )
}

