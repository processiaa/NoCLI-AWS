import type { ApiResponse } from '../shared/types'

export interface TranslatedAwsError {
  message: string
  errorCode: string
  isExpiredToken: boolean
  isAccessDenied: boolean
}

export function translateAwsOrDockerError(
  error: unknown,
  actionPermissionHint?: string
): TranslatedAwsError {
  const err = error as Record<string, any> | undefined
  const name = String(err?.name || err?.Code || err?.code || 'UnknownError')
  const rawMessage = String(err?.message || 'Error inesperado al ejecutar la operacion.')
  const statusCode = Number(err?.$metadata?.httpStatusCode || err?.statusCode || 0)

  // 1. Sesion o token temporal expirado
  if (
    name === 'ExpiredTokenException' ||
    name === 'ExpiredToken' ||
    name === 'TokenRefreshRequired' ||
    name === 'RequestExpired' ||
    /expired/i.test(name) ||
    /security token included in the request is expired/i.test(rawMessage)
  ) {
    return {
      errorCode: name,
      isExpiredToken: true,
      isAccessDenied: false,
      message: 'Tu sesion temporal ha expirado. Pega un nuevo token para continuar sin perder tu trabajo.'
    }
  }

  // 2. Credenciales invalidas o mal copiadas
  if (
    name === 'InvalidClientTokenId' ||
    name === 'InvalidAccessKeyId' ||
    name === 'SignatureDoesNotMatch' ||
    name === 'UnrecognizedClientException' ||
    name === 'IncompleteSignature'
  ) {
    const tokenNote =
      name === 'InvalidClientTokenId' || name === 'UnrecognizedClientException'
        ? ' Si tus llaves empiezan por "ASIA", asegurate de haber incluido tambien el AWS_SESSION_TOKEN completo.'
        : ''
    return {
      errorCode: name,
      isExpiredToken: false,
      isAccessDenied: false,
      message: `Las credenciales de AWS son incorrectas o estan incompletas.${tokenNote}`
    }
  }

  // 3. Permisos IAM insuficientes (AccessDenied)
  if (
    name === 'AccessDenied' ||
    name === 'AccessDeniedException' ||
    name === 'UnauthorizedOperation' ||
    name === 'AuthorizationErrorException' ||
    statusCode === 403 ||
    /not authorized to perform/i.test(rawMessage) ||
    /Access Denied/i.test(rawMessage)
  ) {
    // Intentar extraer la accion IAM exacta del mensaje de AWS si viene incluida (ej. s3:DeleteObject)
    const explicitActionMatch = rawMessage.match(/not authorized to perform:\s*([a-z0-9]+:[A-Za-z0-9*]+)/i)
    const detectedPermission = explicitActionMatch?.[1] || actionPermissionHint

    const friendlyHint = detectedPermission
      ? buildFriendlyPermissionText(detectedPermission)
      : 'Tu token actual no tiene permisos IAM suficientes para realizar esta accion.'

    return {
      errorCode: 'AccessDenied',
      isExpiredToken: false,
      isAccessDenied: true,
      message: friendlyHint
    }
  }

  // 4. Errores especificos de S3
  if (name === 'NoSuchBucket') {
    return {
      errorCode: name,
      isExpiredToken: false,
      isAccessDenied: false,
      message: 'El bucket especificado no existe en AWS o el nombre contiene algun error tipografico.'
    }
  }

  if (name === 'NoSuchKey' || statusCode === 404) {
    return {
      errorCode: name,
      isExpiredToken: false,
      isAccessDenied: false,
      message: 'El archivo o recurso solicitado ya no existe o fue movido.'
    }
  }

  if (name === 'PermanentRedirect' || name === 'AuthorizationHeaderMalformed') {
    return {
      errorCode: name,
      isExpiredToken: false,
      isAccessDenied: false,
      message:
        'Este bucket pertenece a otra region de AWS. Cambia la region en la barra superior e intentalo nuevamente.'
    }
  }

  // 5. Errores especificos de ECR
  if (name === 'RepositoryNotFoundException') {
    return {
      errorCode: name,
      isExpiredToken: false,
      isAccessDenied: false,
      message: 'No se encontro el repositorio de ECR en la region seleccionada.'
    }
  }

  if (name === 'RepositoryAlreadyExistsException') {
    return {
      errorCode: name,
      isExpiredToken: false,
      isAccessDenied: false,
      message: 'Ya existe un repositorio de ECR con ese nombre en esta cuenta y region.'
    }
  }

  // 6. Errores de red / proxy corporativo
  if (
    name === 'ENOTFOUND' ||
    name === 'ETIMEDOUT' ||
    name === 'ECONNRESET' ||
    name === 'NetworkingError'
  ) {
    return {
      errorCode: name,
      isExpiredToken: false,
      isAccessDenied: false,
      message:
        'No se pudo conectar con los servidores de AWS. Verifica tu conexion a internet o la VPN corporativa.'
    }
  }

  // 7. Errores de Docker Desktop local
  if (
    name === 'ENOENT' ||
    name === 'ECONNREFUSED' ||
    /docker_engine/i.test(rawMessage) ||
    /docker\.sock/i.test(rawMessage)
  ) {
    return {
      errorCode: 'DockerNotRunning',
      isExpiredToken: false,
      isAccessDenied: false,
      message:
        'Docker Desktop no parece estar abierto en tu PC. Abre Docker Desktop o usa el boton de copiar comandos PowerShell.'
    }
  }

  return {
    errorCode: name,
    isExpiredToken: false,
    isAccessDenied: false,
    message: rawMessage
  }
}

function buildFriendlyPermissionText(permission: string): string {
  const descriptions: Record<string, string> = {
    's3:ListAllMyBuckets':
      'Tu token no tiene permiso para listar todos los buckets de la cuenta (s3:ListAllMyBuckets). Escribe directamente la ruta s3://nombre-del-bucket/ arriba.',
    's3:ListBucket':
      'Tu token no tiene permisos para ver el contenido de este bucket o carpeta (s3:ListBucket).',
    's3:GetObject':
      'Tu token no tiene permisos para descargar o previsualizar archivos en este bucket (s3:GetObject).',
    's3:PutObject':
      'Tu token no tiene permisos para subir archivos o crear carpetas en este bucket (s3:PutObject).',
    's3:DeleteObject':
      'Tu token no tiene permisos para borrar archivos en este bucket (s3:DeleteObject).',
    'ecr:DescribeRepositories':
      'Tu token no tiene permisos para listar repositorios de Amazon ECR en esta region (ecr:DescribeRepositories).',
    'ecr:CreateRepository':
      'Tu token no tiene permisos para crear nuevos repositorios en Amazon ECR (ecr:CreateRepository).',
    'ecr:DescribeImages':
      'Tu token no tiene permisos para listar las imagenes de este repositorio ECR (ecr:DescribeImages).',
    'ecr:GetAuthorizationToken':
      'Tu token no tiene permisos para autenticar Docker contra Amazon ECR (ecr:GetAuthorizationToken).',
    'ecr:GetLifecyclePolicy':
      'Tu token no tiene permisos para consultar la politica de ciclo de vida (Lifecycle) de este repositorio (ecr:GetLifecyclePolicy).',
    'ecr:PutLifecyclePolicy':
      'Tu token no tiene permisos para guardar o modificar politicas de Lifecycle en este repositorio (ecr:PutLifecyclePolicy).',
    'ecr:GetLifecyclePolicyPreview':
      'Tu token no tiene permisos para ver la simulacion de impacto de Lifecycle (ecr:GetLifecyclePolicyPreview).',
    'ecr:StartLifecyclePolicyPreview':
      'Tu token no tiene permisos para iniciar una simulacion de impacto de Lifecycle en ECR (ecr:StartLifecyclePolicyPreview).'
  }

  if (descriptions[permission]) {
    return descriptions[permission]
  }

  return `Tu token no tiene permisos suficientes en AWS para realizar esta accion (${permission}).`
}

export function toFailureResponse<T>(
  error: unknown,
  actionPermissionHint?: string
): ApiResponse<T> {
  const translated = translateAwsOrDockerError(error, actionPermissionHint)
  return {
    success: false,
    error: translated.message,
    errorCode: translated.errorCode,
    isExpiredToken: translated.isExpiredToken,
    isAccessDenied: translated.isAccessDenied
  }
}

