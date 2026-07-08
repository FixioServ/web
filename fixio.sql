/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: tuservicioexpress
-- ------------------------------------------------------
-- Server version	10.11.14-MariaDB-0ubuntu0.24.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `calificaciones`
--

DROP TABLE IF EXISTS `calificaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `calificaciones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `solicitud_id` int(11) NOT NULL,
  `cliente_id` int(11) NOT NULL,
  `trabajador_id` int(11) NOT NULL,
  `puntuacion` tinyint(4) NOT NULL CHECK (`puntuacion` between 1 and 5),
  `comentario` text DEFAULT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `solicitud_id` (`solicitud_id`),
  KEY `cliente_id` (`cliente_id`),
  KEY `trabajador_id` (`trabajador_id`),
  CONSTRAINT `calificaciones_ibfk_1` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes_servicio` (`id`) ON DELETE CASCADE,
  CONSTRAINT `calificaciones_ibfk_2` FOREIGN KEY (`cliente_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `calificaciones_ibfk_3` FOREIGN KEY (`trabajador_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calificaciones`
--

LOCK TABLES `calificaciones` WRITE;
/*!40000 ALTER TABLE `calificaciones` DISABLE KEYS */;
/*!40000 ALTER TABLE `calificaciones` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `categorias_servicio`
--

DROP TABLE IF EXISTS `categorias_servicio`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `categorias_servicio` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `icono` varchar(20) DEFAULT NULL,
  `descripcion` text DEFAULT NULL,
  `activo` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=287 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `categorias_servicio`
--

LOCK TABLES `categorias_servicio` WRITE;
/*!40000 ALTER TABLE `categorias_servicio` DISABLE KEYS */;
INSERT INTO `categorias_servicio` VALUES
(1,'Mecánica','car','Reparación y mantenimiento de vehículos',1),
(2,'Electricidad','zap','Instalaciones y reparaciones eléctricas',1),
(3,'Plomería','droplets','Fugas, tuberías e instalaciones sanitarias',1),
(4,'Refrigeración','snowflake','Aires acondicionados y neveras',1),
(5,'Cerrajería','key-round','Cerraduras, llaves y seguridad',1),
(6,'Jardinería','leaf','Mantenimiento de jardines y áreas verdes',1),
(13,'Limpieza y Hogar','sparkles','Limpieza profunda, planchado y organización',1),
(14,'Cuidado de Niños','baby','Niñeras y cuidado infantil de confianza',1),
(15,'Construcción','hard-hat','Albañilería, remodelaciones y obras',1),
(16,'Educación','book-open','Tutorías y clases particulares',1),
(17,'Instalación de Cámaras','video','Seguridad, CCTV y monitoreo',1),
(209,'Fumigación','bug','Control de plagas y fumigación general.',1);
/*!40000 ALTER TABLE `categorias_servicio` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `codigos_recuperacion`
--

DROP TABLE IF EXISTS `codigos_recuperacion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `codigos_recuperacion` (
  `email` varchar(255) NOT NULL,
  `codigo` varchar(10) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `codigos_recuperacion`
--

LOCK TABLES `codigos_recuperacion` WRITE;
/*!40000 ALTER TABLE `codigos_recuperacion` DISABLE KEYS */;
/*!40000 ALTER TABLE `codigos_recuperacion` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `codigos_registro`
--

DROP TABLE IF EXISTS `codigos_registro`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `codigos_registro` (
  `email` varchar(255) NOT NULL,
  `codigo` varchar(10) NOT NULL,
  `nombre` varchar(100) DEFAULT NULL,
  `apellido` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `rol` enum('cliente','trabajador') DEFAULT 'cliente',
  `oficios` text DEFAULT NULL,
  `categoria_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `codigos_registro`
--

LOCK TABLES `codigos_registro` WRITE;
/*!40000 ALTER TABLE `codigos_registro` DISABLE KEYS */;
/*!40000 ALTER TABLE `codigos_registro` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `comisiones`
--

DROP TABLE IF EXISTS `comisiones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `comisiones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `solicitud_id` int(11) NOT NULL,
  `trabajador_id` int(11) NOT NULL,
  `monto_servicio` decimal(10,2) NOT NULL,
  `porcentaje` decimal(5,2) NOT NULL,
  `monto_comision` decimal(10,2) NOT NULL,
  `estado` enum('pendiente','reportada','pagada') DEFAULT 'pendiente',
  `metodo_pago` varchar(50) DEFAULT NULL,
  `referencia_pago` varchar(100) DEFAULT NULL,
  `fecha_generada` timestamp NOT NULL DEFAULT current_timestamp(),
  `fecha_pago` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `solicitud_id` (`solicitud_id`),
  KEY `idx_comisiones_trabajador` (`trabajador_id`,`estado`),
  CONSTRAINT `comisiones_ibfk_1` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes_servicio` (`id`) ON DELETE CASCADE,
  CONSTRAINT `comisiones_ibfk_2` FOREIGN KEY (`trabajador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `comisiones`
--

LOCK TABLES `comisiones` WRITE;
/*!40000 ALTER TABLE `comisiones` DISABLE KEYS */;
/*!40000 ALTER TABLE `comisiones` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `mensajes`
--

DROP TABLE IF EXISTS `mensajes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `mensajes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `solicitud_id` int(11) NOT NULL,
  `remitente_id` int(11) NOT NULL,
  `contenido` text NOT NULL,
  `leido` tinyint(1) DEFAULT 0,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `solicitud_id` (`solicitud_id`),
  KEY `remitente_id` (`remitente_id`),
  CONSTRAINT `mensajes_ibfk_1` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes_servicio` (`id`) ON DELETE CASCADE,
  CONSTRAINT `mensajes_ibfk_2` FOREIGN KEY (`remitente_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `mensajes`
--

LOCK TABLES `mensajes` WRITE;
/*!40000 ALTER TABLE `mensajes` DISABLE KEYS */;
/*!40000 ALTER TABLE `mensajes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ofertas_servicio`
--

DROP TABLE IF EXISTS `ofertas_servicio`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ofertas_servicio` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `solicitud_id` int(11) NOT NULL,
  `trabajador_id` int(11) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `mensaje` text DEFAULT NULL,
  `estado` enum('pendiente','aceptada','rechazada') DEFAULT 'pendiente',
  `fecha` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `solicitud_id` (`solicitud_id`),
  KEY `trabajador_id` (`trabajador_id`),
  CONSTRAINT `ofertas_servicio_ibfk_1` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes_servicio` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ofertas_servicio_ibfk_2` FOREIGN KEY (`trabajador_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ofertas_servicio`
--

LOCK TABLES `ofertas_servicio` WRITE;
/*!40000 ALTER TABLE `ofertas_servicio` DISABLE KEYS */;
/*!40000 ALTER TABLE `ofertas_servicio` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pagos`
--

DROP TABLE IF EXISTS `pagos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `solicitud_id` int(11) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `metodo_pago` varchar(50) NOT NULL,
  `referencia_pago` varchar(100) DEFAULT NULL,
  `comprobante_url` text DEFAULT NULL,
  `estado` enum('pendiente','pagado','rechazado') DEFAULT 'pendiente',
  `fecha_pago` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `solicitud_id` (`solicitud_id`),
  CONSTRAINT `pagos_ibfk_1` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes_servicio` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pagos`
--

LOCK TABLES `pagos` WRITE;
/*!40000 ALTER TABLE `pagos` DISABLE KEYS */;
/*!40000 ALTER TABLE `pagos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `perfiles_trabajador`
--

DROP TABLE IF EXISTS `perfiles_trabajador`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `perfiles_trabajador` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `descripcion_servicio` text DEFAULT NULL,
  `documento_identidad` varchar(100) DEFAULT NULL,
  `verificado` tinyint(1) DEFAULT 0,
  `disponible` tinyint(1) DEFAULT 0,
  `calificacion_promedio` decimal(3,2) DEFAULT 0.00,
  `nivel` tinyint(4) DEFAULT 1,
  `total_servicios` int(11) DEFAULT 0,
  `cancelaciones` int(11) DEFAULT 0,
  `latitud` decimal(10,7) DEFAULT NULL,
  `longitud` decimal(10,7) DEFAULT NULL,
  `radio_trabajo_km` int(11) DEFAULT 10,
  PRIMARY KEY (`id`),
  UNIQUE KEY `usuario_id` (`usuario_id`),
  KEY `idx_perfiles_disponible` (`disponible`),
  CONSTRAINT `perfiles_trabajador_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `perfiles_trabajador`
--

LOCK TABLES `perfiles_trabajador` WRITE;
/*!40000 ALTER TABLE `perfiles_trabajador` DISABLE KEYS */;
INSERT INTO `perfiles_trabajador` VALUES
(1,2,NULL,NULL,0,1,0.00,1,0,0,10.6400000,-71.7600000,10);
/*!40000 ALTER TABLE `perfiles_trabajador` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `solicitudes_servicio`
--

DROP TABLE IF EXISTS `solicitudes_servicio`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `solicitudes_servicio` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente_id` int(11) NOT NULL,
  `trabajador_id` int(11) DEFAULT NULL,
  `categoria_id` int(11) NOT NULL,
  `direccion` varchar(255) NOT NULL,
  `latitud` decimal(10,7) DEFAULT NULL,
  `longitud` decimal(10,7) DEFAULT NULL,
  `descripcion` text DEFAULT NULL,
  `foto_url` longtext DEFAULT NULL,
  `urgencia` enum('normal','hoy','urgente') DEFAULT 'normal',
  `estado` enum('buscando','asignado','en_camino','en_proceso','completado','cancelado') DEFAULT 'buscando',
  `motivo_cancelacion` text DEFAULT NULL,
  `costo_estimado` decimal(10,2) DEFAULT NULL,
  `costo_final` decimal(10,2) DEFAULT NULL,
  `fecha_creacion` timestamp NOT NULL DEFAULT current_timestamp(),
  `fecha_asignacion` timestamp NULL DEFAULT NULL,
  `fecha_completado` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `cliente_id` (`cliente_id`),
  KEY `idx_solicitudes_estado` (`estado`),
  KEY `idx_solicitudes_categoria` (`categoria_id`),
  KEY `idx_solicitudes_trabajador` (`trabajador_id`),
  CONSTRAINT `solicitudes_servicio_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `solicitudes_servicio_ibfk_2` FOREIGN KEY (`trabajador_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `solicitudes_servicio_ibfk_3` FOREIGN KEY (`categoria_id`) REFERENCES `categorias_servicio` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `solicitudes_servicio`
--

LOCK TABLES `solicitudes_servicio` WRITE;
/*!40000 ALTER TABLE `solicitudes_servicio` DISABLE KEYS */;
INSERT INTO `solicitudes_servicio` VALUES
(1,1,NULL,4,'La lagunita tercera etapa',NULL,NULL,'Reparación de aire acondicionado',NULL,'hoy','cancelado',NULL,NULL,NULL,'2026-06-25 19:20:25',NULL,NULL),
(2,1,NULL,2,'La lagunita tercera etapa',NULL,NULL,'Se me quemo un fusible. ',NULL,'urgente','cancelado',NULL,NULL,NULL,'2026-06-29 18:48:24',NULL,NULL),
(3,1,NULL,2,'La montañita. ',10.6400000,-71.7600000,'Corto circuito.',NULL,'hoy','cancelado',NULL,NULL,NULL,'2026-06-29 19:18:05',NULL,NULL),
(4,3,NULL,2,'Municipio Maracaibo',10.6400000,-71.7600000,'Corto circuito peligroso.',NULL,'urgente','buscando',NULL,NULL,NULL,'2026-07-03 15:20:49',NULL,NULL);
/*!40000 ALTER TABLE `solicitudes_servicio` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `trabajador_categorias`
--

DROP TABLE IF EXISTS `trabajador_categorias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `trabajador_categorias` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `categoria_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unica_especialidad` (`usuario_id`,`categoria_id`),
  KEY `fk_tc_categoria` (`categoria_id`),
  CONSTRAINT `fk_tc_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias_servicio` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tc_trabajador` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trabajador_categorias`
--

LOCK TABLES `trabajador_categorias` WRITE;
/*!40000 ALTER TABLE `trabajador_categorias` DISABLE KEYS */;
/*!40000 ALTER TABLE `trabajador_categorias` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `apellido` varchar(100) NOT NULL,
  `cedula` varchar(50) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `rol` enum('cliente','trabajador','admin') NOT NULL DEFAULT 'cliente',
  `avatar_url` text DEFAULT NULL,
  `direcciones` longtext DEFAULT NULL,
  `metodos_pago` longtext DEFAULT NULL,
  `estado` enum('activo','suspendido') NOT NULL DEFAULT 'activo',
  `fecha_registro` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuarios`
--

LOCK TABLES `usuarios` WRITE;
/*!40000 ALTER TABLE `usuarios` DISABLE KEYS */;
INSERT INTO `usuarios` VALUES
(1,'Andres','Espina',NULL,'Espinaandres23@gmail.com','04246937438','$2b$10$egiFyZypJYdDF8puo82iYeqkX8UD5dFGuMVR6IUj/ozwUylsqOAb6','admin','http://localhost:5500/uploads/asset_1783085583674.jpg',NULL,NULL,'activo','2026-06-25 18:17:11'),
(2,'Julian','Alvarez',NULL,'Prueba812@gmail.com',NULL,'$2b$10$1F9m/DFskRr.PgVvS.7z0uJL4oBquJqF0HV6JOZBBInycC5oNODta','trabajador',NULL,NULL,NULL,'activo','2026-06-25 21:36:21'),
(3,'Ansu','Dev',NULL,'Aesp2330@gmail.com',NULL,'$2b$10$3iJkNIlt.L8HhE8Jy9gbd.no7uf46iWyIZ1gEVfGgoSEQzugeJym.','cliente',NULL,NULL,NULL,'activo','2026-07-03 15:19:52');
/*!40000 ALTER TABLE `usuarios` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'tuservicioexpress'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-08 12:12:36
