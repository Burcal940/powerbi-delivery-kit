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

Una vez instalado, la **[guía de uso](#3-guía-de-uso-de-cero-a-un-informe)** explica paso a paso
cómo hacer un informe.

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

## 3. Guía de uso: de cero a un informe

Todo se hace escribiendo en el chat de Claude Code (con el kit clonado: `/comando`; como plugin:
`/powerbi-delivery-kit:comando`).

> **La forma fácil: un solo comando.**
> ```
> /dashboard ventas-mensuales
> ```
> Mira en qué fase está el proyecto, hace el siguiente paso y **se detiene cada vez que necesita
> algo de ti**:
> - que compartas el material,
> - que respondas las preguntas,
> - que apruebes la especificación,
> - que apruebes el mockup,
> - que guardes el PBIP.
>
> Cuando lo hagas, vuelve a escribir `/dashboard ventas-mensuales` y sigue desde ahí. Sirve para
> proyectos nuevos y para retomar uno a medias.
>
> Los pasos de abajo son lo que hace `/dashboard` por dentro. También puedes correrlos uno por uno.

Resumen:

| Paso | Quién | Comando / acción | Resultado |
|---|---|---|---|
| 1 | Claude | `/new-project <nombre>` | Carpeta del proyecto creada |
| 2 | **Tú** | Dejas diseño en `intake/` y datos en `data/` | — |
| 3 | Claude → **Tú** | Lee todo y te hace **una** ronda de preguntas | `state.json` (la especificación) para aprobar |
| 4 | Claude → **Tú** | `/build-mockup <nombre>` | Mockup HTML para aprobar |
| 5 | **Tú** | Guardas un PBIP vacío desde Power BI Desktop | Archivos `.pbip` en el proyecto |
| 6 | Claude | `/build-pbi <nombre>` | Modelo y páginas de Power BI, validados y con capturas |
| 7 | Claude | `/build-html <nombre>` | HTML interactivo con los datos reales |
| 8 | Claude | Conciliación + revisión del modelo | Números verificados contra la fuente |

### Paso 1 · Crear el proyecto
```
/new-project ventas-mensuales
```
Crea `projects/ventas-mensuales/` con: `brief.md` (objetivo), `data-contract.md` (datos),
`state.json` (especificación), `state.md` (estado) y `decisions.md` (bitácora). El nombre se
normaliza a minúsculas con guiones.

### Paso 2 · Compartir lo que tengas (no hace falta todo)
| Qué | Dónde |
|---|---|
| Imagen del dashboard que quieres lograr (**PNG**) | `projects/<nombre>/intake/` |
| HTML / CSS / export de Claude Design (zip descomprimido) / paleta JSON | `projects/<nombre>/intake/` |
| Excel, CSV o JSON con los datos | `projects/<nombre>/data/` |
| Base de datos | Dile a Claude servidor, base y comparte un export del esquema |

Luego escribe algo como: *"Ya dejé el diseño y los datos, sigue."*

### Paso 3 · Responder una sola ronda de preguntas
Claude extrae colores, fuente, tablas, tipos y relaciones solo. Te pregunta únicamente lo que no
puede deducir, por ejemplo:
- Qué significa cada indicador y qué se excluye (*"¿las devoluciones restan de las ventas?"*).
- Si subir es bueno o malo (polaridad).
- Qué representa una fila de los datos (*"una venta", "un partido"*).
- Elementos del diseño que Power BI no puede hacer y con qué reemplazarlos.

Lo que no sepas queda como `TBD — ask:` y no frena el resto. Revisa el `state.json` que te muestra
y apruébalo (*"aprobado"*).

### Paso 4 · Mockup
```
/build-mockup ventas-mensuales
```
Genera `mockups/<página>.html`: ábrelo en el navegador. Aquí es donde más rápido se ajusta:
*"cambia el color de la gráfica de barras"*, *"pon el KPI de margen primero"*, *"el título debe
decir…"*. Cuando te guste: *"aprobado"*.

### Paso 5 · Tu único paso manual en Power BI
1. Si te importa el formato de números: *Archivo → Opciones → Archivo actual → Configuración
   regional* (p. ej. Español (Colombia)).
2. Informe en blanco → *Archivo → Guardar como → Power BI Project (.pbip)* → dentro de
   `projects/<nombre>/`.
3. Déjalo abierto y **no guardes desde Desktop** mientras Claude trabaja.

### Paso 6 · Construir en Power BI
```
/build-pbi ventas-mensuales
```
Claude crea el modelo (tablas, relaciones, calendario, medidas), genera las páginas igual al mockup,
valida, recarga Desktop, toma capturas y las corrige. Si Desktop avisa de cambios sin guardar,
ciérralo **sin guardar** y vuelve a abrir el `.pbip`.

### Paso 7 · HTML interactivo
```
/build-html ventas-mensuales
```
Genera `html/<página>.html`: se abre en cualquier navegador sin instalar nada, con filtros,
filtro cruzado al hacer clic y tooltips. Sus números deben ser iguales a los de Power BI.
⚠️ Contiene los datos reales: no lo compartas sin revisar quién puede verlos.

### Paso 8 · Cerrar
Claude concilia los totales contra la fuente (`docs/validations/`), revisa el modelo con el agente
`model-reviewer` y actualiza `state.md` y `decisions.md`. Publicar en el servicio de Power BI solo si
lo pides.

### En cualquier momento
| Quieres… | Escribe |
|---|---|
| Seguir con el siguiente paso | `/dashboard ventas-mensuales` |
| Saber en qué va el proyecto | `/status ventas-mensuales` (o `/status` para todos) |
| Cambiar algo del informe | *"Cambia X en el state.json y actualiza el mockup, Power BI y el HTML"* |
| Usar datos nuevos (otro mes) | Reemplaza el archivo en `data/`, actualiza en Power BI y corre `/build-html` |
| Preparar otro computador | `/setup` |

**Regla de oro:** todo cambio pasa por `state.json`; nunca edites a mano en Desktop una página que
el kit genera, porque se sobrescribe en la próxima construcción.

Guía extendida: [`PLAYBOOK.md`](PLAYBOOK.md). Reglas que sigue Claude: [`CLAUDE.md`](CLAUDE.md).

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
