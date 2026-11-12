# Playbook — de la idea al mockup y a Power BI

Paso a paso para **cualquier proyecto** (personal o empresarial) y **cualquier fuente de datos**
(Excel, CSV, base de datos, SharePoint, Fabric…). Claude lo sigue con la skill `pbi-delivery`;
este archivo es la versión para personas. 

```
Design system ─┐                        ┌─► Mockup HTML / artefacto
               ├─► state.json (spec) ──►┤
Contrato datos ┘                        └─► Power BI (modelo + páginas)
```

Idea clave: el mockup **no se convierte** a Power BI. Ambos salen del mismo `state.json`.
Cambias el `state.json` → se regeneran el mockup y la página.

**Atajo:** `/dashboard <nombre>` recorre todas las fases de abajo. Detecta en cuál va el proyecto
(`scripts/project-status.js`), hace la siguiente y se detiene cuando necesita que apruebes o
actúes. Después vuelves a escribir el mismo comando y sigue desde ahí.

## Antes de empezar (una vez por máquina)
- Power BI Desktop instalado. Si quieres números tipo `$1,700`: *Opciones → Configuración regional → Inglés (EE. UU.)* **antes** de crear archivos.
- Instala la fuente del design system (o acepta el respaldo Segoe UI).
- Git, Node.js 20+, y en Claude Code el MCP `powerbi-modeling-mcp` (ya configurado en `.mcp.json`).
  `/setup` lo revisa todo (ver "Usar en otro computador" al final).

## Fase 0 · Design system (una vez por cliente)
| Tú | Claude |
|---|---|
| Claude Design con el blurb del cliente + imagen de referencia; exportas la paleta (JSON) y dejas el material en `_scratch/` | Genera `design-systems/<ds>/` (tokens, componentes) y la skill `<cliente>-dashboard-design` con el theme de Power BI y los layouts |

Mensaje: *"Construye el design system del cliente X con lo que está en `_scratch/`."*

## Fase 1–3 · Compartes → la skill deduce → confirmas
`/new-project <nombre>` (o en cualquier repo: *"usa pbi-delivery para un proyecto nuevo"*).

**1. Comparte lo que tengas** (no hace falta todo):
| Qué | Dónde lo dejas | Qué sale automáticamente |
|---|---|---|
| Diseño: HTML/artefacto del mockup, CSS de tokens, carpeta del design system, JSON de paleta o theme | `projects/<nombre>/intake/` | Colores por rol, fuente, tamaños, lienzo, barra lateral, márgenes → **tema de Power BI** |
| Datos: Excel, CSV, JSON | `projects/<nombre>/data/` (no se sube a git) | Tablas de hechos/dimensiones, tipos, llaves, relaciones, calendario → **contrato de datos + consultas M con parámetros** |
| Base de datos | Servidor + base + export del esquema (consulta en `references/intake.md`) | Lo mismo, con parámetros `Server`/`Database` |
| Imagen del dashboard (**PNG**) | `projects/<nombre>/intake/` | Colores **exactos** leídos de los píxeles, ancho de la barra lateral, alto del encabezado y escala a 1920×1080; Claude mira la imagen y arma las páginas igual (KPIs, gráficas, tablas, fuente) |
| Export de Claude Design (zip) | Descomprímelo en `intake/` | Se lee como HTML/CSS |

**2. Un solo comando** (lo corre Claude):
`node .claude/skills/pbi-delivery/scripts/intake.js --project projects/<nombre> --brand "<Marca>"`.
Genera en `intake/generated/`: tokens, theme, plan del modelo, consultas M con parámetros, borrador
del contrato de datos, `state.json` y un **`INTAKE.md`** con lo que falta confirmar. Después Claude
**ajusta las páginas para que queden igual a la imagen o mockup** bloque por bloque.

**3. Tú confirmas en un solo mensaje** solo lo que no se puede deducir: definición y exclusiones
de cada KPI, si subir es bueno o malo, qué es una fila de la tabla de hechos, fechas ambiguas y
cualquier elemento del diseño que Power BI no puede hacer. Lo que falte queda como `TBD` sin frenar el resto.

## Fase 4 · Mockup
`/build-mockup <nombre>` → `mockups/<página>.html`. Iteras aquí colores, orden y textos
(es más rápido que en Power BI). Solo elementos que existen en Power BI; lo que no, queda anotado
en `pbiNotFeasible` con su reemplazo.

## Fase 5 · PBIP vacío (tu único paso manual)
Power BI Desktop → informe en blanco → *Archivo → Guardar como → Power BI Project (.pbip)* →
`projects/<nombre>/`. Mientras Claude trabaja, **no guardes desde Desktop**.

## Fase 6–7 · Power BI
`/build-pbi <nombre>`:
- **Modelo** (como código, `build-model.js`): escribe el TMDL desde el `state.json` — fuente con
  parámetros, tablas en estrella, medidas con su DAX — y `--check` avisa si el modelo y el spec
  se separan. El MCP queda opcional para probar DAX contra el modelo abierto.
- **Páginas** (generador): construye cada página del `state.json` con el theme del cliente,
  valida, recarga Desktop, toma captura y la revisa hasta que queda limpia.

**Cómo entra en Power BI:** Desktop lee la carpeta del PBIP solo al abrir el archivo. Si Claude
cambia el modelo o las páginas con Desktop abierto, no verás nada nuevo hasta que lo reabras.
Claude lo hace con un solo comando:

```
node .claude/skills/pbi-delivery/scripts/pbi-desktop.js --project projects/<nombre> --fresh --screenshot captura.png
```

El comando:
- cierra Desktop **sin guardar** si estaba abierto;
- abre el `.pbip` y espera a que cargue;
- pulsa **Inicio → Actualizar** solo (un modelo que cambió se abre sin datos);
- toma una captura para revisarla contra el mockup.

Tú no tienes que tocar nada. Si algo se traba, el comando se rinde a los 10 minutos (`--timeout`)
y, si se pierde la conexión con Desktop, lo reabre una vez por su cuenta.

Lo que debes saber:
- Si tienes cambios hechos a mano en Desktop, guárdalos antes o se pierden.
- Si aparece una ventana de error en Desktop (TMDL, Power Query), el comando muestra su texto.
- Para ver datos nuevos (un CSV de otro mes) sin reabrir: `pbi-desktop.js --project projects/<nombre> --refresh`.
- No guardes desde Desktop mientras Claude edita archivos.

## Fase 8 · Cerrar
Conciliación automática (`reconcile.js`: cada medida en DAX contra el modelo abierto en Desktop =
lo que calcula el HTML; deja la evidencia en `docs/validations/reconcile-<fecha>.md`), totales vs.
la fuente que tú indiques, `build-model.js --check` sin diferencias, revisión del modelo, commit.
Publicar en el servicio solo cuando lo pidas.

## Fuentes de datos (todas usan el mismo contrato)
| Fuente | Qué le das a Claude | Nota |
|---|---|---|
| Datos de ejemplo | Nada | Se generan del contrato; la página dice "sample data" |
| Excel | Ruta + hojas | Una hoja por tabla lógica |
| CSV | Carpeta | Une todos los archivos (p. ej. un extracto por mes) |
| SQL Server / PostgreSQL / Snowflake… | Servidor, base, vistas | Mejor vistas del equipo de datos |
| SharePoint / OneDrive | URL del archivo | Se actualiza en el servicio sin gateway |
| Fabric Lakehouse | Workspace + lakehouse | Direct Lake |

Cambiar de fuente = cambiar parámetros/consultas; **medidas y páginas no se tocan**.
Datos reales en `projects/<nombre>/data/` (no se sube a git) o fuera del repo. Credenciales nunca en el repo.

## Proyectos empresariales (además)
Dueños y firma de cada KPI · cuenta de servicio para refresco · gateway si la fuente es on-premise ·
DEV/TEST/PROD con parámetros · seguridad por filas (RLS) · etiqueta de sensibilidad ·
descripciones en medidas · revisión por pull request. Checklist: `.claude/skills/pbi-delivery/references/enterprise.md`.

## Para cambios
"Cambia X en el `state.json` y actualiza el mockup y Power BI." Nunca editar a mano en Desktop
una página que el `state.json` controla.

## Usar en otro computador
1. Instala Git y Node.js 20+ (`winget install Git.Git`, `winget install OpenJS.NodeJS.LTS`),
   Power BI Desktop y VS Code con Claude Code. Reinicia VS Code para que vea el PATH nuevo.
2. Clona el kit (`git clone <URL>`) y ábrelo en VS Code. Skills, comandos, agente y MCP vienen
   en `.claude/` y `.mcp.json`; no hay que instalar nada más de Claude.
3. Cada proyecto es un repo propio dentro de `projects/` (el kit lo ignora): clónalo o cópialo en
   `projects/<nombre>/` y copia sus datos reales a `projects/<nombre>/data/` (no viajan por git).
4. Corre `/setup`: revisa herramientas, instala lo que falte con tu OK y apunta el parámetro
   `SourcePath` a la carpeta `data/` de ese computador.

## Usar la skill en otros repos (plugin)
`.claude/` es la fuente. `node tools/build-plugin.js [--version x.y.z]` la empaqueta como plugin
en `plugins/powerbi-delivery-kit/` y publica el catálogo `.claude-plugin/marketplace.json`; nunca edites
`plugins/` a mano. En cualquier repo o computador:
```
/plugin marketplace add <ruta del clon o URL git de este repo>
/plugin install powerbi-delivery-kit@powerbi-kit
```
Reinicia Claude Code; los comandos quedan como `/powerbi-delivery-kit:new-project`, etc. Para actualizar:
sube la versión, vuelve a correr el script, haz commit y en el otro equipo `/plugin update powerbi-delivery-kit`.
No instales el plugin dentro de este repo: aquí ya cargan los de `.claude/` (quedarían duplicados).
