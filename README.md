# Turbo Circuit

Carrera de karts arcade en 3D para el navegador. Todos los personajes, vehículos, circuitos y
gráficos son originales y se generan con código: no se usan imágenes ni modelos externos.

Incluye un modo local completo y un **multijugador online por salas privadas** con servidor propio.
El modo online es opcional: si no se arranca el servidor, el juego local sigue funcionando igual.

**Tecnologías:** JavaScript, [Three.js](https://threejs.org/), [Vite](https://vite.dev/) y
[Node.js](https://nodejs.org/) + [Socket.IO](https://socket.io/) para las salas online.

---

## 1. Requisitos en Windows

- **Node.js LTS 20.19 o superior** (recomendado 22.12+ o 24). Vite 8 exige
  `^20.19.0 || >=22.12.0`: no uses Node 20.0–20.18, 21.x ni 22.0–22.11.
  Descárgalo de <https://nodejs.org/>. El proyecto lo declara en `engines.node`.
- **npm**, que se instala junto con Node.js.
- Un navegador actualizado con WebGL: Chrome, Edge o Firefox.

Para comprobar que está todo instalado, abre **PowerShell** en la carpeta del proyecto y escribe:

```powershell
node --version
npm --version
```

> **Aviso de PowerShell:** si al escribir `npm` aparece un error sobre "la ejecución de scripts está
> deshabilitada", usa `npm.cmd` en lugar de `npm` (por ejemplo, `npm.cmd install`). Es una restricción
> de seguridad de Windows, no un problema del proyecto. También puedes habilitar scripts para tu
> usuario con `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

---

## 2. Instalar las dependencias

Abre una terminal **en la carpeta del proyecto** (por ejemplo, `C:\Users\TU_USUARIO\...\Turbo Circuit`)
y ejecuta:

```powershell
npm install
```

o, si `npm` está bloqueado:

```powershell
npm.cmd install
```

Esto descarga Three.js, Vite y Socket.IO (cliente y servidor) dentro de la carpeta `node_modules`.
Solo hay que hacerlo la primera vez (o cuando cambien las dependencias). En un servidor de producción,
usa `npm ci` para instalar exactamente las versiones de `package-lock.json`.

---

## 3. Jugar en local

```powershell
npm.cmd run dev
```

Si PowerShell no bloquea los scripts también puedes escribir `npm run dev`. Abre en el navegador la
dirección que muestra la terminal, normalmente:

```text
http://localhost:5173/
```

Para parar el servidor, pulsa `Ctrl + C` en la terminal.

Para probar en un móvil conectado a la misma red Wi-Fi, arranca el servidor aceptando conexiones
externas:

```powershell
npm.cmd run dev -- --host
```

La terminal mostrará una dirección `Network` similar a `http://192.168.1.40:5173/`. Ábrela en el
navegador del móvil. Si no carga, revisa que el firewall de Windows permita Node.js en redes
privadas. Para una prueba realista conviene publicar la build (ver sección 7) y abrirla por `https`.

En el menú puedes elegir **circuito** (seis trazados, desde COSTA TROPICAL hasta ESTACIÓN
ORBITAL), **kart** (Rayo, Centella, Lira o Titán) y **dificultad** antes de empezar. La vista previa
3D del kart se actualiza al instante. Al empezar de cero solo están disponibles **Rayo** y **COSTA
TROPICAL**; el resto se desbloquea en la tienda con monedas. La selección, el saldo y los desbloqueos
se guardan en `localStorage` y se recuperan en la próxima visita; si el navegador los bloquea, el
juego usa valores seguros por defecto.

Cada circuito tiene ahora **desniveles reales** (subidas, bajadas y viaductos), **saltos** con rampas
y **una bifurcación transitable** que se separa de la calzada y vuelve a ella. Los dos caminos son
válidos para jugador e IA, y una vuelta solo cuenta si se cruzan todos los checkpoints, se tome el
ramal o no. El ramal no regala monedas ni recompensas: es una decisión de trazada con su propio
riesgo (más estrecho, con obstáculos o con una placa de turbo).

### Multijugador online en local

El online necesita dos procesos: el servidor de salas y el cliente de Vite. Abre **dos terminales**
en la carpeta del proyecto.

**Terminal 1 — servidor de salas**

```powershell
npm.cmd run server
```

Escucha en `http://localhost:3001`. La comprobación de salud es
<http://localhost:3001/health> y debe devolver `"ok": true`.

**Terminal 2 — cliente**

```powershell
npm.cmd run dev
```

Abre <http://localhost:5173/>, pulsa **Multijugador**, escribe un nombre, crea una sala y comparte
el **código de 5 caracteres**. Los demás jugadores entran con **Unirse** y ese mismo código. El
anfitrión elige circuito y pulsa **Empezar carrera**.

Para probar solo en un ordenador, abre varias pestañas o ventanas. Cada pestaña recibe su propio
identificador de sesión; el nombre visible se guarda en `localStorage` y el identificador de
reconexión en `sessionStorage`, siempre con claves nuevas que no tocan el progreso local.

**Qué hace el servidor**

- Mantiene las salas **en memoria** (sin base de datos) y asigna un código único a cada una.
- Es la autoridad de la pista, la cuenta atrás, la salida, los checkpoints, las vueltas, la meta, la
  clasificación y los objetos. Rechaza teletransportes y estados imposibles.
- Recibe el estado de cada kart a **20 Hz**, lo reenvía a los demás y emite la clasificación cada
  250 ms. Los karts remotos se interpolan en el cliente; el kart propio sigue usando la física local.
- Concede las cajas y los objetos de efecto inmediato: **IMPULSO**, **BARRERA** y **PULSO**. Las
  minas y la furia quedan fuera del online en esta versión.
- Acepta reconexiones durante **15 s** (configurable), transfiere el papel de anfitrión si hace falta
  y permite pedir **revancha** desde la pantalla de resultados. Una sala vacía se borra a los 30 s.
- **No concede monedas, no modifica el progreso local y no sincroniza colisiones entre karts.** Es una
  competición de trazada y objetos, no un modo con contacto físico entre pilotos.

**Flujo de una carrera**

1. `room:create` o `room:join` → `roomManager` guarda la sala y el jugador, y emite
   `room:update` a todos los presentes.
2. El anfitrión pulsa empezar → `room:start` → el servidor crea `raceAuthority`, asigna parrilla y
   cajas, y emite `race:start` con `startAt`, `racers`, `boxes` y `standings`.
3. Cada cliente envía `race:state` a 20 Hz. `raceAuthority` proyecta la posición sobre la pista,
   valida checkpoints y vueltas y reenvía el estado a los demás; la clasificación se emite aparte.
4. Recoger una caja (`item:claim`) y usar un objeto (`item:use`) se piden al servidor. Si la
   validación falla, el servidor responde con el motivo y el cliente no aplica nada.
5. Al cruzar la meta o agotarse `MAX_RACE_MS`, el servidor emite `race:final` con el mismo orden a
   todos. Los resultados se muestran sin monedas; el anfitrión puede pedir `room:rematch` y la sala
   vuelve a `lobby`.
6. Si un socket se cae, el servidor conserva al jugador durante la gracia. Al reconectar con el mismo
   `clientId` recibe `race:resume` con `ownState`; si no vuelve, se le elimina y se actualiza la
   clasificación. Todo el estado vive en memoria y se pierde al reiniciar el proceso.

**Servir cliente y servidor juntos (una sola URL)**

```powershell
npm.cmd run build
npm.cmd start
```

`npm.cmd start` ejecuta `node server/index.js`, igual que `npm.cmd run server`; se mantienen los dos
nombres para que funcionen tanto en local como en alojamientos que esperan `npm start`. El servidor
sirve `dist/` y el socket en el mismo origen. Abre <http://localhost:3001/>. Para separar cliente y
servidor, compila el cliente con `VITE_SERVER_URL` apuntando al servidor:

```powershell
$env:VITE_SERVER_URL = "https://tu-servidor.example"
npm.cmd run build
```

En producción con otro origen, arranca el servidor con `CLIENT_ORIGIN` igual a la URL exacta del
cliente (varios orígenes separados por comas). En un despliegue de una sola URL, usa la URL pública
del propio servicio. Sin `CLIENT_ORIGIN` el servidor acepta cualquier origen: es cómodo en local,
pero en producción muestra un aviso y no es recomendable.

**Validación del origen de Socket.IO**

`CLIENT_ORIGIN` no se aplica solo a CORS. El servidor valida la cabecera `Origin` en `allowRequest`,
que se ejecuta tanto en el sondeo HTTP (polling) como en el upgrade a WebSocket. Así, cambiar de
transporte no evita la comprobación.

- El **mismo origen** del servidor se acepta siempre (compara el host de `Origin` con la cabecera
  `Host`), por lo que funciona detrás de Render o de un proxy con HTTPS sin configurar nada extra.
- Los orígenes locales de Vite y su vista previa (`http://localhost:5173`, `127.0.0.1:5173`,
  `localhost:5174`, `127.0.0.1:5174`, `localhost:4173` y `127.0.0.1:4173`, también con `[::1]`) se
  aceptan siempre para no romper el desarrollo.
- Las conexiones **sin cabecera `Origin`** (clientes Node, pruebas, herramientas) se aceptan. Este
  servidor no usa cookies ni autenticación, así que no hay credenciales que proteger con ellas.
- Un origen que no sea el mismo ni esté en `CLIENT_ORIGIN` se rechaza con un 403 y el servidor escribe
  `Origen rechazado: ...` en el log. El cliente lo verá como error de conexión.

Ejemplo de producción con un único dominio:

```powershell
$env:SERVE_CLIENT = "1"
$env:CLIENT_ORIGIN = "https://TU-SERVICIO.onrender.com"   # sustituye por tu URL real
npm.cmd start
```

No pongas una barra final ni una ruta en `CLIENT_ORIGIN`: debe ser solo el origen (`https://host`).
Las entradas inválidas se descartan con un aviso. Si todas son inválidas, solo quedan permitidos el
mismo origen y los orígenes locales.


**Variables de entorno del servidor**

Todas son opcionales; los valores entre paréntesis son los que se usan si no se definen.

| Variable | Valor por defecto | Uso |
| --- | ---: | --- |
| `PORT` | `3001` | Puerto HTTP y WebSocket. |
| `HOST` | `0.0.0.0` | Interfaz de escucha. |
| `CLIENT_ORIGIN` | `*` | Origen(es) permitidos, separados por comas. `*` acepta cualquiera. El mismo origen y los orígenes locales de Vite se aceptan siempre. |
| `MAX_PLAYERS` | `4` | Jugadores por sala. El protocolo admite hasta 8. |
| `SERVE_CLIENT` | `1` | `1` sirve `dist/`; `0` solo atiende el socket y `/health`. |
| `COUNTDOWN_MS` | `4200` | Duración de la cuenta atrás. |
| `DISCONNECT_GRACE_MS` | `15000` | Margen para reconectar antes de expulsar. |
| `EMPTY_ROOM_TTL_MS` | `30000` | Tiempo que se conserva una sala sin nadie. |
| `FINISH_GRACE_MS` | `60000` | Espera tras el primer clasificado para cerrar la carrera. |
| `MAX_RACE_MS` | `480000` | Duración máxima de una carrera (8 minutos). |

Ejemplo con una carrera corta para pruebas:

```powershell
$env:MAX_RACE_MS = "15000"
$env:COUNTDOWN_MS = "1000"
$env:PORT = "3002"
npm.cmd run server
```

**Variables del cliente**

| Variable | Uso |
| --- | --- |
| `VITE_SERVER_URL` | URL del servidor online. En desarrollo, `http://localhost:3001`; en producción, el mismo origen si el servidor sirve `dist/`. |
| `VITE_BASE` | Ruta base del cliente estático (por ejemplo, `/TurboCircuit/` en GitHub Pages). |

### Controles

El juego se puede conducir con teclado o con pantalla táctil. En ordenador se mantiene el control
clásico; en móviles y tabletas aparecen botones en pantalla.

**Teclado y ratón**

| Acción | Teclas |
| --- | --- |
| Acelerar | `W` o `↑` |
| Frenar / retroceder | `S` o `↓` |
| Girar | `A` / `D` o `←` / `→` |
| Derrapar y cargar turbo | Mantener `Espacio` mientras giras |
| Liberar el turbo | Soltar `Espacio` con carga suficiente |
| Usar el objeto equipado | `E` |
| Pausa / reanudar | `P` o `Esc` |
| Silenciar sonido | `M` |
| Empezar (en el menú) | `Enter` |

Los botones de la interfaz se pueden pulsar con el ratón.

**Cómo funciona el derrape**

- Mantén `Espacio` (o `⟲ DRIFT`) **mientras giras** y el kart se desplaza. La carga exige las tres
  cosas a la vez: velocidad real, giro y asfalto. En recta, parado o contra un muro no sube la barra.
- Al soltar con carga suficiente se gasta **un solo turbo**, aunque mantengas la tecla o vuelvas a
  pulsarla de inmediato. El turbo termina solo y deja una pausa breve de `RECARGANDO` (~0,5 s) antes
  de poder iniciar otro derrape; no existen cadenas infinitas.
- Derrapar no regala velocidad: sin acelerador, la fricción del derrape frena el kart. La carga está
  limitada por el HUD y no se puede acumular más allá del máximo.

**Pantalla táctil**

| Botón | Acción |
| --- | --- |
| `◀` / `▶` | Girar a la izquierda o a la derecha |
| `▲ GAS` | Acelerar |
| `▼ FRENO` | Frenar o marcha atrás |
| `⟲ DRIFT` | Mantener para derrapar; soltar para liberar el turbo |
| `OBJETO` | Usar el objeto recogido (equivale a `E`) |

Los controles táctiles se activan solos cuando el navegador informa de un puntero grueso sin hover
(móvil o tableta). Los botones mantienen la acción mientras el dedo está apoyado, se liberan al
soltar y admiten varios dedos a la vez, de modo que se puede acelerar y girar al mismo tiempo. La
escena y los botones de conducción bloquean el desplazamiento y el zoom accidental de la página.

En carrera se recomienda el móvil en **horizontal**. Si se gira a vertical, aparece un aviso
discreto que no bloquea la partida ni fuerza la orientación. El HUD, el minimapa, el velocímetro y
las pantallas de menú, pausa y resultados respetan las áreas seguras del dispositivo (muesca y barra
de gestos).

Para forzar o desactivar la interfaz táctil al depurar desde el ordenador:

```text
http://localhost:5173/?touch=1   interfaz táctil forzada
http://localhost:5173/?touch=0   interfaz de teclado forzada
```

---

## 4. Compilar para producción

```powershell
npm.cmd run build
```

Se crea la carpeta `dist/` con los archivos HTML, CSS y JavaScript listos para publicar. La base por
defecto es `/`, pensada para Vercel, Netlify o un dominio propio. Para comprobar el resultado:

```powershell
npm.cmd run preview
```

y abre <http://localhost:4173/>.

Para ejecutar las pruebas automáticas de economía, conducción, feedback, circuitos y salas online
(no tocan los datos del navegador):

```powershell
npm.cmd test
```

Si vas a publicar en GitHub Pages dentro de un repositorio llamado `TurboCircuit`, compila con su
ruta base:

```powershell
$env:VITE_BASE = "/TurboCircuit/"
npm.cmd run build
npm.cmd run preview
```

En ese caso la vista previa queda en <http://localhost:4173/TurboCircuit/>. El flujo de GitHub
Actions ya aplica `VITE_BASE=/TurboCircuit/` automáticamente; no hay que editar `vite.config.js`.

---

## 5. Qué incluye esta versión

- Pantalla de inicio con título, **selector de circuito**, **selector de kart con vista previa 3D**,
  selector de dificultad (FÁCIL, NORMAL, DIFÍCIL) y botón **Empezar carrera**. Circuito, kart y
  dificultad se guardan en `localStorage` y se aplican en la siguiente carrera.
- Cuenta atrás 3, 2, 1, ¡YA! con sonido.
- Seis circuitos jugables con trazado, anchura, minimapa, cajas de objetos, decoración y ambiente
  propios. La física, las vueltas, la clasificación y la IA son compartidas:
  - **COSTA TROPICAL**: curvas amplias, arena, palmeras, playa y mar. Sube al mirador (hasta 7,4 m)
    y ofrece la **Rambla de palmeras**, un ramal exterior elevado 1,8 m con placa de turbo.
  - **MONTAÑA**: trazado más estrecho y técnico entre pinos, rocas, lago y montañas. Sube hasta
    13 m y la **Cornisa del bosque** bordea el desnivel por el lado interior, con su propia placa.
  - **CIUDAD FUTURISTA**: circuito nocturno de rectas largas y chicanes, con edificios iluminados,
    neón y muros oscuros. El **Túnel de servicio** es un ramal paralelo elevado 1,2 m.
  - **DISTRITO NEÓN**: noche urbana con pianos magenta, paneles y zonas de turbo. La **Pasarela de
    neón** (2,2 m sobre la calzada) cruza el tramo rápido con puertas móviles.
  - **CAÑÓN SALVAJE**: rampas, saltos, rocas y mesetas. La **Cornisa del cañón** añade un salto y
    una roca móvil en el ramal, además de los tres saltos de la calzada principal.
  - **ESTACIÓN ORBITAL**: plataformas, puertas móviles y ambiente espacial. El **Anillo exterior**
    sube 2,4 m y mantiene el desnivel máximo del mapa (12 m) en plena curva.
- **Bifurcaciones reales:** el ramal se separa del asfalto (entre 5,4 y 6,3 m de hueco libre entre
  calzadas), tiene su propio ancho, bordillos, muros con huecos en las bocas y un trazado que
  reencuentra la pista. No es decoración: se conduce por dentro, proyecta el kart sobre su línea
  central y comparte la `s` global para que vueltas y checkpoints sigan siendo válidos.
- **Saltos con física:** las rampas son cuñas transitables; al dejar el labio el kart despega con
  la velocidad real, recibe un control aéreo limitado y aterriza sobre la altura del asfalto
  (incluido el del ramal). No hay saltos infinitos ni turbo gratis, la cámara se limita para no
  atravesar el suelo y el aterrizaje reutiliza el aviso, el sonido y la sacudida existentes.
- Cuatro karts jugables, cada uno con física y silueta propias. Ninguno es mejor en todo:
  - **Rayo** (equilibrado), **Centella** (mucha punta, menos agarre), **Lira** (muy ágil y rápida de
    aceleración, menor velocidad punta) y **Titán** (pesado, acelera menos pero aguanta mejor los
    roces y los impactos).
- Vista previa 3D real del kart en el menú, con giro automático, botones de anterior/siguiente y
  barras de velocidad, aceleración, agarre y estabilidad.
- Kart original con carrocería, ruedas, piloto, alerón y escapes, con animación de ruedas y balanceo.
  Cada estilo cambia chasis, morro, pods, alerón, distancia entre ejes y sombra de contacto.
- Cámara de persecución suavizada con anticipación lateral moderada, FOV de velocidad y FOV extra
  durante el turbo, además de una sacudida breve en impactos, turbo y aterrizajes. La sacudida se
  aplica sobre una referencia suave y se restaura sola, sin atravesar el suelo ni perder de vista la
  pista.
- Física basada en el tiempo entre fotogramas: aceleración y frenada progresivas, giro que depende
  de la velocidad, pérdida de velocidad en el césped, límites del circuito y choques entre karts.
  La masa influye en empujones, impactos y pérdida de velocidad al rozar.
- Progreso de carrera continuo para los cuatro karts: la clasificación usa la distancia recorrida
  sobre el trazado (vueltas incluidas), no la distancia al centro del circuito. Al cruzar la línea
  de meta no se pierden ni se regalan vueltas.
- 3 rivales con personalidad propia y estadísticas distintas:
  - **Vega**: la más rápida en recta, pero frena tarde y es menos precisa en curva.
  - **Nilo**: constante, frena pronto, gira con limpieza y comete muy pocos errores.
  - **Musgo**: agresiva al buscar adelantamientos y con fallos pequeños ocasionales.
- La IA anticipa la curvatura, levanta el pie o frena antes de las curvas, elige carril para
  adelantar cuando hay hueco, vuelve suavemente a su trazada y, si se queda bloqueada, retrocede
  para recuperarse sin teletransportarse ni ganar progreso gratis. Hay una variación de ritmo
  moderada según la distancia con el jugador.
- Dificultad real, no solo una etiqueta: FÁCIL reduce ritmo, agresividad, precisión y uso de objetos
  ofensivos; NORMAL equilibra velocidad y decisiones; DIFÍCIL añade más ritmo, aceleración, frenada,
  anticipación, trazada al vértice y derrape controlado para encadenar turbo, además de
  adelantamientos y recuperación más rápidos y mejor gestión de objetos. Vega, Nilo y Musgo
  conservan su personalidad en los tres niveles.
- Derrape arcade: mantén `Espacio` (o el botón `DRIFT` en táctil) mientras giras para deslizar el
  kart. La carga del turbo exige velocidad, asfalto y giro real; mantener la tecla en recta no carga
  nada. Hay dos niveles (turbo corto y turbo potente), con barra en el HUD, estado `RECARGANDO` tras
  gastarlo, llamas en los escapes, estela de partículas, líneas de velocidad y un sonido progresivo.
  Un mismo derrape solo puede generar una activación y el turbo no se puede encadenar sin volver a
  cargar. La carrocería se inclina más cuanto mayor es el deslizamiento.
- Audio reactivo sin archivos externos: motor según velocidad y césped, roce de neumático continuo
  durante el derrape, capa de turbo que sube de tono y volumen, golpes entre karts, roce con el muro,
  recogida y uso de objetos, cuenta atrás, victoria y una melodía descendente al perder. El
  silenciado (`M` o botón) se guarda aparte en `turbo-circuit-sound-v1` y no toca el progreso.
- Efectos de conducción con dos pools fijos de partículas (humo de derrape y chispas de turbo,
  impactos, recogidas y aterrizajes). No se crean objetos por fotograma y los pools se ocultan cuando
  están vacíos: 0 llamadas de dibujo extra en reposo y como máximo +2 con partículas activas.
- Aviso breve de **ADELANTAMIENTO** cuando la posición real mejora y se mantiene unos instantes, con
  histéresis y un tiempo mínimo por rival para que dos karts que se intercambian no generen avisos en
  bucle. No concede monedas ni ventajas.
- Cajas de objetos visibles que desaparecen al recogerse y reaparecen a los pocos segundos. Los
  cuatro karts pueden recoger y usar objetos; el jugador lo hace con `E` o con el botón `OBJETO` en
  pantalla táctil, y ve el objeto equipado en el HUD. Objetos originales:
  - **IMPULSO**: aceleración extra temporal.
  - **PULSO**: onda expansiva que ralentiza brevemente a los karts cercanos.
  - **BARRERA**: reduce la intensidad y duración de los efectos negativos.
  - **PULSO DE IMPACTO**: proyectil de energía que sale del morro del kart, avanza en línea recta
    con alcance y duración limitados y desestabiliza al primer rival que golpea. La BARRERA lo
    bloquea por completo. La IA solo dispara cuando hay un objetivo delante, con línea de tiro
    despejada y respetando un tiempo mínimo entre disparos; su frecuencia depende de la dificultad.
- Los efectos tienen temporizadores propios, no se suman sin límite y se limpian al pausar,
  reiniciar, volver al menú o cambiar de pestaña.
- Vueltas, posición, tiempo total, tiempo de vuelta, mejor vuelta, velocímetro, minimapa, barra de
  turbo, ranura de objeto y una indicación discreta de la dificultad activa.
- Carrera a 3 vueltas con pantalla de resultados honesta (los rivales que aún no han terminado se
  muestran como "En carrera") y botón para volver a jugar.
- Pausa manual (botón o tecla) y pausa automática al cambiar de pestaña. La pausa congela karts,
  derrapes, turbos y efectos temporales.
- Interfaz adaptable al tamaño de la ventana y a la pantalla táctil: controles en pantalla con
  multitáctil, HUD compacto, menú corto en horizontal, aviso de orientación no bloqueante y
  respeto de las áreas seguras (muesca y barra de gestos).
- Renderizado adaptativo: el juego limita la resolución interna en móviles para cuidar GPU y
  batería, reduce las sombras y ajusta el campo de visión al cambiar de orientación sin recrear la
  escena ni los materiales.

### Bifurcaciones, desniveles y saltos

Los seis mapas mantienen su identidad visual y sus desbloqueos, pero ahora comparten una capa de
circuito más rica. La definición vive en `src/game/maps.js` y la resuelve `src/game/Track.js`:

| Circuito | Bifurcación | Longitud | Altura sobre la calzada | Checkpoints |
| --- | --- | ---: | ---: | ---: |
| COSTA TROPICAL | Rambla de palmeras | 136 m | +1,8 m | 8 |
| MONTAÑA | Cornisa del bosque | 165 m | +2,8 m | 8 |
| CIUDAD FUTURISTA | Túnel de servicio | 213 m | +1,2 m | 8 |
| DISTRITO NEÓN | Pasarela de neón | 178 m | +2,2 m | 8 |
| CAÑÓN SALVAJE | Cornisa del cañón | 145 m | +2,4 m | 8 |
| ESTACIÓN ORBITAL | Anillo exterior | 182 m | +2,4 m | 8 |

- **Trazado:** cada ramal sale y entra en la calzada principal con un desplazamiento lateral inicial
  de unos 7 m desde el centro. Sus puntos intermedios se separan entre 20 y 26 m para que las dos
  calzadas no se solapen: la separación libre medida entre bordes es de 5,4 a 6,3 m.
- **Superficie:** el ramal tiene su propio ancho (12–13 m), asfalto, línea central, bordillos,
  arcén, muros y pilares de viaducto cuando queda elevado. Los muros se construyen por tramos y
  dejan abiertas las bocas de entrada y salida.
- **Desniveles:** la pista principal interpola su altura con keyframes (de 0 a 13 m según el mapa).
  El ramal hereda esa altura y, si define keyframes propios, los suma como desnivel relativo; así
  los extremos siempre empalman con la calzada. El kart, las cajas, los proyectiles, las minas, los
  obstáculos, la cámara y las sombras usan la altura del asfalto correspondiente.
- **Progreso y vueltas:** la `s` global avanza igual por la principal y por el ramal. Hay ocho
  checkpoints por circuito y una vuelta solo cuenta si se han cruzado todos; las vueltas inválidas
  se contabilizan sin teletransportar al kart ni regalar progreso.
- **IA:** cada rival decide una vez por carrera si toma el ramal (probabilidad ligada a su perfil,
  a la dificultad y al riesgo del mapa) y mantiene la decisión con histéresis. La proyección del
  kart conserva la ruta actual mientras la distancia sea razonable, de modo que no salta de carril
  al pasar junto a una boca. La IA recorrió las dos variantes de los seis mapas sin atascos.
- **Obstáculos móviles:** rocas, puertas y plataformas oscilan lateralmente con una amplitud
  limitada. La prueba automática comprueba que siempre queda un hueco libre de más de 2 m, que no
  cubren todo el ancho, que golpean a jugador e IA y que se pueden superar saltando. No dan monedas
  ni objetos.
- **Objetos:** las cajas se colocan también en el ramal, con su altura y su ruta; solo se recogen
  si el kart circula por esa ruta y a una altura compatible. Los proyectiles y las minas guardan la
  ruta y la altura de origen, y sus efectos/explosiones se dibujan en el plano correcto.
- **Minimapa:** dibuja el ramal como una línea más, con el mismo tratamiento que la calzada, y
  amplía los límites del mapa para que no se corte.

### Multijugador online

- **Salas privadas de 1 a 4 jugadores** (hasta 8 con `MAX_PLAYERS`) con código de 5 caracteres,
  nombre visible, elección de circuito por el anfitrión y lobby con presencia en tiempo real.
- **Servidor autoritativo:** decide la pista, la cuenta atrás, la salida, los checkpoints, las
  vueltas, la meta y la clasificación. Los clientes envían su estado a 20 Hz; el servidor lo valida,
  lo reenvía y descarta saltos o teletransportes. La física del kart propio no cambia.
- **Cajas y objetos compartidos:** el servidor decide qué caja se recoge, qué objeto concede y si un
  uso es válido. En online solo entran **IMPULSO**, **BARRERA** y **PULSO**; las minas y la furia no.
- **Reconexión y revancha:** si se cae la conexión, la sala espera 15 s. Al volver se recibe
  `race:resume` con el estado propio y la carrera continúa. Si el anfitrión se va, otro pasa a serlo;
  al terminar, el anfitrión puede pedir revancha desde la pantalla de resultados.
- **Sin progreso:** el online **no otorga monedas** ni cambia karts, circuitos o desbloqueos. La
  pista de la sala se puede usar aunque no esté comprada, porque no se guarda como progreso.
- **Sin contacto entre karts:** no se sincronizan colisiones entre pilotos en esta versión. Cada
  cliente simula su kart y los remotos se interpolan; los objetos sí se validan en el servidor.

### Monedas, tienda y desbloqueos

- **Monedas por victoria:** 20 en FÁCIL, 40 en NORMAL y 70 en DIFÍCIL. Perder no paga. Una carrera
  solo puede cobrar una vez, aunque se llame dos veces a la finalización o se recargue la pantalla de
  resultados.
- **Inicio:** un kart (**Rayo**), un circuito (**COSTA TROPICAL**) y **0 monedas**. No hay
  compensación inicial ni desbloqueos automáticos: el resto del contenido cuesta monedas.
- **Contenido bloqueado:** sigue visible en el menú y en la tienda para mostrar la progresión, pero
  no se puede equipar ni usar para correr. Pulsarlo abre la tienda en esa ficha. La comprobación se
  hace en `economy.js` y se repite en `Game.startRace()`, así que no basta con manipular botones o el
  estado de la interfaz.
- **Tienda:** se abre con el chip de monedas del menú o al pulsar contenido bloqueado. Tiene dos
  pestañas, vista previa 3D del kart, trazado del circuito, descripción, precio, estado
  (bloqueado/desbloqueado/equipado) y botones de compra o equipar. El saldo siempre está visible; los
  artículos bloqueados muestran el precio, cuántas monedas faltan y el botón de compra desactivado
  hasta que el saldo alcanza el precio.
- **Integridad:** comprar dos veces el mismo artículo no vuelve a cobrar; el saldo nunca queda
  negativo; equipar exige tener el artículo desbloqueado. Si el navegador rechaza el guardado, la
  compra, la recompensa o la selección se deshacen y se muestra un aviso, sin fingir que se guardaron.

#### Progresión y migración

- **Perfil nuevo:** `karts: ["rayo"]`, `maps: ["coast"]`, `coins: 0`. Solo Rayo y Costa están
  desbloqueados.
- **Compras:** al comprar se descuenta el precio una vez y el identificador se añade al perfil. Las
  compras quedan en `turbo-circuit-progress-v1` y sobreviven a recargas y cierres del navegador.
- **Claves antiguas:** `turbo-circuit-kart-v1` y `turbo-circuit-map-v1` pertenecen a la versión
  anterior a la economía, cuando todos los karts y circuitos estaban disponibles sin comprarse. Por
  eso **no se usan para conceder desbloqueos**: se conservan intactas por compatibilidad, pero un
  perfil nuevo sigue teniendo solo Rayo y Costa aunque esas claves apunten a Titán u Orbital.
  La versión publicada anterior tenía un fallo aquí: copiaba el mapa *seleccionado* de
  `turbo-circuit-map-v1` a la lista de mapas *comprados*, así que Orbital aparecía gratis si era el
  último circuito elegido. La migración ya no lee esas claves para conceder contenido.
- **Perfiles v1 existentes:** se conservan sus arrays `karts` y `maps`, es decir, todo lo que ya
  estuviera desbloqueado o comprado en el perfil nuevo. No se regala nada que no estuviera ya ahí.
  Si un perfil antiguo quedó contaminado por la migración anterior, se retira el desbloqueo que no
  pudo pagarse: un objeto solo es una compra legítima si su precio no supera
  `stats.coinsEarned` (las monedas solo entran ganando carreras y ese contador es acumulativo). Por
  ejemplo, Orbital con 0 monedas ganadas se elimina de `maps`; Orbital con 560 o más ganadas se
  conserva. El saldo y la clave `turbo-circuit-progress-v1` no se borran.
- **Datos incompletos o dañados:** se reparan campo a campo. Como mínimo quedan Rayo, Costa y un saldo
  válido no negativo (`0` si el valor era negativo, `NaN` o no numérico). Si el JSON no se puede
  leer, el texto original se copia en `turbo-circuit-progress-v1.corrupt` antes de continuar y el
  arranque no escribe nada sobre la partida guardada.
- **Errores de almacenamiento:** `saveProgress()` devuelve `false`; el juego revierte la operación en
  memoria y avisa en la tienda, en los resultados o bajo el menú. No se muestra una compra o una
  recompensa como exitosa si no se ha podido guardar.


Precios centralizados en `src/game/economy.js` y victorias necesarias para comprar cada elemento:

| Contenido | Precio | FÁCIL (20) | NORMAL (40) | DIFÍCIL (70) |
| --- | ---: | ---: | ---: | ---: |
| Centella | 150 | 8 | 4 | 3 |
| Lira | 260 | 13 | 7 | 4 |
| Titán | 400 | 20 | 10 | 6 |
| Montaña | 120 | 6 | 3 | 2 |
| Ciudad Futurista | 220 | 11 | 6 | 4 |
| Distrito Neón | 320 | 16 | 8 | 5 |
| Cañón Salvaje | 440 | 22 | 11 | 7 |
| Estación Orbital | 560 | 28 | 14 | 8 |

El modo difícil es el que mejor paga por carrera; desbloquear todo el contenido cuesta 2.470 monedas
en total. El modo local es completamente offline. El multijugador online es opcional, usa un servidor
Socket.IO propio y no concede monedas ni modifica el progreso guardado; no hay cuentas, pagos ni
servicios externos de autenticación.

---

## 6. Estructura del proyecto

```text
Turbo Circuit/
├─ index.html                 Interfaz (menú, selectores, HUD, pausa, resultados)
├─ package.json               Dependencias y scripts
├─ vite.config.js             Configuración de Vite y base configurable con VITE_BASE
├─ vercel.json                Configuración de despliegue en Vercel
├─ netlify.toml               Configuración de despliegue en Netlify
├─ .github/workflows/deploy.yml  Flujo automático de publicación en GitHub Pages
├─ .gitignore
├─ README.md
├─ tests/
│  ├─ economy.test.mjs         Economía, compras y persistencia
│  ├─ driving.test.mjs         Física, derrape y turbo (comportamiento)
│  ├─ feedback.test.mjs        Adelantamientos e intensidades de efectos
│  ├─ tracks.test.mjs          Rutas, desniveles, saltos, obstáculos y carreras IA
│  └─ online.test.mjs          Salas, autoridad, objetos, reconexión, 4 jugadores y revancha
├─ server/
│  ├─ index.js                 Arranque y variables de entorno
│  ├─ app.js                   HTTP + Socket.IO + estáticos + /health
│  ├─ roomManager.js           Salas, anfitrión, presencia, inicio, relay y objetos
│  ├─ raceAuthority.js         Proyección, checkpoints, vueltas, meta y clasificación
│  └─ static.js                Servidor de dist/ con MIME y caché
├─ shared/
│  └─ protocol.js              Constantes, validación y saneado cliente/servidor
└─ src/
   ├─ main.js                 Punto de entrada, detección táctil y captura de errores WebGL
   ├─ style.css               Estilos arcade, diseño responsive y controles táctiles
   ├─ online/
   │  ├─ OnlineClient.js      Conexión, reloj, ack, snapshots y recuperación de sala
   │  └─ config.js            URL del servidor, nombre y mensajes de error
   └─ game/
      ├─ Game.js              Escena, estados, carrera, cámara y bucle principal
      ├─ Track.js             Pista, rutas, desniveles, checkpoints, muros y mecánicas
      ├─ maps.js              Definición de los seis circuitos y sus ramales
      ├─ Kart.js              Modelo visual, física, derrape y efectos
      ├─ karts.js             Karts jugables, rivales y persistencia antigua
      ├─ KartPreview.js       Vista previa 3D del kart en el menú y la tienda
      ├─ Effects.js           Pools fijos de partículas (humo, chispas y estelas)
      ├─ raceFeedback.js      Adelantamientos reales e intensidades de derrape/turbo
      ├─ economy.js           Monedas, precios, compras, desbloqueos y migración
      ├─ Shop.js              Garaje/tienda: tarjetas, vista previa y estados
      ├─ simulation.js        Arnés de carreras con semilla para equilibrar la IA
      ├─ AIController.js      Perfiles de IA, trazada, adelantamientos y recuperación
      ├─ ItemSystem.js        Cajas, objetos, ondas, proyectiles y decisiones de la IA
      ├─ items.js             Definición de IMPULSO, PULSO, BARRERA y PULSO DE IMPACTO
      ├─ boxLayout.js         Distribución determinista de cajas cliente/servidor
      ├─ difficulty.js        Perfiles FÁCIL/NORMAL/DIFÍCIL y persistencia validada
      ├─ Input.js             Entrada de teclado y táctil (Pointer Events, multitáctil)
      ├─ Audio.js             Sonidos con WebAudio
      ├─ UI.js                Pantallas, HUD, turbo, objeto, minimapa y selectores
      ├─ config.js            Ajustes de juego
      ├─ textures.js          Texturas dibujadas con Canvas
      └─ utils.js             Matemáticas y formato de tiempos
```

---

## 7. Publicar gratis en la web

El **modo local** es estático: no necesita servidor, base de datos ni variables secretas. La base por
defecto es `/`, así que funciona directamente en Vercel, Netlify o un dominio propio. GitHub Pages
necesita una subcarpeta y ya está contemplada con `VITE_BASE`.

El **multijugador online** necesita además un proceso Node.js con WebSocket. Vercel, Netlify y
GitHub Pages solo alojan el cliente estático: no mantienen conexiones WebSocket ni salas en memoria.
Para publicar el online hay que alojar `server/` en un servicio que ejecute Node de forma continua (o
que despierte al recibir tráfico) y decidir si ese mismo servicio sirve `dist/` o si el cliente va
aparte.

### Opciones de alojamiento con coste inicial cero

Límites consultados en las páginas oficiales el **29/10/2026**. Cambian con frecuencia; compruébalos
antes de crear la cuenta. No se ha creado ninguna cuenta ni desplegado nada para esta comparación.

| Opción | Qué da gratis | Límites y pegas actuales | Encaje con este proyecto |
| --- | --- | --- | --- |
| **Render Free** | Web service Node, 0,1 CPU / 512 MB, 750 h de instancia al mes, TLS y dominio incluidos | Se duerme tras 15 min sin tráfico entrante (incluidos mensajes WebSocket); tarda ~1 min en despertar. Disco efímero, una sola instancia, sin escalado. Puede reiniciarse solo. | **La opción más directa**: build `npm ci --include=dev && npm run build`, start `npm start` y `SERVE_CLIENT=1`. Las salas se pierden al dormirse o reiniciarse. |
| **Railway Free** | $0/mes con $1 de crédito mensual; hasta 1 vCPU / 0,5 GB y 1 réplica | El crédito de $1 no cubre un proceso siempre encendido: el uso se cobra por segundo y se factura lo que supere el crédito. Sin dominio propio en el plan Free. El trial da $5 durante 30 días. | Sirve para pruebas, no para mantener salas 24/7 sin coste. |
| **Fly.io** | Prueba gratuita de hasta 2 h de máquina o 7 días | **No hay plan gratuito para organizaciones nuevas.** La máquina siempre encendida más pequeña cuesta $2,19/mes; hace falta tarjeta al acabar la prueba. | No cumple “coste inicial cero” más allá de la prueba. |
| **Koyeb** | Su página de precios actual no muestra plan gratuito; el plan Pro cuesta $29/mes + cómputo | Sin free tier visible. | No es opción cero con la información consultada. |
| **Google Cloud Run** | 180.000 vCPU-s, 360.000 GiB-s y 2 millones de peticiones al mes; escala a cero | Hay que containerizar el servidor; requiere cuenta de Google Cloud y tarjeta. Una conexión WebSocket larga cuenta como tiempo de instancia mientras está activa. Arranques en frío. | Viable para poco tráfico, pero más configuración que Render. |
| **Deno Deploy Free** | 1 millón de peticiones/mes, 20 GiB de salida, 10 h de CPU activa, 150 GiB-h de memoria, 5 dominios | No es un Node.js genérico: habría que adaptar el servidor y el transporte (Socket.IO/WebSocket) a su runtime. | No es “drop-in”; solo si se reescribe la capa de red. |
| **Cloudflare Workers Free** | 100.000 peticiones/día, 10 ms de CPU por petición, 128 MB; WebSocket mediante Durable Objects | Requiere reescribir el servidor para Workers/Durable Objects y cambia el modelo de salas. El límite de CPU es muy bajo para lógica de carrera. | No es “drop-in”; no recomendable en esta fase. |
| **Oracle Cloud Always Free** | 2 OCPU Ampere A1 / 12 GB, 2 VM AMD micro, 200 GB de bloque, 10 TB de salida al mes | Pide tarjeta; la capacidad gratuita puede agotarse (“out of host capacity”); hay que administrar sistema operativo, cortafuegos y TLS. Oracle puede reclamar instancias ociosas. | Único para 24/7 real sin coste, pero con más operación. |
| **Vercel / Netlify / GitHub Pages** | Cliente estático y CDN gratis | No ejecutan un servidor WebSocket persistente. | Solo para el cliente; el servidor va aparte. |

**Recomendación para la primera publicación:** cliente estático en Vercel, Netlify o GitHub Pages y
servidor en **Render Free**. Si prefieres una sola URL, publica también `dist/` en Render con
`SERVE_CLIENT=1`. Configura `CLIENT_ORIGIN` con el dominio exacto del cliente y compila con
`VITE_SERVER_URL` solo si cliente y servidor están en dominios distintos. El modo local no necesita
nada de esto.

### Publicar en Render (cliente y servidor en una sola URL)

Estos pasos son manuales y **no se han ejecutado**: no se ha creado ninguna cuenta ni desplegado nada.
Render asignará un dominio propio; no lo inventes, cópialo del panel cuando exista el servicio.

1. Sube el repositorio a GitHub (sección siguiente) y entra en <https://dashboard.render.com/>.
2. **New → Web Service** y conecta el repositorio. Si el proyecto está en un monorepo, deja la raíz
   del repositorio como directorio.
3. Runtime: **Node**. Build Command:

   ```text
   npm ci --include=dev && npm run build
   ```

   Start Command:

   ```text
   npm start
   ```

   `--include=dev` es necesario porque Vite está en `devDependencies` y Render puede definir
   `NODE_ENV=production`, lo que omitiría esas dependencias y rompería el build.

4. Instancia: **Free** para empezar. Health Check Path: `/health`.
5. En **Environment** añade estas variables (los valores son los del proyecto, no secretos):

   | Variable | Valor |
   | --- | --- |
   | `SERVE_CLIENT` | `1` |
   | `CLIENT_ORIGIN` | La URL pública exacta que muestre Render (sin barra final). Es un marcador: `https://TU-SERVICIO.onrender.com`; no se conoce el dominio hasta crear el servicio. |
   | `NODE_VERSION` | Opcional. El proyecto ya declara `engines.node >=20.19.0`; si el panel muestra una versión anterior, fija `22`. |

   No definas `VITE_SERVER_URL`: al servir el cliente desde el mismo servicio, el bundle usa
   `window.location.origin`. `PORT` lo inyecta Render automáticamente; no lo fijes.

6. Pulsa **Create Web Service** y espera al build. La primera petición puede tardar ~1 minuto si la
   instancia estaba dormida.
7. Comprueba en este orden (sustituye `TU-DOMINIO` por el valor del panel):
   - `https://TU-DOMINIO.onrender.com/health` devuelve `"ok": true`.
   - La raíz carga el juego y los assets.
   - Con dos dispositivos o dos redes distintas, crea una sala y completa al menos una carrera.
   - El log no muestra `Origen rechazado`; si aparece, corrige `CLIENT_ORIGIN` (ver sección 8).
8. **No des por bueno el online por Internet hasta superar la prueba entre redes.** El plan Free
   duerme el servicio a los 15 minutos sin tráfico: las salas en memoria se pierden y el arranque en
   frío puede superar el margen de reconexión de 15 s. Es esperado.

Si prefieres separar cliente y servidor, publica `dist/` en Vercel, Netlify o Pages con
`VITE_SERVER_URL` igual a la URL de Render y define `CLIENT_ORIGIN` en Render con la URL del cliente.

### Ruta rápida: GitHub + Vercel

1. Crea un repositorio en GitHub llamado **TurboCircuit**. No marques "Add a README file" ni añadas
   `.gitignore` o licencia: ya existen en el proyecto.
2. Abre PowerShell en la carpeta del proyecto y sube el código. Cambia `TU-USUARIO` por tu usuario:

   ```powershell
   git init
   git add .
   git commit -m "Turbo Circuit"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TurboCircuit.git
   git push -u origin main
   ```

3. Entra en <https://vercel.com/new>, conecta tu cuenta de GitHub e importa el repositorio.
4. Deja la configuración que Vercel detecta: framework **Vite**, comando `npm run build` y carpeta de
   salida `dist`. Para el modo local no hay variables de entorno ni secretos. Si vas a usar el
   online con un servidor en otro dominio, añade `VITE_SERVER_URL` con su URL antes de compilar.
5. Pulsa **Deploy**. La URL será similar a `https://turbo-circuit.vercel.app/`. Cada `git push` a
   `main` publica una versión nueva automáticamente.

> Esto publica **solo el cliente estático** (modo local). El botón Multijugador necesitará un
> servidor Node aparte, como se explica en la comparación anterior.

`vercel.json` ya fija el comando y la carpeta de salida. Si prefieres no importar el repositorio,
también puedes ejecutar `npx vercel` desde la carpeta del proyecto.

### Alternativa: Netlify

1. Crea una cuenta en <https://www.netlify.com/> y elige **Add new site → Import an existing project**.
2. Conecta el repositorio. `netlify.toml` ya define `npm run build`, la carpeta `dist` y Node 22.
3. Publica. La URL será algo como `https://turbo-circuit.netlify.app/`.

> Igual que en Vercel, esto publica el cliente. Para el online, define `VITE_SERVER_URL` en las
> variables de compilación y configura `CLIENT_ORIGIN` en el servidor.

También puedes arrastrar la carpeta `dist/` a <https://app.netlify.com/drop> después de compilar.

### Alternativa: GitHub Pages

El flujo `.github/workflows/deploy.yml` compila con `npm ci`, aplica `VITE_BASE=/TurboCircuit/` y
publica `dist/` en Pages. El proyecto ya está preparado para un repositorio llamado **TurboCircuit**.

1. Crea una cuenta en <https://github.com/> si no tienes una.
2. Crea un repositorio nuevo:
   - Nombre: **TurboCircuit**
   - Visibilidad: **Public**
   - No marques "Add a README file" ni añadas `.gitignore` o licencia (ya existen en el proyecto).
3. Abre PowerShell en la carpeta del proyecto y sube el código. Cambia `TU-USUARIO` por tu usuario:

   ```powershell
   git init
   git add .
   git commit -m "Turbo Circuit con mapas y karts"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TurboCircuit.git
   git push -u origin main
   ```

   Si no tienes Git instalado, instálalo desde <https://git-scm.com/download/win> o sube los archivos
   con GitHub Desktop. La carpeta `node_modules` y `dist` no se suben porque están en `.gitignore`.

4. En GitHub entra en el repositorio y abre **Settings → Pages**.
5. En **Build and deployment → Source**, elige **GitHub Actions**.
6. Abre la pestaña **Actions**. Verás el flujo **Publicar en GitHub Pages** ejecutándose. Espera a que
   aparezca el check verde (la primera vez puede tardar un par de minutos).
7. La web estará en:

   ```text
   https://TU-USUARIO.github.io/TurboCircuit/
   ```

   Para el online, añade `VITE_SERVER_URL` al paso de compilación del flujo (o al secreto/variable
   del repositorio) y pon la misma URL pública del servidor. El cliente estático no puede ejecutar
   el servidor Socket.IO por sí solo.

8. Cada vez que hagas `git push` a la rama `main`, GitHub volverá a compilar y publicar la nueva
   versión automáticamente.

### Si cambias el nombre del repositorio en GitHub Pages

Edita la variable `VITE_BASE` del paso **Compilar con Vite** en `.github/workflows/deploy.yml` y
sustituye `/TurboCircuit/` por `/<NOMBRE-DEL-REPOSITORIO>/`. La ruta base debe coincidir exactamente
con el nombre del repositorio, o la página se quedará en blanco al cargar los archivos. En Vercel y
Netlify no hay que cambiar nada.

> El flujo está configurado para la rama `main`. Si tu rama principal se llama `master`, cámbialo en
> `.github/workflows/deploy.yml` o renombra la rama con `git branch -M main`.

---

## 8. Problemas frecuentes

- **`npm.ps1 no se puede cargar...`**: usa `npm.cmd` o habilita scripts para tu usuario (ver sección 1).
- **La página se queda en blanco en GitHub Pages**: comprueba que `VITE_BASE` en
  `.github/workflows/deploy.yml` coincide con el nombre del repositorio (`/TurboCircuit/`) y que
  Pages usa **GitHub Actions** como origen. En Vercel o Netlify la base debe ser `/` (valor por
  defecto). Abre la consola del navegador (F12) para ver qué archivo no se encuentra.
- **No se ve la escena 3D**: activa la aceleración por hardware del navegador y comprueba que WebGL
  funciona en <https://get.webgl.org/>. El juego muestra un aviso si no puede crear la escena.
- **El ordenador va lento**: cierra otras pestañas con 3D. Las sombras están activadas por defecto y se
  adaptan a la zona del jugador; en equipos modestos el juego sigue funcionando, aunque con menos FPS.
- **No aparecen los controles táctiles en el móvil**: comprueba que la página se carga por `https`
  o `localhost` y prueba a añadir `?touch=1` a la URL. Si aparecen con `?touch=1` pero no sin él, el
  navegador no está informando de un puntero táctil (ocurre en algunos emuladores).
- **Los botones táctiles no responden o se queda una acción pulsada**: toca fuera del botón, pausa y
  reanuda, o recarga la página. Al perder el foco, cambiar de pestaña o pausar, el juego libera todos
  los controles y cancela el derrape en curso.
- **Multijugador: “No se pudo conectar”**: comprueba que el servidor está arrancado
  (`npm.cmd run server`) y que `/health` responde en el puerto configurado. En desarrollo, el cliente
  usa `http://localhost:3001`; si cambiaste el puerto, arranca Vite con `VITE_SERVER_URL`.
- **Multijugador: la sala no aparece o se cierra**: las salas viven en memoria. Si el servidor se
  reinicia, se duerme (Render Free) o pasa el TTL de sala vacía, desaparecen. Vuelve a crear la sala.
- **Multijugador: error de CORS, 403 o WebSocket bloqueado**: en producción define `CLIENT_ORIGIN`
  con la URL exacta del cliente o usa el mismo dominio para cliente y servidor. La validación cubre
  polling y WebSocket; si el log muestra `Origen rechazado: ...`, el valor de `CLIENT_ORIGIN` no
  coincide (revisa `https`, el puerto y que no haya barra final). Sirve el socket por `https/wss` y,
  si hay un proxy inverso, permite `Upgrade` y `Connection: Upgrade`.
- **Multijugador: “Se agotó el tiempo para reconectar”**: la desconexión duró más de
  `DISCONNECT_GRACE_MS` (15 s por defecto). Entra de nuevo con el código; la sala puede seguir viva
  si quedan jugadores.
- **El sonido no arranca hasta pulsar un botón**: es una norma de los navegadores. Pulsa **Empezar
  carrera** y el audio se activa.

---

## 9. Estado de las pruebas

### Comprobado en esta actualización (multijugador online)

- **`npm.cmd test`: 71/71 correctas**, 0 fallos con `node:test` (~9–17 s según el equipo). No se toca
  ningún dato del navegador. Incluye las pruebas nuevas de `tests/online.test.mjs`:
  - **Origen de Socket.IO:** con `CLIENT_ORIGIN` fijado, se aceptan el mismo origen, el origen
    configurado, `http://localhost:5173` y un cliente sin cabecera `Origin`; se rechazan al instante
    un origen ajeno tanto por WebSocket como por polling, y el servidor registra el aviso.
  - **Objetos online:** `BARRERA` se usa sin objetivos; `PULSO` devuelve como objetivo solo al kart
    dentro del radio y excluye al que está lejos; `MINA`, `FURIA` y `PULSO_IMPACTO` se rechazan con
    `item-offline` y no se consumen; el pool de cajas solo contiene `IMPULSO`, `BARRERA` y `PULSO`.
  - **Reconexión a media carrera:** el anfitrión corta el socket, el rival recibe `presence`
    `disconnect`, pasa a ser anfitrión y, al volver con el mismo `clientId` dentro del margen, recibe
    `race:resume` con `ownState` (posición y velocidad conservadas), no con la parrilla inicial. Si no
    vuelve, se le expulsa y la clasificación baja a los que quedan.
  - **Carrera de 4 jugadores:** creación, tres uniones, límite de sala, inicio con 4 racers y 4
    slots, snapshots cruzados (cada cliente recibe a los otros tres), clasificación compartida y
    `race:final` idéntico para los cuatro.
  - Se mantienen las pruebas anteriores de salas, límites, anfitrión, cajas sin doble recogida,
    objetos, autoridad de vueltas/meta, final compartido y revancha del anfitrión.
- **`npm.cmd run build` correcto** con Vite 8.3.5: 63 módulos, `dist/assets/index-CTwABjMa.js`
  855,44 kB (228,94 kB gzip), CSS `index-CKs1RfmK.css` 73,37 kB (15,36 kB gzip) e `index.html`
  29,93 kB. Solo aparece el aviso de chunk > 500 kB; PowerShell puede devolver código 1 por ese aviso,
  no por un error de compilación.
- **Pruebas manuales en Chromium (localhost, varias pestañas):**
  - Sala de **3 jugadores** (`PFAU2`): crear/unirse, lobby con los tres nombres, inicio del anfitrión,
    cuenta atrás y carrera con dos karts remotos en cada cliente (`remotes: 2`).
  - **Corte real de red** en una pestaña: el servidor marcó al jugador como desconectado, el anfitrión
    mostró “Boreal se ha desconectado. Tiene unos segundos para volver.” y su fila quedó con
    `connected: false`. A los **13 s** se reactivó la conexión: llegó `race:resume` con `ownState`,
    la pestaña mostró “Te has reconectado a la carrera.”, recuperó los dos remotos y la clasificación
    volvió a `connected: true`. El margen es de 15 s.
  - **Caja y objeto:** se condujo el kart por la primera fila de cajas; el servidor concedió
    `IMPULSO`, la caja desapareció (24 → 23 activas) y el uso aplicó `itemBoostTime` 1,55 s con
    subida de velocidad. Un segundo uso devolvió `no-item` y no aplicó nada.
  - **Revancha desde la interfaz:** con un servidor de prueba (`PORT=3002`, `MAX_RACE_MS=5000`,
    `COUNTDOWN_MS=800`, `FINISH_GRACE_MS=1500`) y un Vite aparte (`5174`), la carrera terminó por
    tiempo, ambos clientes vieron la misma clasificación y el botón “Pedir revancha”. Al pulsarlo un
    no anfitrión apareció “Esperando a que el anfitrión pida la revancha…”; al pulsarlo el anfitrión,
    los dos volvieron al lobby, `status: lobby`, resultados ocultos y los 4 karts locales restaurados.
- **Comprobaciones de servicio:** `/health` devuelve `ok: true`; el cliente de Vite responde 200; una
  sala vacía se borra tras el TTL; el modo online solo escribe `turbo-circuit-online-name-v1` en
  `localStorage` y `turbo-circuit-online-client-v1` en `sessionStorage`.
- **Límite de esta validación:** todo se ha probado en **localhost y varias pestañas de la misma
  máquina**. **No se ha probado desde redes distintas ni por Internet**, así que no se afirma que el
  online funcione entre ubicaciones reales hasta completar esa prueba.

### Comprobado en la actualización anterior (rutas, desniveles y saltos)

- `npm.cmd run build` correcto con Vite 8.3.5: 30 módulos, `dist/assets/index-D0VXIJE9.js`
  779,54 kB (206,53 kB gzip) y CSS 66,33 kB (14,05 kB gzip). Solo aparece el aviso habitual de
  chunk > 500 kB; PowerShell devuelve código 1 por ese aviso, no por un error de compilación.
- **`npm.cmd test`: 62/62 correctas** con `node:test`, sin tocar los datos del navegador. Las 15
  nuevas (`tests/tracks.test.mjs`) se ejecutan en Node con `Track({ headless: true })`, la física
  real y la IA real; no hay umbrales rebajados para que pasen:
  - **Circuito y altura:** los seis mapas generan una vuelta cerrada, 720 muestras, 8 checkpoints,
    elevación con al menos dos keyframes y altura finita, no negativa y sin escalones > 0,9 m.
  - **Mecánicas:** cada mapa tiene al menos una rampa y un obstáculo móvil con medidas válidas.
  - **Bifurcaciones:** el ramal mide más de 80 m, tiene al menos 10 m de ancho, se separa de la
    calzada (mínimo 5,4 m libres entre bordes) y sus dos extremos quedan dentro de la calzada
    principal, con la altura empalmada.
  - **Proyección:** proyectar puntos del ramal devuelve esa ruta, un lateral inferior a 0,75 m y
    una `s` global coherente en cinco posiciones de cada ramal.
  - **Vueltas:** una vuelta limpia cuenta al cruzar todos los checkpoints; cruzar la meta sin
    checkpoints no concede vuelta, se registra como inválida y no teletransporta.
  - **Saltos:** en COSTA, CAÑÓN y ORBITAL el kart despega, vuela más de 0,15 s, alcanza más de 1 m
    de altura, aterriza una sola vez, termina con altura 0 y notifica el aterrizaje.
  - **Altura del kart:** en los seis mapas el kart sigue el desnivel del asfalto en cinco puntos y
    el modelo queda apoyado sobre él.
  - **Obstáculos:** ninguno cierra el ancho (más de 2 m libres), todos son más estrechos que la
    pista y de profundidad ≤ 3 m; golpean al kart y se pueden superar en el aire.
  - **Turbo y objetos en el ramal:** la placa de turbo del ramal responde solo en esa ruta; las
    cajas del ramal se recogen y los proyectiles salen con su ruta, altura y sin desaparecer.
  - **Carreras IA:** una carrera de 3 vueltas por la calzada principal y otra forzando el ramal en
    los seis mapas. Todas terminan, con 4 cruces de meta, 0 vueltas inválidas, 0 atascos y lateral
    máximo dentro del muro. Además, cuatro karts completan una carrera en COSTA sin bloquearse.
- **Datos geométricos de los seis circuitos** (medidos con `Track` real, no con estimaciones):

  | Circuito | Longitud | Ramal | Desnivel total | Checkpoints |
  | --- | ---: | ---: | ---: | ---: |
  | COSTA TROPICAL | 820,2 m | 136,3 m | 0 → 7,4 m | 8 |
  | MONTAÑA | 896,1 m | 165,2 m | 0 → 13,0 m | 8 |
  | CIUDAD FUTURISTA | 1041,2 m | 213,0 m | 0 → 6,2 m | 8 |
  | DISTRITO NEÓN | 912,3 m | 177,6 m | 0 → 4,6 m | 8 |
  | CAÑÓN SALVAJE | 975,4 m | 145,4 m | 0 → 6,0 m | 8 |
  | ESTACIÓN ORBITAL | 902,4 m | 181,8 m | 0 → 12,0 m | 8 |

- **Carreras completas con semilla** (un kart con el perfil de Vega, NORMAL, 3 vueltas): 76,5 s en
  COSTA, 83,1 s en MONTAÑA, 99,7 s en CIUDAD, 84,3 s en NEÓN, 91,4 s en CAÑÓN y 86,6 s en ORBITAL,
  siempre entrando en el ramal y sin atascos. Son tiempos de simulación, no de una partida humana.
- **Verificación visual sobre la compilación de producción** (Chromium, 800 × 620, consola limpia):
  - Vista aérea del ramal de los seis mapas: se ve la calzada principal, la ruta separada, sus
    bordillos y muros propios, los pilares de viaducto y la placa de turbo del ramal.
  - Vista de conducción sobre el ramal de los seis mapas: el kart circula por la ruta elevada, con
    la calzada principal al lado o por debajo, cajas de objetos y la incorporación al frente.
  - Salto en CAÑÓN desde el lateral: se aprecia la cuña de la rampa, el kart en el aire y su sombra
    sobre el asfalto. La cámara queda 9,9 m sobre el suelo proyectado, sin atravesarlo.
  - Minimapa de los seis circuitos: el ramal se dibuja como una bifurcación que sale y vuelve a la
    línea principal, sin recortarse.
  - Las capturas se tomaron del `canvas` de WebGL con `toDataURL` (los mismos píxeles que compone el
    navegador), porque la ventana del navegador de pruebas no estaba visible para el capturador.
- **Rendimiento estructural** (misma cámara de parrilla, 800 × 620, proporción de píxeles 1, solo
  render, mediana de 60 fotogramas tras 20 de calentamiento; llamadas y triángulos del mismo
  fotograma):

  | Circuito | Draw calls | Triángulos | Render (mediana) |
  | --- | ---: | ---: | ---: |
  | COSTA TROPICAL | 552 | 116.668 | 7,9 ms |
  | MONTAÑA | 373 | 119.338 | 7,1 ms |
  | CIUDAD FUTURISTA | 392 | 129.510 | 8,5 ms |
  | DISTRITO NEÓN | 370 | 128.754 | 10,8 ms |
  | CAÑÓN SALVAJE | 318 | 126.688 | 10,5 ms |
  | ESTACIÓN ORBITAL | 355 | 120.880 | 11,2 ms |

  Medido en pasadas anteriores, el coste completo de actualización + render se movió entre 7,5 y
  9 ms por fotograma tras calentar; justo después de cargar puede llegar a 11–26 ms por la
  compilación de shaders y texturas. La ventana no visible hace que `requestAnimationFrame` no sea
  fiable, así que los milisegundos absolutos sirven como orden de magnitud, no como FPS garantizados.
- **Memoria:** al alternar los seis circuitos tres veces, las geometrías se mantienen en 154–161 y
  las texturas en 37–49; repetir COSTA seis veces deja 136–137 geometrías y 46–52 texturas con
  fluctuación, sin crecimiento sostenido. Los materiales y geometrías de cada pista se liberan en
  `Track.dispose()`; las rutas reutilizan los materiales del asfalto, bordillo y muro.
- **Límites de esta verificación:** no se condujo a mano con teclado durante una vuelta completa ni
  se probó en un móvil físico. La comparación con la referencia antigua de NEÓN (369 llamadas y
  84.840 triángulos) no es directa: coincide el mapa y el tamaño, pero cambian la cámara, el estado
  y la propia versión. Las cifras nuevas describen esta versión, no una mejora o empeoramiento
  medido contra la anterior.

### Comprobado en la actualización anterior (pulido de conducción)

- `npm.cmd run build` correcto con Vite 8.3.5: 30 módulos, `dist/assets/index-*.js` 761,55 kB
  (201,08 kB gzip) y CSS 66,33 kB (14,05 kB gzip). Solo aparece el aviso habitual de chunk > 500 kB.
- **`npm.cmd test`: 47/47 correctas** con `node:test`, sin tocar datos del navegador:
  - **Conducción (10):** aceleración y frenada, giro con desplazamiento lateral, activación del
    derrape con velocidad + giro, no cargar parado, no cargar en recta, tope de carga sin velocidad
    gratis, no cargar contra el muro, un único turbo por derrape (y sin repetirlo al llamar de nuevo),
    fin automático con `turboJustEnded` + cooldown que bloquea el encadenado, y cancelación sin regalo.
  - **Feedback (7):** adelantamiento confirmado solo tras mantener la posición, cancelación al
    recuperarla, cooldown por rival en intercambios, reactivación pasada la espera, nunca avisar al
    perder posición, `reset` limpio e intensidades acotadas y proporcionales.
- **Chromium sobre la compilación de producción** (`vite preview`), sin errores ni avisos en consola y
  con `AudioContext` en `running` tras el gesto de inicio:
  - El HUD del turbo recorre `ESPACIO`, `CARGANDO`, `LISTO`, `¡MÁXIMO!`, `¡CORTO!`, `¡POTENTE!` y
    `RECARGANDO`, este último con la clase `cooldown` mientras dura la pausa posterior al turbo.
  - Turbo nivel 2: estela de chispas visible, FOV 62 → 65,23 y vuelta a 62, capa de audio con
    ganancia > 0 que baja sola y sin crear nodos nuevos en cada uso.
  - Cámara: una sacudida de 0,6 decae a 0 y la cámara renderizada vuelve exactamente a la referencia
    suave (desvío 0,057 → 0), manteniendo la altura mínima sobre el suelo.
  - Pausa, reinicio y vuelta al menú: partículas y ganancias a cero, ningún derrape ni turbo
    congelado, misma fuente de derrape reutilizada y sin objetos añadidos a la escena.
  - Silenciado: se guarda en `turbo-circuit-sound-v1`, se recupera tras recargar y no modifica
    `turbo-circuit-progress-v1`.
  - Adelantamiento: toast `2º` visible al confirmarse y retirado a los 1,3 s; sale de la clasificación
    real, no de la cámara.
- **Coste de los efectos:** en el mismo fotograma, con los mismos karts y la misma cámara, 452 draw
  calls con partículas activas y 450 sin ellas (**+2 exactos**). En reposo los pools se ocultan, así
  que el coste es 0. Los triángulos no cambian porque son puntos.
- **CPU:** 180 fotogramas sintéticos (actualización + render) dieron 9,53 ms con efectos y 10,04 ms
  sin ellos, una diferencia dentro del ruido de medición (±0,5 ms); no hay coste apreciable.
- **Límites de la medición:** el navegador de pruebas no entrega `requestAnimationFrame` de forma
  fiable cuando la ventana no está visible, así que el tiempo por fotograma absoluto no es comparable
  con la línea base antigua (369 draw calls y 84.840 triángulos en otro mapa y otro encuadre). La
  comparación válida es la del mismo fotograma con y sin partículas.
- **IA y humo:** el perfil del navegador solo tiene COSTA TROPICAL y dificultad FÁCIL (`driftChance`
  0,12) y la IA no derrapó en 60 s de muestreo, así que su humo natural no se pudo ver en vivo. Los
  emisores se comprobaron llamándolos directamente. Para asegurar que el cooldown nuevo (que se aplica
  igual a jugador y rivales) no apaga el derrape de la IA, se simularon 4 carreras completas en COSTA
  (NORMAL y DIFÍCIL, semillas 11 y 23): todas terminaron, sin choques con el muro, con **2,71 s** y
  **7,10 s** de derrape por carrera y 2,33 / 2,50 adelantamientos. La referencia de la versión anterior
  medía 3,99 s en FÁCIL de media en los seis mapas.

### Comprobado en la actualización anterior (economía, objetos y mapas)

- `npm.cmd run build` correcto con Vite 8.3.5: 28 módulos, `dist/assets/index-*.js` ≈ 744 kB
  (197 kB gzip) y CSS ≈ 65 kB. Solo aparece el aviso habitual de chunk > 500 kB.
- **Pruebas automáticas de economía (`npm.cmd test`):** 30/30 correctas con `node:test`, sobre
  almacenamiento simulado y sin tocar datos del navegador:
  - Perfil nuevo con Rayo, Costa y 0 monedas; precios y recompensas exactos.
  - Claves antiguas con Titán/Orbital que **no** desbloquean nada; perfil v1 con compras que sí se
    conserva.
  - Datos incompletos, saldo negativo/`NaN`/`Infinity`, ids inválidos y selección bloqueada reparados.
  - JSON corrupto copiado a `turbo-circuit-progress-v1.corrupt`.
  - Compra correcta, compra duplicada sin segundo cobro, saldo insuficiente sin cambios, ids y tipos
    inválidos rechazados.
  - Selección solo de contenido desbloqueado, cálculo de monedas que faltan y recompensas 20/40/70.
  - `saveProgress()` devuelve `false` si el almacenamiento lanza una excepción.
  - **Regresión de Orbital:** fuera de `maps` en un perfil nuevo y con precio 560; sigue bloqueado con
    0, 100 y 559 monedas; con 560 solo se desbloquea al comprar y el saldo queda en 0; la segunda
    compra no cobra; seleccionarlo o previsualizarlo no lo desbloquea; `ownsLoadout()` rechaza
    iniciar con Orbital sin comprarlo; un perfil antiguo con `turbo-circuit-map-v1 = orbital` no lo
    recibe; una compra legítima (560 ganadas) se conserva; un perfil contaminado con 0 o 200 ganadas
    pierde el desbloqueo imposible sin perder el saldo.
- **Economía y tienda (Chromium, compilación de producción):**
  - Perfil nuevo con `rayo` + `coast`, 0 monedas, 8 elementos bloqueados visibles y precios con
    "te faltan N" en el menú y en la tienda.
  - **Orbital (560):** con 0 y 559 monedas aparece `BLOQUEADO`, con el precio 560, "Te faltan 560" o
    "Te faltan 1" y el botón de compra desactivado. Con 560 sigue bloqueado hasta pulsar Comprar;
    tras la compra el saldo queda en 0, la tarjeta pasa a "Equipar" y la compra persiste al recargar.
    Equipar Orbital lo pone en uso y arrancar la carrera usa su pista. Un segundo intento de compra
    responde "Ya lo tienes desbloqueado" sin cobrar.
  - **Arranque forzado:** con la pista de Orbital preparada sin compra, o con `mapId`/`map`
    incoherentes, `startRace()` reconstruye Costa y arranca en Costa; nunca corre en Orbital.
  - **Perfil contaminado:** `maps: ["coast","orbital"]` con 0 monedas ganadas se repara a
    `["coast"]` al cargar; con 560 ganadas se conserva Orbital. El saldo no se toca.
  - Victoria FÁCIL/NORMAL/DIFÍCIL: +20/+40/+70 monedas, con posición, dificultad, monedas, saldo y
    botón de menú en la pantalla final. Una segunda llamada a `finishRace()` deja el saldo igual.
  - Derrota en DIFÍCIL: 0 monedas, 4.º puesto, saldo intacto y mensaje para volver a intentarlo.
  - Recarga del navegador: saldo, compras y selección se conservan.
  - Compra desde el botón (Centella: 200 → 50), estado "Equipar" tras comprar, equipo desde la
    tienda y persistencia tras recargar. Compra de circuito (Montaña: 130 → 10) y equipo del mapa.
  - Saldo insuficiente rechazado ("Te faltan 210 monedas"), sin descuento ni desbloqueo, con la
    tarjeta mostrando "Te faltan 210" y el botón desactivado.
  - Segundo intento de compra rechazado ("Ya lo tienes desbloqueado") sin volver a cobrar.
  - Selección de contenido bloqueado rechazada; forzar `kartId`/`mapId` bloqueados y arrancar la
    carrera cae de nuevo a Rayo/Costa.
  - Abrir y cerrar la tienda o recargar no concede monedas.
  - **Fallos de guardado simulados** lanzando `QuotaExceededError` en `localStorage.setItem`:
    compra deshecha sin cobro ("No se pudo guardar la compra. No se ha cobrado nada."), recompensa
    mostrada como `+0` con "No se pudo guardar la recompensa", selección de tienda y de menú
    revertidas con aviso visible.
  - Migración: solo claves antiguas → Rayo/Costa y 0 monedas, claves intactas; perfil v1 con
    Centella/Montaña y 130 monedas → se conserva sin regalar Titán/Orbital; JSON dañado → perfil
    seguro y copia del texto original.

- **Objetos, proyectiles y controles:** se usaron IMPULSO, PULSO, BARRERA, MINA, FURIA y PULSO DE
  IMPACTO; cada uno se consume, produce su efecto y no deja el objeto equipado. El botón táctil de
  gas activa y libera el acelerador con Pointer Events y el teclado sigue respondiendo a acelerar,
  frenar y girar.
- **Recursos:** tras cuatro ciclos completos por los seis circuitos, `renderer.info.memory` se
  mantiene estable (134 geometrías, 25 texturas, 19–21 programas). Se corrigió `Track.dispose()`
  para liberar también `bumpMap`, `emissiveMap` y el resto de ranuras de textura; antes crecía una
  textura por circuito y vuelta. La consola no muestra errores ni avisos.
- **Rendimiento:** 180 fotogramas de carrera en DISTRITO NEÓN a 800 × 620: 17,55 ms de media
  (≈57 FPS en el navegador de pruebas), 369 llamadas de dibujo y 84.840 triángulos.
- **Dificultad:** 54 carreras simuladas (6 circuitos × 3 dificultades × 3 semillas: 11, 23 y 37),
  sustituyendo al jugador por un bot de referencia fijo en NORMAL:
  - FÁCIL: 18/18 victorias, posición media 1,00, rivales +5,06 s/vuelta.
  - NORMAL: 9/18 victorias (50 %), posición media 2,11, rivales +0,31 s/vuelta.
  - DIFÍCIL: 0/18 victorias, posición media 3,72, rivales −0,65 s/vuelta; el bot solo pudo ser 2.º
    en COSTA (semilla 23) y 3.º en varias carreras.
  - Derrape medio de los rivales: 3,99 / 13,38 / 15,15 s por carrera; objetos recogidos: 3,48 /
    4,72 / 4,94; adelantamientos: 2,52 / 3,78 / 3,89. Los rivales no se teleportan ni reciben
    velocidad gratis: la ventaja sale de la física, la frenada y la trazada.

### Histórico de versiones anteriores

> Los datos de esta sección corresponden a versiones anteriores del juego y se conservan como
> referencia. Por eso mencionan tres circuitos, cuatro karts o claves de guardado antiguas; la versión
> actual tiene seis circuitos, tienda con monedas y una única clave `turbo-circuit-progress-v1`.

- `npm install` ya estaba hecho y se ha mantenido la misma instalación con Node.js 24 y npm 11.
- `npm.cmd run build` ejecutado correctamente con Vite 8 después de integrar mapas, karts, vista
  previa y el nuevo despliegue estático. Vite sigue avisando de que el paquete de Three.js supera los
  500 kB; es un aviso de tamaño, no un error.
- Validación geométrica de los tres trazados con Three.js: longitudes de 820 m (COSTA), 896 m
  (MONTAÑA) y 1041 m (CIUDAD), sin autointersecciones y con radios mínimos de 28,0 m, 16,6 m y
  18,7 m respectivamente. Las cajas de objetos caben dentro del ancho de los tres circuitos.
- Simulación de carreras completas en Node (sin navegador) sobre los puntos de control reales de los
  tres mapas, con física, colisiones por masa, IA, cajas y objetos reales. Los cuatro karts
  completaron las 3 vueltas en los nueve cruces mapa × dificultad, sin `NaN`, sin salirse de los
  muros y con `maxStuck=0,00 s`.
- Comparativa de la media de los tres rivales antes y después del ajuste de IA:
  - FÁCIL: 121,9 s → **112,5 s** (COSTA 97,6 / MONTAÑA 114,3 / CIUDAD 125,5).
  - NORMAL: 104,8 s → **97,3 s** (85,9 / 96,2 / 109,8).
  - DIFÍCIL: 98,5 s → **89,7 s** (79,1 / 88,4 / 101,7).
  Cada nivel es más rápido que su propia referencia en los tres mapas. DIFÍCIL queda 7,6 s por
  delante de NORMAL y 6,6 s por delante del jugador simulado (Rayo) de media. Vega gana en MONTAÑA
  y CIUDAD; Nilo, en COSTA.
- La IA derrapa en los nueve cruces y encadena turbo en la mayoría. En FÁCIL algunos rivales aún no
  llegan a activarlo, como corresponde a su conducción más prudente. Los derrapes se cuentan con la
  física real (`driftActive`), no con la intención del controlador.
- Pruebas lógicas cortas en Node de la versión anterior que siguen vigentes: validación de
  dificultades y persistencia, aplicación real de parámetros a los karts, colisión barrida del
  proyectil, impacto único, protección de BARRERA, conservación de proyectiles al pausar, limpieza al
  reiniciar y tiempo mínimo de disparo de la IA.
- Simulación lógica de derrape/turbo de la versión anterior: mantener `Espacio` sin girar no carga
  nada; un derrape con giro llena la barra y activa el nivel 2; el turbo termina solo y no se
  reactiva sin un nuevo derrape; el tope combinado de turbo + IMPULSO es 42,37 m/s (no se suma el
  51,86 m/s teórico); PULSO, BARRERA, sus caducidades y el reinicio de estados se comportan como se
  espera.
- **Verificación visual en Chromium** de la compilación de producción servida con `vite preview`:
  capturas a 1280 × 720, 800 × 620 y ventanas estrechas de 390 × 700 y 360 × 640. El menú mantiene
  visibles circuito, dificultad, kart, vista previa 3D, estadísticas y botón de inicio, sin solapes
  ni texto tapado. En 1280 × 720 y 800 × 620 entra completo sin desplazamiento. En 390 × 700 y
  360 × 640 el cuerpo del menú se desplaza y el pie con **Empezar carrera** queda fijo, de modo que
  el contenido que no cabe se alcanza con scroll sin quedar oculto bajo el botón.
- La interacción de los selectores, el guardado en `localStorage` y el arranque de la carrera ya se
  comprobaron en Chromium en una pasada anterior sobre 800 × 620. Las capturas nuevas validan la
  composición responsive.
- **Verificación táctil en Chromium** sobre la compilación de producción, con viewports reales
  simulados dentro de un iframe de 390 × 844 (vertical) y 844 × 390 (horizontal):
  - Menú, carrera, pausa y resultados caben sin desbordamiento horizontal; en horizontal los
    resultados se compactaron hasta dejar visibles los botones **Volver a jugar** y **Menú**.
  - Multitáctil con Pointer Events: acelerar y girar a la vez, liberar un dedo sin perder el otro,
    soltar todo y reiniciar el estado táctil al empezar una carrera nueva.
  - Derrape táctil: con giro y velocidad suficiente se activa `driftActive` y sube `driftCharge`;
    al salir al césped se cancela sin regalar turbo, igual que con teclado.
  - Botón **OBJETO**: consume un `IMPULSO` equipado y activa el impulso, reutilizando la mecánica
    de la tecla `E`.
  - Pausa y reanudación desde los botones táctiles, reinicio con **Reiniciar** y vuelta al menú con
    **Menú**, sin dejar controles pulsados ni efectos activos.
  - Selección táctil de circuito, kart y dificultad: se actualiza el estado del juego y se guarda en
    `localStorage` (`turbo-circuit-map-v1`, `turbo-circuit-kart-v1`,
    `turbo-circuit-difficulty-v1`).
  - Áreas seguras simuladas (`--safe-top: 47px`, `--safe-bottom: 34px`): el minimapa y el
    velocímetro quedan por debajo del HUD superior sin solaparse, y los botones no invaden la barra
    de gestos.
  - Cambio de orientación en caliente (390 × 844 → 844 × 390): el renderizador se redimensiona, el
    `aspect` pasa a 2,16, el FOV vuelve a 62 y no hay overflow, sin recrear la escena.
  - Escritorio a 800 × 620: los controles táctiles y el aviso de orientación permanecen ocultos, la
    lista de teclado se muestra y `WASD` sigue funcionando. `?touch=0` fuerza ese modo de interfaz.
- **No se ha verificado a fondo en navegador** la conducción manual, el aspecto de los tres
  circuitos en carrera, el cambio visual entre los cuatro karts (solo se comprobó Rayo y Centella)
  ni el diseño en móviles físicos. Las pruebas de partida completa en Chromium, pausa, cambio de
  pestaña, sonido y diseño responsive mencionadas antes corresponden a una versión **anterior** del
  juego.

### Pendiente de probar a mano

- **Conducción manual de los seis circuitos nuevos:** recorrer a mano (teclado y táctil) la calzada
  y el ramal de cada mapa, comprobar la sensación de las subidas y bajadas, que los muros del ramal
  no rocen de más, que las bocas se lean a alta velocidad y que la cámara no tape la bifurcación.
  El aspecto estático sí se verificó con capturas; falta la sensación al volante.
- **Saltos y obstáculos en partida real:** medir a mano si el salto de cada rampa se siente útil,
  si el control aéreo basta para corregir sin ser excesivo, si el aterrizaje castiga de más y si las
  rocas, puertas y plataformas se pueden esquivar sin frenar en seco. También si su ritmo no
  bloquea la trazada de la IA en carrera.
- Aspecto real del resto de circuitos (decoración, iluminación nocturna, mar, montaña, cañón y
  orbital) en movimiento, encuadre de la cámara cenital del menú y legibilidad del minimapa en
  pantalla pequeña. La vista aérea, la vista a bordo, un salto lateral y los seis minimapas ya se
  revisaron en capturas estáticas.
- Funcionamiento visual de la vista previa 3D del kart, cambio entre los cuatro modelos y ajuste del
  canvas en ventanas estrechas.
- Prueba en un móvil o tableta físicos (Android/iPhone): latencia real del táctil, zoom y scroll del
  navegador, gestos del sistema, muesca y barra de gestos reales y rendimiento de la GPU. La lógica
  multitáctil y la composición sí se validaron en Chromium con viewports simulados de 390 × 844 y
  844 × 390, pero no en hardware real.
- **Derrape con teclado y con táctil:** que se active al girar con velocidad, que la trayectoria se
  pueda corregir con el volante y que al soltar la recuperación sea suave (sin latigazos). Comprobar
  que en recta, parado o contra el muro no sube la barra, que el nivel 2 se alcanza en curvas largas y
  que tras gastar el turbo la pausa `RECARGANDO` (~0,5 s) se siente justa y no frustrante.
- **Diferencia entre karts:** repetir el mismo derrape con Rayo, Centella, Lira y Titán y decidir si
  las diferencias (agarre, inercia, tiempo de carga) se notan sin que ninguno quede inútil.
- **Turbo:** que el empujón se note, que el FOV y las chispas no mareen ni tapen rivales u objetos y
  que el sonido suba y baje de forma progresiva. Comprobar el caso de turbo + IMPULSO a la vez.
- **Audio reactivo:** volumen relativo de motor, derrape, turbo, golpes, muro y avisos; que no se
  solapen ni saturen y que el silenciado (`M`) corte todo y se recuerde al recargar.
- **Impactos y adelantamientos:** que la chispas y el destello duren lo justo, que el toast de
  adelantamiento no aparezca al perder posición ni se repita al intercambiarse con el mismo rival y
  que no tape el HUD en pantalla pequeña.
- **Cámara:** comprobar en curvas cerradas, rampas y choques que la anticipación lateral ayuda, que
  la sacudida es breve, que no se atraviesa el suelo ni se pierde de vista la pista, y que el FOV de
  turbo se restaura al terminar.
- Aspecto visual de las llamas, líneas de velocidad, cajas, onda de PULSO, burbuja de BARRERA,
  esfera del PULSO DE IMPACTO y destello de impacto.
- Que el proyectil salga del morro en la dirección correcta con distintos ángulos de giro, que se
  pueda esquivar y que no queden esferas abandonadas tras pausar, reiniciar, volver al menú o
  terminar.
- Que `Espacio` y `E` no activen botones de la interfaz y que el foco se comporte bien tras usar los
  botones de pausa, menú y resultados.
- Pausa en mitad de un derrape, turbo o proyectil, y cambio de pestaña con un objeto activo. Los
  botones **Volver a jugar**, **Reiniciar** y **Menú** sí se recorrieron en Chromium, pero no con
  efectos a medias.
- Sensación real de dificultad con conductor humano. El equilibrio ya se midió con 54 carreras
  simuladas (ver arriba), pero falta comprobar a mano que FÁCIL permita aprender y ganar, NORMAL
  compita y DIFÍCIL exija dominar trazadas y objetos sin resultar injusto.
- Calidad subjetiva del audio (motor, derrape, turbo, disparo, impacto, recogida y uso de objetos,
  victoria y derrota) en altavoces y auriculares.

- **Online entre redes distintas:** crear una sala desde una red y unirse desde otra (Wi-Fi + datos
  móviles), comprobar `https/wss`, latencia, pérdida de paquetes y reconexión real. Hasta ahora solo
  se ha probado en localhost.
- **Online con 3–4 dispositivos físicos:** repetir la carrera completa (3 vueltas, cajas, objetos y
  meta) con portátiles/móviles distintos, no solo pestañas del mismo equipo. La prueba automática de
  4 jugadores usa sockets locales y no mide latencia ni interpolación visual.
- **Online con el servidor dormido:** medir el arranque en frío de Render Free, comprobar que las
  salas en memoria se pierden y que el cliente muestra un error comprensible al intentar reconectar.
- **Objetos online restantes:** probar a mano `BARRERA` y `PULSO` en una sala real, incluidos los
  aciertos entre karts y la inmunidad de la barrera. La lógica del servidor (objetivos del PULSO,
  BARRERA sin objetivos y rechazo de `MINA`/`FURIA`) ya está cubierta por prueba automática, y el
  `IMPULSO` con su segundo uso rechazado se comprobó en Chromium; falta la sensación en partida.
- **Pausa y salida en online:** pausar durante una carrera online, cambiar de pestaña, abandonar y
  volver a entrar. La reconexión de red ya se probó; faltan estos casos de interfaz.
- **Navegadores y móviles reales:** Firefox y Safari no se han probado. En iOS, el WebSocket y el
  audio pueden comportarse distinto al perder el foco.

No se ha probado en Firefox, Safari ni en dispositivos físicos (móviles o tablets), así que la
experiencia táctil real (latencia, gestos del sistema y muescas) sigue pendiente de validación en
hardware. Si encuentras un fallo, abre la consola (F12), copia el mensaje de error y revisa primero
la sección de problemas frecuentes.
