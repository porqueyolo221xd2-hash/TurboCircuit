# Turbo Circuit

Carrera de karts arcade en 3D para el navegador. Todos los personajes, vehículos, circuitos y
gráficos son originales y se generan con código: no se usan imágenes, modelos ni servicios externos.

**Tecnologías:** JavaScript, [Three.js](https://threejs.org/) y [Vite](https://vite.dev/).

---

## 1. Requisitos en Windows

- **Node.js LTS** (versión 20 o superior). Descárgalo de <https://nodejs.org/>.
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

Esto descarga Three.js y Vite dentro de la carpeta `node_modules`. Solo hay que hacerlo la primera vez
(o cuando cambien las dependencias).

---

## 3. Jugar en local

```powershell
npm run dev
```

Abre en el navegador la dirección que muestra la terminal, normalmente:

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

En el menú puedes elegir **circuito** (COSTA TROPICAL, MONTAÑA o CIUDAD FUTURISTA), **kart**
(Rayo, Centella, Lira o Titán) y **dificultad** antes de empezar. La vista previa 3D del kart se
actualiza al instante. Las tres elecciones se guardan en `localStorage` y se recuperan en la próxima
visita; si el navegador las bloquea, el juego usa valores seguros por defecto.

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
- Tres circuitos jugables con trazado, anchura, minimapa, cajas de objetos, decoración y ambiente
  propios. La física, las vueltas, la clasificación y la IA son compartidas:
  - **COSTA TROPICAL**: curvas amplias, arena, palmeras, playa y mar.
  - **MONTAÑA**: trazado más estrecho y técnico entre pinos, rocas, lago y montañas.
  - **CIUDAD FUTURISTA**: circuito nocturno de rectas largas y chicanes, con edificios iluminados,
    neón y muros oscuros.
- Cuatro karts jugables, cada uno con física y silueta propias. Ninguno es mejor en todo:
  - **Rayo** (equilibrado), **Centella** (mucha punta, menos agarre), **Lira** (muy ágil y rápida de
    aceleración, menor velocidad punta) y **Titán** (pesado, acelera menos pero aguanta mejor los
    roces y los impactos).
- Vista previa 3D real del kart en el menú, con giro automático, botones de anterior/siguiente y
  barras de velocidad, aceleración, agarre y estabilidad.
- Kart original con carrocería, ruedas, piloto, alerón y escapes, con animación de ruedas y balanceo.
  Cada estilo cambia chasis, morro, pods, alerón, distancia entre ejes y sombra de contacto.
- Cámara de persecución suavizada, con un pequeño efecto de velocidad (FOV).
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
  nada. Hay dos niveles (turbo corto y turbo potente), con barra en el HUD, llamas en los escapes,
  líneas de velocidad y un sonido breve. Un mismo derrape solo puede generar una activación.
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
- Sonido generado con WebAudio (motor, pitidos, turbo, recogida de objetos y melodía final) sin
  archivos externos.

No se ha añadido multijugador, cuentas, tienda, monedas, bases de datos ni servicios externos.

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
└─ src/
   ├─ main.js                 Punto de entrada, detección táctil y captura de errores WebGL
   ├─ style.css               Estilos arcade, diseño responsive y controles táctiles
   └─ game/
      ├─ Game.js              Escena, estados, carrera, cámara y bucle principal
      ├─ Track.js             Pista compartida y decoración según el mapa
      ├─ maps.js              Definición de los tres circuitos y persistencia
      ├─ Kart.js              Modelo del kart, física, derrape y efectos
      ├─ karts.js             Karts jugables, rivales y persistencia
      ├─ KartPreview.js       Vista previa 3D del kart en el menú
      ├─ AIController.js      Perfiles de IA, trazada, adelantamientos y recuperación
      ├─ ItemSystem.js        Cajas, objetos, ondas, proyectiles y decisiones de la IA
      ├─ items.js             Definición de IMPULSO, PULSO, BARRERA y PULSO DE IMPACTO
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

El proyecto es estático: no necesita servidor, base de datos ni variables secretas. La base por
defecto es `/`, así que funciona directamente en Vercel, Netlify o un dominio propio. GitHub Pages
necesita una subcarpeta y ya está contemplada con `VITE_BASE`.

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
   salida `dist`. No hay variables de entorno ni secretos que configurar.
5. Pulsa **Deploy**. La URL será similar a `https://turbo-circuit.vercel.app/`. Cada `git push` a
   `main` publica una versión nueva automáticamente.

`vercel.json` ya fija el comando y la carpeta de salida. Si prefieres no importar el repositorio,
también puedes ejecutar `npx vercel` desde la carpeta del proyecto.

### Alternativa: Netlify

1. Crea una cuenta en <https://www.netlify.com/> y elige **Add new site → Import an existing project**.
2. Conecta el repositorio. `netlify.toml` ya define `npm run build`, la carpeta `dist` y Node 22.
3. Publica. La URL será algo como `https://turbo-circuit.netlify.app/`.

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
- **El sonido no arranca hasta pulsar un botón**: es una norma de los navegadores. Pulsa **Empezar
  carrera** y el audio se activa.

---

## 9. Estado de las pruebas

### Comprobado en esta versión

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

- Aspecto real de los tres circuitos (decoración, iluminación nocturna de la ciudad, mar y montaña),
  encuadre de la cámara cenital del menú y legibilidad del minimapa de cada mapa.
- Funcionamiento visual de la vista previa 3D del kart, cambio entre los cuatro modelos y ajuste del
  canvas en ventanas estrechas.
- Prueba en un móvil o tableta físicos (Android/iPhone): latencia real del táctil, zoom y scroll del
  navegador, gestos del sistema, muesca y barra de gestos reales y rendimiento de la GPU. La lógica
  multitáctil y la composición sí se validaron en Chromium con viewports simulados de 390 × 844 y
  844 × 390, pero no en hardware real.
- Sensación real de conducción, derrape y turbo con teclado (incluida la dificultad para alcanzar
  el nivel 2 en curvas cortas).
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
- Equilibrio real de la dificultad: que FÁCIL permita aprender y ganar, NORMAL compita y DIFÍCIL
  exija una buena conducción sin resultar injusto.
- Calidad subjetiva del audio nuevo (turbo, disparo, impacto, recogida y uso de objetos).

No se ha probado en Firefox, Safari ni en dispositivos físicos (móviles o tablets), así que la
experiencia táctil real (latencia, gestos del sistema y muescas) sigue pendiente de validación en
hardware. Si encuentras un fallo, abre la consola (F12), copia el mensaje de error y revisa primero
la sección de problemas frecuentes.
