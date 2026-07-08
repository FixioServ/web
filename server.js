require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const nodemailer = require('nodemailer');
const { Server: SocketServer } = require('socket.io');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false
}));

// NOTA: el límite anterior (300) se agotaba en minutos porque los paneles hacen
// polling (ofertas/chat) y cliente+trabajador comparten IP al probar en local.
// Eso devolvía 429 y "cortaba la conexión" de los paneles.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiadas peticiones desde esta IP. Intenta más tarde.' }
});
app.use('/api/', apiLimiter);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

// ==========================================================================
// SERVIR EL FRONTEND DESDE EL MISMO SERVIDOR
// Abre http://localhost:5500 y todo funciona sin Live Server ni CORS.
// Se bloquean los archivos sensibles del backend.
// ==========================================================================
app.use((req, res, next) => {
    const ruta = req.path.toLowerCase();
    const bloqueados = ['/server.js', '/package.json', '/package-lock.json'];
    if (bloqueados.includes(ruta) || ruta.startsWith('/node_modules') || ruta.endsWith('.sql') || ruta.includes('.env')) {
        return res.status(404).json({ message: 'No encontrado.' });
    }
    next();
});
app.use(express.static(__dirname, { index: 'index.html' }));

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    console.log('[SYSTEM] Almacenamiento en la nube (Cloudinary) vinculado con éxito.');
} else {
    console.log('[SYSTEM] Nota: ejecutando almacenamiento local de imágenes.');
}

const allowedOrigins = [
    'http://localhost:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:5501'
];

// Se limpia el valor por si el .env trae comentarios en la misma línea (ej: "*  # comentario")
const ORIGENES_ENV = (process.env.ALLOWED_ORIGINS || '').split('#')[0].trim();

if (ORIGENES_ENV && ORIGENES_ENV !== '*') {
    allowedOrigins.push(...ORIGENES_ENV.split(',').map(o => o.trim()).filter(Boolean));
}

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || ORIGENES_ENV === '*') {
            callback(null, true);
        } else {
            callback(new Error('Bloqueado por políticas de CORS de Fixio'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { message: 'Demasiados intentos de inicio de sesión. Intente de nuevo en 15 minutos.' }
});

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tuservicioexpress',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);
const SECRET_KEY = process.env.JWT_SECRET || 'fixio_super_secret_key_2026';

// ==========================================================================
// INICIALIZACIÓN Y MIGRACIÓN DE BASE DE DATOS
// ==========================================================================
async function inicializarBD(intento = 1) {
    try {
        // Verificar que MySQL responde antes de intentar migrar
        await pool.query('SELECT 1');
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL,
                apellido VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                telefono VARCHAR(30) NULL,
                password VARCHAR(255) NOT NULL,
                rol ENUM('cliente','trabajador','admin') NOT NULL DEFAULT 'cliente',
                avatar_url LONGTEXT NULL,
                estado ENUM('activo','suspendido') NOT NULL DEFAULT 'activo',
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migraciones automáticas (Agregan las columnas si no existen de forma segura)
        try { await pool.execute('ALTER TABLE usuarios ADD COLUMN cedula VARCHAR(50) NULL AFTER apellido'); } catch(e) {}
        try { await pool.execute('ALTER TABLE usuarios ADD COLUMN direcciones LONGTEXT NULL AFTER avatar_url'); } catch(e) {}
        try { await pool.execute('ALTER TABLE usuarios ADD COLUMN metodos_pago LONGTEXT NULL AFTER direcciones'); } catch(e) {}
        
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS categorias_servicio (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL UNIQUE,
                icono VARCHAR(50) NULL,
                descripcion TEXT NULL,
                activo BOOLEAN DEFAULT TRUE
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS trabajador_categorias (
                id INT AUTO_INCREMENT PRIMARY KEY,
                trabajador_id INT NOT NULL,
                categoria_id INT NOT NULL,
                UNIQUE KEY unica_especialidad (trabajador_id, categoria_id),
                FOREIGN KEY (trabajador_id) REFERENCES usuarios(id) ON DELETE CASCADE,
                FOREIGN KEY (categoria_id) REFERENCES categorias_servicio(id) ON DELETE CASCADE
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS perfiles_trabajador (
                id INT AUTO_INCREMENT PRIMARY KEY,
                usuario_id INT NOT NULL UNIQUE,
                descripcion_servicio TEXT NULL,
                documento_identidad VARCHAR(100) NULL,
                verificado BOOLEAN DEFAULT FALSE,
                disponible BOOLEAN DEFAULT FALSE,
                calificacion_promedio DECIMAL(3,2) DEFAULT 0.00,
                total_servicios INT DEFAULT 0,
                latitud DECIMAL(10,7) NULL,
                longitud DECIMAL(10,7) NULL,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS solicitudes_servicio (
                id INT AUTO_INCREMENT PRIMARY KEY,
                cliente_id INT NOT NULL,
                trabajador_id INT NULL,
                categoria_id INT NOT NULL,
                direccion VARCHAR(255) NOT NULL,
                latitud DECIMAL(10,7) NULL,
                longitud DECIMAL(10,7) NULL,
                descripcion TEXT NULL,
                urgencia ENUM('normal','hoy','urgente') DEFAULT 'normal',
                estado ENUM('buscando','asignado','en_camino','en_proceso','completado','cancelado') DEFAULT 'buscando',
                costo_estimado DECIMAL(10,2) NULL,
                costo_final DECIMAL(10,2) NULL,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_asignacion TIMESTAMP NULL,
                fecha_completado TIMESTAMP NULL,
                FOREIGN KEY (cliente_id) REFERENCES usuarios(id),
                FOREIGN KEY (trabajador_id) REFERENCES usuarios(id),
                FOREIGN KEY (categoria_id) REFERENCES categorias_servicio(id)
            )
        `);

        try { await pool.execute('ALTER TABLE solicitudes_servicio ADD COLUMN motivo_cancelacion TEXT NULL AFTER estado'); } catch(e) {}
        try { await pool.execute('ALTER TABLE solicitudes_servicio ADD COLUMN foto_url LONGTEXT NULL AFTER descripcion'); } catch(e) {}
        try { await pool.execute('ALTER TABLE perfiles_trabajador ADD COLUMN cancelaciones INT DEFAULT 0 AFTER total_servicios'); } catch(e) {}

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS calificaciones (
                id INT AUTO_INCREMENT PRIMARY KEY,
                solicitud_id INT NOT NULL UNIQUE,
                cliente_id INT NOT NULL,
                trabajador_id INT NOT NULL,
                puntuacion TINYINT NOT NULL,
                comentario TEXT NULL,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (solicitud_id) REFERENCES solicitudes_servicio(id) ON DELETE CASCADE,
                FOREIGN KEY (cliente_id) REFERENCES usuarios(id),
                FOREIGN KEY (trabajador_id) REFERENCES usuarios(id)
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS mensajes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                solicitud_id INT NOT NULL,
                remitente_id INT NOT NULL,
                contenido TEXT NOT NULL,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (solicitud_id) REFERENCES solicitudes_servicio(id) ON DELETE CASCADE,
                FOREIGN KEY (remitente_id) REFERENCES usuarios(id)
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS ofertas_servicio (
                id INT AUTO_INCREMENT PRIMARY KEY,
                solicitud_id INT NOT NULL,
                trabajador_id INT NOT NULL,
                monto DECIMAL(10,2) NOT NULL,
                mensaje TEXT NULL,
                estado ENUM('pendiente','aceptada','rechazada') DEFAULT 'pendiente',
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (solicitud_id) REFERENCES solicitudes_servicio(id) ON DELETE CASCADE,
                FOREIGN KEY (trabajador_id) REFERENCES usuarios(id)
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS pagos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                solicitud_id INT NOT NULL UNIQUE,
                monto DECIMAL(10,2) NOT NULL,
                metodo_pago VARCHAR(50) NOT NULL,
                referencia_pago VARCHAR(100) NULL,
                comprobante_url TEXT NULL,
                estado ENUM('pendiente','pagado','rechazado') DEFAULT 'pendiente',
                fecha_pago TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (solicitud_id) REFERENCES solicitudes_servicio(id)
            )
        `);

        // COMISIONES DE PLATAFORMA: Fixio cobra un % de cada trabajo al trabajador.
        // pendiente  -> generada al completar el trabajo, aún sin pagar
        // reportada  -> el trabajador reportó el pago con referencia (espera revisión)
        // pagada     -> el admin confirmó la recepción del dinero
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS comisiones (
                id INT AUTO_INCREMENT PRIMARY KEY,
                solicitud_id INT NOT NULL UNIQUE,
                trabajador_id INT NOT NULL,
                monto_servicio DECIMAL(10,2) NOT NULL,
                porcentaje DECIMAL(5,2) NOT NULL,
                monto_comision DECIMAL(10,2) NOT NULL,
                estado ENUM('pendiente','reportada','pagada') DEFAULT 'pendiente',
                metodo_pago VARCHAR(50) NULL,
                referencia_pago VARCHAR(100) NULL,
                fecha_generada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_pago TIMESTAMP NULL,
                FOREIGN KEY (solicitud_id) REFERENCES solicitudes_servicio(id) ON DELETE CASCADE,
                FOREIGN KEY (trabajador_id) REFERENCES usuarios(id) ON DELETE CASCADE,
                INDEX idx_comisiones_trabajador (trabajador_id, estado)
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS codigos_registro (
                email VARCHAR(255) PRIMARY KEY,
                codigo VARCHAR(10) NOT NULL,
                nombre VARCHAR(100),
                apellido VARCHAR(100),
                password VARCHAR(255),
                rol ENUM('cliente','trabajador') DEFAULT 'cliente',
                oficios TEXT NULL, 
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // MIGRACIÓN CRÍTICA: bases de datos creadas con el dump antiguo no tienen
        // la columna 'oficios' y eso rompía TODO el registro de usuarios.
        try { await pool.execute('ALTER TABLE codigos_registro ADD COLUMN oficios TEXT NULL AFTER rol'); } catch(e) {}

        // MIGRACIÓN DE ICONOS: las categorías con emoji pasan a iconos Lucide
        // detectados automáticamente por su nombre (diseño minimalista).
        try {
            const [cats] = await pool.execute('SELECT id, nombre, icono FROM categorias_servicio');
            for (const c of cats) {
                if (!esIconoLucide(c.icono)) {
                    await pool.execute('UPDATE categorias_servicio SET icono = ? WHERE id = ?', [iconoParaCategoria(c.nombre), c.id]);
                }
            }
        } catch(e) {}

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS codigos_recuperacion (
                email VARCHAR(255) PRIMARY KEY,
                codigo VARCHAR(10) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const categoriasDefault = [
            ['Mecánica', 'wrench', 'Reparación y mantenimiento de vehículos'],
            ['Electricidad', 'zap', 'Instalaciones y reparaciones eléctricas'],
            ['Plomería', 'droplet', 'Fugas, tuberías e instalaciones sanitarias'],
            ['Refrigeración', 'snowflake', 'Aires acondicionados y neveras'],
            ['Cerrajería', 'key', 'Cerraduras, llaves y seguridad'],
            ['Jardinería', 'leaf', 'Mantenimiento de jardines y áreas verdes'],
            ['Limpieza y Hogar', 'sparkles', 'Limpieza profunda, planchado y organización'],
            ['Cuidado de Niños', 'baby', 'Niñeras y cuidado infantil de confianza'],
            ['Construcción', 'hard-hat', 'Albañilería, remodelaciones y obras'],
            ['Educación', 'book-open', 'Tutorías y clases particulares'],
            ['Instalación de Cámaras', 'cctv', 'Seguridad, CCTV y monitoreo']
        ];
        for (const [nombre, icono, descripcion] of categoriasDefault) {
            await pool.execute(
                'INSERT IGNORE INTO categorias_servicio (nombre, icono, descripcion) VALUES (?, ?, ?)',
                [nombre, icono, descripcion]
            );
        }

        // Promover automáticamente a administrador el correo definido en .env (ADMIN_EMAIL)
        if (process.env.ADMIN_EMAIL) {
            const [r] = await pool.execute(
                "UPDATE usuarios SET rol = 'admin' WHERE email = ? AND rol != 'admin'",
                [process.env.ADMIN_EMAIL]
            );
            if (r.affectedRows > 0) console.log(`[SYSTEM] Usuario ${process.env.ADMIN_EMAIL} promovido a administrador.`);
        }

        console.log('[SYSTEM] Base de datos de Fixio verificada e inicializada correctamente.');
    } catch (error) {
        console.error('[SYSTEM] Error crítico al inicializar las tablas:', error);
    }
}
inicializarBD();

// ==========================================================================
// HELPERS
// ==========================================================================
// ==========================================================================
// CORREO ELECTRÓNICO (Nodemailer). Si no hay SMTP configurado en .env,
// el código se imprime en consola como antes (modo desarrollo).
// ==========================================================================
// Instancia de Socket.io (se inicializa al final, junto al listen)
let io = null;
function emitirEvento(sala, evento, data) {
    try { if (io) io.to(sala).emit(evento, data); } catch (e) {}
}

let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: (process.env.SMTP_PORT || '587') === '465',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    mailTransporter.verify()
        .then(() => console.log('[MAIL] Servidor de correo conectado:', process.env.SMTP_HOST))
        .catch(e => { console.error('[MAIL] Error de conexión SMTP:', e.message); mailTransporter = null; });
} else {
    console.log('[MAIL] SMTP no configurado: los códigos se mostrarán en consola (modo desarrollo).');
}

async function enviarCodigoPorCorreo(destino, codigo, proposito) {
    if (!mailTransporter) {
        console.log(`[DEBUG] Código de ${proposito} para ${destino}: ${codigo}`);
        return false;
    }
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #0a3a61, #062741); padding: 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 26px;">Fixio</h1>
                <p style="color: #e0a935; margin: 4px 0 0; font-size: 13px; font-weight: bold;">Tu servicio, al instante</p>
            </div>
            <div style="padding: 28px; text-align: center;">
                <h2 style="color: #1e293b; font-size: 18px;">Código de ${proposito}</h2>
                <p style="color: #64748b; font-size: 14px;">Usa este código para continuar. Expira en 15 minutos.</p>
                <div style="background: #f1f5f9; border-radius: 10px; padding: 16px; margin: 18px 0; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #0a3a61;">${codigo}</div>
                <p style="color: #94a3b8; font-size: 12px;">Si no solicitaste este código, ignora este correo.</p>
            </div>
        </div>`;
    try {
        await mailTransporter.sendMail({
            from: process.env.SMTP_FROM || `"Fixio" <${process.env.SMTP_USER}>`,
            to: destino,
            subject: `${codigo} es tu código Fixio`,
            html
        });
        return true;
    } catch (e) {
        console.error('[MAIL] No se pudo enviar, usando consola:', e.message);
        console.log(`[DEBUG] Código de ${proposito} para ${destino}: ${codigo}`);
        return false;
    }
}

// ==========================================================================
// ICONOS DE CATEGORÍA (Lucide, minimalistas): se detectan automáticamente
// a partir del nombre de la categoría. Sin emojis.
// ==========================================================================
const MAPA_ICONOS_CATEGORIA = [
    { claves: ['mecánic', 'mecanic', 'auto', 'vehícul', 'vehicul', 'carro', 'moto'], icono: 'car' },
    { claves: ['electric', 'eléctric'], icono: 'zap' },
    { claves: ['plomer', 'fontaner', 'tuber', 'agua', 'sanitari'], icono: 'droplets' },
    { claves: ['refriger', 'aire', 'nevera', 'clima', 'hvac'], icono: 'snowflake' },
    { claves: ['cerrajer', 'cerradur', 'llave'], icono: 'key-round' },
    { claves: ['jardin', 'jardín', 'poda', 'grama', 'paisaj'], icono: 'leaf' },
    { claves: ['limpiez', 'hogar', 'planchad', 'lavander', 'aseo'], icono: 'sparkles' },
    { claves: ['niñ', 'nin', 'bebé', 'bebe', 'infantil', 'niñer'], icono: 'baby' },
    { claves: ['construc', 'albañil', 'albanil', 'remodel', 'obra'], icono: 'hard-hat' },
    { claves: ['educa', 'tutor', 'clase', 'enseñ', 'academ'], icono: 'book-open' },
    { claves: ['cámara', 'camara', 'cctv', 'vigilancia', 'monitoreo', 'seguridad'], icono: 'video' },
    { claves: ['pintur', 'pintar', 'pintor'], icono: 'paint-roller' },
    { claves: ['computa', 'tecnolog', 'informátic', 'informatic', 'pc', 'laptop', 'software'], icono: 'monitor' },
    { claves: ['herrer', 'soldad', 'metal'], icono: 'hammer' },
    { claves: ['mudanz', 'flete', 'transport', 'carga'], icono: 'truck' },
    { claves: ['mascota', 'veterinari', 'perro', 'gato'], icono: 'paw-print' },
    { claves: ['bellez', 'peluquer', 'barber', 'estétic', 'estetic', 'uñas', 'unas'], icono: 'scissors' },
    { claves: ['cocin', 'chef', 'catering', 'comida', 'reposter'], icono: 'chef-hat' },
    { claves: ['fotograf', 'video', 'filmac'], icono: 'camera' },
    { claves: ['event', 'fiesta', 'decorac'], icono: 'party-popper' },
    { claves: ['internet', 'red', 'wifi', 'cablead'], icono: 'wifi' },
    { claves: ['costur', 'sastre', 'ropa', 'textil'], icono: 'shirt' }
];

function iconoParaCategoria(nombre) {
    const n = (nombre || '').toLowerCase();
    for (const grupo of MAPA_ICONOS_CATEGORIA) {
        if (grupo.claves.some(c => n.includes(c))) return grupo.icono;
    }
    return 'wrench'; // icono por defecto
}

// ¿El icono guardado es un identificador Lucide válido? (los emojis no lo son)
function esIconoLucide(valor) {
    return typeof valor === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(valor);
}

async function procesarImagenBase64(base64String) {
    if (!base64String || !base64String.startsWith('data:image')) return base64String;

    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
        try {
            const uploadRes = await cloudinary.uploader.upload(base64String, { folder: 'fixio_assets' });
            return uploadRes.secure_url;
        } catch (error) {
            console.error('[CLOUD UPLOAD ERROR] Usando respaldo local/Directo:', error.message);
        }
    }

    try {
        const matches = base64String.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            const base64Data = matches[2];
            const filename = `asset_${Date.now()}.${extension}`;
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, base64Data, 'base64');

            const serverUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5500}`;
            return `${serverUrl}/uploads/${filename}`;
        }
    } catch (err) { }
    return base64String;
}

function notificarTelegram(mensaje) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: mensaje, parse_mode: 'Markdown' })
    }).catch(error => console.error('[TELEGRAM ERROR]', error.message));
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Token requerido. Inicie sesión.' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        // 401 = problema de AUTENTICACIÓN (token vencido/inválido) -> el frontend redirige al login.
        // 403 queda reservado para AUTORIZACIÓN (roles, deuda, propiedad) y NO cierra la sesión.
        if (err) return res.status(401).json({ message: 'Tu sesión expiró. Inicia sesión nuevamente.' });
        req.user = user;
        next();
    });
};

const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
        return res.status(403).json({ message: 'No tienes permisos para esta acción.' });
    }
    next();
};

// ==========================================================================
// AUTENTICACIÓN
// ==========================================================================
// Mapa de slugs antiguos del formulario -> nombre real de la categoría en BD
const SLUGS_OFICIO = {
    'mecanica': 'Mecánica', 'electricidad': 'Electricidad', 'plomeria': 'Plomería',
    'refrigeracion': 'Refrigeración', 'cerrajeria': 'Cerrajería', 'jardineria': 'Jardinería',
    'limpieza': 'Limpieza y Hogar', 'ninos': 'Cuidado de Niños', 'construccion': 'Construcción',
    'educacion': 'Educación', 'camaras': 'Instalación de Cámaras'
};

// Normaliza los oficios recibidos (IDs numéricos o slugs de texto) a IDs de categoría válidos
async function normalizarOficios(oficios, oficio) {
    let lista = [];
    if (Array.isArray(oficios)) lista = oficios;
    else if (oficios) lista = [oficios];
    else if (oficio) lista = [oficio];

    const ids = [];
    for (const item of lista) {
        const num = parseInt(item);
        if (!isNaN(num)) {
            const [rows] = await pool.execute('SELECT id FROM categorias_servicio WHERE id = ?', [num]);
            if (rows.length > 0) ids.push(rows[0].id);
        } else if (typeof item === 'string') {
            const nombreCat = SLUGS_OFICIO[item.toLowerCase()] || item;
            const [rows] = await pool.execute('SELECT id FROM categorias_servicio WHERE nombre = ?', [nombreCat]);
            if (rows.length > 0) ids.push(rows[0].id);
        }
    }
    return [...new Set(ids)];
}

app.post('/api/register', async (req, res) => {
    const { nombre, apellido, email, password, rol, oficios, oficio } = req.body;
    if (!nombre || !apellido || !email || !password) {
        return res.status(400).json({ message: 'Campos obligatorios.' });
    }

    const rolFinal = rol === 'trabajador' ? 'trabajador' : 'cliente';

    try {
        const [existing] = await pool.execute('SELECT email FROM usuarios WHERE email = ?', [email]);
        if (existing.length > 0) return res.status(409).json({ message: 'El correo ya existe.' });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedPassword = await bcrypt.hash(password, 10);

        let oficiosStr = null;
        if (rolFinal === 'trabajador') {
            const idsOficios = await normalizarOficios(oficios, oficio);
            if (idsOficios.length === 0) {
                return res.status(400).json({ message: 'Selecciona al menos una especialidad válida.' });
            }
            oficiosStr = JSON.stringify(idsOficios);
        }

        await pool.execute(
            'REPLACE INTO codigos_registro (email, codigo, nombre, apellido, password, rol, oficios) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [email, code, nombre, apellido, hashedPassword, rolFinal, oficiosStr]
        );

        const enviado = await enviarCodigoPorCorreo(email, code, 'verificación de cuenta');
        res.status(201).json({ message: enviado ? 'Te enviamos un código de verificación a tu correo.' : 'Código generado con éxito (revisar consola del servidor).' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno en el registro.' });
    }
});

app.post('/api/verify-email', async (req, res) => {
    const { email, codigo } = req.body;

    try {
        const [rows] = await pool.execute('SELECT * FROM codigos_registro WHERE email = ? AND codigo = ?', [email, codigo]);
        if (rows.length === 0) return res.status(400).json({ message: 'Código de verificación incorrecto o vencido.' });

        const cache = rows[0];

        const [result] = await pool.execute(
            'INSERT INTO usuarios (nombre, apellido, email, password, rol) VALUES (?, ?, ?, ?, ?)',
            [cache.nombre, cache.apellido, email, cache.password, cache.rol]
        );

        if (cache.rol === 'trabajador') {
            await pool.execute('INSERT INTO perfiles_trabajador (usuario_id) VALUES (?)', [result.insertId]);
            
            if (cache.oficios) {
                const oficiosArr = JSON.parse(cache.oficios);
                for (let catId of oficiosArr) {
                    await pool.execute(
                        'INSERT INTO trabajador_categorias (trabajador_id, categoria_id) VALUES (?, ?)',
                        [result.insertId, catId]
                    );
                }
            }
        }

        await pool.execute('DELETE FROM codigos_registro WHERE email = ?', [email]);
        res.status(200).json({ message: 'Cuenta verificada con éxito. Ya puedes iniciar sesión.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error de base de datos al validar el alta.' });
    }
});

app.post('/api/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Ingresa correo y contraseña.' });

    try {
        const [rows] = await pool.execute(
            'SELECT id, email, nombre, apellido, password, rol, estado FROM usuarios WHERE email = ?',
            [email]
        );
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }
        if (user.estado === 'suspendido') {
            return res.status(403).json({ message: 'Tu cuenta se encuentra suspendida. Contacta a soporte.' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol },
            SECRET_KEY,
            { expiresIn: '24h' }
        );

        res.status(200).json({
            message: `Bienvenido, ${user.nombre}`,
            token,
            rol: user.rol,
            nombre: user.nombre
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno.' });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await pool.execute('SELECT id FROM usuarios WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: 'Correo no registrado.' });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await pool.execute('REPLACE INTO codigos_recuperacion (email, codigo) VALUES (?, ?)', [email, code]);

        const enviado = await enviarCodigoPorCorreo(email, code, 'recuperación de contraseña');
        res.status(200).json({ message: enviado ? 'Te enviamos un código de recuperación a tu correo.' : 'Código generado (revisar consola del servidor).' });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { email, token, newPassword } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM codigos_recuperacion WHERE email = ? AND codigo = ?', [email, token]);
        if (rows.length === 0) return res.status(400).json({ message: 'Código inválido o expirado.' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.execute('UPDATE usuarios SET password = ? WHERE email = ?', [hashedPassword, email]);
        await pool.execute('DELETE FROM codigos_recuperacion WHERE email = ?', [email]);

        res.status(200).json({ message: 'Contraseña actualizada con éxito.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar la contraseña.' });
    }
});

// ==========================================================================
// API DE GEOCODIFICACIÓN INVERSA (NUEVO)
// ==========================================================================
app.get('/api/geocode', authenticateToken, async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ message: 'Faltan coordenadas.' });

    try {
        // Hacemos proxy a Nominatim (OSM) para obtener la dirección real a partir del lat/lng
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
            headers: {
                'User-Agent': 'FixioApp/1.0',
                'Accept-Language': 'es' // Direcciones en español
            }
        });
        const data = await response.json();

        if (data && data.display_name) {
            let direccionCorta = data.display_name;
            if (data.address) {
                const calle = data.address.road || '';
                const barrio = data.address.suburb || data.address.neighbourhood || '';
                const ciudad = data.address.city || data.address.town || data.address.county || '';
                // Filtramos campos vacíos y los unimos
                direccionCorta = [calle, barrio, ciudad].filter(Boolean).join(', ');
            }
            res.status(200).json({ direccion: direccionCorta || data.display_name });
        } else {
            res.status(404).json({ message: 'No se pudo ubicar la dirección exacta.' });
        }
    } catch (error) {
        console.error('[GEOCODE ERROR]', error);
        res.status(500).json({ message: 'Error al contactar al servicio de mapas.' });
    }
});

// ==========================================================================
// PERFIL 
// ==========================================================================
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, nombre, apellido, cedula, email, telefono, avatar_url, direcciones, metodos_pago, rol FROM usuarios WHERE id = ?',
            [req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'No encontrado.' });

        const perfil = rows[0];
        
        // BLINDAJE: si el JSON almacenado está corrupto, no rompemos el perfil completo
        try { if (perfil.direcciones) perfil.direcciones = JSON.parse(perfil.direcciones); }
        catch (e) { perfil.direcciones = []; }
        try { if (perfil.metodos_pago) perfil.metodos_pago = JSON.parse(perfil.metodos_pago); }
        catch (e) { perfil.metodos_pago = []; }

        if (perfil.rol === 'trabajador') {
            let [trabajadorRows] = await pool.execute('SELECT * FROM perfiles_trabajador WHERE usuario_id = ?', [req.user.id]);

            // AUTO-REPARACIÓN: si el trabajador no tiene fila de perfil (cuentas antiguas
            // o creadas a mano en la BD), la creamos aquí para que el panel nunca falle.
            if (trabajadorRows.length === 0) {
                await pool.execute('INSERT IGNORE INTO perfiles_trabajador (usuario_id, disponible) VALUES (?, TRUE)', [req.user.id]);
                [trabajadorRows] = await pool.execute('SELECT * FROM perfiles_trabajador WHERE usuario_id = ?', [req.user.id]);
            }
            perfil.perfil_trabajador = trabajadorRows[0] || null;

            // Resumen de comisiones/deuda con la plataforma
            try { perfil.deuda = await obtenerDeudaTrabajador(req.user.id); } catch (e) { perfil.deuda = null; }

            const [catRows] = await pool.execute(
                `SELECT c.nombre FROM trabajador_categorias tc 
                 JOIN categorias_servicio c ON tc.categoria_id = c.id 
                 WHERE tc.trabajador_id = ?`,
                [req.user.id]
            );
            perfil.especialidades = catRows.map(c => c.nombre);
        }

        res.status(200).json(perfil);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener el perfil.' });
    }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
    const { nombre, apellido, telefono, cedula, direcciones, metodos_pago, avatar_url } = req.body;
    try {
        const avatarFinal = await procesarImagenBase64(avatar_url);
        
        const dirStr = direcciones ? JSON.stringify(direcciones) : null;
        const pagosStr = metodos_pago ? JSON.stringify(metodos_pago) : null;

        // CORRECCIÓN: mysql2 rechaza parámetros 'undefined', lo que rompía las
        // actualizaciones parciales (ej. guardar solo direcciones). Se normalizan a null.
        const params = [nombre, apellido, cedula, telefono, dirStr, pagosStr, avatarFinal, req.user.id]
            .map(v => v === undefined ? null : v);

        await pool.execute(
            `UPDATE usuarios SET 
                nombre = COALESCE(?, nombre), 
                apellido = COALESCE(?, apellido), 
                cedula = COALESCE(?, cedula),
                telefono = COALESCE(?, telefono), 
                direcciones = COALESCE(?, direcciones),
                metodos_pago = COALESCE(?, metodos_pago),
                avatar_url = COALESCE(?, avatar_url) 
            WHERE id = ?`,
            params
        );
        res.status(200).json({ message: 'Perfil actualizado con éxito.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al actualizar.' });
    }
});

// ==========================================================================
// CATEGORÍAS DE SERVICIO
// ==========================================================================
app.get('/api/categorias', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT id, nombre, icono, descripcion FROM categorias_servicio WHERE activo = TRUE');
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener categorías.' });
    }
});

// ==========================================================================
// TRABAJADOR: DISPONIBILIDAD Y UBICACIÓN
// ==========================================================================
app.put('/api/trabajador/disponibilidad', authenticateToken, requireRole('trabajador'), async (req, res) => {
    const { disponible, latitud, longitud } = req.body;
    try {
        await pool.execute(
            'UPDATE perfiles_trabajador SET disponible = ?, latitud = COALESCE(?, latitud), longitud = COALESCE(?, longitud) WHERE usuario_id = ?',
            [!!disponible, latitud, longitud, req.user.id]
        );
        res.status(200).json({ message: disponible ? 'Estás en línea.' : 'Estás fuera de línea.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar disponibilidad.' });
    }
});

// ==========================================================================
// SOLICITUDES DE SERVICIO
// ==========================================================================
app.post('/api/solicitudes', authenticateToken, requireRole('cliente'), async (req, res) => {
    const { categoria_id, direccion, latitud, longitud, descripcion, urgencia, foto } = req.body;
    if (!categoria_id || !direccion) {
        return res.status(400).json({ message: 'Selecciona una categoría e indica la dirección.' });
    }
    try {
        // Foto opcional del problema: ayuda al trabajador a cotizar mejor
        const fotoUrl = foto ? await procesarImagenBase64(foto) : null;

        const [result] = await pool.execute(
            `INSERT INTO solicitudes_servicio (cliente_id, categoria_id, direccion, latitud, longitud, descripcion, urgencia, foto_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, categoria_id, direccion, latitud || null, longitud || null, descripcion || null, urgencia || 'normal', fotoUrl]
        );

        notificarTelegram(`🔧 *NUEVA SOLICITUD - FIXIO*\n\n📍 ${direccion}\n🗂️ Categoría ID: ${categoria_id}\n⏱️ Urgencia: ${urgencia || 'normal'}`);

        res.status(201).json({ message: 'Solicitud creada. Buscando profesional disponible...', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al crear la solicitud.' });
    }
});

app.get('/api/solicitudes/activa', authenticateToken, requireRole('cliente'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT s.*, c.nombre AS categoria_nombre, c.icono,
                    u.nombre AS trabajador_nombre, u.apellido AS trabajador_apellido, u.avatar_url,
                    pt.calificacion_promedio
             FROM solicitudes_servicio s
             JOIN categorias_servicio c ON c.id = s.categoria_id
             LEFT JOIN usuarios u ON u.id = s.trabajador_id
             LEFT JOIN perfiles_trabajador pt ON pt.usuario_id = s.trabajador_id
             WHERE s.cliente_id = ? AND s.estado NOT IN ('completado', 'cancelado')
             ORDER BY s.fecha_creacion DESC LIMIT 1`,
            [req.user.id]
        );
        res.status(200).json(rows[0] || null);
    } catch (error) {
        res.status(500).json({ message: 'Error al consultar la solicitud.' });
    }
});

app.get('/api/solicitudes/historial', authenticateToken, requireRole('cliente'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT s.*, c.nombre AS categoria_nombre, c.icono
             FROM solicitudes_servicio s
             JOIN categorias_servicio c ON c.id = s.categoria_id
             WHERE s.cliente_id = ?
             ORDER BY s.fecha_creacion DESC`,
            [req.user.id]
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al consultar el historial.' });
    }
});

app.put('/api/solicitudes/:id/cancelar', authenticateToken, requireRole('cliente'), async (req, res) => {
    const { motivo } = req.body;
    try {
        await pool.execute(
            `UPDATE solicitudes_servicio SET estado = 'cancelado', motivo_cancelacion = ? WHERE id = ? AND cliente_id = ? AND estado NOT IN ('completado','cancelado')`,
            [motivo || null, req.params.id, req.user.id]
        );
        res.status(200).json({ message: 'Solicitud cancelada.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al cancelar la solicitud.' });
    }
});

// El trabajador actualiza su ubicación (para el orden por cercanía)
app.put('/api/trabajador/ubicacion', authenticateToken, requireRole('trabajador'), async (req, res) => {
    const { latitud, longitud } = req.body;
    if (isNaN(parseFloat(latitud)) || isNaN(parseFloat(longitud))) {
        return res.status(400).json({ message: 'Coordenadas inválidas.' });
    }
    try {
        await pool.execute(
            'UPDATE perfiles_trabajador SET latitud = ?, longitud = ? WHERE usuario_id = ?',
            [latitud, longitud, req.user.id]
        );
        res.status(200).json({ message: 'Ubicación actualizada.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar ubicación.' });
    }
});

app.get('/api/solicitudes/disponibles', authenticateToken, requireRole('trabajador'), bloquearSiDeudaVencida, async (req, res) => {
    try {
        // DISTANCIA (fórmula de Haversine en SQL): se calcula entre la ubicación
        // del trabajador (perfiles_trabajador) y la de cada solicitud.
        // Orden: urgencia primero, luego cercanía ("a X km de ti", como Yummy).
        const [rows] = await pool.execute(
            `SELECT s.*, c.nombre AS categoria_nombre, c.icono,
                    u.nombre AS cliente_nombre, u.telefono AS cliente_telefono,
                    CASE
                        WHEN s.latitud IS NOT NULL AND pt.latitud IS NOT NULL THEN
                            ROUND(6371 * ACOS(LEAST(1, GREATEST(-1,
                                COS(RADIANS(pt.latitud)) * COS(RADIANS(s.latitud)) *
                                COS(RADIANS(s.longitud) - RADIANS(pt.longitud)) +
                                SIN(RADIANS(pt.latitud)) * SIN(RADIANS(s.latitud))
                            ))), 1)
                        ELSE NULL
                    END AS distancia_km
             FROM solicitudes_servicio s
             JOIN categorias_servicio c ON c.id = s.categoria_id
             JOIN usuarios u ON u.id = s.cliente_id
             LEFT JOIN perfiles_trabajador pt ON pt.usuario_id = ?
             WHERE s.estado = 'buscando' 
             AND s.categoria_id IN (SELECT categoria_id FROM trabajador_categorias WHERE trabajador_id = ?)
             ORDER BY
                CASE s.urgencia WHEN 'urgente' THEN 1 WHEN 'hoy' THEN 2 ELSE 3 END,
                distancia_km IS NULL,
                distancia_km ASC,
                s.fecha_creacion ASC`,
            [req.user.id, req.user.id]
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener solicitudes disponibles.' });
    }
});

// ==========================================================================
// OFERTAS 
// ==========================================================================
app.post('/api/ofertas', authenticateToken, requireRole('trabajador'), bloquearSiDeudaVencida, async (req, res) => {
    const { solicitud_id, monto, mensaje } = req.body;

    const montoNum = parseFloat(monto);
    if (!solicitud_id || isNaN(montoNum) || montoNum <= 0) {
        return res.status(400).json({ message: 'Ingresa un monto válido para tu oferta.' });
    }

    try {
        // La solicitud debe existir y seguir en estado 'buscando'
        const [solRows] = await pool.execute(
            "SELECT id, estado FROM solicitudes_servicio WHERE id = ?", [solicitud_id]
        );
        if (solRows.length === 0) return res.status(404).json({ message: 'La solicitud ya no existe.' });
        if (solRows[0].estado !== 'buscando') {
            return res.status(409).json({ message: 'Esta solicitud ya fue tomada o cancelada.' });
        }

        // Si el trabajador ya tenía una oferta pendiente, la actualizamos en vez de duplicarla
        const [previa] = await pool.execute(
            "SELECT id FROM ofertas_servicio WHERE solicitud_id = ? AND trabajador_id = ? AND estado = 'pendiente'",
            [solicitud_id, req.user.id]
        );
        if (previa.length > 0) {
            await pool.execute(
                'UPDATE ofertas_servicio SET monto = ?, mensaje = ? WHERE id = ?',
                [montoNum, mensaje || null, previa[0].id]
            );
            return res.status(200).json({ message: 'Tu oferta fue actualizada con el nuevo monto.' });
        }

        await pool.execute(
            'INSERT INTO ofertas_servicio (solicitud_id, trabajador_id, monto, mensaje) VALUES (?, ?, ?, ?)',
            [solicitud_id, req.user.id, montoNum, mensaje || null]
        );

        // Tiempo real: el cliente ve la nueva oferta sin esperar el polling
        const [[dueño]] = await pool.execute('SELECT cliente_id FROM solicitudes_servicio WHERE id = ?', [solicitud_id]);
        if (dueño) emitirEvento(`user_${dueño.cliente_id}`, 'nueva_oferta', { solicitud_id });

        res.status(201).json({ message: 'Oferta enviada exitosamente.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al enviar oferta.' });
    }
});

app.get('/api/solicitudes/:id/ofertas', authenticateToken, requireRole('cliente'), async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT o.id, o.monto, o.mensaje, u.nombre, u.apellido, pt.calificacion_promedio, pt.total_servicios
            FROM ofertas_servicio o 
            JOIN usuarios u ON u.id = o.trabajador_id 
            JOIN perfiles_trabajador pt ON pt.usuario_id = o.trabajador_id
            WHERE o.solicitud_id = ? AND o.estado = 'pendiente'`, [req.params.id]
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener ofertas.' });
    }
});

app.put('/api/ofertas/:id/aceptar', authenticateToken, requireRole('cliente'), async (req, res) => {
    const conexion = await pool.getConnection();
    try {
        await conexion.beginTransaction();
        const [ofertaRows] = await conexion.execute('SELECT * FROM ofertas_servicio WHERE id = ?', [req.params.id]);
        if (ofertaRows.length === 0) {
            await conexion.rollback();
            return res.status(404).json({ message: 'Oferta no encontrada.' });
        }

        const oferta = ofertaRows[0];

        // Verificar que la solicitud pertenece a este cliente y sigue disponible
        const [solRows] = await conexion.execute(
            'SELECT id, estado FROM solicitudes_servicio WHERE id = ? AND cliente_id = ?',
            [oferta.solicitud_id, req.user.id]
        );
        if (solRows.length === 0) {
            await conexion.rollback();
            return res.status(403).json({ message: 'Esta solicitud no te pertenece.' });
        }
        if (solRows[0].estado !== 'buscando') {
            await conexion.rollback();
            return res.status(409).json({ message: 'Esta solicitud ya tiene un profesional asignado.' });
        }

        await conexion.execute(`UPDATE ofertas_servicio SET estado = 'rechazada' WHERE solicitud_id = ? AND id != ?`, [oferta.solicitud_id, oferta.id]);
        await conexion.execute(`UPDATE ofertas_servicio SET estado = 'aceptada' WHERE id = ?`, [oferta.id]);
        
        await conexion.execute(`
            UPDATE solicitudes_servicio 
            SET estado = 'asignado', trabajador_id = ?, costo_estimado = ?, fecha_asignacion = NOW() 
            WHERE id = ? AND cliente_id = ?`, 
            [oferta.trabajador_id, oferta.monto, oferta.solicitud_id, req.user.id]
        );
        
        await conexion.commit();

        // Tiempo real: el trabajador se entera al instante de que ganó el trabajo
        emitirEvento(`user_${oferta.trabajador_id}`, 'oferta_aceptada', { solicitud_id: oferta.solicitud_id });

        res.status(200).json({ message: 'Profesional asignado.', solicitud_id: oferta.solicitud_id, trabajador_id: oferta.trabajador_id });
    } catch (error) {
        await conexion.rollback();
        res.status(500).json({ message: 'Error interno.' });
    } finally {
        conexion.release();
    }
});

// ==========================================================================
// GESTIÓN DE TRABAJOS (TRABAJADOR)
// ==========================================================================
app.get('/api/trabajador/activos', authenticateToken, requireRole('trabajador'), async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT s.*, c.nombre AS categoria_nombre, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido
            FROM solicitudes_servicio s 
            JOIN categorias_servicio c ON c.id = s.categoria_id 
            JOIN usuarios u ON u.id = s.cliente_id
            WHERE s.trabajador_id = ? AND s.estado IN ('asignado', 'en_camino', 'en_proceso')`, 
            [req.user.id]
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error.' });
    }
});

app.put('/api/solicitudes/:id/estado', authenticateToken, requireRole('trabajador'), async (req, res) => {
    const { estado, costo_final } = req.body;
    const estadosValidos = ['en_camino', 'en_proceso', 'completado'];
    if (!estadosValidos.includes(estado)) return res.status(400).json({ message: 'Estado inválido.' });
    
    try {
        if (estado === 'completado') {
            await pool.execute(
                `UPDATE solicitudes_servicio SET estado = ?, costo_final = ?, fecha_completado = NOW() WHERE id = ? AND trabajador_id = ?`,
                [estado, costo_final || null, req.params.id, req.user.id]
            );
            await pool.execute('UPDATE perfiles_trabajador SET total_servicios = total_servicios + 1 WHERE usuario_id = ?', [req.user.id]);

            // ============ COMISIÓN DE PLATAFORMA ============
            // Al completar un trabajo se genera automáticamente una comisión
            // del COMISION_PORCENTAJE (15% por defecto) a cargo del trabajador.
            const [solRows] = await pool.execute(
                'SELECT costo_final, costo_estimado FROM solicitudes_servicio WHERE id = ?', [req.params.id]
            );
            const montoServicio = parseFloat(solRows[0]?.costo_final || solRows[0]?.costo_estimado || 0);
            let comisionInfo = null;
            if (montoServicio > 0) {
                const montoComision = Math.round(montoServicio * COMISION_PORCENTAJE) / 100;
                await pool.execute(
                    `INSERT IGNORE INTO comisiones (solicitud_id, trabajador_id, monto_servicio, porcentaje, monto_comision)
                     VALUES (?, ?, ?, ?, ?)`,
                    [req.params.id, req.user.id, montoServicio, COMISION_PORCENTAJE, montoComision]
                );
                comisionInfo = { porcentaje: COMISION_PORCENTAJE, monto: montoComision };
            }
            const [[sol]] = await pool.execute('SELECT cliente_id FROM solicitudes_servicio WHERE id = ?', [req.params.id]);
            if (sol) emitirEvento(`user_${sol.cliente_id}`, 'estado_actualizado', { solicitud_id: parseInt(req.params.id), estado });
            return res.status(200).json({ message: 'Estado actualizado.', comision: comisionInfo });
        } else {
            await pool.execute(`UPDATE solicitudes_servicio SET estado = ? WHERE id = ? AND trabajador_id = ?`, [estado, req.params.id, req.user.id]);
            const [[sol]] = await pool.execute('SELECT cliente_id FROM solicitudes_servicio WHERE id = ?', [req.params.id]);
            if (sol) emitirEvento(`user_${sol.cliente_id}`, 'estado_actualizado', { solicitud_id: parseInt(req.params.id), estado });
        }
        res.status(200).json({ message: 'Estado actualizado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar el estado.' });
    }
});

app.get('/api/trabajador/historial', authenticateToken, requireRole('trabajador'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT s.*, c.nombre AS categoria_nombre, c.icono,
                    u.nombre AS cliente_nombre,
                    p.id AS pago_id, p.estado AS pago_estado, p.metodo_pago, p.referencia_pago
             FROM solicitudes_servicio s
             JOIN categorias_servicio c ON c.id = s.categoria_id
             JOIN usuarios u ON u.id = s.cliente_id
             LEFT JOIN pagos p ON p.solicitud_id = s.id
             WHERE s.trabajador_id = ? AND s.estado = 'completado'
             ORDER BY s.fecha_creacion DESC`,
            [req.user.id]
        );
        const ganancias = rows.reduce((sum, r) => sum + parseFloat(r.costo_final || r.costo_estimado || 0), 0);

        res.status(200).json({ solicitudes: rows, ganancias_totales: ganancias.toFixed(2) });
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener historial.' });
    }
});

// ==========================================================================
// CALIFICACIONES
// ==========================================================================
app.post('/api/calificaciones', authenticateToken, requireRole('cliente'), async (req, res) => {
    const { solicitud_id, puntuacion, comentario } = req.body;
    if (!solicitud_id || !puntuacion) return res.status(400).json({ message: 'Datos incompletos.' });

    try {
        const [solRows] = await pool.execute(
            `SELECT trabajador_id FROM solicitudes_servicio WHERE id = ? AND cliente_id = ? AND estado = 'completado'`,
            [solicitud_id, req.user.id]
        );
        if (solRows.length === 0) return res.status(404).json({ message: 'Solicitud no válida para calificar.' });

        const trabajadorId = solRows[0].trabajador_id;

        await pool.execute(
            'INSERT INTO calificaciones (solicitud_id, cliente_id, trabajador_id, puntuacion, comentario) VALUES (?, ?, ?, ?, ?)',
            [solicitud_id, req.user.id, trabajadorId, puntuacion, comentario || null]
        );

        const [avgRows] = await pool.execute(
            'SELECT AVG(puntuacion) AS promedio FROM calificaciones WHERE trabajador_id = ?',
            [trabajadorId]
        );
        await pool.execute(
            'UPDATE perfiles_trabajador SET calificacion_promedio = ? WHERE usuario_id = ?',
            [parseFloat(avgRows[0].promedio).toFixed(2), trabajadorId]
        );

        res.status(201).json({ message: '¡Gracias por tu calificación!' });
    } catch (error) {
        res.status(500).json({ message: 'Error al registrar la calificación.' });
    }
});

// ==========================================================================
// ADMINISTRACIÓN BÁSICA
// ==========================================================================
app.get('/api/admin/usuarios', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT id, nombre, apellido, email, rol, estado, fecha_registro FROM usuarios ORDER BY fecha_registro DESC');
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener usuarios.' });
    }
});

app.put('/api/admin/trabajador/:id/verificar', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        await pool.execute('UPDATE perfiles_trabajador SET verificado = TRUE WHERE usuario_id = ?', [req.params.id]);
        res.status(200).json({ message: 'Trabajador verificado con éxito.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al verificar trabajador.' });
    }
});

app.put('/api/admin/usuarios/:id/suspender', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        await pool.execute("UPDATE usuarios SET estado = 'suspendido' WHERE id = ?", [req.params.id]);
        res.status(200).json({ message: 'Usuario suspendido.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al suspender usuario.' });
    }
});

app.put('/api/admin/usuarios/:id/reactivar', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        await pool.execute("UPDATE usuarios SET estado = 'activo' WHERE id = ?", [req.params.id]);
        res.status(200).json({ message: 'Usuario reactivado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al reactivar usuario.' });
    }
});

// Crear nueva categoría de servicio (usado por admin.html)
app.post('/api/admin/categorias', authenticateToken, requireRole('admin'), async (req, res) => {
    const { nombre, icono, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ message: 'El nombre es obligatorio.' });
    try {
        // DETECCIÓN AUTOMÁTICA: si no se indica un icono Lucide válido,
        // se elige uno acorde al nombre de la categoría (nunca emojis).
        const iconoFinal = esIconoLucide(icono) ? icono : iconoParaCategoria(nombre);

        await pool.execute(
            'INSERT INTO categorias_servicio (nombre, icono, descripcion) VALUES (?, ?, ?)',
            [nombre, iconoFinal, descripcion || null]
        );
        res.status(201).json({ message: 'Categoría creada con éxito.', icono: iconoFinal });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Ya existe una categoría con ese nombre.' });
        res.status(500).json({ message: 'Error al crear la categoría.' });
    }
});

// ==========================================================================
// ESPECIALIDADES DEL TRABAJADOR (ver y actualizar)
// ==========================================================================
app.get('/api/trabajador/especialidades', authenticateToken, requireRole('trabajador'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT c.id, c.nombre FROM trabajador_categorias tc
             JOIN categorias_servicio c ON c.id = tc.categoria_id
             WHERE tc.trabajador_id = ?`,
            [req.user.id]
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener especialidades.' });
    }
});

app.put('/api/trabajador/especialidades', authenticateToken, requireRole('trabajador'), async (req, res) => {
    const { categorias } = req.body; // array de IDs de categoría
    if (!Array.isArray(categorias) || categorias.length === 0) {
        return res.status(400).json({ message: 'Selecciona al menos una especialidad.' });
    }
    const conexion = await pool.getConnection();
    try {
        await conexion.beginTransaction();
        await conexion.execute('DELETE FROM trabajador_categorias WHERE trabajador_id = ?', [req.user.id]);
        for (const catId of [...new Set(categorias.map(Number))]) {
            const [valid] = await conexion.execute('SELECT id FROM categorias_servicio WHERE id = ?', [catId]);
            if (valid.length > 0) {
                await conexion.execute(
                    'INSERT INTO trabajador_categorias (trabajador_id, categoria_id) VALUES (?, ?)',
                    [req.user.id, catId]
                );
            }
        }
        await conexion.commit();
        res.status(200).json({ message: 'Especialidades actualizadas con éxito.' });
    } catch (error) {
        await conexion.rollback();
        res.status(500).json({ message: 'Error al actualizar especialidades.' });
    } finally {
        conexion.release();
    }
});

// ==========================================================================
// CHAT CLIENTE <-> TRABAJADOR (por solicitud)
// ==========================================================================
// Un usuario solo puede participar en el chat si es el cliente o el trabajador
// asignado de esa solicitud.
async function obtenerSolicitudSiParticipa(solicitudId, userId) {
    const [rows] = await pool.execute(
        'SELECT id, cliente_id, trabajador_id, estado FROM solicitudes_servicio WHERE id = ?',
        [solicitudId]
    );
    if (rows.length === 0) return null;
    const s = rows[0];
    if (s.cliente_id !== userId && s.trabajador_id !== userId) return null;
    return s;
}

app.get('/api/solicitudes/:id/mensajes', authenticateToken, async (req, res) => {
    try {
        const solicitud = await obtenerSolicitudSiParticipa(parseInt(req.params.id), req.user.id);
        if (!solicitud) return res.status(403).json({ message: 'No participas en esta conversación.' });

        const [rows] = await pool.execute(
            `SELECT m.id, m.remitente_id, m.contenido, m.fecha, u.nombre AS remitente_nombre
             FROM mensajes m JOIN usuarios u ON u.id = m.remitente_id
             WHERE m.solicitud_id = ? ORDER BY m.fecha ASC, m.id ASC`,
            [req.params.id]
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al cargar los mensajes.' });
    }
});

app.post('/api/solicitudes/:id/mensajes', authenticateToken, async (req, res) => {
    const contenido = (req.body.contenido || '').toString().trim();
    if (!contenido) return res.status(400).json({ message: 'El mensaje no puede estar vacío.' });
    if (contenido.length > 1000) return res.status(400).json({ message: 'Mensaje demasiado largo (máx. 1000 caracteres).' });

    try {
        const solicitud = await obtenerSolicitudSiParticipa(parseInt(req.params.id), req.user.id);
        if (!solicitud) return res.status(403).json({ message: 'No participas en esta conversación.' });
        if (!solicitud.trabajador_id) return res.status(409).json({ message: 'El chat se habilita cuando hay un profesional asignado.' });
        if (['cancelado'].includes(solicitud.estado)) return res.status(409).json({ message: 'Esta solicitud fue cancelada.' });

        const [result] = await pool.execute(
            'INSERT INTO mensajes (solicitud_id, remitente_id, contenido) VALUES (?, ?, ?)',
            [req.params.id, req.user.id, contenido]
        );

        // Tiempo real: entrega instantánea al otro participante
        emitirEvento(`solicitud_${req.params.id}`, 'nuevo_mensaje', { solicitud_id: parseInt(req.params.id), remitente_id: req.user.id });
        const destinatario = solicitud.cliente_id === req.user.id ? solicitud.trabajador_id : solicitud.cliente_id;
        if (destinatario) emitirEvento(`user_${destinatario}`, 'mensaje_recibido', { solicitud_id: parseInt(req.params.id) });

        res.status(201).json({ message: 'Mensaje enviado.', id: result.insertId });
    } catch (error) {
        res.status(500).json({ message: 'Error al enviar el mensaje.' });
    }
});

// ==========================================================================
// TASA REFERENCIAL BCV (USD -> Bs) con caché de 30 minutos
// ==========================================================================
let cacheBCV = { tasa: null, fecha: null, obtenido: 0 };

app.get('/api/tasa-bcv', async (req, res) => {
    const TREINTA_MIN = 30 * 60 * 1000;
    if (cacheBCV.tasa && (Date.now() - cacheBCV.obtenido) < TREINTA_MIN) {
        return res.status(200).json({ tasa: cacheBCV.tasa, fecha: cacheBCV.fecha, fuente: 'BCV (caché)' });
    }

    // Intentamos dos APIs públicas que replican la tasa oficial del BCV
    const fuentes = [
        {
            url: 'https://ve.dolarapi.com/v1/dolares/oficial',
            parse: (d) => ({ tasa: d.promedio, fecha: d.fechaActualizacion })
        },
        {
            url: 'https://pydolarve.org/api/v1/dollar?page=bcv',
            parse: (d) => ({ tasa: d?.monitors?.usd?.price, fecha: d?.datetime?.date || null })
        }
    ];

    for (const fuente of fuentes) {
        try {
            const r = await fetch(fuente.url, { headers: { 'Accept': 'application/json' } });
            if (!r.ok) continue;
            const data = await r.json();
            const { tasa, fecha } = fuente.parse(data);
            if (tasa && !isNaN(parseFloat(tasa))) {
                cacheBCV = { tasa: parseFloat(tasa), fecha: fecha || new Date().toISOString(), obtenido: Date.now() };
                return res.status(200).json({ tasa: cacheBCV.tasa, fecha: cacheBCV.fecha, fuente: 'BCV' });
            }
        } catch (e) { /* probar siguiente fuente */ }
    }

    // Si ninguna fuente respondió pero hay caché viejo, lo devolvemos igual
    if (cacheBCV.tasa) {
        return res.status(200).json({ tasa: cacheBCV.tasa, fecha: cacheBCV.fecha, fuente: 'BCV (caché antiguo)' });
    }
    res.status(503).json({ message: 'No se pudo obtener la tasa del BCV en este momento.' });
});

// ==========================================================================
// CONFIGURACIÓN PÚBLICA DEL FRONTEND (ej. clave de Google Maps)
// ==========================================================================
app.get('/api/config', (req, res) => {
    res.status(200).json({
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
    });
});

// ==========================================================================
// ADMIN: ESTADÍSTICAS Y SOLICITUDES GLOBALES
// ==========================================================================
app.get('/api/admin/stats', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [[usuarios]] = await pool.query(`
            SELECT
                SUM(rol = 'cliente') AS clientes,
                SUM(rol = 'trabajador') AS trabajadores,
                SUM(estado = 'suspendido') AS suspendidos
            FROM usuarios`);
        const [[solicitudes]] = await pool.query(`
            SELECT
                COUNT(*) AS total,
                SUM(estado = 'buscando') AS buscando,
                SUM(estado IN ('asignado','en_camino','en_proceso')) AS en_curso,
                SUM(estado = 'completado') AS completadas,
                SUM(estado = 'cancelado') AS canceladas,
                COALESCE(SUM(CASE WHEN estado = 'completado' THEN COALESCE(costo_final, costo_estimado, 0) END), 0) AS ingresos
            FROM solicitudes_servicio`);
        const [[categorias]] = await pool.query('SELECT COUNT(*) AS total FROM categorias_servicio WHERE activo = TRUE');
        const [[verificaciones]] = await pool.query('SELECT COUNT(*) AS pendientes FROM perfiles_trabajador WHERE verificado = FALSE');

        res.status(200).json({
            clientes: Number(usuarios.clientes) || 0,
            trabajadores: Number(usuarios.trabajadores) || 0,
            suspendidos: Number(usuarios.suspendidos) || 0,
            solicitudes_total: Number(solicitudes.total) || 0,
            solicitudes_buscando: Number(solicitudes.buscando) || 0,
            solicitudes_en_curso: Number(solicitudes.en_curso) || 0,
            solicitudes_completadas: Number(solicitudes.completadas) || 0,
            solicitudes_canceladas: Number(solicitudes.canceladas) || 0,
            ingresos_completados: parseFloat(solicitudes.ingresos) || 0,
            categorias: Number(categorias.total) || 0,
            verificaciones_pendientes: Number(verificaciones.pendientes) || 0
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al calcular estadísticas.' });
    }
});

app.get('/api/admin/solicitudes', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT s.id, s.direccion, s.urgencia, s.estado, s.costo_estimado, s.costo_final, s.fecha_creacion,
                   c.nombre AS categoria_nombre,
                   uc.nombre AS cliente_nombre, uc.apellido AS cliente_apellido,
                   ut.nombre AS trabajador_nombre, ut.apellido AS trabajador_apellido
            FROM solicitudes_servicio s
            JOIN categorias_servicio c ON c.id = s.categoria_id
            JOIN usuarios uc ON uc.id = s.cliente_id
            LEFT JOIN usuarios ut ON ut.id = s.trabajador_id
            ORDER BY s.fecha_creacion DESC
            LIMIT 100`);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener solicitudes.' });
    }
});

// Lista de trabajadores con su estado de verificación (para el botón "verificar")
app.get('/api/admin/trabajadores', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.email, u.estado,
                   pt.verificado, pt.disponible, pt.calificacion_promedio, pt.total_servicios,
                   pt.documento_identidad, pt.cancelaciones
            FROM usuarios u
            LEFT JOIN perfiles_trabajador pt ON pt.usuario_id = u.id
            WHERE u.rol = 'trabajador'
            ORDER BY u.fecha_registro DESC`);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener trabajadores.' });
    }
});

// ==========================================================================
// MÓDULO DE PAGOS (estilo apps de servicio: Pago Móvil / Zelle / Efectivo)
// Flujo: trabajador completa -> cliente registra el pago con referencia ->
// trabajador confirma que lo recibió.
// ==========================================================================
app.post('/api/solicitudes/:id/pago', authenticateToken, requireRole('cliente'), async (req, res) => {
    const { metodo_pago, referencia_pago } = req.body;
    const metodosValidos = ['Pago Móvil', 'Zelle', 'Transferencia', 'Efectivo / Divisas'];
    if (!metodo_pago || !metodosValidos.includes(metodo_pago)) {
        return res.status(400).json({ message: 'Selecciona un método de pago válido.' });
    }
    if (metodo_pago !== 'Efectivo / Divisas' && !referencia_pago) {
        return res.status(400).json({ message: 'Indica el número de referencia del pago.' });
    }

    try {
        const [solRows] = await pool.execute(
            `SELECT id, costo_final, costo_estimado FROM solicitudes_servicio
             WHERE id = ? AND cliente_id = ? AND estado = 'completado'`,
            [req.params.id, req.user.id]
        );
        if (solRows.length === 0) return res.status(404).json({ message: 'Solo puedes pagar servicios completados.' });

        const monto = solRows[0].costo_final || solRows[0].costo_estimado || 0;

        // La tabla pagos tiene UNIQUE(solicitud_id): si reintenta, se actualiza
        await pool.execute(
            `INSERT INTO pagos (solicitud_id, monto, metodo_pago, referencia_pago, estado)
             VALUES (?, ?, ?, ?, 'pendiente')
             ON DUPLICATE KEY UPDATE monto = VALUES(monto), metodo_pago = VALUES(metodo_pago),
                                     referencia_pago = VALUES(referencia_pago), estado = 'pendiente'`,
            [req.params.id, monto, metodo_pago, referencia_pago || null]
        );
        res.status(201).json({ message: 'Pago registrado. El profesional confirmará la recepción.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al registrar el pago.' });
    }
});

app.get('/api/solicitudes/:id/pago', authenticateToken, async (req, res) => {
    try {
        const solicitud = await obtenerSolicitudSiParticipa(parseInt(req.params.id), req.user.id);
        if (!solicitud) return res.status(403).json({ message: 'Sin acceso a este pago.' });
        const [rows] = await pool.execute('SELECT * FROM pagos WHERE solicitud_id = ?', [req.params.id]);
        res.status(200).json(rows[0] || null);
    } catch (error) {
        res.status(500).json({ message: 'Error al consultar el pago.' });
    }
});

// El trabajador confirma que recibió el dinero
app.put('/api/pagos/:id/confirmar', authenticateToken, requireRole('trabajador'), async (req, res) => {
    try {
        const [result] = await pool.execute(
            `UPDATE pagos p JOIN solicitudes_servicio s ON s.id = p.solicitud_id
             SET p.estado = 'pagado'
             WHERE p.id = ? AND s.trabajador_id = ?`,
            [req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Pago no encontrado o no te corresponde.' });
        res.status(200).json({ message: 'Pago confirmado. ¡Servicio cerrado con éxito!' });
    } catch (error) {
        res.status(500).json({ message: 'Error al confirmar el pago.' });
    }
});

// Última solicitud completada del cliente con cierre pendiente (pago o calificación)
app.get('/api/cliente/pendiente-cierre', authenticateToken, requireRole('cliente'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT s.id, s.costo_final, s.costo_estimado, s.fecha_completado,
                    c.nombre AS categoria_nombre,
                    u.nombre AS trabajador_nombre, u.apellido AS trabajador_apellido,
                    p.id AS pago_id, p.estado AS pago_estado, p.metodo_pago,
                    cal.id AS calificacion_id
             FROM solicitudes_servicio s
             JOIN categorias_servicio c ON c.id = s.categoria_id
             LEFT JOIN usuarios u ON u.id = s.trabajador_id
             LEFT JOIN pagos p ON p.solicitud_id = s.id
             LEFT JOIN calificaciones cal ON cal.solicitud_id = s.id
             WHERE s.cliente_id = ? AND s.estado = 'completado'
               AND (p.id IS NULL OR cal.id IS NULL)
             ORDER BY s.fecha_completado DESC LIMIT 1`,
            [req.user.id]
        );
        res.status(200).json(rows[0] || null);
    } catch (error) {
        res.status(500).json({ message: 'Error al consultar cierres pendientes.' });
    }
});

// ==========================================================================
// COMISIONES DE PLATAFORMA Y CONTROL DE DEUDA
// ==========================================================================
const COMISION_PORCENTAJE = parseFloat(process.env.COMISION_PORCENTAJE || '7');
const DIAS_LIMITE_DEUDA = parseInt(process.env.DIAS_LIMITE_DEUDA || '30');

// Resumen de deuda de un trabajador. "Vencida" = alguna comisión sin pagar
// generada hace más de DIAS_LIMITE_DEUDA días -> el trabajador queda bloqueado
// para tomar nuevos trabajos hasta saldar TODA su deuda.
async function obtenerDeudaTrabajador(trabajadorId) {
    const [[resumen]] = await pool.execute(
        `SELECT
            COALESCE(SUM(CASE WHEN estado != 'pagada' THEN monto_comision END), 0) AS deuda_total,
            COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN monto_comision END), 0) AS deuda_pendiente,
            COALESCE(SUM(CASE WHEN estado = 'reportada' THEN monto_comision END), 0) AS deuda_reportada,
            SUM(estado != 'pagada' AND fecha_generada < DATE_SUB(NOW(), INTERVAL ? DAY)) AS vencidas,
            MIN(CASE WHEN estado != 'pagada' THEN fecha_generada END) AS deuda_mas_antigua
         FROM comisiones WHERE trabajador_id = ?`,
        [DIAS_LIMITE_DEUDA, trabajadorId]
    );
    const bloqueado = Number(resumen.vencidas) > 0;
    let dias_restantes = null;
    if (!bloqueado && resumen.deuda_mas_antigua) {
        const transcurridos = Math.floor((Date.now() - new Date(resumen.deuda_mas_antigua).getTime()) / 86400000);
        dias_restantes = Math.max(0, DIAS_LIMITE_DEUDA - transcurridos);
    }
    return {
        deuda_total: parseFloat(resumen.deuda_total) || 0,
        deuda_pendiente: parseFloat(resumen.deuda_pendiente) || 0,
        deuda_reportada: parseFloat(resumen.deuda_reportada) || 0,
        bloqueado,
        dias_restantes,
        porcentaje: COMISION_PORCENTAJE,
        dias_limite: DIAS_LIMITE_DEUDA
    };
}

// Middleware: impide tomar trabajos nuevos con deuda vencida
async function bloquearSiDeudaVencida(req, res, next) {
    try {
        const deuda = await obtenerDeudaTrabajador(req.user.id);
        if (deuda.bloqueado) {
            return res.status(403).json({
                message: `Cuenta bloqueada: tienes comisiones de plataforma vencidas (más de ${DIAS_LIMITE_DEUDA} días) por $${deuda.deuda_total.toFixed(2)}. Salda tu deuda en Perfil > Comisiones para reactivar tu cuenta.`,
                bloqueado_por_deuda: true,
                deuda_total: deuda.deuda_total
            });
        }
        next();
    } catch (e) { next(); }
}

// Detalle de comisiones del trabajador + resumen de deuda
app.get('/api/trabajador/comisiones', authenticateToken, requireRole('trabajador'), async (req, res) => {
    try {
        const [comisiones] = await pool.execute(
            `SELECT co.*, c.nombre AS categoria_nombre,
                    DATEDIFF(NOW(), co.fecha_generada) AS dias_transcurridos
             FROM comisiones co
             JOIN solicitudes_servicio s ON s.id = co.solicitud_id
             JOIN categorias_servicio c ON c.id = s.categoria_id
             WHERE co.trabajador_id = ?
             ORDER BY FIELD(co.estado, 'pendiente', 'reportada', 'pagada'), co.fecha_generada ASC`,
            [req.user.id]
        );
        const resumen = await obtenerDeudaTrabajador(req.user.id);
        res.status(200).json({ comisiones, resumen });
    } catch (error) {
        res.status(500).json({ message: 'Error al consultar tus comisiones.' });
    }
});

// El trabajador reporta el pago de TODA su deuda pendiente
app.post('/api/trabajador/comisiones/reportar-pago', authenticateToken, requireRole('trabajador'), async (req, res) => {
    const { metodo_pago, referencia_pago } = req.body;
    if (!metodo_pago) return res.status(400).json({ message: 'Indica el método de pago.' });
    if (metodo_pago !== 'Efectivo / Divisas' && !referencia_pago) {
        return res.status(400).json({ message: 'Indica el número de referencia del pago.' });
    }
    try {
        const [result] = await pool.execute(
            `UPDATE comisiones SET estado = 'reportada', metodo_pago = ?, referencia_pago = ?
             WHERE trabajador_id = ? AND estado = 'pendiente'`,
            [metodo_pago, referencia_pago || null, req.user.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'No tienes comisiones pendientes por pagar.' });
        res.status(200).json({ message: `Pago reportado (${result.affectedRows} comisión(es)). El equipo Fixio lo confirmará en breve.` });
    } catch (error) {
        res.status(500).json({ message: 'Error al reportar el pago.' });
    }
});

// ADMIN: comisiones agrupadas por trabajador para confirmar/rechazar pagos
app.get('/api/admin/comisiones', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT u.id AS trabajador_id, u.nombre, u.apellido, u.email,
                    COALESCE(SUM(CASE WHEN co.estado = 'pendiente' THEN co.monto_comision END), 0) AS pendiente,
                    COALESCE(SUM(CASE WHEN co.estado = 'reportada' THEN co.monto_comision END), 0) AS reportada,
                    COALESCE(SUM(CASE WHEN co.estado = 'pagada' THEN co.monto_comision END), 0) AS pagada,
                    SUM(co.estado != 'pagada' AND co.fecha_generada < DATE_SUB(NOW(), INTERVAL ? DAY)) AS vencidas,
                    MAX(co.referencia_pago) AS ultima_referencia,
                    MAX(co.metodo_pago) AS ultimo_metodo,
                    COUNT(*) AS total_comisiones
             FROM comisiones co
             JOIN usuarios u ON u.id = co.trabajador_id
             GROUP BY u.id, u.nombre, u.apellido, u.email
             ORDER BY reportada DESC, pendiente DESC`,
            [DIAS_LIMITE_DEUDA]
        );
        res.status(200).json(rows.map(r => ({
            ...r,
            pendiente: parseFloat(r.pendiente), reportada: parseFloat(r.reportada),
            pagada: parseFloat(r.pagada), bloqueado: Number(r.vencidas) > 0
        })));
    } catch (error) {
        res.status(500).json({ message: 'Error al consultar comisiones.' });
    }
});

// ADMIN confirma el pago reportado de un trabajador (desbloquea su cuenta)
app.put('/api/admin/comisiones/:trabajadorId/confirmar', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [result] = await pool.execute(
            `UPDATE comisiones SET estado = 'pagada', fecha_pago = NOW()
             WHERE trabajador_id = ? AND estado = 'reportada'`,
            [req.params.trabajadorId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Este trabajador no tiene pagos reportados.' });
        res.status(200).json({ message: `Deuda saldada: ${result.affectedRows} comisión(es) confirmadas. Cuenta reactivada.` });
    } catch (error) {
        res.status(500).json({ message: 'Error al confirmar el pago.' });
    }
});

// ADMIN rechaza el pago reportado (vuelve a 'pendiente')
app.put('/api/admin/comisiones/:trabajadorId/rechazar', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [result] = await pool.execute(
            `UPDATE comisiones SET estado = 'pendiente' WHERE trabajador_id = ? AND estado = 'reportada'`,
            [req.params.trabajadorId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Este trabajador no tiene pagos reportados.' });
        res.status(200).json({ message: 'Pago rechazado. Las comisiones vuelven a estado pendiente.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al rechazar el pago.' });
    }
});

// ==========================================================================
// VERIFICACIÓN DE IDENTIDAD DEL TRABAJADOR
// El trabajador sube foto de su cédula; el admin la revisa y lo verifica.
// ==========================================================================
app.post('/api/trabajador/documento', authenticateToken, requireRole('trabajador'), async (req, res) => {
    const { documento } = req.body;
    if (!documento || !documento.startsWith('data:image')) {
        return res.status(400).json({ message: 'Sube una imagen válida de tu documento de identidad.' });
    }
    try {
        const url = await procesarImagenBase64(documento);
        await pool.execute(
            'UPDATE perfiles_trabajador SET documento_identidad = ?, verificado = FALSE WHERE usuario_id = ?',
            [url, req.user.id]
        );
        res.status(200).json({ message: 'Documento recibido. El equipo Fixio lo revisará para verificar tu cuenta.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al subir el documento.' });
    }
});

// ==========================================================================
// REASIGNACIÓN Y PENALIZACIÓN (estilo apps de servicio)
// ==========================================================================
// Reabre la búsqueda sin crear otra solicitud, penalizando al trabajador que
// no llegó, y revive las demás ofertas que estaban en espera.
async function reabrirSolicitud(conexion, solicitud, trabajadorPenalizado) {
    await conexion.execute(
        `UPDATE solicitudes_servicio
         SET estado = 'buscando', trabajador_id = NULL, fecha_asignacion = NULL, costo_estimado = NULL
         WHERE id = ?`,
        [solicitud.id]
    );
    // La oferta del trabajador que falló queda rechazada; las demás vuelven a estar disponibles
    await conexion.execute(
        `UPDATE ofertas_servicio SET estado = 'rechazada' WHERE solicitud_id = ? AND trabajador_id = ?`,
        [solicitud.id, trabajadorPenalizado]
    );
    await conexion.execute(
        `UPDATE ofertas_servicio SET estado = 'pendiente' WHERE solicitud_id = ? AND trabajador_id != ?`,
        [solicitud.id, trabajadorPenalizado]
    );
    // Penalización: contador visible para el admin (afecta la reputación interna)
    await conexion.execute(
        `UPDATE perfiles_trabajador SET cancelaciones = cancelaciones + 1 WHERE usuario_id = ?`,
        [trabajadorPenalizado]
    );
}

// CLIENTE: "el profesional no llegó" -> reabrir búsqueda con las ofertas anteriores
app.put('/api/solicitudes/:id/reabrir', authenticateToken, requireRole('cliente'), async (req, res) => {
    const conexion = await pool.getConnection();
    try {
        await conexion.beginTransaction();
        const [rows] = await conexion.execute(
            `SELECT id, trabajador_id, estado FROM solicitudes_servicio WHERE id = ? AND cliente_id = ?`,
            [req.params.id, req.user.id]
        );
        if (rows.length === 0) { await conexion.rollback(); return res.status(404).json({ message: 'Solicitud no encontrada.' }); }
        const s = rows[0];
        if (!['asignado', 'en_camino'].includes(s.estado)) {
            await conexion.rollback();
            return res.status(409).json({ message: 'Solo puedes reabrir la búsqueda antes de que inicie el trabajo.' });
        }
        const penalizado = s.trabajador_id;
        await reabrirSolicitud(conexion, s, penalizado);
        await conexion.commit();

        emitirEvento(`user_${penalizado}`, 'trabajo_reasignado', { solicitud_id: s.id });
        res.status(200).json({ message: 'Búsqueda reabierta. Tus ofertas anteriores vuelven a estar disponibles.' });
    } catch (error) {
        await conexion.rollback();
        res.status(500).json({ message: 'Error al reabrir la búsqueda.' });
    } finally { conexion.release(); }
});

// TRABAJADOR: abandonar un trabajo asignado (con penalización)
app.put('/api/solicitudes/:id/abandonar', authenticateToken, requireRole('trabajador'), async (req, res) => {
    const conexion = await pool.getConnection();
    try {
        await conexion.beginTransaction();
        const [rows] = await conexion.execute(
            `SELECT id, cliente_id, estado FROM solicitudes_servicio WHERE id = ? AND trabajador_id = ?`,
            [req.params.id, req.user.id]
        );
        if (rows.length === 0) { await conexion.rollback(); return res.status(404).json({ message: 'Trabajo no encontrado.' }); }
        const s = rows[0];
        if (!['asignado', 'en_camino', 'en_proceso'].includes(s.estado)) {
            await conexion.rollback();
            return res.status(409).json({ message: 'Este trabajo ya no se puede abandonar.' });
        }
        await reabrirSolicitud(conexion, s, req.user.id);
        await conexion.commit();

        emitirEvento(`user_${s.cliente_id}`, 'trabajador_abandono', { solicitud_id: s.id });
        res.status(200).json({ message: 'Trabajo abandonado. Se registró una penalización en tu perfil.' });
    } catch (error) {
        await conexion.rollback();
        res.status(500).json({ message: 'Error al abandonar el trabajo.' });
    } finally { conexion.release(); }
});

app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', servicio: 'Fixio' }));

const PORT = process.env.PORT || 5500;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYSTEM ACTIVE] Fixio corriendo en el puerto: ${PORT}`);
    console.log(`[SYSTEM] Abre la app en tu navegador: http://localhost:${PORT}`);
});

// ==========================================================================
// TIEMPO REAL (Socket.io): chat instantáneo y notificaciones en vivo.
// Los paneles siguen teniendo polling como respaldo si el socket falla.
// ==========================================================================
io = new SocketServer(server, { cors: { origin: '*' } });

io.use((socket, next) => {
    try {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(new Error('Sin token'));
        const payload = jwt.verify(token, SECRET_KEY);
        socket.userId = payload.id;
        socket.userRol = payload.rol;
        next();
    } catch (e) { next(new Error('Token inválido')); }
});

io.on('connection', (socket) => {
    // Cada usuario tiene su sala personal para notificaciones dirigidas
    socket.join(`user_${socket.userId}`);

    // Unirse al chat de una solicitud (solo si participa en ella)
    socket.on('unirse_solicitud', async (solicitudId) => {
        try {
            const s = await obtenerSolicitudSiParticipa(parseInt(solicitudId), socket.userId);
            if (s) socket.join(`solicitud_${solicitudId}`);
        } catch (e) {}
    });
    socket.on('salir_solicitud', (solicitudId) => socket.leave(`solicitud_${solicitudId}`));
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n[ERROR FATAL] El puerto ${PORT} ya está en uso.`);
        console.error(`Causa típica: Live Server de VS Code usa el puerto 5500.`);
        console.error(`Solución: cierra Live Server (ya no lo necesitas, este servidor sirve el frontend)`);
        console.error(`o cambia PORT en el archivo .env y en API_URL de los HTML.\n`);
    } else {
        console.error('[ERROR FATAL] No se pudo iniciar el servidor:', err.message);
    }
    process.exit(1);
});

// Verificación temprana de la conexión a MySQL con mensaje claro
pool.query('SELECT 1').then(() => {
    console.log('[SYSTEM] Conexión a MySQL/MariaDB establecida.');
}).catch((err) => {
    console.error(`\n[ERROR BD] No se pudo conectar a MySQL: ${err.message}`);
    console.error('Verifica que XAMPP/MariaDB esté iniciado y que DB_HOST/DB_USER/DB_PASSWORD del .env sean correctos.\n');
});