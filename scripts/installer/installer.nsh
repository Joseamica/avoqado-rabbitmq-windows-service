# Make sure we only include this file once
!ifndef CUSTOM_MACRO_INCLUDED
!define CUSTOM_MACRO_INCLUDED

# We need to define customInstall to set admin rights for the application after installation
# This won't interfere with electron-builder's internal functions
!macro customInstall
  # Set the application to always run as admin
  DetailPrint "Configuring application to run with admin rights..."
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\Avoqado POS Service Installer.exe" "RUNASADMIN"
!macroend

# Don't change existing macros
!macro customUnInstall
  # Custom uninstall actions
  DetailPrint "Running custom uninstall actions..."
!macroend

!macro customInstallMode
  # Force admin installation mode
  !define MULTIUSER_INSTALLMODE_REQUIRE_ADMIN
!macroend
!endif