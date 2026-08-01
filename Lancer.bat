@echo off
REM ============================================================
REM  Lance le calculateur d'equipement en local.
REM  Un serveur HTTP est necessaire : le navigateur bloque les
REM  modules ES et fetch() sur les fichiers ouverts en file://
REM ============================================================
cd /d "%~dp0"
echo Demarrage du serveur sur http://localhost:8767 ...
start "" http://localhost:8767/index.html
python -m http.server 8767
