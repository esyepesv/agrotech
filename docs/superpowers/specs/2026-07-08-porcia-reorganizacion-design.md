# Diseño: reorganización del proyecto Porcia (antes agrotech)

**Fecha:** 2026-07-08
**Estado:** aprobado por Stiven

## Contexto

El proyecto pasa a llamarse **Porcia** y se divide en subproyectos con
repositorios independientes. Hoy solo existe el backend (asistente porcícola
por WhatsApp/Telegram con RAG, desplegado en Vercel) en
`github.com/esyepesv/agrotech`.

## Estructura final

```
/home/stiven/Projects/porcia/
├── backend/   → github.com/esyepesv/porcia-backend  (repo actual, renombrado)
├── web/       → github.com/esyepesv/porcia-web      (nuevo — página pública/landing)
└── app/       → github.com/esyepesv/porcia-app      (nuevo — frontend/dashboard)
```

La carpeta `porcia/` es solo un contenedor local (no es repo git); cada
subcarpeta es un clon de su propio repositorio.

## Pasos

1. Renombrar el repo en GitHub: `agrotech` → `porcia-backend` (conserva
   historial, issues y redirecciones automáticas).
2. Mover el clon local a `Projects/porcia/backend/` y actualizar la URL del
   remote.
3. Rebranding mínimo del backend: `name` en `package.json` →
   `porcia-backend` y título del README. Sin tocar código.
4. Crear `porcia-web` y `porcia-app` (públicos) como placeholders con README
   y `.gitignore`, clonados en `porcia/web/` y `porcia/app/`. Cada README
   explica su rol y enlaza a los otros repos.

## Restricción: Vercel y webhooks

El proyecto de Vercel se sigue llamando `agrotech`: renombrarlo cambiaría el
dominio `*.vercel.app` al que apuntan los webhooks de WhatsApp/Telegram y
rompería el bot. Renombrar el repo en GitHub no afecta a Vercel (sigue el
repo por ID). Si en el futuro se renombra el proyecto de Vercel, hay que
actualizar los webhooks de Meta y Telegram.

## Qué no cambia

Código, historial de git, deploy actual, variables de entorno y
funcionamiento del bot.
