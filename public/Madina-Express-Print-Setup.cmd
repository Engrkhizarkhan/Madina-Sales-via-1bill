@echo off
setlocal

set "chrome=HKCU\Software\Policies\Google\Chrome"
set "edge=HKCU\Software\Policies\Microsoft\Edge"
set "reg=%SystemRoot%\System32\reg.exe"

"%reg%" add "%chrome%" /v DisablePrintPreview /t REG_DWORD /d 0 /f >nul || goto :failed
"%reg%" add "%chrome%" /v PrintPreviewUseSystemDefaultPrinter /t REG_DWORD /d 1 /f >nul || goto :failed
"%reg%" add "%chrome%" /v SilentPrintingEnabled /t REG_DWORD /d 1 /f >nul || goto :failed

"%reg%" add "%edge%" /v UseSystemPrintDialog /t REG_DWORD /d 0 /f >nul || goto :failed
"%reg%" add "%edge%" /v PrintPreviewUseSystemDefaultPrinter /t REG_DWORD /d 1 /f >nul || goto :failed
"%reg%" add "%edge%" /v SilentPrintingEnabled /t REG_DWORD /d 1 /f >nul || goto :failed

echo Silent printing settings saved for this Windows account.
echo Chrome and Edge 144 or later will use your Windows default printer.
echo Set the thermal printer as default, then fully close and reopen the browser.
pause
exit /b 0

:failed
echo Windows could not save all browser print settings. Run setup again from the counter account.
pause
exit /b 1
