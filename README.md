# Panel web de Escola

Página estática (HTML, JS y CSS, sin build ni dependencias) para que el padre administre en remoto lo mismo
que hoy hace en el Panell de pares de cada PC, desde el móvil o desde donde sea. No contiene ningún dato:
todo lo lee y escribe en el repositorio privado `davidherrerosd-ai/escola-dades` con el token que se pega al
entrar, que se queda en el `localStorage` de ese navegador.

Implementa el contrato de `docs/superpowers/specs/2026-09-27-panell-admin-complet-design.md` §1 y §3.

## Ficheros

Repartido en módulos pequeños con ES modules nativos (import/export), sin bundler:

- `index.html`, `style.css` — página y estilos (móvil primero, 360 px sin scroll horizontal; claro/oscuro
  automático según el sistema).
- `util.js` — helpers compartidos: `h()` para crear elementos sin pasar nunca por `innerHTML` con datos del
  repositorio, `localStorage`, base64, formato de fechas y el botón de confirmación en dos pasos.
- `api.js` — capa de acceso a la API Contents de GitHub (o al servidor falso de `dev-sync-server.mjs`):
  sesión/token, `readJson`, y `putControl` (guarda con reintento automático si el `sha` ya no vale).
- `child.js` — la tarjeta de cada hijo: resumen (como antes) y las secciones de edición remota.
- `global.js` — la tarjeta de configuración general, común a los dos hijos (`control/_global.json`).
- `app.js` — arranque: login, `refresh()` y montaje de las tarjetas.

## Qué hace

Por cada hijo, además del resumen de siempre (minutos, tesoro por isla, errores):

- **Ajusta**: lo que ya había (ritmo, plan del día, minutos diarios, islas activas, dificultad por región)
  más lo nuevo: **concentración** (los 4 interruptores del modo concentración), **premios reales por
  semana**, **premios de fita del tesoro** (texto al 25/50/75/100 % de cada isla) y **extensión de mates**
  (múltiples, divisores y divisibilidad).
- **Premis demanats**: lista de peticiones de premio real de las últimas 8 semanas; «Lliurat» y «Cancel·la»
  (con confirmación; cancelar devuelve las monedas).
- **Monedes**: regalar o quitar monedas con un motivo opcional (de -1000 a 1000, sin ser cero). Los regalos
  antiguos (`gifts`) se siguen mostrando en el historial junto con los movimientos nuevos.
- **Missatge**: enviar un mensaje corto (1-280 caracteres) que verá en el Pla del dia; se indica si ya lo ha
  leído (`status.messages[].readAt`).
- **Expedicions**: volver a explorar una isla (con confirmación), como el botón del panel de padres local.

Configuración general (una sola tarjeta, vale para los dos hijos, `control/_global.json`):

- **Premis reals**: crear, editar (título, coste, icono), activar/desactivar y borrar.
- **Objectiu familiar**: días por semana y texto del premio.
- **So**: efectos de sonido y voz.

Las acciones (`coins`, `rewardStatus`, `message`, `relaunchExploration`, `topic` y `topicStop`) se encolan en
`control/<id>.json` → `actions[]`, cada una con un id único; el PC las aplica una sola vez y las marca en
`status.actionsApplied`. `topic` asigna el entrenamiento de una norma (spec
`docs/superpowers/specs/2026-09-28-refuerzo-tematico-design.md`) y `topicStop` lo acaba; la sección
«Entrenament» solo aparece si el `status` del PC trae el campo `topic` (build 6 o posterior). El panel
muestra «pendent» o «aplicat» según si el PC ya la ha recogido. Al desar
**siempre** se conservan la cola `actions`, los `gifts` y los campos de ajustes que aún no ha aplicado el PC
(aunque el guardado sea por otro motivo, como un simple regalo de monedas).

Si un PC todavía tiene una build antigua (su `status/<id>.json` no trae los campos nuevos), la tarjeta de ese
hijo lo dice («Actualitza l'app d'aquest ordinador…») y solo deja usar los ajustos de siempre; no rompe nada.

Conflictos: cada guardado usa el `sha` de la última lectura; si GitHub responde 409/422 porque alguien más
guardó antes, el panel relee el fichero y reintenta una sola vez fusionando sobre el contenido fresco.

## Publicarlo en GitHub Pages

El repo de la app es privado y Pages en un repo privado necesita un plan de pago, así que el panel va en
un repo público aparte, `escola-panel`, que solo contiene esta carpeta. Es seguro que sea público:
no lleva nombres, datos ni tokens.

1. Crear en GitHub el repo público `davidherrerosd-ai/escola-panel`, vacío.
2. Desde la raíz del repo de la app, copiar esta carpeta a un clon del repo nuevo y publicar:

   ```powershell
   git clone https://github.com/davidherrerosd-ai/escola-panel.git C:\temp\escola-panel
   robocopy web\panel C:\temp\escola-panel /MIR /XD .git
   cd C:\temp\escola-panel
   git add -A
   git commit -m "Panell web"
   git push
   ```

3. En `escola-panel`: Settings → Pages → Source: *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
4. Al cabo de un minuto está en `https://davidherrerosd-ai.github.io/escola-panel/`.

Para actualizarlo tras cambiar algo en `web/panel`, repetir el paso 2 (robocopy, commit, push).

## Token

Al entrar pide un token y el repositorio. Sirve el mismo token de grano fino que usan las apps
(`Contents: Read and write` solo sobre `escola-dades`), o uno propio con los mismos permisos. El botón
«Connexió» → «Oblida el token» lo borra de ese navegador. En un ordenador que no sea tuyo, bórralo al
acabar.

## Probarlo en local

```bash
pnpm install --prefer-offline   # solo la primera vez, para tener node_modules
node scripts/dev-sync-server.mjs dist/sync-data --port 47811
```

y abrir `http://127.0.0.1:47811/panel/?api=http://127.0.0.1:47811` con cualquier token (salvo `bad`, que
simula un token caducado). El servidor falso guarda los ficheros en `dist/sync-data`; para partir de cero
en cada prueba, borra `dist/sync-data/control` (o toda la carpeta) antes de arrancarlo — los `status/*.json`
los tienes que crear a mano (o copiarlos de una prueba anterior) con la forma de `ChildStatus` más los campos
nuevos del §1.3 de la spec (`focus`, `rewardsPerWeek`, `milestonePrizes`, `extension`, `coins`, `xp`, `level`,
`rewardRequests`, `messages`, `actionsApplied`, `explorations`, `settings`).
