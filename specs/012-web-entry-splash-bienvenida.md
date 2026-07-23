# Spec 012 — Entrada web: splash + bienvenida (login o registro)

> **Estado:** aprobado e implementado en el mismo ciclo (pedido de punta a punta por Stiven, sin punto de parada intermedio).
>
> **Contexto:** `../arquitectura-v1.2.md`. No agrega puertos de dominio ni endpoints nuevos — reordena la entrada de `app/` (repo porcia-app) sobre funcionalidad de registro (spec 001) y login (implementado junto con 001, endpoints `/auth/*`) que ya existe.

---

## 1. Resumen General

Hoy `app/` arranca directo en el paso 0 del wizard de registro (`RolePage`, "¿Cómo te unes a PorcIA?"). No hay ninguna pantalla de entrada: el usuario cae en medio de una decisión de registro sin contexto de marca, y el acceso a "ya tengo cuenta" es un botón ghost secundario fácil de pasar por alto.

Este spec agrega, antes del wizard, dos pantallas nuevas puramente de frontend:

1. **Splash** — pantalla de marca a pantalla completa (logo + nombre), como el cold-start de una app móvil. Sin decisiones, se desvanece sola.
2. **Bienvenida** — pregunta explícita "¿Cómo quieres continuar?" con dos caminos: **Iniciar sesión** o **Registrarme**.

No introduce backend nuevo: reutiliza `LoginPage` y el wizard de registro tal como existen hoy.

## 2. Objetivos del Usuario

- **Como cualquier visitante de la web**, quiero ver primero la marca de PorcIA (no un formulario) al abrir la app, para que se sienta como abrir una app, no aterrizar a mitad de un trámite.
- **Como usuario que ya tiene cuenta**, quiero que "iniciar sesión" sea una opción igual de visible que "registrarme", no un enlace secundario debajo de las tarjetas de registro.
- **Como usuario nuevo**, quiero que "registrarme" me lleve exactamente al wizard que ya existe, sin fricción adicional.

## 3. Alcance Estricto

### Incluye v1

- Pantalla **splash**: logo (`porcia-mark.png`) + wordmark "PorcIA", fondo de marca a pantalla completa, se mantiene ~1.1s y pasa sola a bienvenida; también puede saltarse con un click/tap. Respeta `prefers-reduced-motion` (ya global vía `tokens.css`).
- Pantalla **bienvenida**: logo + título + botón primario "Registrarme" (entra al wizard existente en el paso "rol") + botón ghost "Ya tengo cuenta" (entra a `LoginPage`, ya implementado).
- El botón "Ya tengo cuenta" que hoy cuelga bajo `RolePage` (paso 0 del wizard) se retira de ahí — su único lugar pasa a ser la pantalla de bienvenida.
- Volver ("Volver") desde `LoginPage` regresa a bienvenida, no directo al wizard de registro.
- Cambio 100% en `app/` (`App.tsx` + dos componentes nuevos en `pages/`). Sin cambios de contrato HTTP, dominio ni base de datos.

### NO incluye v1 (deuda intencional, explícita)

- **Restaurar sesión automáticamente** si ya existe un JWT válido en `localStorage` (saltar splash/bienvenida e ir directo al perfil). Existe `getToken()` en `lib/api.ts` pero no se usa en ningún flujo hoy; esto es una feature de "sesión persistente" aparte, sin pantalla de destino todavía (no hay ruta que solo cargue el perfil desde un token existente).
- Rutas de navegador (URLs distintas por pantalla) — `app/` sigue siendo una sola página sin router; el splash se ve en cada carga completa, igual que el cold-start de una app nativa.
- Animaciones de transición elaboradas entre splash → bienvenida → wizard; se usa la transición mínima ya establecida en el resto de `app/`.

## 4. Comportamiento Esperado

1. Al cargar `app/` (`GET /`), se muestra **splash** de inmediato.
2. Tras ~1.1s (o al hacer click/tap en cualquier punto del splash), pasa a **bienvenida**.
3. En bienvenida:
   - Click en **"Registrarme"** → entra al wizard existente, paso 0 (`RolePage`), sin cambios de comportamiento respecto a hoy.
   - Click en **"Ya tengo cuenta"** → entra a `LoginPage` (flujo OTP de login ya implementado, sin cambios).
4. Desde `LoginPage`, el botón **"Volver"** regresa a **bienvenida** (antes volvía al wizard).
5. Desde el wizard (`RolePage`, paso 0) ya no hay botón de "Ya tengo cuenta" — ese acceso vive únicamente en bienvenida.
6. El resto del wizard (pasos 1 en adelante, OTP, perfil, etc.) no cambia.

## 5. Manejo de Errores

No aplica: esta pantalla no llama a ningún endpoint ni maneja estado de red. Los errores del wizard de registro y de `LoginPage` (ya cubiertos por specs previos) no cambian.
