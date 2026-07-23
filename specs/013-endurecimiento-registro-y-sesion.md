# Spec 013 — Endurecimiento del registro, la sesión y la navegación

> **Estado:** implementado (2026-07-23); ampliado el mismo día con §4.6–4.7
> (respuestas dictadas y voz de salida). El frontend está en producción; el
> backend queda pendiente de promover con `npx vercel --prod` — en esta rama
> `git push` solo crea un preview.
>
> **Naturaleza distinta a los demás specs de este índice:** los otros se
> escriben ANTES de implementar. Este documenta una **corrección de defectos**
> encontrados al probar el flujo real de spec 001 en web y Telegram; se
> redacta después para dejar constancia de qué se rompió, por qué y cuál es
> ahora la regla vigente. Los invariantes que fija aquí (§4) sí son
> vinculantes hacia adelante.
>
> **Contexto:** `../arquitectura-v1.2.md` §5 (identidad) y §8 (autenticación).

---

## 1. Resumen General

Stiven probó el registro end-to-end y reportó cuatro síntomas: no había botón
de atrás, recargar la página perdía la sesión, no parecía existir validación
de duplicados, y el chat se comportaba raro al corregir. Al rastrear cada uno
aparecieron **16 defectos**, entre ellos una falla de seguridad que permitía
quedarse con la sesión de otra persona.

El hallazgo estructural: **la validación de duplicados sí existía en el
backend, pero la web descartaba todos los códigos de error**, así que en
pantalla todo se veía igual ("Algo salió mal de nuestro lado"). Varios
"faltantes" reportados eran en realidad esa falla de traducción.

## 2. Objetivos del Usuario

- **Como cualquier persona**, quiero que registrarme con un documento o correo
  ya usado me lo diga con claridad y en el campo correcto, no con un error
  genérico al final del formulario.
- **Como titular de una cuenta**, quiero que nadie pueda quedarse con ella
  sabiéndose mi número de cédula.
- **Como usuario de la web**, quiero que recargar la página no me expulse, y
  que el botón atrás (incluido el del teléfono) retroceda un paso en vez de
  sacarme del sitio.
- **Como usuario de Telegram**, quiero corregir un dato sin perder los otros
  diez que ya respondí, poder volver atrás y poder cancelar sin que la palabra
  "cancelar" quede guardada como el nombre de mi finca.
- **Como trabajador con solicitud pendiente**, quiero poder volver a entrar
  mientras el dueño la aprueba.

## 3. Alcance Estricto

### Incluye

**Seguridad e integridad**
- Regla de "misma persona" en `RegisterFarmAndUser` (§4.1).
- `duplicate_email` como error de dominio → HTTP 409.
- `findUserByEmail` compara sin distinguir mayúsculas, igual que el índice
  único `app_user_email_idx on (lower(email))`.

**Contrato HTTP**
- `GET /account/me` — perfil de la sesión vigente (único endpoint de lectura).
- `POST /register/check-availability` — ¿documento/correo libres?

**Web (`app/`)**
- Lectura correcta de `{ error: { code, message } }` y uso del mensaje del
  backend.
- Duplicados devuelven al paso y campo culpables.
- Restauración de sesión al arrancar y perfil real tras iniciar sesión.
- Cerrar sesión. Atrás en el paso de rol. Historial del navegador.
- Aviso de duplicado al salir del campo.

**Telegram**
- `correctPick`: corregir un dato conservando los demás.
- Comandos globales "atrás" y "cancelar" (con confirmación).
- Los borradores sobreviven a los errores del registro.

**Login**
- Una membresía `pendiente` también emite sesión.

### NO incluye

- **Verificación de celular duplicado.** `phone_hash` sigue sin ser único a
  propósito (migración 0006): dos personas pueden *afirmar* el mismo número
  mientras ninguna lo pruebe; solo la columna probada da acceso. Cambiarlo
  exigiría decidir qué pasa cuando alguien se equivoca al teclear el número
  de otro, y eso es un spec aparte.
- **Permisos por estado de membresía en las APIs de lectura.** `GET
  /account/me` devuelve el perfil propio; cuando existan endpoints de datos
  productivos, cada uno deberá exigir `operator.status = 'activo'`.
- **Mostrar el celular en el perfil tras recargar.** De él solo se guarda el
  HMAC; la interfaz indica que está guardado, no el número.

## 4. Comportamiento Esperado

### 4.1 Regla de "misma persona" (invariante vinculante)

Al registrar, si la identificación ya existe, **solo se continúa si quien
envía demuestra ser el titular**. Hay exactamente dos pruebas válidas:

1. `app_user.channel_user_hash` ya está atado a esa cuenta y coincide con el
   canal de quien escribe.
2. La cuenta aún no tiene canal atado y este intento **verifica justo el
   celular que aquella cuenta declaró** (`app_user.phone_hash`) — el caso
   legítimo de "me registré verificando solo el correo y ahora completo mi
   identidad" (spec 001 §4.3).

Cualquier otro caso es `duplicate_identification`.

> **Por qué importa:** el adaptador web manda siempre `phoneVerified:false`,
> así que ninguna cuenta creada por web tiene `channel_user_hash`. El guard
> anterior solo miraba esa columna, de modo que nunca se activaba para esas
> cuentas: el intento caía en la rama multi-granja, le agregaba la finca a la
> cuenta ajena y **devolvía un JWT con el `userId` de la víctima**.

### 4.2 Correo

Único en `app_user` (índice `app_user_email_idx`). El caso de uso lo consulta
**antes** de insertar y responde `duplicate_email` (409). Antes el choque
ocurría en la base y salía como fallo de persistencia (500).

### 4.3 `GET /account/me`

`200` con `{ user: { id, identificationType, identificationNumber, email,
displayName?, emailVerified, phoneVerified }, farms: [{ farmId, name,
legalType, taxIdType, taxId, location, cebaCapacity, breedingCapacity,
totalCapacity, sanitaryRegistry, role, membershipStatus }] }`.
`401 unauthorized` si el token falta, venció o el usuario ya no existe.
**El celular no viaja**: solo existe hasheado.

### 4.4 `POST /register/check-availability`

Cuerpo: `{ identificationType, identificationNumber }` **o** `{ email }`.
Respuesta `200 { available: boolean }`. Es **POST** para no dejar cédulas ni
correos en el query string de los registros de acceso, y lleva cuota por IP
(mismo limitador que la búsqueda pública de fincas).

> **Compromiso aceptado:** es un oráculo de cuentas existentes — permite
> preguntar si una cédula está registrada. Se priorizó el aviso temprano
> sobre la no-enumeración (decisión de Stiven, 2026-07-22); la cuota es lo
> que impide barrerlo a escala. `/auth/*` mantiene su respuesta uniforme.

### 4.5 Chat: corregir, atrás y cancelar

- **"Corregir"** en el resumen lleva a `correctPick`, que lista los datos ya
  respondidos. Al elegir uno se borra **solo ese campo**; como `nextStep`
  calcula el siguiente campo faltante, la máquina vuelve a esa pregunta y,
  al responderla, regresa sola al resumen.
- **"atrás"/"volver"** retrocede una pregunta (borra la respuesta anterior
  según el orden del rol). **"cancelar"** pide confirmación antes de
  descartar. Se interceptan **antes** de aplicar la respuesta al paso
  vigente, y no en los pasos que ya tienen decisión propia (resumen,
  aprobación, otra finca).
- El borrador se vuelve a guardar en **todos** los caminos de error: la
  lectura es destructiva (`takePending`), así que no reponerlo obligaba a
  repetir el registro entero.

### 4.6 Respuestas dictadas (agregado el 2026-07-23)

Contestar por nota de voz vale en **todos** los pasos, igual que texto y
botones. La voz siempre se transcribió bien; lo que fallaba era emparejar la
frase con la pregunta, así que la regla es sobre el emparejamiento:

- `matchOption` empareja además por **afirmación coloquial** (reutilizando
  `parseShortReply`) y por **palabras distintivas** de cada etiqueta. Whisper
  devuelve frases naturales con puntuación ("Soy dueño."), nunca la etiqueta
  exacta; antes eso caía en "No reconocí esa opción" hasta que a los tres
  intentos el flujo mandaba al usuario a la web.
- **Ambiguo ⇒ se repregunta, nunca se adivina.** "cédula" no puede decidir
  entre ciudadanía y extranjería. Al agregar opciones nuevas hay que
  comprobar que cada una tenga alguna palabra que no comparta con las otras.
- `normalizeSpokenNumber` toma el número aunque venga acompañado ("son 250
  cerdos") o con el punto final que agrega Whisper ("50."). Con dos números
  distintos no elige.
- **El correo se dicta** ("juan arroba finca punto co") y se lee de vuelta
  antes de guardarlo, como la cédula y el NIT — revierte spec 001 §4.1.3.
  Escrito sigue sin confirmación extra.
- "atrás" durante una lectura de vuelta vuelve a pedir ese mismo dato, y
  corregir/retroceder descarta el valor pendiente para no dejar el flujo
  dando vueltas.

### 4.7 Voz de salida (TTS)

ElevenLabs cuando `ELEVENLABS_API_KEY` está definida; TTS de OpenAI cuando
falta. La elección vive en `buildSynthesizer` (`config/container.ts`). Se
eligió opcional —y no obligatoria como en `main`— para que una credencial
ausente apague una capacidad en vez de impedir el arranque, igual que los
canales.

### 4.8 Login con membresía pendiente

`LoginWithOtp.verify` prefiere una membresía `activo`, pero si solo hay
`pendiente` también emite sesión. Antes devolvía `invalid_credentials`, el
mismo mensaje que un código equivocado.

## 5. Manejo de Errores

| Código | HTTP | Cuándo |
|---|---|---|
| `duplicate_identification` | 409 | La identificación es de otra persona (§4.1) |
| `duplicate_email` | 409 | El correo ya tiene cuenta |
| `duplicate_farm` | 409 | La misma persona repite la misma finca (tax_id + nombre) |
| `already_member` | 409 | El trabajador ya tiene membresía en esa finca |
| `farm_not_found` | 404 | La finca del trabajador no existe |
| `validation` | 400 | Mensaje del dominio, con el campo exacto |
| `unauthorized` | 401 | Sesión ausente, vencida o de un usuario borrado |
| `rate_limited` | 429 | Cuota de OTP, búsqueda o disponibilidad |

**Regla de traducción (web):** el backend responde
`{ error: { code, message } }`. La web debe leer el código **anidado** y
preferir el `message` del servidor. Leerlo como si `error` fuera un string
—el defecto original— convierte todos los errores en genéricos y deja al
usuario sin saber qué corregir.
