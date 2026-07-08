#!/bin/bash
# ============================================================
set -o pipefail
#  RESPALDO DE LA BASE DE DATOS FIXIO (Linux / VPS)
#  Programalo en cron:  0 3 * * * /ruta/respaldo_linux.sh
# ============================================================
BASEDATOS="tuservicioexpress"
USUARIO="root"
CLAVE=""            # dejar vacio si no tiene clave
CARPETA="$(dirname "$0")/respaldos"

mkdir -p "$CARPETA"
FECHA=$(date +%Y-%m-%d_%H%M)
ARCHIVO="$CARPETA/fixio_$FECHA.sql.gz"

if [ -z "$CLAVE" ]; then
    mysqldump -u "$USUARIO" --routines --triggers "$BASEDATOS" | gzip > "$ARCHIVO"
else
    mysqldump -u "$USUARIO" -p"$CLAVE" --routines --triggers "$BASEDATOS" | gzip > "$ARCHIVO"
fi

if [ $? -eq 0 ]; then
    echo "Respaldo creado: $ARCHIVO"
    # Conservar solo los ultimos 30 dias
    find "$CARPETA" -name "fixio_*.sql.gz" -mtime +30 -delete
else
    echo "ERROR al crear el respaldo."
fi
