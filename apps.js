// Registro de apps del conglomerado. Para añadir una nueva app, agrega un
// objeto aquí con su carpeta dentro de /apps.
const APPS = [
  {
    id: "piano-voice",
    name: "Piano Voice",
    description: "Piano virtual de 5 octavas con voces de coro (terceras y quintas) según la escala.",
    icon: "🎹",
    path: "apps/piano-voice/index.html",
  },
  {
    id: "voice-harmony",
    name: "Voice Harmony",
    description: "Graba o sube tu voz y obtén una armonía (3ª/5ª) exportada como MP3 con sonido de piano.",
    icon: "🎤",
    path: "apps/voice-harmony/index.html",
    // En beta: la detección de tono todavía no da resultados suficientemente
    // buenos. Oculta del menú hasta que mejore; el código sigue en apps/voice-harmony.
    enabled: false,
  },
];
