@echo off
rem Outil de deploiement graphique (page locale dans le navigateur). Necessite Node.js.
cd /d "%~dp0.."
node deploy\deploy-gui.mjs
pause
