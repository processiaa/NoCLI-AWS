import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ApiResponse,
  AwsCredentialsInput,
  AwsIdentity,
  EcrImageItem,
  EcrLifecyclePolicyResult,
  EcrLifecyclePreviewResult,
  EcrRepositoryItem,
  LocalDockerImage,
  LocalDockerStatus,
  PowerShellCommandBundle,
  S3ListBucketsResult,
  S3ListObjectsResult,
  S3PreviewResult,
  SavedProfileMeta,
  TransferProgressEvent
} from '../shared/types'

export const api = {
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return (file as unknown as { path?: string }).path || ''
    }
  },

  // Auth & Sesion AWS
  connectAws: (
    credentials: AwsCredentialsInput,
    saveOption?: { save: boolean; profileName: string }
  ): Promise<ApiResponse<{ identity: AwsIdentity; savedProfile?: SavedProfileMeta }>> =>
    ipcRenderer.invoke('aws:connect', credentials, saveOption),

  getSession: (): Promise<ApiResponse<AwsIdentity | null>> =>
    ipcRenderer.invoke('aws:get-session'),

  changeRegion: (region: string): Promise<ApiResponse<AwsIdentity>> =>
    ipcRenderer.invoke('aws:change-region', region),

  disconnectAws: (): Promise<ApiResponse<boolean>> =>
    ipcRenderer.invoke('aws:disconnect'),

  // Boveda cifrada DPAPI / Perfiles y Rutas S3 Recientes
  getVaultState: (): Promise<
    ApiResponse<{
      profiles: SavedProfileMeta[]
      recentS3Uris: string[]
      encryptionAvailable: boolean
    }>
  > => ipcRenderer.invoke('vault:get-state'),

  connectSavedProfile: (profileId: string): Promise<ApiResponse<AwsIdentity>> =>
    ipcRenderer.invoke('vault:connect-profile', profileId),

  saveCurrentSession: (profileName: string): Promise<ApiResponse<SavedProfileMeta>> =>
    ipcRenderer.invoke('vault:save-current-session', profileName),

  deleteSavedProfile: (profileId: string): Promise<ApiResponse<SavedProfileMeta[]>> =>
    ipcRenderer.invoke('vault:delete-profile', profileId),

  addRecentS3Uri: (uri: string): Promise<ApiResponse<string[]>> =>
    ipcRenderer.invoke('vault:add-recent-s3', uri),

  removeRecentS3Uri: (uri: string): Promise<ApiResponse<string[]>> =>
    ipcRenderer.invoke('vault:remove-recent-s3', uri),

  // Amazon S3
  listS3Buckets: (): Promise<ApiResponse<S3ListBucketsResult>> =>
    ipcRenderer.invoke('s3:list-buckets'),

  listS3Objects: (params: {
    bucket: string
    prefix: string
    continuationToken?: string
  }): Promise<ApiResponse<S3ListObjectsResult>> =>
    ipcRenderer.invoke('s3:list-objects', params),

  createS3Folder: (params: {
    bucket: string
    prefix: string
    folderName: string
  }): Promise<ApiResponse<string>> => ipcRenderer.invoke('s3:create-folder', params),

  deleteS3Item: (params: {
    bucket: string
    key: string
    isFolder: boolean
  }): Promise<ApiResponse<number>> => ipcRenderer.invoke('s3:delete-item', params),

  pickAndUploadS3: (params: {
    bucket: string
    prefix: string
    directory?: boolean
  }): Promise<
    ApiResponse<{ cancelled?: boolean; uploadedFiles?: number; totalBytes?: number }>
  > => ipcRenderer.invoke('s3:pick-and-upload', params),

  uploadPathsToS3: (params: {
    bucket: string
    prefix: string
    localPaths: string[]
  }): Promise<ApiResponse<{ uploadedFiles: number; totalBytes: number }>> =>
    ipcRenderer.invoke('s3:upload-paths', params),

  downloadS3Object: (params: {
    bucket: string
    key: string
  }): Promise<
    ApiResponse<{ cancelled?: boolean; savedPath?: string; totalBytes?: number }>
  > => ipcRenderer.invoke('s3:download-object', params),

  previewS3Object: (params: {
    bucket: string
    key: string
  }): Promise<ApiResponse<S3PreviewResult>> =>
    ipcRenderer.invoke('s3:preview-object', params),

  getS3PresignedUrl: (params: {
    bucket: string
    key: string
    expiresInSeconds: number
  }): Promise<
    ApiResponse<{ url: string; expiresInSeconds: number; temporaryTokenWarning: boolean }>
  > => ipcRenderer.invoke('s3:presigned-url', params),

  cancelTransfer: (transferId: string): Promise<ApiResponse<boolean>> =>
    ipcRenderer.invoke('transfer:cancel', transferId),

  // Amazon ECR & Docker Local
  listEcrRepositories: (): Promise<ApiResponse<EcrRepositoryItem[]>> =>
    ipcRenderer.invoke('ecr:list-repositories'),

  createEcrRepository: (repositoryName: string): Promise<ApiResponse<EcrRepositoryItem>> =>
    ipcRenderer.invoke('ecr:create-repository', repositoryName),

  listEcrImages: (params: {
    repositoryName: string
    repositoryUri?: string
  }): Promise<ApiResponse<EcrImageItem[]>> => ipcRenderer.invoke('ecr:list-images', params),

  getEcrLifecyclePolicy: (
    repositoryName: string
  ): Promise<ApiResponse<EcrLifecyclePolicyResult>> =>
    ipcRenderer.invoke('ecr:get-lifecycle-policy', repositoryName),

  putEcrLifecyclePolicy: (params: {
    repositoryName: string
    lifecyclePolicyText: string
  }): Promise<ApiResponse<EcrLifecyclePolicyResult>> =>
    ipcRenderer.invoke('ecr:put-lifecycle-policy', params),

  previewEcrLifecyclePolicy: (
    repositoryName: string
  ): Promise<ApiResponse<EcrLifecyclePreviewResult>> =>
    ipcRenderer.invoke('ecr:preview-lifecycle-policy', repositoryName),

  getDockerStatus: (): Promise<ApiResponse<LocalDockerStatus>> =>
    ipcRenderer.invoke('docker:status'),

  listLocalDockerImages: (): Promise<ApiResponse<LocalDockerImage[]>> =>
    ipcRenderer.invoke('docker:list-images'),

  loginLocalDockerToEcr: (): Promise<
    ApiResponse<{
      engineVerified: boolean
      cliConfigSaved: boolean
      registryHost: string
      expiresAt?: string
    }>
  > => ipcRenderer.invoke('docker:login-ecr'),

  pullEcrImageToLocal: (imageUri: string): Promise<ApiResponse<{ imageUri: string }>> =>
    ipcRenderer.invoke('docker:pull-ecr', imageUri),

  pushLocalImageToEcr: (params: {
    localImageRef: string
    targetRepositoryUri: string
    targetTag: string
  }): Promise<ApiResponse<{ pushedUri: string }>> =>
    ipcRenderer.invoke('docker:push-ecr', params),

  getEcrPowerShellCommands: (params: {
    mode: 'login' | 'pull' | 'push'
    ecrImageUri?: string
    localImageTag?: string
    targetRepositoryUri?: string
    targetTag?: string
  }): Promise<ApiResponse<PowerShellCommandBundle>> =>
    ipcRenderer.invoke('ecr:powershell-commands', params),

  // Eventos de progreso en tiempo real
  onTransferProgress: (callback: (event: TransferProgressEvent) => void): (() => void) => {
    const listener = (_ipcEvent: Electron.IpcRendererEvent, data: TransferProgressEvent) => {
      callback(data)
    }
    ipcRenderer.on('transfer:progress', listener)
    return () => {
      ipcRenderer.removeListener('transfer:progress', listener)
    }
  }
}

export type DesktopApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(globalThis as unknown as { api: DesktopApi }).api = api
}

