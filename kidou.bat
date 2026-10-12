@echo off
start msedge --allow-file-access-from-files --user-data-dir="%TEMP%\EdgeLocalApp" "%~dp0index.html"
