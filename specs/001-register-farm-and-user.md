# Spec 001 — RegisterFarmAndUser (registro de usuario + granja)

> **Estado:** pendiente de aprobación. Nada de este documento se implementa hasta que se apruebe.
>
> **Contexto:** `../arquitectura-v1.2.md` (giro al eje de datos, modelo de identidad). **Diseño de referencia del front:** `app/design/Registro.dc.html` (repo porcia-app) — el flujo web descrito aquí sigue ese diseño paso a paso.

---

## 1. Resumen General

`RegisterFarmAndUser` es la **puerta de entrada obligatoria** al eje de datos del producto: sin usuario y granja registrados no hay captación de datos productivos. Es **un solo caso de uso de dominio, agnóstico del canal**, que se expone por tres adaptadores:

1. **Conversacional WhatsApp** — el bot pide los campos paso a paso, sin OTP (el canal ya prueba la posesión del número). Usa **botones nativos** en los pasos de opción cerrada y acepta **respuestas por nota de voz** en todos los campos.
2. **Conversacional Telegram** — idéntico, mismo código, distinto gateway (inline keyboard en vez de reply buttons).
3. **Web (formulario)** — wizard React en `app/` que verifica el celular con OTP de 6 dígitos enviado por WhatsApp/Telegram y, al éxito, recibe una sesión JWT.

Cubre tres variantes de alta:
- **Dueño + granja nueva** (el caso principal).
- **Granja adicional** para un dueño ya registrado (multi-granja).
- **Trabajador** que se une a una granja existente — por **solicitud** (busca la finca y pide unirse; el dueño aprueba) o por **invitación** (el dueño lo pre-registró; su membresía se activa al registrarse).

La verificación de posesión del celular es responsabilidad **del adaptador**, nunca del caso de uso: el adaptador web comprueba el OTP antes de invocar `submit()`; los adaptadores de chat confían en el canal.

## 2. Objetivos del Usuario

- **Como dueño de finca**, quiero registrarme junto con mi finca mandando mensajes por WhatsApp/Telegram, contestando una pregunta a la vez, sin formularios ni fricción.
- **Como dueño**, alternativamente quiero registrarme desde la web con un formulario, verificando mi celular con un código que me llega por WhatsApp o Telegram.
- **Como dueño**, quiero poder registrar **otra finca más** sin crear otra cuenta.
- **Como dueño**, quiero invitar a los trabajadores de mi finca (nombre, cédula, celular) durante el registro, para que al registrarse ellos queden vinculados a mi finca sin trámite extra.
- **Como trabajador**, quiero buscar la finca a la que pertenezco (por nombre o ubicación), enviar mi solicitud y quedar vinculado cuando el dueño la apruebe.
- **Como cualquier usuario registrado**, quiero que el sistema me reconozca en todos mis mensajes futuros por chat (sin volver a identificarme) y quiero ver mi perfil (mis datos y los de mi finca) al terminar el registro web.

## 3. Alcance Estricto

### Incluye v1

- **Caso de uso `RegisterFarmAndUser`** (application), agnóstico de canal, con creación **atómica** de `AppUser` + `Farm` + `Operator` (membresía).
- **Caso de uso `ApproveWorker`**: el dueño aprueba/rechaza solicitudes pendientes (por chat: respuesta "sí"/"no" cuando el sistema se lo presenta).
- **Campos de FINCA:** nombre; tipo de persona (natural/jurídica); identificación (cédula si natural, NIT si jurídica); ubicación (vereda, municipio, departamento — texto libre); capacidad de ceba; capacidad de cría; capacidad total (cerdos); registro sanitario ICA.
- **Campos de USUARIO:** tipo (administrador-dueño / trabajador); tipo de identificación (TI / CC / CE / PPT / PEP / pasaporte); número de identificación; # celular WhatsApp (o Telegram); correo electrónico (opcional).
- **Flujo conversacional** multi-turno con confirmación final obligatoria (estilo `LogFarmEvent`: nada se persiste sin que el usuario confirme el resumen).
- **Botones nativos del canal** en todos los pasos de opción cerrada (rol, tipo de persona, tipo de identificación, correo opcional, confirmación, "¿otra finca?", aprobar/rechazar trabajador) y **lista seleccionable** para los resultados de búsqueda de finca. Con **fallback numérico en texto** cuando el canal o el cliente no renderiza interactivos.
- **Respuesta por nota de voz** habilitada en todos los campos del flujo (reutiliza `Transcriber` de v1), con normalización de números dictados y lectura de vuelta dígito por dígito de las identificaciones.
- **Salida en audio** cuando el input fue audio (regla de v1), acompañada del mensaje con botones cuando el paso los tenga.
- **Flujo web** con OTP en 3 pasos (`request-otp` → `verify-otp` → `register`) y emisión de sesión JWT al completar. OTP de **6 dígitos**, reenvío con cooldown de 30 s.
- **Cuatro transportes de OTP a elección del usuario**: WhatsApp, Telegram, **SMS** (Twilio) y **correo** (SMTP). El motor de códigos es propio (generación, hash, expiración, intentos); los proveedores son solo transporte. La web ofrece únicamente los transportes que estén configurados.
- **Verificar el correo también habilita el registro**, no solo verificar el celular (decisión del usuario). El sistema deja constancia de *cuál* de los dos se verificó.
- **Multi-granja:** un usuario registrado puede dar de alta granjas adicionales ("¿otra finca más?" en chat; botón "Registrar otra finca" en web).
- **Trabajador por solicitud:** búsqueda de fincas por nombre/ubicación (endpoint público de búsqueda, con rate limit) → solicitud → membresía `pendiente` → el dueño aprueba → `activo`.
- **Trabajador por invitación:** el dueño agrega trabajadores (nombre, cédula, celular) en el registro; se crean invitaciones. Cuando ese trabajador se registra con el mismo celular, su membresía queda `activa` sin aprobación adicional.
- **Detección de duplicados:** identificación de persona única en el sistema; una persona no puede registrar dos veces la misma finca; una persona no puede tener dos membresías en la misma finca.
- **Perfil post-registro (web):** pantalla de solo lectura con los datos de la cuenta, la finca (dueño) o el estado de la solicitud (trabajador).

### NO incluye v1 (deuda intencional, explícita)

- **Login / recuperación de sesión** después del registro (volver a entrar a la web otro día). La sesión de v1 es solo la emitida al completar el registro. Spec futuro sobre los mismos `SessionIssuer` + endpoints OTP.
- **Edición de datos** de usuario o finca tras el registro. El diseño (`Registro.dc.html`, paso 6) muestra botones "Editar" en el perfil: en v1 el perfil es **solo lectura** y esos botones no se implementan (o se ocultan). Los endpoints de update quedan para un spec posterior.
- **Notificación push saliente** al dueño cuando llega una solicitud ("te avisaremos por WhatsApp") — restringida por plantillas de WhatsApp (`arquitectura-v1.2.md` §9). En v1 el dueño ve las solicitudes pendientes cuando escribe al bot.
- **Gestión de equipo** posterior (quitar trabajadores, cambiar roles, re-invitar) — "Podrás hacerlo más tarde desde tu panel" del diseño es una promesa para specs futuros.
- Registro por imagen/OCR de documentos.
- Cualquier pantalla web más allá del wizard + perfil de solo lectura.
- Validación de formato/existencia del registro sanitario ICA contra fuentes externas (se guarda como texto).
- **WhatsApp Flows** (formularios nativos multi-campo dentro de WhatsApp): es otra API, requiere aprobación aparte de Meta y su propio diseño. El registro por chat se hace con mensajes interactivos simples (botones y listas).
- **Dictado del correo electrónico por voz**: demasiado propenso a error. Se pide escribirlo o se omite con botón.
- Menús persistentes, comandos `/` de Telegram y teclados de respuesta permanentes.

## 4. Comportamiento Esperado

### 4.1 Flujo conversacional (WhatsApp / Telegram)

1. El router de intención (`HandleIncomingMessage`) detecta `intent=onboarding` en un usuario no registrado (o el usuario dice "quiero registrarme" / responde al saludo de bienvenida).
2. El bot pregunta primero el **rol**, con botones: `[Soy dueño o administrador]` `[Soy trabajador]`.
3. **Rama dueño** — pide, un campo por mensaje, en este orden: nombre de la finca → tipo de persona `[Natural]` `[Jurídica]` → cédula o NIT (según tipo) → ubicación → capacidad de ceba → capacidad de cría → capacidad total → registro sanitario ICA → tipo de identificación del usuario `[Tarjeta de Identidad]` `[Cédula de Ciudadanía]` `[Cédula de Extranjería]` `[PPT]` `[PEP]` `[Pasaporte]` → número de identificación → correo `[Escribirlo]` `[No tengo]` `[Después]`. El **celular no se pregunta**: es el `channelUserId` del canal.
4. **Rama trabajador** — pide su identificación (tipo + número) y el nombre de la finca; el sistema busca coincidencias (`searchFarms`) y las ofrece como **lista seleccionable** (máx. 5 + fila "Ninguna de estas"); el usuario toca una; se crea la solicitud.
5. **Resumen y confirmación obligatoria:** el bot lee de vuelta todos los datos ("Entendí: Finca La Esperanza, persona natural, cédula 1032456789… ¿Confirmo el registro?") con botones `[Sí, confirmar]` `[Corregir]` `[Cancelar]`. Solo con la confirmación se llama a `RegisterFarmAndUser.submit()`.
6. El estado parcial vive en `PendingEventStore` (variante `register_farm_and_user` de `PendingDraft`, con `partial` + `nextField`), TTL propio `ONBOARDING_PENDING_TTL_SECONDS=1800`.
7. **Usuario ya registrado que dice "registrar":** se le ofrece registrar **otra finca** (dueño) con botones `[Sí, otra finca]` `[No, gracias]` — la conversación arranca desde los datos de finca, sin repetir los de la persona.
8. **Invitado que se registra:** si el celular coincide con una invitación pendiente, el bot lo saluda por su nombre, pide solo sus datos de identificación faltantes, y su membresía queda `activa` al confirmar.
9. **Aprobación de trabajador (dueño):** cuando el dueño escribe al bot y tiene solicitudes pendientes, se le presentan con botones `[Aprobar]` `[Rechazar]` por solicitud.

#### 4.1.1 Botones e interacción nativa

- **Dónde van botones:** solo en pasos de **opción cerrada** — rol, tipo de persona, tipo de identificación, correo opcional, confirmación final, "¿otra finca?", "agregar otro trabajador / terminar", aprobar/rechazar. Los campos de texto libre (nombre, identificación, ubicación, capacidades, registro sanitario) **no** llevan botones.
- **Mapeo por canal:** WhatsApp → *reply buttons* (máx. **3** por mensaje, etiqueta ≤ 20 caracteres) y *list message* para la búsqueda de fincas y el tipo de documento (hasta 10 filas). Telegram → *inline keyboard* (una fila por opción; `callback_data` ≤ 64 bytes). El tipo de documento usa lista porque tiene seis opciones.
- **Identificadores namespaced:** cada opción viaja con un id `reg:<campo>:<valor>` (p. ej. `reg:tipo_persona:juridica`). El caso de uso resuelve **primero por id** y solo si no hay id interpreta texto libre. Esto hace que un botón viejo sea detectable como obsoleto (ver §5).
- **El núcleo no sabe de botones.** El caso de uso devuelve una respuesta con `options[]`; el adaptador de salida decide si las pinta como botones nativos o como lista numerada. La pulsación entrante se traduce en el webhook a un `IncomingMessage` de texto cuyo contenido es el id de la opción — el dominio no cambia.
- **Fallback numérico obligatorio:** si el canal no soporta interactivos, si el envío interactivo falla, o si el usuario responde con texto/voz en vez de tocar, el flujo acepta igualmente la respuesta escrita o hablada ("natural", "la primera", "1"). El mensaje de fallback numera las opciones en el cuerpo del texto.
- **Higiene de teclados (Telegram):** al recibir un `callback_query` se responde `answerCallbackQuery` (quita el spinner) y se editan los botones del mensaje anterior para que no queden re-pulsables. En WhatsApp no se pueden retirar botones ya enviados: la defensa es el id namespaced.
- **Ventana de 24 h:** los mensajes interactivos de WhatsApp solo se permiten dentro de la ventana de servicio. El registro siempre lo inicia el usuario, así que el flujo completo ocurre dentro de la ventana; ninguna parte de este spec depende de plantillas aprobadas.

#### 4.1.2 Detección del celular y cuándo NO se pide OTP

El principio: **si el canal ya prueba de qué número escribe la persona, ese número queda verificado sin OTP.** Cada canal lo resuelve distinto:

- **WhatsApp** — el `channelUserId` que llega en el webhook **es** el celular en formato E.164. Se toma de ahí, se normaliza, se marca `phone_verified_at` y **no se pide código**. El bot lo confirma en el resumen ("Te registro con el número desde el que me escribes: 300 123 4567").
- **Telegram** — el `channelUserId` es un id numérico de Telegram, **no** un teléfono, así que no se puede deducir. Se le ofrece el botón nativo **"Compartir mi número"** (`request_contact`), que hace que Telegram entregue el teléfono ya verificado por la propia plataforma: también cuenta como verificado y tampoco pide código. Si la persona no quiere compartirlo, se le pide escribirlo y **ese** número sí se verifica por OTP.
- **Número distinto al detectado** — si la persona quiere registrarse con un celular que no es aquel desde el que escribe (p. ej. el del dueño mientras escribe el administrador), ese número **sí** requiere OTP por SMS o WhatsApp antes de guardarse. Solo se salta el código cuando el número declarado coincide con el detectado.
- La confianza es del canal, no del texto: un número que la persona *escribe* nunca se da por verificado, aunque coincida con el detectado, salvo que se tome del propio canal.

#### 4.1.3 Respuestas por audio

- **Todos los campos aceptan nota de voz.** `HandleIncomingMessage` ya transcribe (Whisper) antes de enrutar, así que el adaptador conversacional recibe texto y no distingue el origen — salvo para las reglas de abajo.
- **Salida:** si el input fue voz, la pregunta siguiente se entrega **en audio**; cuando ese paso además tiene botones, se envían **dos mensajes**: la nota de voz con la pregunta y el mensaje interactivo con las opciones. Se acepta el costo de dos mensajes porque el usuario objetivo puede tener baja alfabetización: el audio explica, los botones evitan escribir.
- **Números dictados:** capacidades y cantidades pasan por una normalización de dominio (función pura, testeable) que convierte numerales en palabras a dígitos ("doscientos cincuenta" → 250). Si no se puede normalizar con certeza, se re-pregunta con un ejemplo concreto en vez de adivinar.
- **Identificaciones dictadas:** cédula, NIT y registro sanitario se **leen de vuelta dígito por dígito** ("uno–cero–tres–dos–cuatro…") pidiendo confirmación antes de avanzar. Son los campos donde un error de transcripción es más caro y menos visible.
- **Transcripción de baja confianza o vacía:** no se guarda nada; se pide repetir el audio o escribir el dato.
- ~~**Correo por voz:** no se dicta.~~ **Revertido por el spec 013 (2026-07-23):** el correo **sí** se puede dictar diciendo "arroba" y "punto"; se normaliza y se lee de vuelta para confirmar antes de guardarlo, igual que la cédula y el NIT. Escribirlo sigue funcionando sin confirmación extra.

### 4.2 Flujo web (wizard de `app/`, según `Registro.dc.html`)

- **Paso 0 — Rol:** "¿Cómo te unes a PorcIA?" → dueño/administrador o trabajador.
- **Paso 1 — Cuenta:** tipo de identificación (TI/CC/CE/PPT/PEP/PA), número, celular (validación: 10 dígitos colombianos empezando por 3), correo opcional.
- **Paso 2 — OTP:** el usuario elige el transporte entre los disponibles (`GET /register/otp-transports`); `POST /register/request-otp {destination, destinationKind, transport}` envía un código de 6 dígitos; el usuario lo digita; `POST /register/verify-otp {destination, code}`. `destination` es el celular en E.164 o el correo en minúsculas. Reenvío habilitado tras 30 s de cooldown. La opción "Correo" solo aparece si el usuario escribió un correo en el paso 1.
- **Paso 3 (dueño) — Finca:** los 8 campos de finca.
- **Paso 3 (trabajador) — Búsqueda:** `GET /register/farms/search?q=` por nombre/ubicación; selecciona su finca; se le informa que la solicitud irá al administrador.
- **Paso 4 (dueño, opcional) — Equipo:** agregar trabajadores (nombre, cédula, celular WhatsApp); se pueden agregar varios o ninguno.
- **Envío:** `POST /register` con todo el payload; el backend re-verifica `isVerified(phone)` dentro de la ventana de gracia (`OTP_VERIFIED_GRACE_SECONDS=300`) y ejecuta el caso de uso. Respuesta `201` con `{farmId, operatorId, session:{token}}` (dueño) o `{operatorId, membershipStatus:'pendiente', session:{token}}` (trabajador).
- **Éxito:** pantalla de confirmación con badges de resumen; "Ver mi perfil" (solo lectura) y "Registrar otra finca" (dueño).
- **Segunda finca desde la web:** "Registrar otra finca" reenvía `POST /register` con el mismo bloque `user` y los datos de la finca nueva. El backend reconoce a la persona por su identificación y, si su destino sigue verificado dentro de la ventana de gracia, **agrega la finca** en vez de responder `duplicate_identification`. Si la ventana ya venció, responde `412 phone_not_verified` y la web devuelve al usuario al paso del código.

### 4.3 Reglas de dominio (todas las superficies)

- Creación atómica: si falla cualquier parte (usuario, granja, membresía, invitaciones), no se persiste nada.
- La identidad de chat queda ligada por `channel_user_hash` (HMAC + `USER_ID_SALT`); un usuario registrado por web que luego escribe por WhatsApp desde el mismo número **es reconocido** (el hash se calcula del celular verificado por OTP).
- **El hash solo se guarda si el celular quedó verificado.** Si la persona se registró verificando únicamente su correo, `channel_user_hash` queda nulo y su identidad de chat se liga después, la primera vez que escriba al bot. La razón es de seguridad: derivar la identidad de WhatsApp de un celular que nadie probó permitiría registrarse con el número de otro (verificando el correo propio) y que el dueño real del número, al escribirle al bot, cayera dentro de esa cuenta ajena. `app_user` guarda `phone_verified_at` y `email_verified_at` para dejar constancia de qué se probó.
- Los adaptadores de chat siempre marcan el celular como verificado: el canal mismo prueba la posesión del número.
- Roles: `administrador_dueno` | `trabajador`. Estados de membresía: `activo` | `pendiente`.
- El dueño ve y resuelve solicitudes pendientes por chat: al escribir al bot, si tiene solicitudes, el sistema se las presenta ("Fulano (cédula de ciudadanía 1032456789) pide unirse a Finca La Esperanza. ¿Apruebas?") → `ApproveWorker`.
- El registro **no pasa por `SafetyPolicy`** (es identidad, no consejo). Los flujos v1/v1.1 no se alteran.

## 5. Manejo de Errores

| Situación | Comportamiento |
|---|---|
| Identificación de usuario ya registrada | "Ya existe una cuenta con esa identificación." No se crea nada. En chat se ofrece continuar como ese usuario si el hash coincide; si el hash NO coincide (otro número), se rechaza y se sugiere contacto de soporte. |
| Misma persona registra la misma finca dos veces (mismo `tax_id` + nombre) | "Esa finca ya está registrada en tu cuenta." Se ofrece registrar una finca distinta. |
| Usuario ya con membresía en la finca solicitada | "Ya tienes una solicitud/membresía en esa finca." No se duplica. |
| OTP incorrecto | Mensaje de error; contador de intentos. Tras `OTP_MAX_ATTEMPTS=5` el código se bloquea y hay que solicitar uno nuevo. |
| OTP vencido (`OTP_TTL_SECONDS=300`) | "El código venció, solicita uno nuevo." Reenvío no cuenta como intento fallido. |
| Fallo de envío del OTP (proveedor caído / transporte sin credenciales) | Error claro al front (`503 channel_not_configured` / `502 send_failed`); se permite reintentar o **cambiar de transporte**. No consume intentos. |
| Rate limit de OTP | Máximo 3 solicitudes/hora por destino → `429 rate_limited`. Protege el costo de envíos (SMS y WhatsApp se pagan por mensaje). |
| El usuario elige "Correo" sin haber escrito un correo | La opción aparece deshabilitada con el motivo; se le ofrece volver al paso de cuenta a completarlo. |
| En Telegram la persona rechaza compartir su número | Se le pide escribirlo y ese número se verifica por OTP (SMS o WhatsApp). El registro no se bloquea. |
| En chat declara un celular distinto al detectado | Se le avisa que verificará ese otro número y se le manda un código; hasta que lo confirme, `phone_verified_at` queda nulo y no se liga la identidad de chat a ese número. |
| Usuario que solo verificó el correo y luego escribe por WhatsApp | No es reconocido (su `channel_user_hash` está nulo): el bot lo trata como no registrado y le ofrece ligar su número, tras lo cual queda vinculado a su cuenta existente. |
| `POST /register` sin OTP verificado o fuera de la ventana de gracia | `412 phone_not_verified`; el front regresa al paso 2. |
| Abandono a mitad de conversación (chat) | El borrador vive en `PendingEventStore` con TTL 1800 s. Si el usuario vuelve dentro del TTL, la conversación continúa donde iba; vencido el TTL, empieza de cero (sin arrastrar datos parciales). |
| Abandono a mitad de wizard (web) | Sin borrador persistido (límite explícito de v1): cerrar el navegador = empezar de cero. |
| Búsqueda de finca sin resultados (trabajador) | "No encontramos fincas con ese nombre. Verifica con tu administrador el nombre exacto." No se crea nada. |
| Solicitud de trabajador nunca aprobada | La membresía `pendiente` expira a las **72 h** (config); el trabajador puede volver a solicitar. Su cuenta (`AppUser`) persiste. |
| Dato inválido (celular no colombiano, capacidad no numérica, tipo fuera del enum) | `400 validation` con el campo señalado (web) / re-pregunta del campo con ejemplo (chat). Nunca se persiste un registro parcial. |
| **Botón obsoleto** (el usuario toca una opción de un mensaje viejo y la conversación ya avanzó) | El id namespaced no coincide con el `nextField` actual → "Esa opción ya no aplica" y se reenvía la pregunta vigente con sus botones. Nunca se sobrescribe un campo ya confirmado. |
| **Doble pulsación** del mismo botón | Idempotente: la segunda pulsación con el mismo id y el mismo estado no avanza dos pasos ni duplica el registro (misma defensa de dedup por `messageId` de v1). |
| **Botón de un flujo abandonado** (pending vencido por TTL) | Se responde que la conversación caducó y se ofrece empezar de nuevo con el botón de rol. |
| **Fallo al enviar el mensaje interactivo** (canal lo rechaza, etiqueta muy larga, límite de opciones) | Degradación automática a texto con opciones numeradas — el flujo nunca se bloquea por no poder pintar botones. Se loguea para corregir el contenido. |
| **Respuesta que no coincide con ninguna opción** (texto o voz libres en un paso de botones) | Se intenta emparejar por texto ("natural", "la primera", "1"); si no hay match claro, se repite la pregunta con las opciones. Máximo 3 intentos seguidos antes de ofrecer continuar por la web. |
| **Transcripción vacía o de baja confianza** | No se guarda nada; se pide repetir el audio o escribir el dato. Igual que la degradación de STT de v1. |
| **Número dictado ambiguo** ("como doscientos y algo") | No se normaliza a un valor inventado: se re-pregunta con un ejemplo ("dime solo el número, por ejemplo: 250"). |
| **Identificación dictada mal transcrita** | La lectura de vuelta dígito por dígito la detecta; el usuario responde `[Corregir]` y se vuelve a pedir el campo. |
| **Audio en el campo de correo** | El bot explica que el correo se escribe y reofrece `[Escribirlo]` `[No tengo]` `[Después]`. |
| Errores inesperados de persistencia | `Result.err` → mensaje genérico de reintento; log estructurado con `correlationId`. El webhook siempre responde `200` al proveedor (regla de v1 §14). |

---

> **Nota de privacidad (decisión consciente):** la búsqueda pública de fincas expone nombre, ubicación y nombre del administrador (así lo muestra el diseño). El endpoint va con rate limit y devuelve máximo 5 resultados, sin identificaciones ni teléfonos. Si esto resulta sensible en piloto, se cambia a búsqueda por código de finca — extensión sin romper el caso de uso.
