# Guía de despliegue de Fixio
### De tu PC a producción, paso a paso

---

## FASE 1 — Entorno local (tu PC con Windows + XAMPP)

Es el entorno que ya usas para desarrollar. Así se monta desde cero:

1. **Base de datos:** abre XAMPP y enciende **MySQL**. Si es una instalación nueva, entra a phpMyAdmin (`http://localhost/phpmyadmin`), crea la base `tuservicioexpress` e importa tu último respaldo `.sql`. Si la base ya existe, no toques nada: el servidor crea y migra las tablas que falten automáticamente al arrancar.
2. **Proyecto:** copia todos los archivos de la entrega a tu carpeta (ej. `C:\Users\...\Desktop\Plataforma express`). Renombra `_env` a `.env`.
3. **Dependencias:** en una terminal dentro de la carpeta:
   ```
   npm install
   ```
4. **Arrancar:**
   ```
   node server.js
   ```
   Debes ver: `[SYSTEM ACTIVE] Fixio corriendo en el puerto: 5500` y `Base de datos de Fixio verificada`.
5. **Usar:** abre `http://localhost:5500`. Los códigos de verificación de correo aparecen en la consola del servidor mientras no configures SMTP (busca líneas `[DEBUG] Código...`).
6. **Cuenta admin:** el correo definido en `ADMIN_EMAIL` dentro del `.env` se promueve a administrador automáticamente al arrancar. Regístrate con ese correo y tendrás acceso al Centro de Control.

---

## FASE 2 — Probar en un teléfono real (misma red WiFi)

### Opción A: desde el navegador del teléfono
1. Conecta el teléfono al **mismo WiFi** que tu PC.
2. Averigua la IP local de tu PC: en una terminal escribe `ipconfig` y copia la **Dirección IPv4** (ej. `192.168.1.100`).
3. **Firewall:** la primera vez que arranques `node server.js`, Windows preguntará si permites conexiones — marca "Redes privadas" y acepta. (Si no preguntó: Panel de control → Firewall → Configuración avanzada → Regla de entrada nueva → Puerto TCP 5500 → Permitir.)
4. En el teléfono abre: `http://192.168.1.100:5500`

**Limitación importante:** sin HTTPS, los navegadores móviles **bloquean el GPS** y no ofrecen instalar la PWA (es una regla de seguridad de Chrome/Safari, no un bug de Fixio). Para estas pruebas escribe la dirección manualmente o mueve el marcador del mapa con el dedo. El GPS y la instalación funcionarán al 100% en producción con HTTPS.
> Truco solo para pruebas: en Chrome del teléfono, entra a `chrome://flags`, busca *"Insecure origins treated as secure"*, escribe `http://192.168.1.100:5500` y reinicia Chrome. Con eso el GPS funciona también en local.

### Opción B: como app instalada (APK de Capacitor)
1. Descomprime `fixio-android.zip` en tu PC y edita `capacitor.config.json`:
   ```json
   "server": { "url": "http://192.168.1.100:5500", "cleartext": true }
   ```
2. `npm install` y `npx cap sync android` en esa carpeta.
3. Abre la carpeta `android/` con Android Studio → Build → Build APK(s).
4. Pasa el `app-debug.apk` al teléfono (cable o WhatsApp) e instálalo.

Así pruebas la experiencia de "app real" antes de tener dominio. Cuando pases a producción, solo cambias la URL del config por tu dominio HTTPS.

---

## FASE 3 — Producción (VPS + dominio + HTTPS)

### 3.1 Contratar (una sola vez, ~30 min)
- **VPS:** Ubuntu 24.04, 1–2 GB RAM (~$6/mes): DigitalOcean, Hetzner, Vultr o Contabo.
- **Dominio** (~$10/año): Namecheap, Porkbun, etc. En el panel DNS crea un registro **A** apuntando `@` (y `www`) a la IP del VPS.

### 3.2 Preparar el servidor (conéctate por SSH: `ssh root@IP_DEL_VPS`)
```bash
apt update && apt upgrade -y
apt install -y nginx mariadb-server
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs

# Asegurar MariaDB y crear la base con su usuario propio
mysql_secure_installation
mysql -u root -p
```
Dentro de MySQL:
```sql
CREATE DATABASE tuservicioexpress CHARACTER SET utf8mb4;
CREATE USER 'fixio'@'localhost' IDENTIFIED BY 'UNA_CLAVE_FUERTE';
GRANT ALL PRIVILEGES ON tuservicioexpress.* TO 'fixio'@'localhost';
FLUSH PRIVILEGES; EXIT;
```
Importa tus datos (sube antes el respaldo con WinSCP/FileZilla):
```bash
mysql -u fixio -p tuservicioexpress < fixio_FECHA.sql
```

### 3.3 Subir Fixio
```bash
mkdir -p /var/www/fixio
# (sube aquí todos los archivos del proyecto con WinSCP/FileZilla)
cd /var/www/fixio
npm install
nano .env
```
En el `.env` de producción cambia:
```
NODE_ENV=production
ALLOWED_ORIGINS=https://tudominio.com
DB_USER=fixio
DB_PASSWORD=UNA_CLAVE_FUERTE
JWT_SECRET=(pega la clave aleatoria larga de ejemplo que viene comentada en el archivo)
APP_URL=https://tudominio.com
SMTP_HOST/PORT/USER/PASS=(tus credenciales de Gmail o Brevo)
```

### 3.4 Mantenerlo vivo con PM2
```bash
npm install -g pm2
pm2 start server.js --name fixio
pm2 startup   # y ejecuta el comando que te muestre
pm2 save
```
Con esto Fixio arranca solo aunque el VPS se reinicie. Logs: `pm2 logs fixio`.

### 3.5 Nginx como puerta de entrada (con soporte para el chat en vivo)
```bash
nano /etc/nginx/sites-available/fixio
```
Pega esto (cambia el dominio):
```nginx
server {
    listen 80;
    server_name tudominio.com www.tudominio.com;

    client_max_body_size 15M;   # fotos de problemas y documentos

    location / {
        proxy_pass http://127.0.0.1:5500;
        proxy_http_version 1.1;
        # Imprescindible para Socket.io (chat y notificaciones en vivo):
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Activa y recarga:
```bash
ln -s /etc/nginx/sites-available/fixio /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 3.6 HTTPS gratis con Certbot (el paso que enciende todo)
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d tudominio.com -d www.tudominio.com
```
Elige la opción de redirigir HTTP→HTTPS. El certificado se renueva solo.

### 3.7 Respaldo automático
```bash
nano /var/www/fixio/respaldo_linux.sh   # pon USUARIO=fixio y la clave
chmod +x /var/www/fixio/respaldo_linux.sh
crontab -e
```
Agrega: `0 3 * * * /var/www/fixio/respaldo_linux.sh`

### 3.8 Lista de verificación final (desde tu teléfono con datos móviles)
- [ ] `https://tudominio.com` abre con candado.
- [ ] Registro llega el código **al correo** (SMTP funcionando).
- [ ] El GPS pide permiso y ubica el marcador.
- [ ] Chrome ofrece "Agregar Fixio a la pantalla de inicio" (PWA).
- [ ] Chat en vivo entre dos cuentas (cliente y trabajador) sin recargar.
- [ ] Toast de la tasa BCV al entrar a los paneles.
- [ ] Panel admin accesible solo con la cuenta admin.

### 3.9 Después del despliegue
- Piloto con 10–20 trabajadores reales (PWA o APK, ver `GUIA_APP_MOVIL.md`).
- Publicación en Play Store con Bubblewrap cuando el dominio lleve unos días estable.
- Recuerda: el texto de `terminos.html` debe revisarlo un abogado antes del lanzamiento comercial.

**Costos totales de arranque:** VPS ~$6/mes + dominio ~$10/año + Play Store $25 (única vez, opcional al inicio).
