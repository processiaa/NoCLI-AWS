import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { awsManager } from './aws-manager'
import { dockerManager } from './docker-manager'
import { profileStorage } from './profile-storage'
import { toFailureResponse } from './error-translator'
import type {
  ApiResponse,
  AwsCredentialsInput,
  AwsIdentity,
  SavedProfileMeta,
  TransferProgressEvent
} from '../shared/types'

let mainWindow: BrowserWindow | null = null

function sendTransferProgress(event: TransferProgressEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('transfer:progress', event)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'NoCLI AWS - Gestor de Escritorio S3 y ECR',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  // ==================== AUTENTICACION AWS ====================

  ipcMain.handle(
    'aws:connect',
    async (
      _event,
      credentials: AwsCredentialsInput,
      saveOption?: { save: boolean; profileName: string }
    ): Promise<ApiResponse<{ identity: AwsIdentity; savedProfile?: SavedProfileMeta }>> => {
      try {
        const identity = await awsManager.connectAndValidate(credentials)
        let savedProfile: SavedProfileMeta | undefined

        if (saveOption?.save) {
          savedProfile = profileStorage.saveProfile(saveOption.profileName, credentials, {
            accountId: identity.accountId,
            shortPrincipal: identity.shortPrincipal
          })
        }

        return {
          success: true,
          data: { identity, savedProfile }
        }
      } catch (error) {
        return toFailureResponse(error, 'sts:GetCallerIdentity')
      }
    }
  )

  ipcMain.handle('aws:get-session', async (): Promise<ApiResponse<AwsIdentity | null>> => {
    return {
      success: true,
      data: awsManager.getSessionIdentity()
    }
  })

  ipcMain.handle(
    'aws:change-region',
    async (_event, region: string): Promise<ApiResponse<AwsIdentity>> => {
      try {
        const updated = awsManager.changeRegion(region)
        return { success: true, data: updated }
      } catch (error) {
        return toFailureResponse(error)
      }
    }
  )

  ipcMain.handle('aws:disconnect', async (): Promise<ApiResponse<boolean>> => {
    awsManager.disconnect()
    return { success: true, data: true }
  })

  // ==================== BOVEDA LOCAL CIFRADA (safeStorage / DPAPI) ====================

  ipcMain.handle('vault:get-state', async () => {
    return {
      success: true as const,
      data: {
        profiles: profileStorage.listProfiles(),
        recentS3Uris: profileStorage.listRecentS3Uris(),
        encryptionAvailable: profileStorage.isEncryptionAvailable()
      }
    }
  })

  ipcMain.handle(
    'vault:connect-profile',
    async (_event, profileId: string): Promise<ApiResponse<AwsIdentity>> => {
      try {
        const creds = profileStorage.loadProfileCredentials(profileId)
        const identity = await awsManager.connectAndValidate(creds)
        return { success: true, data: identity }
      } catch (error) {
        return toFailureResponse(error, 'sts:GetCallerIdentity')
      }
    }
  )

  ipcMain.handle(
    'vault:save-current-session',
    async (_event, profileName: string): Promise<ApiResponse<SavedProfileMeta>> => {
      try {
        const creds = awsManager.getCurrentCredentials()
        const identity = awsManager.getSessionIdentity()
        if (!creds || !identity) {
          throw new Error('No hay una sesion activa para guardar.')
        }
        const saved = profileStorage.saveProfile(profileName, creds, {
          accountId: identity.accountId,
          shortPrincipal: identity.shortPrincipal
        })
        return { success: true, data: saved }
      } catch (error) {
        return toFailureResponse(error)
      }
    }
  )

  ipcMain.handle(
    'vault:delete-profile',
    async (_event, profileId: string): Promise<ApiResponse<SavedProfileMeta[]>> => {
      try {
        profileStorage.deleteProfile(profileId)
        return { success: true, data: profileStorage.listProfiles() }
      } catch (error) {
        return toFailureResponse(error)
      }
    }
  )

  ipcMain.handle(
    'vault:add-recent-s3',
    async (_event, uri: string): Promise<ApiResponse<string[]>> => {
      return {
        success: true,
        data: profileStorage.addRecentS3Uri(uri)
      }
    }
  )

  ipcMain.handle(
    'vault:remove-recent-s3',
    async (_event, uri: string): Promise<ApiResponse<string[]>> => {
      return {
        success: true,
        data: profileStorage.removeRecentS3Uri(uri)
      }
    }
  )

  // ==================== AMAZON S3 ====================

  ipcMain.handle('s3:list-buckets', async () => {
    try {
      const result = await awsManager.listBuckets()
      return { success: true as const, data: result }
    } catch (error) {
      return toFailureResponse(error, 's3:ListAllMyBuckets')
    }
  })

  ipcMain.handle(
    's3:list-objects',
    async (
      _event,
      params: { bucket: string; prefix: string; continuationToken?: string }
    ) => {
      try {
        const result = await awsManager.listObjects(
          params.bucket,
          params.prefix,
          params.continuationToken
        )
        return { success: true as const, data: result }
      } catch (error) {
        return toFailureResponse(error, 's3:ListBucket')
      }
    }
  )

  ipcMain.handle(
    's3:create-folder',
    async (_event, params: { bucket: string; prefix: string; folderName: string }) => {
      try {
        const createdPrefix = await awsManager.createFolder(
          params.bucket,
          params.prefix,
          params.folderName
        )
        return { success: true as const, data: createdPrefix }
      } catch (error) {
        return toFailureResponse(error, 's3:PutObject')
      }
    }
  )

  ipcMain.handle(
    's3:delete-item',
    async (_event, params: { bucket: string; key: string; isFolder: boolean }) => {
      try {
        const count = await awsManager.deleteItem(params.bucket, params.key, params.isFolder)
        return { success: true as const, data: count }
      } catch (error) {
        return toFailureResponse(error, 's3:DeleteObject')
      }
    }
  )

  ipcMain.handle(
    's3:pick-and-upload',
    async (_event, params: { bucket: string; prefix: string; directory?: boolean }) => {
      try {
        if (!mainWindow) throw new Error('Ventana principal no disponible.')
        const pickResult = await dialog.showOpenDialog(mainWindow, {
          title: params.directory
            ? 'Seleccionar carpeta para subir a Amazon S3'
            : 'Seleccionar archivos para subir a Amazon S3',
          properties: params.directory
            ? ['openDirectory', 'multiSelections']
            : ['openFile', 'multiSelections']
        })

        if (pickResult.canceled || pickResult.filePaths.length === 0) {
          return { success: true as const, data: { cancelled: true } }
        }

        const uploadResult = await awsManager.uploadPaths(
          params.bucket,
          params.prefix,
          pickResult.filePaths,
          sendTransferProgress
        )

        return {
          success: true as const,
          data: {
            cancelled: false,
            uploadedFiles: uploadResult.uploadedFiles,
            totalBytes: uploadResult.totalBytes
          }
        }
      } catch (error) {
        return toFailureResponse(error, 's3:PutObject')
      }
    }
  )

  ipcMain.handle(
    's3:upload-paths',
    async (_event, params: { bucket: string; prefix: string; localPaths: string[] }) => {
      try {
        const result = await awsManager.uploadPaths(
          params.bucket,
          params.prefix,
          params.localPaths,
          sendTransferProgress
        )
        return { success: true as const, data: result }
      } catch (error) {
        return toFailureResponse(error, 's3:PutObject')
      }
    }
  )

  ipcMain.handle(
    's3:download-object',
    async (_event, params: { bucket: string; key: string }) => {
      try {
        if (!mainWindow) throw new Error('Ventana principal no disponible.')
        const defaultFileName = path.basename(params.key)
        const saveResult = await dialog.showSaveDialog(mainWindow, {
          title: `Guardar '${defaultFileName}' desde Amazon S3`,
          defaultPath: path.join(app.getPath('downloads'), defaultFileName)
        })

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true as const, data: { cancelled: true } }
        }

        const downloadResult = await awsManager.downloadObject(
          params.bucket,
          params.key,
          saveResult.filePath,
          sendTransferProgress
        )

        return {
          success: true as const,
          data: {
            cancelled: false,
            savedPath: downloadResult.savedPath,
            totalBytes: downloadResult.totalBytes
          }
        }
      } catch (error) {
        return toFailureResponse(error, 's3:GetObject')
      }
    }
  )

  ipcMain.handle(
    's3:preview-object',
    async (_event, params: { bucket: string; key: string }) => {
      try {
        const preview = await awsManager.previewObject(params.bucket, params.key)
        return { success: true as const, data: preview }
      } catch (error) {
        return toFailureResponse(error, 's3:GetObject')
      }
    }
  )

  ipcMain.handle(
    's3:presigned-url',
    async (
      _event,
      params: { bucket: string; key: string; expiresInSeconds: number }
    ) => {
      try {
        const signed = await awsManager.getPresignedUrl(
          params.bucket,
          params.key,
          params.expiresInSeconds
        )
        return { success: true as const, data: signed }
      } catch (error) {
        return toFailureResponse(error, 's3:GetObject')
      }
    }
  )

  ipcMain.handle('transfer:cancel', async (_event, transferId: string) => {
    const cancelled = awsManager.cancelTransfer(transferId)
    return { success: true as const, data: cancelled }
  })

  // ==================== AMAZON ECR & DOCKER LOCAL ====================

  ipcMain.handle('ecr:list-repositories', async () => {
    try {
      const repos = await awsManager.listEcrRepositories()
      return { success: true as const, data: repos }
    } catch (error) {
      return toFailureResponse(error, 'ecr:DescribeRepositories')
    }
  })

  ipcMain.handle('ecr:create-repository', async (_event, repositoryName: string) => {
    try {
      const repo = await awsManager.createEcrRepository(repositoryName)
      return { success: true as const, data: repo }
    } catch (error) {
      return toFailureResponse(error, 'ecr:CreateRepository')
    }
  })

  ipcMain.handle(
    'ecr:list-images',
    async (_event, params: { repositoryName: string; repositoryUri?: string }) => {
      try {
        const images = await awsManager.listEcrImages(params.repositoryName, params.repositoryUri)
        return { success: true as const, data: images }
      } catch (error) {
        return toFailureResponse(error, 'ecr:DescribeImages')
      }
    }
  )

  ipcMain.handle('ecr:get-lifecycle-policy', async (_event, repositoryName: string) => {
    try {
      const policy = await awsManager.getEcrLifecyclePolicy(repositoryName)
      return { success: true as const, data: policy }
    } catch (error) {
      return toFailureResponse(error, 'ecr:GetLifecyclePolicy')
    }
  })

  ipcMain.handle(
    'ecr:put-lifecycle-policy',
    async (_event, params: { repositoryName: string; lifecyclePolicyText: string }) => {
      try {
        const saved = await awsManager.putEcrLifecyclePolicy(
          params.repositoryName,
          params.lifecyclePolicyText
        )
        return { success: true as const, data: saved }
      } catch (error) {
        return toFailureResponse(error, 'ecr:PutLifecyclePolicy')
      }
    }
  )

  ipcMain.handle('ecr:preview-lifecycle-policy', async (_event, repositoryName: string) => {
    try {
      const preview = await awsManager.runEcrLifecyclePreview(repositoryName)
      return { success: true as const, data: preview }
    } catch (error) {
      return toFailureResponse(error, 'ecr:StartLifecyclePolicyPreview')
    }
  })

  ipcMain.handle('docker:status', async () => {
    const status = await dockerManager.getStatus()
    return { success: true as const, data: status }
  })

  ipcMain.handle('docker:list-images', async () => {
    try {
      const images = await dockerManager.listLocalImages()
      return { success: true as const, data: images }
    } catch (error) {
      return toFailureResponse(error)
    }
  })

  ipcMain.handle('docker:login-ecr', async () => {
    try {
      const authInfo = await awsManager.getEcrDockerAuth()
      const loginResult = await dockerManager.authenticateLocalDocker(authInfo)
      return {
        success: true as const,
        data: {
          ...loginResult,
          expiresAt: authInfo.expiresAt
        }
      }
    } catch (error) {
      return toFailureResponse(error, 'ecr:GetAuthorizationToken')
    }
  })

  ipcMain.handle('docker:pull-ecr', async (_event, imageUri: string) => {
    try {
      const authInfo = await awsManager.getEcrDockerAuth()
      const res = await dockerManager.pullImageFromEcr(imageUri, authInfo, sendTransferProgress)
      return { success: true as const, data: res }
    } catch (error) {
      return toFailureResponse(error, 'ecr:GetAuthorizationToken')
    }
  })

  ipcMain.handle(
    'docker:push-ecr',
    async (
      _event,
      params: { localImageRef: string; targetRepositoryUri: string; targetTag: string }
    ) => {
      try {
        const authInfo = await awsManager.getEcrDockerAuth()
        const res = await dockerManager.tagAndPushToEcr(
          params.localImageRef,
          params.targetRepositoryUri,
          params.targetTag,
          authInfo,
          sendTransferProgress
        )
        return { success: true as const, data: res }
      } catch (error) {
        return toFailureResponse(error, 'ecr:GetAuthorizationToken')
      }
    }
  )

  ipcMain.handle(
    'ecr:powershell-commands',
    async (
      _event,
      params: {
        mode: 'login' | 'pull' | 'push'
        ecrImageUri?: string
        localImageTag?: string
        targetRepositoryUri?: string
        targetTag?: string
      }
    ) => {
      try {
        const authInfo = await awsManager.getEcrDockerAuth()
        const region = awsManager.getSessionIdentity()?.region || 'us-east-1'
        const commands = dockerManager.buildPowerShellCommands({
          authInfo,
          region,
          mode: params.mode,
          ecrImageUri: params.ecrImageUri,
          localImageTag: params.localImageTag,
          targetRepositoryUri: params.targetRepositoryUri,
          targetTag: params.targetTag
        })
        return { success: true as const, data: commands }
      } catch (error) {
        return toFailureResponse(error, 'ecr:GetAuthorizationToken')
      }
    }
  )
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.nocliaws.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    awsManager.disconnect()
    app.quit()
  }
})

