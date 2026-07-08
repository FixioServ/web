@echo off
REM ============================================================
REM  RESPALDO DE LA BASE DE DATOS FIXIO (Windows + XAMPP)
REM  Uso: doble clic, o programalo en el Programador de tareas
REM  de Windows para que corra todos los dias a las 3:00 AM.
REM ============================================================
setlocal
set MYSQLDUMP=C:\xampp\mysql\bin\mysqldump.exe
set BASEDATOS=tuservicioexpress
set USUARIO=root
set CLAVE=
set CARPETA=%~dp0respaldos

if not exist "%CARPETA%" mkdir "%CARPETA%"

for /f "tokens=1-3 delims=/- " %%a in ("%DATE%") do set FECHA=%%c-%%b-%%a
set ARCHIVO=%CARPETA%\fixio_%FECHA%.sql

if "%CLAVE%"=="" (
    "%MYSQLDUMP%" -u %USUARIO% --routines --triggers %BASEDATOS% > "%ARCHIVO%"
) else (
    "%MYSQLDUMP%" -u %USUARIO% -p%CLAVE% --routines --triggers %BASEDATOS% > "%ARCHIVO%"
)

if %ERRORLEVEL%==0 (
    echo Respaldo creado: %ARCHIVO%
    REM Borrar respaldos con mas de 30 dias
    forfiles /p "%CARPETA%" /m fixio_*.sql /d -30 /c "cmd /c del @path" 2>nul
) else (
    echo ERROR al crear el respaldo. Verifica la ruta de XAMPP y las credenciales.
)
pause
