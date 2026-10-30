# NoCLI AWS (Espanol)

[Read documentation in English](README.md)

**NoCLI AWS** es una aplicacion de escritorio Open Source disenada para gestionar servicios de AWS de forma visual, sin depender de acceso a la consola web (`aws.amazon.com`) ni requerir `aws-cli` preinstalado.

En muchos entornos corporativos, los equipos de seguridad bloquean la consola web y entregan unicamente credenciales programaticas temporales (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_SESSION_TOKEN`). NoCLI AWS elimina la friccion de usar PowerShell o Bash permitiendo pegar el bloque de credenciales tal como lo entregan para explorar Amazon S3 y operar imagenes Docker con Amazon ECR en segundos.

---

## Caracteristicas Principales

### 1. Autenticacion Smart Paste y Control de Sesion
- **Pegado inteligente multiformato**: Acepta bloques directos de PowerShell (`$env:AWS_ACCESS_KEY_ID=...`), Bash (`export ...`), CMD (`set ...`), archivos `.ini` (`~/.aws/credentials`) o respuestas JSON de `aws sts`.
- **Validacion STS en tiempo real**: Confirma las llaves mediante `sts:GetCallerIdentity` mostrando en pantalla el Account ID, el rol o usuario IAM activo y la region.
- **Renovacion de token en caliente**: Detecta errores `ExpiredTokenException` y permite pegar un nuevo token sin cerrar la aplicacion ni perder la ruta S3 o el repositorio ECR actual.
- **Seguridad en memoria RAM + Boveda nativa opcional**: Por defecto las credenciales viven unicamente en memoria RAM y nunca sobreescriben `~/.aws/credentials`. Opcionalmente permite guardar perfiles cifrados con `Electron safeStorage` (Windows DPAPI / macOS Keychain / Linux Secret Service).

### 2. Explorador Visual de Amazon S3
- **Acceso directo a Bucket y Prefijo**: Barra superior para abrir rutas como `s3://mi-bucket-corporativo/reportes/` incluso cuando el rol IAM restringe `s3:ListAllMyBuckets`.
- **Drag and Drop de Escritorio**: Arrastra archivos o carpetas completas desde el explorador del sistema operativo hacia la aplicacion con subida multiparte automatica (`@aws-sdk/lib-storage`) y barra de progreso en vivo.
- **Vista previa sin descarga**: Inspecciona archivos `.json`, `.csv` (formateados como tabla), `.txt`, `.md`, `.log`, `.yaml`, `.xml` e imagenes directamente en memoria.
- **Generador de Presigned URLs**: Crea enlaces temporales firmados con duracion configurable y copiado automatico al portapapeles.

### 3. Gestor de Amazon ECR y Docker Local
- **ECR a pantalla completa con panel Docker deslizable**: El panel de Docker local permanece oculto por defecto en una barra lateral deslizable para no estorbar cuando Docker Desktop esta cerrado, y se despliega suavemente con un clic cuando lo necesitas.
- **Inspector de Lifecycle (Ciclo de Vida de Imagenes)**: Muestra antiguedad en dias, fecha del ultimo pull y clase de almacenamiento (`Standard` o `Archive`) en cada imagen; traduce las reglas JSON de Lifecycle a lenguaje claro, ejecuta simulaciones oficiales de AWS (dry-run) para ver que imagenes expiraran y ofrece plantillas rapidas de retencion.
- **Autenticacion Docker a 1 clic**: Obtiene el token de autorizacion de ECR con AWS SDK v3 y ejecuta el login contra el daemon local de Docker de forma transparente.
- **Asistente visual de Push y Pull**: Etiqueta y sube imagenes locales hacia ECR o descarga imagenes de ECR a tu PC con progreso por capas.
- **Generador de comandos PowerShell (Respaldo)**: Genera comandos listos para copiar tanto en **Modo Directo (sin necesitar AWS CLI instalado)** como en **Modo Estandar con AWS CLI**.

### 4. Traduccion Clara de Errores de Permisos IAM
- Convierte respuestas `AccessDenied` de AWS en mensajes comprensibles indicando la accion IAM exacta restringida en el token (`s3:PutObject`, `s3:DeleteObject`, `ecr:GetAuthorizationToken`, etc.).

---

## Arquitectura

Por seguridad y rendimiento, la interfaz grafica (Renderer) nunca se comunica directamente con AWS ni con Docker. Todas las operaciones pasan por el Proceso Principal de Electron a traves de un puente IPC fuertemente tipado.

```text
+-------------------------------------------------------------------+
|                   APLICACION NOCLI AWS DESKTOP                    |
|                                                                   |
|  +-----------------------+             +-----------------------+  |
|  |   RENDERER (React)    |  Puente IPC | PROCESO MAIN (Node)   |  |
|  |   React + Tailwind    | <=========> | Electron + AWS SDK    |  |
|  |                       |  Preload    |                       |  |
|  | - Vista Smart Paste   |             | - Sesiones en RAM     |  |
|  | - Explorador S3       |             | - Streams Multipart   |  |
|  | - Gestor ECR / Docker |             | - API Dockerode       |  |
|  +-----------------------+             +-----------+-----------+  |
+----------------------------------------------------|--------------+
                                                     |
                    +--------------------------------+--------------------+
                    |                                                     |
                    v (HTTPS - AWS SDK v3)                                v (Named Pipe / Unix Socket)
      +---------------------------+                         +---------------------------+
      |         AWS CLOUD         |                         |       DOCKER LOCAL        |
      | - STS (GetCallerIdentity) |                         | - Docker Engine Daemon    |
      | - S3 (Buckets y Objetos)  |                         |   (//./pipe/docker_engine)|
      | - ECR (Repos y AuthToken) |                         |   (/var/run/docker.sock)  |
      +---------------------------+                         +---------------------------+
```

---

## Instalacion y Desarrollo

### Requisitos
- **Node.js** 18 o superior
- **npm** 9 o superior
- **Docker Desktop / Docker Engine** (opcional; solo necesario para hacer Push/Pull local automatico)
- **No requiere AWS CLI preinstalado**

### Ejecucion Local

```powershell
# 1. Clonar el repositorio
git clone https://github.com/processiaa/NoCLI-AWS.git
cd NoCLI-AWS

# 2. Instalar dependencias
npm install

# 3. Abrir la aplicacion en modo desarrollo
npm run dev
```

### Verificacion y Empaquetado de Instaladores

```powershell
# Validar tipos de TypeScript (Main, Preload y Renderer)
npm run typecheck

# Compilar bundle de produccion en ./out
npm run build

# Generar instaladores nativos en ./dist
npm run win     # Windows (.exe NSIS)
npm run mac     # macOS (.dmg)
npm run linux   # Linux (.AppImage)
```

---

## Hoja de Ruta (Roadmap)

NoCLI AWS inicia con **Amazon S3** y **Amazon ECR**, sobre una arquitectura modular preparada para sumar nuevos servicios:
- [x] Parser Smart Paste STS y gestor de sesiones
- [x] Explorador de archivos Amazon S3 (Multipart Upload, Vista Previa, Presigned URLs)
- [x] Gestor de imagenes Amazon ECR y Docker local
- [ ] Visor de logs para Amazon CloudWatch Logs
- [ ] Inspector para AWS Secrets Manager y SSM Parameter Store
- [ ] Visor y envio de mensajes para Amazon SQS
- [ ] Explorador de tablas para Amazon DynamoDB

---

## Contribucion y Seguridad

- Revisa [CONTRIBUTING.md](CONTRIBUTING.md) para conocer como levantar el entorno y agregar nuevos modulos de AWS.
- Revisa [SECURITY.md](SECURITY.md) para conocer el modelo de seguridad de credenciales y como reportar vulnerabilidades.
- Consulta nuestro [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## Licencia

Distribuido bajo la **Licencia MIT**. Consulta el archivo [LICENSE](LICENSE) para mas detalles.

