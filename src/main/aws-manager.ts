import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  ECRClient,
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
  DescribeImagesCommand,
  GetAuthorizationTokenCommand,
  GetLifecyclePolicyCommand,
  PutLifecyclePolicyCommand,
  StartLifecyclePolicyPreviewCommand,
  GetLifecyclePolicyPreviewCommand
} from '@aws-sdk/client-ecr'
import type {
  AwsCredentialsInput,
  AwsIdentity,
  EcrAuthInfo,
  EcrImageItem,
  EcrLifecyclePolicyResult,
  EcrLifecyclePreviewItem,
  EcrLifecyclePreviewResult,
  EcrLifecycleRuleParsed,
  EcrRepositoryItem,
  S3BucketItem,
  S3FolderItem,
  S3ListBucketsResult,
  S3ListObjectsResult,
  S3ObjectItem,
  S3PreviewResult,
  TransferProgressEvent
} from '../shared/types'
import { translateAwsOrDockerError } from './error-translator'

interface UploadFileEntry {
  localFilePath: string
  s3Key: string
  size: number
}

interface ActiveTransferControl {
  abort: () => void
}

const IMAGE_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
}

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.json',
  '.csv',
  '.tsv',
  '.log',
  '.md',
  '.yaml',
  '.yml',
  '.xml',
  '.ini',
  '.conf',
  '.cfg',
  '.env',
  '.sql',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '.html',
  '.css',
  '.toml',
  '.properties'
])

class AwsManager {
  private s3Client: S3Client | null = null
  private ecrClient: ECRClient | null = null
  private currentCredentials: AwsCredentialsInput | null = null
  private currentIdentity: AwsIdentity | null = null
  private activeTransfers = new Map<string, ActiveTransferControl>()

  private buildClientConfig(creds: AwsCredentialsInput) {
    return {
      region: creds.region || 'us-east-1',
      credentials: {
        accessKeyId: creds.accessKeyId.trim(),
        secretAccessKey: creds.secretAccessKey.trim(),
        sessionToken: creds.sessionToken?.trim() || undefined
      }
    }
  }

  async connectAndValidate(creds: AwsCredentialsInput): Promise<AwsIdentity> {
    const normalizedCreds: AwsCredentialsInput = {
      accessKeyId: creds.accessKeyId.trim(),
      secretAccessKey: creds.secretAccessKey.trim(),
      sessionToken: creds.sessionToken?.trim() || undefined,
      region: (creds.region || 'us-east-1').trim(),
      expiration: creds.expiration
    }

    const clientConfig = this.buildClientConfig(normalizedCreds)
    const sts = new STSClient(clientConfig)
    const identityResp = await sts.send(new GetCallerIdentityCommand({}))

    const arn = identityResp.Arn || 'arn:aws:iam::desconocido'
    const accountId = identityResp.Account || 'Desconocido'
    const userId = identityResp.UserId || 'Desconocido'

    this.s3Client = new S3Client({
      ...clientConfig,
      followRegionRedirects: true
    })
    this.ecrClient = new ECRClient(clientConfig)
    this.currentCredentials = normalizedCreds

    const identity: AwsIdentity = {
      accountId,
      arn,
      userId,
      region: normalizedCreds.region,
      shortPrincipal: extractShortPrincipal(arn),
      isTemporaryToken:
        Boolean(normalizedCreds.sessionToken) || normalizedCreds.accessKeyId.startsWith('ASIA'),
      expiration: normalizedCreds.expiration
    }

    this.currentIdentity = identity
    return identity
  }

  changeRegion(newRegion: string): AwsIdentity {
    if (!this.currentCredentials || !this.currentIdentity) {
      throw new Error('No hay una sesion de AWS activa.')
    }

    const updatedCreds: AwsCredentialsInput = {
      ...this.currentCredentials,
      region: newRegion.trim()
    }
    const clientConfig = this.buildClientConfig(updatedCreds)

    this.s3Client = new S3Client({
      ...clientConfig,
      followRegionRedirects: true
    })
    this.ecrClient = new ECRClient(clientConfig)
    this.currentCredentials = updatedCreds
    this.currentIdentity = {
      ...this.currentIdentity,
      region: updatedCreds.region
    }

    return this.currentIdentity
  }

  disconnect(): void {
    for (const ctrl of this.activeTransfers.values()) {
      try {
        ctrl.abort()
      } catch {
        // ignore
      }
    }
    this.activeTransfers.clear()
    this.s3Client?.destroy()
    this.ecrClient?.destroy()
    this.s3Client = null
    this.ecrClient = null
    this.currentCredentials = null
    this.currentIdentity = null
  }

  getSessionIdentity(): AwsIdentity | null {
    return this.currentIdentity
  }

  getCurrentCredentials(): AwsCredentialsInput | null {
    return this.currentCredentials
  }

  cancelTransfer(transferId: string): boolean {
    const ctrl = this.activeTransfers.get(transferId)
    if (!ctrl) return false
    ctrl.abort()
    this.activeTransfers.delete(transferId)
    return true
  }

  private requireS3(): S3Client {
    if (!this.s3Client) {
      throw new Error('No hay una sesion de AWS activa. Conecta tus credenciales primero.')
    }
    return this.s3Client
  }

  private requireECR(): ECRClient {
    if (!this.ecrClient) {
      throw new Error('No hay una sesion de AWS activa. Conecta tus credenciales primero.')
    }
    return this.ecrClient
  }

  // ==================== AMAZON S3 ====================

  async listBuckets(): Promise<S3ListBucketsResult> {
    const s3 = this.requireS3()
    try {
      const resp = await s3.send(new ListBucketsCommand({}))
      const buckets: S3BucketItem[] = (resp.Buckets || [])
        .filter((b) => Boolean(b.Name))
        .map((b) => ({
          name: b.Name!,
          creationDate: b.CreationDate ? b.CreationDate.toISOString() : undefined
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      return {
        buckets,
        listRestricted: false
      }
    } catch (error) {
      const translated = translateAwsOrDockerError(error, 's3:ListAllMyBuckets')
      if (translated.isAccessDenied) {
        return {
          buckets: [],
          listRestricted: true,
          restrictionMessage: translated.message
        }
      }
      throw error
    }
  }

  async listObjects(
    bucket: string,
    prefix = '',
    continuationToken?: string
  ): Promise<S3ListObjectsResult> {
    const s3 = this.requireS3()
    const normalizedPrefix = normalizePrefix(prefix)

    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket.trim(),
        Prefix: normalizedPrefix || undefined,
        Delimiter: '/',
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      })
    )

    const folders: S3FolderItem[] = (resp.CommonPrefixes || [])
      .filter((cp) => Boolean(cp.Prefix))
      .map((cp) => {
        const fullPrefix = cp.Prefix!
        const relative = fullPrefix.slice(normalizedPrefix.length).replace(/\/$/, '')
        return {
          name: relative || fullPrefix,
          prefix: fullPrefix
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const objects: S3ObjectItem[] = (resp.Contents || [])
      .filter((item) => Boolean(item.Key) && item.Key !== normalizedPrefix)
      .map((item) => {
        const key = item.Key!
        const name = key.slice(normalizedPrefix.length)
        return {
          key,
          name: name || key,
          size: item.Size ?? 0,
          lastModified: item.LastModified ? item.LastModified.toISOString() : undefined,
          storageClass: item.StorageClass
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      bucket: bucket.trim(),
      prefix: normalizedPrefix,
      folders,
      objects,
      isTruncated: Boolean(resp.IsTruncated),
      nextContinuationToken: resp.NextContinuationToken
    }
  }

  async createFolder(bucket: string, currentPrefix: string, folderName: string): Promise<string> {
    const s3 = this.requireS3()
    const cleanedFolder = folderName.trim().replace(/^\/+|\/+$/g, '')
    if (!cleanedFolder) {
      throw new Error('El nombre de la carpeta no puede estar vacio.')
    }

    const basePrefix = normalizePrefix(currentPrefix)
    const targetPrefix = `${basePrefix}${cleanedFolder}/`

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket.trim(),
        Key: targetPrefix,
        Body: ''
      })
    )

    return targetPrefix
  }

  async deleteItem(bucket: string, keyOrPrefix: string, isFolder: boolean): Promise<number> {
    const s3 = this.requireS3()
    const trimmedBucket = bucket.trim()

    if (!isFolder) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: trimmedBucket,
          Key: keyOrPrefix
        })
      )
      return 1
    }

    const folderPrefix = normalizePrefix(keyOrPrefix)
    let deletedCount = 0
    let continuationToken: string | undefined

    do {
      const listResp = await s3.send(
        new ListObjectsV2Command({
          Bucket: trimmedBucket,
          Prefix: folderPrefix,
          ContinuationToken: continuationToken
        })
      )

      const keysToDelete = (listResp.Contents || [])
        .filter((obj) => Boolean(obj.Key))
        .map((obj) => ({ Key: obj.Key! }))

      if (keysToDelete.length > 0) {
        const delResp = await s3.send(
          new DeleteObjectsCommand({
            Bucket: trimmedBucket,
            Delete: {
              Objects: keysToDelete,
              Quiet: false
            }
          })
        )

        if (delResp.Errors && delResp.Errors.length > 0) {
          const firstErr = delResp.Errors[0]
          const errObj = new Error(firstErr.Message || 'No se pudieron borrar algunos archivos.')
          errObj.name = firstErr.Code || 'AccessDenied'
          throw errObj
        }

        deletedCount += keysToDelete.length
      }

      continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined
    } while (continuationToken)

    return deletedCount
  }

  async uploadPaths(
    bucket: string,
    targetPrefix: string,
    localPaths: string[],
    onProgress: (event: TransferProgressEvent) => void
  ): Promise<{ uploadedFiles: number; totalBytes: number }> {
    const s3 = this.requireS3()
    const trimmedBucket = bucket.trim()
    const basePrefix = normalizePrefix(targetPrefix)

    const entries = await collectUploadEntries(localPaths, basePrefix)
    if (entries.length === 0) {
      throw new Error('No se encontraron archivos validos para subir.')
    }

    const totalBytes = entries.reduce((acc, item) => acc + item.size, 0)
    const transferId = crypto.randomUUID()
    const label =
      entries.length === 1
        ? path.basename(entries[0].localFilePath)
        : `${entries.length} archivos`

    let cancelled = false
    let currentUpload: Upload | null = null

    this.activeTransfers.set(transferId, {
      abort: () => {
        cancelled = true
        if (currentUpload) {
          void currentUpload.abort()
        }
      }
    })

    let completedBytesBeforeCurrent = 0
    let lastEmitTime = 0

    const emit = (
      status: TransferProgressEvent['status'],
      loadedBytes: number,
      detail?: string,
      error?: string
    ) => {
      const percentage =
        totalBytes > 0
          ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
          : status === 'completed'
            ? 100
            : 0
      onProgress({
        id: transferId,
        category: 's3-upload',
        title: `Subiendo ${label} a s3://${trimmedBucket}/${basePrefix}`,
        detail,
        loadedBytes,
        totalBytes,
        percentage,
        status,
        error
      })
    }

    emit('running', 0, `Preparando subida (0/${entries.length})`)

    try {
      for (let i = 0; i < entries.length; i++) {
        if (cancelled) {
          emit('cancelled', completedBytesBeforeCurrent, 'Subida cancelada por el usuario')
          throw new Error('Operacion cancelada por el usuario.')
        }

        const entry = entries[i]
        const readStream = fs.createReadStream(entry.localFilePath)

        const uploader = new Upload({
          client: s3,
          params: {
            Bucket: trimmedBucket,
            Key: entry.s3Key,
            Body: readStream
          },
          queueSize: 4,
          partSize: 5 * 1024 * 1024,
          leavePartsOnError: false
        })

        currentUpload = uploader

        uploader.on('httpUploadProgress', (progress) => {
          const now = Date.now()
          if (now - lastEmitTime < 80) return
          lastEmitTime = now
          const currentLoaded = completedBytesBeforeCurrent + (progress.loaded || 0)
          emit(
            'running',
            currentLoaded,
            `Archivo ${i + 1} de ${entries.length}: ${path.basename(entry.localFilePath)}`
          )
        })

        await uploader.done()
        completedBytesBeforeCurrent += entry.size
        emit(
          'running',
          completedBytesBeforeCurrent,
          `Completado ${i + 1} de ${entries.length}: ${path.basename(entry.localFilePath)}`
        )
      }

      emit('completed', totalBytes, `${entries.length} archivo(s) subido(s) correctamente`)
      return { uploadedFiles: entries.length, totalBytes }
    } catch (error) {
      if (!cancelled) {
        const translated = translateAwsOrDockerError(error, 's3:PutObject')
        emit('error', completedBytesBeforeCurrent, undefined, translated.message)
      }
      throw error
    } finally {
      this.activeTransfers.delete(transferId)
    }
  }

  async downloadObject(
    bucket: string,
    key: string,
    destinationFilePath: string,
    onProgress: (event: TransferProgressEvent) => void
  ): Promise<{ savedPath: string; totalBytes: number }> {
    const s3 = this.requireS3()
    const trimmedBucket = bucket.trim()
    const fileName = path.basename(key)
    const transferId = crypto.randomUUID()
    const abortController = new AbortController()
    let cancelled = false

    this.activeTransfers.set(transferId, {
      abort: () => {
        cancelled = true
        abortController.abort()
      }
    })

    let loadedBytes = 0
    let totalBytes = 0
    let lastEmitTime = 0

    const emit = (
      status: TransferProgressEvent['status'],
      detail?: string,
      error?: string
    ) => {
      const percentage =
        totalBytes > 0
          ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
          : status === 'completed'
            ? 100
            : 0
      onProgress({
        id: transferId,
        category: 's3-download',
        title: `Descargando '${fileName}'`,
        detail,
        loadedBytes,
        totalBytes,
        percentage,
        status,
        error
      })
    }

    emit('running', 'Conectando con Amazon S3...')

    try {
      const resp = await s3.send(
        new GetObjectCommand({
          Bucket: trimmedBucket,
          Key: key
        }),
        { abortSignal: abortController.signal }
      )

      totalBytes = resp.ContentLength ?? 0
      const bodyStream = resp.Body as Readable | undefined
      if (!bodyStream) {
        throw new Error('Amazon S3 devolvio una respuesta vacia para este archivo.')
      }

      fs.mkdirSync(path.dirname(destinationFilePath), { recursive: true })
      const writeStream = fs.createWriteStream(destinationFilePath)

      bodyStream.on('data', (chunk: Buffer) => {
        loadedBytes += chunk.length
        const now = Date.now()
        if (now - lastEmitTime >= 80) {
          lastEmitTime = now
          emit('running', destinationFilePath)
        }
      })

      await pipeline(bodyStream, writeStream)
      emit('completed', `Guardado en ${destinationFilePath}`)

      return { savedPath: destinationFilePath, totalBytes: loadedBytes }
    } catch (error) {
      // Limpiar archivo incompleto si hubo error o cancelacion
      try {
        if (fs.existsSync(destinationFilePath)) {
          fs.unlinkSync(destinationFilePath)
        }
      } catch {
        // ignore cleanup error
      }

      if (cancelled) {
        emit('cancelled', 'Descarga cancelada por el usuario')
        throw new Error('Descarga cancelada por el usuario.')
      }

      const translated = translateAwsOrDockerError(error, 's3:GetObject')
      emit('error', undefined, translated.message)
      throw error
    } finally {
      this.activeTransfers.delete(transferId)
    }
  }

  async previewObject(bucket: string, key: string): Promise<S3PreviewResult> {
    const s3 = this.requireS3()
    const trimmedBucket = bucket.trim()
    const fileName = path.basename(key)
    const ext = path.extname(fileName).toLowerCase()

    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: trimmedBucket,
        Key: key
      })
    )

    const size = head.ContentLength ?? 0
    const contentType = (head.ContentType || 'application/octet-stream').toLowerCase()

    // 1. Previsualizacion de imagenes (hasta 8 MB)
    const isImage = Boolean(IMAGE_MIME_MAP[ext]) || contentType.startsWith('image/')
    if (isImage) {
      const MAX_IMAGE_BYTES = 8 * 1024 * 1024
      if (size > MAX_IMAGE_BYTES) {
        return {
          kind: 'unsupported',
          fileName,
          contentType,
          size,
          truncated: false,
          message:
            'Esta imagen supera los 8 MB para vista rapida en memoria. Usa el boton Descargar para abrirla localmente.'
        }
      }

      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: trimmedBucket,
          Key: key
        })
      )
      const bytes = await obj.Body?.transformToByteArray()
      const mime = IMAGE_MIME_MAP[ext] || (contentType.startsWith('image/') ? contentType : 'image/png')
      const base64 = Buffer.from(bytes || []).toString('base64')

      return {
        kind: 'image',
        fileName,
        contentType: mime,
        size,
        truncated: false,
        imageDataUrl: `data:${mime};base64,${base64}`
      }
    }

    // 2. Previsualizacion de archivos de texto, JSON y CSV (primeros 512 KB)
    const isText =
      TEXT_EXTENSIONS.has(ext) ||
      contentType.startsWith('text/') ||
      contentType.includes('json') ||
      contentType.includes('xml') ||
      contentType.includes('csv') ||
      contentType.includes('yaml') ||
      contentType.includes('javascript')

    if (isText) {
      const MAX_PREVIEW_BYTES = 512 * 1024
      if (size === 0) {
        return {
          kind: ext === '.json' ? 'json' : ext === '.csv' ? 'csv' : 'text',
          fileName,
          contentType,
          size: 0,
          truncated: false,
          textContent: ''
        }
      }

      const endByte = Math.min(size - 1, MAX_PREVIEW_BYTES - 1)
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: trimmedBucket,
          Key: key,
          Range: `bytes=0-${endByte}`
        })
      )

      const bytes = await obj.Body?.transformToByteArray()
      const textContent = Buffer.from(bytes || []).toString('utf-8')
      const kind: S3PreviewResult['kind'] =
        ext === '.json' || contentType.includes('json')
          ? 'json'
          : ext === '.csv' || contentType.includes('csv')
            ? 'csv'
            : 'text'

      return {
        kind,
        fileName,
        contentType,
        size,
        truncated: size > MAX_PREVIEW_BYTES,
        textContent
      }
    }

    return {
      kind: 'unsupported',
      fileName,
      contentType,
      size,
      truncated: false,
      message: `El formato de '${fileName}' (${contentType}) es binario y no admite vista previa directa. Puedes descargarlo o generar un enlace temporal.`
    }
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresInSeconds: number
  ): Promise<{ url: string; expiresInSeconds: number; temporaryTokenWarning: boolean }> {
    const s3 = this.requireS3()
    const safeSeconds = Math.max(60, Math.min(expiresInSeconds, 7 * 24 * 3600))
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket.trim(),
        Key: key
      }),
      { expiresIn: safeSeconds }
    )

    return {
      url,
      expiresInSeconds: safeSeconds,
      temporaryTokenWarning: Boolean(this.currentIdentity?.isTemporaryToken)
    }
  }

  // ==================== AMAZON ECR ====================

  async listEcrRepositories(): Promise<EcrRepositoryItem[]> {
    const ecr = this.requireECR()
    const repositories: EcrRepositoryItem[] = []
    let nextToken: string | undefined

    do {
      const resp = await ecr.send(
        new DescribeRepositoriesCommand({
          nextToken,
          maxResults: 100
        })
      )

      for (const repo of resp.repositories || []) {
        if (!repo.repositoryName || !repo.repositoryUri) continue
        repositories.push({
          repositoryName: repo.repositoryName,
          repositoryUri: repo.repositoryUri,
          repositoryArn: repo.repositoryArn || '',
          registryId: repo.registryId || this.currentIdentity?.accountId || '',
          createdAt: repo.createdAt ? repo.createdAt.toISOString() : undefined,
          imageTagMutability: repo.imageTagMutability,
          scanOnPush: repo.imageScanningConfiguration?.scanOnPush
        })
      }

      nextToken = resp.nextToken
    } while (nextToken)

    return repositories.sort((a, b) => a.repositoryName.localeCompare(b.repositoryName))
  }

  async createEcrRepository(repositoryName: string): Promise<EcrRepositoryItem> {
    const ecr = this.requireECR()
    const cleaned = repositoryName.trim()
    if (!cleaned) {
      throw new Error('Ingresa un nombre valido para el repositorio ECR.')
    }

    const resp = await ecr.send(
      new CreateRepositoryCommand({
        repositoryName: cleaned,
        imageScanningConfiguration: { scanOnPush: true }
      })
    )

    const repo = resp.repository
    if (!repo || !repo.repositoryName || !repo.repositoryUri) {
      throw new Error('AWS no devolvio los detalles del repositorio creado.')
    }

    return {
      repositoryName: repo.repositoryName,
      repositoryUri: repo.repositoryUri,
      repositoryArn: repo.repositoryArn || '',
      registryId: repo.registryId || this.currentIdentity?.accountId || '',
      createdAt: repo.createdAt ? repo.createdAt.toISOString() : undefined,
      imageTagMutability: repo.imageTagMutability,
      scanOnPush: repo.imageScanningConfiguration?.scanOnPush
    }
  }

  async listEcrImages(repositoryName: string, repositoryUri?: string): Promise<EcrImageItem[]> {
    const ecr = this.requireECR()
    const trimmedRepo = repositoryName.trim()
    const accountId = this.currentIdentity?.accountId || ''
    const region = this.currentIdentity?.region || 'us-east-1'
    const baseUri =
      repositoryUri || `${accountId}.dkr.ecr.${region}.amazonaws.com/${trimmedRepo}`

    const images: EcrImageItem[] = []
    let nextToken: string | undefined

    do {
      const resp = await ecr.send(
        new DescribeImagesCommand({
          repositoryName: trimmedRepo,
          filter: {
            tagStatus: 'ANY'
          },
          nextToken,
          maxResults: 100
        })
      )

      for (const detail of resp.imageDetails || []) {
        const digest = detail.imageDigest || ''
        const tags = detail.imageTags || []
        const primaryRef = tags.length > 0 ? `${baseUri}:${tags[0]}` : `${baseUri}@${digest}`

        images.push({
          repositoryName: detail.repositoryName || trimmedRepo,
          registryId: detail.registryId || accountId,
          imageDigest: digest,
          imageTags: tags,
          imageSizeInBytes: detail.imageSizeInBytes ?? 0,
          imagePushedAt: detail.imagePushedAt ? detail.imagePushedAt.toISOString() : undefined,
          lastRecordedPullTime: detail.lastRecordedPullTime
            ? detail.lastRecordedPullTime.toISOString()
            : undefined,
          imageStatus: detail.imageStatus,
          lastArchivedAt: detail.lastArchivedAt ? detail.lastArchivedAt.toISOString() : undefined,
          lastActivatedAt: detail.lastActivatedAt
            ? detail.lastActivatedAt.toISOString()
            : undefined,
          imageUri: primaryRef
        })
      }

      nextToken = resp.nextToken
    } while (nextToken)

    return images.sort((a, b) => {
      const dateA = a.imagePushedAt ? new Date(a.imagePushedAt).getTime() : 0
      const dateB = b.imagePushedAt ? new Date(b.imagePushedAt).getTime() : 0
      return dateB - dateA
    })
  }

  async getEcrDockerAuth(): Promise<EcrAuthInfo> {
    const ecr = this.requireECR()
    const resp = await ecr.send(new GetAuthorizationTokenCommand({}))
    const authData = resp.authorizationData?.[0]

    if (!authData || !authData.authorizationToken || !authData.proxyEndpoint) {
      throw new Error('AWS ECR no devolvio un token de autorizacion valido.')
    }

    const decoded = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8')
    const colonIdx = decoded.indexOf(':')
    if (colonIdx === -1) {
      throw new Error('El formato del token de autorizacion de ECR es invalido.')
    }

    const username = decoded.slice(0, colonIdx)
    const password = decoded.slice(colonIdx + 1)
    const proxyEndpoint = authData.proxyEndpoint
    const registryHost = proxyEndpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '')

    return {
      username,
      password,
      proxyEndpoint,
      registryHost,
      expiresAt: authData.expiresAt ? authData.expiresAt.toISOString() : undefined
    }
  }

  async getEcrLifecyclePolicy(repositoryName: string): Promise<EcrLifecyclePolicyResult> {
    const ecr = this.requireECR()
    const trimmedRepo = repositoryName.trim()
    const fallbackRegistryId = this.currentIdentity?.accountId || ''

    try {
      const resp = await ecr.send(
        new GetLifecyclePolicyCommand({
          repositoryName: trimmedRepo
        })
      )

      const policyText = resp.lifecyclePolicyText || ''
      return {
        repositoryName: resp.repositoryName || trimmedRepo,
        registryId: resp.registryId || fallbackRegistryId,
        hasPolicy: Boolean(policyText),
        lifecyclePolicyText: policyText,
        lastEvaluatedAt: resp.lastEvaluatedAt ? resp.lastEvaluatedAt.toISOString() : undefined,
        rules: parseLifecycleRulesJson(policyText)
      }
    } catch (error: any) {
      if (error?.name === 'LifecyclePolicyNotFoundException') {
        return {
          repositoryName: trimmedRepo,
          registryId: fallbackRegistryId,
          hasPolicy: false,
          rules: []
        }
      }
      throw error
    }
  }

  async putEcrLifecyclePolicy(
    repositoryName: string,
    lifecyclePolicyText: string
  ): Promise<EcrLifecyclePolicyResult> {
    const ecr = this.requireECR()
    const trimmedRepo = repositoryName.trim()
    const fallbackRegistryId = this.currentIdentity?.accountId || ''

    let normalizedJson: string
    try {
      const parsed = JSON.parse(lifecyclePolicyText)
      normalizedJson = JSON.stringify(parsed)
    } catch {
      throw new Error('El texto JSON de la politica de Lifecycle no tiene un formato JSON valido.')
    }

    const resp = await ecr.send(
      new PutLifecyclePolicyCommand({
        repositoryName: trimmedRepo,
        lifecyclePolicyText: normalizedJson
      })
    )

    const savedText = resp.lifecyclePolicyText || normalizedJson
    return {
      repositoryName: resp.repositoryName || trimmedRepo,
      registryId: resp.registryId || fallbackRegistryId,
      hasPolicy: true,
      lifecyclePolicyText: savedText,
      rules: parseLifecycleRulesJson(savedText)
    }
  }

  async runEcrLifecyclePreview(repositoryName: string): Promise<EcrLifecyclePreviewResult> {
    const ecr = this.requireECR()
    const trimmedRepo = repositoryName.trim()

    // 1. Iniciar simulacion (o continuar si ya hay una en progreso)
    try {
      await ecr.send(
        new StartLifecyclePolicyPreviewCommand({
          repositoryName: trimmedRepo
        })
      )
    } catch (error: any) {
      if (error?.name === 'LifecyclePolicyNotFoundException') {
        return {
          repositoryName: trimmedRepo,
          status: 'NO_POLICY',
          expiringImageTotalCount: 0,
          archiveImageTotalCount: 0,
          items: []
        }
      }
      if (error?.name !== 'LifecyclePolicyPreviewInProgressException') {
        throw error
      }
    }

    // 2. Consultar resultado con un breve ciclo de espera si esta IN_PROGRESS
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      attempts += 1
      const previewResp = await ecr.send(
        new GetLifecyclePolicyPreviewCommand({
          repositoryName: trimmedRepo,
          maxResults: 100
        })
      )

      const status = (previewResp.status || 'IN_PROGRESS') as EcrLifecyclePreviewResult['status']

      if (status !== 'IN_PROGRESS' || attempts === maxAttempts) {
        const items: EcrLifecyclePreviewItem[] = (previewResp.previewResults || []).map((r) => ({
          imageTags: r.imageTags || [],
          imageDigest: r.imageDigest || '',
          imagePushedAt: r.imagePushedAt ? r.imagePushedAt.toISOString() : undefined,
          actionType: r.action?.type || 'EXPIRE',
          targetStorageClass: r.action?.targetStorageClass,
          appliedRulePriority: r.appliedRulePriority,
          storageClass: r.storageClass
        }))

        const archiveCount = (previewResp.summary?.transitioningImageTotalCounts || []).reduce(
          (acc, entry) => acc + (entry.imageTotalCount ?? 0),
          0
        )

        return {
          repositoryName: previewResp.repositoryName || trimmedRepo,
          status,
          expiringImageTotalCount: previewResp.summary?.expiringImageTotalCount ?? items.length,
          archiveImageTotalCount: archiveCount,
          items
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 900))
    }

    return {
      repositoryName: trimmedRepo,
      status: 'IN_PROGRESS',
      expiringImageTotalCount: 0,
      archiveImageTotalCount: 0,
      items: []
    }
  }
}

function parseLifecycleRulesJson(policyText?: string): EcrLifecycleRuleParsed[] {
  if (!policyText) return []
  try {
    const parsed = JSON.parse(policyText) as {
      rules?: Array<{
        rulePriority?: number
        description?: string
        selection?: {
          tagStatus?: string
          tagPrefixList?: string[]
          tagPatternList?: string[]
          storageClass?: string
          countType?: string
          countUnit?: string
          countNumber?: number
        }
        action?: {
          type?: string
          targetStorageClass?: string
        }
      }>
    }

    if (!Array.isArray(parsed.rules)) return []

    return parsed.rules
      .map((rule, idx) => ({
        rulePriority: rule.rulePriority ?? idx + 1,
        description: rule.description,
        tagStatus: rule.selection?.tagStatus || 'any',
        tagPrefixList: rule.selection?.tagPrefixList,
        tagPatternList: rule.selection?.tagPatternList,
        storageClass: rule.selection?.storageClass,
        countType: rule.selection?.countType || 'imageCountMoreThan',
        countUnit: rule.selection?.countUnit,
        countNumber: rule.selection?.countNumber ?? 0,
        actionType: rule.action?.type || 'expire',
        targetStorageClass: rule.action?.targetStorageClass
      }))
      .sort((a, b) => a.rulePriority - b.rulePriority)
  } catch {
    return []
  }
}

function normalizePrefix(prefix?: string): string {
  if (!prefix) return ''
  const trimmed = prefix.trim().replace(/^\/+/, '')
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function extractShortPrincipal(arn: string): string {
  // Ejemplos:
  // arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Dev_abc/usuario@empresa.com
  // arn:aws:iam::123456789012:user/desarrollador
  const parts = arn.split(':')
  const resource = parts.slice(5).join(':')
  if (!resource) return arn
  if (resource.startsWith('assumed-role/')) {
    const segs = resource.replace('assumed-role/', '').split('/')
    if (segs.length >= 2) {
      return `${segs[0]} (${segs.slice(1).join('/')})`
    }
  }
  if (resource.startsWith('user/')) {
    return resource.replace('user/', '')
  }
  return resource
}

async function collectUploadEntries(
  localPaths: string[],
  basePrefix: string
): Promise<UploadFileEntry[]> {
  const results: UploadFileEntry[] = []

  const walkDirectory = async (dirPath: string, relativeRootPrefix: string) => {
    const dirItems = await fs.promises.readdir(dirPath, { withFileTypes: true })
    for (const item of dirItems) {
      const fullPath = path.join(dirPath, item.name)
      const nextPrefix = `${relativeRootPrefix}${item.name}`
      if (item.isDirectory()) {
        await walkDirectory(fullPath, `${nextPrefix}/`)
      } else if (item.isFile()) {
        const stat = await fs.promises.stat(fullPath)
        results.push({
          localFilePath: fullPath,
          s3Key: `${basePrefix}${nextPrefix}`,
          size: stat.size
        })
      }
    }
  }

  for (const rawPath of localPaths) {
    if (!rawPath) continue
    const stat = await fs.promises.stat(rawPath)
    if (stat.isFile()) {
      const fileName = path.basename(rawPath)
      results.push({
        localFilePath: rawPath,
        s3Key: `${basePrefix}${fileName}`,
        size: stat.size
      })
    } else if (stat.isDirectory()) {
      const folderName = path.basename(rawPath)
      await walkDirectory(rawPath, `${folderName}/`)
    }
  }

  return results
}

export const awsManager = new AwsManager()

