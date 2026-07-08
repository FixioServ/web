# Guía: Fixio como aplicación móvil

Fixio ya está preparada para convertirse en app por **tres vías complementarias**. Puedes usarlas en este orden: la Vía 1 funciona hoy mismo, la Vía 2 te da un APK instalable esta semana, y la Vía 3 es la publicación formal en Play Store.

---

## Vía 1 — PWA instalable (ya está lista, costo $0)

Con los archivos de esta entrega (`manifest.json`, `sw.js`, iconos), apenas Fixio esté publicada en un dominio con **HTTPS**:

- **Android (Chrome):** al visitar tu dominio aparecerá el aviso "Agregar Fixio a la pantalla de inicio". La app se instala con tu icono y se abre a pantalla completa, sin barra del navegador.
- **iPhone (Safari):** Compartir → "Agregar a pantalla de inicio".
- Las actualizaciones son instantáneas: subes archivos al servidor y todos los usuarios tienen la nueva versión.

> Requisito único: HTTPS. Sin certificado no hay instalación ni GPS en móviles.

---

## Vía 2 — APK con Capacitor (proyecto `fixio-android.zip` incluido)

Ideal para el piloto: generas un APK real y lo distribuyes directo (WhatsApp, enlace de descarga) sin pasar por la tienda.

### Requisitos en tu PC
1. [Android Studio](https://developer.android.com/studio) instalado (incluye el SDK y Java).
2. Node.js (ya lo tienes).

### Pasos
1. Descomprime `fixio-android.zip` en una carpeta, por ejemplo `C:\fixio-app`.
2. Abre `capacitor.config.json` y cambia **una sola línea**:
   ```json
   "url": "https://TU-DOMINIO.com"
   ```
   por tu dominio real. *(Para probar en tu red local antes de tener dominio: usa `"url": "http://192.168.X.X:5500"` —la IP de tu PC— y agrega `"cleartext": true`.)*
3. En esa carpeta ejecuta:
   ```
   npm install
   npx cap sync android
   ```
4. Abre la carpeta `android/` con Android Studio (File → Open).
5. Espera a que Gradle termine de sincronizar (primera vez tarda unos minutos).
6. **APK de prueba:** menú Build → Build App Bundle(s) / APK(s) → Build APK(s). El archivo queda en `android/app/build/outputs/apk/debug/app-debug.apk`. Ese archivo se instala en cualquier Android (activando "orígenes desconocidos").
7. **APK/AAB firmado (para Play Store o distribución seria):** Build → Generate Signed Bundle / APK → crea tu **keystore** (¡guárdalo con la contraseña, lo necesitarás para SIEMPRE actualizar la app!).

El proyecto ya incluye el icono y el splash con la marca Fixio en todas las densidades.

---

## Vía 3 — Play Store con TWA (Bubblewrap) — la recomendada para publicar

La TWA (Trusted Web Activity) es la tecnología oficial de Google para publicar una PWA en Play Store. La app de la tienda siempre muestra tu web más reciente: **no necesitas re-publicar para actualizar**.

### Requisitos previos
- Tu dominio con HTTPS **funcionando** (la Vía 1 completada).
- Cuenta de desarrollador de Google Play ($25, pago único): https://play.google.com/console
- Node.js y el JDK (Bubblewrap ofrece descargarlos si faltan).

### Pasos
1. Instala la herramienta:
   ```
   npm install -g @bubblewrap/cli
   ```
2. Genera el proyecto a partir de tu manifest publicado:
   ```
   bubblewrap init --manifest https://TU-DOMINIO.com/manifest.json
   ```
   (Acepta los valores sugeridos; usa `com.fixio.app` como package id. Creará un keystore: **guárdalo bien**.)
3. Compila:
   ```
   bubblewrap build
   ```
   Obtendrás `app-release-signed.apk` (pruebas) y `app-release-bundle.aab` (el que se sube a Play Store).
4. **Vincula tu dominio con la app** (para que se abra sin barra de navegador):
   - Obtén la huella de tu keystore:
     ```
     bubblewrap fingerprint
     ```
     (o `keytool -list -v -keystore android.keystore`)
   - Copia la huella **SHA-256** dentro del archivo `assetlinks.json` que está junto al `server.js` (reemplaza el texto `REEMPLAZA_CON_LA_HUELLA...`).
   - El servidor ya la sirve automáticamente en `https://TU-DOMINIO.com/.well-known/assetlinks.json` — verifica que abre en el navegador.
5. Sube el `.aab` a Play Console, completa la ficha (descripción, capturas, política de privacidad → usa `https://TU-DOMINIO.com/terminos.html`) y envía a revisión (1–3 días).

---

## ¿Y iPhone (App Store)?

Recomendación: **espera a validar el piloto.** Cuesta $99/año, Apple es estricta con apps que envuelven una web, y mientras tanto los usuarios de iPhone instalan la PWA desde Safari con todo funcional. Cuando toque, el mismo proyecto Capacitor permite agregar iOS (`npx cap add ios`) desde una Mac.

## Próxima mejora natural: notificaciones push con la app cerrada

Hoy las alertas en vivo (ofertas, chat, aceptaciones) funcionan con la app abierta vía Socket.io. Para notificar con la app **cerrada** hay que integrar Firebase Cloud Messaging (FCM) — es un desarrollo aparte que conviene hacer después del piloto, cuando sepas qué notificaciones importan de verdad a tus usuarios.

## Resumen del orden recomendado

1. Desplegar Fixio en VPS con dominio + HTTPS.
2. Piloto inmediato como PWA (Vía 1) y/o APK directo a los trabajadores (Vía 2).
3. Publicación en Play Store con Bubblewrap (Vía 3).
4. Más adelante: FCM y App Store.
