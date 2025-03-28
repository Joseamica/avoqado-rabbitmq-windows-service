# Make sure we only include this file once
!ifndef CUSTOM_MACRO_INCLUDED
!define CUSTOM_MACRO_INCLUDED

# Don't define customInstall - electron-builder has its own internal one
# The perMachine: true setting in package.json already triggers admin rights

!macro customUnInstall
  # Custom uninstall actions
  DetailPrint "Running custom uninstall actions..."
!macroend

!macro customInstallMode
  # Force admin installation mode
  !define MULTIUSER_INSTALLMODE_REQUIRE_ADMIN
!macroend

!endif