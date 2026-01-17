/* =============================================================================
  config.js — Musicala · Buscador de Docentes (TSV) ✅
  -----------------------------------------------------------------------------
  Este archivo SOLO define configuración.
  No pongas aquí código de app.js, no DOM, no init, no nada.
============================================================================= */

window.DOCENTES_CONFIG = {
  /* =========================
     Fuente de datos (OBLIGATORIO)
  ========================= */
  TSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRig5JLlTVZzhMKFUk1eMPmFSc1rGE_UJ2fxLd3aVSWAOefrOJ3A-XYyGJhd3C2q-0wEH0v_qktjSr-/pub?gid=0&single=true&output=tsv",

  /* =========================
     Branding / UI
  ========================= */
  APP_TITLE: "Buscador de Docentes",

  /* =========================
     Tabla
  ========================= */
  PAGE_SIZE: 25,       // filas por página (25 va perfecto para asistentes)
  MAX_FILTERS: 6,      // filtros automáticos (para no saturar la UI)

  /* =========================
     Cache local (velocidad)
     - Si el TSV cambia mucho en el día, bájale el TTL.
     - Si casi no cambia, súbele y carga más rápido siempre.
  ========================= */
  CACHE_TTL_MS: 1000 * 60 * 10, // 10 minutos (más “vivo” que 20)

  // Si tienes varios buscadores distintos en el mismo dominio,
  // cambia el storage key para que no se pisen.
  STORAGE_KEY: "musicala_docentes_cache_v1",

  /* =========================
     Opcional: Contacto
     Si tus encabezados son raros o no detecta el celular/correo,
     pon el nombre EXACTO de la columna (de A–K o AC).
     Ej: "WhatsApp", "Celular", "Teléfono", "Correo", etc.
  ========================= */
  CONTACT_KEY: "",

  /* =========================
     Opcional: Qué copia "Copiar resumen"
     Si lo dejas vacío, el app copia los 6 primeros campos con info.
     Si lo defines, copia SOLO estos, en este orden.
     OJO: deben coincidir EXACTO con los encabezados del TSV (A–K o AC).
  ========================= */
  SUMMARY_KEYS: [
    // "Nombre",
    // "Instrumento",
    // "Sede",
    // "Disponibilidad",
    // "WhatsApp"
  ],

  /* =========================
     Opcional: Filtros preferidos
     app.js actualmente arma filtros automáticos por heurística.
     Esto queda listo para que, si luego quieren, forcemos filtros específicos
     (sin cambiar la UI).
     Por ahora NO lo usa, pero te lo dejo para versión 2.
  ========================= */
  PREFERRED_FILTER_KEYS: [
    // "Instrumento",
    // "Sede",
    // "Disponibilidad"
  ],

  /* =========================
     Opcional: Debug
     Si lo pones en true, más logs en consola.
     app.js actualmente no lo usa, pero sirve para futura versión.
  ========================= */
  DEBUG: false
};
