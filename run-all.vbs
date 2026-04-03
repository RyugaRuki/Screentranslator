Set shell = CreateObject("WScript.Shell")
Dim ps
ps = "powershell -NoProfile -ExecutionPolicy Bypass -File """ & Replace(WScript.ScriptFullName, "run-all.vbs", "run-all.ps1") & """"
shell.Run ps, 0, False
