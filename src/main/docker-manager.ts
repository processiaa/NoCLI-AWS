import Docker from 'dockerode'
import crypto from 'crypto'
import { spawn } from 'child_process'
import type {
  EcrAuthInfo,
  LocalDockerImage,
  LocalDockerStatus,
  PowerShellCommandBundle,
  TransferProgressEvent
} from '../shared/types'
import { translateAwsOrDockerError } from './error-translator'

interface DockerStreamEvent {
  id?: string
  status?: string
  progress?: string
  progressDetail?: {
    current?: number
    total?: number
  }
  error?: string
  errorDetail?: {
    message?: string
  }
}

class DockerManager {
  private createClient(): Docker {
    if (process.env.DOCKER_HOST) {
      return new Docker()
    }
    if (process.platform === 'win32') {
      return new Docker({ socketPath: '//./pipe/docker_engine' })
    }
    return new Docker({ socketPath: '/var/run/docker.sock' })
  }

  async getStatus(): Promise<LocalDockerStatus> {
    const docker = this.createClient()
    try {
      const versionInfo = await withTimeout(docker.version(), 2500)
      return {
        connected: true,
        version: versionInfo.Version,
        apiVersion: versionInfo.ApiVersion,
        os: versionInfo.Os,
        arch: versionInfo.Arch
      }
    } catch (error) {
      const translated = translateAwsOrDockerError(error)
      return {
        connected: false,
        error: translated.message
      }
    }
  }

  async authenticateLocalDocker(
    authInfo: EcrAuthInfo
  ): Promise<{ engineVerified: boolean; cliConfigSaved: boolean; registryHost: string }> {
    const docker = this.createClient()
    let engineVerified = false
    let cliConfigSaved = false

    // 1. Verificar autenticacion directa contra el motor Docker (Named Pipe / Socket)
    await docker.checkAuth({
      username: authInfo.username,
      password: authInfo.password,
      serveraddress: authInfo.proxyEndpoint
    })
    engineVerified = true

    // 2. Guardar sesion tambien en ~/.docker/config.json ejecutando docker login silencioso
    try {
      cliConfigSaved = await runHiddenDockerLogin(
        authInfo.username,
        authInfo.password,
        authInfo.registryHost
      )
    } catch {
      cliConfigSaved = false
    }

    return {
      engineVerified,
      cliConfigSaved,
      registryHost: authInfo.registryHost
    }
  }

  async listLocalImages(): Promise<LocalDockerImage[]> {
    const docker = this.createClient()
    const rawImages = await withTimeout(docker.listImages({ all: false }), 5000)

    const mapped: LocalDockerImage[] = rawImages.map((img) => {
      const cleanId = (img.Id || '').replace(/^sha256:/, '')
      const validTags = (img.RepoTags || []).filter((t) => t && t !== '<none>:<none>')
      const primaryTag = validTags[0] || `<sin-etiqueta>:${cleanId.slice(0, 12)}`

      return {
        id: img.Id,
        shortId: cleanId.slice(0, 12),
        repoTags: validTags,
        primaryTag,
        sizeInBytes: img.Size ?? 0,
        created: img.Created ? new Date(img.Created * 1000).toISOString() : undefined
      }
    })

    return mapped.sort((a, b) => {
      const aHasTag = a.repoTags.length > 0 ? 1 : 0
      const bHasTag = b.repoTags.length > 0 ? 1 : 0
      if (aHasTag !== bHasTag) return bHasTag - aHasTag
      const timeA = a.created ? new Date(a.created).getTime() : 0
      const timeB = b.created ? new Date(b.created).getTime() : 0
      return timeB - timeA
    })
  }

  async pullImageFromEcr(
    imageUri: string,
    authInfo: EcrAuthInfo,
    onProgress: (event: TransferProgressEvent) => void
  ): Promise<{ imageUri: string }> {
    const docker = this.createClient()
    const transferId = crypto.randomUUID()
    const shortLabel = imageUri.split('/').slice(-1)[0] || imageUri

    const emit = (
      status: TransferProgressEvent['status'],
      percentage: number,
      loadedBytes?: number,
      totalBytes?: number,
      detail?: string,
      error?: string
    ) => {
      onProgress({
        id: transferId,
        category: 'docker-pull',
        title: `Descargando imagen '${shortLabel}' a tu Docker local`,
        detail,
        loadedBytes,
        totalBytes,
        percentage,
        status,
        error
      })
    }

    emit('running', 2, 0, 0, 'Autenticando y solicitando capas desde Amazon ECR...')

    try {
      const stream = await docker.pull(imageUri, {
        authconfig: {
          username: authInfo.username,
          password: authInfo.password,
          serveraddress: authInfo.proxyEndpoint
        }
      })

      await this.followDockerStream(docker, stream, (pct, loaded, total, detail) => {
        emit('running', pct, loaded, total, detail)
      })

      emit('completed', 100, undefined, undefined, `Imagen '${shortLabel}' lista en tu PC`)
      return { imageUri }
    } catch (error) {
      const translated = translateAwsOrDockerError(error)
      emit('error', 0, undefined, undefined, undefined, translated.message)
      throw error
    }
  }

  async tagAndPushToEcr(
    localImageRef: string,
    targetRepositoryUri: string,
    targetTag: string,
    authInfo: EcrAuthInfo,
    onProgress: (event: TransferProgressEvent) => void
  ): Promise<{ pushedUri: string }> {
    const docker = this.createClient()
    const cleanRepoUri = targetRepositoryUri.trim().replace(/:+$/, '')
    const cleanTag = (targetTag || 'latest').trim()
    const fullTargetUri = `${cleanRepoUri}:${cleanTag}`
    const shortRepo = cleanRepoUri.split('/').slice(-1)[0] || cleanRepoUri
    const transferId = crypto.randomUUID()

    const emit = (
      status: TransferProgressEvent['status'],
      percentage: number,
      loadedBytes?: number,
      totalBytes?: number,
      detail?: string,
      error?: string
    ) => {
      onProgress({
        id: transferId,
        category: 'docker-push',
        title: `Subiendo '${shortRepo}:${cleanTag}' hacia Amazon ECR`,
        detail,
        loadedBytes,
        totalBytes,
        percentage,
        status,
        error
      })
    }

    emit('running', 3, 0, 0, `Etiquetando imagen local como ${fullTargetUri}...`)

    try {
      const sourceImage = docker.getImage(localImageRef)
      await sourceImage.tag({
        repo: cleanRepoUri,
        tag: cleanTag
      })

      emit('running', 8, 0, 0, 'Iniciando envio de capas a Amazon ECR...')

      const targetImage = docker.getImage(fullTargetUri)
      const stream = await targetImage.push({
        authconfig: {
          username: authInfo.username,
          password: authInfo.password,
          serveraddress: authInfo.proxyEndpoint
        }
      })

      await this.followDockerStream(docker, stream, (pct, loaded, total, detail) => {
        const scaledPct = Math.max(8, pct)
        emit('running', scaledPct, loaded, total, detail)
      })

      emit('completed', 100, undefined, undefined, `Imagen disponible en ${fullTargetUri}`)
      return { pushedUri: fullTargetUri }
    } catch (error) {
      const translated = translateAwsOrDockerError(error)
      emit('error', 0, undefined, undefined, undefined, translated.message)
      throw error
    }
  }

  buildPowerShellCommands(params: {
    authInfo: EcrAuthInfo
    region: string
    mode: 'login' | 'pull' | 'push'
    ecrImageUri?: string
    localImageTag?: string
    targetRepositoryUri?: string
    targetTag?: string
  }): PowerShellCommandBundle {
    const { authInfo, region, mode } = params
    const escapedPassword = authInfo.password.replace(/'/g, "''")

    const directLines: string[] = [
      '# Comando directo generado por NoCLI-AWS (No requiere tener AWS CLI instalado)',
      `'${escapedPassword}' | docker login --username ${authInfo.username} --password-stdin ${authInfo.registryHost}`
    ]

    const cliLines: string[] = [
      '# Comando estandar (Requiere AWS CLI y variables de entorno configuradas en PowerShell)',
      `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${authInfo.registryHost}`
    ]

    if (mode === 'pull' && params.ecrImageUri) {
      directLines.push(`docker pull ${params.ecrImageUri}`)
      cliLines.push(`docker pull ${params.ecrImageUri}`)
    } else if (mode === 'push' && params.targetRepositoryUri) {
      const tag = (params.targetTag || 'latest').trim()
      const localRef = (params.localImageTag || 'mi-imagen:latest').trim()
      const remoteRef = `${params.targetRepositoryUri}:${tag}`
      directLines.push(`docker tag ${localRef} ${remoteRef}`)
      directLines.push(`docker push ${remoteRef}`)
      cliLines.push(`docker tag ${localRef} ${remoteRef}`)
      cliLines.push(`docker push ${remoteRef}`)
    }

    return {
      registryHost: authInfo.registryHost,
      directNoCliScript: directLines.join('\n'),
      standardAwsCliScript: cliLines.join('\n'),
      expiresAt: authInfo.expiresAt
    }
  }

  private followDockerStream(
    docker: Docker,
    stream: NodeJS.ReadableStream,
    onUpdate: (percentage: number, loaded: number, total: number, detail: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const layerProgress = new Map<string, { current: number; total: number }>()
      let streamErrorMessage: string | null = null
      let lastEmit = 0

      docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            reject(err)
            return
          }
          if (streamErrorMessage) {
            reject(new Error(streamErrorMessage))
            return
          }
          resolve()
        },
        (event: DockerStreamEvent) => {
          if (event.error || event.errorDetail?.message) {
            streamErrorMessage = event.errorDetail?.message || event.error || 'Error en Docker'
            return
          }

          if (event.id && event.progressDetail?.total && event.progressDetail.total > 0) {
            layerProgress.set(event.id, {
              current: event.progressDetail.current ?? 0,
              total: event.progressDetail.total
            })
          }

          const now = Date.now()
          if (now - lastEmit < 80) return
          lastEmit = now

          let loaded = 0
          let total = 0
          for (const layer of layerProgress.values()) {
            loaded += Math.min(layer.current, layer.total)
            total += layer.total
          }

          const pct =
            total > 0 ? Math.min(99, Math.max(5, Math.round((loaded / total) * 100))) : 15
          const statusText = [event.id ? `[${event.id}]` : '', event.status || '']
            .filter(Boolean)
            .join(' ')

          onUpdate(pct, loaded, total, statusText || 'Procesando capas de imagen...')
        }
      )
    })
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('Tiempo de espera agotado al conectar con Docker Desktop local.')
      err.name = 'DockerNotRunning'
      reject(err)
    }, timeoutMs)

    promise
      .then((res) => {
        clearTimeout(timer)
        resolve(res)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

function runHiddenDockerLogin(
  username: string,
  password: string,
  registryHost: string
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(
        'docker',
        ['login', '--username', username, '--password-stdin', registryHost],
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )

      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // ignore
        }
        resolve(false)
      }, 8000)

      child.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })

      child.stdin.write(password)
      child.stdin.end()
    } catch {
      resolve(false)
    }
  })
}

export const dockerManager = new DockerManager()

