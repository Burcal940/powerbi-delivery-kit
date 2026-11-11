# Power BI Delivery Kit

Kit para **Claude Code** que convierte lo que compartes (diseño + datos) en un informe de Power BI y
su gemelo en HTML, siempre desde una misma especificación (`state.json`):

```
Diseño (PNG, HTML, CSS, paleta) ─┐                       ┌─► Mockup HTML
                                 ├─► state.json (spec) ──┼─► Power BI (modelo TMDL + páginas PBIR)
Datos (Excel, CSV, JSON, BD) ────┘                       └─► HTML interactivo con los datos reales
```

Hay dos formas de usarlo:

| Forma | Para qué | Sección |
|---|---|---|
| **Clonar el repositorio** | Trabajar tus proyectos dentro de este kit (en este u otro computador) | [1](#1-usarlo-en-otro-computador-clonando-el-repositorio) |
| **Instalarlo como plugin** | Tener los comandos en *cualquier* carpeta o repositorio, sin copiar nada | [2](#2-usarlo-como-plugin) |

---

## 0. Requisitos (una vez por computador)

| Herramienta | Instalar | Comprobar |
|---|---|---|
| VS Code + extensión **Claude Code** | Marketplace de VS Code | Panel de Claude abierto |
| **Git** | `winget install Git.Git` | `git --version` |
| **Node.js 20+** | `winget install OpenJS.NodeJS.LTS` | `node --version` |
| **GitHub CLI** (si el repositorio es privado) | `winget install GitHub.cli` ¹ | `gh --version` |
| **Power BI Desktop** | Microsoft Store | Abre normalmente |
| CLI de informes de Power BI | `npm install -g @microsoft/powerbi-report-authoring-cli@latest` | `powerbi-report-author --version` |
| Microsoft Edge | Viene con Windows (se usa para capturas) | — |

> **Reinicia VS Code después de instalar.** Si una herramienta está instalada pero la terminal dice
> que no existe, es porque VS Code se abrió antes de instalarla.
>
> ¹ Si `winget` pide permisos de administrador y no los tienes, descarga el `.zip` de
> [GitHub CLI releases](https://github.com/cli/cli/releases) (`gh_<versión>_windows_amd64.zip`),
> descomprímelo en `%LOCALAPPDATA%\Programs\gh` y agrega `…\gh\bin` al PATH de tu usuario.

**Iniciar sesión en GitHub** (necesario si el repositorio es privado):

```
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
```
Muestra un código de 8 caracteres: ábrelo en **https://github.com/login/device**, pégalo y autoriza.
El código no llega por correo; aparece en la terminal.

---

## 1. Usarlo en otro computador (clonando el repositorio)

1. **Clona** y abre la carpeta en VS Code:
   ```
   git clone https://github.com/<cuenta>/powerbi-delivery-kit
   ```
   Las habilidades, comandos, el agente revisor y el MCP de Power BI ya vienen en `.claude/` y
   `.mcp.json`; no se instala nada más en Claude.
2. **Prepara el equipo** en el chat de Claude:
   ```
   /setup
   ```
   Revisa qué herramientas faltan (instala solo con tu OK), comprueba el MCP de Power BI y apunta el
   parámetro `SourcePath` de cada proyecto a la carpeta `data/` de *este* computador.
3. **Proyectos.** `projects/` no viaja con el kit (cada proyecto es un repositorio propio, con datos
   del cliente). Clona o copia cada proyecto en `projects/<nombre>/` y copia sus datos reales en
   `projects/<nombre>/data/` — los datos nunca se suben a git.
4. **MCP de Power BI**: la primera vez acepta su licencia (variable `PBI_MODELING_MCP_ACCEPT_EULA=true`
   o la herramienta *accept EULA* del MCP) y reinicia Claude Code.
5. **Formato de números**: en Power BI Desktop, *Archivo → Opciones → Archivo actual → Configuración
   regional* debe coincidir con el `locale` del proyecto (p. ej. Español (Colombia) para `es-CO`).

---

## 2. Usarlo como plugin

El plugin lleva todo el kit (habilidades, comandos, agente revisor y MCP) y funciona en cualquier
carpeta. **No lo instales dentro de este mismo repositorio**: aquí ya se cargan desde `.claude/` y
quedarían duplicados.

**Instalar** (en el chat de Claude Code, dentro de la carpeta donde vas a trabajar):
```
/plugin marketplace add <cuenta>/powerbi-delivery-kit
/plugin install powerbi-delivery-kit@powerbi-kit
```
También acepta una ruta local de un clon: `/plugin marketplace add C:\ruta\al\clon`.
Reinicia Claude Code. Los comandos quedan con el prefijo del plugin:
`/powerbi-delivery-kit:new-project`, `/powerbi-delivery-kit:setup`, etc.

**Actualizar** cuando haya una versión nueva:
```
/plugin marketplace update powerbi-kit
/plugin update powerbi-delivery-kit
```

**Publicar una versión nueva** (quien mantiene el kit):
1. Edita solo `.claude/` (nunca `plugins/`, que es generado).
2. `node tools/build-plugin.js --version 0.2.0`
3. Commit y `git push`.

---

## 3. Flujo de trabajo de un proyecto

| Paso | Comando | Qué pasa |
|---|---|---|
| 1 | `/new-project <nombre>` | Crea `projects/<nombre>/`; dejas el diseño en `intake/` y los datos en `data/`; Claude deduce tema, modelo y spec y te hace **una** ronda de preguntas |
| 2 | `/build-mockup <nombre>` | Mockup HTML para aprobar |
| 3 | *(tú)* | Power BI Desktop → *Guardar como → Power BI Project (.pbip)* en `projects/<nombre>/` |
| 4 | `/build-pbi <nombre>` | Modelo + páginas, validación y capturas |
| 5 | `/build-html <nombre>` | HTML interactivo con los datos reales (mismos números que Power BI) |
| — | `/status <nombre>` | Estado, bloqueos y siguiente paso |

Guía paso a paso para personas: [`PLAYBOOK.md`](PLAYBOOK.md). Reglas para Claude: [`CLAUDE.md`](CLAUDE.md).

---

## 4. Qué nunca se sube

- Datos reales (`projects/*/data/`), el HTML interactivo (`html/`, contiene filas reales) y el perfil
  de datos (`intake/generated/profile.json`, tiene valores de ejemplo).
- Archivos locales de Power BI: `cache.abf`, `.pbi/localSettings.json`, `unappliedChanges.json`.
- Credenciales, nombres, correos o rutas personales. Los commits usan el correo privado de GitHub
  (`…@users.noreply.github.com`).

## 5. Problemas comunes

| Síntoma | Solución |
|---|---|
| `git`, `node` o `gh` "no se reconoce" | Reinicia VS Code (PATH desactualizado) |
| `winget` termina con código 1602 | Se canceló el permiso de administrador → usa la versión portable (ver requisitos) |
| El MCP `powerbi-modeling-mcp` no conecta | Acepta su licencia, abre Power BI Desktop con el `.pbip` y reinicia Claude Code; mientras tanto el modelo se edita como TMDL |
| `/plugin marketplace add` no encuentra el repositorio | Es privado: corre `gh auth login` y `gh auth setup-git` |
| Power BI muestra `4,867` en vez de `4.867` | Configuración regional del archivo (paso 1.5) |
| Desktop dice que hay cambios sin guardar | Ciérralo **sin guardar** y vuelve a abrir el `.pbip` |
