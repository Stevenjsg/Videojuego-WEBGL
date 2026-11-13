# Tareas pendientes

## Evitar que un recurso se pida infinitamente (tráfico)

**Objetivo:** que ningún recurso (modelos, texturas, audio, manifests) se
descargue en bucle ni se pueda forzar a re-descargar, para no generar tráfico
innecesario ni consumo de ancho de banda en Netlify.

### Cliente (juego)

- [ ] **Quitar el cache-buster de la puerta.** `Game.ts` la pide como
      `/models/assets/puerta_interactiva.glb?v=${Date.now()}`: cada carga es una
      URL nueva, la caché no sirve y se bajan ~5 MB siempre. Usar una versión
      fija (o un hash del archivo) en lugar de `Date.now()`.
- [ ] **Una sola petición por recurso.** Revisar que todos los cargadores
      reutilicen la misma promesa por URL (como ya hacen `ChunkedLevel` con las
      texturas y `MusicDirector` con los fragmentos), incluidos `Enemy`,
      `Flashlight`, `Pickup` y los `AudioLoader` de `Game`.
- [ ] **Nada de reintentos sin límite.** Si una carga falla, reintentar como
      máximo N veces con espera creciente (backoff) y después rendirse y
      registrarlo; nunca reintentar en cada frame.
- [ ] **Prefetch una sola vez.** `ChunkedLevel.prefetch` del apartamento debe
      ejecutarse una única vez por sesión aunque se recargue la zona.
- [ ] **Comprobar en DevTools → Network** jugando unos minutos (incluida la
      transición al apartamento y el menú de pausa) que ningún recurso aparece
      repetido.

### Servidor (Netlify)

- [ ] **Caché larga e inmutable** para los archivos con hash en el nombre
      (`tex_<hash>.webp`, assets de Vite): `Cache-Control: public,
      max-age=31536000, immutable`. Ahora `/models/*` tiene solo 3 días.
- [ ] **Nombres con hash también para chunks `.gltf`/`.bin` y la música**, así
      se puede usar caché inmutable sin servir versiones viejas tras regenerar.
- [ ] **Limitar abuso externo** (alguien pidiendo un archivo en bucle):
      valorar reglas de rate limiting de Netlify o una Edge Function que limite
      peticiones por IP a `/models/*` y `/music/*`.
