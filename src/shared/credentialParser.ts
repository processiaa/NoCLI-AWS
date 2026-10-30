import type { AwsCredentialsInput } from './types'

export interface ParsedCredentialsResult {
  credentials: AwsCredentialsInput
  detectedFormat: 'PowerShell' | 'Bash / Linux' | 'CMD' | 'AWS Credentials (INI)' | 'AWS STS JSON'
}

/**
 * Extrae Access Key, Secret Key, Session Token y Region desde cualquier bloque pegado:
 * - PowerShell ($env:AWS_ACCESS_KEY_ID="..." o SetEnvironmentVariable)
 * - Bash / Zsh (export AWS_ACCESS_KEY_ID="...")
 * - Windows CMD (SET AWS_ACCESS_KEY_ID=...)
 * - Archivo INI (~/.aws/credentials -> aws_access_key_id = ...)
 * - JSON devuelto por AWS STS (Credentials.AccessKeyId / AccessKeyId)
 */
export function parseRawCredentials(
  rawText: string,
  defaultRegion = 'us-east-1'
): ParsedCredentialsResult | null {
  if (!rawText || !rawText.trim()) {
    return null
  }

  const trimmed = rawText.trim()

  // 1. Intentar detectar formato JSON (por ejemplo salida de aws sts assume-role o get-session-token)
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const source = parsed.Credentials || parsed.credentials || parsed
      const accessKeyId = source.AccessKeyId || source.accessKeyId || source.AWS_ACCESS_KEY_ID
      const secretAccessKey =
        source.SecretAccessKey || source.secretAccessKey || source.AWS_SECRET_ACCESS_KEY
      const sessionToken =
        source.SessionToken || source.sessionToken || source.Token || source.AWS_SESSION_TOKEN
      const expiration = source.Expiration || source.expiration
      const region = parsed.region || parsed.Region || defaultRegion

      if (typeof accessKeyId === 'string' && typeof secretAccessKey === 'string') {
        return {
          detectedFormat: 'AWS STS JSON',
          credentials: {
            accessKeyId: accessKeyId.trim(),
            secretAccessKey: secretAccessKey.trim(),
            sessionToken: typeof sessionToken === 'string' ? sessionToken.trim() : undefined,
            region: typeof region === 'string' && region.trim() ? region.trim() : defaultRegion,
            expiration: typeof expiration === 'string' ? expiration : undefined
          }
        }
      }
    } catch {
      // Si el JSON esta incompleto o es otro texto con llaves, continuar con regex
    }
  }

  // Normalizar posibles cortes de linea dentro de comillas cuando se copia desde una ventana estrecha de PowerShell
  const normalized = trimmed.replace(/`\r?\n/g, '')

  // Patrones flexibles para variables de entorno, INI y SetEnvironmentVariable
  const accessKeyMatch =
    normalized.match(
      /AWS_ACCESS_KEY_ID["']?\s*(?:[=:,])\s*["']?([A-Z0-9]{16,128})["']?/i
    ) || normalized.match(/"AccessKeyId"\s*:\s*"([A-Z0-9]{16,128})"/i)

  const secretKeyMatch =
    normalized.match(
      /AWS_SECRET_ACCESS_KEY["']?\s*(?:[=:,])\s*["']?([A-Za-z0-9/+=_-]{20,128})["']?/i
    ) || normalized.match(/"SecretAccessKey"\s*:\s*"([A-Za-z0-9/+=_-]{20,128})"/i)

  // Session token puede ser muy largo (300 a +2000 caracteres)
  const sessionTokenQuotedMatch = normalized.match(
    /AWS_(?:SESSION|SECURITY)_TOKEN["']?\s*(?:[=:,])\s*["']([A-Za-z0-9/+=_\-\s]+?)["']/i
  )
  const sessionTokenUnquotedMatch = normalized.match(
    /AWS_(?:SESSION|SECURITY)_TOKEN\s*[=:]\s*([A-Za-z0-9/+=_-]+)/i
  )

  const regionMatch =
    normalized.match(
      /AWS_(?:DEFAULT_)?REGION["']?\s*(?:[=:,])\s*["']?([a-z]{2}-[a-z0-9-]+-\d+)["']?/i
    ) || normalized.match(/^\s*region\s*=\s*["']?([a-z]{2}-[a-z0-9-]+-\d+)["']?/im)

  if (!accessKeyMatch || !secretKeyMatch) {
    return null
  }

  let sessionToken: string | undefined
  if (sessionTokenQuotedMatch && sessionTokenQuotedMatch[1]) {
    // Limpiar saltos de linea accidentales dentro del token entre comillas
    sessionToken = sessionTokenQuotedMatch[1].replace(/\s+/g, '')
  } else if (sessionTokenUnquotedMatch && sessionTokenUnquotedMatch[1]) {
    sessionToken = sessionTokenUnquotedMatch[1].trim()
  }

  let detectedFormat: ParsedCredentialsResult['detectedFormat'] = 'AWS Credentials (INI)'
  if (/\$env:|SetEnvironmentVariable/i.test(normalized)) {
    detectedFormat = 'PowerShell'
  } else if (/^\s*export\s+/im.test(normalized)) {
    detectedFormat = 'Bash / Linux'
  } else if (/^\s*set\s+AWS_/im.test(normalized)) {
    detectedFormat = 'CMD'
  } else if (/"AccessKeyId"/i.test(normalized)) {
    detectedFormat = 'AWS STS JSON'
  }

  return {
    detectedFormat,
    credentials: {
      accessKeyId: accessKeyMatch[1].trim(),
      secretAccessKey: secretKeyMatch[1].trim(),
      sessionToken: sessionToken || undefined,
      region: regionMatch ? regionMatch[1].trim().toLowerCase() : defaultRegion
    }
  }
}

/**
 * Convierte entradas como:
 * - "s3://mi-bucket/reportes/2026/"
 * - "s3://mi-bucket"
 * - "mi-bucket/carpeta/archivo"
 * en { bucket, prefix } normalizados.
 */
export function parseS3Uri(rawInput: string): { bucket: string; prefix: string } | null {
  if (!rawInput || !rawInput.trim()) {
    return null
  }

  let cleaned = rawInput.trim()

  if (/^s3:\/\//i.test(cleaned)) {
    cleaned = cleaned.replace(/^s3:\/\//i, '')
  } else if (/^https?:\/\//i.test(cleaned)) {
    try {
      const url = new URL(cleaned)
      // Soportar https://mi-bucket.s3.us-east-1.amazonaws.com/carpeta/
      const virtualHostMatch = url.hostname.match(/^([^.]+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i)
      if (virtualHostMatch) {
        const bucket = virtualHostMatch[1]
        const rawPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
        const prefix = rawPath ? (rawPath.endsWith('/') ? rawPath : `${rawPath}/`) : ''
        return { bucket, prefix }
      }
    } catch {
      return null
    }
  }

  cleaned = cleaned.replace(/^\/+/, '')
  if (!cleaned) {
    return null
  }

  const slashIdx = cleaned.indexOf('/')
  if (slashIdx === -1) {
    const bucket = cleaned.trim()
    if (!isValidBucketName(bucket)) return null
    return { bucket, prefix: '' }
  }

  const bucket = cleaned.slice(0, slashIdx).trim()
  if (!isValidBucketName(bucket)) return null

  const rest = cleaned.slice(slashIdx + 1).replace(/^\/+/, '')
  if (!rest) {
    return { bucket, prefix: '' }
  }

  const prefix = rest.endsWith('/') ? rest : `${rest}/`
  return { bucket, prefix }
}

function isValidBucketName(name: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(name)
}

