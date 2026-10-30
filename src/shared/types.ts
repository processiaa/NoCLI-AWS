export interface AwsCredentialsInput {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  expiration?: string
}

export interface AwsIdentity {
  accountId: string
  arn: string
  userId: string
  region: string
  shortPrincipal: string
  isTemporaryToken: boolean
  expiration?: string
}

export type ApiResponse<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error: string
      errorCode?: string
      isExpiredToken?: boolean
      isAccessDenied?: boolean
    }

export interface SavedProfileMeta {
  id: string
  name: string
  accountId?: string
  shortPrincipal?: string
  region: string
  isTemporaryToken: boolean
  savedAt: string
  encryptionAvailable: boolean
}

export interface S3BucketItem {
  name: string
  creationDate?: string
}

export interface S3ListBucketsResult {
  buckets: S3BucketItem[]
  listRestricted: boolean
  restrictionMessage?: string
}

export interface S3FolderItem {
  name: string
  prefix: string
}

export interface S3ObjectItem {
  key: string
  name: string
  size: number
  lastModified?: string
  storageClass?: string
}

export interface S3ListObjectsResult {
  bucket: string
  prefix: string
  folders: S3FolderItem[]
  objects: S3ObjectItem[]
  isTruncated: boolean
  nextContinuationToken?: string
}

export interface S3PreviewResult {
  kind: 'text' | 'json' | 'csv' | 'image' | 'unsupported'
  fileName: string
  contentType: string
  size: number
  truncated: boolean
  textContent?: string
  imageDataUrl?: string
  message?: string
}

export interface TransferProgressEvent {
  id: string
  category: 's3-upload' | 's3-download' | 'docker-push' | 'docker-pull'
  title: string
  detail?: string
  loadedBytes?: number
  totalBytes?: number
  percentage: number
  status: 'running' | 'completed' | 'error' | 'cancelled'
  error?: string
}

export interface EcrRepositoryItem {
  repositoryName: string
  repositoryUri: string
  repositoryArn: string
  registryId: string
  createdAt?: string
  imageTagMutability?: string
  scanOnPush?: boolean
}

export interface EcrImageItem {
  repositoryName: string
  registryId: string
  imageDigest: string
  imageTags: string[]
  imageSizeInBytes: number
  imagePushedAt?: string
  lastRecordedPullTime?: string
  imageStatus?: string
  lastArchivedAt?: string
  lastActivatedAt?: string
  imageUri: string
}

export interface EcrLifecycleRuleParsed {
  rulePriority: number
  description?: string
  tagStatus: 'tagged' | 'untagged' | 'any' | string
  tagPrefixList?: string[]
  tagPatternList?: string[]
  storageClass?: string
  countType: 'imageCountMoreThan' | 'sinceImagePushed' | 'sinceImagePulled' | 'sinceImageTransitioned' | string
  countUnit?: string
  countNumber: number
  actionType: 'expire' | 'transition' | string
  targetStorageClass?: string
}

export interface EcrLifecyclePolicyResult {
  repositoryName: string
  registryId: string
  hasPolicy: boolean
  lifecyclePolicyText?: string
  lastEvaluatedAt?: string
  rules: EcrLifecycleRuleParsed[]
}

export interface EcrLifecyclePreviewItem {
  imageTags: string[]
  imageDigest: string
  imagePushedAt?: string
  actionType: string
  targetStorageClass?: string
  appliedRulePriority?: number
  storageClass?: string
}

export interface EcrLifecyclePreviewResult {
  repositoryName: string
  status: 'IN_PROGRESS' | 'COMPLETE' | 'EXPIRED' | 'FAILED' | 'NO_POLICY'
  expiringImageTotalCount: number
  archiveImageTotalCount: number
  items: EcrLifecyclePreviewItem[]
}

export interface EcrAuthInfo {
  username: string
  password: string
  proxyEndpoint: string
  registryHost: string
  expiresAt?: string
}

export interface LocalDockerStatus {
  connected: boolean
  version?: string
  apiVersion?: string
  os?: string
  arch?: string
  error?: string
}

export interface LocalDockerImage {
  id: string
  shortId: string
  repoTags: string[]
  primaryTag: string
  sizeInBytes: number
  created?: string
}

export interface PowerShellCommandBundle {
  registryHost: string
  directNoCliScript: string
  standardAwsCliScript: string
  expiresAt?: string
}

export const AWS_REGIONS: Array<{ code: string; label: string }> = [
  { code: 'us-east-1', label: 'us-east-1 (EE. UU. Este - N. Virginia)' },
  { code: 'us-east-2', label: 'us-east-2 (EE. UU. Este - Ohio)' },
  { code: 'us-west-1', label: 'us-west-1 (EE. UU. Oeste - N. California)' },
  { code: 'us-west-2', label: 'us-west-2 (EE. UU. Oeste - Oregon)' },
  { code: 'sa-east-1', label: 'sa-east-1 (Sudamerica - Sao Paulo)' },
  { code: 'ca-central-1', label: 'ca-central-1 (Canada - Central)' },
  { code: 'eu-west-1', label: 'eu-west-1 (Europa - Irlanda)' },
  { code: 'eu-west-2', label: 'eu-west-2 (Europa - Londres)' },
  { code: 'eu-central-1', label: 'eu-central-1 (Europa - Frankfurt)' },
  { code: 'ap-northeast-1', label: 'ap-northeast-1 (Asia Pacifico - Tokio)' },
  { code: 'ap-southeast-1', label: 'ap-southeast-1 (Asia Pacifico - Singapur)' },
  { code: 'ap-southeast-2', label: 'ap-southeast-2 (Asia Pacifico - Sidney)' }
]

