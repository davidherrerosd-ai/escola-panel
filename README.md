# Panel web de Escola

Página estática (HTML, JS y CSS, sin build ni dependencias) para ver el progreso de los niños y ajustar
su configuración desde cualquier sitio, también desde el móvil. No contiene ningún dato: todo lo lee
del repositorio privado `davidherrerosd-ai/escola-dades` con el token que se pega al entrar, que se
queda en el `localStorage` de ese navegador.

- Lee `status/<id>.json` (lo suben las apps de cada PC al acabar cada actividad y al cerrar).
- Lee y escribe `control/<id>.json`: ritmo por isla, plantilla del plan, minutos diarios, avance
  equilibrado, islas activas y dificultad por región. Cada PC lo aplica la próxima vez que se abre la app.
- Solo guarda los campos que cambian respecto a lo que dice el PC. Si ya había cambios pendientes de
  aplicar, se conservan y se muestra el aviso «Canvis desats…» hasta que el PC los aplica.

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
node scripts/dev-sync-server.mjs dist/sync-data --port 47811
```

y abrir `http://127.0.0.1:47811/panel/?api=http://127.0.0.1:47811` con cualquier token (salvo `bad`, que
simula un token caducado). El servidor falso guarda los ficheros en `dist/sync-data`.
