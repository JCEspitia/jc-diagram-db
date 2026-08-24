# Generar el instalador de DiagramDB para Windows

Esta guía genera los instaladores de escritorio `.exe` (NSIS) y `.msi` desde Windows. El equipo
que recibe el instalador no necesita Node.js, Rust ni acceso a la versión web.

> El build debe ejecutarse en Windows. Si se ejecuta `npm run desktop:build` dentro de WSL,
> Tauri compila para Linux y no genera instaladores Windows.

## 1. Copiar el proyecto desde WSL

Aunque PowerShell puede acceder a `\\wsl.localhost`, varias herramientas de Rust, npm, WiX y
NSIS no funcionan correctamente desde rutas UNC. Se recomienda compilar desde una copia ubicada
en el filesystem de Windows.

Consulta el nombre exacto de la distribución:

```powershell
wsl --list --verbose
```

Copia el proyecto, ajustando `Ubuntu` si la distribución tiene otro nombre:

```powershell
$source = "\\wsl.localhost\Ubuntu\home\camiloespitia\proyectos\tools\jc-diagram-db"
$destination = "C:\Projects\jc-diagram-db"

New-Item -ItemType Directory -Force -Path $destination

robocopy $source $destination /E `
  /XD node_modules dist .angular target `
  /R:2 /W:1
```

Para sincronizaciones posteriores se puede usar `/MIR`, teniendo presente que elimina en el
destino los archivos que ya no existan en el origen:

```powershell
robocopy $source $destination /MIR `
  /XD node_modules dist .angular target `
  /R:2 /W:1
```

## 2. Instalar Node.js y Rust

Instala Node.js LTS si todavía no está disponible. Luego instala Rust mediante `rustup`:

```powershell
winget install --id Rustlang.Rustup
```

Cierra y abre una terminal nueva. Selecciona el toolchain MSVC y comprueba la instalación:

```powershell
rustup default stable-msvc
rustc -vV
cargo --version
node --version
npm --version
```

`rustc -vV` debe mostrar:

```text
host: x86_64-pc-windows-msvc
```

## 3. Instalar Microsoft C++ Build Tools

Rust MSVC necesita el compilador y linker de Visual C++. VS Code no incluye estas herramientas.

Instalación automática desde PowerShell como administrador:

```powershell
winget install `
  --id Microsoft.VisualStudio.2022.BuildTools `
  --exact `
  --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

También puede instalarse desde Visual Studio Installer seleccionando:

- `Desktop development with C++`;
- MSVC v143 C++ Build Tools;
- Windows 10 u 11 SDK;
- C++ CMake tools for Windows.

Después de instalar, abre `Developer PowerShell for VS 2022` y verifica:

```powershell
where.exe link
where.exe cl
link.exe /?
```

Si se utiliza una terminal PowerShell convencional, puede cargarse el entorno de Build Tools:

```powershell
Import-Module "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"

Enter-VsDevShell `
  -VsInstallPath "C:\Program Files\Microsoft Visual Studio\2022\BuildTools" `
  -SkipAutomaticLocation
```

## 4. Habilitar VBSCRIPT para MSI

La generación del MSI puede requerir la característica opcional VBSCRIPT:

1. Abre Configuración de Windows.
2. Entra a Aplicaciones → Características opcionales → Más características de Windows.
3. Habilita VBSCRIPT.
4. Reinicia Windows si lo solicita.

Este paso no suele ser necesario cuando solo se genera el instalador NSIS `.exe`.

## 5. Instalar dependencias y compilar

Desde `Developer PowerShell for VS 2022`:

```powershell
cd C:\Projects\jc-diagram-db
npm install
npm run desktop:build
```

El proceso ejecuta el build Angular para escritorio, compila el backend Rust y empaqueta ambos
instaladores.

Los resultados quedan en:

```text
src-tauri\target\release\bundle\nsis\*.exe
src-tauri\target\release\bundle\msi\*.msi
```

La configuración incorpora el instalador offline de WebView2. El equipo destino puede instalar
DiagramDB sin Internet, a cambio de incrementar el paquete aproximadamente 127 MB.

## Desarrollo de escritorio

Para abrir DiagramDB como aplicación Tauri con recarga durante el desarrollo:

```powershell
npm run desktop:dev
```

## Solución de problemas

### `linker link.exe not found`

Falta Microsoft C++ Build Tools o la terminal no cargó su entorno. Abre `Developer PowerShell for
VS 2022` y confirma que `where.exe link` devuelve una ruta. Los errores posteriores de `serde`,
`quote`, `parking_lot_core`, `proc-macro2` y otras dependencias son consecuencias del mismo linker
ausente.

### `UNC paths are not supported`

El proyecto se está compilando directamente desde `\\wsl.localhost`. Copia el proyecto a
`C:\Projects\jc-diagram-db` y repite el build.

### `failed to run light.exe`

Comprueba que VBSCRIPT esté habilitado y vuelve a abrir la terminal. Este error corresponde al
empaquetado MSI con WiX.

### Advertencia de Microsoft SmartScreen

Los instaladores sin firma pueden mostrar una advertencia. Para distribución corporativa se
recomienda firmar el `.exe` y el `.msi` o solicitar a TI que los distribuya mediante sus
herramientas administradas.
